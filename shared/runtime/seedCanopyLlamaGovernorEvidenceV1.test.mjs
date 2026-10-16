import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LLAMA_GOVERNOR_EVIDENCE_SCHEMA,
  evaluateLlamaGovernorEvidenceV1,
} from './seedCanopyLlamaGovernorEvidenceV1.mjs';

const NOW = Date.parse('2026-10-16T12:00:00.000Z');
const identity = {
  routerPid: 1234,
  routerStartedAtUtc: '2026-10-16T11:58:00.000Z',
  modelId: 'qwen3-coder:30b',
  governorInstanceId: 'boot-1',
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
