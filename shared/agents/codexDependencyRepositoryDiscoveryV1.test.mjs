import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DISCOVERY_STATE,
  PROVIDER_SIGNAL,
  diffCodexDependencyRepositoryDiscoveryV1,
  discoverCodexDependencyRepositoryCandidatesV1,
} from './codexDependencyRepositoryDiscoveryV1.mjs';
import {
  CODEX_USE_CLASS,
  COVERAGE_VERDICT,
  ROUTE_QUALIFICATION_STATE,
  buildCodexDependencyParityMatrixV1,
} from './codexDependencyParityMatrixV1.mjs';

const observedAtUtc = '2026-08-20T06:00:00.000Z';

function semantic(overrides = {}) {
  return {
    operationalDependency: true,
    touchpointId: 'review-exact-head',
    component: 'provider-neutral-review',
    capabilityClass: 'EXACT_HEAD_REVIEW',
    codexUseClass: CODEX_USE_CLASS.PREFERRED_BUT_REPLACEABLE,
    owningGoal: '#1574',
    workCreditCoupled: true,
    active: true,
    criticalPath: true,
    currentPrimaryRoute: 'codex-review',
    nonCodexRoutes: [{
      routeId: 'github-independent-review',
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
      proofRefs: ['run:32308284286'],
    }],
    proofRefs: ['goal:#1574'],
    ...overrides,
  };
}

function discover(entries, time = observedAtUtc) {
  return discoverCodexDependencyRepositoryCandidatesV1({ observedAtUtc: time, entries });
}

test('raw Codex prose becomes an unclassified reference, never an operational dependency by string match alone', () => {
  const result = discover([{ path: 'README.md', content: 'Codex may be used as optional capacity.' }]);
  assert.equal(result.candidateCount, 0);
  assert.equal(result.unclassifiedReferenceCount, 1);
  assert.equal(result.findings[0].state, DISCOVERY_STATE.NEEDS_SEMANTIC_CLASSIFICATION);
  assert.equal(result.findings[0].reason, 'provider-reference-is-not-dependency-proof');
  assert.deepEqual(result.findings[0].providerSignals, [PROVIDER_SIGNAL.CODEX]);
  assert.equal(result.semanticClassificationComplete, false);
});

test('explicit reference-only documentation is retained without becoming parity input', () => {
  const result = discover([{
    path: 'docs/history.md',
    content: 'Remote Codex was used by the historical migration.',
    referenceOnly: true,
  }]);
  assert.equal(result.referenceOnlyCount, 1);
  assert.equal(result.candidateCount, 0);
  assert.deepEqual(result.referenceOnly[0].providerSignals, [PROVIDER_SIGNAL.CODEX, PROVIDER_SIGNAL.REMOTE_CODEX]);
  assert.equal(result.referenceOnly[0].state, DISCOVERY_STATE.REFERENCE_ONLY);
});

test('generated and runtime paths are excluded when they contain provider references', () => {
  const result = discover([
    { path: 'apps/stephanos/dist/index.js', content: 'Codex' },
    { path: 'runtime-activity/status.json', content: 'Work agentic' },
    { path: 'node_modules/pkg/index.js', content: 'Remote Codex' },
  ]);
  assert.equal(result.excludedCount, 3);
  assert.equal(result.candidateCount, 0);
  assert.equal(result.unclassifiedReferenceCount, 0);
  assert.ok(result.excluded.every((finding) => finding.state === DISCOVERY_STATE.EXCLUDED_GENERATED_OR_RUNTIME));
});

test('generated and runtime paths without provider evidence do not pollute the inventory', () => {
  const result = discover([
    { path: 'apps/stephanos/dist/index.js', content: 'ordinary generated UI bundle' },
    { path: 'runtime-activity/status.json', content: '{"healthy":true}' },
  ]);
  assert.equal(result.entryCount, 2);
  assert.equal(result.findingCount, 0);
  assert.equal(result.excludedCount, 0);
});

