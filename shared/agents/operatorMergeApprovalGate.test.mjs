import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildConsumedApprovalRecord,
  hashApprovalNonce,
  requiredOperatorApprovalStatement,
  validateOperatorMergeApproval,
} from './operatorMergeApprovalGate.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const prNumber = 1600;
const sourceHead = 'a'.repeat(40);
const operatorId = 'Stephan';
const nonce = 'operator-only-nonce-1234567890-abcdef';
const issuedAtUtc = '2026-07-21T20:00:00.000Z';
const expiresAtUtc = '2026-07-21T21:00:00.000Z';
const approvedAtUtc = '2026-07-21T20:05:00.000Z';
const nowUtc = '2026-07-21T20:06:00.000Z';

function challenge(overrides = {}) {
  return {
    schemaVersion: 'stephanos.operator-merge-approval-challenge.v1',
    kind: 'stephanos.operator.merge-approval-challenge',
    challengeId: 'challenge-pr1600-head-a',
    repository,
    prNumber,
    sourceHead,
    operatorId,
    nonceSha256: hashApprovalNonce(nonce),
    issuedAtUtc,
    expiresAtUtc,
    issuerClass: 'interactive-operator-bridge',
    evidenceRef: 'chat-approval-request://conversation/1600',
    ...overrides,
  };
}

function receipt(overrides = {}) {
  return {
    schemaVersion: 'stephanos.operator-merge-approval.v1',
    kind: 'stephanos.operator.merge-approval',
    receiptId: 'operator-approval-pr1600-head-a',
    challengeId: 'challenge-pr1600-head-a',
    repository,
    prNumber,
    sourceHead,
    operatorId,
    statement: requiredOperatorApprovalStatement(prNumber, sourceHead),
    nonce,
    approvedAtUtc,
    source: 'direct-operator-chat',
    issuerClass: 'interactive-operator-bridge',
    issuerExecutionId: 'interactive-chat-turn-1600',
    evidenceRef: 'chat-message://conversation/approval-1600',
    ...overrides,
  };
}

function validate(overrides = {}) {
  return validateOperatorMergeApproval({
    challenge: challenge(),
    receipt: receipt(),
    expectedRepository: repository,
    expectedPrNumber: prNumber,
    expectedSourceHead: sourceHead,
    expectedOperatorId: operatorId,
    mergeExecutionId: 'controller-merge-1600',
    consumedReceiptIds: [],
    nowUtc,
    ...overrides,
  });
}

test('accepts one exact challenge-bound direct operator approval', () => {
  const verdict = validate();
  assert.equal(verdict.finalVerdict, 'OPERATOR_MERGE_APPROVAL_READY');
  assert.deepEqual(verdict.blockers, []);
});

test('rejects a question instead of explicit approval', () => {
  const verdict = validate({ receipt: receipt({ statement: 'Do I need to approve this?' }) });
  assert.equal(verdict.finalVerdict, 'OPERATOR_MERGE_APPROVAL_BLOCKED');
  assert.ok(verdict.blockers.some((blocker) => blocker.includes('ambiguous')));
});

test('rejects ratification wording and approval for another PR', () => {
  const verdict = validate({
    receipt: receipt({
      statement: `I ratify PR #${prNumber - 1} after merge.`,
      prNumber: prNumber - 1,
    }),
  });
  assert.equal(verdict.finalVerdict, 'OPERATOR_MERGE_APPROVAL_BLOCKED');
  assert.ok(verdict.blockers.some((blocker) => blocker.includes('expected pull request')));
  assert.ok(verdict.blockers.some((blocker) => blocker.includes('ambiguous')));
});

test('rejects stale head approval', () => {
  const verdict = validate({ receipt: receipt({ sourceHead: 'b'.repeat(40) }) });
  assert.equal(verdict.finalVerdict, 'OPERATOR_MERGE_APPROVAL_BLOCKED');
  assert.ok(verdict.blockers.some((blocker) => blocker.includes('exact current')));
});

test('rejects a receipt without the private challenge nonce', () => {
  const verdict = validate({ receipt: receipt({ nonce: 'wrong-private-nonce-1234567890-abcdef' }) });
  assert.equal(verdict.finalVerdict, 'OPERATOR_MERGE_APPROVAL_BLOCKED');
  assert.ok(verdict.blockers.some((blocker) => blocker.includes('nonce')));
});

test('rejects merge execution self-issuing approval', () => {
  const verdict = validate({ receipt: receipt({ issuerExecutionId: 'controller-merge-1600' }) });
  assert.equal(verdict.finalVerdict, 'OPERATOR_MERGE_APPROVAL_BLOCKED');
  assert.ok(verdict.blockers.some((blocker) => blocker.includes('cannot issue')));
});

test('rejects consumed and expired approval', () => {
  const verdict = validate({
    consumedReceiptIds: ['operator-approval-pr1600-head-a'],
    nowUtc: '2026-07-21T22:00:00.000Z',
  });
  assert.equal(verdict.finalVerdict, 'OPERATOR_MERGE_APPROVAL_BLOCKED');
  assert.ok(verdict.blockers.some((blocker) => blocker.includes('already been consumed')));
  assert.ok(verdict.blockers.some((blocker) => blocker.includes('expired')));
});

test('consumption record is exact-head-bound and non-reusable', () => {
  const verdict = validate();
  const consumed = buildConsumedApprovalRecord({
    verdict,
    mergeExecutionId: 'controller-merge-1600',
    mergeCommit: 'c'.repeat(40),
    consumedAtUtc: '2026-07-21T20:07:00.000Z',
  });
  assert.equal(consumed.prNumber, prNumber);
  assert.equal(consumed.sourceHead, sourceHead);
  assert.equal(consumed.receiptId, 'operator-approval-pr1600-head-a');
  assert.equal(consumed.reusable, false);
});
