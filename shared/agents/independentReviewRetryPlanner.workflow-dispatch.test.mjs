import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INDEPENDENT_REVIEW_RETRY_DECISION,
  planIndependentReviewRetry,
} from './independentReviewRetryPlanner.mjs';
import {
  independentReviewWorkflowDispatchRunNameV1,
} from './independentReviewRunDiscoveryV1.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_NAME,
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
} from './operatorMergeApprovalGate.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const BRANCH = 'agent/openclaw-oc1';
const WORKFLOW_ID = 326000001;

function pr() {
  return {
    number: 1910,
    state: 'open',
    draft: false,
    sameRepository: true,
    headRef: BRANCH,
    headSha: HEAD,
    baseRef: 'main',
    baseSha: BASE,
  };
}

function workflow() {
  return {
    id: WORKFLOW_ID,
    name: INDEPENDENT_REVIEW_WORKFLOW_NAME,
    path: INDEPENDENT_REVIEW_WORKFLOW_PATH,
    state: 'active',
  };
}

function dispatchedRun(overrides = {}) {
  return {
    id: 8100,
    run_number: 44,
    run_attempt: 1,
    workflow_id: WORKFLOW_ID,
    name: INDEPENDENT_REVIEW_WORKFLOW_NAME,
    path: INDEPENDENT_REVIEW_WORKFLOW_PATH,
    event: 'workflow_dispatch',
    repository: { full_name: REPOSITORY },
    head_branch: 'main',
    head_sha: BASE,
    display_title: independentReviewWorkflowDispatchRunNameV1({
      prNumber: 1910,
      expectedHead: HEAD,
      expectedBase: BASE,
    }),
    status: 'queued',
    conclusion: null,
    created_at: '2026-08-20T09:00:00Z',
    pull_requests: [],
    ...overrides,
  };
}

function plan(runs) {
  return planIndependentReviewRetry({ repository: REPOSITORY, workflow: workflow(), pr: pr(), runs });
}

test('a queued exact workflow_dispatch review suppresses another missing-run launch', () => {
  const result = plan([dispatchedRun()]);
  assert.equal(result.decision, INDEPENDENT_REVIEW_RETRY_DECISION.WAIT_RUNNING);
  assert.equal(result.runEvent, 'workflow_dispatch');
  assert.equal(result.mutationAllowed, false);
});

test('a successful exact workflow_dispatch review is recognized as terminal success', () => {
  const result = plan([dispatchedRun({ status: 'completed', conclusion: 'success' })]);
  assert.equal(result.decision, INDEPENDENT_REVIEW_RETRY_DECISION.ALREADY_SUCCESSFUL);
  assert.equal(result.mutationAllowed, false);
});

test('a failed exact workflow_dispatch review stays inside the existing failed-job retry budget', () => {
  const result = plan([dispatchedRun({ status: 'completed', conclusion: 'failure' })]);
  assert.equal(result.decision, INDEPENDENT_REVIEW_RETRY_DECISION.RERUN_FAILED_JOBS);
  assert.equal(result.operation, 'rerun-failed-jobs');
  assert.equal(result.mutationAllowed, true);
});

test('workflow_dispatch lookalikes cannot suppress a genuine missing run', () => {
  const cases = [
    dispatchedRun({ head_branch: 'feature' }),
    dispatchedRun({ head_sha: 'c'.repeat(40) }),
    dispatchedRun({ display_title: 'Independent Merge Security Review PR #1910' }),
    dispatchedRun({ repository: { full_name: 'other/repo' } }),
  ];
  for (const candidate of cases) {
    assert.equal(plan([candidate]).decision, INDEPENDENT_REVIEW_RETRY_DECISION.NO_MATCHING_RUN);
  }
});
