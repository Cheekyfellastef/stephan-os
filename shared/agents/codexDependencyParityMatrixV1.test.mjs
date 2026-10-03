import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCodexDependencyParityMatrixV1,
  CODEX_USE_CLASS,
  COVERAGE_VERDICT,
  ROUTE_QUALIFICATION_STATE,
} from './codexDependencyParityMatrixV1.mjs';

const observedAtUtc = '2026-08-20T05:15:00Z';

function route(overrides = {}) {
  return {
    routeId: 'github-hosted-review',
    provider: 'GITHUB_ACTIONS',
    capabilityClass: 'EXACT_HEAD_REVIEW',
    active: true,
    qualificationState: ROUTE_QUALIFICATION_STATE.PRODUCTION_ELIGIBLE,
    sourceReady: true,
    liveProof: true,
    proofFreshness: 'FRESH',
    portableCheckpoint: true,
    receiptParity: true,
    proofParity: true,
    operatorApprovalParity: true,
    proofRefs: ['run:1'],
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    touchpointId: 'independent-review',
    pathOrGoalRef: '#1574',
    component: 'exact-head-review',
    capabilityClass: 'EXACT_HEAD_REVIEW',
    codexUseClass: CODEX_USE_CLASS.CRITICAL_PATH,
    provider: 'CODEX_OR_WORK',
    workCreditCoupled: true,
    active: true,
    criticalPath: true,
    owningGoal: '#1574',
    currentPrimaryRoute: 'github-hosted-review',
    nonCodexRoutes: [route()],
    proofRefs: ['#1897'],
    missingGapOwner: '#1574',
    ...overrides,
  };
}

function build(candidates) {
  return buildCodexDependencyParityMatrixV1({ observedAtUtc, candidates });
}

test('proven non-Codex route produces PARITY_PROVEN', () => {
  const matrix = build([candidate()]);
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.PARITY_PROVEN);
  assert.deepEqual(matrix.touchpoints[0].selectedRouteIds, ['github-hosted-review']);
});

test('critical path with no non-Codex route is a missing route', () => {
  const matrix = build([candidate({ nonCodexRoutes: [], missingGapOwner: '#1574' })]);
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.MISSING_NON_CODEX_ROUTE);
  assert.deepEqual(matrix.touchpoints[0].blockers, ['qualified-non-codex-route-missing']);
});

test('unowned missing critical route remains visible and blocks admission readiness', () => {
  const matrix = build([candidate({ nonCodexRoutes: [], missingGapOwner: '' })]);
  assert.equal(matrix.unownedCriticalGapCount, 1);
  assert.equal(matrix.admissionReady, false);
  assert.ok(matrix.touchpoints[0].blockers.includes('missing-gap-owner-unresolved'));
});

test('declared route without qualification is not painted green', () => {
  const matrix = build([candidate({ nonCodexRoutes: [route({ qualificationState: ROUTE_QUALIFICATION_STATE.EVALUATED, sourceReady: false, liveProof: false })] })]);
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.NON_CODEX_ROUTE_EXISTS_NEEDS_QUALIFICATION);
});

test('source-ready route without live proof remains source-ready only', () => {
  const matrix = build([candidate({ nonCodexRoutes: [route({ qualificationState: ROUTE_QUALIFICATION_STATE.SOURCE_READY, liveProof: false })] })]);
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.PARITY_SOURCE_READY_NEEDS_LIVE_PROOF);
  assert.ok(matrix.touchpoints[0].blockers.includes('live-proof-missing:github-hosted-review'));
});

test('stale live proof cannot count as parity proven', () => {
  const matrix = build([candidate({ nonCodexRoutes: [route({ proofFreshness: 'STALE' })] })]);
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.PARITY_SOURCE_READY_NEEDS_LIVE_PROOF);
  assert.ok(matrix.touchpoints[0].blockers.includes('proof-not-fresh:github-hosted-review'));
});

test('portable checkpoint parity is required', () => {
  const matrix = build([candidate({ nonCodexRoutes: [route({ portableCheckpoint: false })] })]);
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.PARITY_SOURCE_READY_NEEDS_LIVE_PROOF);
  assert.ok(matrix.touchpoints[0].blockers.includes('portable-checkpoint-parity-missing:github-hosted-review'));
});

test('receipt proof and operator approval parity are independently required', () => {
  const matrix = build([candidate({ nonCodexRoutes: [route({ receiptParity: false, proofParity: false, operatorApprovalParity: false })] })]);
  const blockers = matrix.touchpoints[0].blockers;
  assert.ok(blockers.includes('receipt-parity-missing:github-hosted-review'));
  assert.ok(blockers.includes('proof-parity-missing:github-hosted-review'));
  assert.ok(blockers.includes('operator-approval-parity-missing:github-hosted-review'));
});

test('isolated hard external boundary is explicit rather than a fake fallback', () => {
  const matrix = build([candidate({ nonCodexRoutes: [], hardExternalBoundary: true, unrelatedWorkIsolation: true })]);
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.HARD_EXTERNAL_BOUNDARY_ISOLATED);
});

test('unisolated hard external boundary still exposes missing route', () => {
  const matrix = build([candidate({ nonCodexRoutes: [], hardExternalBoundary: true, unrelatedWorkIsolation: false })]);
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.MISSING_NON_CODEX_ROUTE);
});

