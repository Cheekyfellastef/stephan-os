import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRECT_OPERATOR_INTENT_GITHUB_MARKER,
  evaluateDirectOperatorIntentGithubCommentV1,
  selectLatestDirectOperatorIntentGithubCommentV1,
} from './directOperatorIntentGithubProvenanceV1.mjs';

function receipt(overrides = {}) {
  return {
    schemaVersion: 'stephanos.direct-operator-intent-standing-authority.v1',
    repository: 'Cheekyfellastef/stephan-os',
    operator: 'Cheekyfellastef',
    requestId: 'chat-20261004-autonomous-promotion-001',
    goalId: 'goal-1903',
    originSurface: 'chatgpt',
    intent: 'Close the trusted promotion seam without repeating the same operator decision.',
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
function comment(id, value = receipt(), login = 'Cheekyfellastef') {
  const fence = String.fromCharCode(96).repeat(3);
  return {
    id,
    user: { login },
    body: 'text before\n\n' + fence + DIRECT_OPERATOR_INTENT_GITHUB_MARKER + '\n' + JSON.stringify(value) + '\n' + fence + '\n',
  };
}

test('owner-authenticated exact-goal comment produces trusted protected-continuation provenance', () => {
  const result = evaluateDirectOperatorIntentGithubCommentV1(comment(5984432903), { expectedGoalId: 'goal-1903' });
  assert.equal(result.ok, true);
  assert.equal(result.receipt.goalId, 'goal-1903');
  assert.equal(result.provenance.source, 'github-owner-authenticated-request');
  assert.equal(result.provenance.evidenceRef, 'github-issue-comment:5984432903');
  assert.equal(result.evaluation.protectedExactHeadMergeEligible, true);
  assert.equal(result.evaluation.guardedLiveUpdateEligible, true);
});

test('foreign authors and wrong-goal markers cannot mint authority', () => {
  assert.equal(evaluateDirectOperatorIntentGithubCommentV1(comment(1, receipt(), 'attacker'), { expectedGoalId: 'goal-1903' }).applicable, false);
  assert.equal(evaluateDirectOperatorIntentGithubCommentV1(comment(2, receipt({ goalId: 'goal-9999' })), { expectedGoalId: 'goal-1903' }).applicable, false);
});

test('latest matching owner marker controls revocation instead of falling back to older authority', () => {
  const selected = selectLatestDirectOperatorIntentGithubCommentV1([
    comment(10),
    comment(11, receipt({ revoked: true })),
  ], { expectedGoalId: 'goal-1903' });
  assert.equal(selected.applicable, true);
  assert.equal(selected.ok, false);
  assert.equal(selected.commentId, 11);
  assert.equal(selected.receipt.revoked, true);
});

test('newer unrelated goal marker does not shadow exact-goal authority', () => {
  const selected = selectLatestDirectOperatorIntentGithubCommentV1([
    comment(20),
    comment(21, receipt({ goalId: 'goal-2670' })),
  ], { expectedGoalId: 'goal-1903' });
  assert.equal(selected.ok, true);
  assert.equal(selected.commentId, 20);
});
