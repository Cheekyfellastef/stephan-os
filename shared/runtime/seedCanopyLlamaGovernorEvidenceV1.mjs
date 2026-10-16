// Fail-closed admission policy for a future governor-owned llama.cpp adapter.
// This module never authorizes production inference or changes the safety HOLD.
export const LLAMA_GOVERNOR_EVIDENCE_SCHEMA = 'stephanos.llama-governor-evidence.v1';
export const LLAMA_GOVERNOR_MAX_AGE_MS = 5000;

const isCanonicalUtc = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const isSha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isJobIdentity = value => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

export function evaluateLlamaGovernorEvidenceV1(evidence, identity, nowMs = Date.now()) {
  const reasons = [];
  if (evidence?.schemaVersion !== LLAMA_GOVERNOR_EVIDENCE_SCHEMA)
    reasons.push('EVIDENCE_SCHEMA_UNKNOWN');
  if (!identity || !Number.isSafeInteger(identity.routerPid) || identity.routerPid <= 0
    || !isCanonicalUtc(identity.routerStartedAtUtc) || !identity.modelId || !identity.governorInstanceId
    || !isSha256(identity.routerExecutableSha256) || !isJobIdentity(identity.routerJobIdentity))
    reasons.push('EXPECTED_IDENTITY_MISSING');
  if (!evidence || !identity || evidence.routerPid !== identity.routerPid
    || evidence.routerStartedAtUtc !== identity.routerStartedAtUtc
    || evidence.modelId !== identity.modelId
    || evidence.governorInstanceId !== identity.governorInstanceId)
    reasons.push('ROUTER_IDENTITY_NOT_BOUND');
  // A recycled PID and matching start time cannot establish executable or Job
  // custody; these are independently bound parts of the expected launch identity.
  if (!isSha256(evidence?.routerExecutableSha256)
    || evidence.routerExecutableSha256 !== identity?.routerExecutableSha256)
    reasons.push('ROUTER_EXECUTABLE_NOT_BOUND');
  if (!isJobIdentity(evidence?.routerJobIdentity)
    || evidence.routerJobIdentity !== identity?.routerJobIdentity)
    reasons.push('ROUTER_JOB_NOT_BOUND');
  const observedAt = Date.parse(evidence?.observedAtUtc || '');
  if (!Number.isFinite(nowMs) || !isCanonicalUtc(evidence?.observedAtUtc)
    || !Number.isFinite(observedAt) || observedAt > nowMs
    || nowMs - observedAt > LLAMA_GOVERNOR_MAX_AGE_MS)
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
