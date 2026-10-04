import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_MARKER,
  evaluateDirectOperatorIntentGithubCommentV1,
  extractDirectOperatorIntentGithubCommentV1,
  selectDirectOperatorIntentGithubCommentV1,
} from './directOperatorIntentGithubCommentV1.mjs';

const ISSUE = 1903;

function receipt(overrides = {}) {
  return {
    schemaVersion: 'stephanos.direct-operator-intent-standing-authority.v1',
    repository: 'Cheekyfellastef/stephan-os',
    operator: 'Cheekyfellastef',
    requestId: 'chatgpt-20261004-autonomous-build-closure-v1',
    goalId: 'goal-1903',
    originSurface: 'chatgpt',
    intent: 'Build, test, independently review, protected-merge and continue without manual courier work.',
    directOperatorRequest: true,
    boundedScope: true,
    requestedOutcome: 'build-test-review-protected-merge-guarded-live',
    autoProtectedMergeRequested: true,
    guardedLiveUpdateRequested: true,
    requiresNewSensitiveAuthority: false,
    revoked: false,
    ...overrides,
  };
}

function comment(overrides = {}) {
  return {
    id: 5984364946,
    issue_url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/1903',
    user: { login: 'Cheekyfellastef' },
    author_association: 'OWNER',
    created_at: '2026-10-04T21:10:00Z',
    body: `${DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_MARKER}
\`\`\`stephanos-direct-operator-intent
${JSON.stringify(receipt(), null, 2)}
\`\`\``,
    ...overrides,
  };
}

test('owner-authenticated goal comment becomes protected standing-intent provenance', () => {
  const result = evaluateDirectOperatorIntentGithubCommentV1(comment(), { issueNumber: ISSUE });
  assert.equal(result.valid, true, JSON.stringify(result.blockers));
  assert.equal(result.receipt.goalId, 'goal-1903');
  assert.equal(result.authenticatedProvenance.authenticated, true);
  assert.equal(result.authenticatedProvenance.source, 'github-owner-authenticated-request');
  assert.equal(result.authenticatedProvenance.evidenceRef, 'github-comment-5984364946');
  assert.equal(result.authority.protectedContinuationAuthenticated, true);
  assert.equal(result.authority.protectedExactHeadMergeEligible, true);
  assert.equal(result.authority.mergeAuthority, false);
});

test('collaborator or non-owner comment cannot mint standing protected continuation', () => {
  for (const candidate of [
    comment({ user: { login: 'someone-else' } }),
    comment({ author_association: 'MEMBER' }),
  ]) {
    const result = evaluateDirectOperatorIntentGithubCommentV1(candidate, { issueNumber: ISSUE });
    assert.equal(result.valid, false);
    assert.equal(result.authority.protectedContinuationAuthenticated, false);
  }
});

test('goal identity is exact and cross-goal reuse is blocked', () => {
  const result = evaluateDirectOperatorIntentGithubCommentV1(comment(), { issueNumber: 1904 });
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('direct-intent-comment-issue-mismatch'));
  assert.ok(result.blockers.includes('direct-intent-comment-goal-mismatch'));
});

test('latest owner intent controls and a later revocation cannot fall back to an older grant', () => {
  const granted = comment({ id: 10, created_at: '2026-10-04T20:00:00Z' });
  const revokedReceipt = receipt({ requestId: 'chatgpt-20261004-revocation', revoked: true });
  const revoked = comment({
    id: 11,
    created_at: '2026-10-04T21:00:00Z',
    body: `${DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_MARKER}
\`\`\`stephanos-direct-operator-intent
${JSON.stringify(revokedReceipt, null, 2)}
\`\`\``,
  });
  const result = selectDirectOperatorIntentGithubCommentV1([granted, revoked], { issueNumber: ISSUE });
  assert.equal(result.valid, false);
  assert.equal(result.commentId, 11);
  assert.ok(result.blockers.includes('authorization-revoked'));
});

test('marker and fenced payload are exact to prevent ambiguous authority parsing', () => {
  const duplicate = `${comment().body}\n${DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_MARKER}`;
  const extracted = extractDirectOperatorIntentGithubCommentV1(duplicate);
  assert.equal(extracted.ok, false);
  assert.equal(extracted.blocker, 'direct-intent-comment-marker-not-exact');
});