test('legacy or inactive touchpoint remains separate from live parity gaps', () => {
  const legacy = build([candidate({ active: false, codexUseClass: CODEX_USE_CLASS.LEGACY_OR_DEAD, criticalPath: false })]);
  assert.equal(legacy.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.LEGACY_NON_CRITICAL);
});

test('optional non-critical Codex specialist does not become a false critical gap', () => {
  const matrix = build([candidate({ codexUseClass: CODEX_USE_CLASS.OPTIONAL_SPECIALIST, criticalPath: false, nonCodexRoutes: [] })]);
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.LEGACY_NON_CRITICAL);
});

test('Work agentic dependency shares the constrained-provider classification model', () => {
  const matrix = build([candidate({ provider: 'WORK_AGENTIC', workCreditCoupled: true, nonCodexRoutes: [] })]);
  assert.equal(matrix.touchpoints[0].provider, 'WORK_AGENTIC');
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.MISSING_NON_CODEX_ROUTE);
});

test('multiple source references deduplicate into one touchpoint family', () => {
  const matrix = build([
    candidate({ pathOrGoalRef: 'scripts/a.mjs' }),
    candidate({ pathOrGoalRef: '.github/workflows/b.yml' }),
  ]);
  assert.equal(matrix.touchpointCount, 1);
  assert.deepEqual(matrix.touchpoints[0].sourceRefs, ['.github/workflows/b.yml', 'scripts/a.mjs']);
});

test('conflicting duplicate touchpoint identity fails closed', () => {
  const matrix = build([
    candidate(),
    candidate({ capabilityClass: 'WINDOWS_RUNTIME_RECOVERY', nonCodexRoutes: [route({ capabilityClass: 'WINDOWS_RUNTIME_RECOVERY' })] }),
  ]);
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.AMBIGUOUS_FAIL_CLOSED);
  assert.ok(matrix.touchpoints[0].blockers.includes('touchpoint-field-conflict:capabilityClass'));
  assert.equal(matrix.admissionReady, false);
});

test('conflicting route qualification evidence fails closed', () => {
  const matrix = build([
    candidate(),
    candidate({ pathOrGoalRef: '#1637', nonCodexRoutes: [route({ liveProof: false })] }),
  ]);
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.AMBIGUOUS_FAIL_CLOSED);
  assert.ok(matrix.touchpoints[0].blockers.includes('route-contract-conflict:github-hosted-review'));
});

test('route for the wrong capability class does not count as parity', () => {
  const matrix = build([candidate({ nonCodexRoutes: [route({ capabilityClass: 'SOURCE_BUILD' })] })]);
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.MISSING_NON_CODEX_ROUTE);
});

test('records and matrix grant no mutation or authority widening', () => {
  const matrix = build([candidate()]);
  for (const value of Object.values(matrix.authority)) assert.equal(value, false);
  for (const value of Object.values(matrix.touchpoints[0].authority)) assert.equal(value, false);
});

test('matrix output is deterministic and touchpoints are sorted', () => {
  const a = candidate({ touchpointId: 'z-touchpoint' });
  const b = candidate({ touchpointId: 'a-touchpoint' });
  const one = build([a, b]);
  const two = build([b, a]);
  assert.deepEqual(one, two);
  assert.deepEqual(one.touchpoints.map((item) => item.touchpointId), ['a-touchpoint', 'z-touchpoint']);
});

test('invalid structural identity fails closed instead of guessing', () => {
  const matrix = build([candidate({ owningGoal: '' })]);
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.AMBIGUOUS_FAIL_CLOSED);
  assert.ok(matrix.touchpoints[0].blockers.includes('owning-goal-missing'));
});

test('route proof refs from multiple source observations are unioned rather than treated as contract conflict', () => {
  const matrix = build([
    candidate({ pathOrGoalRef: 'scripts/a.mjs', nonCodexRoutes: [route({ proofRefs: ['run:1'] })] }),
    candidate({ pathOrGoalRef: 'scripts/b.mjs', nonCodexRoutes: [route({ proofRefs: ['run:2'] })] }),
  ]);
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.PARITY_PROVEN);
  assert.deepEqual(matrix.touchpoints[0].nonCodexRoutes[0].proofRefs, ['run:1', 'run:2']);
});

test('conflicting missing-gap owners fail closed instead of picking one', () => {
  const matrix = build([
    candidate({ nonCodexRoutes: [], missingGapOwner: '#1574' }),
    candidate({ pathOrGoalRef: '#1637', nonCodexRoutes: [], missingGapOwner: '#1637' }),
  ]);
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.AMBIGUOUS_FAIL_CLOSED);
  assert.ok(matrix.touchpoints[0].blockers.includes('touchpoint-field-conflict:missingGapOwner'));
});

test('critical gaps keep matrix admissionReady false even when an owner exists', () => {
  const matrix = build([candidate({ nonCodexRoutes: [], missingGapOwner: '#1574' })]);
  assert.equal(matrix.criticalGapCount, 1);
  assert.equal(matrix.unownedCriticalGapCount, 0);
  assert.equal(matrix.admissionReady, false);
});

test('candidate authority-relevant booleans must be explicit', () => {
  const incomplete = candidate();
  delete incomplete.criticalPath;
  const matrix = build([incomplete]);
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.AMBIGUOUS_FAIL_CLOSED);
  assert.ok(matrix.touchpoints[0].blockers.includes('critical-path-state-missing'));
});

test('invalid observedAtUtc is rejected', () => {
  assert.throws(() => buildCodexDependencyParityMatrixV1({ observedAtUtc: 'not-a-date', candidates: [] }), /observedAtUtc/);
});
