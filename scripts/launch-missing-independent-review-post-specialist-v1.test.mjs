import assert from 'node:assert/strict';
import test from 'node:test';

import {
  reconcileExistingLaunchReceiptV1,
  selectExactPostSpecialistReviewV1,
} from './launch-missing-independent-review-v1.mjs';
import {
  buildIndependentReviewWorkflowDispatchLaunchReceiptV1,
} from '../shared/agents/independentReviewWorkflowDispatchLaunchReceiptV1.mjs';
import {
  INDEPENDENT_REVIEW_MAX_RUN_ATTEMPT,
  INDEPENDENT_REVIEW_POST_SPECIALIST_MAX_RUN_ATTEMPT,
} from '../shared/agents/independentReviewRetryPlanner.mjs';

const HEAD = '1'.repeat(40);
const BASE = '2'.repeat(40);
const OWNER = { login: 'Cheekyfellastef', id: 267490109 };

function launchReceipt() {
  return buildIndependentReviewWorkflowDispatchLaunchReceiptV1({
    launchPlan: {
      schemaVersion: 'stephanos.independent-review-missing-run-launch.v1',
      decision: 'LAUNCH_MISSING_RUN',
      repository: 'Cheekyfellastef/stephan-os',
      prNumber: 2222,
      sourceHead: HEAD,
      baseSha: BASE,
      workflowId: 123,
      handoffBindingSha256: 'a'.repeat(64),
      operation: 'workflow-dispatch',
      mutationAllowed: true,
      workflowDispatchInputs: {
        pr_number: '2222',
        source_head: HEAD,
        base_sha: BASE,
        head_branch: 'fix/example',
        handoff_binding_sha256: 'a'.repeat(64),
        handoff_run_receipt_sha256: 'b'.repeat(64),
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
    requestedAtUtc: '2026-09-14T13:00:00.000Z',
  });
}

function dispatchRun(receipt, runAttempt) {
  return {
    id: 500,
    workflow_id: 123,
    name: 'Independent Merge Security Review',
    path: '.github/workflows/independent-merge-security-review.yml',
    event: 'workflow_dispatch',
    repository: { full_name: 'Cheekyfellastef/stephan-os' },
    head_branch: 'main',
    head_sha: BASE,
    display_title: receipt.runName,
    created_at: '2026-09-14T13:00:01.000Z',
    run_attempt: runAttempt,
    status: 'completed',
    conclusion: 'failure',
  };
}

function specialistReview(overrides = {}) {
  return {
    id: 5198433717,
    user: OWNER,
    author_association: 'OWNER',
    state: 'COMMENTED',
    commit_id: HEAD,
    body: [
      'Exact-head Windows authority specialist review for PR #2222 “Repair Mission Worker watchdog restart proof”, bound to head `' + HEAD + '` and base `' + BASE + '`.',
      '',
      'Specialist verdict: CLEAN for the Windows authority surface. P0: 0, P1: 0, P2: 0 unresolved. This is review only and grants no merge or runtime authority.',
    ].join('\n'),
    ...overrides,
  };
}

test('post-specialist evidence is exact-head/base/commit bound and fail closed', () => {
  const exact = specialistReview();
  assert.equal(selectExactPostSpecialistReviewV1([exact], {
    prNumber: 2222,
    sourceHead: HEAD,
    baseSha: BASE,
  }), exact);

  assert.equal(selectExactPostSpecialistReviewV1([{ ...exact, commit_id: '3'.repeat(40) }], {
    prNumber: 2222,
    sourceHead: HEAD,
    baseSha: BASE,
  }), null);

  assert.equal(selectExactPostSpecialistReviewV1([{ ...exact, body: exact.body.replace('P2: 0', 'P2: 1') }], {
    prNumber: 2222,
    sourceHead: HEAD,
    baseSha: BASE,
  }), null);

  assert.throws(() => selectExactPostSpecialistReviewV1([exact, { ...exact, id: 5198433718 }], {
    prNumber: 2222,
    sourceHead: HEAD,
    baseSha: BASE,
  }), /count exceeds one/);
});

test('attempt two remains blocked ordinarily but gets exactly one clean post-specialist retry', () => {
  const receipt = launchReceipt();
  const ordinary = reconcileExistingLaunchReceiptV1({
    launchReceipt: receipt,
    runs: [dispatchRun(receipt, INDEPENDENT_REVIEW_MAX_RUN_ATTEMPT)],
  });
  assert.equal(ordinary.reconciliation, 'RETRY_BUDGET_EXHAUSTED');
  assert.equal(ordinary.mutationAllowed, false);
  assert.equal(ordinary.retryLimit, INDEPENDENT_REVIEW_MAX_RUN_ATTEMPT);

  const admitted = reconcileExistingLaunchReceiptV1({
    launchReceipt: receipt,
    runs: [dispatchRun(receipt, INDEPENDENT_REVIEW_MAX_RUN_ATTEMPT)],
    postSpecialistRetryAllowed: true,
  });
  assert.equal(admitted.reconciliation, 'RERUN_FAILED_JOBS');
  assert.equal(admitted.mutationAllowed, true);
  assert.equal(admitted.retryLimit, INDEPENDENT_REVIEW_POST_SPECIALIST_MAX_RUN_ATTEMPT);

  const finalCap = reconcileExistingLaunchReceiptV1({
    launchReceipt: receipt,
    runs: [dispatchRun(receipt, INDEPENDENT_REVIEW_POST_SPECIALIST_MAX_RUN_ATTEMPT)],
    postSpecialistRetryAllowed: true,
  });
  assert.equal(finalCap.reconciliation, 'RETRY_BUDGET_EXHAUSTED');
  assert.equal(finalCap.mutationAllowed, false);
  assert.equal(finalCap.retryLimit, INDEPENDENT_REVIEW_POST_SPECIALIST_MAX_RUN_ATTEMPT);
});
