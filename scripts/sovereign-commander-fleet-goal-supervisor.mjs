#!/usr/bin/env node
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  FLEET_SUPERVISOR_ACTION, FLEET_SUPERVISOR_SCHEMA, FLEET_SUPERVISOR_MARKER,
  projectFleetConveyorObservationV1, projectFleetSupervisorReceiptV1,
  fleetSupervisorBlockerCodeV1,
} from '../shared/agents/sovereignCommanderFleetGoalSupervisorReceiptV1.mjs';
import { sovereignMaintenanceCustodyUnprovenV1, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER,
} from '../shared/agents/sovereignMaintenanceAdmissionV1.mjs';

import {
  ensureCriticalBacklogMission,
} from '../stephanos-server/services/criticalBacklogConveyorService.js';
import {
  reconcileSovereignCommanderCapabilityParity,
} from './sovereign-commander-capability-parity-reconcile.mjs';

export const SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_SCHEMA =
  FLEET_SUPERVISOR_SCHEMA;
export const SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_RESULT_MARKER =
  FLEET_SUPERVISOR_MARKER;

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
    pickupPendingCount: details.pickupPendingCount ?? null,
    provenPickupCount: details.provenPickupCount ?? null,
    heldGoalCount: integer(details.heldGoalCount),
    ...(details.conveyorObservation || projectFleetConveyorObservationV1()),
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
    nativeGapCandidateTotalCount: integer(details.commanderParity?.nativeGapIntake?.candidateTotalCount),
    flywheelLearningVerdict: text(details.commanderParity?.flywheelLearning?.finalVerdict),
    flywheelLearningPromotionCount: integer(details.commanderParity?.flywheelLearning?.promotedLessonIds?.length),
    zeroGapInvariantSatisfied: false,
    capabilityParityClosureRequired: true,
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
  // A successfully published external grant is not a worker pickup. Only an
  // explicitly proven, receipt-bound pickup can clear the pending count.
  const published = Array.isArray(ignition.dispatched) ? ignition.dispatched : [];
  const provenPickupCount = published.length === dispatchCount
    ? published.filter((item) => item?.pickupProven === true
      && typeof item?.pickupProofRef === 'string'
      && item.pickupProofRef.trim().length > 0).length
    : 0;
  const pickupPendingCount = Math.max(
    integer(ignition.pickupPendingCount),
    dispatchCount - provenPickupCount,
  );
  const heldGoalCount = count(ignition.held);
  const details = {
    activeMissionCount,
    runningMissionCount,
    runnableGoalCount,
    availableSlotCount,
    dispatchCount,
    pickupPendingCount,
    provenPickupCount,
    heldGoalCount,
    conveyorObservation: projectFleetConveyorObservationV1(conveyorResult),
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

  // A native skill gap is still real work even when Remote Commander parity is
  // already green. A draft alone never proves construction or live activation.
  // Reuse the canonical #2573 owner; never manufacture a parallel worker.
  const remoteParityGapCount = integer(commanderParity?.buildableGapCount);
  const compiledCapabilityWorkCount = integer(commanderParity?.capabilityCompiler?.buildableCapabilityCount);
  // The compiler admits only the first bounded batch; the retained backlog
  // is larger and must not be equated with completed or absent work.
  const nativeGapCandidateTotalCount = integer(commanderParity?.nativeGapIntake?.candidateTotalCount);
  const capabilityWorkRemainingCount = Math.max(
    remoteParityGapCount, compiledCapabilityWorkCount, nativeGapCandidateTotalCount,
  );
  const nativeCapabilityWorkPending = nativeGapCandidateTotalCount > 0
    || compiledCapabilityWorkCount > remoteParityGapCount;
  const nativeGapSourceDegraded = commanderParity?.nativeGapSourceHealth === 'DEGRADED';

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
    pickupPendingCount,
    provenPickupCount,
    heldGoalCount,
    ...projectFleetConveyorObservationV1(conveyorResult),
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
    nativeGapCandidateTotalCount,
    flywheelLearningVerdict: text(commanderParity?.flywheelLearning?.finalVerdict),
    flywheelLearningPromotionCount: integer(commanderParity?.flywheelLearning?.promotedLessonIds?.length),
    capabilityWorkRemainingCount,
    nativeCapabilityWorkPending,
    nativeGapSourceHealth: text(commanderParity?.nativeGapSourceHealth),
    zeroGapInvariantSatisfied: capabilityWorkRemainingCount === 0 && !nativeGapSourceDegraded,
    capabilityParityClosureRequired: capabilityWorkRemainingCount > 0 || nativeGapSourceDegraded,
    daemonMayReportGreen: capabilityWorkRemainingCount === 0
      && !nativeGapSourceDegraded && pickupPendingCount === 0,
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
    finalVerdict: nativeGapSourceDegraded
      ? 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_NATIVE_INTAKE_UNVERIFIED'
      : nativeCapabilityWorkPending
      ? 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_NATIVE_UPLIFT_PENDING'
      : pickupPendingCount > 0
      ? 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_PICKUP_PENDING'
      : remoteParityGapCount > 0
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

// Commander captures the first 16 KiB of child stdout. Preserve the full private
// function result above, but keep this established CLI terminal record bounded.
// Never drop negative custody evidence while removing large parity inventories.
export function serializeFleetSupervisorTerminalV1(result) {
  const status = result?.ok === true ? 0 : 2;
  const projected = projectFleetSupervisorReceiptV1(result, status);
  const custodyHeld = sovereignMaintenanceCustodyUnprovenV1(
    { status }, result, FLEET_SUPERVISOR_ACTION,
  );
  // The complete shared projection, not just the outer protocol shape, owns
  // validity. Fallback bytes must never promote rejected evidence to success.
  const terminalValid = projected !== null;
  const fallback = {
    schemaVersion: FLEET_SUPERVISOR_SCHEMA, ok: result?.ok === true,
    finalVerdict: result?.finalVerdict,
    blockerCode: fleetSupervisorBlockerCodeV1(result?.ok, result?.blocker),
    ...projectFleetConveyorObservationV1(),
    activeMissionCount: null, runningMissionCount: null, runnableGoalCount: null,
    availableSlotCount: null, dispatchCount: null, pickupPendingCount: null,
    provenPickupCount: null, heldGoalCount: null,
    duplicateSchedulerAllowed: false, duplicateLeaseAllowed: false,
    mergeAuthority: false, runtimeMutationAuthority: false, arbitraryShellAllowed: false,
  };
  const terminal = {
    ...(projected || fallback),
    ...(custodyHeld ? { ok: false, finalVerdict: 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_BLOCKED',
      blockerCode: SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER } : {}),
    ...(!custodyHeld && !terminalValid ? { ok: false,
      finalVerdict: 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_PROTOCOL_INVALID' } : {}),
    blocker: custodyHeld ? SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER
      : !terminalValid ? 'FLEET_SUPERVISOR_TERMINAL_RECEIPT_INVALID'
      : typeof result?.blocker === 'string' && result.blocker.length <= 160
        ? result.blocker : 'FLEET_SUPERVISOR_REPORTED_BLOCKED',
    // These private scalars are consumed by the existing goal-builder repair.
    // The public projection deliberately excludes them and any raw blocker.
    capabilityCompilerWorkCount: Number.isSafeInteger(result?.capabilityCompilerWorkCount)
      && result.capabilityCompilerWorkCount >= 0 ? result.capabilityCompilerWorkCount : null,
    nativeGapCandidateTotalCount: Number.isSafeInteger(result?.nativeGapCandidateTotalCount)
      && result.nativeGapCandidateTotalCount >= 0 ? result.nativeGapCandidateTotalCount : null,
    nativeGapSourceHealth: typeof result?.nativeGapSourceHealth === 'string'
      ? result.nativeGapSourceHealth.slice(0, 80) : 'UNKNOWN',
    daemonMayReportGreen: !custodyHeld && terminalValid && result?.daemonMayReportGreen === true,
  };
  return Object.freeze({
    stdout: `${FLEET_SUPERVISOR_MARKER}${JSON.stringify(terminal)}\n`,
    exitCode: terminal.ok ? 0 : 2,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runSovereignCommanderFleetGoalSupervisor();
  const terminal = serializeFleetSupervisorTerminalV1(result);
  process.stdout.write(terminal.stdout);
  process.exitCode = terminal.exitCode;
}
