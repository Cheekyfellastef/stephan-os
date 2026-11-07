import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CODEX_USE_CLASS,
  COVERAGE_VERDICT,
  ROUTE_QUALIFICATION_STATE,
} from './codexDependencyParityMatrixV1.mjs';
import {
  CURRENT_TRUTH_REPORT_STATE,
  HARD_BOUNDARY_EVIDENCE_CLASS,
  PROVIDER_ROUTE_EVIDENCE_CLASS,
  buildCodexDependencyCurrentTruthReportV1,
  currentTruthReportHasProvenParity,
} from './codexDependencyCurrentTruthReportV1.mjs';

const sourceHead = 'a8a513eaf65922eee2311b10bb3c934c45f8ef47';
const observedAtUtc = '2026-08-20T07:00:00.000Z';

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
    observedAtUtc: '2026-08-20T06:45:00.000Z',
    freshUntilUtc: '2026-08-20T08:00:00.000Z',
    portableCheckpoint: true,
    receiptParity: true,
    proofParity: true,
    operatorApprovalParity: true,
    proofRefs: ['run:32275580247'],
    ...overrides,
  };
}

function boundaryEvidence(touchpointId, overrides = {}) {
  return {
    evidenceClass: HARD_BOUNDARY_EVIDENCE_CLASS,
    verified: true,
    touchpointId,
    sourceHead,
    observedAtUtc: '2026-08-20T06:45:00.000Z',
    freshUntilUtc: '2026-08-20T08:00:00.000Z',
    hardExternalBoundary: true,
    unrelatedWorkIsolation: true,
    proofRefs: ['boundary:official-api-only'],
    ...overrides,
  };
}

function report(overrides = {}) {
  return buildCodexDependencyCurrentTruthReportV1({
    repository: 'Cheekyfellastef/stephan-os',
    sourceBranch: 'main',
    sourceHead,
    observedAtUtc,
    observationComplete: true,
    coverageRefs: [`tree:${sourceHead}`, 'goals:open-current'],
    repositoryEntries: [{
      path: '.github/workflows/independent-merge-security-review.yml',
      content: 'Codex optional; provider-neutral review is canonical.',
      semantic: semantic(),
    }],
    providerEvidence: [providerEvidence()],
    boundaryEvidence: [],
    gapOwners: [],
    goalCandidates: [],
    ...overrides,
  });
}

test('fresh exact-main provider evidence upgrades a structured route to proven parity', () => {
  const result = report();
  assert.equal(result.reportState, CURRENT_TRUTH_REPORT_STATE.CURRENT_PROVIDER_INDEPENDENT);
  assert.equal(result.admissionReady, true);
  assert.equal(result.parityMatrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.PARITY_PROVEN);
  assert.deepEqual(result.parityMatrix.touchpoints[0].selectedRouteIds, ['github-independent-review']);
  assert.equal(currentTruthReportHasProvenParity(result), true);
});

test('raw provider prose blocks report admission until semantic classification exists', () => {
  const result = report({
    repositoryEntries: [{ path: 'README.md', content: 'Codex may be used for specialist work.' }],
    providerEvidence: [],
  });
  assert.equal(result.reportState, CURRENT_TRUTH_REPORT_STATE.BLOCKED_SEMANTIC_CLASSIFICATION);
  assert.equal(result.admissionReady, false);
  assert.equal(result.unclassifiedReferenceCount, 1);
  assert.equal(result.parityMatrix.touchpointCount, 0);
});

test('empty or unattested observation estate can never claim provider independence', () => {
  const result = report({
    observationComplete: false,
    coverageRefs: [],
    repositoryEntries: [],
    goalCandidates: [],
    providerEvidence: [],
  });
  assert.equal(result.reportState, CURRENT_TRUTH_REPORT_STATE.BLOCKED_OBSERVATION_INCOMPLETE);
  assert.equal(result.admissionReady, false);
  assert.deepEqual(result.observationProblems, [
    'coverage-refs-missing',
    'observation-not-complete',
    'observed-estate-empty',
  ]);
  assert.equal(currentTruthReportHasProvenParity(result), false);
});

test('source claims cannot self-promote a route to live production parity without provider evidence', () => {
  const result = report({ providerEvidence: [] });
  assert.equal(result.reportState, CURRENT_TRUTH_REPORT_STATE.CURRENT_PARITY_GAPS);
  assert.equal(result.admissionReady, false);
  assert.equal(result.parityMatrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.PARITY_SOURCE_READY_NEEDS_LIVE_PROOF);
  assert.ok(result.parityMatrix.touchpoints[0].blockers.includes('live-proof-missing:github-independent-review'));
  assert.equal(currentTruthReportHasProvenParity(result), false);
});

