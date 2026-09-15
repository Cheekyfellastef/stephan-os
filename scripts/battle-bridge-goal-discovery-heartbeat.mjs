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
import { processNextProviderNeutralSourceBuild } from '../stephanos-server/services/providerNeutralSourceBuilderService.js';

export const BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA = 'stephanos.battle-bridge-goal-discovery-heartbeat.v1';
export const BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_RESULT_MARKER = 'BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_RESULT=';

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
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    destructiveGitAllowed: false,
    arbitraryShellAllowed: false,
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
    return Object.freeze({
      ok: false,
      reason: String(error?.message || 'AUTONOMY_BUILD_TRACK_PUBLICATION_FAILED'),
    });
  }
}

export async function runBattleBridgeGoalDiscoveryHeartbeat({
  conveyor = ensureCriticalBacklogMission,
  buildClaimedGoal = processNextProviderNeutralSourceBuild,
  builderOptions = {},
  paths = resolveCriticalBacklogRuntimePaths(),
  publishTrack = publishAutonomyBuildTrackStatus,
  now = new Date(),
} = {}) {
  const timestampUtc = now instanceof Date ? now.toISOString() : new Date().toISOString();
  try {
    const result = await conveyor();
    if (result?.ok !== true) {
      const autonomyTrack = projectHeartbeatAutonomyBuildTrack({
        conveyorResult: result || { ok: false, blocker: 'CONVEYOR_RESULT_MISSING' },
        sourceBuild: null,
        timestampUtc,
      });
      const trackPublication = await publishTrackSafely(autonomyTrack, publishTrack, paths);
      return Object.freeze({
        schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
        ok: false,
        conveyorResult: result || null,
        sourceBuild: null,
        autonomyTrack,
        trackPublication,
        mergeAuthority: false,
        runtimeMutationAuthority: false,
        destructiveGitAllowed: false,
        arbitraryShellAllowed: false,
        finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED',
      });
    }

    const elasticHold = heldElasticDispatch(result);
    const sourceBuild = await buildClaimedGoal(builderOptions);
    const built = sourceBuild?.processed === true && sourceBuild?.success === true;
    const blocked = sourceBuild?.processed === true && sourceBuild?.success === false;
    const effectiveConveyorResult = !built && !blocked && elasticHold
      ? Object.freeze({
        ...result,
        ok: false,
        blocker: elasticHold.held.map((item) => `${item.missionId}:${item.reason}`).join(';'),
      })
      : result;
    const autonomyTrack = projectHeartbeatAutonomyBuildTrack({
      conveyorResult: effectiveConveyorResult,
      sourceBuild: sourceBuild || null,
      timestampUtc,
    });
    const trackPublication = await publishTrackSafely(autonomyTrack, publishTrack, paths);

    if (!built && !blocked && elasticHold) {
      return Object.freeze({
        schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
        ok: false,
        blocker: elasticHold.held.map((item) => `${item.missionId}:${item.reason}`).join(';'),
        conveyorResult: result,
        sourceBuild: sourceBuild || null,
        elasticHold,
        autonomyTrack,
        trackPublication,
        mergeAuthority: false,
        runtimeMutationAuthority: false,
        destructiveGitAllowed: false,
        arbitraryShellAllowed: false,
        finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_ELASTIC_SOURCE_BUILD_HELD',
      });
    }

    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
      ok: !blocked,
      conveyorResult: result,
      sourceBuild: sourceBuild || null,
      elasticHold: elasticHold || null,
      autonomyTrack,
      trackPublication,
      mergeAuthority: false,
      runtimeMutationAuthority: false,
      destructiveGitAllowed: false,
      arbitraryShellAllowed: false,
      finalVerdict: blocked
        ? 'GOAL_DISCOVERY_HEARTBEAT_SOURCE_BUILD_BLOCKED'
        : built
          ? 'GOAL_DISCOVERY_HEARTBEAT_SOURCE_CHANGED_AND_TESTED'
          : 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE',
    });
  } catch (error) {
    const blocker = String(error?.message || 'GOAL_DISCOVERY_HEARTBEAT_FAILED');
    const autonomyTrack = projectHeartbeatAutonomyBuildTrack({
      conveyorResult: { ok: false, blocker },
      sourceBuild: null,
      timestampUtc,
    });
    const trackPublication = await publishTrackSafely(autonomyTrack, publishTrack, paths);
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
      ok: false,
      blocker,
      conveyorResult: null,
      sourceBuild: null,
      autonomyTrack,
      trackPublication,
      mergeAuthority: false,
      runtimeMutationAuthority: false,
      destructiveGitAllowed: false,
      arbitraryShellAllowed: false,
      finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED',
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runBattleBridgeGoalDiscoveryHeartbeat();
  process.stdout.write(`${BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_RESULT_MARKER}${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
