#!/usr/bin/env node
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  ensureCriticalBacklogMission,
} from '../stephanos-server/services/criticalBacklogConveyorService.js';

export const SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_SCHEMA =
  'stephanos.sovereign-commander-fleet-goal-supervisor.v1';
export const SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_RESULT_MARKER =
  'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_RESULT=';

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

function blockedResult(blocker, details = {}) {
  return frozen({
    schemaVersion: SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_SCHEMA,
    ok: false,
    blocker: text(blocker) || 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_FAILED',
    activeMissionCount: integer(details.activeMissionCount),
    runningMissionCount: integer(details.runningMissionCount),
    runnableGoalCount: integer(details.runnableGoalCount),
    availableSlotCount: integer(details.availableSlotCount),
    dispatchCount: integer(details.dispatchCount),
    heldGoalCount: integer(details.heldGoalCount),
    capacityObservationSource: 'canonical-programme-and-provider-receipts',
    synchronousProviderRefreshAllowed: false,
    canonicalGoalFabricOnly: true,
    sourceMutationDelegatedToMissionWorker: true,
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
  conveyor = ensureCriticalBacklogMission,
  now = new Date(),
} = {}) {
  const nowUtc = now instanceof Date ? now.toISOString() : new Date().toISOString();

  let conveyorResult;
  try {
    conveyorResult = await conveyor({
      allowLegacyMissionCreation: false,
      admissionOwner: 'sovereign-commander-fleet-goal-supervisor',
    });
  } catch (error) {
    return blockedResult(error?.message || 'CANONICAL_GOAL_CONVEYOR_EXCEPTION');
  }

  const admission = conveyorResult?.elasticAdmission || {};
  const ignition = conveyorResult?.elasticIgnition || {};
  const activeMissions = Array.isArray(admission.activeMissions) ? admission.activeMissions : [];
  const runnableGoals = Array.isArray(admission.runnableMissions) ? admission.runnableMissions : [];
  const activeMissionCount = activeMissions.length;
  const runningMissionCount = activeMissions.filter(
    (mission) => text(mission?.dispatch?.status).toLowerCase() === 'running',
  ).length;
  const runnableGoalCount = runnableGoals.length;
  const availableSlotCount = integer(ignition.availableSlots);
  const dispatchCount = integer(ignition.dispatchCount);
  const heldGoalCount = count(ignition.held);
  const details = {
    activeMissionCount,
    runningMissionCount,
    runnableGoalCount,
    availableSlotCount,
    dispatchCount,
    heldGoalCount,
  };

  if (conveyorResult?.ok !== true) {
    return blockedResult(
      conveyorResult?.reason || conveyorResult?.finalVerdict || 'CANONICAL_GOAL_CONVEYOR_BLOCKED',
      details,
    );
  }

  const safeWorkStranded = runnableGoalCount > 0
    && availableSlotCount > 0
    && dispatchCount === 0
    && heldGoalCount === 0
    && conveyorResult?.workerRuntimeHold !== true;

  if (safeWorkStranded) {
    return blockedResult('SAFE_RUNNABLE_WORK_AND_FREE_CAPACITY_STRANDED', details);
  }

  return frozen({
    schemaVersion: SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_SCHEMA,
    ok: true,
    blocker: '',
    observedAtUtc: nowUtc,
    conveyorClassification: text(conveyorResult.classification),
    conveyorVerdict: text(conveyorResult.finalVerdict),
    activeMissionCount,
    runningMissionCount,
    runnableGoalCount,
    availableSlotCount,
    dispatchCount,
    heldGoalCount,
    programmeStatus: text(conveyorResult.programmeStatus),
    programmeBlockers: frozen(Array.isArray(conveyorResult.programmeBlockers)
      ? [...conveyorResult.programmeBlockers].map(text).filter(Boolean)
      : []),
    capacityObservationSource: 'canonical-programme-and-provider-receipts',
    synchronousProviderRefreshAllowed: false,
    canonicalGoalFabricOnly: true,
    sourceMutationDelegatedToMissionWorker: true,
    workConserving: true,
    duplicateSchedulerAllowed: false,
    duplicateLeaseAllowed: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
    finalVerdict: dispatchCount > 0
      ? 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_DISPATCHED'
      : runnableGoalCount === 0
        ? 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_IDLE_GREEN'
        : heldGoalCount > 0
          ? 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_HELD_EXPLAINED'
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
