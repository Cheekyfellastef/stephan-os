import { projectVrGovernorExecutionPermissionsV1 } from '../ai/ollamaLoadGovernor.mjs';

// Original #2573 / gaming governor: read-only Qwen 3.5 heavy-model admission.
// This is NOT an authority grant or a reason to start a model automatically.
export const QWEN35_CANARY_GOVERNOR_ADMISSION_SCHEMA_V1 =
  'stephanos.qwen35-canary-governor-admission.v1';

function decision(blocked, blocker = '') {
  return Object.freeze({
    schemaVersion: QWEN35_CANARY_GOVERNOR_ADMISSION_SCHEMA_V1,
    blocked,
    blocker,
    sourceMutationAllowed: false,
    modelStarted: false,
    pcRestartAllowed: false,
  });
}

export function classifyQwen35CanaryGovernorV1(record, nowMs = Date.now()) {
  // The canary is a NEW 27B load, not an already-running model. If the
  // governor's source, shape, timestamp or decisions are unknown, DO NOT
  // infer idle. The real Windows writer includes updatedAtUtc in every state.
  const observedAtMs = typeof record?.updatedAtUtc === 'string'
    ? Date.parse(record.updatedAtUtc) : NaN;
  // Match the already-protected Core's strict gaming observer. A permissive
  // Qwen-specific freshness window must never outlive Core protection.
  const gamingFlags = ['active', 'flatGameActive', 'airLinkActive',
    'realAirLinkActive', 'virtualAirLinkTestActive', 'prepareLeaseActive'];
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(record))
    || record.schemaVersion !== 'stephanos.vr-resource-governor.v1'
    || record.governorVersion !== 3
    || typeof record.phase !== 'string'
    || gamingFlags.some(key => typeof record[key] !== 'boolean')
    || typeof record.localModelAllowed !== 'boolean'
    || typeof record.heavyModelAllowed !== 'boolean'
    || !Number.isFinite(nowMs) || !Number.isFinite(observedAtMs)
    || observedAtMs > nowMs || nowMs - observedAtMs > 15_000) {
    return decision(true, 'QWEN35_CANARY_GOVERNOR_UNPROVEN');
  }
  // The shared governor also demands no native-probe custody hold, observed
  // dependencies and proven eviction health. Two model flags alone are unsafe.
  const permission = projectVrGovernorExecutionPermissionsV1(record, nowMs);
  if (permission.observed !== true) {
    return decision(true, 'QWEN35_CANARY_GOVERNOR_UNPROVEN');
  }
  // An actual heavy-model grant is necessary, but a fully idle game/session
  // is independently required for this new 27B load.
  if (record.phase !== 'NORMAL' || gamingFlags.some(key => record[key] !== false)
    || permission.heavyModelAllowed !== true || permission.localCpuAllowed !== true) {
    return decision(true, 'QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR');
  }
  return decision(false);
}
