import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGitHubFirstReviewAdapterContract,
  buildLocalReadonlyReviewAdapterContract,
  createProviderNeutralReviewReceipt,
  providerNeutralReviewToExecutionReceipt,
  selectProviderNeutralReviewRoute,
  validateProviderNeutralReviewReceipt,
} from './providerNeutralReviewV1.mjs';

const HEAD = 'a'.repeat(40);
const NEXT_HEAD = 'b'.repeat(40);
const BASE = Object.freeze({
  receiptId: 'review-1577-provider-neutral',
  repository: 'Cheekyfellastef/stephan-os',
  issueNumber: 1574,
  prNumber: 1577,
  branch: 'goal-1574-provider-neutral-review-v1',
  sourceHead: HEAD,
  reviewerId: 'github-first-reviewer',
  reviewerClass: 'github-first',
  provider: 'chatgpt-github',
  modelClass: 'gpt-5.6-thinking',
  reviewerSessionId: 'review-session-2',
  implementerProvider: 'chatgpt-github',
  implementerSessionId: 'implementation-session-1',
  riskTier: 'standard',
  assuranceMode: 'independent',
  reviewScope: ['exact-head', 'changed-files', 'policy-security'],
  findings: [],
  verdict: 'clean',
  timestampUtc: '2026-07-21T16:00:00.000Z',
  proofRefs: ['proof/provider-neutral-review-pr-1577.json'],
  quorumChecks: [],
  blocker: '',
});

function review(overrides = {}) {
  return createProviderNeutralReviewReceipt({ ...BASE, ...overrides });
}

function routeInput(overrides = {}) {
  return {
    repository: BASE.repository,
    prNumber: BASE.prNumber,
    branch: BASE.branch,
    sourceHead: HEAD,
    riskTier: 'standard',
    implementerProvider: 'chatgpt-github',
    implementerSessionId: 'implementation-session-1',
    activeReviewJobs: [],
    providers: [
      {
        providerId: 'remote-codex-reviewer',
        provider: 'openai-codex',
        reviewerClass: 'remote-codex',
        state: 'unavailable',
        sessionId: 'codex-review-session',
        qualifiedRiskTiers: ['low', 'standard', 'high'],
        supportsIndependentReview: true,
        supportsDeterministicQuorum: false,
        proofQualityRank: 100,
        costRank: 50,
        latencyRank: 50,
      },
      {
        providerId: 'chatgpt-github-reviewer',
        provider: 'chatgpt-github',
        reviewerClass: 'github-first',
        state: 'available',
        sessionId: 'review-session-2',
        qualifiedRiskTiers: ['low', 'standard'],
        supportsIndependentReview: true,
        supportsDeterministicQuorum: true,
        proofQualityRank: 90,
        costRank: 1,
        latencyRank: 1,
      },
    ],
    ...overrides,
  };
}

test('accepts a bounded independent exact-head review receipt', () => {
  const candidate = review();
  const validation = validateProviderNeutralReviewReceipt(candidate, {
    repository: BASE.repository,
    issueNumber: BASE.issueNumber,
    prNumber: BASE.prNumber,
    branch: BASE.branch,
    expectedHead: HEAD,
    riskTier: 'standard',
  });
  assert.equal(validation.valid, true, validation.errors.join(','));
  assert.deepEqual(validation.findingCounts, { p0: 0, p1: 0, p2: 0 });
  assert.equal(validation.finalVerdict, 'PROVIDER_NEUTRAL_REVIEW_PASS');
});

test('rejects stale review evidence after an exact-head change', () => {
  const validation = validateProviderNeutralReviewReceipt(review(), { expectedHead: NEXT_HEAD });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('head-mismatch'));
});

test('rejects a same-session implementer review presented as independent', () => {
  const candidate = review({ reviewerSessionId: BASE.implementerSessionId });
  const validation = validateProviderNeutralReviewReceipt(candidate);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('reviewer-not-independent'));
});

test('rejects a same-session implementer review presented as specialist', () => {
  const candidate = review({
    reviewerClass: 'external-qualified',
    provider: BASE.implementerProvider,
    reviewerSessionId: BASE.implementerSessionId,
    riskTier: 'high',
    assuranceMode: 'specialist',
  });
  const validation = validateProviderNeutralReviewReceipt(candidate);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('reviewer-not-independent'));
});

test('permits a bounded deterministic quorum for non-high-risk same-session review', () => {
  const candidate = review({
    reviewerSessionId: BASE.implementerSessionId,
    assuranceMode: 'deterministic-quorum',
    quorumChecks: ['exact-head-ci', 'focused-tests', 'policy-review'],
  });
  const validation = validateProviderNeutralReviewReceipt(candidate);
  assert.equal(validation.valid, true, validation.errors.join(','));
});

test('forbids deterministic quorum from satisfying a high-risk specialist gate', () => {
  const candidate = review({
    reviewerSessionId: BASE.implementerSessionId,
    riskTier: 'high',
    assuranceMode: 'deterministic-quorum',
    quorumChecks: ['exact-head-ci', 'focused-tests', 'policy-review'],
  });
  const validation = validateProviderNeutralReviewReceipt(candidate);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('high-risk-deterministic-quorum-forbidden'));
  assert.ok(validation.errors.includes('high-risk-specialist-required'));
  assert.ok(validation.errors.includes('high-risk-specialist-assurance-required'));
});

