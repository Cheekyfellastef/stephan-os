#!/usr/bin/env node
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ensureCriticalBacklogMission } from '../stephanos-server/services/criticalBacklogConveyorService.js';
import { claimDriverNeutralExternalConstruction } from '../stephanos-server/services/driverNeutralExternalPickupService.js';

export const BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA = 'stephanos.battle-bridge-goal-discovery-heartbeat.v1';
export const BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_RESULT_MARKER = 'BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_RESULT=';

export async function runBattleBridgeGoalDiscoveryHeartbeat({
  conveyor = ensureCriticalBacklogMission,
  claimExternalConstruction = claimDriverNeutralExternalConstruction,
  externalPickupOptions = {},
} = {}) {
  try {
    const result = await conveyor();
    if (result?.ok !== true) {
      return Object.freeze({
        schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
        ok: false,
        conveyorResult: result || null,
        externalConstructionPickup: null,
        mergeAuthority: false,
        runtimeMutationAuthority: false,
        arbitraryShellAllowed: false,
        destructiveGitAllowed: false,
        finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED',
      });
    }

    const externalConstructionPickup = await claimExternalConstruction(externalPickupOptions);
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
      ok: externalConstructionPickup?.ok !== false,
      conveyorResult: result,
      externalConstructionPickup: externalConstructionPickup || null,
      mergeAuthority: false,
      runtimeMutationAuthority: false,
      arbitraryShellAllowed: false,
      destructiveGitAllowed: false,
      finalVerdict: externalConstructionPickup?.ok === false
        ? 'GOAL_DISCOVERY_HEARTBEAT_EXTERNAL_PICKUP_BLOCKED'
        : externalConstructionPickup?.claimed === true
          ? 'GOAL_DISCOVERY_HEARTBEAT_CONSTRUCTION_CLAIMED'
          : 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE',
    });
  } catch (error) {
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
      ok: false,
      blocker: String(error?.message || 'GOAL_DISCOVERY_HEARTBEAT_FAILED'),
      conveyorResult: null,
      externalConstructionPickup: null,
      mergeAuthority: false,
      runtimeMutationAuthority: false,
      arbitraryShellAllowed: false,
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
