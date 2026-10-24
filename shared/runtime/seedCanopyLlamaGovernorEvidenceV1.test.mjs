import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  LLAMA_GOVERNOR_EVIDENCE_SCHEMA,
  evaluateLlamaGovernorEvidenceV1,
  evaluateSignedLlamaGovernorEvidenceV1,
  canonicalLlamaGovernorAttestationPayloadV1,
} from './seedCanopyLlamaGovernorEvidenceV1.mjs';

const NOW = Date.parse('2026-10-16T12:00:00.000Z');
const identity = {
  routerPid: 1234,
  routerStartedAtUtc: '2026-10-16T11:58:00.000Z',
  modelId: 'qwen3-coder:30b',
  governorInstanceId: 'boot-1',
  routerExecutableSha256: 'a'.repeat(64),
  routerJobIdentity: 'job-3096-boot-1',
};
const evidence = {
  schemaVersion: LLAMA_GOVERNOR_EVIDENCE_SCHEMA,
  ...identity,
  observedAtUtc: '2026-10-16T11:59:59.000Z',
  gamingActive: true, routerAbsent: true, descendantsAbsent: true,
  modelAbsent: true, gpuResidencyReleased: true, processCensusComplete: true,
};
const check = (value, expected = identity) =>
  evaluateLlamaGovernorEvidenceV1(value, expected, NOW);

test('complete evidence remains only a candidate; inference stays disabled', () => {
  const result = check(evidence);
  assert.equal(result.evidenceCandidateComplete, true);
  assert.equal(result.productionInferenceQualified, false);
  assert.equal(result.safetyHoldMayBeRemoved, false);
});
test('rejects stale, future and missing governor observations', () => {
  assert.equal(check({ ...evidence, observedAtUtc: '2026-10-16T11:59:54.000Z' }).evidenceCandidateComplete, false);
  assert.equal(check({ ...evidence, observedAtUtc: '2026-10-16T12:00:01.000Z' }).evidenceCandidateComplete, false);
  assert.equal(check(null).evidenceCandidateComplete, false);
});
test('rejects PID reuse, model substitution and governor restart', () => {
  for (const key of ['routerPid', 'routerStartedAtUtc', 'modelId', 'governorInstanceId']) {
    assert.equal(check({ ...evidence, [key]: key === 'routerPid' ? 9999 : 'different' })
      .evidenceCandidateComplete, false, key);
  }
});
test('requires gaming, process tree, model and VRAM evidence together', () => {
  for (const key of ['gamingActive', 'routerAbsent', 'descendantsAbsent',
    'modelAbsent', 'gpuResidencyReleased', 'processCensusComplete']) {
    assert.equal(check({ ...evidence, [key]: false }).evidenceCandidateComplete, false, key);
  }
});

test('rejects noncanonical timestamp formats even when Date.parse accepts them', () => {
  for (const value of ['2026-10-16', '2026-10-16T11:59:59Z', 'Fri, 16 Oct 2026 11:59:59 GMT']) {
    assert.equal(check({ ...evidence, observedAtUtc: value }).evidenceCandidateComplete, false, value);
  }
  assert.equal(check(evidence, { ...identity, routerStartedAtUtc: '2026-10-16' }).evidenceCandidateComplete, false);
});

test('rejects executable substitution even with matching PID, model and governor', () => {
  const forged = { ...evidence, routerExecutableSha256: 'b'.repeat(64) };
  const result = check(forged);
  assert.equal(result.evidenceCandidateComplete, false);
  assert.ok(result.reasonCodes.includes('ROUTER_EXECUTABLE_NOT_BOUND'));
  assert.equal(result.safetyHoldMayBeRemoved, false);
});

test('rejects a different, missing or malformed Windows Job identity', () => {
  for (const value of ['job-3096-attacker', '', null, {}, 'job with spaces']) {
    const result = check({ ...evidence, routerJobIdentity: value });
    assert.equal(result.evidenceCandidateComplete, false, String(value));
    assert.ok(result.reasonCodes.includes('ROUTER_JOB_NOT_BOUND'));
  }
});

test('rejects absent or invalid expected executable/Job custody values', () => {
  for (const changed of [
    { routerExecutableSha256: null }, { routerExecutableSha256: 'A'.repeat(64) },
    { routerExecutableSha256: 'a'.repeat(63) }, { routerJobIdentity: undefined },
    { routerJobIdentity: 'bad/job/path' }, { routerJobIdentity: ' '.repeat(8) },
  ]) {
    const result = check(evidence, { ...identity, ...changed });
    assert.equal(result.evidenceCandidateComplete, false, JSON.stringify(changed));
    assert.ok(result.reasonCodes.includes('EXPECTED_IDENTITY_MISSING'));
    assert.equal(result.productionInferenceQualified, false);
  }
});

test('identity fields cannot be omitted from otherwise complete evidence', () => {
  for (const key of ['routerExecutableSha256', 'routerJobIdentity']) {
    const missing = { ...evidence };
    delete missing[key];
    const result = check(missing);
    assert.equal(result.evidenceCandidateComplete, false, key);
    assert.equal(result.safetyHoldMayBeRemoved, false);
  }
});


