#!/usr/bin/env node
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  ensureCriticalBacklogMission,
} from '../stephanos-server/services/criticalBacklogConveyorService.js';
import {
  reconcileSovereignCommanderCapabilityParity,
} from './sovereign-commander-capability-parity-reconcile.mjs';

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
    commanderParity: details.commanderParity || null,
    commanderParityHealthy: details.commanderParity?.ok === true,
    capabilityParityOwnerGoal: text(details.commanderParity?.canonicalOwnerGoal, '#2573'),
    capabilityParityBuildableGapCount: integer(details.commanderParity?.buildableGapCount),
    capabilityParityBoundaryHoldCount: integer(details.commanderParity?.boundaryHoldCount),
    zeroGapInvariantSatisfied: integer(details.commanderParity?.buildableGapCount) === 0,
    capabilityParityClosureRequired: integer(details.commanderParity?.buildableGapCount) > 0,
    daemonMayReportGreen: integer(details.commanderParity?.buildableGapCount) === 0,
    mustContinueUntilZero: true,
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
  reconcileCommanderParity = reconcileSovereignCommanderCapabilityParity,
  parityOptions = {},
  now = new Date(),
} = {}) {
  const nowUtc = now instanceof Date ? now.toISOString() : new Date().toISOString();

  let commanderParity;
  try {
    commanderParity = await reconcileCommanderParity({ ...parityOptions, now });
  } catch (error) {
    commanderParity = Object.freeze({
      ok: false,
      blocker: String(error?.message || 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_RECONCILE_FAILED'),
      canonicalOwnerGoal: '#2573',
      mergeAuthority: false,
      runtimeMutationAuthority: false,
      arbitraryShellAllowed: false,
      finalVerdict: 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_RECONCILE_BLOCKED',
    });
  }

  let conveyorResult;
  try {
    conveyorResult = await conveyor({
      allowLegacyMissionCreation: false,
      admissionOwner: 'sovereign-commander-fleet-goal-supervisor',
    });
  } catch (error) {
    return blockedResult(error?.message || 'CANONICAL_GOAL_CONVEYOR_EXCEPTION', { commanderParity });
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
    commanderParity,
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
    commanderParity,
    commanderParityHealthy: commanderParity?.ok === true,
    capabilityParityOwnerGoal: text(commanderParity?.canonicalOwnerGoal, '#2573'),
    capabilityParityBuildableGapCount: integer(commanderParity?.buildableGapCount),
    capabilityParityBoundaryHoldCount: integer(commanderParity?.boundaryHoldCount),
    zeroGapInvariantSatisfied: integer(commanderParity?.buildableGapCount) === 0,
    capabilityParityClosureRequired: integer(commanderParity?.buildableGapCount) > 0,
    daemonMayReportGreen: integer(commanderParity?.buildableGapCount) === 0,
    mustContinueUntilZero: true,
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
    finalVerdict: integer(commanderParity?.buildableGapCount) > 0
      ? dispatchCount > 0
        ? 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_PARITY_CLOSURE_ACTIVE'
        : 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_PARITY_PENDING'
      : dispatchCount > 0
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
