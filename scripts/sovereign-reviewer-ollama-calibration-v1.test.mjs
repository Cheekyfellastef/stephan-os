import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runSovereignOllamaCalibrationV1 as run,
  projectSovereignOllamaCalibrationV1 as project,
} from './sovereign-reviewer-ollama-calibration-v1.mjs';

const env = Object.freeze({
  STEPHANOS_REVIEW_REPOSITORY: 'Cheekyfellastef/stephan-os',
  STEPHANOS_REVIEW_EXACT_HEAD: 'a'.repeat(40),
  STEPHANOS_REVIEW_EXACT_BASE: 'b'.repeat(40),
  STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER: 'github-builder',
  STEPHANOS_REVIEW_IMPLEMENTER_SESSION: 'implementer-one',
  STEPHANOS_REVIEW_SESSION: 'reviewer-two',
  STEPHANOS_SOVEREIGN_REVIEW_MODEL: 'qwen:14b',
});
function noAuthority(r) {
  for (const key of ['independentHostAttestation','signatureVerified','specialistAuthority',
    'independentReviewSatisfied','protectedMergeAuthority','sourceMutationAuthority',
    'leaseReleaseAuthority','windowsCommissioningAuthority','physicalPickupProven']) {
    assert.equal(r[key], false, key);
  }
}
test('real-model route submits ten fixed untrusted patches only to loopback Ollama', async () => {
  const calls = [];
  const result = await run(env, { fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body);
    calls.push({ url, options, request });
    const prompt = request.prompt;
    const challengeId = prompt.match(/Challenge: (case-[a-f0-9]{32})/)?.[1];
    const diffSha256 = prompt.match(/SHA256: ([a-f0-9]{64})/)?.[1];
    // All-clean model is unsafe and must FAIL calibration (eight seeded defects).
    const output = JSON.stringify({ challengeId, diffSha256, verdict: 'clean', findings: [] });
    return { ok: true, text: async () => JSON.stringify({ response: output }) };
  }});
  assert.equal(calls.length, 10);
  assert.equal(calls.every(x => x.url === 'http://127.0.0.1:11434/api/generate'), true);
  assert.equal(calls.every(x => x.options.method === 'POST'
    && x.request.model === 'qwen:14b' && x.request.stream === false
    && x.request.format === 'json' && x.request.options.temperature === 0), true);
  assert.equal(result.status, 'CALIBRATION_HELD');
  assert.equal(result.completedCases, 10);
  assert.equal(result.passedCases, 2);
  noAuthority(result);
  const publicResult = project(result);
  assert.equal(publicResult.status, 'CALIBRATION_HELD');
  noAuthority(publicResult);
});
test('unavailable or oversized Ollama responses hold, never pass the exam', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('offline'); },
    async () => ({ ok: false, text: async () => '{}' }),
    async () => ({ ok: true, text: async () => 'x'.repeat(65537) }),
    async () => ({ ok: true, text: async () => '{"response": 3}' }),
  ]) {
    const r = await run(env, { fetchImpl });
    assert.equal(r.status, 'CALIBRATION_HELD');
    noAuthority(project(r));
  }
});
test('invalid local model, source and provider identities fail before or during test', async () => {
  let calls = 0;
  const denied = await run({ ...env, STEPHANOS_SOVEREIGN_REVIEW_MODEL: '../bad' }, {
    fetchImpl: async () => { calls++; throw Error('must not call'); },
  });
  assert.equal(denied.status, 'CALIBRATION_HELD');
  assert.equal(calls, 0);
  const sameProvider = await run({ ...env, STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER: 'sovereign-local-ollama' }, {
    fetchImpl: async () => { calls++; throw Error('must not call'); },
  });
  assert.equal(sameProvider.reason, 'EXACT_SOURCE_OR_INDEPENDENT_REVIEW_IDENTITY_MISSING');
  assert.equal(calls, 0);
  noAuthority(project(sameProvider));
});
test('candidate clean status never becomes independently qualified or approved', () => {
  const s = project({
    status: 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED',
    repository: 'Cheekyfellastef/stephan-os', sourceHead: 'a'.repeat(40),
    baseSha: 'b'.repeat(40), completedCases: 10, passedCases: 10,
    manifestSha256: 'c'.repeat(64), observationsSha256: 'd'.repeat(64),
    specialistAuthority: true, independentReviewSatisfied: true,
    leaseReleaseAuthority: true,
  });
  assert.equal(s.status, 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED');
  noAuthority(s);
});
