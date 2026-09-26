import { buildCodexCapacityProjection } from './codexCapacityGovernorV1.mjs';

export const CODEX_CAPACITY_DASHBOARD_SCHEMA_VERSION = 'stephanos.codex-capacity-dashboard.v1';

export const CODEX_METER_VISIBILITY_STATE = Object.freeze({
  DIRECT: 'DIRECT',
  INFERRED: 'INFERRED',
  STALE: 'STALE',
  UNKNOWN: 'UNKNOWN',
});

function rounded(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100) / 100;
}

function normalizedSource(value) {
  return String(value || '').trim().toLowerCase();
}

function meterVisibilityState(capacity = {}) {
  const truth = capacity.meterTruth || {};
  const observation = capacity.observation || {};
  if (truth.complete !== true) return CODEX_METER_VISIBILITY_STATE.UNKNOWN;
  if (truth.fresh !== true) return CODEX_METER_VISIBILITY_STATE.STALE;
  const source = normalizedSource(observation.source);
  const explicitlyInferred = /infer|estimate|heuristic|projection/.test(source);
  const highConfidence = observation.confidence === 'high';
  return highConfidence && !explicitlyInferred
    ? CODEX_METER_VISIBILITY_STATE.DIRECT
    : CODEX_METER_VISIBILITY_STATE.INFERRED;
}

function visibilitySummary(capacity, visibilityState) {
  const ageMinutes = rounded(capacity.meterTruth?.ageMinutes);
  if (visibilityState === CODEX_METER_VISIBILITY_STATE.UNKNOWN) {
    return 'Codex meter visibility is incomplete. No remaining percentage is claimed; keep safe zero-cost lanes moving until a fresh direct observation arrives.';
  }
  if (visibilityState === CODEX_METER_VISIBILITY_STATE.STALE) {
    return `Codex meter visibility is stale${ageMinutes === null ? '' : ` (${ageMinutes} minutes old)`}. Do not dispatch Codex until it is refreshed.`;
  }
  if (visibilityState === CODEX_METER_VISIBILITY_STATE.INFERRED) {
    return 'Codex capacity is inferred rather than high-confidence direct truth. Preserve reserves and refresh the meter before authority-bearing dispatch.';
  }
  return '';
}

export function buildCodexCapacityDashboardProjection(input = {}) {
  const capacity = input.capacityProjection || buildCodexCapacityProjection(input);
  const nextReset = capacity.resetPlan?.selectedReset || null;
  const nextTask = capacity.nextCodexTask || null;
  const visibilityState = meterVisibilityState(capacity);
  const visibilityWarning = visibilitySummary(capacity, visibilityState);
  const meterComplete = capacity.meterTruth?.complete === true;
  const summary = visibilityWarning || (capacity.resetPlan?.action
    ? `Codex is waiting for the earliest-expiring banked reset ${capacity.resetPlan.action.resetId} before the next high-value task.`
    : (capacity.dispatchAllowed
      ? `Codex has ${rounded(capacity.safelySchedulablePercent)}% safely schedulable capacity after reserves.`
      : capacity.reason));
  return Object.freeze({
    schemaVersion: CODEX_CAPACITY_DASHBOARD_SCHEMA_VERSION,
    kind: 'stephanos.codex_capacity.dashboard_projection',
    readOnly: true,
    meter: Object.freeze({
      visibilityState,
      availability: capacity.observation.availability,
      availabilityObserved: capacity.observation.availabilityObserved === true,
      remainingPercent: meterComplete ? rounded(capacity.observation.remainingPercent) : null,
      remainingPercentObserved: capacity.observation.remainingPercentObserved === true,
      safelySchedulablePercent: meterComplete ? rounded(capacity.safelySchedulablePercent) : null,
      reservedPercent: rounded(capacity.reservedPercent),
      naturalResetAtUtc: capacity.observation.naturalResetAtUtc,
      observedAtUtc: capacity.observation.observedAtUtc,
      ageMinutes: rounded(capacity.meterTruth?.ageMinutes),
      source: capacity.observation.source,
      confidence: capacity.observation.confidence,
      complete: meterComplete,
      trusted: capacity.meterTruth?.trusted === true,
      blocker: capacity.meterTruth?.trusted === true ? '' : capacity.reason,
    }),
    bankedResets: Object.freeze({
      count: capacity.observation.bankedResets.length,
      nextResetId: nextReset?.resetId || '',
      nextExpiryUtc: nextReset?.expiresAtUtc || '',
      decision: capacity.resetPlan.decision,
      actionReady: Boolean(capacity.resetPlan.action),
    }),
    forecast: Object.freeze({
      queuedCodexDemandPercent: rounded(capacity.queuedCodexDemandPercent),
      shortfallPercent: meterComplete ? rounded(capacity.shortfallPercent) : null,
      queuedZeroCostTasks: capacity.queuedZeroCostTasks,
      nextTaskId: nextTask?.taskId || '',
      nextTaskP80Percent: rounded(nextTask?.p80Percent),
      selectedRoute: capacity.selectedRoute,
      dispatchAllowed: capacity.dispatchAllowed,
    }),
    stackVelocity: Object.freeze({
      currentSlicesPerWeek: rounded(capacity.stackVelocity.currentSlicesPerWeek),
      withoutCodexSlicesPerWeek: rounded(capacity.stackVelocity.withoutCodexSlicesPerWeek),
      withOpenClawUpgradeSlicesPerWeek: rounded(capacity.stackVelocity.withOpenClawUpgradeSlicesPerWeek),
      primaryConstraint: capacity.stackVelocity.primaryConstraint,
      confidence: capacity.stackVelocity.confidence,
    }),
    summary,
    exactNextAction: capacity.exactNextAction,
    finalVerdict: 'CODEX_CAPACITY_DASHBOARD_PROJECTION_READY',
  });
}
