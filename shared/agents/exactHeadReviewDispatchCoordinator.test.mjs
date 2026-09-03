import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  INDEPENDENT_REVIEW_JOB,
  INDEPENDENT_REVIEW_WORKFLOW_NAME,
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
  buildProtectedSecurityReviewReceipt,
} from './operatorMergeApprovalGate.mjs';
import {
  EXACT_HEAD_REVIEW_DECISION,
  EXACT_HEAD_REVIEW_MARKERS,
  EXACT_HEAD_REVIEW_PROGRESS,
  REQUIRED_EXACT_HEAD_WORKFLOWS,
  REQUIRED_EXACT_HEAD_WORKFLOW_PATHS,
  buildMissingReceiptEscalationComment,
  buildReviewDispatchComment,
  buildReviewReceiptComment,
  candidateReviewPrNumbers,
  canonicalLaneEvidence,
  exactHeadReviewProgress,
  evaluateExactHeadReviewDispatch,
  explicitOwnerExactHeadReviewRequest,
  isCanonicalReviewLaneComment,
  parseOptionalManualPrNumber,
} from './exactHeadReviewDispatchCoordinator.mjs';

const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'b'.repeat(40);
const NOW = '2026-07-19T16:30:00Z';
const TRUSTED_COORDINATOR = 'Cheekyfellastef';
const UNTRUSTED_ACTOR = 'untrusted-commenter';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BRANCH = 'agent/provider-neutral-review';
const BASE_SHA = 'c'.repeat(40);
const REVIEW_RUN_ID = 123;
const REVIEW_RUN_ATTEMPT = 1;
const REVIEW_WORKFLOW_ID = 456;
const TRUSTED_CODEX_REVIEWER = Object.freeze({
  login: 'chatgpt-codex-connector[bot]',
  type: 'Bot',
  id: 199175422,
});
const TRUSTED_GITHUB_ACTIONS_REVIEWER = Object.freeze({
  login: 'github-actions[bot]',
  type: 'Bot',
  id: 41898282,
});

function independentReviewRun(overrides = {}) {
  const run = {
    id: REVIEW_RUN_ID,
    run_attempt: REVIEW_RUN_ATTEMPT,
    workflow_id: REVIEW_WORKFLOW_ID,
    name: INDEPENDENT_REVIEW_WORKFLOW_NAME,
    path: INDEPENDENT_REVIEW_WORKFLOW_PATH,
    event: 'pull_request_target',
    repository: { full_name: REPOSITORY },
    head_sha: BASE_SHA,
    status: 'completed',
    conclusion: 'success',
    pull_requests: [{
      number: 1559,
      head: { sha: HEAD, ref: BRANCH },
      base: { sha: BASE_SHA, ref: 'main' },
    }],
  };
  return { ...run, ...overrides };
}

function independentReviewJobs(overrides = {}) {
  return [{
    id: 9001,
    name: INDEPENDENT_REVIEW_JOB,
    run_attempt: REVIEW_RUN_ATTEMPT,
    run_url: `https://api.github.com/repos/${REPOSITORY}/actions/runs/${REVIEW_RUN_ID}`,
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  }];
}

function successfulRuns(headSha = HEAD) {
  return REQUIRED_EXACT_HEAD_WORKFLOWS.map((name, index) => ({
    id: index + 1,
    name,
    workflowPath: REQUIRED_EXACT_HEAD_WORKFLOW_PATHS[name],
    headSha,
    status: 'completed',
    conclusion: 'success',
    updatedAt: `2026-07-19T16:2${index}:00Z`,
  }));
}

