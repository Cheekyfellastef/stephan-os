import { createHash } from 'node:crypto';

export const VERIFICATION_JUDGE_EVIDENCE_SCHEMA = 'stephanos.verification-judge-evidence.v1';

function text(value) {
  return String(value ?? '').trim();
}

function validReceipt(receipt = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || receipt.verified !== true) return false;
  if (!text(receipt.requirement) || !text(receipt.source) || !text(receipt.evidenceType)) return false;
  const sha256 = text(receipt.sha256).toLowerCase();
  const commandOutputHash = text(receipt.commandOutputHash).toLowerCase();
  return /^[a-f0-9]{64}$/.test(sha256)
    || /^[a-f0-9]{64}$/.test(commandOutputHash)
    || receipt.exitCode === 0;
}

function requirementIdentity(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
}

export function judgeVerificationEvidenceV1(action = {}, nowUtc = new Date().toISOString()) {
  if (action.actionKind !== 'evidence-judgment') throw new Error('VERIFICATION_JUDGE_ACTION_KIND_INVALID');
  const requiredEvidence = Array.isArray(action.requiredEvidence)
    ? action.requiredEvidence.map(text).filter(Boolean)
    : [];
  if (!requiredEvidence.length) throw new Error('VERIFICATION_JUDGE_REQUIRED_EVIDENCE_MISSING');

  const receipts = Array.isArray(action.receipts)
    ? action.receipts.filter(validReceipt)
    : [];
  const sourceReceipt = receipts.find((receipt) => text(receipt.evidenceType).toLowerCase() === 'source-mutation');
  const testReceipt = receipts.find((receipt) => text(receipt.evidenceType).toLowerCase() === 'source-test-command');
  const judgedReceipts = [];

  for (const requirement of requiredEvidence) {
    const identity = requirementIdentity(requirement);
    const direct = receipts.find((receipt) => requirementIdentity(receipt.requirement) === identity);
    const proofReceipts = direct
      ? [direct]
      : /^goal #[1-9]\d* bounded implementation and focused verification evidence$/.test(identity)
        && sourceReceipt
        && testReceipt
        ? [sourceReceipt, testReceipt]
        : [];

    if (!proofReceipts.length) {
      throw new Error(`VERIFICATION_JUDGE_REQUIREMENT_UNPROVEN:${requirement}`);
    }

    const proofIdentity = proofReceipts
      .map((receipt) => [
        text(receipt.receiptId),
        text(receipt.commandOutputHash || receipt.sha256),
        text(receipt.exitCode),
      ].join(':'))
      .join('|');
    judgedReceipts.push(Object.freeze({
      receiptId: `verification-judgment-${createHash('sha256').update(`${requirement}|${proofIdentity}`).digest('hex').slice(0, 24)}`,
      requirement,
      source: 'verification-judge',
      evidenceType: 'bounded-implementation-verification',
      verified: true,
      createdAt: nowUtc,
      commandOutputHash: createHash('sha256').update(proofIdentity).digest('hex'),
    }));
  }

  return Object.freeze({
    schemaVersion: VERIFICATION_JUDGE_EVIDENCE_SCHEMA,
    ok: true,
    receipts: Object.freeze(judgedReceipts),
    sourceReceiptId: text(sourceReceipt?.receiptId),
    testReceiptId: text(testReceipt?.receiptId),
  });
}
