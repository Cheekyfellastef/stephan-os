#!/usr/bin/env node
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runBattleBridgeGoalDiscoveryHeartbeat } from './battle-bridge-goal-discovery-heartbeat.mjs';

export const SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_SCHEMA =
  'stephanos.sovereign-commander-fleet-goal-supervisor.v1';
export const SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_RESULT_MARKER =
  'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_RESULT=';
export const DEFAULT_SOVEREIGN_COMMANDER_FLEET_SWEEP_LIMIT = 8;

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

function integer(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function text(value) {
  return String(value ?? '').trim();
}

function frozen(value) {
  return Object.freeze(value);
}

function blockedResult(blocker, heartbeatResult = null) {
  return frozen({
    schemaVersion: SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_SCHEMA,
    ok: false,
    blocker: text(blocker) || 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_FAILED',
    heartbeatCycleId: text(heartbeatResult?.cycleId),
    heartbeatVerdict: text(heartbeatResult?.finalVerdict),
    activeMissionCount: count(heartbeatResult?.conveyorResult?.elasticAdmission?.activeMissions),
    runnableGoalCount: count(heartbeatResult?.conveyorResult?.elasticAdmission?.runnableMissions),
    availableSlotCount: integer(heartbeatResult?.conveyorResult?.elasticIgnition?.availableSlots),
    dispatchCount: integer(heartbeatResult?.conveyorResult?.elasticIgnition?.dispatchCount),
    materialActionsSucceeded: integer(heartbeatResult?.materialActionsSucceeded),
    parkedLaneBlockerCount: count(heartbeatResult?.parkedLaneBlockers),
    canonicalHeartbeatOnly: true,
    workConserving: true,
    duplicateSchedulerAllowed: false,
    duplicateLeaseAllowed: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_BLOCKED',
  });
}

export async function runSovereignCommanderFleetGoalSupervisor({
  heartbeat = runBattleBridgeGoalDiscoveryHeartbeat,
  maxWorkConservingAttempts = DEFAULT_SOVEREIGN_COMMANDER_FLEET_SWEEP_LIMIT,
  now = new Date(),
} = {}) {
  let heartbeatResult;
  try {
    heartbeatResult = await heartbeat({ maxWorkConservingAttempts, now });
  } catch (error) {
    return blockedResult(error?.message || 'CANONICAL_GOAL_HEARTBEAT_EXCEPTION');
  }

  if (heartbeatResult?.ok !== true) {
    return blockedResult(
      heartbeatResult?.blocker || heartbeatResult?.finalVerdict || 'CANONICAL_GOAL_HEARTBEAT_BLOCKED',
      heartbeatResult,
    );
  }

  const admission = heartbeatResult?.conveyorResult?.elasticAdmission || {};
  const ignition = heartbeatResult?.conveyorResult?.elasticIgnition || {};
  const runnableGoalCount = count(admission.runnableMissions);
  const activeMissionCount = count(admission.activeMissions);
  const availableSlotCount = integer(ignition.availableSlots);
  const dispatchCount = integer(ignition.dispatchCount);
  const materialActionsSucceeded = integer(heartbeatResult?.materialActionsSucceeded);
  const parkedLaneBlockerCount = count(heartbeatResult?.parkedLaneBlockers);
  const continuationRequired = text(heartbeatResult?.controllerContinuity) === 'CONTINUE_NEXT_SWEEP';
  const noRunnableSourceWorkProven = heartbeatResult?.noRunnableSourceWorkProven === true;
  const elasticHoldPresent = heartbeatResult?.elasticHold != null;

  const safeWorkStranded = runnableGoalCount > 0
    && availableSlotCount > 0
    && dispatchCount === 0
    && materialActionsSucceeded === 0
    && parkedLaneBlockerCount === 0
    && !elasticHoldPresent
    && !continuationRequired;

  if (safeWorkStranded) {
    return blockedResult('SAFE_RUNNABLE_WORK_AND_FREE_CAPACITY_STRANDED', heartbeatResult);
  }

  return frozen({
    schemaVersion: SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_SCHEMA,
    ok: true,
    blocker: '',
    observedAtUtc: now instanceof Date ? now.toISOString() : new Date().toISOString(),
    heartbeatCycleId: text(heartbeatResult.cycleId),
    heartbeatVerdict: text(heartbeatResult.finalVerdict),
    activeMissionCount,
    runnableGoalCount,
    availableSlotCount,
    dispatchCount,
    materialActionsSucceeded,
    parkedLaneBlockerCount,
    noRunnableSourceWorkProven,
    continuationRequired,
    canonicalHeartbeatOnly: true,
    workConserving: true,
    duplicateSchedulerAllowed: false,
    duplicateLeaseAllowed: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
    finalVerdict: continuationRequired
      ? 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_CONTINUE'
      : noRunnableSourceWorkProven
        ? 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_IDLE_GREEN'
        : 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_GREEN',
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runSovereignCommanderFleetGoalSupervisor();
  process.stdout.write(
    `${SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_RESULT_MARKER}${JSON.stringify(result)}\n`,
  );
  process.exitCode = result.ok ? 0 : 2;
}
