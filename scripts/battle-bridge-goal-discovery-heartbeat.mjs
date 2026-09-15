#!/usr/bin/env node
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ensureCriticalBacklogMission } from '../stephanos-server/services/criticalBacklogConveyorService.js';
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

function authorityBoundary() {
  return {
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
  };
}

export async function runBattleBridgeGoalDiscoveryHeartbeat({
  conveyor = ensureCriticalBacklogMission,
  buildClaimedGoal = processNextProviderNeutralSourceBuild,
  builderOptions = {},
} = {}) {
  try {
    const result = await conveyor();
    if (result?.ok !== true) {
      return Object.freeze({
        schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
        ok: false,
        conveyorResult: result || null,
        sourceBuild: null,
        ...authorityBoundary(),
        finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED',
      });
    }

    const elasticHold = heldElasticDispatch(result);
    const sourceBuild = await buildClaimedGoal(builderOptions);
    const built = sourceBuild?.processed === true && sourceBuild?.success === true;
    const blocked = sourceBuild?.processed === true && sourceBuild?.success === false;

    if (!built && !blocked && elasticHold) {
      return Object.freeze({
        schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
        ok: true,
        conveyorResult: result,
        sourceBuild: sourceBuild || null,
        elasticHold,
        parkedLaneBlockers: Object.freeze(
          elasticHold.held.map((item) => `${item.missionId}:${item.reason}`),
        ),
        heldLaneParked: true,
        controllerContinuity: 'CONTINUE',
        ...authorityBoundary(),
        finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_ELASTIC_SOURCE_BUILD_PARKED_CONTINUING',
      });
    }

    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
      ok: !blocked,
      conveyorResult: result,
      sourceBuild: sourceBuild || null,
      elasticHold: elasticHold || null,
      ...authorityBoundary(),
      finalVerdict: blocked
        ? 'GOAL_DISCOVERY_HEARTBEAT_SOURCE_BUILD_BLOCKED'
        : built
          ? 'GOAL_DISCOVERY_HEARTBEAT_SOURCE_CHANGED_AND_TESTED'
          : 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE',
    });
  } catch (error) {
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
      ok: false,
      blocker: String(error?.message || 'GOAL_DISCOVERY_HEARTBEAT_FAILED'),
      conveyorResult: null,
      sourceBuild: null,
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
