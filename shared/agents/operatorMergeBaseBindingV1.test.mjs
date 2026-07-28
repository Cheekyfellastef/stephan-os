import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindIndependentReviewReceiptToBase,
  buildBaseBoundApprovalReceipt,
  independentReviewBaseProofRef,
  validateBaseBoundApprovalReceipt,
  validateIndependentReviewBaseBinding,
  validateIndependentWorkflowBaseBinding,
  validateMainRefBaseBinding,
  validatePullRequestBaseBinding,
} from './operatorMergeBaseBindingV1.mjs';

const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const movedBaseSha = 'c'.repeat(40);
const prNumber = 1580;
const runId = 12345;
const runAttempt = 2;

function reviewReceipt() {
  return {
    schemaVersion: 'stephanos.provider-neutral-review.v1',
    kind: 'stephanos.provider-neutral.review',
    reviewScope: ['complete-exact-head-diff'],
    proofRefs: [`proofs/independent-review/head-${headSha.slice(0, 12)}`],
  };
}

function approvalReceipt() {
  return {
    schemaVersion: 'stephanos.protected-operator-approval.v1',
    kind: 'stephanos.protected-operator-approval',
    prNumber,
    sourceHead: headSha,
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
    reusableAcrossHeads: false,
  };
}

test('binds an independent review receipt to the full exact base SHA', () => {
  const bound = bindIndependentReviewReceiptToBase(reviewReceipt(), baseSha);
  assert.ok(bound.reviewScope.includes('exact-base-sha-binding'));
  assert.ok(bound.proofRefs.includes(independentReviewBaseProofRef(baseSha)));
  assert.equal(validateIndependentReviewBaseBinding(bound, baseSha).valid, true);
  const moved = validateIndependentReviewBaseBinding(bound, movedBaseSha);
  assert.equal(moved.valid, false);
  assert.ok(moved.blockers.includes('independent-review-base-proof-missing'));
});

test('requires both the fresh PR base and live main ref to remain unchanged', () => {
  assert.equal(validatePullRequestBaseBinding({ base: { sha: baseSha } }, baseSha).valid, true);
  assert.equal(validateMainRefBaseBinding({ object: { sha: baseSha } }, baseSha).valid, true);
  assert.ok(validatePullRequestBaseBinding({ base: { sha: movedBaseSha } }, baseSha).blockers.includes('pull-request-base-sha-mismatch'));
  assert.ok(validateMainRefBaseBinding({ object: { sha: movedBaseSha } }, baseSha).blockers.includes('main-ref-sha-mismatch'));
});

test('requires the independent workflow run itself to identify the same base SHA', () => {
  const run = {
    pull_requests: [{ number: prNumber, head: { sha: headSha }, base: { sha: baseSha } }],
  };
  assert.equal(validateIndependentWorkflowBaseBinding(run, prNumber, baseSha).valid, true);
  const moved = validateIndependentWorkflowBaseBinding(run, prNumber, movedBaseSha);
  assert.ok(moved.blockers.includes('independent-review-base-sha-mismatch'));
});

test('builds a one-time operator approval bound to both head and base', () => {
  const bound = buildBaseBoundApprovalReceipt(approvalReceipt(), baseSha);
  assert.equal(bound.schemaVersion, 'stephanos.protected-operator-approval.v2');
  assert.equal(bound.baseSha, baseSha);
  assert.equal(bound.reusableAcrossBases, false);
  assert.equal(validateBaseBoundApprovalReceipt(bound, {
    prNumber,
    expectedHead: headSha,
    expectedBaseSha: baseSha,
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
  }).valid, true);
  const moved = validateBaseBoundApprovalReceipt(bound, {
    prNumber,
    expectedHead: headSha,
    expectedBaseSha: movedBaseSha,
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
  });
  assert.ok(moved.blockers.includes('approval-base-mismatch'));
});
