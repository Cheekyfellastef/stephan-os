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
    heldIssues: frozen(Array.isArray(details.heldIssues) ? details.heldIssues.slice(0, 20) : []),
    programmeStatus: text(details.programmeStatus) || 'UNKNOWN',
    programmeBlockers: frozen(Array.isArray(details.programmeBlockers)
      ? details.programmeBlockers.map((blocker) => text(blocker).slice(0, 160)).filter(Boolean).slice(0, 20)
      : []),
    elasticAdmissionPresent: details.elasticAdmissionPresent === true,
    elasticAdmissionClassification: text(details.elasticAdmissionClassification).slice(0, 120),
    elasticAdmissionReasonCode: text(details.elasticAdmissionReasonCode).slice(0, 120),
    elasticAdmissionGate: details.elasticAdmissionGate || null,
    elasticReviewLeaseRecovery: details.elasticReviewLeaseRecovery || null,
    elasticIgnitionPresent: details.elasticIgnitionPresent === true,
    commanderParity: details.commanderParity || null,
    commanderParityHealthy: details.commanderParity?.ok === true,
    capabilityParityOwnerGoal: text(details.commanderParity?.canonicalOwnerGoal, '#2573'),
    capabilityParityBuildableGapCount: integer(details.commanderParity?.buildableGapCount),
    capabilityParityBoundaryHoldCount: integer(details.commanderParity?.boundaryHoldCount),
    capabilityCompilerVerdict: text(details.commanderParity?.capabilityCompiler?.finalVerdict),
    capabilityCompilerWorkCount: integer(details.commanderParity?.capabilityCompiler?.buildableCapabilityCount),
    flywheelLearningVerdict: text(details.commanderParity?.flywheelLearning?.finalVerdict),
    flywheelLearningPromotionCount: integer(details.commanderParity?.flywheelLearning?.promotedLessonIds?.length),
    zeroGapInvariantSatisfied: integer(details.commanderParity?.buildableGapCount) === 0,
    capabilityParityClosureRequired: integer(details.commanderParity?.buildableGapCount) > 0,
    // An admission/proof failure must not be green even when parity has zero known gaps.
    daemonMayReportGreen: false,
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
    programmeStatus: conveyorResult?.programmeStatus,
    programmeBlockers: conveyorResult?.programmeBlockers,
    elasticAdmissionPresent: Boolean(conveyorResult?.elasticAdmission),
    elasticAdmissionClassification: text(admission?.classification),
    // Do not copy arbitrary exception text (paths or credentials) to public receipts.
    elasticAdmissionReasonCode: /^[A-Z][A-Z0-9_:-]{0,119}$/.test(text(admission?.reason))
      ? text(admission.reason) : '',
    elasticAdmissionGate: conveyorResult?.elasticAdmissionGate || null,
    elasticReviewLeaseRecovery: conveyorResult?.elasticReviewLeaseRecovery || null,
    elasticIgnitionPresent: Boolean(conveyorResult?.elasticIgnition),
    commanderParity,
  };

  if (conveyorResult?.ok !== true) {
    return blockedResult(
      conveyorResult?.reason || conveyorResult?.finalVerdict || 'CANONICAL_GOAL_CONVEYOR_BLOCKED',
      details,
    );
  }

  // Distinguish genuinely missing admission from a *proven* all-held mission
  // estate. The latter needs exact mission-owner repair, not another scheduler.
  // Never mark this blocked state green or fabricate runnable goals.
  if (text(conveyorResult.classification) === 'PARKED_BLOCKERS_ONLY'
      && admission.ok === true
      && text(admission.classification) === 'ELASTIC_GOAL_MISSIONS_HELD'
      && activeMissionCount === 0
      && runnableGoalCount === 0
      && Array.isArray(admission.held)
      && admission.held.length > 0) {
    return blockedResult('ELASTIC_GOALS_ALL_HELD_REPAIR_REQUIRED', {
      ...details,
      heldGoalCount: admission.held.length,
      heldIssues: admission.held
        .filter((item) => Number.isSafeInteger(item?.issueNumber))
        .map((item) => Object.freeze({ issueNumber: item.issueNumber, reason: text(item.reason).slice(0, 96) })),
    });
  }

  // A parked critical backlog is not proof of an idle elastic fleet when admission
  // was skipped. Fail closed and surface the missing programme/admission authority.
  // Carry the *precise fail-closed recovery blocker* rather than masking it
  // as generic missing elastic admission. No additional execution authority.
  if (conveyorResult?.elasticReviewLeaseRecovery?.released === false
      && text(conveyorResult.elasticReviewLeaseRecovery.blocker)) {
    return blockedResult(text(conveyorResult.elasticReviewLeaseRecovery.blocker), details);
  }
  if (text(conveyorResult.classification) === 'PARKED_BLOCKERS_ONLY'
      && (!conveyorResult.elasticAdmission || !conveyorResult.elasticIgnition)) {
    // Distinguish failure inside eligible admission from a genuinely missing
    // admission preflight. Otherwise every unattended repair retries the same
    // opaque blocker without routing to the actual incumbent owner.
    if (admission.ok === false) {
      const cause = text(admission.classification);
      return blockedResult(
        cause === 'ELASTIC_GOAL_ADMISSION_SAFE_HOLD'
          ? 'ELASTIC_GOAL_ADMISSION_SAFE_HOLD'
          : cause === 'ELASTIC_GOAL_ADMISSION_DIAGNOSTIC_FAILED'
            ? 'ELASTIC_GOAL_ADMISSION_DIAGNOSTIC_FAILED'
            : 'ELASTIC_GOAL_ADMISSION_FAILED',
        details,
      );
    }
    if (admission.ok === true
        && text(admission.classification) === 'ELASTIC_GOAL_MISSIONS_HELD') {
      return blockedResult('ELASTIC_GOAL_MISSIONS_HELD_WITHOUT_CLAIMABLE_WORK', details);
    }
    return blockedResult('ELASTIC_GOAL_ADMISSION_NOT_PROVEN', details);
  }

  // The programme may have no runnable/parked worker receipts precisely because
  // its authoritative owner is on HOLD. Never report this as IDLE_GREEN.
  // The Core Daemon owns the bounded Sovereign repair nudge; this supervisor
  // must surface the fault rather than invent independent execution authority.
  if (text(conveyorResult.programmeStatus).toUpperCase() === 'HOLD') {
    return blockedResult('CANONICAL_PROGRAMME_HOLD_REPAIR_REQUIRED', details);
  }

  // Missing parity evidence is not equivalent to zero observed capability gaps.
  if (commanderParity?.ok !== true) {
    return blockedResult(
      text(commanderParity?.blocker) || 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_UNPROVEN',
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
    capabilityCompilerVerdict: text(commanderParity?.capabilityCompiler?.finalVerdict),
    capabilityCompilerWorkCount: integer(commanderParity?.capabilityCompiler?.buildableCapabilityCount),
    flywheelLearningVerdict: text(commanderParity?.flywheelLearning?.finalVerdict),
    flywheelLearningPromotionCount: integer(commanderParity?.flywheelLearning?.promotedLessonIds?.length),
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
