import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createSharedWorkspaceReceiptRecord, resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord, writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import { acquireSharedWorkspaceOperationLock } from '../shared/agents/executionReceiptV1.mjs';

const FLAGS = ['newWorkerRequested', 'newMissionRequested', 'sourceMutationAuthorized',
  'runtimeMutationAuthorized', 'signerEnrollmentAuthorized', 'leaseReleaseAuthorized'];
const TEXT = ['summary', 'requestRef', 'diagnosticCode', 'engineeringOwner',
  'independentReviewProvider', 'executionIdentityStatus', 'decisionRequested'];
const KEYS = [...FLAGS, ...TEXT, 'requiredEvidence'];
const CODE = 'R7_COMMISSIONING_EXECUTOR_ADMISSION_NOT_PROVEN';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const noAuthority = Object.freeze({
  hostExecutionAuthorized: false, sourceMutationAuthorized: false,
  signerEnrollmentAuthorized: false, leaseReleaseAuthorized: false,
  operatorApprovalCreated: false, historicalReceiptReconstructed: false,
});
const rejected = reason => Object.freeze({ applicable: true, ok: false, reason, ...noAuthority });
export const createR7CommissioningReconciliationFailure = rejected;

// This is diagnostic reconciliation of the existing request, not host admission.
// A label, administrator flag, review link or caller-provided SID cannot grant
// anything. No issuer is configured here and no deployment function is called.
export function inspectR7CommissioningRequest(record, { nowMs = Date.now() } = {}) {
  let body;
  try { body = JSON.parse(record?.body); } catch { return { applicable: false, ok: true }; }
  if (body?.recordKind !== 'next-action-packet'
      || body?.boundedPayload?.diagnosticCode !== CODE) return { applicable: false, ok: true };
  const payload = body.boundedPayload;
  if (!plain(body) || Object.keys(body).sort().join(',') !== 'boundedPayload,recordKind'
      || !plain(payload) || Object.keys(payload).length !== KEYS.length
      || Object.keys(payload).some(key => !KEYS.includes(key))
      || FLAGS.some(key => payload[key] !== false)
      || TEXT.some(key => typeof payload[key] !== 'string' || payload[key].length < 1
        || payload[key].length > (key === 'summary' ? 240 : 1024))
      || !Array.isArray(payload.requiredEvidence) || payload.requiredEvidence.length < 1
      || payload.requiredEvidence.length > 8
      || payload.requiredEvidence.some(x => typeof x !== 'string' || x.length < 1 || x.length > 1024)
      || Buffer.byteLength(record.body, 'utf8') > 4096
      || payload.executionIdentityStatus !== 'NOT_PROVEN'
      || !/^https:\/\/github\.com\/Cheekyfellastef\/stephan-os\/issues\/3123#issuecomment-[1-9][0-9]*$/.test(payload.requestRef))
    return rejected('R7_ADMISSION_REQUEST_NOT_CLOSED_WORLD');
  const validation = validateSharedWorkspaceRecord(record, { nowMs });
  const stamp = Date.parse(record.timestampUtc);
  if (!validation.valid || !Number.isFinite(nowMs) || !Number.isFinite(stamp)
      || stamp > nowMs + 30_000)
    return rejected('R7_ADMISSION_MESSAGE_INVALID');
  // An old request can be reconciled to HOLD; age never turns it into approval.
  if (record.participantId !== 'chatgpt-bridge' || record.channel !== 'chatgpt-participant-bridge'
      || record.kind !== 'stephanos.shared_workspace.record.message'
      || record.relatedIssue !== '#3123' || record.relatedPr !== '#3178'
      || record.correlationId !== 'r7-executor-admission-3123'
      || !/^next-action-packet-[a-z0-9][a-z0-9._-]{7,59}$/.test(record.messageId ?? '')
      || record.proofRefs.length !== 1
      || record.proofRefs[0] !== 'receipts/' + record.messageId.slice('next-action-packet-'.length))
    return rejected('R7_ADMISSION_MESSAGE_IDENTITY_MISMATCH');
  return Object.freeze({ applicable: true, ok: true, requestDigest: digest(record),
    reason: 'R7_ADMISSION_REQUEST_RECONCILABLE', ...noAuthority });
}

export async function reconcileR7CommissioningInbox({
  root, segments, record, resumed = false, writeOptions = {},
  readFileFn = readFile, writeAtomicJsonFn = writeAtomicJson,
  acquireLockFn = acquireSharedWorkspaceOperationLock,
} = {}) {
  const nowMs = Number.isFinite(writeOptions.nowMs) ? writeOptions.nowMs : Date.now();
  const inspected = inspectR7CommissioningRequest(record, { nowMs });
  if (!inspected.applicable || !inspected.ok) return inspected;
  if (!Array.isArray(segments) || segments.length !== 2 || segments[0] !== 'inbox'
      || segments[1] !== record.messageId.slice('next-action-packet-'.length) + '.json')
    return rejected('R7_ADMISSION_NOT_EXACT_INBOX');
  const inbox = resolveSharedWorkspacePath({ root, repoRoot: writeOptions.repoRoot, segments });
  if (!inbox.ok) return rejected('R7_ADMISSION_INBOX_PATH_REJECTED');
  // Freeze the delivered data before any await: mutation of the in-memory
  // record cannot change correlation or redirect the output during I/O.
  let delivered = JSON.parse(JSON.stringify(record));
  const receiptId = 'r7-admission-' + createHash('sha256').update(delivered.messageId).digest('hex').slice(0, 32);
  const receiptSegments = ['receipts', receiptId + '.json'];
  const target = resolveSharedWorkspacePath({ root, repoRoot: writeOptions.repoRoot, segments: receiptSegments });
  if (!target.ok) return rejected('R7_ADMISSION_RECEIPT_PATH_REJECTED');
  const guard = await acquireLockFn(root, ['receipts', receiptId + '.lock'], {
    repoRoot: writeOptions.repoRoot, operationLockTimeoutMs: 1000, operationLockRetryMs: 25,
    operationStaleLockMs: 30_000, operationLockHeartbeatMs: 5000,
  });
  if (!guard?.ok) return rejected('R7_ADMISSION_RECONCILIATION_BUSY');
  // Keep the tentative outcome private until release confirms that the exact
  // operation lock remained ours. A readback alone cannot prove serialization.
  async function reconcileWhileOwned() {
    if (typeof guard.verifyOwnership !== 'function' || await guard.verifyOwnership() !== true)
      return rejected('R7_ADMISSION_OPERATION_LOCK_LOST');
    let persisted;
    try { persisted = JSON.parse(await readFileFn(inbox.path, 'utf8')); }
    catch { return rejected('R7_ADMISSION_PERSISTED_INBOX_UNREADABLE'); }
    if (digest(persisted) !== digest(resumed ? { ...delivered, timestampUtc: persisted?.timestampUtc } : delivered))
      return rejected('R7_ADMISSION_PERSISTED_INBOX_CONFLICT');
    const canonical = inspectR7CommissioningRequest(persisted, { nowMs });
    if (!canonical.applicable || !canonical.ok) return rejected('R7_ADMISSION_PERSISTED_INBOX_INVALID');
    delivered = persisted;
    const receipt = {
      ...createSharedWorkspaceReceiptRecord({
        receiptId, participantId: 'chatgpt-bridge', timestampUtc: delivered.timestampUtc,
        correlationId: delivered.correlationId, relatedIssue: '#3123', relatedPr: '#3178',
        proofRefs: [...delivered.proofRefs],
        receivedRecordId: delivered.messageId, disposition: 'R7_COMMISSIONING_HELD',
        summary: 'Request reconciled; Windows executor admission remains unproven.',
      }),
      admissionReconciliation: {
        schemaVersion: 'stephanos.r7-commissioning-inbox-reconciliation.v1',
        requestDigest: canonical.requestDigest, status: 'HELD',
        blockers: ['R7_COMPLETE_CANDIDATE_IDENTITY_UNPROVEN',
          'R7_HISTORICAL_WRITER_ENROLLMENT_ISSUER_UNDEFINED',
          'R7_WINDOWS_EXECUTOR_ADMISSION_ISSUER_UNDEFINED'],
        ...noAuthority,
      },
    };
    let existing;
    try { existing = JSON.parse(await readFileFn(target.path, 'utf8')); }
    catch (error) {
      if (error?.code !== 'ENOENT') return rejected('R7_ADMISSION_EXISTING_RECEIPT_UNREADABLE');
    }
    if (existing && JSON.stringify(existing) !== JSON.stringify(receipt))
      return rejected('R7_ADMISSION_RECEIPT_CONFLICT');
    if (!existing) {
      if (await guard.verifyOwnership() !== true)
        return rejected('R7_ADMISSION_OPERATION_LOCK_LOST');
      const written = await writeAtomicJsonFn(root, receiptSegments, receipt, writeOptions);
      if (written?.ok !== true) return rejected('R7_ADMISSION_RECEIPT_WRITE_FAILED');
    }
    // Read back even a repeated receipt. Delivery success and this diagnostic
    // HOLD are separate. This never creates an approval or calls an executor.
    let verified;
    try { verified = JSON.parse(await readFileFn(target.path, 'utf8')); }
    catch { return rejected('R7_ADMISSION_RECEIPT_READBACK_FAILED'); }
    if (JSON.stringify(verified) !== JSON.stringify(receipt))
      return rejected('R7_ADMISSION_RECEIPT_READBACK_CONFLICT');
    return Object.freeze({ applicable: true, ok: true, held: true,
      reason: existing ? 'R7_ADMISSION_ALREADY_RECONCILED_HELD' : 'R7_ADMISSION_RECONCILED_HELD',
      receiptId, ...noAuthority });
  }
  let outcome;
  try { outcome = await reconcileWhileOwned(); }
  catch { outcome = rejected('R7_ADMISSION_RECONCILIATION_FAILED_CLOSED'); }
  try {
    if (await guard.release() !== true)
      return rejected('R7_ADMISSION_OPERATION_LOCK_RELEASE_UNPROVEN');
  } catch {
    return rejected('R7_ADMISSION_OPERATION_LOCK_RELEASE_UNPROVEN');
  }
  return outcome;
}
