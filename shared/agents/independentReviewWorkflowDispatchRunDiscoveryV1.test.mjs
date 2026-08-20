import assert from 'node:assert/strict';
import test from 'node:test';

import {
  discoverIndependentReviewWorkflowDispatchRunV1,
} from './independentReviewWorkflowDispatchRunDiscoveryV1.mjs';

const HEAD = '1'.repeat(40);
const BASE = '2'.repeat(40);
const BINDING = 'a'.repeat(64);
const RECEIPT = 'b'.repeat(64);
const LAUNCH = 'c'.repeat(64);
const RUN_NAME = `stephanos-independent-review-pr-1910-head-${HEAD}-binding-${BINDING}`;

function receipt() {
  return {
    schemaVersion: 'stephanos.independent-review-workflow-dispatch-launch-receipt.v1',
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1910,
    sourceHead: HEAD,
    baseSha: BASE,
    branch: 'agent/openclaw-oc1',
    workflowId: 123,
    workflowName: 'Independent Merge Security Review',
    workflowPath: '.github/workflows/independent-merge-security-review.yml',
    handoffBindingSha256: BINDING,
    handoffRunReceiptSha256: RECEIPT,
    launchKeySha256: LAUNCH,
    runName: RUN_NAME,
    requestedAtUtc: '2026-08-20T10:00:00.000Z',
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
  };
}

function run(overrides = {}) {
  return {
    id: 500,
    workflow_id: 123,
    name: 'Independent Merge Security Review',
    path: '.github/workflows/independent-merge-security-review.yml',
    event: 'workflow_dispatch',
    repository: { full_name: 'Cheekyfellastef/stephan-os' },
    head_branch: 'main',
    head_sha: BASE,
    display_title: RUN_NAME,
    created_at: '2026-08-20T10:00:01.000Z',
    run_attempt: 1,
    status: 'in_progress',
    conclusion: null,
    ...overrides,
  };
}

test('discovers one exact running or terminal workflow-dispatch review run from the launch receipt', () => {
  const running = discoverIndependentReviewWorkflowDispatchRunV1({
    launchReceipt: receipt(),
    runs: [run()],
  });
  assert.equal(running.verdict, 'DISPATCH_RUN_RUNNING');
  assert.equal(running.runId, 500);

  const terminal = discoverIndependentReviewWorkflowDispatchRunV1({
    launchReceipt: receipt(),
    runs: [run({ status: 'completed', conclusion: 'success' })],
  });
  assert.equal(terminal.verdict, 'DISPATCH_RUN_TERMINAL');
  assert.equal(terminal.conclusion, 'success');
});

test('does not let unrelated or pre-receipt dispatch runs suppress a legitimate launch', () => {
  const result = discoverIndependentReviewWorkflowDispatchRunV1({
    launchReceipt: receipt(),
    runs: [
      run({ id: 1, display_title: 'other' }),
      run({ id: 2, event: 'pull_request_target' }),
      run({ id: 3, head_sha: '3'.repeat(40) }),
      run({ id: 4, created_at: '2026-08-20T09:59:59.000Z' }),
    ],
  });
  assert.equal(result.verdict, 'DISPATCH_RUN_NOT_YET_OBSERVED');
});

test('fails closed when more than one exact dispatch run matches one content-addressed launch', () => {
  const result = discoverIndependentReviewWorkflowDispatchRunV1({
    launchReceipt: receipt(),
    runs: [run({ id: 500 }), run({ id: 501, created_at: '2026-08-20T10:00:02.000Z' })],
  });
  assert.equal(result.verdict, 'AMBIGUOUS_DISPATCH_RUNS');
  assert.deepEqual(result.blockers, ['multiple exact workflow-dispatch runs match one launch receipt']);
});
