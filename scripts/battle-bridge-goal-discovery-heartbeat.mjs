#!/usr/bin/env node
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ensureCriticalBacklogMission } from '../stephanos-server/services/criticalBacklogConveyorService.js';
import { processNextProviderNeutralSourceBuild } from '../stephanos-server/services/providerNeutralSourceBuilderService.js';

export const BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA = 'stephanos.battle-bridge-goal-discovery-heartbeat.v1';
export const BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_RESULT_MARKER = 'BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_RESULT=';

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
        mergeAuthority: false,
        runtimeMutationAuthority: false,
        destructiveGitAllowed: false,
        finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED',
      });
    }

    const sourceBuild = await buildClaimedGoal(builderOptions);
    const built = sourceBuild?.processed === true && sourceBuild?.success === true;
    const blocked = sourceBuild?.processed === true && sourceBuild?.success === false;
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
      ok: !blocked,
      conveyorResult: result,
      sourceBuild: sourceBuild || null,
      mergeAuthority: false,
      runtimeMutationAuthority: false,
      destructiveGitAllowed: false,
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
      mergeAuthority: false,
      runtimeMutationAuthority: false,
      destructiveGitAllowed: false,
      finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED',
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runBattleBridgeGoalDiscoveryHeartbeat();
  process.stdout.write(`${BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_RESULT_MARKER}${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