test('provider proof must carry the canonical evidence class and verified proof posture', () => {
  const result = report({
    providerEvidence: [providerEvidence({ evidenceClass: 'CALLER_ASSERTION', verified: false })],
  });
  assert.equal(result.reportState, CURRENT_TRUTH_REPORT_STATE.BLOCKED_EVIDENCE_CONFLICT);
  assert.ok(result.correlationProblems.some((problem) => problem.includes('evidence-class-invalid')));
  assert.ok(result.correlationProblems.some((problem) => problem.includes('verified-proof-required')));
});

test('provider proof that has expired by observation time stays stale and cannot prove parity', () => {
  const result = report({
    providerEvidence: [providerEvidence({ freshUntilUtc: '2026-08-20T06:59:59.000Z' })],
  });
  assert.equal(result.reportState, CURRENT_TRUTH_REPORT_STATE.CURRENT_PARITY_GAPS);
  assert.equal(result.parityMatrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.PARITY_SOURCE_READY_NEEDS_LIVE_PROOF);
  assert.ok(result.parityMatrix.touchpoints[0].blockers.includes('proof-not-fresh:github-independent-review'));
});

test('provider evidence from a different source head is rejected rather than silently reused', () => {
  const result = report({
    providerEvidence: [providerEvidence({ sourceHead: '297359a4f7b036546e172b8126056af84bf76902' })],
  });
  assert.equal(result.reportState, CURRENT_TRUTH_REPORT_STATE.BLOCKED_EVIDENCE_CONFLICT);
  assert.equal(result.admissionReady, false);
  assert.ok(result.correlationProblems.some((problem) => problem.includes('source-head-not-current')));
  assert.notEqual(result.parityMatrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.PARITY_PROVEN);
});

test('conflicting current provider evidence for one route fails closed', () => {
  const result = report({
    providerEvidence: [
      providerEvidence(),
      providerEvidence({ liveProof: false }),
    ],
  });
  assert.equal(result.reportState, CURRENT_TRUTH_REPORT_STATE.BLOCKED_EVIDENCE_CONFLICT);
  assert.ok(result.correlationProblems.includes('provider-evidence-conflict:github-independent-review|EXACT_HEAD_REVIEW'));
});

test('compatible duplicate provider evidence is deduplicated and unions proof refs', () => {
  const result = report({
    providerEvidence: [
      providerEvidence({ proofRefs: ['run:1'] }),
      providerEvidence({ proofRefs: ['run:2'] }),
    ],
  });
  assert.equal(result.reportState, CURRENT_TRUTH_REPORT_STATE.CURRENT_PROVIDER_INDEPENDENT);
  assert.equal(result.providerEvidenceCount, 1);
  assert.deepEqual(result.parityMatrix.touchpoints[0].nonCodexRoutes[0].proofRefs, ['run:1', 'run:2']);
});

test('existing gap-owner evidence fills an otherwise unowned critical parity gap without making it admission-ready', () => {
  const result = report({
    repositoryEntries: [{
      path: 'shared/agents/openclaw.mjs',
      content: 'Codex',
      semantic: semantic({
        touchpointId: 'openclaw-oc1',
        component: 'openclaw-provider',
        capabilityClass: 'OC1_REPOSITORY_SCOUT',
        codexUseClass: CODEX_USE_CLASS.CRITICAL_PATH,
        owningGoal: '#1725',
        currentPrimaryRoute: 'codex-scout',
        nonCodexRoutes: [],
        missingGapOwner: '',
      }),
    }],
    providerEvidence: [],
    gapOwners: [{ touchpointId: 'openclaw-oc1', ownerGoal: '#1725' }],
  });
  assert.equal(result.reportState, CURRENT_TRUTH_REPORT_STATE.CURRENT_PARITY_GAPS);
  assert.equal(result.criticalGapCount, 1);
  assert.equal(result.unownedCriticalGapCount, 0);
  assert.equal(result.parityMatrix.touchpoints[0].missingGapOwner, '#1725');
  assert.equal(result.admissionReady, false);
});

test('contradictory gap ownership blocks the report instead of opening duplicate ownership', () => {
  const result = report({
    repositoryEntries: [{
      path: 'shared/agents/openclaw.mjs',
      content: 'Codex',
      semantic: semantic({
        touchpointId: 'openclaw-oc1',
        capabilityClass: 'OC1_REPOSITORY_SCOUT',
        codexUseClass: CODEX_USE_CLASS.CRITICAL_PATH,
        owningGoal: '#1725',
        nonCodexRoutes: [],
        missingGapOwner: '#1725',
      }),
    }],
    providerEvidence: [],
    gapOwners: [{ touchpointId: 'openclaw-oc1', ownerGoal: '#1905' }],
  });
  assert.equal(result.reportState, CURRENT_TRUTH_REPORT_STATE.BLOCKED_EVIDENCE_CONFLICT);
  assert.ok(result.correlationProblems.includes('gap-owner-conflict:openclaw-oc1'));
});

