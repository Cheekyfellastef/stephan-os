// Fail-closed admission policy for a future governor-owned llama.cpp adapter.
// This module never authorizes production inference or changes the safety HOLD.
export const LLAMA_GOVERNOR_EVIDENCE_SCHEMA = 'stephanos.llama-governor-evidence.v1';
export const LLAMA_GOVERNOR_MAX_AGE_MS = 5000;

export function evaluateLlamaGovernorEvidenceV1(evidence, identity, nowMs = Date.now()) {
  const reasons = [];
  if (evidence?.schemaVersion !== LLAMA_GOVERNOR_EVIDENCE_SCHEMA)
    reasons.push('EVIDENCE_SCHEMA_UNKNOWN');
  if (!identity || !Number.isSafeInteger(identity.routerPid) || identity.routerPid <= 0
    || !identity.routerStartedAtUtc || !identity.modelId || !identity.governorInstanceId)
    reasons.push('EXPECTED_IDENTITY_MISSING');
  if (!evidence || !identity || evidence.routerPid !== identity.routerPid
    || evidence.routerStartedAtUtc !== identity.routerStartedAtUtc
    || evidence.modelId !== identity.modelId
    || evidence.governorInstanceId !== identity.governorInstanceId)
    reasons.push('ROUTER_IDENTITY_NOT_BOUND');
  const observedAt = Date.parse(evidence?.observedAtUtc || '');
  if (!Number.isFinite(nowMs) || !Number.isFinite(observedAt)
    || observedAt > nowMs || nowMs - observedAt > LLAMA_GOVERNOR_MAX_AGE_MS)
    reasons.push('EVIDENCE_NOT_FRESH');
  for (const key of ['gamingActive', 'routerAbsent', 'descendantsAbsent',
    'modelAbsent', 'gpuResidencyReleased', 'processCensusComplete']) {
    if (evidence?.[key] !== true) reasons.push(key.toUpperCase() + '_NOT_PROVEN');
  }
  return Object.freeze({
    schemaVersion: LLAMA_GOVERNOR_EVIDENCE_SCHEMA,
    evidenceCandidateComplete: reasons.length === 0,
    // Independent signer, process custody and Battle Bridge validation are
    // separate mandatory gates. Never use this result to lift the HOLD.
    productionInferenceQualified: false,
    safetyHoldMayBeRemoved: false,
    reasonCodes: Object.freeze(reasons),
  });
}