function baseInput(overrides = {}) {
  return {
    repository: REPOSITORY,
    now: NOW,
    trustedCoordinatorLogin: TRUSTED_COORDINATOR,
    canonicalLaneConfirmed: true,
    pr: {
      number: 1559,
      state: 'open',
      baseRef: 'main',
      baseSha: BASE_SHA,
      headRef: BRANCH,
      headSha: HEAD,
      sameRepository: true,
    },
    workflowRuns: successfulRuns(),
    independentReviewWorkflowId: REVIEW_WORKFLOW_ID,
    independentReviewRuns: [independentReviewRun()],
    independentReviewJobsByRunId: {
      [String(REVIEW_RUN_ID)]: independentReviewJobs(),
    },
    unresolvedThreadCount: 0,
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

test('surfaces an exact-head and exact-base review as precomputed while workflows finish', () => {
  const pendingRuns = successfulRuns();
  pendingRuns[2] = { ...pendingRuns[2], status: 'in_progress', conclusion: null };
  const result = evaluateExactHeadReviewDispatch(baseInput({
    workflowRuns: pendingRuns,
    comments: [providerNeutralComment({ createdAt: '2026-07-19T16:10:00Z' })],
  }));
  assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.WAIT_WORKFLOWS_REVIEW_READY);
  assert.equal(result.reviewReady, true);
  assert.equal(result.externalReceiptId, 93);
  assert.deepEqual(result.pendingWorkflows, [REQUIRED_EXACT_HEAD_WORKFLOWS[2]]);
  assert.equal(
    exactHeadReviewProgress(result.decision),
    EXACT_HEAD_REVIEW_PROGRESS.REVIEW_PRECOMPUTED,
  );
});

test('blocks review dispatch when a required workflow fails', () => {
  const runs = successfulRuns();
  runs[4] = { ...runs[4], conclusion: 'failure' };
  const result = evaluateExactHeadReviewDispatch(baseInput({ workflowRuns: runs }));
  assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.BLOCKED_WORKFLOWS);
  assert.deepEqual(result.failedWorkflows, [REQUIRED_EXACT_HEAD_WORKFLOWS[4]]);
});

test('precomputes during CI but blocks receipt consumption until every review thread is resolved', () => {
  const pendingRuns = successfulRuns();
  pendingRuns[2] = { ...pendingRuns[2], status: 'in_progress', conclusion: null };
  const receipt = providerNeutralComment({ createdAt: '2026-07-19T16:10:00Z' });
  const precomputed = evaluateExactHeadReviewDispatch(baseInput({
    workflowRuns: pendingRuns,
    comments: [receipt],
    unresolvedThreadCount: 1,
  }));
  assert.equal(precomputed.decision, EXACT_HEAD_REVIEW_DECISION.WAIT_WORKFLOWS_REVIEW_READY);
  assert.equal(precomputed.reviewReady, true);

  const blocked = evaluateExactHeadReviewDispatch(baseInput({
    comments: [receipt],
    unresolvedThreadCount: 1,
  }));
  assert.equal(blocked.decision, EXACT_HEAD_REVIEW_DECISION.BLOCKED_REVIEW_THREADS);
  assert.equal(blocked.unresolvedThreadCount, 1);
  assert.equal(blocked.reviewReady, true);
  assert.equal(exactHeadReviewProgress(blocked.decision), EXACT_HEAD_REVIEW_PROGRESS.BLOCKED);

  const unavailable = evaluateExactHeadReviewDispatch(baseInput({
    comments: [receipt],
    unresolvedThreadCount: null,
  }));
  assert.equal(unavailable.decision, EXACT_HEAD_REVIEW_DECISION.BLOCKED_REVIEW_THREADS);
  assert.equal(unavailable.unresolvedThreadCount, null);

  const dispatchWithoutReceipt = evaluateExactHeadReviewDispatch(baseInput({
    unresolvedThreadCount: 2,
  }));
  assert.equal(dispatchWithoutReceipt.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
  assert.equal(dispatchWithoutReceipt.actionRequired, true);
});

test('binds required workflow proofs to source-controlled workflow paths', () => {
  const runs = successfulRuns();
  const requiredName = REQUIRED_EXACT_HEAD_WORKFLOWS[1];
  runs[1] = { ...runs[1], conclusion: 'failure', updatedAt: '2026-07-19T16:20:00Z' };
  runs.push({
    ...runs[1],
    id: 99,
    workflowPath: '.github/workflows/lookalike-pr-clean.yml',
    conclusion: 'success',
    updatedAt: '2026-07-19T16:29:00Z',
  });
  const result = evaluateExactHeadReviewDispatch(baseInput({ workflowRuns: runs }));
  assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.BLOCKED_WORKFLOWS);
  assert.deepEqual(result.failedWorkflows, [requiredName]);
});

