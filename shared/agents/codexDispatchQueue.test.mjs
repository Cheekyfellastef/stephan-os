import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  CODEX_DISPATCH_QUEUE_SCHEMA_VERSION,
  CODEX_QUEUE_STATUS,
  buildCodexDispatchQueueContract,
  buildManualCodexHandoffPacket,
  createCodexQueueRecord,
  isSafeCodexQueueProofRef,
  projectCodexQueueDashboard,
  publishCodexQueueRecordToSharedWorkspace,
  readCodexQueueRecordFromSharedWorkspace,
  transitionCodexQueueRecord,
  validateCodexQueueRecord,
  writeCodexQueueRecordToSharedWorkspace,
} from './codexDispatchQueue.mjs';
import { runVerifier } from './verificationHarness.mjs';

const REPO_ROOT = resolve('.');
const base = {
  issueNumber: 1292,
  branch: 'codex/issues-1292-1293-dispatch-queue',
  prompt: 'Build Codex Dispatch Queue V1 without writing queue data into the source tree.',
  requestedProofCommands: ['node --test shared/agents/codexDispatchQueue.test.mjs', 'git diff --check'],
  createdAt: '2026-07-14T00:00:00Z',
  approvalRequirements: { requiresOperatorApprovalBeforeDispatch: true },
};

function readyRecord() {
  const queued = createCodexQueueRecord(base);
  const waiting = transitionCodexQueueRecord(queued, CODEX_QUEUE_STATUS.WAITING_OPERATOR_APPROVAL, { timestamp: '2026-07-14T00:01:00Z' });
  assert.equal(waiting.valid, true);
  const ready = transitionCodexQueueRecord(waiting.record, CODEX_QUEUE_STATUS.READY_FOR_MANUAL_DISPATCH, {
    timestamp: '2026-07-14T00:02:00Z',
    approvalReceipt: 'operator-approved-exact-head-0123456789abcdef0123456789abcdef01234567',
  });
  assert.equal(ready.valid, true);
  return ready.record;
}

test('contract exposes canonical #1292 states, transitions, proof refs, and safety guardrails', () => {
  const contract = buildCodexDispatchQueueContract();
  assert.equal(contract.schemaVersion, CODEX_DISPATCH_QUEUE_SCHEMA_VERSION);
  assert.deepEqual(contract.statuses, Object.values(CODEX_QUEUE_STATUS));
  assert.deepEqual(contract.transitions.QUEUED, ['WAITING_OPERATOR_APPROVAL', 'BLOCKED']);
  assert.equal(contract.transitions.READY_FOR_MANUAL_DISPATCH.includes('DISPATCHED_MANUAL'), true);
  assert.equal(contract.workspaceBoundary, 'Shared Agent Workspace outside source tree');
  assert.equal(contract.guardrails.sourceTreeQueueWritesAllowed, false);
  assert.equal(contract.guardrails.automaticCodexLaunchAllowed, false);
  assert.equal(contract.guardrails.fakeDispatchAllowed, false);
  assert.equal(contract.guardrails.queueBypassesApproval, false);
  assert.equal(contract.sharedWorkspacePaths.queueRecords, 'codex-dispatch/queue/*.json');
});

test('new queue records always begin QUEUED with no receipt or dispatch timestamp', () => {
  const record = createCodexQueueRecord({
    ...base,
    status: CODEX_QUEUE_STATUS.READY_FOR_MANUAL_DISPATCH,
    dispatchedAt: '2026-07-14T00:02:00Z',
    completedAt: '2026-07-14T00:03:00Z',
    approvalRequirements: { ...base.approvalRequirements, approvalReceipt: 'untrusted-receipt' },
    history: [{ fromStatus: '', toStatus: CODEX_QUEUE_STATUS.READY_FOR_MANUAL_DISPATCH }],
  });
  assert.match(record.jobId, /^codex-job-[a-f0-9]{20}$/);
  assert.equal(record.status, CODEX_QUEUE_STATUS.QUEUED);
  assert.equal(record.dispatchedAt, '');
  assert.equal(record.completedAt, '');
  assert.equal(record.approvalRequirements.approvalReceipt, '');
  assert.deepEqual(record.history.map((entry) => entry.toStatus), [CODEX_QUEUE_STATUS.QUEUED]);
  assert.equal(record.sharedWorkspaceMessage.eventKind, 'codex-job-created');
  assert.equal(validateCodexQueueRecord(record).finalVerdict, 'CODEX_QUEUE_RECORD_PASS');
});

