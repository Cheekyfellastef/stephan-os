#!/usr/bin/env node
import { inspectStephanosNativeCapacityGamingAdmissionV1 } from '../shared/agents/stephanosNativeCapacityGamingAdmissionV1.mjs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readCanonicalMissionWorkerHeartbeatAgeMs as readGoalBuilderWorkerHeartbeatAgeMs,
  canonicalMissionWorkerEvidenceAllowsWork } from '../shared/agents/canonicalMissionWorkerEvidenceV1.mjs';
export { readCanonicalMissionWorkerHeartbeatAgeMs as readGoalBuilderWorkerHeartbeatAgeMs,
  readCanonicalMissionWorkerSourceIdentity as readGoalBuilderSourceIdentity } from '../shared/agents/canonicalMissionWorkerEvidenceV1.mjs';

export const SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_SCHEMA =
  'stephanos.sovereign-commander-goal-builder-repair.v1';
export const SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_MARKER =
  'SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_RESULT=';
const CONTROLLER_LANE_STATUS_MARKER =
  'SOVEREIGN_COMMANDER_CONTROLLER_LANE_STATUS_RESULT=';
const FLEET_GOAL_SUPERVISOR_MARKER =
  'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_RESULT=';
const SAFE_BLOCKER = /^[A-Z0-9][A-Z0-9._:-]{0,159}$/;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;

const STEPS = Object.freeze({
  supervisor: Object.freeze({
    id: 'fleet-goal-supervisor',
    executable: node,
    args: Object.freeze([resolve(repoRoot, 'scripts', 'sovereign-commander-fleet-goal-supervisor.mjs')]),
    timeoutMs: 25_000,
  }),
  controllerLaneStatus: Object.freeze({
    id: 'controller-lane-status',
    executable: node,
    // The repair's observation is read-only. The periodic status publisher
    // owns Shared Workspace writes; do not wait on them inside the mailbox.
    args: Object.freeze([resolve(repoRoot, 'scripts', 'sovereign-controller-lane-status.mjs'), '--snapshot-only']),
    timeoutMs: 20_000,
  }),
  goalHeartbeat: Object.freeze({
    id: 'goal-discovery-heartbeat',
    executable: node,
    args: Object.freeze([resolve(repoRoot, 'scripts', 'battle-bridge-goal-discovery-heartbeat.mjs')]),
    timeoutMs: 25_000,
  }),
});

function text(value) {
  return String(value ?? '').trim();
}

function safeStructuredBlocker(stdout) {
  const raw = text(stdout);
  if (!raw) return '';
  const lines = [raw, ...raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse()];
  for (const line of lines) {
    const candidates = line.includes('=') ? [line, line.slice(line.indexOf('=') + 1)] : [line];
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        const blocker = text(parsed?.blocker);
        if (SAFE_BLOCKER.test(blocker)) return blocker;
      } catch {}
    }
  }
  return '';
}

function parseControllerLaneStatus(result) {
  if (result?.ok !== true) return null;
  const stdout = text(result?.stdout);
  const markerIndex = stdout.lastIndexOf(CONTROLLER_LANE_STATUS_MARKER);
  if (markerIndex < 0) return null;
  const payload = stdout.slice(markerIndex + CONTROLLER_LANE_STATUS_MARKER.length).trim().split(/\r?\n/)[0];
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseSupervisorStatus(result) {
  // The fixed supervisor deliberately exits 2 for a complete BLOCKED report.
  // Keep that negative evidence: dropping it retries worker/discovery mutation
  // under an incumbent source-custody hold. Timeout/transport failure is not
  // a terminal supervisor report and must not take this recovery shortcut.
  const completedBlocked = result?.ok === false && result?.status === 2;
  if (result?.ok !== true && !completedBlocked) return null;
  const stdout = text(result?.stdout);
  const markerIndex = stdout.lastIndexOf(FLEET_GOAL_SUPERVISOR_MARKER);
  if (markerIndex < 0) return null;
  const payload = stdout.slice(markerIndex + FLEET_GOAL_SUPERVISOR_MARKER.length).trim().split(/\r?\n/)[0];
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || parsed.schemaVersion !== 'stephanos.sovereign-commander-fleet-goal-supervisor.v1') return null;
    if (completedBlocked && (parsed.ok !== false
      || parsed.finalVerdict !== 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_BLOCKED'
      || !SAFE_BLOCKER.test(text(parsed.blocker))
      || (text(result.errorCode) && text(result.errorCode) !== text(parsed.blocker)))) return null;
    return parsed;
  } catch {
    return null;
  }
}