test('rejects malformed or contradictory finding evidence', () => {
  const candidate = review({
    findings: [{ severity: 'P1', code: 'unsafe-path', summary: 'Unsafe path accepted.', path: '../secret' }],
    verdict: 'clean',
  });
  const validation = validateProviderNeutralReviewReceipt(candidate);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('unsafe-finding-path'));
  assert.ok(validation.errors.includes('clean-verdict-with-findings'));
});

test('accepts findings on source-controlled dot paths', () => {
  const candidate = review({
    findings: [{ severity: 'P2', code: 'workflow-note', summary: 'Workflow note.', path: '.github/workflows/proof.yml' }],
    verdict: 'findings',
  });
  const validation = validateProviderNeutralReviewReceipt(candidate);
  assert.equal(validation.valid, true, validation.errors.join(','));
  assert.deepEqual(validation.findingCounts, { p0: 0, p1: 0, p2: 1 });
});

test('uses only proof namespaces accepted by canonical execution receipts', () => {
  const validation = validateProviderNeutralReviewReceipt(review({ proofRefs: ['reviews/pr-1577.json'] }));
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('unsafe-proof-ref'));
});

test('routes around exhausted Codex capacity without declaring the work unbuildable', () => {
  const selection = selectProviderNeutralReviewRoute(routeInput());
  assert.equal(selection.decision, 'ROUTE_SELECTED');
  assert.equal(selection.capacityClassification, 'PROVIDER_CAPACITY_UNAVAILABLE');
  assert.equal(selection.selectedProvider.providerId, 'chatgpt-github-reviewer');
  assert.equal(selection.selectedProvider.provider, 'chatgpt-github');
  assert.equal(selection.selectedProvider.reviewerClass, 'github-first');
  assert.equal(selection.selectedProvider.assuranceMode, 'independent');
  assert.equal(selection.duplicateDispatchAllowed, false);
  assert.deepEqual(selection.binding, {
    repository: BASE.repository,
    prNumber: BASE.prNumber,
    branch: BASE.branch,
    sourceHead: HEAD,
    riskTier: 'standard',
  });
});

test('honours an explicit meter-stalled capacity state when no Codex adapter is listed', () => {
  const selection = selectProviderNeutralReviewRoute(routeInput({
    codexCapacityState: 'meter-stalled',
    providers: [routeInput().providers[1]],
  }));
  assert.equal(selection.decision, 'ROUTE_SELECTED');
  assert.equal(selection.capacityClassification, 'PROVIDER_CAPACITY_UNAVAILABLE');
});

test('does not mistake a renamed adapter for an independent provider session', () => {
  const selection = selectProviderNeutralReviewRoute(routeInput({
    providers: [
      {
        providerId: 'renamed-github-review-adapter',
        provider: 'chatgpt-github',
        reviewerClass: 'github-first',
        state: 'available',
        sessionId: 'implementation-session-1',
        qualifiedRiskTiers: ['standard'],
        supportsIndependentReview: true,
        supportsDeterministicQuorum: false,
        proofQualityRank: 100,
      },
    ],
  }));
  assert.equal(selection.decision, 'NO_QUALIFIED_REVIEW_ROUTE');
  assert.equal(selection.selectedProvider, null);
});

test('prefers an independent reviewer over a higher-ranked same-session deterministic quorum', () => {
  const selection = selectProviderNeutralReviewRoute(routeInput({
    providers: [
      {
        providerId: 'same-session-harness',
        provider: 'chatgpt-github',
        reviewerClass: 'deterministic-harness',
        state: 'available',
        sessionId: 'implementation-session-1',
        qualifiedRiskTiers: ['standard'],
        supportsIndependentReview: true,
        supportsDeterministicQuorum: true,
        proofQualityRank: 1000,
        costRank: 0,
        latencyRank: 0,
      },
      {
        providerId: 'external-independent-reviewer',
        provider: 'external-review-provider',
        reviewerClass: 'external-qualified',
        state: 'available',
        sessionId: 'external-review-session',
        qualifiedRiskTiers: ['standard'],
        supportsIndependentReview: true,
        supportsDeterministicQuorum: false,
        proofQualityRank: 10,
        costRank: 100,
        latencyRank: 100,
      },
    ],
  }));
  assert.equal(selection.decision, 'ROUTE_SELECTED');
  assert.equal(selection.selectedProvider.providerId, 'external-independent-reviewer');
  assert.equal(selection.selectedProvider.assuranceMode, 'independent');
});

test('does not dispatch a duplicate review when one is already active for the exact head', () => {
  const selection = selectProviderNeutralReviewRoute(routeInput({
    activeReviewJobs: [{
      repository: BASE.repository,
      prNumber: BASE.prNumber,
      branch: BASE.branch,
      sourceHead: HEAD,
      state: 'started',
    }],
  }));
  assert.equal(selection.decision, 'WAIT_EXISTING_REVIEW');
  assert.equal(selection.reason, 'active-review-job-already-exists');
  assert.equal(selection.selectedProvider, null);
  assert.equal(selection.duplicateDispatchAllowed, false);
});

