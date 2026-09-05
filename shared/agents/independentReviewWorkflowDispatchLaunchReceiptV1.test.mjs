import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIndependentReviewWorkflowDispatchLaunchReceiptV1,
  parseIndependentReviewWorkflowDispatchLaunchReceiptCommentV1,
  renderIndependentReviewWorkflowDispatchLaunchReceiptCommentV1,
  validateIndependentReviewWorkflowDispatchLaunchReceiptV1,
} from './independentReviewWorkflowDispatchLaunchReceiptV1.mjs';

const HEAD = '1'.repeat(40);
const BASE = '2'.repeat(40);
const HANDOFF = 'a'.repeat(64);
const RECEIPT = 'b'.repeat(64);

function launchPlan() {
  return {
    schemaVersion: 'stephanos.independent-review-missing-run-launch.v1',
    decision: 'LAUNCH_MISSING_RUN',
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1910,
    sourceHead: HEAD,
    baseSha: BASE,
    workflowId: 123,
    handoffBindingSha256: HANDOFF,
    operation: 'workflow-dispatch',
    mutationAllowed: true,
    workflowDispatchInputs: {
      pr_number: '1910',
      source_head: HEAD,
      base_sha: BASE,
      head_branch: 'agent/openclaw-oc1',
      handoff_binding_sha256: HANDOFF,
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
  };
}

test('builds a content-addressed launch receipt from an exact admitted missing-run plan', () => {
  const receipt = buildIndependentReviewWorkflowDispatchLaunchReceiptV1({
    launchPlan: launchPlan(),
    requestedAtUtc: '2026-08-20T10:00:00.000Z',
  });
  assert.equal(receipt.schemaVersion, 'stephanos.independent-review-workflow-dispatch-launch-receipt.v1');
  assert.equal(receipt.prNumber, 1910);
  assert.equal(receipt.sourceHead, HEAD);
  assert.equal(receipt.baseSha, BASE);
  assert.equal(receipt.branch, 'agent/openclaw-oc1');
  assert.match(receipt.launchKeySha256, /^[0-9a-f]{64}$/);
  assert.equal(
    receipt.runName,
    `stephanos-independent-review-pr-1910-head-${HEAD}-binding-${HANDOFF}`,
  );
  assert.deepEqual(validateIndependentReviewWorkflowDispatchLaunchReceiptV1(receipt), receipt);
});

test('round-trips the exact launch receipt through one content-addressed PR comment', () => {
  const receipt = buildIndependentReviewWorkflowDispatchLaunchReceiptV1({
    launchPlan: launchPlan(),
    requestedAtUtc: '2026-08-20T10:00:00.000Z',
  });
  const comment = renderIndependentReviewWorkflowDispatchLaunchReceiptCommentV1(receipt);
  assert.match(comment, /stephanos:independent-review-workflow-dispatch-launch:v1/);
  assert.deepEqual(parseIndependentReviewWorkflowDispatchLaunchReceiptCommentV1(comment), receipt);

  assert.throws(
    () => parseIndependentReviewWorkflowDispatchLaunchReceiptCommentV1(comment.replace(receipt.launchKeySha256, 'c'.repeat(64))),
    /comment key does not match receipt/,
  );
});

test('rejects paper launch claims, widened authority and altered content-addressed identity', () => {
  const badDecision = launchPlan();
  badDecision.decision = 'BLOCKED';
  assert.throws(() => buildIndependentReviewWorkflowDispatchLaunchReceiptV1({
    launchPlan: badDecision,
    requestedAtUtc: '2026-08-20T10:00:00.000Z',
  }), /exact admitted missing-run launch plan/);

  const widened = launchPlan();
  widened.authority.sourceMutationAllowed = true;
  assert.throws(() => buildIndependentReviewWorkflowDispatchLaunchReceiptV1({
    launchPlan: widened,
    requestedAtUtc: '2026-08-20T10:00:00.000Z',
  }), /exact admitted missing-run launch plan/);

  const receipt = buildIndependentReviewWorkflowDispatchLaunchReceiptV1({
    launchPlan: launchPlan(),
    requestedAtUtc: '2026-08-20T10:00:00.000Z',
  });
  assert.throws(() => validateIndependentReviewWorkflowDispatchLaunchReceiptV1({
    ...receipt,
    runName: `${receipt.runName}-altered`,
  }), /binding does not match/);
  assert.throws(() => validateIndependentReviewWorkflowDispatchLaunchReceiptV1({
    ...receipt,
    requestedAtUtc: 'not-a-time',
  }), /canonical requestedAtUtc/);
});