test('explicit operational semantics produce one matrix-ready candidate', () => {
  const result = discover([{
    path: '.github/workflows/review.yml',
    content: 'Use Codex when healthy; provider-neutral review remains qualified.',
    semantic: semantic(),
  }]);
  assert.equal(result.candidateCount, 1);
  assert.equal(result.unclassifiedReferenceCount, 0);
  assert.equal(result.semanticClassificationComplete, true);
  assert.equal(result.candidates[0].touchpointId, 'review-exact-head');
  assert.equal(result.candidates[0].pathOrGoalRef, '.github/workflows/review.yml');
  assert.deepEqual(result.candidates[0].discoveryProblems, []);

  const matrix = buildCodexDependencyParityMatrixV1({ observedAtUtc, candidates: result.candidates });
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.PARITY_PROVEN);
});

test('structured but incomplete semantics flow to the matrix as fail-closed evidence rather than being guessed', () => {
  const broken = semantic();
  delete broken.criticalPath;
  const result = discover([{
    path: 'shared/agents/review.mjs',
    declaredProviderSignals: [PROVIDER_SIGNAL.CODEX],
    semantic: broken,
  }]);
  assert.equal(result.candidateCount, 1);
  assert.equal(result.incompleteSemanticCount, 1);
  assert.equal(result.semanticClassificationComplete, false);
  assert.ok(result.candidates[0].discoveryProblems.includes('semantic-field-missing:criticalPath'));

  const matrix = buildCodexDependencyParityMatrixV1({ observedAtUtc, candidates: result.candidates });
  assert.equal(matrix.touchpoints[0].coverageVerdict, COVERAGE_VERDICT.AMBIGUOUS_FAIL_CLOSED);
  assert.ok(matrix.touchpoints[0].blockers.includes('critical-path-state-missing'));
});

test('Work agentic references are discovered as the same constrained provider-risk family', () => {
  const result = discover([{ path: 'docs/controller.md', content: 'This path currently requires Work agentic credits.' }]);
  assert.deepEqual(result.unclassifiedReferences[0].providerSignals, [PROVIDER_SIGNAL.WORK_AGENTIC]);
});

test('declared provider signals allow structured discovery without relying on prose tokens', () => {
  const result = discover([{
    path: 'shared/agents/router.mjs',
    content: 'provider selected elsewhere',
    declaredProviderSignals: [PROVIDER_SIGNAL.CODEX],
    semantic: semantic({ touchpointId: 'router-provider-selection' }),
  }]);
  assert.equal(result.candidateCount, 1);
  assert.deepEqual(result.candidates[0].discoveryProviderSignals, [PROVIDER_SIGNAL.CODEX]);
});

test('explicit semantic non-operational reference is retained as reference-only', () => {
  const result = discover([{
    path: 'shared/agents/statusProjection.mjs',
    content: 'Codex status is displayed here',
    semantic: { operationalDependency: false },
  }]);
  assert.equal(result.referenceOnlyCount, 1);
  assert.equal(result.referenceOnly[0].reason, 'semantic-non-operational-reference');
  assert.equal(result.candidateCount, 0);
});

test('entries with no provider signal and no operational semantic assertion do not pollute the inventory', () => {
  const result = discover([{ path: 'shared/agents/unrelated.mjs', content: 'ordinary provider-neutral code' }]);
  assert.equal(result.entryCount, 1);
  assert.equal(result.findingCount, 0);
});

test('test fixtures are classified separately from agent source', () => {
  const result = discover([{ path: 'shared/agents/router.test.mjs', content: 'Codex fixture' }]);
  assert.equal(result.findings[0].sourceClass, 'TEST_FIXTURE');
});

test('discovery ordering and finding identity are deterministic', () => {
  const entries = [
    { path: 'scripts/z.mjs', content: 'Codex' },
    { path: '.github/workflows/a.yml', content: 'Work agentic' },
  ];
  const left = discover(entries);
  const right = discover([...entries].reverse());
  assert.deepEqual(left.findings.map((finding) => finding.path), ['.github/workflows/a.yml', 'scripts/z.mjs']);
  assert.deepEqual(left.findings.map((finding) => finding.findingId), right.findings.map((finding) => finding.findingId));
});