test('canonical transition chain requires approval and records deterministic history', () => {
  const queued = createCodexQueueRecord(base);
  const waiting = transitionCodexQueueRecord(queued, 'WAITING_OPERATOR_APPROVAL', { timestamp: '2026-07-14T00:01:00Z' });
  const blockedReady = transitionCodexQueueRecord(waiting.record, 'READY_FOR_MANUAL_DISPATCH', { timestamp: '2026-07-14T00:02:00Z' });
  assert.equal(blockedReady.valid, false);
  assert.equal(blockedReady.error, 'missing-operator-approval-receipt');

  const ready = transitionCodexQueueRecord(waiting.record, 'READY_FOR_MANUAL_DISPATCH', { timestamp: '2026-07-14T00:02:00Z', approvalReceipt: 'operator-approved-head' });
  const dispatched = transitionCodexQueueRecord(ready.record, 'DISPATCHED_MANUAL', { timestamp: '2026-07-14T00:03:00Z' });
  const claimed = transitionCodexQueueRecord(dispatched.record, 'CLAIMED', { timestamp: '2026-07-14T00:04:00Z' });
  const running = transitionCodexQueueRecord(claimed.record, 'RUNNING', { timestamp: '2026-07-14T00:05:00Z' });
  const waitingProof = transitionCodexQueueRecord(running.record, 'WAITING_PROOF', { timestamp: '2026-07-14T00:06:00Z' });
  const proof = transitionCodexQueueRecord(waitingProof.record, 'PROOF_RECEIVED', { timestamp: '2026-07-14T00:07:00Z' });
  const verified = transitionCodexQueueRecord(proof.record, 'VERIFIED', { timestamp: '2026-07-14T00:08:00Z' });
  const done = transitionCodexQueueRecord(verified.record, 'DONE', { timestamp: '2026-07-14T00:09:00Z', resultMetadata: { proofPassed: true } });

  assert.equal(dispatched.record.dispatchedAt, '2026-07-14T00:03:00Z');
  assert.equal(done.record.completedAt, '2026-07-14T00:09:00Z');
  assert.equal(done.record.resultMetadata.proofPassed, true);
  assert.deepEqual(done.record.history.map((entry) => entry.toStatus), [
    'QUEUED', 'WAITING_OPERATOR_APPROVAL', 'READY_FOR_MANUAL_DISPATCH', 'DISPATCHED_MANUAL',
    'CLAIMED', 'RUNNING', 'WAITING_PROOF', 'PROOF_RECEIVED', 'VERIFIED', 'DONE',
  ]);
  assert.equal(validateCodexQueueRecord(done.record).valid, true);
});

test('legacy lowercase dispatched cannot bypass the approval path', () => {
  const queued = createCodexQueueRecord(base);
  const result = transitionCodexQueueRecord(queued, 'dispatched', { timestamp: '2026-07-14T00:01:00Z' });
  assert.equal(result.valid, false);
  assert.equal(result.error, 'invalid-transition');
  assert.equal(result.fromStatus, 'QUEUED');
  assert.equal(result.toStatus, 'DISPATCHED_MANUAL');
});

test('tampered history cannot manufacture a ready queue record', () => {
  const queued = createCodexQueueRecord(base);
  const tampered = {
    ...queued,
    status: 'READY_FOR_MANUAL_DISPATCH',
    approvalRequirements: { ...queued.approvalRequirements, approvalReceipt: 'fabricated' },
  };
  const validation = validateCodexQueueRecord(tampered);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes('history-status-mismatch'), true);
});

test('unsafe proof refs fail queue validation and canonical verifier compatibility is retained', () => {
  for (const ref of ['../proof/foo.json', '/tmp/proof.json', 'C:/proof/foo.json', 'proof/../../secret.json']) {
    const record = createCodexQueueRecord({ ...base, proofRequirements: { refs: [ref] } });
    const validation = validateCodexQueueRecord(record);
    assert.equal(validation.valid, false, ref);
    assert.equal(validation.errors.includes('unsafe-proof-ref'), true, ref);
    assert.equal(isSafeCodexQueueProofRef(ref), false, ref);
  }
  for (const ref of ['proof/foo.json', 'proofs/foo.json', 'receipts/foo.json', 'evidence/receipts/foo.json']) {
    assert.equal(isSafeCodexQueueProofRef(ref), true, ref);
  }
  const record = createCodexQueueRecord(base);
  const verifier = runVerifier('ProofReferenceVerifier', { proofRefs: record.proofRequirements.refs }, { timestampUtc: '2026-07-14T00:10:00Z' });
  assert.equal(verifier.status, 'PASS');
});

