import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INDEPENDENT_REVIEW_EXECUTION_CONTEXT_SCHEMA,
  buildIndependentReviewExecutionContextV1,
} from './independentReviewExecutionContextV1.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_SCHEMA,
} from './independentReviewWorkflowDispatchPreflightV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const sourceHead = '1'.repeat(40);
const baseSha = '2'.repeat(40);
const branch = 'fix/example-review-head-v1';

function pullRequest() {
  return {
    number: 42,
    state: 'open',
    draft: false,
    head: {
      ref: branch,
      sha: sourceHead,
      repo: { full_name: repository },
    },
    base: {
      ref: 'main',
      sha: baseSha,
      repo: { full_name: repository },
    },
  };
}

function authority(overrides = {}) {
  return {
    reviewExecutionAllowed: true,
    sourceMutationAllowed: false,
    approvalAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    providerQualificationAllowed: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
    ...overrides,
  };
}

function legacyEvent() {
  return {
    repository: { full_name: repository },
    pull_request: pullRequest(),
  };
}

function dispatchPreflight(overrides = {}) {
  return {
    schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_SCHEMA,
    verdict: 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_PASS',
    repository,
    prNumber: 42,
    sourceHead,
    baseSha,
    branch,
    workflowName: 'Independent Merge Security Review',
    workflowPath: '.github/workflows/independent-merge-security-review.yml',
    workflowJob: 'independent-security-review',
    handoffBindingSha256: 'a'.repeat(64),
    handoffRunReceiptSha256: 'b'.repeat(64),
    coordinatorWorkflowRunId: 101,
    coordinatorWorkflowRunAttempt: 1,
    handoffCommentId: 202,
    pullRequest: pullRequest(),
    authority: authority(),
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    eventName: 'pull_request_target',
    repository,
    job: 'independent-security-review',
    legacyEvent: legacyEvent(),
    dispatchPreflight: null,
    ...overrides,
  };
}

test('legacy pull_request_target produces the canonical immutable review identity', () => {
  const result = buildIndependentReviewExecutionContextV1(input());
  assert.equal(result.schemaVersion, INDEPENDENT_REVIEW_EXECUTION_CONTEXT_SCHEMA);
  assert.equal(result.source, 'pull_request_target');
  assert.equal(result.repository, repository);
  assert.equal(result.prNumber, 42);
  assert.equal(result.sourceHead, sourceHead);
  assert.equal(result.baseSha, baseSha);
  assert.equal(result.branch, branch);
  assert.equal(result.baseBranch, 'main');
  assert.equal(result.handoffBindingSha256, null);
  assert.equal(result.handoffRunReceiptSha256, null);
  assert.deepEqual(result.pullRequest, {
    number: 42,
    head: { ref: branch, sha: sourceHead, repo: { full_name: repository } },
    base: { ref: 'main', sha: baseSha, repo: { full_name: repository } },
  });
  assert.equal(result.authority.reviewExecutionAllowed, true);
  assert.equal(result.authority.sourceMutationAllowed, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.pullRequest), true);
});

test('validated workflow_dispatch preflight produces the same review target plus immutable handoff lineage', () => {
  const result = buildIndependentReviewExecutionContextV1(input({
    eventName: 'workflow_dispatch',
    legacyEvent: null,
    dispatchPreflight: dispatchPreflight(),
  }));
  assert.equal(result.source, 'workflow_dispatch');
  assert.equal(result.prNumber, 42);
  assert.equal(result.sourceHead, sourceHead);
  assert.equal(result.baseSha, baseSha);
  assert.equal(result.branch, branch);
  assert.equal(result.handoffBindingSha256, 'a'.repeat(64));
  assert.equal(result.handoffRunReceiptSha256, 'b'.repeat(64));
  assert.equal(result.coordinatorWorkflowRunId, 101);
  assert.equal(result.coordinatorWorkflowRunAttempt, 1);
  assert.equal(result.handoffCommentId, 202);
  assert.equal(result.authority.mergeAllowed, false);
  assert.equal(result.authority.arbitraryCommandAllowed, false);
});

test('workflow_dispatch cannot smuggle mutation authority through a preflight-shaped record', () => {
  assert.throws(() => buildIndependentReviewExecutionContextV1(input({
    eventName: 'workflow_dispatch',
    legacyEvent: null,
    dispatchPreflight: dispatchPreflight({ authority: authority({ sourceMutationAllowed: true }) }),
  })), /complete trusted review identity/);
});

test('workflow_dispatch requires immutable handoff digests and coordinator lineage', () => {
  assert.throws(() => buildIndependentReviewExecutionContextV1(input({
    eventName: 'workflow_dispatch',
    legacyEvent: null,
    dispatchPreflight: dispatchPreflight({ handoffBindingSha256: '' }),
  })), /complete trusted review identity/);
  assert.throws(() => buildIndependentReviewExecutionContextV1(input({
    eventName: 'workflow_dispatch',
    legacyEvent: null,
    dispatchPreflight: dispatchPreflight({ coordinatorWorkflowRunId: 0 }),
  })), /complete trusted review identity/);
});

test('legacy and dispatch inputs are mutually exclusive', () => {
  assert.throws(() => buildIndependentReviewExecutionContextV1(input({
    dispatchPreflight: dispatchPreflight(),
  })), /legacy event payload/);
  assert.throws(() => buildIndependentReviewExecutionContextV1(input({
    eventName: 'workflow_dispatch',
    dispatchPreflight: dispatchPreflight(),
  })), /validated dispatch preflight/);
});

test('cross-repository and moved pull request identity fail closed on both event families', () => {
  const legacy = legacyEvent();
  legacy.pull_request.head.repo.full_name = 'other/repo';
  assert.throws(() => buildIndependentReviewExecutionContextV1(input({ legacyEvent: legacy })), /cross-repository|mismatched/);

  const preflight = dispatchPreflight();
  preflight.pullRequest.base.sha = '3'.repeat(40);
  assert.throws(() => buildIndependentReviewExecutionContextV1(input({
    eventName: 'workflow_dispatch',
    legacyEvent: null,
    dispatchPreflight: preflight,
  })), /cross-repository|mismatched/);
});

test('unknown events, wrong job and unknown top-level fields fail closed', () => {
  assert.throws(() => buildIndependentReviewExecutionContextV1(input({ eventName: 'push' })), /not allowlisted/);
  assert.throws(() => buildIndependentReviewExecutionContextV1(input({ job: 'other' })), /canonical repository and job/);
  assert.throws(() => buildIndependentReviewExecutionContextV1({ ...input(), extra: true }), /closed-world schema/);
});

test('returned execution context is detached from caller mutation', () => {
  const preflight = dispatchPreflight();
  const result = buildIndependentReviewExecutionContextV1(input({
    eventName: 'workflow_dispatch',
    legacyEvent: null,
    dispatchPreflight: preflight,
  }));
  preflight.pullRequest.head.sha = '4'.repeat(40);
  preflight.authority.mergeAllowed = true;
  assert.equal(result.sourceHead, sourceHead);
  assert.equal(result.pullRequest.head.sha, sourceHead);
  assert.equal(result.authority.mergeAllowed, false);
});