// A new Mission Worker cannot reconstruct a missing terminal receipt from the
// historical #2962 source writer. Repeated start/discovery calls under that
// specific HOLD just re-enter the damaged segment. Hand the case back to the
// existing original-owner quarantine and exact lease reconciler instead.
const ORIGINAL_OWNER_RECOVERY_BLOCKERS = new Set([
  'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING',
  'REPAIR_ORIGINAL_TERMINAL_SOURCE_BINDING_UNPROVEN',
  'REPAIR_ORIGINAL_EXECUTION_HISTORY_UNVERIFIED',
  'REPAIR_ORIGINAL_TERMINAL_PAIR_PRESENT_RECEIPT_MISSING',
  'REPAIR_ORIGINAL_WORK_STILL_IN_FLIGHT',
  'CANCELLED_ORIGINAL_SOURCE_FENCE_REQUIRED',
  'ORIGINAL_SOURCE_FENCE_PROOF_UNVERIFIED',
]);

function originalOwnerRecoveryBlocker(result) {
  const status = parseSupervisorStatus(result);
  const blocker = text(status?.blocker).toUpperCase();
  return ORIGINAL_OWNER_RECOVERY_BLOCKERS.has(blocker) ? blocker : '';
}

function supervisorHasUnprovenDispatch(status) {
  const dispatchCount = status?.dispatchCount;
  if (!Number.isSafeInteger(dispatchCount) || dispatchCount <= 0) return false;
  // Never accept a self-reported pending=0 on its own, especially from a
  // pre-upgrade supervisor. Match the number of receipt-proven pickups too.
  return !Number.isSafeInteger(status?.pickupPendingCount)
    || status.pickupPendingCount > 0
    || !Number.isSafeInteger(status?.provenPickupCount)
    || status.provenPickupCount !== dispatchCount;
}

function supervisorFlowGreen(result) {
  const status = parseSupervisorStatus(result);
  if (result?.ok !== true || status?.ok !== true) return false;
  // A native capability draft has no proven pickup merely because a different
  // mission was dispatched or a goal was held. Keep this gap non-green until
  // the exact capability itself has qualified and executed.
  if (Number.isSafeInteger(status.capabilityCompilerWorkCount)
      && status.capabilityCompilerWorkCount > 0) return false;
  // A compiler batch limit is never proof that older native requests vanished.
  if (Number.isSafeInteger(status.nativeGapCandidateTotalCount)
      && status.nativeGapCandidateTotalCount > 0) return false;
  if (status.nativeGapSourceHealth === 'DEGRADED') return false;
  // A grant is never execution without a matching verified pickup count.
  if (supervisorHasUnprovenDispatch(status)) return false;
  const autonomyPending = status?.daemonMayReportGreen === false;
  const autonomousWorkActive = Number(status?.dispatchCount) > 0
    || Number(status?.runningMissionCount) > 0;
  const heldWorkExplained = Number(status?.heldGoalCount) > 0;
  return !autonomyPending || autonomousWorkActive || heldWorkExplained;
}

function supervisorFlowBlocker(result) {
  const status = parseSupervisorStatus(result);
  if (status?.nativeGapSourceHealth === 'DEGRADED') return 'NATIVE_GAP_INTAKE_UNVERIFIED';
  if (Number.isSafeInteger(status?.nativeGapCandidateTotalCount)
      && status.nativeGapCandidateTotalCount > 0) return 'NATIVE_UPLIFT_PENDING';
  if (Number.isSafeInteger(status?.capabilityCompilerWorkCount)
      && status.capabilityCompilerWorkCount > 0) return 'NATIVE_UPLIFT_PENDING';
  if (supervisorHasUnprovenDispatch(status)) return 'GOAL_DISPATCH_PICKUP_UNPROVEN';
  const blocker = text(status?.blocker);
  if (SAFE_BLOCKER.test(blocker)) return blocker;
  const verdict = text(status?.finalVerdict);
  if (SAFE_BLOCKER.test(verdict) && !supervisorFlowGreen(result)) return verdict;
  return result?.ok === true
    ? 'FLEET_GOAL_SUPERVISOR_AUTONOMY_UNPROVEN'
    : text(result?.errorCode) || 'FLEET_GOAL_SUPERVISOR_READ_FAILED';
}