test('manual handoff is blocked until the record reached ready through transitions', () => {
  const queued = createCodexQueueRecord(base);
  assert.equal(buildManualCodexHandoffPacket(queued).finalVerdict, 'CODEX_MANUAL_HANDOFF_BLOCKED');
  const ready = readyRecord();
  const packet = buildManualCodexHandoffPacket(ready);
  assert.equal(packet.validForManualDispatch, true);
  assert.equal(packet.dispatchMode, 'manual_operator_dispatch_only');
  assert.equal(packet.safety.automaticCodexLaunchAllowed, false);
});

test('bounded Shared Workspace write, read, and publication retain canonical queue truth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-codex-queue-workspace-test-'));
  try {
    const record = createCodexQueueRecord(base);
    const write = await writeCodexQueueRecordToSharedWorkspace(root, record, { repoRoot: REPO_ROOT });
    assert.equal(write.ok, true);
    const read = await readCodexQueueRecordFromSharedWorkspace(root, record.jobId, { repoRoot: REPO_ROOT });
    assert.equal(read.ok, true);
    assert.equal(read.record.jobId, record.jobId);

    const publication = await publishCodexQueueRecordToSharedWorkspace(root, record, { repoRoot: REPO_ROOT, timestampUtc: '2026-07-14T00:10:00Z' });
    assert.equal(publication.ok, true);
    assert.equal(publication.statusWrite.path.startsWith(root), true);
    assert.equal(publication.eventWrite.path.startsWith(root), true);
    const status = JSON.parse(await readFile(join(root, 'status', 'codex-dispatch-queue.json'), 'utf8'));
    const events = (await readFile(join(root, 'events', 'codex-dispatch-queue.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(status.status, 'QUEUED');
    assert.equal(events.at(-1).eventKind, 'codex-job-created');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid queue records publish no Shared Workspace truth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-codex-queue-invalid-test-'));
  try {
    const record = createCodexQueueRecord(base);
    const invalid = { ...record, approvalRequirements: { ...record.approvalRequirements, requiresExactHeadApproval: false } };
    const publication = await publishCodexQueueRecordToSharedWorkspace(root, invalid, { repoRoot: REPO_ROOT });
    assert.equal(publication.ok, false);
    assert.equal(publication.reason, 'exact-head-approval-not-required');
    assert.deepEqual(publication.writes, []);
    await assert.rejects(access(join(root, 'status', 'codex-dispatch-queue.json')));
    await assert.rejects(access(join(root, 'events', 'codex-dispatch-queue.jsonl')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unsafe proof refs cannot be persisted or published', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-codex-queue-ref-test-'));
  try {
    const invalid = createCodexQueueRecord({ ...base, proofRequirements: { refs: ['../proof/foo.json'] } });
    assert.equal((await writeCodexQueueRecordToSharedWorkspace(root, invalid, { repoRoot: REPO_ROOT })).ok, false);
    assert.equal((await publishCodexQueueRecordToSharedWorkspace(root, invalid, { repoRoot: REPO_ROOT })).ok, false);
    await assert.rejects(access(join(root, 'status', 'codex-dispatch-queue.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dashboard projection preserves transitioned state rather than recreating records', () => {
  const queued = createCodexQueueRecord(base);
  const waiting = transitionCodexQueueRecord(queued, 'WAITING_OPERATOR_APPROVAL', { timestamp: '2026-07-14T00:01:00Z' }).record;
  const dashboard = projectCodexQueueDashboard([waiting, queued], { generatedAt: '2026-07-14T00:20:00Z' });
  assert.equal(dashboard.queueDepth, 2);
  assert.equal(dashboard.counts.QUEUED, 1);
  assert.equal(dashboard.counts.WAITING_OPERATOR_APPROVAL, 1);
});

test('bounded schema rejects extra fields and unsafe proof commands', () => {
  const record = createCodexQueueRecord({ ...base, requestedProofCommands: ['node --test shared/agents/codexDispatchQueue.test.mjs', 'git reset --hard HEAD'] });
  const tampered = { ...record, arbitraryShell: 'bash anything' };
  assert.deepEqual(record.requestedProofCommands, ['node --test shared/agents/codexDispatchQueue.test.mjs']);
  assert.equal(validateCodexQueueRecord(tampered).errors.includes('unbounded-schema'), true);
});