const keys = generateKeyPairSync('ed25519');
const otherKeys = generateKeyPairSync('ed25519');
const CHALLENGE = 'c'.repeat(64);
const trusted = { challenge: CHALLENGE, publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }) };
const signed = (value = evidence, challenge = CHALLENGE, key = keys.privateKey) => ({
  challenge,
  signatureBase64: sign(null,
    Buffer.from(canonicalLlamaGovernorAttestationPayloadV1(value, challenge)), key).toString('base64'),
});
const signedCheck = (value = evidence, signature = signed(value), context = trusted) =>
  evaluateSignedLlamaGovernorEvidenceV1(value, identity, signature, context, NOW);

test('valid Ed25519 signature yields a candidate but never authorizes inference', () => {
  const result = signedCheck();
  assert.equal(result.signedEvidenceCandidateComplete, true);
  assert.equal(result.productionInferenceQualified, false);
  assert.equal(result.safetyHoldMayBeRemoved, false);
});

test('rejects altered process and GPU evidence after signing', () => {
  const signature = signed();
  for (const changed of [
    { routerPid: 7777 }, { routerExecutableSha256: 'f'.repeat(64) },
    { routerJobIdentity: 'job-attacker' }, { gpuResidencyReleased: false },
    { processCensusComplete: false }, { modelId: 'other-model' },
  ]) {
    const result = signedCheck({ ...evidence, ...changed }, signature);
    assert.equal(result.signedEvidenceCandidateComplete, false, JSON.stringify(changed));
    assert.equal(result.safetyHoldMayBeRemoved, false);
  }
});

test('rejects replayed challenges, missing trust and injected keys', () => {
  const signature = signed();
  const otherChallenge = 'd'.repeat(64);
  for (const context of [
    { ...trusted, challenge: otherChallenge }, { ...trusted, challenge: 'not-random' },
    { ...trusted, publicKeyPem: otherKeys.publicKey.export({ type: 'spki', format: 'pem' }) },
    { ...trusted, publicKeyPem: undefined }, null,
  ]) {
    assert.equal(signedCheck(evidence, signature, context).signedEvidenceCandidateComplete, false);
  }
  assert.equal(signedCheck({ ...evidence, publicKeyPem: trusted.publicKeyPem },
    { ...signature, challenge: otherChallenge }).signedEvidenceCandidateComplete, false);
});

test('rejects malformed, substituted and wrong-algorithm signatures', () => {
  const signature = signed();
  for (const candidate of [
    null, {}, { ...signature, signatureBase64: '' },
    { ...signature, signatureBase64: 'AAAA' },
    { ...signature, signatureBase64:
      (signature.signatureBase64[0] === 'A' ? 'B' : 'A') + signature.signatureBase64.slice(1) },
    signed(evidence, CHALLENGE, otherKeys.privateKey),
  ]) {
    assert.equal(signedCheck(evidence, candidate).signedEvidenceCandidateComplete, false);
  }
  const rsaKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rsaTrust = { ...trusted, publicKeyPem: rsaKeys.publicKey.export({ type: 'spki', format: 'pem' }) };
  assert.equal(signedCheck(evidence, signature, rsaTrust).signedEvidenceCandidateComplete, false);
});

test('stale signed evidence remains rejected even with valid signature', () => {
  const stale = { ...evidence, observedAtUtc: '2026-10-16T11:59:50.000Z' };
  const result = signedCheck(stale, signed(stale));
  assert.equal(result.signedEvidenceCandidateComplete, false);
  assert.ok(result.reasonCodes.includes('EVIDENCE_NOT_FRESH'));
});

test('rejects truthy object, control-character and unbounded model/governor identities', () => {
  for (const [key, values] of Object.entries({
    modelId: [{ name: 'qwen3-coder:30b' }, ['qwen3-coder:30b'], 'qwen\\n30b', 'x'.repeat(193), ''],
    governorInstanceId: [{ id: 'boot-1' }, ['boot-1'], 'boot\\n1', 'x'.repeat(129), ''],
  })) {
    for (const value of values) {
      // The same object reference on both sides previously passed equality.
      const forgedIdentity = { ...identity, [key]: value };
      const forgedEvidence = { ...evidence, [key]: value };
      const result = evaluateLlamaGovernorEvidenceV1(forgedEvidence, forgedIdentity, NOW);
      assert.equal(result.evidenceCandidateComplete, false, key + ': ' + String(value));
      assert.ok(result.reasonCodes.includes('EXPECTED_IDENTITY_MISSING'));
      assert.equal(result.productionInferenceQualified, false);
      assert.equal(result.safetyHoldMayBeRemoved, false);
    }
  }
});

test('signed evidence rejects a matching non-string identity even with a valid signature', () => {
  const forged = { ...evidence, modelId: { name: 'qwen3-coder:30b' } };
  const forgedIdentity = { ...identity, modelId: forged.modelId };
  const attestation = signed(forged);
  const result = evaluateSignedLlamaGovernorEvidenceV1(forged, forgedIdentity, attestation, trusted, NOW);
  assert.equal(result.signedEvidenceCandidateComplete, false);
  assert.ok(result.reasonCodes.includes('EXPECTED_IDENTITY_MISSING'));
  assert.equal(result.safetyHoldMayBeRemoved, false);
});
