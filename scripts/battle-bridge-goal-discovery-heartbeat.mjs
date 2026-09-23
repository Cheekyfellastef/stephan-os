#!/usr/bin/env node
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  AUTONOMY_BUILD_TRACK_STATUS_ID,
  projectHeartbeatAutonomyBuildTrack,
} from '../shared/agents/autonomyBuildTrackV1.mjs';
import {
  createSharedWorkspaceStatusRecord,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  ensureCriticalBacklogMission,
  resolveCriticalBacklogRuntimePaths,
} from '../stephanos-server/services/criticalBacklogConveyorService.js';
import { refreshForgeLifeboatCapacity } from '../stephanos-server/services/forgeLifeboatCapacityService.js';
import { runGitHubLifeboatLane7 } from '../stephanos-server/services/githubLifeboatLane7Service.js';
import { refreshGitHubLifeboatLane7ClaimAck } from '../stephanos-server/services/githubLifeboatLane7ClaimAckKeeper.js';
import { processNextProviderNeutralSourceBuild } from '../stephanos-server/services/providerNeutralSourceBuilderService.js';

export const BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA = 'stephanos.battle-bridge-goal-discovery-heartbeat.v1';
export const BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_RESULT_MARKER = 'BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_RESULT=';
export const DEFAULT_WORK_CONSERVING_SWEEP_LIMIT = 5;
export const BATTLE_BRIDGE_CANONICAL_GITHUB_CLI = process.platform === 'win32'
  ? 'C:\\Program Files\\GitHub CLI\\gh.exe'
  : 'gh';

function heldElasticDispatch(result = {}) {
  const ignition = result?.elasticIgnition;
  const dispatchCount = Number(ignition?.dispatchCount || 0);
  const held = Array.isArray(ignition?.held) ? ignition.held : [];
  if (dispatchCount > 0 || held.length === 0) return null;
  return Object.freeze({
    classification: String(ignition?.classification || 'ELASTIC_EXTERNAL_BUILD_DISPATCH_HELD'),
    held: Object.freeze(held.map((item) => Object.freeze({
      missionId: String(item?.missionId || ''),
      reason: String(item?.reason || 'ELASTIC_SOURCE_BUILD_HELD'),
    }))),
  });
}

function authorityBoundary() {
  return {
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
  };
}

function sweepLimit(value) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1) return DEFAULT_WORK_CONSERVING_SWEEP_LIMIT;
  return Math.min(numeric, DEFAULT_WORK_CONSERVING_SWEEP_LIMIT);
}

function addElasticBlockers(blockers, elasticHold) {
  for (const item of elasticHold?.held || []) blockers.add(`${item.missionId}:${item.reason}`);
}

function sourceBuildBlocker(sourceBuild = {}) {
  const missionId = String(sourceBuild?.missionId || sourceBuild?.actionId || 'claimed-source-lane');
  const reason = String(sourceBuild?.error || sourceBuild?.reason || sourceBuild?.finalVerdict || 'PROVIDER_NEUTRAL_SOURCE_BUILD_BLOCKED');
  return `${missionId}:${reason}`;
}

function frozenSweepAttempt({ attemptNumber, result, sourceBuild, elasticHold }) {
  return Object.freeze({
    attemptNumber,
    conveyorClassification: String(result?.classification || ''),
    sourceBuildProcessed: sourceBuild?.processed === true,
    sourceBuildSuccess: sourceBuild?.success === true,
    sourceBuildMissionId: String(sourceBuild?.missionId || ''),
    sourceBuildVerdict: String(sourceBuild?.finalVerdict || sourceBuild?.reason || ''),
    elasticHoldClassification: String(elasticHold?.classification || ''),
  });
}

function unavailableLifeboat(error) {
  return Object.freeze({
    ok: false,
    available: false,
    reason: `FORGE_LIFEBOAT_CAPACITY_REFRESH_FAILED:${String(error?.message || 'unknown')}`,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
  });
}

function unavailableGithubLifeboat(error) {
  return Object.freeze({
    ok: false,
    available: false,
    reason: `GITHUB_LIFEBOAT_LANE7_REFRESH_FAILED:${String(error?.message || 'unknown')}`,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
  });
}

function unavailableGithubLifeboatClaimAck(error) {
  return Object.freeze({
    ok: false,
    published: false,
    reason: `GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_REFRESH_FAILED:${String(error?.message || 'unknown')}`,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
  });
}

function trackConveyorResult(result, sourceBuild, elasticHold) {
  const built = sourceBuild?.processed === true && sourceBuild?.success === true;
  const blocked = sourceBuild?.processed === true && sourceBuild?.success === false;
  if (built || blocked || !elasticHold) return result;
  return Object.freeze({
    ...result,
    elasticIgnition: Object.freeze({ ...(result?.elasticIgnition || {}), ok: false }),
  });
}