test('ignores dispatch and review evidence tied to an older head', () => {
  const result = evaluateExactHeadReviewDispatch(baseInput({
    comments: [
      { id: 1, body: marker(EXACT_HEAD_REVIEW_MARKERS.DISPATCH, OLD_HEAD), createdAt: '2026-07-19T16:00:00Z' },
      { id: 2, body: `Codex Review\n\n**Reviewed commit:** \`${OLD_HEAD}\``, user: TRUSTED_CODEX_REVIEWER, createdAt: '2026-07-19T16:01:00Z' },
    ],
  }));
  assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
});

test('records a matching Codex receipt once and then remains terminal for that head', () => {
  const external = {
    id: 91,
    body: `Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${HEAD}\``,
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


function providerNeutralComment({
  id = 93,
  headSha = HEAD,
  user = TRUSTED_GITHUB_ACTIONS_REVIEWER,
  createdAt = '2026-07-19T16:29:30Z',
  workflowRunId = REVIEW_RUN_ID,
  workflowRunAttempt = REVIEW_RUN_ATTEMPT,
} = {}) {
  const receipt = buildProtectedSecurityReviewReceipt({
    repository: REPOSITORY,
    prNumber: 1559,
    branch: BRANCH,
    sourceHead: headSha,
    workflowRunId,
    workflowRunAttempt,
    timestampUtc: createdAt,
    analysis: {
      schemaVersion: 'stephanos.independent-security-analysis.v1',
      findings: [],
      counts: { P0: 0, P1: 0, P2: 0 },
      verdict: 'clean',
      proofRefs: ['proofs/changed-file/shared/agents/example.mjs'],
      finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_CLEAN',
    },
  });
  return {
    id,
    body: `<!-- stephanos-protected-security-review -->
\`\`\`json
${JSON.stringify(receipt, null, 2)}
\`\`\``,
    user,
    createdAt,
    receipt,
  };
}

test('records only a workflow-bound authenticated provider-neutral GitHub Actions receipt', () => {
  const result = evaluateExactHeadReviewDispatch(baseInput({
    comments: [providerNeutralComment()],
  }));
  assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT);
  assert.equal(result.externalReceiptId, 93);
  assert.match(result.reason, /authenticated exact-head review receipt/i);
});

test('keeps a validated artifact receipt durably discoverable through the trusted coordinator index', () => {
  const external = providerNeutralComment({ createdAt: '2026-07-19T16:10:00Z' });
  const body = buildReviewReceiptComment({
    prNumber: 1559,
    headSha: HEAD,
    externalReceiptId: external.id,
    providerNeutralReceipt: external.receipt,
  });
  assert.match(body, new RegExp(EXACT_HEAD_REVIEW_MARKERS.ARTIFACT_INDEX));
  assert.match(body, /stephanos-protected-security-review/);
  assert.match(body, /stephanos\.provider-neutral\.review/);

  const durableIndex = coordinatorComment({
    id: 94,
    body,
    createdAt: '2026-07-19T16:29:40Z',
  });
  const recorded = evaluateExactHeadReviewDispatch(baseInput({ comments: [durableIndex] }));
  assert.equal(recorded.decision, EXACT_HEAD_REVIEW_DECISION.REVIEW_RECEIPT_RECORDED);
  assert.equal(recorded.receiptCommentId, 94);

  const forged = evaluateExactHeadReviewDispatch(baseInput({
    comments: [{ ...durableIndex, user: { login: UNTRUSTED_ACTOR } }],
  }));
  assert.equal(forged.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
});

test('rejects forged, stale or workflow-unbound provider-neutral review comments', () => {
  const forgedActor = evaluateExactHeadReviewDispatch(baseInput({
    comments: [providerNeutralComment({
      user: { ...TRUSTED_GITHUB_ACTIONS_REVIEWER, id: 7 },
    })],
  }));
  assert.equal(forgedActor.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);

  const staleHead = evaluateExactHeadReviewDispatch(baseInput({
    comments: [providerNeutralComment({ headSha: OLD_HEAD })],
  }));
  assert.equal(staleHead.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);

  const missingRun = evaluateExactHeadReviewDispatch(baseInput({
    comments: [providerNeutralComment()],
    independentReviewRuns: [],
    independentReviewJobsByRunId: {},
  }));
  assert.equal(missingRun.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);

  const lookalikeWorkflow = evaluateExactHeadReviewDispatch(baseInput({
    comments: [providerNeutralComment()],
    independentReviewRuns: [independentReviewRun({
      path: '.github/workflows/lookalike-independent-review.yml',
    })],
  }));
  assert.equal(lookalikeWorkflow.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);

  const wrongBase = evaluateExactHeadReviewDispatch(baseInput({
    comments: [providerNeutralComment()],
    independentReviewRuns: [independentReviewRun({
      pull_requests: [{
        number: 1559,
        head: { sha: HEAD, ref: BRANCH },
        base: { sha: OLD_HEAD, ref: 'main' },
      }],
    })],
  }));
  assert.equal(wrongBase.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);

  const failedJob = evaluateExactHeadReviewDispatch(baseInput({
    comments: [providerNeutralComment()],
    independentReviewJobsByRunId: {
      [String(REVIEW_RUN_ID)]: independentReviewJobs({ conclusion: 'failure' }),
    },
  }));
  assert.equal(failedJob.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
});

test('provider-neutral handoff never dispatches the Codex reviewer', () => {
  const body = buildReviewDispatchComment({ prNumber: 1559, headSha: HEAD });
  assert.match(body, /Provider-neutral exact-head review handoff/);
  assert.match(body, /does not request or consume Codex review capacity/);
  assert.doesNotMatch(body, /@codex review/);
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
        body: `Codex Review\n\n**Reviewed commit:** \`${HEAD}\``,
        user,
        createdAt: '2026-07-19T16:29:00Z',
      }],
    }));
    assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
  }

  const exactBot = evaluateExactHeadReviewDispatch(baseInput({
    comments: [{
      id: 25,
      body: `Codex Review\n\n**Reviewed commit:** \`${HEAD}\``,
      user: TRUSTED_CODEX_REVIEWER,
      createdAt: '2026-07-19T16:29:00Z',
    }],
  }));
  assert.equal(exactBot.decision, EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT);

  const ambiguousPrefix = evaluateExactHeadReviewDispatch(baseInput({
    comments: [{
      id: 30,
      body: `Codex Review\n\n**Reviewed commit:** \`${HEAD.slice(0, 12)}\``,
      user: TRUSTED_CODEX_REVIEWER,
      createdAt: '2026-07-19T16:29:00Z',
    }],
  }));
  assert.equal(ambiguousPrefix.decision, EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW);
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
  assert.equal(alreadyEscalated.decision, EXACT_HEAD_REVIEW_DECISION.STALLED_MISSING_RECEIPT);
  assert.equal(alreadyEscalated.escalated, true);
  assert.equal(alreadyEscalated.actionRequired, false);
});

