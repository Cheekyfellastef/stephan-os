export const STEPHANOS_CORE_PERSISTENT_FLYWHEEL_SCHEMA = 'stephanos.core-persistent-flywheel.v1';
export const DEFAULT_PERSISTENT_FLYWHEEL_FALLBACK_MS = 60_000;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function finiteMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function boundedText(value, max = 120) {
  return text(value).slice(0, max);
}

export function projectPersistentFlywheelTrigger(input = {}) {
  const nowMs = finiteMs(input.nowMs) ?? Date.now();
  const fallbackMs = finiteMs(input.fallbackMs) ?? DEFAULT_PERSISTENT_FLYWHEEL_FALLBACK_MS;
  const lastCycleAtMs = finiteMs(input.lastCycleAtMs);
  const currentFingerprint = text(input.eventFingerprint);
  const previousFingerprint = text(input.lastEventFingerprint);
  const cycleRunning = input.cycleRunning === true;
  const eventChanged = Boolean(currentFingerprint) && currentFingerprint !== previousFingerprint;
  const fallbackDue = lastCycleAtMs === null || nowMs - lastCycleAtMs >= fallbackMs;

  if (cycleRunning) {
    return Object.freeze({
      schemaVersion: STEPHANOS_CORE_PERSISTENT_FLYWHEEL_SCHEMA,
      shouldRun: false,
      reason: 'PERSISTENT_FLYWHEEL_SINGLE_FLIGHT_ACTIVE',
      eventChanged,
      fallbackDue,
      fallbackMs,
    });
  }
  if (eventChanged) {
    return Object.freeze({
      schemaVersion: STEPHANOS_CORE_PERSISTENT_FLYWHEEL_SCHEMA,
      shouldRun: true,
      reason: 'PERSISTENT_FLYWHEEL_DURABLE_STATE_CHANGED',
      eventChanged: true,
      fallbackDue,
      fallbackMs,
    });
  }
  if (fallbackDue) {
    return Object.freeze({
      schemaVersion: STEPHANOS_CORE_PERSISTENT_FLYWHEEL_SCHEMA,
      shouldRun: true,
      reason: 'PERSISTENT_FLYWHEEL_FALLBACK_RECONCILIATION_DUE',
      eventChanged: false,
      fallbackDue: true,
      fallbackMs,
    });
  }
  return Object.freeze({
    schemaVersion: STEPHANOS_CORE_PERSISTENT_FLYWHEEL_SCHEMA,
    shouldRun: false,
    reason: 'PERSISTENT_FLYWHEEL_WAITING_FOR_EVENT_OR_FALLBACK',
    eventChanged: false,
    fallbackDue: false,
    fallbackMs,
  });
}

export function summarizePersistentFlywheelResult(result = {}) {
  const blockers = Array.isArray(result?.blockers) ? result.blockers : [];
  return Object.freeze({
    schemaVersion: STEPHANOS_CORE_PERSISTENT_FLYWHEEL_SCHEMA,
    status: boundedText(result?.status, 40) || 'UNKNOWN',
    action: boundedText(result?.action, 100) || 'NONE',
    blockerCount: blockers.length,
    allowWorkerTick: result?.allowWorkerTick === true,
    boundedMutationSteps: Number.isSafeInteger(result?.boundedMutationSteps)
      ? Math.max(0, result.boundedMutationSteps)
      : 0,
    sourceRevision: /^[0-9a-f]{40}$/i.test(text(result?.sourceRevision))
      ? text(result.sourceRevision).toLowerCase()
      : '',
    safeSummaryOnly: true,
  });
}

export function summarizeLogicalGoalControllerFabric(result = {}, targetMaterialLanes = 15) {
  const fabric = result?.authoritativeProjection?.logicalGoalControllerFabric;
  const controllers = Array.isArray(fabric?.controllers)
    ? fabric.controllers.filter((controller) => controller?.retired !== true)
    : [];
  const valid = fabric?.valid === true;
  const active = valid ? controllers.filter((controller) => controller?.continuityState === 'ACTIVE').length : 0;
  const tracking = valid ? controllers.filter((controller) => controller?.continuityState === 'TRACKING').length : 0;
  const parked = valid ? controllers.filter((controller) => controller?.continuityState === 'PARKED').length : 0;
  const selected = valid ? controllers.filter((controller) => controller?.selectedForAdmission === true).length : 0;
  const target = Number.isSafeInteger(Number(targetMaterialLanes))
    ? Math.max(1, Number(targetMaterialLanes))
    : 15;
  return Object.freeze({
    logicalLaneTruth: valid ? 'CURRENT' : 'UNKNOWN',
    logicalControllerCount: valid ? controllers.length : 0,
    logicalActiveLaneCount: active,
    logicalTrackingLaneCount: tracking,
    logicalParkedLaneCount: parked,
    logicalSelectedForAdmissionCount: selected,
    targetMaterialLanes: target,
    logicalLaneDeficitToTarget: valid ? Math.max(0, target - active) : null,
  });
}

export function summarizePersistentRefillSweep(result = {}) {
  const cycleDecision = result?.cycleDecision || {};
  return Object.freeze({
    refillStatus: result?.ok === true ? 'READY' : 'DEGRADED',
    refillMaterialActionsSucceeded: Number.isSafeInteger(Number(result?.materialActionsSucceeded))
      ? Math.max(0, Number(result.materialActionsSucceeded))
      : 0,
    refillSweepAttemptCount: Number.isSafeInteger(Number(result?.sweepAttemptCount))
      ? Math.max(0, Number(result.sweepAttemptCount))
      : 0,
    refillSafeEligibleWorkRemaining: Number.isSafeInteger(Number(cycleDecision?.safeEligibleWorkRemaining))
      ? Math.max(0, Number(cycleDecision.safeEligibleWorkRemaining))
      : 0,
    refillProvenSafeFreeLanes: Number.isSafeInteger(Number(cycleDecision?.provenSafeFreeLanes))
      ? Math.max(0, Number(cycleDecision.provenSafeFreeLanes))
      : 0,
    refillNoRunnableSourceWorkProven: result?.noRunnableSourceWorkProven === true,
    refillWorkConservingSweepExhausted: result?.workConservingSweepExhausted === true,
    refillParkedLaneCount: Array.isArray(result?.parkedLaneBlockers) ? result.parkedLaneBlockers.length : 0,
    refillFinalVerdict: boundedText(result?.finalVerdict, 120) || 'UNKNOWN',
  });
}
