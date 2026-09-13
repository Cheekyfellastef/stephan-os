import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CODEX_USE_CLASS,
  ROUTE_QUALIFICATION_STATE,
} from './codexDependencyParityMatrixV1.mjs';
import {
  CURRENT_TRUTH_REPORT_STATE,
  PROVIDER_ROUTE_EVIDENCE_CLASS,
} from './codexDependencyCurrentTruthReportV1.mjs';
import {
  CODEX_DEPENDENCY_CURRENT_TRUTH_OBSERVATION_RECORD_SCHEMA,
  OBSERVATION_COVERAGE_CLASS,
  PROVIDER_INDEPENDENCE_OBSERVER_EVIDENCE_CLASS,
  buildCodexDependencyCurrentTruthObservationV1,
  currentTruthObservationHasProvenParityV1,
  currentTruthObservationRecordIsPersistableV1,
} from './codexDependencyCurrentTruthObservationV1.mjs';

const sourceHead = 'a8a513eaf65922eee2311b10bb3c934c45f8ef47';
const observedAtUtc = '2026-08-20T08:30:00.000Z';

function route(overrides = {}) {
  return {
    routeId: 'github-independent-review',
    provider: 'GITHUB_ACTIONS',
    capabilityClass: 'EXACT_HEAD_REVIEW',
    active: true,
    qualificationState: ROUTE_QUALIFICATION_STATE.PRODUCTION_ELIGIBLE,
    sourceReady: true,
    liveProof: true,
    portableCheckpoint: true,
    receiptParity: true,
    proofParity: true,
    operatorApprovalParity: true,
    proofRefs: ['source:#1897'],
    ...overrides,
  };
}

function semantic(overrides = {}) {
  return {
    operationalDependency: true,
    touchpointId: 'review-exact-head',
    component: 'provider-neutral-review',
    capabilityClass: 'EXACT_HEAD_REVIEW',
    codexUseClass: CODEX_USE_CLASS.PREFERRED_BUT_REPLACEABLE,
    provider: 'CODEX',
    owningGoal: '#1574',
    workCreditCoupled: true,
    active: true,
    criticalPath: true,
    currentPrimaryRoute: 'codex-review',
    nonCodexRoutes: [route()],
    proofRefs: ['goal:#1574'],
    ...overrides,
  };
}

function providerEvidence(overrides = {}) {
  return {
    evidenceClass: PROVIDER_ROUTE_EVIDENCE_CLASS,
    verified: true,
    routeId: 'github-independent-review',
    provider: 'GITHUB_ACTIONS',
    capabilityClass: 'EXACT_HEAD_REVIEW',
    active: true,
    qualificationState: ROUTE_QUALIFICATION_STATE.PRODUCTION_ELIGIBLE,
    sourceReady: true,
    liveProof: true,
    sourceHead,
    observedAtUtc: '2026-08-20T08:20:00.000Z',
    freshUntilUtc: '2026-08-20T09:30:00.000Z',
    portableCheckpoint: true,
    receiptParity: true,
    proofParity: true,
    operatorApprovalParity: true,
    proofRefs: ['run:32275580247'],
    ...overrides,
  };
}

function observer(overrides = {}) {
  return {
    evidenceClass: PROVIDER_INDEPENDENCE_OBSERVER_EVIDENCE_CLASS,
    verified: true,
    observerId: 'provider-independence-observer',
    executionId: 'observer-run-20260820T0820Z',
    sourceHead,
    observedAtUtc: '2026-08-20T08:20:00.000Z',
    proofRefs: ['observer-run:20260820T0820Z'],
    ...overrides,
  };
}