test('requires a specialist route for high-risk work when only local fallback is available', () => {
  const selection = selectProviderNeutralReviewRoute(routeInput({
    riskTier: 'high',
    providers: [
      {
        providerId: 'remote-codex-reviewer',
        provider: 'openai-codex',
        reviewerClass: 'remote-codex',
        state: 'unavailable',
        sessionId: 'codex-review-session',
        qualifiedRiskTiers: ['high'],
        supportsIndependentReview: true,
      },
      {
        providerId: 'openclaw-local-reviewer',
        provider: 'openclaw-local',
        reviewerClass: 'openclaw-local-readonly',
        state: 'available',
        sessionId: 'local-review-session',
        qualifiedRiskTiers: ['low', 'standard', 'high'],
        supportsIndependentReview: true,
        supportsDeterministicQuorum: true,
      },
    ],
  }));
  assert.equal(selection.decision, 'SPECIALIST_REVIEW_REQUIRED');
  assert.equal(selection.capacityClassification, 'PROVIDER_CAPACITY_UNAVAILABLE');
  assert.equal(selection.selectedProvider, null);
});

test('selects an independent specialist assurance route for high-risk work', () => {
  const selection = selectProviderNeutralReviewRoute(routeInput({
    riskTier: 'high',
    providers: [
      {
        providerId: 'external-specialist-reviewer',
        provider: 'external-security-review',
        reviewerClass: 'external-qualified',
        state: 'available',
        sessionId: 'specialist-review-session',
        qualifiedRiskTiers: ['high'],
        supportsIndependentReview: true,
        proofQualityRank: 80,
      },
    ],
  }));
  assert.equal(selection.decision, 'ROUTE_SELECTED');
  assert.equal(selection.selectedProvider.assuranceMode, 'specialist');
});

test('keeps provider switching bound to the same repository PR branch and full head', () => {
  const selection = selectProviderNeutralReviewRoute(routeInput());
  assert.equal(selection.binding.repository, BASE.repository);
  assert.equal(selection.binding.prNumber, BASE.prNumber);
  assert.equal(selection.binding.branch, BASE.branch);
  assert.equal(selection.binding.sourceHead, HEAD);
  assert.equal(selection.binding.sourceHead.length, 40);
});

test('converts a valid review into a valid canonical execution receipt', () => {
  const converted = providerNeutralReviewToExecutionReceipt(review(), {
    repository: BASE.repository,
    issueNumber: BASE.issueNumber,
    prNumber: BASE.prNumber,
    branch: BASE.branch,
    expectedHead: HEAD,
    riskTier: 'standard',
  });
  assert.equal(converted.ok, true, converted.executionValidation?.errors?.join(','));
  assert.equal(converted.receipt.workerType, 'github-first');
  assert.equal(converted.receipt.state, 'completed');
  assert.equal(converted.receipt.phase, 'provider-neutral-review-clean');
  assert.equal(converted.receipt.sourceHead, HEAD);
  assert.deepEqual(converted.receipt.proofRefs, BASE.proofRefs);
});

test('converts a blocked review to a failed execution receipt with its blocker preserved', () => {
  const candidate = review({
    verdict: 'blocked',
    blocker: 'review-provider-unavailable',
  });
  const converted = providerNeutralReviewToExecutionReceipt(candidate, {
    expectedHead: HEAD,
    operatorActionRequired: true,
  });
  assert.equal(converted.ok, true, converted.executionValidation?.errors?.join(','));
  assert.equal(converted.receipt.state, 'failed');
  assert.equal(converted.receipt.phase, 'provider-neutral-review-blocked');
  assert.equal(converted.receipt.blocker, 'review-provider-unavailable');
  assert.equal(converted.receipt.operatorActionRequired, true);
});

test('fails conversion closed when the review is not bound to the expected head', () => {
  const converted = providerNeutralReviewToExecutionReceipt(review(), { expectedHead: NEXT_HEAD });
  assert.equal(converted.ok, false);
  assert.equal(converted.reason, 'head-mismatch');
  assert.equal(converted.receipt, null);
});

test('publishes read-only bounded adapter contracts for GitHub-first and local reviewers', () => {
  for (const adapter of [buildGitHubFirstReviewAdapterContract(), buildLocalReadonlyReviewAdapterContract()]) {
    assert.equal(adapter.ok, true);
    assert.equal(adapter.contract.exactHeadRequired, true);
    assert.equal(adapter.contract.mutationAllowed, false);
    assert.equal(adapter.contract.arbitraryShellAllowed, false);
    assert.equal(adapter.contract.arbitraryFilesystemAllowed, false);
    assert.equal(adapter.contract.credentialsReadable, false);
    assert.equal(adapter.contract.rawOutputRequired, true);
    assert.equal(adapter.contract.normalizedReceiptRequired, true);
    assert.equal(adapter.contract.executionReceiptRequired, true);
  }
});
