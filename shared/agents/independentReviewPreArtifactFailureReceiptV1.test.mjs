import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTECTED_REVIEW_MARKER } from './operatorMergeApprovalGate.mjs';
import {
  planIndependentReviewPreArtifactFailureReceiptV1,
  renderIndependentReviewPreArtifactFailureReceiptV1,
} from './independentReviewPreArtifactFailureReceiptV1.mjs';

const VALID = Object.freeze({
  repository:'Cheekyfellastef/stephan-os',
  prNumber:1946,
  branch:'fix/battle-bridge-recovery-proof-compatibility-v1',
  sourceHead:'c1ce37b25775cd0cb32589e1a274164d346eef21',
  baseSha:'f33e7ac5016f3422273c4cfbe36de6f15adc111a',
  workflowRunId:32570000000,
  workflowRunAttempt:1,
});

test('pre-artifact failure receipt exposes exact coordinator-discoverable run identity without review acceptance authority', () => {
  const plan = planIndependentReviewPreArtifactFailureReceiptV1(VALID);
  assert.equal(plan.decision, 'PUBLISH_PRE_ARTIFACT_FAILURE_RECEIPT');
  assert.equal(plan.publishAllowed, true);
  assert.match(plan.marker, /run=32570000000 attempt=1 head=c1ce37b/);
  assert.equal(plan.receipt.runIdentityHint, 'github-actions-independent-review-run-32570000000-attempt-1');
  assert.equal(plan.receipt.verdict, 'blocked');
  assert.equal(plan.receipt.authority.reviewAcceptanceAllowed, false);
  assert.equal(plan.receipt.authority.reviewDispatchAllowed, false);
  assert.equal(plan.receipt.authority.mergeAllowed, false);
  assert.equal(plan.receipt.authority.runtimeMutationAllowed, false);

  const rendered = renderIndependentReviewPreArtifactFailureReceiptV1(plan);
  assert.ok(rendered.includes(PROTECTED_REVIEW_MARKER));
  assert.match(rendered, /github-actions-independent-review-run-32570000000-attempt-1/);
  assert.match(rendered, /PRE_ARTIFACT_REVIEW_RESULT_MISSING/);
  assert.match(rendered, /not a clean review/);
});

test('invalid, drifted or unsafe run identity fails closed', () => {
  for (const candidate of [
    { ...VALID, sourceHead:'short' },
    { ...VALID, baseSha:'not-a-sha' },
    { ...VALID, branch:'../main' },
    { ...VALID, repository:'not-a-repository' },
    { ...VALID, prNumber:0 },
    { ...VALID, workflowRunId:0 },
    { ...VALID, workflowRunAttempt:0 },
  ]) {
    const plan = planIndependentReviewPreArtifactFailureReceiptV1(candidate);
    assert.equal(plan.publishAllowed, false);
    assert.equal(plan.decision, 'BLOCK_INVALID_PRE_ARTIFACT_FAILURE_IDENTITY');
    assert.throws(() => renderIndependentReviewPreArtifactFailureReceiptV1(plan));
  }
});
