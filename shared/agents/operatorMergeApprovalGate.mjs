import { createHash, timingSafeEqual } from 'node:crypto';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RECEIPT_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{7,191}$/i;
const CHALLENGE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{7,191}$/i;

export const OPERATOR_APPROVAL_CHALLENGE_SCHEMA = 'stephanos.operator-merge-approval-challenge.v1';
export const OPERATOR_APPROVAL_RECEIPT_SCHEMA = 'stephanos.operator-merge-approval.v1';
export const OPERATOR_APPROVAL_CHALLENGE_KIND = 'stephanos.operator.merge-approval-challenge';
export const OPERATOR_APPROVAL_RECEIPT_KIND = 'stephanos.operator.merge-approval';
export const INTERACTIVE_OPERATOR_ISSUER_CLASS = 'interactive-operator-bridge';
export const DIRECT_OPERATOR_SOURCE = 'direct-operator-chat';

function text(value) {
  return String(value ?? '').trim();
}

function integer(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function instant(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function safeHexEqual(left, right) {
  const normalizedLeft = text(left).toLowerCase();
  const normalizedRight = text(right).toLowerCase();
  if (!SHA256_PATTERN.test(normalizedLeft) || !SHA256_PATTERN.test(normalizedRight)) return false;
  return timingSafeEqual(Buffer.from(normalizedLeft, 'hex'), Buffer.from(normalizedRight, 'hex'));
}

export function hashApprovalNonce(nonce) {
  const normalized = text(nonce);
  if (normalized.length < 24 || normalized.length > 512) return '';
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function requiredOperatorApprovalStatement(prNumber, sourceHead) {
  const pr = integer(prNumber);
  const head = text(sourceHead).toLowerCase();
  return `I approve PR #${pr} at exact head ${head} for merge.`;
}

export function validateOperatorMergeApproval(input = {}) {
  const challenge = input.challenge && typeof input.challenge === 'object' ? input.challenge : {};
  const receipt = input.receipt && typeof input.receipt === 'object' ? input.receipt : {};
  const expectedRepository = text(input.expectedRepository);
  const expectedPrNumber = integer(input.expectedPrNumber);
  const expectedSourceHead = text(input.expectedSourceHead).toLowerCase();
  const expectedOperatorId = text(input.expectedOperatorId);
  const mergeExecutionId = text(input.mergeExecutionId);
  const nowMs = instant(input.nowUtc || new Date().toISOString());
  const consumedReceiptIds = new Set((input.consumedReceiptIds || []).map(text).filter(Boolean));
  const blockers = [];

  if (challenge.schemaVersion !== OPERATOR_APPROVAL_CHALLENGE_SCHEMA || challenge.kind !== OPERATOR_APPROVAL_CHALLENGE_KIND) {
    blockers.push('Missing or malformed operator approval challenge.');
  }
  if (receipt.schemaVersion !== OPERATOR_APPROVAL_RECEIPT_SCHEMA || receipt.kind !== OPERATOR_APPROVAL_RECEIPT_KIND) {
    blockers.push('Missing or malformed operator approval receipt.');
  }

  const challengeId = text(challenge.challengeId);
  const receiptId = text(receipt.receiptId);
  if (!CHALLENGE_ID_PATTERN.test(challengeId)) blockers.push('Approval challenge ID is invalid.');
  if (!RECEIPT_ID_PATTERN.test(receiptId)) blockers.push('Approval receipt ID is invalid.');
  if (consumedReceiptIds.has(receiptId)) blockers.push('Approval receipt has already been consumed.');
  if (text(receipt.challengeId) !== challengeId) blockers.push('Approval receipt does not answer the current challenge.');

  for (const [label, actual, expected] of [
    ['repository', text(challenge.repository), expectedRepository],
    ['receipt repository', text(receipt.repository), expectedRepository],
    ['operator', text(challenge.operatorId), expectedOperatorId],
    ['receipt operator', text(receipt.operatorId), expectedOperatorId],
  ]) {
    if (!expected || actual !== expected) blockers.push(`Approval ${label} is not bound to the expected value.`);
  }

  if (integer(challenge.prNumber) !== expectedPrNumber || integer(receipt.prNumber) !== expectedPrNumber) {
    blockers.push('Approval is not bound to the expected pull request.');
  }
  if (!SHA_PATTERN.test(expectedSourceHead)
    || text(challenge.sourceHead).toLowerCase() !== expectedSourceHead
    || text(receipt.sourceHead).toLowerCase() !== expectedSourceHead) {
    blockers.push('Approval is not bound to the exact current 40-character head.');
  }

  if (challenge.issuerClass !== INTERACTIVE_OPERATOR_ISSUER_CLASS
    || receipt.issuerClass !== INTERACTIVE_OPERATOR_ISSUER_CLASS) {
    blockers.push('Approval challenge and receipt must originate from the interactive operator bridge.');
  }
  if (!text(challenge.evidenceRef).startsWith('chat-approval-request://')) {
    blockers.push('Approval challenge lacks a direct operator-channel evidence reference.');
  }
  if (!text(receipt.evidenceRef).startsWith('chat-message://')) {
    blockers.push('Approval receipt lacks a direct operator-message evidence reference.');
  }
  if (receipt.source !== DIRECT_OPERATOR_SOURCE) blockers.push('Approval source is not direct operator chat.');
  if (!text(receipt.issuerExecutionId)) blockers.push('Approval receipt lacks an independent issuer execution ID.');
  if (mergeExecutionId && text(receipt.issuerExecutionId) === mergeExecutionId) {
    blockers.push('The merge execution cannot issue its own operator approval receipt.');
  }

  const requiredStatement = requiredOperatorApprovalStatement(expectedPrNumber, expectedSourceHead);
  if (text(receipt.statement) !== requiredStatement) {
    blockers.push('Approval statement is absent, ambiguous, interrogative, a ratification, or otherwise not the exact required merge statement.');
  }

  const nonceHash = text(challenge.nonceSha256).toLowerCase();
  const suppliedNonceHash = hashApprovalNonce(receipt.nonce);
  if (!safeHexEqual(nonceHash, suppliedNonceHash)) blockers.push('Approval nonce does not satisfy the operator challenge.');

  const issuedAtMs = instant(challenge.issuedAtUtc);
  const expiresAtMs = instant(challenge.expiresAtUtc);
  const approvedAtMs = instant(receipt.approvedAtUtc);
  if (!Number.isFinite(nowMs) || !Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || !Number.isFinite(approvedAtMs)) {
    blockers.push('Approval timestamps are missing or invalid.');
  } else {
    if (expiresAtMs <= issuedAtMs) blockers.push('Approval challenge expiry is invalid.');
    if (nowMs > expiresAtMs) blockers.push('Approval challenge has expired.');
    if (approvedAtMs < issuedAtMs || approvedAtMs > expiresAtMs) blockers.push('Approval was not issued inside the challenge window.');
    if (approvedAtMs > nowMs + 5 * 60_000) blockers.push('Approval timestamp is unreasonably in the future.');
    if (expiresAtMs - issuedAtMs > 24 * 60 * 60_000) blockers.push('Approval challenge window exceeds 24 hours.');
  }

  return Object.freeze({
    schemaVersion: 'stephanos.operator-merge-approval-verdict.v1',
    repository: expectedRepository,
    prNumber: expectedPrNumber,
    sourceHead: expectedSourceHead,
    operatorId: expectedOperatorId,
    challengeId,
    receiptId,
    requiredStatement,
    blockers: Object.freeze(blockers),
    finalVerdict: blockers.length ? 'OPERATOR_MERGE_APPROVAL_BLOCKED' : 'OPERATOR_MERGE_APPROVAL_READY',
  });
}

export function buildConsumedApprovalRecord({ verdict, mergeExecutionId, mergeCommit = '', consumedAtUtc = new Date().toISOString() } = {}) {
  if (!verdict || verdict.finalVerdict !== 'OPERATOR_MERGE_APPROVAL_READY') {
    throw new Error('A ready operator merge approval verdict is required before consumption.');
  }
  return Object.freeze({
    schemaVersion: 'stephanos.operator-merge-approval-consumption.v1',
    kind: 'stephanos.operator.merge-approval-consumption',
    repository: verdict.repository,
    prNumber: verdict.prNumber,
    sourceHead: verdict.sourceHead,
    operatorId: verdict.operatorId,
    challengeId: verdict.challengeId,
    receiptId: verdict.receiptId,
    mergeExecutionId: text(mergeExecutionId),
    mergeCommit: text(mergeCommit),
    consumedAtUtc: text(consumedAtUtc),
    reusable: false,
  });
}
