#!/usr/bin/env node
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ensureCriticalBacklogMission } from '../stephanos-server/services/criticalBacklogConveyorService.js';

export const BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA = 'stephanos.battle-bridge-goal-discovery-heartbeat.v1';
export const BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_RESULT_MARKER = 'BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_RESULT=';

export async function runBattleBridgeGoalDiscoveryHeartbeat({ conveyor = ensureCriticalBacklogMission } = {}) {
  try {
    const result = await conveyor();
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
      ok: result?.ok === true,
      conveyorResult: result || null,
      mergeAuthority: false,
      runtimeMutationAuthority: false,
      arbitraryShellAllowed: false,
      destructiveGitAllowed: false,
      finalVerdict: result?.ok === true
        ? 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE'
        : 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED',
    });
  } catch (error) {
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
      ok: false,
      blocker: String(error?.message || 'GOAL_DISCOVERY_HEARTBEAT_FAILED'),
      conveyorResult: null,
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
