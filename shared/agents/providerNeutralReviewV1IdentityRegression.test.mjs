import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProviderNeutralReviewReceipt,
  selectProviderNeutralReviewRoute,
  validateProviderNeutralReviewReceipt,
} from './providerNeutralReviewV1.mjs';

const HEAD = 'c'.repeat(40);

function baseReceipt(overrides = {}) {
  return createProviderNeutralReviewReceipt({
    receiptId: 'review-1577-identity-regression',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1574,
    prNumber: 1577,
    branch: 'goal-1574-provider-neutral-review-v1',
    sourceHead: HEAD,
    reviewerId: 'identity-regression-reviewer',
    reviewerClass: 'github-first',
    provider: 'chatgpt-github',
    modelClass: 'gpt-5.6-thinking',
    reviewerSessionId: 'review-session',
    implementerProvider: 'chatgpt-github',
    implementerSessionId: 'implementation-session',
    riskTier: 'standard',
    assuranceMode: 'independent',
    reviewScope: ['exact-head', 'identity'],
    findings: [],
    verdict: 'clean',
    timestampUtc: '2026-07-21T16:40:00.000Z',
    proofRefs: ['proof/provider-neutral-review-identity.json'],
    quorumChecks: [],
    blocker: '',
    ...overrides,
  });
}

test('does not silently bind a receipt with no issue number to issue 1574', () => {
  const candidate = baseReceipt({ issueNumber: undefined });
  const validation = validateProviderNeutralReviewReceipt(candidate);
  assert.equal(candidate.issueNumber, 0);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('invalid-issue-number'));
});

test('does not select an unknown reviewer class for standard-risk work', () => {
  const selection = selectProviderNeutralReviewRoute({
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1577,
    branch: 'goal-1574-provider-neutral-review-v1',
    sourceHead: HEAD,
    riskTier: 'standard',
    implementerProvider: 'chatgpt-github',
    implementerSessionId: 'implementation-session',
    activeReviewJobs: [],
    providers: [
      {
        providerId: 'unknown-review-adapter',
        provider: 'unknown-provider',
        reviewerClass: 'unknown-reviewer-class',
        state: 'available',
        sessionId: 'unknown-review-session',
        qualifiedRiskTiers: ['standard'],
        supportsIndependentReview: true,
        supportsDeterministicQuorum: true,
        proofQualityRank: 1000,
      },
    ],
  });
  assert.equal(selection.decision, 'NO_QUALIFIED_REVIEW_ROUTE');
  assert.equal(selection.selectedProvider, null);
  assert.equal(selection.duplicateDispatchAllowed, false);
});
