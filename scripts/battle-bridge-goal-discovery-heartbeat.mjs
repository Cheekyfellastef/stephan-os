#!/usr/bin/env node
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ensureCriticalBacklogMission } from '../stephanos-server/services/criticalBacklogConveyorService.js';
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
  for (const item of elasticHold?.held || []) {
    blockers.add(`${item.missionId}:${item.reason}`);
  }
}

function sourceBuildBlocker(sourceBuild = {}) {
  const missionId = String(sourceBuild?.missionId || sourceBuild?.actionId || 'claimed-source-lane');
  const reason = String(
    sourceBuild?.error
    || sourceBuild?.reason
    || sourceBuild?.finalVerdict
    || 'PROVIDER_NEUTRAL_SOURCE_BUILD_BLOCKED',
  );
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
} = {}) {
  const limit = sweepLimit(maxWorkConservingAttempts);
  const parkedLaneBlockers = new Set();
  const sweepAttempts = [];
  let latestResult = null;
  let latestSourceBuild = null;
  let latestElasticHold = null;
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
    } catch (error) {
      githubLifeboatClaimAck = unavailableGithubLifeboatClaimAck(error);
    }

    try { lifeboatCapacity = await refreshLifeboatCapacity(lifeboatOptions); }
    catch (error) { lifeboatCapacity = unavailableLifeboat(error); }

    for (let attemptIndex = 0; attemptIndex < limit; attemptIndex += 1) {
      const result = await conveyor();
      latestResult = result || null;
      if (result?.ok !== true) {
        return Object.freeze({
          schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
          ok: false,
          githubLifeboat,
          githubLifeboatClaimAck,
          lifeboatCapacity,
          conveyorResult: result || null,
          sourceBuild: latestSourceBuild,
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
      sweepAttempts.push(frozenSweepAttempt({
        attemptNumber: attemptIndex + 1,
        result,
        sourceBuild,
        elasticHold,
      }));

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
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
      ok: false,
      blocker: String(error?.message || 'GOAL_DISCOVERY_HEARTBEAT_FAILED'),
      githubLifeboat,
      githubLifeboatClaimAck,
      lifeboatCapacity,
      conveyorResult: latestResult,
      sourceBuild: latestSourceBuild,
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