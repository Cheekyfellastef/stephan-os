import { buildCodexCapacityProjection } from './codexCapacityGovernorV1.mjs';

export const CODEX_CAPACITY_DASHBOARD_SCHEMA_VERSION = 'stephanos.codex-capacity-dashboard.v1';

function rounded(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function buildCodexCapacityDashboardProjection(input = {}) {
  const capacity = input.capacityProjection || buildCodexCapacityProjection(input);
  const nextReset = capacity.observation.bankedResets[0] || null;
  const nextTask = capacity.nextCodexTask || null;
  const summary = capacity.resetPlan?.action
    ? `Codex is waiting for the earliest-expiring banked reset ${capacity.resetPlan.action.resetId} before the next high-value task.`
    : (capacity.dispatchAllowed
      ? `Codex has ${rounded(capacity.safelySchedulablePercent)}% safely schedulable capacity after reserves.`
      : capacity.reason);
  return Object.freeze({
    schemaVersion: CODEX_CAPACITY_DASHBOARD_SCHEMA_VERSION,
    kind: 'stephanos.codex_capacity.dashboard_projection',
    readOnly: true,
    meter: Object.freeze({
      availability: capacity.observation.availability,
      remainingPercent: rounded(capacity.observation.remainingPercent),
      safelySchedulablePercent: rounded(capacity.safelySchedulablePercent),
      reservedPercent: rounded(capacity.reservedPercent),
      naturalResetAtUtc: capacity.observation.naturalResetAtUtc,
      observedAtUtc: capacity.observation.observedAtUtc,
      confidence: capacity.observation.confidence,
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
      shortfallPercent: rounded(capacity.shortfallPercent),
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