function laneStatusGreen(result) {
  const status = parseControllerLaneStatus(result);
  if (status?.ok !== true) return false;
  const refillHealth = text(status?.lanes?.refillHealth).toUpperCase();
  const refillState = text(status?.lanes?.refillState).toUpperCase();
  const finalVerdict = text(status?.finalVerdict).toUpperCase();
  // A green headline cannot override missing physical pickup for selected goals.
  // The same pickup gate applies to both green and stale-telemetry projections.
  const selectedCount = status?.logical?.selectedForAdmission;
  const selectedPickupCount = status?.lanes?.selectedMaterialPickupProvenCount;
  const selectedCountValid = Number.isSafeInteger(selectedCount) && selectedCount >= 0;
  const allSelectedPickupProven = selectedCountValid
    && (selectedCount === 0
      || (Number.isSafeInteger(selectedPickupCount)
        && selectedPickupCount === selectedCount));
  if (!allSelectedPickupProven) return false;
  if (
    finalVerdict === 'SOVEREIGN_CONTROLLER_LANE_STATUS_READY'
    && refillHealth === 'GREEN'
  ) return true;

  // Physical ChatGPT controllers are continuity hosts, not source-mutation
  // owners. If only their evidence is stale, a current/valid logical fabric
  // with no current hard-red host and no current runnable-work claim remains
  // safe for the canonical scheduler + mission worker to operate.
  // The same per-selected-goal proof applies to stale-host tolerance;
  // it cannot be satisfied by an unrelated occupied material lane.
  const noUnprovenSelectedPickup = allSelectedPickupProven;
  return finalVerdict === 'SOVEREIGN_CONTROLLER_LANE_STATUS_REFILL_OR_EVIDENCE_REQUIRED'
    && refillHealth === 'AMBER'
    && refillState === 'TELEMETRY_STALE_OR_INCOMPLETE'
    && noUnprovenSelectedPickup
    && status?.logical?.current === true
    && status?.logical?.valid === true
    && text(status?.logical?.finalVerdict).toUpperCase() === 'LOGICAL_GOAL_CONTROLLER_FABRIC_READY'
    && Number(status?.lanes?.currentPhysicalHardRedCount || 0) === 0
    && Number(status?.lanes?.runnableBacklogCount || 0) === 0;
}

function laneStatusBlocker(result) {
  const status = parseControllerLaneStatus(result);
  if (Number.isSafeInteger(status?.logical?.selectedForAdmission)
      && status.logical.selectedForAdmission > 0
      && status?.lanes?.selectedMaterialPickupProvenCount !== status.logical.selectedForAdmission) {
    return 'LOGICAL_GOAL_MATERIAL_PICKUP_UNPROVEN';
  }
  const refillState = text(status?.lanes?.refillState);
  if (SAFE_BLOCKER.test(refillState) && refillState !== 'NO_SAFE_ELIGIBLE_WORK_REPORTED') return refillState;
  const verdict = text(status?.finalVerdict);
  if (SAFE_BLOCKER.test(verdict) && verdict !== 'SOVEREIGN_CONTROLLER_LANE_STATUS_READY') return verdict;
  return result?.ok === true ? 'CONTROLLER_LANE_STATUS_UNPROVEN' : text(result?.errorCode) || 'CONTROLLER_LANE_STATUS_READ_FAILED';
}

function compactStep(step, result) {
  return Object.freeze({
    actionId: step.id,
    ok: result?.ok === true,
    status: Number.isInteger(result?.status) ? result.status : null,
    errorCode: text(result?.errorCode).slice(0, 120),
  });
}

export function runFixedGoalBuilderRepairStep(step) {
  // The goal-heartbeat step may launch descendants on Windows.
  // If those descendants inherit the synchronous caller's stdout/stderr pipes,
  // Node can remain blocked waiting for pipe EOF even after the bounded direct
  // child has timed out. Keep proof-producing observation steps captured, but
  // make that mutating repair step pipe-free so timeout always terminalizes.
  const pipeFreeChild = step === STEPS.goalHeartbeat;
  const captureOutput = !pipeFreeChild;
  const result = spawnSync(step.executable, [...step.args], {
    ...(captureOutput ? { encoding: 'utf8' } : {}),
    stdio: pipeFreeChild
      ? ['ignore', 'ignore', 'ignore']
      : ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
    timeout: step.timeoutMs,
    maxBuffer: 256 * 1024,
  });
  return Object.freeze({
    ok: !result?.error && Number(result?.status) === 0,
    status: Number.isInteger(result?.status) ? result.status : null,
    stdout: captureOutput ? String(result?.stdout || '') : '',
    errorCode: text(
      result?.error?.code
      || result?.error?.message
      || (captureOutput ? safeStructuredBlocker(result?.stdout) : ''),
    ),
  });
}