test('keeps normal waiting distinct from a persistent missing-receipt stall', () => {
  assert.equal(exactHeadReviewProgress(EXACT_HEAD_REVIEW_DECISION.WAIT_WORKFLOWS), EXACT_HEAD_REVIEW_PROGRESS.WAITING_FOR_WORKFLOWS);
  assert.equal(exactHeadReviewProgress(EXACT_HEAD_REVIEW_DECISION.WAIT_WORKFLOWS_REVIEW_READY), EXACT_HEAD_REVIEW_PROGRESS.REVIEW_PRECOMPUTED);
  assert.equal(exactHeadReviewProgress(EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW), EXACT_HEAD_REVIEW_PROGRESS.REVIEW_DISPATCHED);
  assert.equal(exactHeadReviewProgress(EXACT_HEAD_REVIEW_DECISION.WAIT_REVIEW_RECEIPT), EXACT_HEAD_REVIEW_PROGRESS.WAITING_FOR_RECEIPT);
  assert.equal(exactHeadReviewProgress(EXACT_HEAD_REVIEW_DECISION.ESCALATE_MISSING_RECEIPT), EXACT_HEAD_REVIEW_PROGRESS.STALLED_MISSING_RECEIPT);
  assert.equal(exactHeadReviewProgress(EXACT_HEAD_REVIEW_DECISION.STALLED_MISSING_RECEIPT), EXACT_HEAD_REVIEW_PROGRESS.STALLED_MISSING_RECEIPT);
  assert.equal(exactHeadReviewProgress(EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT), EXACT_HEAD_REVIEW_PROGRESS.RECEIPT_RECORDED);
  assert.equal(exactHeadReviewProgress(EXACT_HEAD_REVIEW_DECISION.REVIEW_RECEIPT_RECORDED), EXACT_HEAD_REVIEW_PROGRESS.REVIEW_COMPLETE);
  assert.equal(exactHeadReviewProgress(EXACT_HEAD_REVIEW_DECISION.BLOCKED_WORKFLOWS), EXACT_HEAD_REVIEW_PROGRESS.BLOCKED);
});

