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

export function classifyQwen35CanaryGovernorV1(record) {
  // The canary is a NEW 27B load, not an already-running model. If the
  // governor's source, shape or decisions are unknown, DO NOT infer idle.
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(record))
    || record.schemaVersion !== 'stephanos.vr-resource-governor.v1'
    || typeof record.active !== 'boolean'
    || typeof record.localModelAllowed !== 'boolean'
    || typeof record.heavyModelAllowed !== 'boolean') {
    return decision(true, 'QWEN35_CANARY_GOVERNOR_UNPROVEN');
  }
  // A 27B model requires both explicit workload and heavy-residency consent.
  // Even a stale inactive flag cannot overrule a retained denial.
  if (record.localModelAllowed !== true || record.heavyModelAllowed !== true) {
    return decision(true, 'QWEN35_CANARY_BLOCKED_BY_VR_RESOURCE_GOVERNOR');
  }
  return decision(false);
}
