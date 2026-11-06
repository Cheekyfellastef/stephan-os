import { createPublicKey, verify } from 'node:crypto';
// Fail-closed admission policy for a future governor-owned llama.cpp adapter.
// This module never authorizes production inference or changes the safety HOLD.
export const LLAMA_GOVERNOR_EVIDENCE_SCHEMA = 'stephanos.llama-governor-evidence.v1';
export const LLAMA_GOVERNOR_MAX_AGE_MS = 5000;

const isCanonicalUtc = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const isSha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isJobIdentity = value => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
// Identity values must be bounded immutable text, not truthy objects that can
// be serialized differently between signature creation and verification.
const isModelId = value => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,191}$/.test(value);
const isGovernorInstanceId = value => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

export function evaluateLlamaGovernorEvidenceV1(evidence, identity, nowMs = Date.now()) {
  const reasons = [];
  if (evidence?.schemaVersion !== LLAMA_GOVERNOR_EVIDENCE_SCHEMA)
    reasons.push('EVIDENCE_SCHEMA_UNKNOWN');
  if (!identity || !Number.isSafeInteger(identity.routerPid) || identity.routerPid <= 0
    || !isCanonicalUtc(identity.routerStartedAtUtc)
    || !isModelId(identity.modelId) || !isGovernorInstanceId(identity.governorInstanceId)
    || !isSha256(identity.routerExecutableSha256) || !isJobIdentity(identity.routerJobIdentity))
    reasons.push('EXPECTED_IDENTITY_MISSING');
  if (!evidence || !identity || evidence.routerPid !== identity.routerPid
    || evidence.routerStartedAtUtc !== identity.routerStartedAtUtc
    || evidence.modelId !== identity.modelId
    || evidence.governorInstanceId !== identity.governorInstanceId
    || !isModelId(evidence.modelId) || !isGovernorInstanceId(evidence.governorInstanceId))
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


// Signature verification is a separate boundary from structural evidence checks.
 // Only the trusted caller may supply the pinned governor key and a fresh random
 // challenge. A public key embedded in the evidence is NEVER trusted.
const isChallenge = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const ATTESTED_FIELDS = Object.freeze([
  'schemaVersion', 'routerPid', 'routerStartedAtUtc', 'modelId',
  'governorInstanceId', 'routerExecutableSha256', 'routerJobIdentity',
  'observedAtUtc', 'gamingActive', 'routerAbsent', 'descendantsAbsent',
  'modelAbsent', 'gpuResidencyReleased', 'processCensusComplete',
]);

export function canonicalLlamaGovernorAttestationPayloadV1(evidence, challenge) {
  if (!evidence || typeof evidence !== 'object' || !isChallenge(challenge))
    throw new TypeError('EVIDENCE_OR_CHALLENGE_INVALID');
  // Ordered array prevents property-insertion order from changing the signed
  // bytes. The domain prefix prevents cross-protocol signature reuse.
  return JSON.stringify(['stephanos.llama-governor-attestation.v1',
    ...ATTESTED_FIELDS.map(field => evidence[field]), challenge]);
}

export function evaluateSignedLlamaGovernorEvidenceV1(
  evidence, identity, attestation, trusted, nowMs = Date.now(),
) {
  const structural = evaluateLlamaGovernorEvidenceV1(evidence, identity, nowMs);
  const reasons = [...structural.reasonCodes];
  const expectedChallenge = trusted?.challenge;
  if (!isChallenge(expectedChallenge)) reasons.push('TRUSTED_CHALLENGE_MISSING');
  if (!isChallenge(attestation?.challenge) || attestation.challenge !== expectedChallenge)
    reasons.push('ATTESTATION_CHALLENGE_MISMATCH');
  const encoded = attestation?.signatureBase64;
  const signature = typeof encoded === 'string' && encoded.length <= 100
    && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ? Buffer.from(encoded, 'base64') : null;
  if (!signature || signature.length !== 64 || signature.toString('base64') !== encoded)
    reasons.push('ATTESTATION_SIGNATURE_INVALID');
  let publicKey;
  try {
    if (typeof trusted?.publicKeyPem !== 'string' || trusted.publicKeyPem.length > 2000)
      throw new TypeError('missing pinned key');
    publicKey = createPublicKey(trusted.publicKeyPem);
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new TypeError('not Ed25519');
  } catch {
    reasons.push('TRUSTED_GOVERNOR_KEY_INVALID');
  }
  if (reasons.length === 0) {
    try {
      const payload = Buffer.from(canonicalLlamaGovernorAttestationPayloadV1(evidence, expectedChallenge));
      if (!verify(null, payload, publicKey, signature))
        reasons.push('ATTESTATION_SIGNATURE_INVALID');
    } catch {
      reasons.push('ATTESTATION_SIGNATURE_INVALID');
    }
  }
  return Object.freeze({
    schemaVersion: LLAMA_GOVERNOR_EVIDENCE_SCHEMA,
    signedEvidenceCandidateComplete: reasons.length === 0,
    // Signature validity does not prove that the source actually measured
    // Battle Bridge residency. Independent physical qualification is required.
    productionInferenceQualified: false,
    safetyHoldMayBeRemoved: false,
    reasonCodes: Object.freeze(reasons),
  });
}