test('source-only hard external boundary claims are downgraded until current proof exists', () => {
  const touchpointId = 'external-api-only';
  const result = report({
    repositoryEntries: [{
      path: 'shared/agents/external.mjs',
      content: 'Codex',
      semantic: semantic({
        touchpointId,
        component: 'external-api',
        capabilityClass: 'EXTERNAL_VENDOR_AGENT',
        codexUseClass: CODEX_USE_CLASS.CRITICAL_PATH,
        owningGoal: '#1899',
        nonCodexRoutes: [],
        hardExternalBoundary: true,
        unrelatedWorkIsolation: true,
      }),
    }],
    providerEvidence: [],
  });
  assert.equal(result.reportState, CURRENT_TRUTH_REPORT_STATE.CURRENT_PARITY_GAPS);
  assert.equal(result.parityMatrix.touchpoints[0].hardExternalBoundary, false);
  assert.equal(result.parityMatrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.MISSING_NON_CODEX_ROUTE);
});

test('fresh verified hard-boundary evidence may isolate a genuine external boundary without granting authority', () => {
  const touchpointId = 'external-api-only';
  const result = report({
    repositoryEntries: [{
      path: 'shared/agents/external.mjs',
      content: 'Codex',
      semantic: semantic({
        touchpointId,
        component: 'external-api',
        capabilityClass: 'EXTERNAL_VENDOR_AGENT',
        codexUseClass: CODEX_USE_CLASS.CRITICAL_PATH,
        owningGoal: '#1899',
        nonCodexRoutes: [],
        hardExternalBoundary: true,
        unrelatedWorkIsolation: true,
      }),
    }],
    providerEvidence: [],
    boundaryEvidence: [boundaryEvidence(touchpointId)],
  });
  assert.equal(result.reportState, CURRENT_TRUTH_REPORT_STATE.CURRENT_PROVIDER_INDEPENDENT);
  assert.equal(result.boundaryEvidenceCount, 1);
  assert.equal(result.parityMatrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.HARD_EXTERNAL_BOUNDARY_ISOLATED);
  assert.equal(result.admissionReady, true);
});

test('goal candidates join repository candidates in the same canonical parity matrix', () => {
  const result = report({
    goalCandidates: [{
      touchpointId: 'goal-product-work',
      pathOrGoalRef: '#1776',
      component: 'product-controller',
      capabilityClass: 'PRODUCT_GOAL_PROGRESSION',
      codexUseClass: CODEX_USE_CLASS.OPTIONAL_SPECIALIST,
      provider: 'WORK_AGENTIC',
      workCreditCoupled: true,
      active: true,
      criticalPath: false,
      owningGoal: '#1776',
      currentPrimaryRoute: 'chat-scheduled-task',
      nonCodexRoutes: [],
      proofRefs: ['goal:#1776'],
    }],
  });
  assert.equal(result.parityMatrix.touchpointCount, 2);
  assert.ok(result.parityMatrix.touchpoints.some((touchpoint) => touchpoint.touchpointId === 'goal-product-work'));
  assert.equal(result.reportState, CURRENT_TRUTH_REPORT_STATE.CURRENT_PROVIDER_INDEPENDENT);
});

test('report is bound to exact canonical main and rejects alternate repository or branch envelopes', () => {
  assert.throws(() => report({ repository: 'other/repo' }), /canonical Stephanos repository is required/);
  assert.throws(() => report({ sourceBranch: 'feature' }), /must be bound to main/);
  assert.throws(() => report({ sourceHead: 'abc' }), /exact 40-character current main sourceHead is required/);
});

test('future-dated provider evidence fails closed', () => {
  const result = report({
    providerEvidence: [providerEvidence({ observedAtUtc: '2026-08-20T07:01:00.000Z' })],
  });
  assert.equal(result.reportState, CURRENT_TRUTH_REPORT_STATE.BLOCKED_EVIDENCE_CONFLICT);
  assert.ok(result.correlationProblems.some((problem) => problem.includes('evidence-from-future')));
});

test('hostile sparse or symbol-shaped inputs are rejected before truth evaluation', () => {
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => report({ providerEvidence: sparse }), /must not be sparse/);

  const hostile = { ...providerEvidence() };
  hostile[Symbol('secret')] = 'hidden';
  assert.throws(() => report({ providerEvidence: [hostile] }), /symbol key/);
});

test('current-truth report and nested matrix never grant mutation, execution or approval authority', () => {
  const result = report();
  assert.deepEqual(result.authority, {
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
  assert.equal(result.parityMatrix.authority.sourceMutation, false);
  assert.equal(result.parityMatrix.authority.dispatch, false);
  assert.equal(result.parityMatrix.authority.merge, false);
  assert.equal(result.parityMatrix.authority.runtimeMutation, false);
});
