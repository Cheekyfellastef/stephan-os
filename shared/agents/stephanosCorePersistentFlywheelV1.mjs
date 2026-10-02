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
