import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OBSERVATION_COVERAGE_CLASS,
  PROVIDER_INDEPENDENCE_OBSERVER_EVIDENCE_CLASS,
  PROVIDER_INDEPENDENCE_OBSERVATION_MAX_AGE_MS,
  buildCodexDependencyCurrentTruthObservationV1,
} from './codexDependencyCurrentTruthObservationV1.mjs';

const SOURCE_HEAD = '1'.repeat(40);
const REPOSITORY = 'Cheekyfellastef/stephan-os';

function observer(overrides = {}) {
  return {
    evidenceClass: PROVIDER_INDEPENDENCE_OBSERVER_EVIDENCE_CLASS,
    verified: true,
    observerId: 'provider-independence-observer',
    executionId: 'observer-run-freshness-v1',
    sourceHead: SOURCE_HEAD,
    observedAtUtc: '2026-08-20T08:25:00.000Z',
    proofRefs: ['observer-run:freshness-v1'],
    ...overrides,
  };
}

function coverageRecord(coverageClass, emittedCount, overrides = {}) {
  return {
    coverageClass,
    complete: true,
    sourceHead: SOURCE_HEAD,
    observedAtUtc: '2026-08-20T08:25:00.000Z',
    examinedCount: coverageClass === OBSERVATION_COVERAGE_CLASS.REPOSITORY_SOURCE
      ? Math.max(1, emittedCount)
      : emittedCount,
    emittedCount,
    scopeRef: `scope:${coverageClass.toLowerCase()}`,
    proofRefs: [`coverage:${coverageClass.toLowerCase()}`],
    ...overrides,
  };
}

function input(overrides = {}) {
  const repositoryEntries = [{
    path: '.github/workflows/independent-merge-security-review.yml',
    content: 'provider-neutral review evidence',
  }];
  const goalCandidates = [];
  const providerEvidence = [];
  const gapOwners = [];
  const boundaryEvidence = [];

  return {
    repository: REPOSITORY,
    sourceBranch: 'main',
    sourceHead: SOURCE_HEAD,
    observedAtUtc: '2026-08-20T08:30:00.000Z',
    observer: observer(),
    repositoryEntries,
    goalCandidates,
    providerEvidence,
    gapOwners,
    boundaryEvidence,
    coverage: [
      coverageRecord(OBSERVATION_COVERAGE_CLASS.REPOSITORY_SOURCE, repositoryEntries.length),
      coverageRecord(OBSERVATION_COVERAGE_CLASS.GOAL_STATE, goalCandidates.length),
      coverageRecord(OBSERVATION_COVERAGE_CLASS.PROVIDER_ROUTE_PROOF, providerEvidence.length),
      coverageRecord(OBSERVATION_COVERAGE_CLASS.GAP_OWNERSHIP, gapOwners.length),
      coverageRecord(OBSERVATION_COVERAGE_CLASS.HARD_BOUNDARY_PROOF, boundaryEvidence.length),
    ],
    ...overrides,
  };
}

test('observer and coverage proof receive a bounded default freshness window when legacy evidence omits an expiry', () => {
  assert.equal(PROVIDER_INDEPENDENCE_OBSERVATION_MAX_AGE_MS, 15 * 60 * 1000);
  const result = buildCodexDependencyCurrentTruthObservationV1(input());
  assert.equal(result.observationComplete, true);
  assert.deepEqual(result.observationProblems, []);
  assert.equal(result.observer.freshUntilUtc, '2026-08-20T08:40:00.000Z');
  assert.ok(result.coverage.every((record) => record.freshUntilUtc === '2026-08-20T08:40:00.000Z'));
});

test('an unchanged source head cannot keep an expired observer attestation current', () => {
  const value = input({
    observedAtUtc: '2026-08-20T08:36:00.000Z',
    observer: observer({ observedAtUtc: '2026-08-20T08:20:00.000Z' }),
  });
  const result = buildCodexDependencyCurrentTruthObservationV1(value);
  assert.equal(result.observationComplete, false);
  assert.ok(result.observationProblems.includes('observer-proof-stale'));
});

test('an unchanged source head cannot keep an expired coverage attestation current', () => {
  const value = input({ observedAtUtc: '2026-08-20T08:36:00.000Z' });
  value.coverage = value.coverage.map((record) => (
    record.coverageClass === OBSERVATION_COVERAGE_CLASS.REPOSITORY_SOURCE
      ? { ...record, observedAtUtc: '2026-08-20T08:20:00.000Z' }
      : record
  ));
  const result = buildCodexDependencyCurrentTruthObservationV1(value);
  assert.equal(result.observationComplete, false);
  assert.ok(result.observationProblems.includes(
    'coverage-invalid:REPOSITORY_SOURCE:coverage-proof-stale',
  ));
});

test('a declared observer expiry cannot precede the proof observation time', () => {
  const value = input({
    observer: observer({ freshUntilUtc: '2026-08-20T08:24:59.999Z' }),
  });
  const result = buildCodexDependencyCurrentTruthObservationV1(value);
  assert.equal(result.observationComplete, false);
  assert.ok(result.observationProblems.includes('observer-freshness-window-invalid'));
});

test('a declared coverage expiry cannot precede its proof observation time', () => {
  const value = input();
  value.coverage = value.coverage.map((record) => (
    record.coverageClass === OBSERVATION_COVERAGE_CLASS.GOAL_STATE
      ? { ...record, freshUntilUtc: '2026-08-20T08:24:59.999Z' }
      : record
  ));
  const result = buildCodexDependencyCurrentTruthObservationV1(value);
  assert.equal(result.observationComplete, false);
  assert.ok(result.observationProblems.includes(
    'coverage-invalid:GOAL_STATE:coverage-freshness-window-invalid',
  ));
});

test('caller-declared freshness cannot widen the fixed observation trust window', () => {
  const value = input({
    observer: observer({ freshUntilUtc: '2026-08-20T08:45:00.001Z' }),
  });
  const result = buildCodexDependencyCurrentTruthObservationV1(value);
  assert.equal(result.observationComplete, false);
  assert.ok(result.observationProblems.includes('observer-freshness-window-too-wide'));
});

test('a narrower explicit expiry is respected and can make otherwise recent proof stale', () => {
  const value = input({
    observer: observer({ freshUntilUtc: '2026-08-20T08:28:00.000Z' }),
  });
  const result = buildCodexDependencyCurrentTruthObservationV1(value);
  assert.equal(result.observationComplete, false);
  assert.ok(result.observationProblems.includes('observer-proof-stale'));
});
