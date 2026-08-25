import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateIndependentReviewWorkflowDispatchExecutionV1,
} from './independentReviewWorkflowDispatchExecutionV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const prNumber = 1919;
const sourceHead = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const branch = 'fix/ignition-canonical-convergence-gate-v1';
const workflowId = 318073448;
const runId = 32590000001;
const runAttempt = 1;
const binding = 'c'.repeat(64);

function run(overrides = {}) {
  return {
    id: runId,
    run_attempt: runAttempt,
    workflow_id: workflowId,
    name: 'Independent Merge Security Review',
    display_title: `stephanos-independent-review-pr-${prNumber}-head-${sourceHead}-binding-${binding}`,
    path: '.github/workflows/independent-merge-security-review.yml',
    event: 'workflow_dispatch',
    repository: { full_name: repository },
    head_branch: 'main',
    head_sha: baseSha,
    status: 'completed',
    conclusion: 'success',
    pull_requests: [],
    ...overrides,
  };
}

function jobs(overrides = {}) {
  return [{
    name: 'independent-security-review',
    run_attempt: runAttempt,
    run_url: `https://api.github.com/repos/${repository}/actions/runs/${runId}`,
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  }];
}

function options(overrides = {}) {
  return {
    repository,
    prNumber,
    expectedHead: sourceHead,
    expectedBranch: branch,
    expectedBaseSha: baseSha,
    expectedWorkflowId: workflowId,
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
    ...overrides,
  };
}

test('accepts exact trusted-main workflow_dispatch review with no mutable PR association', () => {
  const validation = validateIndependentReviewWorkflowDispatchExecutionV1(run(), jobs(), options());
  assert.equal(validation.valid, true);
  assert.equal(validation.finalVerdict, 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_EXECUTION_READY');
  assert.equal(validation.handoffBindingSha256, binding);
  assert.equal(validation.authority.mergeAllowed, false);
});

test('accepts live GitHub shape where run name equals the exact content-addressed display title', () => {
  const dynamicName = `stephanos-independent-review-pr-${prNumber}-head-${sourceHead}-binding-${binding}`;
  const validation = validateIndependentReviewWorkflowDispatchExecutionV1(
    run({ name: dynamicName, display_title: dynamicName }),
    jobs(),
    options(),
  );
  assert.equal(validation.valid, true);
  assert.equal(validation.handoffBindingSha256, binding);
});

test('can additionally bind the exact content-addressed handoff', () => {
  assert.equal(validateIndependentReviewWorkflowDispatchExecutionV1(
    run(),
    jobs(),
    options({ expectedHandoffBindingSha256: binding }),
  ).valid, true);
  const blocked = validateIndependentReviewWorkflowDispatchExecutionV1(
    run(),
    jobs(),
    options({ expectedHandoffBindingSha256: 'd'.repeat(64) }),
  );
  assert.ok(blocked.blockers.includes('dispatch-review-handoff-binding-mismatch'));
});

test('rejects stale base, spoofed name, mutable PR association and non-green execution', () => {
  const cases = [
    run({ head_sha: 'e'.repeat(40) }),
    run({ head_branch: branch }),
    run({ display_title: `stephanos-independent-review-pr-${prNumber + 1}-head-${sourceHead}-binding-${binding}` }),
    run({ display_title: `stephanos-independent-review-pr-${prNumber}-head-${'e'.repeat(40)}-binding-${binding}` }),
    run({ pull_requests: [{ number: prNumber }] }),
    run({ conclusion: 'failure' }),
    run({ name: 'Lookalike Independent Review' }),
    run({ name: 'Lookalike Independent Review', display_title: 'Lookalike Independent Review' }),
    run({ path: '.github/workflows/lookalike.yml' }),
  ];
  for (const candidate of cases) {
    assert.equal(validateIndependentReviewWorkflowDispatchExecutionV1(candidate, jobs(), options()).valid, false);
  }
  assert.equal(validateIndependentReviewWorkflowDispatchExecutionV1(
    run(),
    jobs({ conclusion: 'failure' }),
    options(),
  ).valid, false);
  assert.ok(validateIndependentReviewWorkflowDispatchExecutionV1(
    run(),
    [...jobs(), ...jobs()],
    options(),
  ).blockers.includes('dispatch-review-job-count-not-one'));
});

test('accepts only an explicitly trusted main workflow ref suffix', () => {
  assert.equal(validateIndependentReviewWorkflowDispatchExecutionV1(
    run({ path: `${repository}/.github/workflows/independent-merge-security-review.yml@refs/heads/main` }),
    jobs(),
    options(),
  ).valid, true);
  assert.equal(validateIndependentReviewWorkflowDispatchExecutionV1(
    run({ path: `${repository}/.github/workflows/independent-merge-security-review.yml@refs/heads/untrusted` }),
    jobs(),
    options(),
  ).valid, false);
});
