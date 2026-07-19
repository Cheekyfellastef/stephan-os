import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  parseOptionalManualPrNumber,
} from './exactHeadReviewDispatchCoordinator.mjs';

const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'b'.repeat(40);
const NOW = '2026-07-19T16:30:00Z';
const TRUSTED_COORDINATOR = 'Cheekyfellastef';
const UNTRUSTED_ACTOR = 'untrusted-commenter';
const TRUSTED_CODEX_REVIEWER = Object.freeze({
  login: 'chatgpt-codex-connector[bot]',
  type: 'Bot',
  id: 199175422,
});

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
    trustedCoordinatorLogin: TRUSTED_COORDINATOR,
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

function coordinatorComment({ id, body, createdAt }) {
  return { id, body, createdAt, user: { login: TRUSTED_COORDINATOR } };
}

test('dispatches exactly once after all required exact-head workflows succeed', () => {
  const first = evaluateExactHeadReviewDispatch(baseInput());
  assert.equal(first.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
  assert.equal(first.actionRequired, true);
  assert.equal(first.duplicateDispatchAllowed, false);

  const second = evaluateExactHeadReviewDispatch(baseInput({
    comments: [coordinatorComment({ id: 1, body: marker(EXACT_HEAD_REVIEW_MARKERS.DISPATCH), createdAt: '2026-07-19T16:29:00Z' })],
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
      { id: 2, body: `Codex Review\n\n**Reviewed commit:** \`${OLD_HEAD.slice(0, 10)}\``, user: TRUSTED_CODEX_REVIEWER, createdAt: '2026-07-19T16:01:00Z' },
    ],
  }));
  assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
});

test('records a matching Codex receipt once and then remains terminal for that head', () => {
  const external = {
    id: 91,
    body: `Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${HEAD.slice(0, 10)}\``,
    user: TRUSTED_CODEX_REVIEWER,
    createdAt: '2026-07-19T16:29:30Z',
  };
  const record = evaluateExactHeadReviewDispatch(baseInput({ comments: [external] }));
  assert.equal(record.decision, EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT);
  assert.equal(record.externalReceiptId, 91);

  const recorded = evaluateExactHeadReviewDispatch(baseInput({
    comments: [
      external,
      coordinatorComment({ id: 92, body: marker(EXACT_HEAD_REVIEW_MARKERS.RECEIPT), createdAt: '2026-07-19T16:29:40Z' }),
    ],
  }));
  assert.equal(recorded.decision, EXACT_HEAD_REVIEW_DECISION.REVIEW_RECEIPT_RECORDED);
  assert.equal(recorded.actionRequired, false);
});

