import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIndependentReviewWorkflowDispatchLaunchReceiptV1,
} from './independentReviewWorkflowDispatchLaunchReceiptV1.mjs';
import {
  discoverIndependentReviewWorkflowDispatchRunV1,
} from './independentReviewWorkflowDispatchRunDiscoveryV1.mjs';

const HEAD = '1'.repeat(40);
const BASE = '2'.repeat(40);
const BINDING = 'a'.repeat(64);
const RECEIPT = 'b'.repeat(64);

function receipt(requestedAtUtc = '2026-08-20T10:00:00.000Z') {
  return buildIndependentReviewWorkflowDispatchLaunchReceiptV1({
    launchPlan: {
      schemaVersion: 'stephanos.independent-review-missing-run-launch.v1',
      decision: 'LAUNCH_MISSING_RUN',
      repository: 'Cheekyfellastef/stephan-os',
      prNumber: 1910,
      sourceHead: HEAD,
      baseSha: BASE,
      workflowId: 123,
      handoffBindingSha256: BINDING,
      operation: 'workflow-dispatch',
      mutationAllowed: true,
      workflowDispatchInputs: {
        pr_number: '1910',
        source_head: HEAD,
        base_sha: BASE,
        head_branch: 'agent/openclaw-oc1',
        handoff_binding_sha256: BINDING,
        handoff_run_receipt_sha256: RECEIPT,
      },
      requiredRevalidation: {
        currentMain: true,
        pullRequestIdentity: true,
        workflowIdentity: true,
        coordinatorWorkflowRun: true,
        handoffComment: true,
        coordinatorHandoffRunReceipt: true,
        exactRunAbsenceImmediatelyBeforeDispatch: true,
      },
      authority: {
        reviewWorkflowDispatchAllowed: true,
        reviewExecutionAllowed: true,
        sourceMutationAllowed: false,
        approvalAllowed: false,
        mergeAllowed: false,
        deploymentAllowed: false,
        runtimeMutationAllowed: false,
        providerQualificationAllowed: false,
        leaseSeizureAllowed: false,
        arbitraryCommandAllowed: false,
      },
    },
    requestedAtUtc,
  });
}

function run(launchReceipt, overrides = {}) {
  return {
    id: 500,
    workflow_id: 123,
    name: 'Independent Merge Security Review',
    path: '.github/workflows/independent-merge-security-review.yml',
    event: 'workflow_dispatch',
    repository: { full_name: 'Cheekyfellastef/stephan-os' },
    head_branch: 'main',
    head_sha: BASE,
    display_title: launchReceipt.runName,
    created_at: '2026-08-20T10:00:01.000Z',
    run_attempt: 1,
    status: 'in_progress',
    conclusion: null,
    ...overrides,
  };
}

test('discovers one exact running or terminal workflow-dispatch review run from the launch receipt', () => {
  const launchReceipt = receipt();
  const running = discoverIndependentReviewWorkflowDispatchRunV1({
    launchReceipt,
    runs: [run(launchReceipt)],
  });
  assert.equal(running.verdict, 'DISPATCH_RUN_RUNNING');
  assert.equal(running.runId, 500);

  const terminal = discoverIndependentReviewWorkflowDispatchRunV1({
    launchReceipt,
    runs: [run(launchReceipt, { status: 'completed', conclusion: 'success' })],
  });
  assert.equal(terminal.verdict, 'DISPATCH_RUN_TERMINAL');
  assert.equal(terminal.conclusion, 'success');
});

test('accepts GitHub API shape where workflow run name equals the content-addressed run-name', () => {
  const launchReceipt = receipt();
  const result = discoverIndependentReviewWorkflowDispatchRunV1({
    launchReceipt,
    runs: [run(launchReceipt, {
      name: launchReceipt.runName,
      display_title: launchReceipt.runName,
      status: 'completed',
      conclusion: 'success',
    })],
  });
  assert.equal(result.verdict, 'DISPATCH_RUN_TERMINAL');
  assert.equal(result.runId, 500);
  assert.equal(result.conclusion, 'success');
});

test('still rejects a foreign run name even when all other dispatch identity fields match', () => {
  const launchReceipt = receipt();
  const result = discoverIndependentReviewWorkflowDispatchRunV1({
    launchReceipt,
    runs: [run(launchReceipt, { name: 'Foreign Review Workflow' })],
  });
  assert.equal(result.verdict, 'DISPATCH_RUN_NOT_YET_OBSERVED');
});

test('accepts GitHub whole-second created_at for a millisecond launch receipt in the same second', () => {
  const launchReceipt = receipt('2026-08-20T10:00:00.750Z');
  const result = discoverIndependentReviewWorkflowDispatchRunV1({
    launchReceipt,
    runs: [run(launchReceipt, {
      created_at: '2026-08-20T10:00:00.000Z',
      status: 'completed',
      conclusion: 'success',
    })],
  });
  assert.equal(result.verdict, 'DISPATCH_RUN_TERMINAL');
  assert.equal(result.runId, 500);
  assert.equal(result.conclusion, 'success');
});

test('does not let unrelated or previous-second dispatch runs suppress a legitimate launch', () => {
  const launchReceipt = receipt('2026-08-20T10:00:00.750Z');
  const result = discoverIndependentReviewWorkflowDispatchRunV1({
    launchReceipt,
    runs: [
      run(launchReceipt, { id: 1, display_title: 'other' }),
      run(launchReceipt, { id: 2, event: 'pull_request_target' }),
      run(launchReceipt, { id: 3, head_sha: '3'.repeat(40) }),
      run(launchReceipt, { id: 4, created_at: '2026-08-20T09:59:59.999Z' }),
    ],
  });
  assert.equal(result.verdict, 'DISPATCH_RUN_NOT_YET_OBSERVED');
});

test('fails closed when more than one exact dispatch run matches one content-addressed launch', () => {
  const launchReceipt = receipt();
  const result = discoverIndependentReviewWorkflowDispatchRunV1({
    launchReceipt,
    runs: [
      run(launchReceipt, { id: 500 }),
      run(launchReceipt, { id: 501, created_at: '2026-08-20T10:00:02.000Z' }),
    ],
  });
  assert.equal(result.verdict, 'AMBIGUOUS_DISPATCH_RUNS');
  assert.deepEqual(result.blockers, ['multiple exact workflow-dispatch runs match one launch receipt']);
});
