import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION,
  planIndependentReviewMissingRunLaunchV1,
} from './independentReviewMissingRunLaunchV1.mjs';

const HEAD = '1'.repeat(40);
const BASE = '2'.repeat(40);
const BINDING = 'a'.repeat(64);
const RECEIPT = 'b'.repeat(64);

function fixture() {
  return {
    retryPlan: {
      decision: 'NO_MATCHING_RUN',
      repository: 'Cheekyfellastef/stephan-os',
      prNumber: 1910,
      exactHead: HEAD,
      exactBase: BASE,
      workflowId: 123,
    },
    dispatchAdmission: {
      schemaVersion: 'stephanos.independent-review-workflow-dispatch-admission.v1',
      verdict: 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_ADMITTED',
      handoffBindingSha256: BINDING,
      binding: {
        prNumber: 1910,
        sourceHead: HEAD,
        baseSha: BASE,
        workflowId: 123,
        handoffRunReceiptSha256: RECEIPT,
      },
      workflowDispatchInputs: {
        pr_number: '1910',
        source_head: HEAD,
        base_sha: BASE,
        head_branch: 'agent/openclaw-oc1',
        handoff_binding_sha256: BINDING,
        handoff_run_receipt_sha256: RECEIPT,
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
  };
}

test('launches only when exact missing-run state and immutable admission agree', () => {
  const result = planIndependentReviewMissingRunLaunchV1(fixture());
  assert.equal(result.decision, INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.LAUNCH_MISSING_RUN);
  assert.equal(result.mutationAllowed, true);
  assert.equal(result.operation, 'workflow-dispatch');
  assert.equal(result.authority.mergeAllowed, false);
  assert.equal(result.authority.runtimeMutationAllowed, false);
  assert.equal(result.requiredRevalidation.exactRunAbsenceImmediatelyBeforeDispatch, true);
});

test('suppresses launch when an exact canonical run already exists', () => {
  const input = fixture();
  input.retryPlan.decision = 'WAIT_RUNNING';
  const result = planIndependentReviewMissingRunLaunchV1(input);
  assert.equal(result.decision, INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.SUPPRESS_EXISTING_RUN);
  assert.equal(result.mutationAllowed, false);
});

test('blocks stale or mismatched immutable admission', () => {
  const input = fixture();
  input.dispatchAdmission.binding.sourceHead = '3'.repeat(40);
  const result = planIndependentReviewMissingRunLaunchV1(input);
  assert.equal(result.decision, INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.BLOCKED);
  assert.equal(result.mutationAllowed, false);
});

test('blocks authority widening', () => {
  const input = fixture();
  input.dispatchAdmission.authority.sourceMutationAllowed = true;
  const result = planIndependentReviewMissingRunLaunchV1(input);
  assert.equal(result.decision, INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.BLOCKED);
  assert.equal(result.mutationAllowed, false);
});

test('blocks missing immutable receipt identity', () => {
  const input = fixture();
  input.dispatchAdmission.binding.handoffRunReceiptSha256 = '';
  const result = planIndependentReviewMissingRunLaunchV1(input);
  assert.equal(result.decision, INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.BLOCKED);
});