test('accepts a review object only when its exact commit matches', () => {
  const matching = evaluateExactHeadReviewDispatch(baseInput({
    reviews: [{ id: 22, commitId: HEAD, body: 'Automated review', user: TRUSTED_CODEX_REVIEWER, submittedAt: '2026-07-19T16:29:00Z' }],
  }));
  assert.equal(matching.decision, EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT);

  const stale = evaluateExactHeadReviewDispatch(baseInput({
    reviews: [{ id: 23, commitId: OLD_HEAD, body: 'Automated review', user: TRUSTED_CODEX_REVIEWER, submittedAt: '2026-07-19T16:29:00Z' }],
  }));
  assert.equal(stale.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
});

test('accepts only the authenticated Codex GitHub App identity', () => {
  const untrustedActors = [
    { login: 'fake-chatgpt-codex-connector', type: 'Bot', id: 199175422 },
    { login: 'chatgpt-codex-connector', type: 'User', id: 199175422 },
    { login: 'codex', type: 'User', id: 199175422 },
    { login: 'chatgpt-codex-connector[bot]', type: 'User', id: 199175422 },
    { login: 'chatgpt-codex-connector[bot]', type: 'Bot', id: 12345 },
  ];
  for (const [index, user] of untrustedActors.entries()) {
    const result = evaluateExactHeadReviewDispatch(baseInput({
      comments: [{
        id: 24 + index,
        body: `Codex Review\n\n**Reviewed commit:** \`${HEAD.slice(0, 10)}\``,
        user,
        createdAt: '2026-07-19T16:29:00Z',
      }],
    }));
    assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
  }

  const exactBot = evaluateExactHeadReviewDispatch(baseInput({
    comments: [{
      id: 25,
      body: `Codex Review\n\n**Reviewed commit:** \`${HEAD.slice(0, 10)}\``,
      user: TRUSTED_CODEX_REVIEWER,
      createdAt: '2026-07-19T16:29:00Z',
    }],
  }));
  assert.equal(exactBot.decision, EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT);
});

test('escalates once when a posted request has no receipt after the bounded timeout', () => {
  const dispatch = coordinatorComment({ id: 40, body: marker(EXACT_HEAD_REVIEW_MARKERS.DISPATCH), createdAt: '2026-07-19T16:25:00Z' });
  const result = evaluateExactHeadReviewDispatch(baseInput({ now: '2026-07-19T16:40:00Z', comments: [dispatch], receiptTimeoutMs: 10 * 60 * 1000 }));
  assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.ESCALATE_MISSING_RECEIPT);
  assert.equal(result.actionRequired, true);

  const alreadyEscalated = evaluateExactHeadReviewDispatch(baseInput({
    now: '2026-07-19T16:40:00Z',
    comments: [
      dispatch,
      coordinatorComment({ id: 41, body: marker(EXACT_HEAD_REVIEW_MARKERS.ESCALATION), createdAt: '2026-07-19T16:36:00Z' }),
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
  const options = { prNumber: 1559, trustedCoordinatorLogin: TRUSTED_COORDINATOR };
  const trustedComment = (body) => ({ body, user: { login: TRUSTED_COORDINATOR } });
  assert.equal(isCanonicalReviewLaneComment(trustedComment(`<!-- ${EXACT_HEAD_REVIEW_MARKERS.AUTO} -->`), options), true);
  assert.equal(isCanonicalReviewLaneComment(trustedComment('Programme Completion Controller canonical-lane receipt\nThis PR is the sole active implementation lane.'), options), true);
  assert.equal(isCanonicalReviewLaneComment(trustedComment('Programme Completion Controller\nThis PR remains draft and non-canonical.'), options), false);
  assert.equal(isCanonicalReviewLaneComment(trustedComment('Programme Completion Controller\nThis PR is not the canonical implementation lane.'), options), false);
  assert.equal(isCanonicalReviewLaneComment(trustedComment('Programme Completion Controller\nPR #1559 is superseded by PR #1560.'), options), false);
  assert.equal(isCanonicalReviewLaneComment(trustedComment([
    'Programme Completion Controller canonical-lane receipt',
    'This PR is the sole active implementation lane.',
    'PR #1555 remains draft and non-canonical.',
    'Issue #1418 is queued until this lane reaches terminal state.',
  ].join('\n')), options), true);
  assert.equal(isCanonicalReviewLaneComment(trustedComment([
    'Programme Completion Controller canonical-lane receipt',
    'Active lane: PR #1559.',
    'PR #1558 is superseded by PR #1559.',
  ].join('\n')), options), true);

  const evidence = canonicalLaneEvidence([
    { id: 1, body: 'unrelated', createdAt: '2026-07-19T10:00:00Z', user: { login: TRUSTED_COORDINATOR } },
    coordinatorComment({ id: 2, body: 'Programme Completion Controller\nActive lane: PR #1559', createdAt: '2026-07-19T11:00:00Z' }),
  ], options);
  assert.equal(evidence.confirmed, true);
  assert.equal(evidence.commentId, 2);
});

test('authenticates canonical-lane evidence and binds explicit lane references to the evaluated PR', () => {
  const options = { prNumber: 1559, trustedCoordinatorLogin: TRUSTED_COORDINATOR };
  const forged = canonicalLaneEvidence([{
    id: 70,
    body: 'Programme Completion Controller\nActive lane: PR #1559',
    createdAt: '2026-07-19T16:00:00Z',
    user: { login: UNTRUSTED_ACTOR },
  }], options);
  assert.equal(forged.confirmed, false);

  const wrongPr = canonicalLaneEvidence([
    coordinatorComment({
      id: 71,
      body: 'Programme Completion Controller\nActive lane: PR #1558',
      createdAt: '2026-07-19T16:01:00Z',
    }),
  ], options);
  assert.equal(wrongPr.confirmed, false);

  const matchingPr = canonicalLaneEvidence([
    coordinatorComment({
      id: 72,
      body: 'Programme Completion Controller\nActive lane: PR #1559',
      createdAt: '2026-07-19T16:02:00Z',
    }),
  ], options);
  assert.equal(matchingPr.confirmed, true);
  assert.equal(matchingPr.commentId, 72);
});

test('a later trusted controller revocation supersedes stale canonical-lane evidence', () => {
  const options = { prNumber: 1559, trustedCoordinatorLogin: TRUSTED_COORDINATOR };
  const evidence = canonicalLaneEvidence([
    coordinatorComment({
      id: 73,
      body: 'Programme Completion Controller\nActive lane: PR #1559',
      createdAt: '2026-07-19T16:02:00Z',
    }),
    coordinatorComment({
      id: 74,
      body: 'Programme Completion Controller\nThis PR is queued and no longer the canonical implementation lane.',
      createdAt: '2026-07-19T16:02:00Z',
    }),
  ], options);
  assert.equal(evidence.confirmed, false);
  assert.equal(evidence.revoked, true);
  assert.equal(evidence.commentId, 74);
});

test('manual PR numbers accept only safe positive decimal digits', () => {
  assert.equal(parseOptionalManualPrNumber(''), null);
  assert.equal(parseOptionalManualPrNumber('1559'), 1559);
  assert.equal(parseOptionalManualPrNumber(' 1559 '), 1559);
  for (const malformed of ['0', '-1', '+1559', '1e3', '1.0', '1559x', '9007199254740992']) {
    assert.throws(() => parseOptionalManualPrNumber(malformed), /positive decimal integer/);
  }
});

test('ignores forged coordinator markers for dispatch, receipt and escalation state', () => {
  const forgedDispatch = evaluateExactHeadReviewDispatch(baseInput({
    comments: [{
      id: 80,
      body: marker(EXACT_HEAD_REVIEW_MARKERS.DISPATCH),
      createdAt: '2026-07-19T16:29:00Z',
      user: { login: UNTRUSTED_ACTOR },
    }],
  }));
  assert.equal(forgedDispatch.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);

  const external = {
    id: 81,
    body: `Codex Review\n\n**Reviewed commit:** \`${HEAD.slice(0, 10)}\``,
    createdAt: '2026-07-19T16:29:10Z',
    user: TRUSTED_CODEX_REVIEWER,
  };
  const forgedReceipt = evaluateExactHeadReviewDispatch(baseInput({
    comments: [
      external,
      {
        id: 82,
        body: marker(EXACT_HEAD_REVIEW_MARKERS.RECEIPT),
        createdAt: '2026-07-19T16:29:20Z',
        user: { login: UNTRUSTED_ACTOR },
      },
    ],
  }));
  assert.equal(forgedReceipt.decision, EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT);

  const trustedDispatch = coordinatorComment({ id: 83, body: marker(EXACT_HEAD_REVIEW_MARKERS.DISPATCH), createdAt: '2026-07-19T16:25:00Z' });
  const forgedEscalation = evaluateExactHeadReviewDispatch(baseInput({
    now: '2026-07-19T16:40:00Z',
    receiptTimeoutMs: 10 * 60 * 1000,
    comments: [
      trustedDispatch,
      {
        id: 84,
        body: marker(EXACT_HEAD_REVIEW_MARKERS.ESCALATION),
        createdAt: '2026-07-19T16:36:00Z',
        user: { login: UNTRUSTED_ACTOR },
      },
    ],
  }));
  assert.equal(forgedEscalation.decision, EXACT_HEAD_REVIEW_DECISION.ESCALATE_MISSING_RECEIPT);
});

test('accepts review receipts only after successful exact-head workflow completion', () => {
  const earlyExternal = {
    id: 90,
    body: `Codex Review\n\n**Reviewed commit:** \`${HEAD.slice(0, 10)}\``,
    createdAt: '2026-07-19T16:23:59Z',
    user: TRUSTED_CODEX_REVIEWER,
  };
  const staleDurableReceipt = coordinatorComment({
    id: 91,
    body: marker(EXACT_HEAD_REVIEW_MARKERS.RECEIPT),
    createdAt: '2026-07-19T16:29:00Z',
  });
  const early = evaluateExactHeadReviewDispatch(baseInput({ comments: [earlyExternal, staleDurableReceipt] }));
  assert.equal(early.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);

  const ambiguousSameSecond = { ...earlyExternal, id: 95, createdAt: '2026-07-19T16:24:00Z' };
  const ambiguous = evaluateExactHeadReviewDispatch(baseInput({ comments: [ambiguousSameSecond] }));
  assert.equal(ambiguous.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);

  const postWorkflowExternal = { ...earlyExternal, id: 92, createdAt: '2026-07-19T16:24:01Z' };
  const beforeExternalMarker = coordinatorComment({
    id: 93,
    body: marker(EXACT_HEAD_REVIEW_MARKERS.RECEIPT),
    createdAt: '2026-07-19T16:24:00Z',
  });
  const causal = evaluateExactHeadReviewDispatch(baseInput({ comments: [postWorkflowExternal, beforeExternalMarker] }));
  assert.equal(causal.decision, EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT);
});

test('orders same-second durable receipts causally and treats review IDs as incomparable', () => {
  const externalComment = {
    id: 100,
    body: `Codex Review\n\n**Reviewed commit:** \`${HEAD.slice(0, 10)}\``,
    createdAt: '2026-07-19T16:29:30Z',
    user: TRUSTED_CODEX_REVIEWER,
  };
  const earlierMarker = coordinatorComment({
    id: 99,
    body: marker(EXACT_HEAD_REVIEW_MARKERS.RECEIPT),
    createdAt: '2026-07-19T16:29:30Z',
  });
  const earlier = evaluateExactHeadReviewDispatch(baseInput({ comments: [externalComment, earlierMarker] }));
  assert.equal(earlier.decision, EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT);

  const laterMarker = coordinatorComment({
    id: 101,
    body: marker(EXACT_HEAD_REVIEW_MARKERS.RECEIPT),
    createdAt: '2026-07-19T16:29:30Z',
  });
  const later = evaluateExactHeadReviewDispatch(baseInput({ comments: [externalComment, laterMarker] }));
  assert.equal(later.decision, EXACT_HEAD_REVIEW_DECISION.REVIEW_RECEIPT_RECORDED);

  const externalReview = {
    id: 200,
    commitId: HEAD,
    body: 'Automated review',
    submittedAt: '2026-07-19T16:29:30Z',
    user: TRUSTED_CODEX_REVIEWER,
  };
  const incomparable = evaluateExactHeadReviewDispatch(baseInput({ reviews: [externalReview], comments: [laterMarker] }));
  assert.equal(incomparable.decision, EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT);
});

test('requires workflow completion timestamps and ignores pre-proof dispatch markers', () => {
  const untimedRuns = successfulRuns();
  delete untimedRuns[0].updatedAt;
  const untimed = evaluateExactHeadReviewDispatch(baseInput({ workflowRuns: untimedRuns }));
  assert.equal(untimed.decision, EXACT_HEAD_REVIEW_DECISION.WAIT_WORKFLOWS);
  assert.deepEqual(untimed.unboundWorkflows, [REQUIRED_EXACT_HEAD_WORKFLOWS[0]]);

  const staleDispatch = coordinatorComment({
    id: 94,
    body: marker(EXACT_HEAD_REVIEW_MARKERS.DISPATCH),
    createdAt: '2026-07-19T16:23:59Z',
  });
  const result = evaluateExactHeadReviewDispatch(baseInput({ comments: [staleDispatch] }));
  assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
});

test('wires the trusted coordinator identity through the runner and trusted workflow', () => {
  const runner = fs.readFileSync(new URL('../../scripts/exact-head-review-dispatch.mjs', import.meta.url), 'utf8');
  const workflow = fs.readFileSync(new URL('../../.github/workflows/exact-head-review-dispatch.yml', import.meta.url), 'utf8');
  assert.match(runner, /bounded GitHub token actor must match trusted coordinator/);
  assert.match(runner, /trustedCoordinatorLogin:\s*coordinatorLogin/);
  assert.match(runner, /parseOptionalManualPrNumber\(process\.env\.STEPHANOS_EXACT_HEAD_REVIEW_PR\)/);
  assert.match(runner, /const numbers = \(await listOpenPullRequests/);
  assert.match(runner, /REQUESTED_PR_NOT_CANONICAL/);
  assert.match(workflow, /STEPHANOS_REVIEW_COORDINATOR_LOGIN:\s*\$\{\{ github\.repository_owner \}\}/);
  assert.match(workflow, /STEPHANOS_REVIEW_DISPATCH_TOKEN:\s*\$\{\{ secrets\.STEPHANOS_REVIEW_DISPATCH_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /\|\|\s*github\.token/);
});

test('runs every required proof workflow for every pull request head', () => {
  const workflowPaths = [
    '../../.github/workflows/openclaw-github-operator.yml',
    '../../.github/workflows/build-stephanos-ui.yml',
    '../../.github/workflows/battle-bridge-publisher-proof.yml',
    '../../.github/workflows/codex-dispatch-queue-proof.yml',
  ];
  for (const path of workflowPaths) {
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    const lines = source.split(/\r?\n/);
    const start = lines.findIndex((line) => /^  pull_request:\s*$/.test(line));
    assert.notEqual(start, -1, `${path} must define a pull_request trigger`);
    const block = [];
    for (const line of lines.slice(start + 1)) {
      if (line.trim() && !line.startsWith('    ')) break;
      block.push(line);
    }
    assert.doesNotMatch(block.join('\n'), /^\s+paths:\s*$/m, `${path} must not path-filter required PR proof`);
  }
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
