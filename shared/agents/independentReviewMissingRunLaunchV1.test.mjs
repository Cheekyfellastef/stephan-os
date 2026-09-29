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
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BRANCH = 'agent/openclaw-oc1';

function fixture() {
  return {
    retryPlan: {
      decision: 'NO_MATCHING_RUN',
      repository: REPOSITORY,
      prNumber: 1910,
      branch: BRANCH,
      exactHead: HEAD,
      exactBase: BASE,
      workflowId: 123,
    },
    dispatchAdmission: {
      schemaVersion: 'stephanos.independent-review-workflow-dispatch-admission.v1',
      verdict: 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_ADMITTED',
      handoffBindingSha256: BINDING,
      binding: {
        repository: REPOSITORY,
        prNumber: 1910,
        branch: BRANCH,
        sourceHead: HEAD,
        baseSha: BASE,
        workflowId: 123,
        handoffRunReceiptSha256: RECEIPT,
      },
      workflowDispatchInputs: {
        pr_number: '1910',
        source_head: HEAD,
        base_sha: BASE,
        head_branch: BRANCH,
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

test('blocks authority widening including unknown authority fields', () => {
  const widened = fixture();
  widened.dispatchAdmission.authority.sourceMutationAllowed = true;
  assert.equal(
    planIndependentReviewMissingRunLaunchV1(widened).decision,
    INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.BLOCKED,
  );

  const smuggled = fixture();
  smuggled.dispatchAdmission.authority.arbitraryShellAllowed = true;
  assert.equal(
    planIndependentReviewMissingRunLaunchV1(smuggled).decision,
    INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.BLOCKED,
  );
});

test('blocks missing immutable receipt identity', () => {
  const input = fixture();
  input.dispatchAdmission.binding.handoffRunReceiptSha256 = '';
  const result = planIndependentReviewMissingRunLaunchV1(input);
  assert.equal(result.decision, INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.BLOCKED);
});

test('blocks caller-shaped workflow-dispatch input smuggling', () => {
  for (const mutate of [
    (input) => { input.dispatchAdmission.workflowDispatchInputs.pr_number = '9999'; },
    (input) => { input.dispatchAdmission.workflowDispatchInputs.source_head = '4'.repeat(40); },
    (input) => { input.dispatchAdmission.workflowDispatchInputs.base_sha = '5'.repeat(40); },
    (input) => { input.dispatchAdmission.workflowDispatchInputs.head_branch = 'agent/other'; },
    (input) => { input.dispatchAdmission.workflowDispatchInputs.handoff_binding_sha256 = 'c'.repeat(64); },
    (input) => { input.dispatchAdmission.workflowDispatchInputs.handoff_run_receipt_sha256 = 'd'.repeat(64); },
    (input) => { input.dispatchAdmission.workflowDispatchInputs.command = 'run-anything'; },
  ]) {
    const input = fixture();
    mutate(input);
    const result = planIndependentReviewMissingRunLaunchV1(input);
    assert.equal(result.decision, INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.BLOCKED);
    assert.equal(result.mutationAllowed, false);
  }
});

test('blocks repository and branch drift between retry truth and immutable admission', () => {
  const wrongRepository = fixture();
  wrongRepository.dispatchAdmission.binding.repository = 'other/repo';
  assert.equal(
    planIndependentReviewMissingRunLaunchV1(wrongRepository).decision,
    INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.BLOCKED,
  );

  const wrongBranch = fixture();
  wrongBranch.dispatchAdmission.binding.branch = 'agent/other';
  assert.equal(
    planIndependentReviewMissingRunLaunchV1(wrongBranch).decision,
    INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.BLOCKED,
  );
});

test('returns a frozen copy of the exact admitted dispatch inputs', () => {
  const input = fixture();
  const result = planIndependentReviewMissingRunLaunchV1(input);
  assert.equal(Object.isFrozen(result.workflowDispatchInputs), true);
  input.dispatchAdmission.workflowDispatchInputs.pr_number = '9999';
  assert.equal(result.workflowDispatchInputs.pr_number, '1910');
});
