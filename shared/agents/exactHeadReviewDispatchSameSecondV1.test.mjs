import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXACT_HEAD_REVIEW_DECISION,
  EXACT_HEAD_REVIEW_MARKERS,
  REQUIRED_EXACT_HEAD_WORKFLOWS,
  REQUIRED_EXACT_HEAD_WORKFLOW_PATHS,
  evaluateExactHeadReviewDispatch,
} from './exactHeadReviewDispatchCoordinator.mjs';

const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'b'.repeat(40);
const BASE_SHA = 'c'.repeat(40);
const TRUSTED_COORDINATOR = 'Cheekyfellastef';
const COMPLETED_AT = '2026-08-23T10:09:45Z';
const NOW = '2026-08-23T10:10:07Z';

function successfulRuns() {
  return REQUIRED_EXACT_HEAD_WORKFLOWS.map((name, index) => ({
    id: index + 1,
    name,
    workflowPath: REQUIRED_EXACT_HEAD_WORKFLOW_PATHS[name],
    headSha: HEAD,
    status: 'completed',
    conclusion: 'success',
    updatedAt: index === REQUIRED_EXACT_HEAD_WORKFLOWS.length - 1
      ? COMPLETED_AT
      : `2026-08-23T10:09:4${index}Z`,
  }));
}

function dispatchComment({ headSha = HEAD, createdAt = COMPLETED_AT, login = TRUSTED_COORDINATOR } = {}) {
  return {
    id: 5385454849,
    body: `<!-- ${EXACT_HEAD_REVIEW_MARKERS.DISPATCH} head=${headSha} -->`,
    createdAt,
    user: { login },
  };
}

function input(comments) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    now: NOW,
    trustedCoordinatorLogin: TRUSTED_COORDINATOR,
    canonicalLaneConfirmed: true,
    pr: {
      number: 1944,
      state: 'open',
      baseRef: 'main',
      baseSha: BASE_SHA,
      headRef: 'fix/execution-receipt-heartbeat-proof-timing-v1',
      headSha: HEAD,
      sameRepository: true,
    },
    workflowRuns: successfulRuns(),
    independentReviewRuns: [],
    independentReviewJobsByRunId: {},
    unresolvedThreadCount: 0,
    comments,
    reviews: [],
  };
}

test('same-second trusted exact-head handoff is current at GitHub timestamp precision', () => {
  const result = evaluateExactHeadReviewDispatch(input([dispatchComment()]));
  assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.WAIT_REVIEW_RECEIPT);
  assert.equal(result.actionRequired, false);
  assert.equal(result.duplicateDispatchAllowed, false);
  assert.equal(result.dispatchCommentId, 5385454849);
});

test('older, older-head and untrusted same-second handoffs remain ineligible', () => {
  const older = evaluateExactHeadReviewDispatch(input([
    dispatchComment({ createdAt: '2026-08-23T10:09:44Z' }),
  ]));
  assert.equal(older.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);

  const oldHead = evaluateExactHeadReviewDispatch(input([
    dispatchComment({ headSha: OLD_HEAD }),
  ]));
  assert.equal(oldHead.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);

  const untrusted = evaluateExactHeadReviewDispatch(input([
    dispatchComment({ login: 'untrusted-commenter' }),
  ]));
  assert.equal(untrusted.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
});