test('fails closed without canonical lane evidence or for an external head repository', () => {
  const noOwner = evaluateExactHeadReviewDispatch(baseInput({ canonicalLaneConfirmed: false }));
  assert.equal(noOwner.decision, EXACT_HEAD_REVIEW_DECISION.INELIGIBLE);

  const fork = evaluateExactHeadReviewDispatch(baseInput({ pr: { ...baseInput().pr, sameRepository: false } }));
  assert.equal(fork.decision, EXACT_HEAD_REVIEW_DECISION.INELIGIBLE);
});

test('requires explicit PR identity and eligibility evidence', () => {
  for (const number of [null, '', 0, -1, 1.5]) {
    const result = evaluateExactHeadReviewDispatch(baseInput({ pr: { ...baseInput().pr, number } }));
    assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.INVALID_INPUT);
  }

  for (const field of ['sameRepository', 'state', 'baseRef']) {
    const pr = { ...baseInput().pr };
    delete pr[field];
    const result = evaluateExactHeadReviewDispatch(baseInput({ pr }));
    assert.equal(result.decision, EXACT_HEAD_REVIEW_DECISION.INELIGIBLE);
  }
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
  assert.equal(isCanonicalReviewLaneComment(trustedComment(
    'Programme Completion Controller\nPR #1558 is superseded by PR #1559, the sole canonical implementation lane.',
  ), options), true);
  assert.equal(isCanonicalReviewLaneComment(trustedComment(
    'Programme Completion Controller\nPR #1559 supersedes PR #1558 and is the sole canonical implementation lane.',
  ), options), true);
  assert.equal(isCanonicalReviewLaneComment(trustedComment(
    'Programme Completion Controller\nPR #1559 supersedes PR #1558 and is the sole canonical implementation lane.',
  ), { ...options, prNumber: 1558 }), false);

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

test('an explicit trusted reassignment revokes the previously active lane', () => {
  const options = { prNumber: 1559, trustedCoordinatorLogin: TRUSTED_COORDINATOR };
  const evidence = canonicalLaneEvidence([
    coordinatorComment({
      id: 75,
      body: 'Programme Completion Controller\nActive lane: PR #1559',
      createdAt: '2026-07-19T16:04:00Z',
    }),
    coordinatorComment({
      id: 76,
      body: 'Programme Completion Controller\nActive lane: PR #1560',
      createdAt: '2026-07-19T16:05:00Z',
    }),
  ], options);
  assert.equal(evidence.confirmed, false);
  assert.equal(evidence.revoked, true);
  assert.equal(evidence.commentId, 76);
});

test('manual PR numbers accept only safe positive decimal digits', () => {
  assert.equal(parseOptionalManualPrNumber(''), null);
  assert.equal(parseOptionalManualPrNumber('1559'), 1559);
  assert.equal(parseOptionalManualPrNumber(' 1559 '), 1559);
  for (const malformed of ['0', '-1', '+1559', '1e3', '1.0', '1559x', '9007199254740992']) {
    assert.throws(() => parseOptionalManualPrNumber(malformed), /positive decimal integer/);
  }
});

test('targets the event PR directly and preserves independent workflow-run lanes', () => {
  assert.deepEqual(candidateReviewPrNumbers({ event: { issue: { number: 1706, pull_request: {} } } }), [1706]);
  assert.deepEqual(candidateReviewPrNumbers({
    event: { workflow_run: { pull_requests: [{ number: 1706 }, { number: 1703 }, { number: 1706 }] } },
  }), [1706, 1703]);
  assert.deepEqual(candidateReviewPrNumbers({
    event: { issue: { number: 1706, pull_request: {} } },
    manualPrNumber: 1703,
  }), [1703]);
  assert.deepEqual(candidateReviewPrNumbers({ event: {} }), []);
  assert.throws(() => candidateReviewPrNumbers({ manualPrNumber: 0 }), /safe positive integer/);
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
    body: `Codex Review\n\n**Reviewed commit:** \`${HEAD}\``,
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

test('consumes precomputed exact-base receipts after workflows while generic app reviews remain post-workflow', () => {
  const earlyExternal = {
    id: 90,
    body: `Codex Review\n\n**Reviewed commit:** \`${HEAD}\``,
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

  const precomputedProviderReceipt = providerNeutralComment({
    id: 96,
    createdAt: '2026-07-19T16:10:00Z',
  });
  const providerReady = evaluateExactHeadReviewDispatch(baseInput({
    comments: [precomputedProviderReceipt],
  }));
  assert.equal(providerReady.decision, EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT);
  assert.equal(providerReady.externalReceiptId, 96);

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
    body: `Codex Review\n\n**Reviewed commit:** \`${HEAD}\``,
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
  const workflow = fs
    .readFileSync(new URL('../../.github/workflows/exact-head-review-dispatch.yml', import.meta.url), 'utf8')
    .replace(/\r\n?/g, '\n');
  assert.match(runner, /bounded GitHub token actor is not authorised/);
  assert.match(runner, /selectReviewCoordinatorCredential\(process\.env\)/);
  assert.match(runner, /const laneAuthorityLogin = trustedLaneAuthorityLogin\(owner\)/);
  assert.match(runner, /trustedCoordinatorLogin:\s*MACHINE_COORDINATOR_SENTINEL_LOGIN/);
  assert.match(runner, /parseOptionalManualPrNumber\(process\.env\.STEPHANOS_EXACT_HEAD_REVIEW_PR\)/);
  assert.match(runner, /requestedNumbers\.length \? loadRequestedCanonicalContexts : discoverCanonicalContexts/);
  assert.match(runner, /unresolvedThreadCount\(owner, repo, prNumber, token\)/);
  assert.match(runner, /unresolvedThreadCount: context\.unresolvedThreadCount/);
  assert.match(runner, /validateIndependentReviewArtifact\(artifact/);
  assert.match(runner, /STEPHANOS_TRIGGER_REVIEW_ARTIFACT_REQUIRED/);
  assert.match(runner, /independentReviewArtifactComments/);
  assert.match(runner, /mapWithConcurrency\(openPullRequests, 8/);
  assert.doesNotMatch(runner, /multiple canonical review lanes detected/);
  assert.match(runner, /REQUESTED_PR_NOT_CANONICAL/);
  assert.match(runner, /GitHub pagination exceeded.*refusing partial evidence/);
  assert.match(runner, /EXACT_HEAD_REVIEW_PROGRESS_PR_/);
  assert.match(runner, /STEPHANOS_EXACT_HEAD_REVIEW_PLAN_ONLY/);
  assert.match(runner, /EXACT_HEAD_REVIEW_PLAN_TARGETS/);
  assert.match(runner, /mutation execution requires exactly one PR-scoped coordinator target/);
  assert.doesNotMatch(workflow, /github\.event\.workflow_run\.pull_requests\[0\]\.number/);
  assert.match(workflow, /targets:\s*\$\{\{ steps\.admit\.outputs\.targets \}\}/);
  assert.match(workflow, /target:\s*\$\{\{ fromJSON\(needs\.plan\.outputs\.targets\) \}\}/);
  assert.match(workflow, /group: exact-head-review-dispatch-\$\{\{ github\.repository \}\}-pr-\$\{\{ matrix\.target\.prNumber \}\}/);
  assert.match(workflow, /STEPHANOS_INDEPENDENT_REVIEW_RETRY_PR:\s*\$\{\{ matrix\.target\.prNumber \}\}/);
  assert.match(workflow, /STEPHANOS_INDEPENDENT_REVIEW_RETRY_HEAD:\s*\$\{\{ fromJSON\(steps\.coordinate\.outputs\.retry_targets\)\[0\]\.exactHead \}\}/);
  assert.match(workflow, /max-parallel:\s*4/);
  assert.match(workflow, /uses: actions\/download-artifact@v4/);
  assert.match(workflow, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(workflow, /STEPHANOS_TRIGGER_REVIEW_ARTIFACT_REQUIRED/);
  assert.doesNotMatch(workflow, /steps\.coordinate\.outputs\.decision ==/);
  assert.match(workflow, /Progress: `VERIFIED_ONLY`/);
  assert.match(workflow, /Progress: `PULL_REQUEST_PLAN_NEUTRAL`/);
  assert.match(
    workflow,
    /Discover canonical PR targets without mutation\n        id: plan\n        if: >-\n          github\.event_name != 'pull_request'/,
  );
  assert.match(workflow, /workflows:[\s\S]*Independent Merge Security Review/);
  assert.match(workflow, /GITHUB_TOKEN:\s*\$\{\{ github\.token \}\}/);
  assert.match(workflow, /STEPHANOS_REVIEW_LANE_AUTHORITY_LOGIN:\s*\$\{\{ github\.repository_owner \}\}/);
  assert.doesNotMatch(workflow, /STEPHANOS_REVIEW_DISPATCH_TOKEN:/);
});

test('runs every required proof workflow for every pull request head', () => {
  const workflowPaths = [
    '../../.github/workflows/exact-head-review-dispatch.yml',
    '../../.github/workflows/openclaw-github-operator.yml',
    '../../.github/workflows/pr-clean.yml',
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
    assert.match(
      source,
      /ref:\s*\$\{\{[^\n]*github\.event\.pull_request\.head\.sha/,
      `${path} must check out the exact pull request head`,
    );
  }
});

test('renders exact-head dispatch, receipt and escalation comments with durable markers', () => {
  const dispatch = buildReviewDispatchComment({ prNumber: 1559, headSha: HEAD });
  assert.match(dispatch, new RegExp(EXACT_HEAD_REVIEW_MARKERS.DISPATCH));
  assert.match(dispatch, /Provider-neutral exact-head review handoff/);
  assert.match(dispatch, /does not request or consume Codex review capacity/);
  assert.doesNotMatch(dispatch, /@codex review/);
  assert.match(dispatch, new RegExp(HEAD));

  const receipt = buildReviewReceiptComment({ prNumber: 1559, headSha: HEAD, externalReceiptId: 91 });
  assert.match(receipt, new RegExp(EXACT_HEAD_REVIEW_MARKERS.RECEIPT));
  assert.match(receipt, /External review receipt: 91/);

  const escalation = buildMissingReceiptEscalationComment({ prNumber: 1559, headSha: HEAD, timeoutMinutes: 10, dispatchCommentId: 40 });
  assert.match(escalation, new RegExp(EXACT_HEAD_REVIEW_MARKERS.ESCALATION));
  assert.match(escalation, /Duplicate dispatch is rejected/);

  assert.throws(() => buildReviewDispatchComment({ prNumber: 0, headSha: HEAD }), /valid PR number/);
  assert.throws(() => buildReviewReceiptComment({ prNumber: -1, headSha: HEAD }), /valid PR number/);
  assert.throws(() => buildMissingReceiptEscalationComment({ prNumber: '', headSha: HEAD }), /valid PR number/);
});


test('exact owner review request is bounded to one PR and exact head', () => {
  const headSha = 'a'.repeat(40);
  const request = explicitOwnerExactHeadReviewRequest({
    laneAuthorityLogin: 'Cheekyfellastef',
    event: {
      issue: { number: 1868, pull_request: { url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/pulls/1868' } },
      comment: {
        id: 5473673649,
        body: '/stephanos-review ' + headSha + '\n\nQUALIFIED_BOOTSTRAP_AUTHORIZED=true',
        user: { login: 'Cheekyfellastef', type: 'User' },
      },
    },
  });
  assert.deepEqual(request, {
    authorized: true,
    prNumber: 1868,
    headSha,
    commentId: 5473673649,
  });

  assert.equal(explicitOwnerExactHeadReviewRequest({
    laneAuthorityLogin: 'Cheekyfellastef',
    event: {
      issue: { number: 1868, pull_request: {} },
      comment: { body: '/stephanos-review ' + headSha, user: { login: 'github-actions[bot]', type: 'Bot' } },
    },
  }).authorized, false);

  assert.equal(explicitOwnerExactHeadReviewRequest({
    laneAuthorityLogin: 'Cheekyfellastef',
    event: {
      issue: { number: 1868, pull_request: {} },
      comment: { body: '/stephanos-review short-head', user: { login: 'Cheekyfellastef', type: 'User' } },
    },
  }).authorized, false);
});

test('exact owner review request can substitute only for missing canonical lane evidence', () => {
  const headSha = 'a'.repeat(40);
  const baseInput = {
    repository: 'Cheekyfellastef/stephan-os',
    now: '2026-08-31T04:21:30.000Z',
    trustedCoordinatorLogin: 'Cheekyfellastef',
    canonicalLaneConfirmed: false,
    ownerExactHeadReviewRequested: true,
    pr: {
      number: 1868,
      state: 'open',
      baseRef: 'main',
      baseSha: 'b'.repeat(40),
      headRef: 'agent/personal-repository-bootstrap-policy-v1',
      headSha,
      sameRepository: true,
    },
    workflowRuns: [],
    unresolvedThreadCount: 0,
    comments: [],
    reviews: [],
  };
  const admitted = evaluateExactHeadReviewDispatch(baseInput);
  assert.notEqual(admitted.decision, 'INELIGIBLE');

  const blocked = evaluateExactHeadReviewDispatch({
    ...baseInput,
    ownerExactHeadReviewRequested: false,
  });
  assert.equal(blocked.decision, 'INELIGIBLE');

  const crossRepo = evaluateExactHeadReviewDispatch({
    ...baseInput,
    pr: { ...baseInput.pr, sameRepository: false },
  });
  assert.equal(crossRepo.decision, 'INELIGIBLE');
});