function coverageRecord(coverageClass, emittedCount, overrides = {}) {
  return {
    coverageClass,
    complete: true,
    sourceHead,
    observedAtUtc: '2026-08-20T08:20:00.000Z',
    examinedCount: Math.max(emittedCount, coverageClass === OBSERVATION_COVERAGE_CLASS.REPOSITORY_SOURCE ? 240 : emittedCount),
    emittedCount,
    scopeRef: `scope:${coverageClass.toLowerCase()}`,
    proofRefs: [`coverage:${coverageClass.toLowerCase()}`],
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  const repositoryEntries = [{
    path: '.github/workflows/independent-merge-security-review.yml',
    content: 'Codex optional; provider-neutral review is canonical.',
    semantic: semantic(),
  }];
  const goalCandidates = [];
  const providerEvidenceRecords = [providerEvidence()];
  const gapOwners = [];
  const boundaryEvidence = [];
  return {
    repository: 'Cheekyfellastef/stephan-os',
    sourceBranch: 'main',
    sourceHead,
    observedAtUtc,
    observer: observer(),
    repositoryEntries,
    goalCandidates,
    providerEvidence: providerEvidenceRecords,
    gapOwners,
    boundaryEvidence,
    coverage: [
      coverageRecord(OBSERVATION_COVERAGE_CLASS.REPOSITORY_SOURCE, repositoryEntries.length),
      coverageRecord(OBSERVATION_COVERAGE_CLASS.GOAL_STATE, goalCandidates.length),
      coverageRecord(OBSERVATION_COVERAGE_CLASS.PROVIDER_ROUTE_PROOF, providerEvidenceRecords.length),
      coverageRecord(OBSERVATION_COVERAGE_CLASS.GAP_OWNERSHIP, gapOwners.length),
      coverageRecord(OBSERVATION_COVERAGE_CLASS.HARD_BOUNDARY_PROOF, boundaryEvidence.length),
    ],
    ...overrides,
  };
}

function replaceCoverage(input, coverageClass, patch) {
  return input.coverage.map((record) => (
    record.coverageClass === coverageClass ? { ...record, ...patch } : record
  ));
}

test('complete verified host observation produces a digest-bound current provider-independent report', () => {
  const result = buildCodexDependencyCurrentTruthObservationV1(baseInput());
  assert.equal(result.observationComplete, true);
  assert.deepEqual(result.observationProblems, []);
  assert.equal(result.report.reportState, CURRENT_TRUTH_REPORT_STATE.CURRENT_PROVIDER_INDEPENDENT);
  assert.equal(result.report.admissionReady, true);
  assert.equal(currentTruthObservationHasProvenParityV1(result), true);
  assert.equal(result.record.schema, CODEX_DEPENDENCY_CURRENT_TRUTH_OBSERVATION_RECORD_SCHEMA);
  assert.match(result.record.observationId, /^[0-9a-f]{64}$/);
  assert.match(result.record.reportDigest, /^[0-9a-f]{64}$/);
  assert.equal(currentTruthObservationRecordIsPersistableV1(result.record), true);
});

test('observer proof is required and cannot be replaced by caller assertion', () => {
  const input = baseInput({ observer: observer({ verified: false }) });
  const result = buildCodexDependencyCurrentTruthObservationV1(input);
  assert.equal(result.observationComplete, false);
  assert.ok(result.observationProblems.includes('observer-proof-not-verified'));
  assert.equal(result.report.reportState, CURRENT_TRUTH_REPORT_STATE.BLOCKED_OBSERVATION_INCOMPLETE);
  assert.equal(currentTruthObservationHasProvenParityV1(result), false);
});

test('observer proof must bind the exact current main source head', () => {
  const input = baseInput({
    observer: observer({ sourceHead: '297359a4f7b036546e172b8126056af84bf76902' }),
  });
  const result = buildCodexDependencyCurrentTruthObservationV1(input);
  assert.equal(result.observationComplete, false);
  assert.ok(result.observationProblems.includes('observer-source-head-not-current'));
});

test('future observer proof cannot attest current observation truth', () => {
  const input = baseInput({ observer: observer({ observedAtUtc: '2026-08-20T08:31:00.000Z' }) });
  const result = buildCodexDependencyCurrentTruthObservationV1(input);
  assert.equal(result.observationComplete, false);
  assert.ok(result.observationProblems.includes('observer-proof-from-future'));
});

test('all five coverage classes are required before observation can be complete', () => {
  const input = baseInput();
  input.coverage = input.coverage.filter((record) => record.coverageClass !== OBSERVATION_COVERAGE_CLASS.GAP_OWNERSHIP);
  const result = buildCodexDependencyCurrentTruthObservationV1(input);
  assert.equal(result.observationComplete, false);
  assert.ok(result.observationProblems.includes(`coverage-missing:${OBSERVATION_COVERAGE_CLASS.GAP_OWNERSHIP}`));
  assert.equal(result.report.reportState, CURRENT_TRUTH_REPORT_STATE.BLOCKED_OBSERVATION_INCOMPLETE);
});

test('coverage emitted count must equal the actual emitted evidence collection', () => {
  const input = baseInput();
  input.coverage = replaceCoverage(input, OBSERVATION_COVERAGE_CLASS.PROVIDER_ROUTE_PROOF, { emittedCount: 0 });
  const result = buildCodexDependencyCurrentTruthObservationV1(input);
  assert.equal(result.observationComplete, false);
  assert.ok(result.observationProblems.includes('coverage-invalid:PROVIDER_ROUTE_PROOF:emitted-count-mismatch:expected-1'));
});

test('coverage source identity cannot drift from exact current main', () => {
  const input = baseInput();
  input.coverage = replaceCoverage(input, OBSERVATION_COVERAGE_CLASS.REPOSITORY_SOURCE, {
    sourceHead: '297359a4f7b036546e172b8126056af84bf76902',
  });
  const result = buildCodexDependencyCurrentTruthObservationV1(input);
  assert.equal(result.observationComplete, false);
  assert.ok(result.observationProblems.includes('coverage-invalid:REPOSITORY_SOURCE:coverage-source-head-not-current'));
});

test('complete repository coverage must prove at least one repository item was examined', () => {
  const input = baseInput();
  input.coverage = replaceCoverage(input, OBSERVATION_COVERAGE_CLASS.REPOSITORY_SOURCE, {
    examinedCount: 0,
    emittedCount: 0,
  });
  input.repositoryEntries = [];
  const result = buildCodexDependencyCurrentTruthObservationV1(input);
  assert.equal(result.observationComplete, false);
  assert.ok(result.observationProblems.includes('coverage-invalid:REPOSITORY_SOURCE:repository-estate-not-examined'));
});

test('duplicate coverage authority fails closed rather than selecting one arbitrarily', () => {
  const input = baseInput();
  input.coverage.push({ ...input.coverage[0], proofRefs: ['duplicate:coverage'] });
  const result = buildCodexDependencyCurrentTruthObservationV1(input);
  assert.equal(result.observationComplete, false);
  assert.ok(result.observationProblems.includes('coverage-invalid:REPOSITORY_SOURCE:coverage-class-duplicate'));
});

test('complete observation may still expose a real parity gap when provider live proof is absent', () => {
  const input = baseInput({ providerEvidence: [] });
  input.coverage = replaceCoverage(input, OBSERVATION_COVERAGE_CLASS.PROVIDER_ROUTE_PROOF, {
    emittedCount: 0,
    examinedCount: 1,
  });
  const result = buildCodexDependencyCurrentTruthObservationV1(input);
  assert.equal(result.observationComplete, true);
  assert.equal(result.report.reportState, CURRENT_TRUTH_REPORT_STATE.CURRENT_PARITY_GAPS);
  assert.equal(result.report.admissionReady, false);
  assert.equal(currentTruthObservationHasProvenParityV1(result), false);
});

test('observer and coverage proof refs are carried into the canonical report coverage ledger', () => {
  const result = buildCodexDependencyCurrentTruthObservationV1(baseInput());
  assert.ok(result.report.coverageRefs.includes('observer-run:20260820T0820Z'));
  assert.ok(result.report.coverageRefs.includes('coverage:repository_source'));
  assert.ok(result.report.coverageRefs.includes('scope:repository_source'));
});

test('observation identity is deterministic across coverage ordering and proof-ref ordering', () => {
  const leftInput = baseInput();
  const rightInput = baseInput();
  rightInput.coverage = [...rightInput.coverage].reverse().map((record) => ({
    ...record,
    proofRefs: [...record.proofRefs].reverse(),
  }));
  const left = buildCodexDependencyCurrentTruthObservationV1(leftInput);
  const right = buildCodexDependencyCurrentTruthObservationV1(rightInput);
  assert.equal(left.record.observationId, right.record.observationId);
  assert.equal(left.record.reportDigest, right.record.reportDigest);
});

test('all observation and persistence projections keep mutation and authority widening false', () => {
  const result = buildCodexDependencyCurrentTruthObservationV1(baseInput());
  for (const authority of [result.authority, result.record.authority, result.report.authority]) {
    assert.deepEqual(authority, {
      sourceMutation: false,
      dispatch: false,
      providerQualification: false,
      merge: false,
      deployment: false,
      runtimeMutation: false,
      openClawMutation: false,
      spendingOrAccount: false,
      leaseSeizure: false,
    });
  }
});

test('sparse and accessor-shaped observation inputs fail before evidence evaluation', () => {
  const sparse = baseInput();
  sparse.coverage = new Array(5);
  sparse.coverage[0] = coverageRecord(OBSERVATION_COVERAGE_CLASS.REPOSITORY_SOURCE, 1);
  assert.throws(() => buildCodexDependencyCurrentTruthObservationV1(sparse), /must not be sparse/);

  const hostile = baseInput();
  Object.defineProperty(hostile.observer, 'observerId', { get() { return 'forged'; }, enumerable: true });
  assert.throws(() => buildCodexDependencyCurrentTruthObservationV1(hostile), /must be a data property/);
});
