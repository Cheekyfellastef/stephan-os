import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXACT_HEAD_REVIEW_DECISION,
  EXACT_HEAD_REVIEW_MARKERS,
  REQUIRED_EXACT_HEAD_WORKFLOWS,
  buildMissingReceiptEscalationComment,
  buildReviewDispatchComment,
  buildReviewReceiptComment,
  canonicalLaneEvidence,
  evaluateExactHeadReviewDispatch,
  isCanonicalReviewLaneComment,
} from './exactHeadReviewDispatchCoordinator.mjs';

const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'b'.repeat(40);
const NOW = '2026-07-19T16:30:00Z';

function successfulRuns(headSha = HEAD) {
  return REQUIRED_EXACT_HEAD_WORKFLOWS.map((name, index) => ({
    id: index + 1,
    name,
    headSha,
    status: 'completed',
    conclusion: 'success',
    updatedAt: `2026-07-19T16:2${index}:00Z`,
  }));
}

function baseInput(overrides = {}) {
  return {
    now: NOW,
    canonicalLaneConfirmed: true,
    pr: {
      number: 1559,
      state: 'open',
      baseRef: 'main',
      headSha: HEAD,
      sameRepository: true,
    },
    workflowRuns: successfulRuns(),
    comments: [],
    reviews: [],
    ...overrides,
  };
}

function marker(kind, headSha = HEAD) {
  return `<!-- ${kind} head=${headSha} -->`;
}

test('dispatches exactly once after all required exact-head workflows succeed', () => {
  const first = evaluateExactHeadReviewDispatch(baseInput());
  assert.equal(first.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
  assert.equal(first.actionRequired, true);
  assert.equal(first.duplicateDispatchAllowed, false);

  const second = evaluateExactHeadReviewDispatch(baseInput({
    comments: [{ id: 1, body: marker(EXACT_HEAD_REVIEW_MARKERS.DISPATCH), createdAt: '2026-07-19T16:29:00Z' }],
  }));
  assert.equal(second.decision, EXACT_HEAD_REVIEW_DECISION.WAIT_REVIEW_RECEIPT);
  assert.equal(second.actionRequired, false);
});

test('waits when any required workflow is missing or still running', () => {
  const missing = evaluateExactHeadReviewDispatch(baseInput({ workflowRuns: successfulRuns().slice(1) }));
  assert.equal(missing.decision, EXACT_HEAD_REVIEW_DECISION.WAIT_WORKFLOWS);
  assert.deepEqual(missing.missingWorkflows, [REQUIRED_EXACT_HEAD_WORKFLOWS[0]]);

  const pendingRuns = successfulRuns();
  pendingRuns[2] = { ...pendingRuns[2], status: 'in_progress', conclusion: null };
  const pending = evaluateExactHeadReviewDispatch(baseInput({ workflowRuns: pendingRuns }));
  assert.equal(pending.decision, EXACT_HEAD_REVIEW_DECISION.WAIT_WORKFLOWS);
  assert.deepEqual(pending.pendingWorkflows, [REQUIRED_EXACT_HEAD_WORKFLOWS[2]]);
});

test('blocks review dispatch when a required workflow fails', () => {
  const runs = successfulRuns();
  runs[4] = { ...runs[4], conclusion: 'failure' };
  const result = evaluateExactHeadReviewDispatch(baseInput({ workflowRuns: runs }));
  assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.BLOCKED_WORKFLOWS);
  assert.deepEqual(result.failedWorkflows, [REQUIRED_EXACT_HEAD_WORKFLOWS[4]]);
});

test('ignores dispatch and review evidence tied to an older head', () => {
  const result = evaluateExactHeadReviewDispatch(baseInput({
    comments: [
      { id: 1, body: marker(EXACT_HEAD_REVIEW_MARKERS.DISPATCH, OLD_HEAD), createdAt: '2026-07-19T16:00:00Z' },
      { id: 2, body: `Codex Review\n\n**Reviewed commit:** \`${OLD_HEAD.slice(0, 10)}\``, user: { login: 'chatgpt-codex-connector[bot]' }, createdAt: '2026-07-19T16:01:00Z' },
    ],
  }));
  assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
});

test('records a matching Codex receipt once and then remains terminal for that head', () => {
  const external = {
    id: 91,
    body: `Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${HEAD.slice(0, 10)}\``,
    user: { login: 'chatgpt-codex-connector[bot]' },
    createdAt: '2026-07-19T16:29:30Z',
  };
  const record = evaluateExactHeadReviewDispatch(baseInput({ comments: [external] }));
  assert.equal(record.decision, EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT);
  assert.equal(record.externalReceiptId, 91);

  const recorded = evaluateExactHeadReviewDispatch(baseInput({
    comments: [
      external,
      { id: 92, body: marker(EXACT_HEAD_REVIEW_MARKERS.RECEIPT), createdAt: '2026-07-19T16:29:40Z' },
    ],
  }));
  assert.equal(recorded.decision, EXACT_HEAD_REVIEW_DECISION.REVIEW_RECEIPT_RECORDED);
  assert.equal(recorded.actionRequired, false);
});