export function runSovereignCommanderGoalBuilderRepair({
  runStep = runFixedGoalBuilderRepairStep,
  readResourceAdmission,
  readWorkerHeartbeatAgeMs = readGoalBuilderWorkerHeartbeatAgeMs,
} = {}) {
  const steps = [];
  const resourceAllowed = () => {
    try {
      if (readResourceAdmission) return readResourceAdmission()?.ok === true;
      if (runStep !== runFixedGoalBuilderRepairStep) return true; // isolated step fixtures only
      return inspectStephanosNativeCapacityGamingAdmissionV1({
        workspaceRoot: 'C:\\Users\\Stephan Callear\\Documents\\Stephanos-openclaw-workspace', repoRoot,
      }).ok === true;
    } catch { return false; }
  };
  const resourceHold = () => Object.freeze({ok:false,schemaVersion:SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_SCHEMA,
    repairApplied:steps.length>0,blocker:'SOVEREIGN_GOAL_BUILDER_RESOURCE_GOVERNOR_HOLD',
    steps:Object.freeze(steps),canonicalGoalFabricOnly:true,duplicateSchedulerAllowed:false,
    mergeAuthority:false,arbitraryShellAllowed:false,finalVerdict:'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_BLOCKED'});
  const workerAllowed = () => {
    try {
      const age = readWorkerHeartbeatAgeMs();
      return canonicalMissionWorkerEvidenceAllowsWork(age);
    } catch { return false; }
  };
  const workerHold = () => Object.freeze({ ok: false, schemaVersion: SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_SCHEMA,
    repairApplied: steps.length > 0, blocker: 'MISSION_WORKER_CUSTODY_UNPROVEN', steps: Object.freeze(steps),
    canonicalGoalFabricOnly: true, duplicateSchedulerAllowed: false, mergeAuthority: false,
    arbitraryShellAllowed: false, finalVerdict: 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_BLOCKED' });
  // The supervisor can itself reconcile/dispatch. Check before the first step,
  // then sample again at each subsequent mutation boundary.
  if (!workerAllowed()) return workerHold();
  if (!resourceAllowed()) return resourceHold();
  const initialSupervisor = runStep(STEPS.supervisor);
  steps.push(compactStep(STEPS.supervisor, initialSupervisor));
  if (!resourceAllowed()) return resourceHold();
  const initialLaneStatus = runStep(STEPS.controllerLaneStatus);
  steps.push(compactStep(STEPS.controllerLaneStatus, initialLaneStatus));

  const originalHold = originalOwnerRecoveryBlocker(initialSupervisor);
  if (originalHold) {
    // This is a fail-closed repair handoff, not a second scheduler or source
    // writer. Only the established #2961/#2962 original-owner path can
    // commission the physical Windows exclusion proof and reconcile r7.
    return Object.freeze({
      ok: false,
      schemaVersion: SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_SCHEMA,
      repairApplied: false,
      blocker: originalHold,
      steps: Object.freeze(steps),
      recoveryOwner: '#2961',
      originalSourceLeaseHeld: true,
      nextAutomaticAction: 'PROVE_ORIGINAL_WRITER_EXCLUSION_AND_RECONCILE_CANONICAL_LEASE',
      canonicalGoalFabricOnly: true,
      sourceMutationDelegatedToMissionWorker: true,
      duplicateSchedulerAllowed: false,
      leaseSeizureAllowed: false,
      mergeAuthority: false,
      arbitraryShellAllowed: false,
      finalVerdict: 'SOVEREIGN_GOAL_BUILDER_ORIGINAL_OWNER_RECOVERY_REQUIRED',
    });
  }

  if (!workerAllowed()) return workerHold();
  if (supervisorFlowGreen(initialSupervisor) && laneStatusGreen(initialLaneStatus)) {
    return Object.freeze({
      ok: true,
      schemaVersion: SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_SCHEMA,
      repairApplied: false,
      steps: Object.freeze(steps),
      canonicalGoalFabricOnly: true,
      sourceMutationDelegatedToMissionWorker: true,
      duplicateSchedulerAllowed: false,
      mergeAuthority: false,
      arbitraryShellAllowed: false,
      finalVerdict: 'SOVEREIGN_GOAL_BUILDER_FLOW_ALREADY_GREEN',
    });
  }

  // This action executes through the canonical mailbox, so it must never try to
  // repair or reinstall that same control plane while holding the mailbox lease.
  // Independent lifeboat/recovery routes own control-plane recovery. This repair
  // is intentionally scoped to the builder fabric it can safely heal in-band.
  // ALL callers (Core, guardian, mailbox and direct maintenance) meet at this
  // shared boundary. Heartbeat loss is never permission to start another
  // worker; only its qualified lifecycle owner can recover missing custody.
  let heartbeatFailure = null;
  for (const step of [STEPS.goalHeartbeat]) {
    if (!resourceAllowed()) return resourceHold();
    const result = runStep(step);
    steps.push(compactStep(step, result));
    if (result?.ok !== true) {
      const explicitBlocker = text(result?.errorCode);
      heartbeatFailure = Object.freeze({
        actionId: step.id,
        blocker: explicitBlocker || `${step.id.toUpperCase().replace(/-/g, '_')}_TERMINAL_FAILURE`,
        explicitBlocker: Boolean(explicitBlocker),
      });
      break;
    }
  }

  // A failed mutating heartbeat must not hide the two safe read-only terminal
  // observations. They often contain the exact admission/claim/pickup blocker
  // that the pipe-free Windows child cannot return directly.
  if (!workerAllowed()) return Object.freeze({ ...workerHold(), repairApplied: true });
  if (!resourceAllowed()) return resourceHold();
  const finalSupervisor = runStep(STEPS.supervisor);
  steps.push(compactStep(STEPS.supervisor, finalSupervisor));
  if (!resourceAllowed()) return resourceHold();
  const finalLaneStatus = runStep(STEPS.controllerLaneStatus);
  steps.push(compactStep(STEPS.controllerLaneStatus, finalLaneStatus));
  const supervisorGreen = supervisorFlowGreen(finalSupervisor);
  const laneGreen = laneStatusGreen(finalLaneStatus);
  const green = heartbeatFailure === null && supervisorGreen && laneGreen;
  const supervisorBlocker = supervisorGreen ? '' : supervisorFlowBlocker(finalSupervisor);
  const laneBlocker = laneGreen ? '' : laneStatusBlocker(finalLaneStatus);
  const genericReadbackBlockers = new Set([
    'FLEET_GOAL_SUPERVISOR_AUTONOMY_UNPROVEN',
    'FLEET_GOAL_SUPERVISOR_READ_FAILED',
    'CONTROLLER_LANE_STATUS_UNPROVEN',
    'CONTROLLER_LANE_STATUS_READ_FAILED',
  ]);
  const specificReadbackBlocker = [supervisorBlocker, laneBlocker]
    .find((blocker) => blocker && !genericReadbackBlockers.has(blocker)) || '';
  const blocker = green
    ? ''
    : heartbeatFailure?.explicitBlocker
      ? heartbeatFailure.blocker
      : specificReadbackBlocker
        || heartbeatFailure?.blocker
        || supervisorBlocker
        || laneBlocker
        || 'GOAL_BUILDER_REPAIR_TERMINAL_STATE_UNPROVEN';
  return Object.freeze({
    ok: green,
    schemaVersion: SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_SCHEMA,
    repairApplied: true,
    blocker,
    repairStepFailure: heartbeatFailure,
    steps: Object.freeze(steps),
    canonicalGoalFabricOnly: true,
    sourceMutationDelegatedToMissionWorker: true,
    duplicateSchedulerAllowed: false,
    mergeAuthority: false,
    arbitraryShellAllowed: false,
    finalVerdict: green
      ? 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_GREEN'
      : 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_BLOCKED',
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runSovereignCommanderGoalBuilderRepair();
  process.stdout.write(
    `${SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_MARKER}${JSON.stringify(result)}\n`,
  );
  process.exitCode = result.ok ? 0 : 2;
}