test('snapshot diff exposes newly introduced unclassified provider references', () => {
  const previous = discover([{ path: 'README.md', content: 'provider-neutral' }], '2026-08-20T05:00:00Z');
  const current = discover([{ path: 'README.md', content: 'provider-neutral' }, { path: 'scripts/new.mjs', content: 'Codex only for now' }], '2026-08-20T06:00:00Z');
  const diff = diffCodexDependencyRepositoryDiscoveryV1(previous, current);
  assert.equal(diff.addedFindingIds.length, 1);
  assert.equal(diff.addedUnclassifiedReferenceIds.length, 1);
  assert.equal(diff.requiresSemanticRefresh, true);
});

test('snapshot diff reports structured additions without claiming semantic refresh when fully classified', () => {
  const previous = discover([], '2026-08-20T05:00:00Z');
  const current = discover([{
    path: '.github/workflows/review.yml',
    declaredProviderSignals: [PROVIDER_SIGNAL.CODEX],
    semantic: semantic(),
  }], '2026-08-20T06:00:00Z');
  const diff = diffCodexDependencyRepositoryDiscoveryV1(previous, current);
  assert.equal(diff.addedStructuredTouchpointIds.length, 1);
  assert.equal(diff.addedUnclassifiedReferenceIds.length, 0);
  assert.equal(diff.requiresSemanticRefresh, false);
});

test('structured semantic identity changes are visible in snapshot refresh', () => {
  const path = '.github/workflows/review.yml';
  const previous = discover([{
    path,
    declaredProviderSignals: [PROVIDER_SIGNAL.CODEX],
    semantic: semantic({ criticalPath: false, codexUseClass: CODEX_USE_CLASS.OPTIONAL_SPECIALIST }),
  }], '2026-08-20T05:00:00Z');
  const current = discover([{
    path,
    declaredProviderSignals: [PROVIDER_SIGNAL.CODEX],
    semantic: semantic({ criticalPath: true, codexUseClass: CODEX_USE_CLASS.CRITICAL_PATH }),
  }], '2026-08-20T06:00:00Z');
  const diff = diffCodexDependencyRepositoryDiscoveryV1(previous, current);
  assert.equal(diff.addedStructuredTouchpointIds.length, 1);
  assert.equal(diff.removedFindingIds.length, 1);
});

test('proof-only changes do not churn discovery identity for the same semantic dependency', () => {
  const path = '.github/workflows/review.yml';
  const previous = discover([{
    path,
    declaredProviderSignals: [PROVIDER_SIGNAL.CODEX],
    semantic: semantic({ proofRefs: ['run:1'] }),
  }], '2026-08-20T05:00:00Z');
  const current = discover([{
    path,
    declaredProviderSignals: [PROVIDER_SIGNAL.CODEX],
    semantic: semantic({ proofRefs: ['run:2'] }),
  }], '2026-08-20T06:00:00Z');
  const diff = diffCodexDependencyRepositoryDiscoveryV1(previous, current);
  assert.equal(diff.addedFindingIds.length, 0);
  assert.equal(diff.removedFindingIds.length, 0);
});

test('discovery and diff never grant mutation or execution authority', () => {
  const previous = discover([]);
  const current = discover([{ path: 'scripts/new.mjs', content: 'Codex' }]);
  const diff = diffCodexDependencyRepositoryDiscoveryV1(previous, current);
  assert.ok(Object.values(current.authority).every((value) => value === false));
  assert.ok(Object.values(diff.authority).every((value) => value === false));
});

test('invalid timestamps and missing paths fail closed', () => {
  assert.throws(() => discover([], 'not-a-date'), /observedAtUtc/);
  assert.throws(() => discover([{ content: 'Codex' }]), /path is required/);
});