test('accepts a review object only when its exact commit matches', () => {
  const matching = evaluateExactHeadReviewDispatch(baseInput({
    reviews: [{ id: 22, commitId: HEAD, body: 'Automated review', user: { login: 'codex[bot]' }, submittedAt: '2026-07-19T16:29:00Z' }],
  }));
  assert.equal(matching.decision, EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT);

  const stale = evaluateExactHeadReviewDispatch(baseInput({
    reviews: [{ id: 23, commitId: OLD_HEAD, body: 'Automated review', user: { login: 'codex[bot]' }, submittedAt: '2026-07-19T16:29:00Z' }],
  }));
  assert.equal(stale.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
});

test('escalates once when a posted request has no receipt after the bounded timeout', () => {
  const dispatch = { id: 40, body: marker(EXACT_HEAD_REVIEW_MARKERS.DISPATCH), createdAt: '2026-07-19T16:10:00Z' };
  const result = evaluateExactHeadReviewDispatch(baseInput({ comments: [dispatch], receiptTimeoutMs: 10 * 60 * 1000 }));
  assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.ESCALATE_MISSING_RECEIPT);
  assert.equal(result.actionRequired, true);

  const alreadyEscalated = evaluateExactHeadReviewDispatch(baseInput({
    comments: [
      dispatch,
      { id: 41, body: marker(EXACT_HEAD_REVIEW_MARKERS.ESCALATION), createdAt: '2026-07-19T16:21:00Z' },
    ],
    receiptTimeoutMs: 10 * 60 * 1000,
  }));
  assert.equal(alreadyEscalated.decision, EXACT_HEAD_REVIEW_DECISION.WAIT_REVIEW_RECEIPT);
  assert.equal(alreadyEscalated.escalated, true);
  assert.equal(alreadyEscalated.actionRequired, false);
});

test('fails closed without canonical lane evidence or for an external head repository', () => {
  const noOwner = evaluateExactHeadReviewDispatch(baseInput({ canonicalLaneConfirmed: false }));
  assert.equal(noOwner.decision, EXACT_HEAD_REVIEW_DECISION.INELIGIBLE);

  const fork = evaluateExactHeadReviewDispatch(baseInput({ pr: { ...baseInput().pr, sameRepository: false } }));
  assert.equal(fork.decision, EXACT_HEAD_REVIEW_DECISION.INELIGIBLE);
});

test('recognizes explicit auto markers and bounded canonical controller receipts only', () => {
  assert.equal(isCanonicalReviewLaneComment(`<!-- ${EXACT_HEAD_REVIEW_MARKERS.AUTO} -->`), true);
  assert.equal(isCanonicalReviewLaneComment('Programme Completion Controller canonical-lane receipt\nThis PR is the sole active implementation lane.'), true);
  assert.equal(isCanonicalReviewLaneComment('Programme Completion Controller\nThis PR remains draft and non-canonical.'), false);

  const evidence = canonicalLaneEvidence([
    { id: 1, body: 'unrelated', createdAt: '2026-07-19T10:00:00Z' },
    { id: 2, body: 'Programme Completion Controller\nActive lane: PR #1559', createdAt: '2026-07-19T11:00:00Z' },
  ]);
  assert.equal(evidence.confirmed, true);
  assert.equal(evidence.commentId, 2);
});

test('renders exact-head dispatch, receipt and escalation comments with durable markers', () => {
  const dispatch = buildReviewDispatchComment({ prNumber: 1559, headSha: HEAD });
  assert.match(dispatch, new RegExp(EXACT_HEAD_REVIEW_MARKERS.DISPATCH));
  assert.match(dispatch, /@codex review/);
  assert.match(dispatch, new RegExp(HEAD));

  const receipt = buildReviewReceiptComment({ prNumber: 1559, headSha: HEAD, externalReceiptId: 91 });
  assert.match(receipt, new RegExp(EXACT_HEAD_REVIEW_MARKERS.RECEIPT));
  assert.match(receipt, /External review receipt: 91/);

  const escalation = buildMissingReceiptEscalationComment({ prNumber: 1559, headSha: HEAD, timeoutMinutes: 10, dispatchCommentId: 40 });
  assert.match(escalation, new RegExp(EXACT_HEAD_REVIEW_MARKERS.ESCALATION));
  assert.match(escalation, /Duplicate review dispatch is rejected/);
});
