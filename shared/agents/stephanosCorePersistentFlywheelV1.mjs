export const STEPHANOS_CORE_PERSISTENT_FLYWHEEL_SCHEMA = 'stephanos.core-persistent-flywheel.v1';
export const DEFAULT_PERSISTENT_FLYWHEEL_FALLBACK_MS = 60_000;
export const DEFAULT_OCTOPUS_SELF_HEAL_COOLDOWN_MS = 5 * 60_000;

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

export function projectOctopusSelfHealDecision(octopusSummary = {}, {
  nowMs = Date.now(),
  lastAttemptAtMs = null,
  cooldownMs = DEFAULT_OCTOPUS_SELF_HEAL_COOLDOWN_MS,
} = {}) {
  const now = finiteMs(nowMs) ?? Date.now();
  const lastAttempt = lastAttemptAtMs === null || lastAttemptAtMs === undefined
    ? null
    : finiteMs(lastAttemptAtMs);
  const cooldown = finiteMs(cooldownMs) ?? DEFAULT_OCTOPUS_SELF_HEAL_COOLDOWN_MS;
  const needsRepair = octopusSummary?.octopusNeedsRepair === true;

  if (!needsRepair) {
    return Object.freeze({
      shouldRepair: false,
      reason: 'OCTOPUS_SELF_HEAL_NOT_REQUIRED',
      retryAfterMs: 0,
    });
  }

  if (lastAttempt !== null && now - lastAttempt < cooldown) {
    return Object.freeze({
      shouldRepair: false,
      reason: 'OCTOPUS_SELF_HEAL_COOLDOWN_ACTIVE',
      retryAfterMs: Math.max(0, cooldown - (now - lastAttempt)),
    });
  }

  return Object.freeze({
    shouldRepair: true,
    reason: 'OCTOPUS_SELF_HEAL_REQUIRED',
    retryAfterMs: 0,
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

export function summarizeOctopusBuildProductivity(refillSummary = {}, {
  lastMaterialBuildAtUtc = '',
} = {}) {
  const materialActions = Number.isSafeInteger(Number(refillSummary?.refillMaterialActionsSucceeded))
    ? Math.max(0, Number(refillSummary.refillMaterialActionsSucceeded))
    : 0;
  const sweepAttempts = Number.isSafeInteger(Number(refillSummary?.refillSweepAttemptCount))
    ? Math.max(0, Number(refillSummary.refillSweepAttemptCount))
    : 0;
  const eligibleWorkRemaining = Number.isSafeInteger(Number(refillSummary?.refillSafeEligibleWorkRemaining))
    ? Math.max(0, Number(refillSummary.refillSafeEligibleWorkRemaining))
    : 0;
  const provenSafeFreeLanes = Number.isSafeInteger(Number(refillSummary?.refillProvenSafeFreeLanes))
    ? Math.max(0, Number(refillSummary.refillProvenSafeFreeLanes))
    : 0;
  const parkedLanes = Number.isSafeInteger(Number(refillSummary?.refillParkedLaneCount))
    ? Math.max(0, Number(refillSummary.refillParkedLaneCount))
    : 0;
  const degraded = text(refillSummary?.refillStatus).toUpperCase() === 'DEGRADED';
  const noRunnableWorkProven = refillSummary?.refillNoRunnableSourceWorkProven === true;
  const sweepExhausted = refillSummary?.refillWorkConservingSweepExhausted === true;

  let verdict = 'WAITING';
  if (materialActions > 0) verdict = 'BUILDING';
  else if (degraded) verdict = 'DEGRADED';
  else if (noRunnableWorkProven) verdict = 'IDLE_PROVEN';
  else if (parkedLanes > 0 && eligibleWorkRemaining === 0 && provenSafeFreeLanes === 0) verdict = 'PARKED';
  else if (eligibleWorkRemaining > 0 || provenSafeFreeLanes > 0 || sweepExhausted) verdict = 'STALLED_WITH_CAPACITY';

  return Object.freeze({
    octopusBuildVerdict: verdict,
    octopusBuildStallDetected: verdict === 'STALLED_WITH_CAPACITY',
    octopusNeedsRepair: verdict === 'STALLED_WITH_CAPACITY' || verdict === 'DEGRADED',
    octopusMaterialActionsLastCycle: materialActions,
    octopusSweepAttemptsLastCycle: sweepAttempts,
    octopusEligibleWorkRemaining: eligibleWorkRemaining,
    octopusProvenSafeFreeLanes: provenSafeFreeLanes,
    octopusParkedLaneCount: parkedLanes,
    octopusNoRunnableWorkProven: noRunnableWorkProven,
    octopusLastMaterialBuildAtUtc: text(lastMaterialBuildAtUtc),
    octopusProofSource: 'CANONICAL_GOAL_BUILD_REFILL',
  });
}