export async function publishAutonomyBuildTrackStatus(track, {
  paths = resolveCriticalBacklogRuntimePaths(),
} = {}) {
  const statusRecord = Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: AUTONOMY_BUILD_TRACK_STATUS_ID,
      participantId: 'battle-bridge-goal-discovery',
      timestampUtc: track.timestampUtc,
      relatedIssue: '#1622',
      status: `${track.currentGate}:${track.currentState}`,
      summary: track.blocker
        ? `Autonomy build track blocked at ${track.currentGate}: ${track.blocker}`
        : `Autonomy build track is at ${track.currentGate} (${track.currentState}).`,
      proofRefs: [],
    }),
    autonomyTrack: track,
    ...authorityBoundary(),
  });
  return writeAtomicJson(
    paths.workspaceRoot,
    ['status', `${AUTONOMY_BUILD_TRACK_STATUS_ID}.json`],
    statusRecord,
    { repoRoot: paths.repoRoot },
  );
}

async function publishTrackSafely(track, publishTrack, paths) {
  try {
    return await publishTrack(track, { paths });
  } catch (error) {
    return Object.freeze({ ok: false, reason: String(error?.message || 'AUTONOMY_BUILD_TRACK_PUBLICATION_FAILED') });
  }
}

async function projectAndPublishTrack({ result, sourceBuild, elasticHold, timestampUtc, publishTrack, paths }) {
  const autonomyTrack = projectHeartbeatAutonomyBuildTrack({
    conveyorResult: trackConveyorResult(result, sourceBuild, elasticHold),
    sourceBuild: sourceBuild || null,
    timestampUtc,
  });
  const trackPublication = await publishTrackSafely(autonomyTrack, publishTrack, paths);
  return Object.freeze({ autonomyTrack, trackPublication });
}

