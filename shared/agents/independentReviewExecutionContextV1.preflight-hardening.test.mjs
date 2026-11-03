import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIndependentReviewExecutionContextV1,
} from './independentReviewExecutionContextV1.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_SCHEMA,
} from './independentReviewWorkflowDispatchPreflightV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const sourceHead = '1'.repeat(40);
const baseSha = '2'.repeat(40);
const branch = 'fix/example-review-head-v1';

function authority() {
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
  };
}

function pullRequest({ draft = false, state = 'open' } = {}) {
  return {
    number: 42,
    state,
    draft,
    head: { ref: branch, sha: sourceHead, repo: { full_name: repository } },
    base: { ref: 'main', sha: baseSha, repo: { full_name: repository } },
  };
}

function preflight(overrides = {}) {
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

function dispatchInput(dispatchPreflight) {
  return {
    eventName: 'workflow_dispatch',
    repository,
    job: 'independent-security-review',
    legacyEvent: null,
    dispatchPreflight,
  };
}

test('caller-shaped preflight cannot substitute workflow identity', () => {
  for (const candidate of [
    preflight({ workflowName: 'Other Review' }),
    preflight({ workflowPath: '.github/workflows/other.yml' }),
    preflight({ workflowJob: 'other-job' }),
  ]) {
    assert.throws(
      () => buildIndependentReviewExecutionContextV1(dispatchInput(candidate)),
      /complete trusted review identity/,
    );
  }
});

test('unknown preflight fields fail closed', () => {
  assert.throws(
    () => buildIndependentReviewExecutionContextV1(dispatchInput({ ...preflight(), extraAuthority: true })),
    /complete trusted review identity/,
  );
});

test('draft pull-request snapshots remain reviewable but never gain mutation authority', () => {
  const draft = preflight({ pullRequest: pullRequest({ draft: true }) });
  const result = buildIndependentReviewExecutionContextV1(dispatchInput(draft));
  assert.equal(result.source, 'workflow_dispatch');
  assert.equal(result.prNumber, 42);
  assert.equal(result.authority.reviewExecutionAllowed, true);
  assert.equal(result.authority.sourceMutationAllowed, false);
  assert.equal(result.authority.approvalAllowed, false);
  assert.equal(result.authority.mergeAllowed, false);
  assert.equal(result.authority.deploymentAllowed, false);
  assert.equal(result.authority.runtimeMutationAllowed, false);
  assert.equal(result.authority.providerQualificationAllowed, false);
  assert.equal(result.authority.leaseSeizureAllowed, false);
  assert.equal(result.authority.arbitraryCommandAllowed, false);
});

test('closed or malformed draft-state pull-request snapshots cannot be smuggled into dispatch execution', () => {
  const closed = preflight({ pullRequest: pullRequest({ state: 'closed' }) });
  assert.throws(
    () => buildIndependentReviewExecutionContextV1(dispatchInput(closed)),
    /complete trusted review identity/,
  );

  const malformedDraft = preflight({ pullRequest: { ...pullRequest(), draft: 'yes' } });
  assert.throws(
    () => buildIndependentReviewExecutionContextV1(dispatchInput(malformedDraft)),
    /complete trusted review identity/,
  );
});

test('canonical preflight remains accepted after full revalidation', () => {
  const result = buildIndependentReviewExecutionContextV1(dispatchInput(preflight()));
  assert.equal(result.source, 'workflow_dispatch');
  assert.equal(result.prNumber, 42);
  assert.equal(result.sourceHead, sourceHead);
  assert.equal(result.baseSha, baseSha);
  assert.equal(result.authority.reviewExecutionAllowed, true);
  assert.equal(result.authority.mergeAllowed, false);
});