export async function runBattleBridgeGoalDiscoveryHeartbeat({
  conveyor = ensureCriticalBacklogMission,
  refreshLifeboatCapacity = refreshForgeLifeboatCapacity,
  lifeboatOptions = {},
  refreshGithubLifeboat = runGitHubLifeboatLane7,
  githubLifeboatOptions = {},
  refreshGithubLifeboatClaimAck = refreshGitHubLifeboatLane7ClaimAck,
  githubLifeboatClaimAckOptions = {},
  buildClaimedGoal = processNextProviderNeutralSourceBuild,
  builderOptions = {},
  maxWorkConservingAttempts = DEFAULT_WORK_CONSERVING_SWEEP_LIMIT,
  paths = resolveCriticalBacklogRuntimePaths(),
  publishTrack = publishAutonomyBuildTrackStatus,
  now = new Date(),
} = {}) {
  const limit = sweepLimit(maxWorkConservingAttempts);
  const parkedLaneBlockers = new Set();
  const sweepAttempts = [];
  const timestampUtc = now instanceof Date ? now.toISOString() : new Date().toISOString();
  let latestResult = null;
  let latestSourceBuild = null;
  let latestElasticHold = null;
  let latestAutonomyTrack = null;
  let latestTrackPublication = null;
  let lifeboatCapacity = null;
  let githubLifeboat = null;
  let githubLifeboatClaimAck = null;

  try {
    try {
      githubLifeboat = await refreshGithubLifeboat({
        ...githubLifeboatOptions,
        gitCommand: githubLifeboatOptions.gitCommand || 'git',
        ghCommand: githubLifeboatOptions.ghCommand || BATTLE_BRIDGE_CANONICAL_GITHUB_CLI,
      });
    } catch (error) { githubLifeboat = unavailableGithubLifeboat(error); }

    try {
      githubLifeboatClaimAck = await refreshGithubLifeboatClaimAck({
        ...githubLifeboatClaimAckOptions,
        sourceHead: githubLifeboat?.sourceHead || githubLifeboatClaimAckOptions.sourceHead || '',
      });
    } catch (error) { githubLifeboatClaimAck = unavailableGithubLifeboatClaimAck(error); }

    try { lifeboatCapacity = await refreshLifeboatCapacity(lifeboatOptions); }
    catch (error) { lifeboatCapacity = unavailableLifeboat(error); }

    for (let attemptIndex = 0; attemptIndex < limit; attemptIndex += 1) {
      const result = await conveyor({
        allowLegacyMissionCreation: false,
        admissionOwner: 'battle-bridge-goal-discovery',
      });
      latestResult = result || null;
      if (result?.ok !== true) {
        const projected = await projectAndPublishTrack({
          result: result || { ok: false, blocker: 'CONVEYOR_RESULT_MISSING' },
          sourceBuild: null,
          elasticHold: null,
          timestampUtc,
          publishTrack,
          paths,
        });
        return Object.freeze({
          schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
          ok: false,
          githubLifeboat,
          githubLifeboatClaimAck,
          lifeboatCapacity,
          conveyorResult: result || null,
          sourceBuild: latestSourceBuild,
          autonomyTrack: projected.autonomyTrack,
          trackPublication: projected.trackPublication,
          sweepAttemptCount: sweepAttempts.length,
          sweepAttempts: Object.freeze([...sweepAttempts]),
          parkedLaneBlockers: Object.freeze([...parkedLaneBlockers]),
          ...authorityBoundary(),
          finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED',
        });
      }

      const elasticHold = heldElasticDispatch(result);
      latestElasticHold = elasticHold;
      addElasticBlockers(parkedLaneBlockers, elasticHold);

      const sourceBuild = await buildClaimedGoal(builderOptions);
      latestSourceBuild = sourceBuild || null;
      const built = sourceBuild?.processed === true && sourceBuild?.success === true;
      const blocked = sourceBuild?.processed === true && sourceBuild?.success === false;
      sweepAttempts.push(frozenSweepAttempt({ attemptNumber: attemptIndex + 1, result, sourceBuild, elasticHold }));

      const projected = await projectAndPublishTrack({ result, sourceBuild, elasticHold, timestampUtc, publishTrack, paths });
      latestAutonomyTrack = projected.autonomyTrack;
      latestTrackPublication = projected.trackPublication;

      if (built) {
        return Object.freeze({
          schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
          ok: true,
          githubLifeboat,
          githubLifeboatClaimAck,
          lifeboatCapacity,
          conveyorResult: result,
          sourceBuild,
          elasticHold: elasticHold || null,
          autonomyTrack: latestAutonomyTrack,
          trackPublication: latestTrackPublication,
          sweepAttemptCount: sweepAttempts.length,
          sweepAttempts: Object.freeze([...sweepAttempts]),
          parkedLaneBlockers: Object.freeze([...parkedLaneBlockers]),
          heldLaneParked: parkedLaneBlockers.size > 0,
          materialProgress: true,
          controllerContinuity: 'CONTINUE',
          ...authorityBoundary(),
          finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_SOURCE_CHANGED_AND_TESTED',
        });
      }

      if (blocked) {
        parkedLaneBlockers.add(sourceBuildBlocker(sourceBuild));
        continue;
      }

      if (!elasticHold) {
        return Object.freeze({
          schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
          ok: true,
          githubLifeboat,
          githubLifeboatClaimAck,
          lifeboatCapacity,
          conveyorResult: result,
          sourceBuild: sourceBuild || null,
          elasticHold: null,
          autonomyTrack: latestAutonomyTrack,
          trackPublication: latestTrackPublication,
          sweepAttemptCount: sweepAttempts.length,
          sweepAttempts: Object.freeze([...sweepAttempts]),
          parkedLaneBlockers: Object.freeze([...parkedLaneBlockers]),
          noRunnableSourceWorkProven: true,
          materialProgress: false,
          controllerContinuity: 'IDLE_NO_RUNNABLE_SOURCE_WORK',
          ...authorityBoundary(),
          finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE',
        });
      }
    }

    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
      ok: true,
      githubLifeboat,
      githubLifeboatClaimAck,
      lifeboatCapacity,
      conveyorResult: latestResult,
      sourceBuild: latestSourceBuild,
      elasticHold: latestElasticHold,
      autonomyTrack: latestAutonomyTrack,
      trackPublication: latestTrackPublication,
      sweepAttemptCount: sweepAttempts.length,
      sweepAttempts: Object.freeze([...sweepAttempts]),
      parkedLaneBlockers: Object.freeze([...parkedLaneBlockers]),
      heldLaneParked: parkedLaneBlockers.size > 0,
      noRunnableSourceWorkProven: false,
      workConservingSweepExhausted: true,
      materialProgress: false,
      controllerContinuity: 'CONTINUE_NEXT_SWEEP',
      ...authorityBoundary(),
      finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_WORK_CONSERVING_SWEEP_EXHAUSTED',
    });
  } catch (error) {
    const blocker = String(error?.message || 'GOAL_DISCOVERY_HEARTBEAT_FAILED');
    const projected = await projectAndPublishTrack({
      result: { ok: false, blocker },
      sourceBuild: null,
      elasticHold: null,
      timestampUtc,
      publishTrack,
      paths,
    });
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
      ok: false,
      blocker,
      githubLifeboat,
      githubLifeboatClaimAck,
      lifeboatCapacity,
      conveyorResult: latestResult,
      sourceBuild: latestSourceBuild,
      autonomyTrack: projected.autonomyTrack,
      trackPublication: projected.trackPublication,
      sweepAttemptCount: sweepAttempts.length,
      sweepAttempts: Object.freeze([...sweepAttempts]),
      parkedLaneBlockers: Object.freeze([...parkedLaneBlockers]),
      ...authorityBoundary(),
      finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED',
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runBattleBridgeGoalDiscoveryHeartbeat();
  process.stdout.write(`${BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_RESULT_MARKER}${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
