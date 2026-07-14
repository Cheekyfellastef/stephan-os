import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CODEX_DISPATCH_QUEUE_SCHEMA_VERSION,
  CODEX_QUEUE_STATUS,
  buildCodexDispatchQueueContract,
  buildManualCodexHandoffPacket,
  createCodexQueueRecord,
  isSafeCodexQueueProofRef,
  projectCodexQueueDashboard,
  publishCodexQueueStatusToSharedWorkspace,
  readCodexQueueRecordFromSharedWorkspace,
  transitionCodexQueueRecord,
  validateCodexQueueRecord,
  writeCodexQueueRecordToSharedWorkspace,
} from './codexDispatchQueue.mjs';
import { runVerifier } from './verificationHarness.mjs';

const REPO_ROOT = new URL('../..', import.meta.url).pathname;
const base = {
  issueNumber: 1292,
  branch: 'codex/issues-1292-dispatch-queue',
  prompt: 'Build Codex Dispatch Queue V1 with manual dispatch and Shared Agent Workspace proof.',
  requestedProofCommands: ['node --test shared/agents/codexDispatchQueue.test.mjs', 'git diff --check'],
  createdAt: '2026-07-07T00:00:00Z',
  approvalRequirements: { requiresOperatorApprovalBeforeDispatch: true },
};

async function tempWorkspace() {
  return mkdtemp(join(tmpdir(), 'stephanos-codex-queue-'));
}

function readyRecord() {
  const queued = createCodexQueueRecord(base);
  const waiting = transitionCodexQueueRecord(queued, 'WAITING_OPERATOR_APPROVAL', { timestamp: '2026-07-07T00:01:00Z' });
  assert.equal(waiting.valid, true);
  const ready = transitionCodexQueueRecord(waiting.record, 'READY_FOR_MANUAL_DISPATCH', {
    timestamp: '2026-07-07T00:02:00Z',
    approvalReceipt: 'operator-approved-exact-head-cda63ec',
  });
  assert.equal(ready.valid, true);
  return ready.record;
}

test('contract exposes required #1292 states, transitions, proof refs, and safety guardrails', () => {
  const contract = buildCodexDispatchQueueContract();
  assert.equal(contract.schemaVersion, CODEX_DISPATCH_QUEUE_SCHEMA_VERSION);
  assert.deepEqual(contract.statuses, Object.values(CODEX_QUEUE_STATUS));
  assert.deepEqual(contract.transitions.QUEUED, ['WAITING_OPERATOR_APPROVAL', 'BLOCKED']);
  assert.equal(contract.transitions.READY_FOR_MANUAL_DISPATCH.includes('DISPATCHED_MANUAL'), true);
  assert.equal(contract.guardrails.automaticCodexLaunchAllowed, false);
  assert.equal(contract.guardrails.fakeDispatchAllowed, false);
  assert.equal(contract.guardrails.queueBypassesApproval, false);
  assert.equal(contract.proofRequirementRefs.includes('#1287 Verification Harness'), true);
  assert.equal(contract.sharedWorkspacePaths.queueRecords, 'codex-dispatch/queue/*.json');
  assert.equal(contract.missingIntegrationBlocker, 'BLOCKED_BY_MISSING_CODEX_AUTOMATED_DISPATCH_INTEGRATION_1293');
});

test('queue creation produces bounded QUEUED record requiring operator and exact-head approval', () => {
  const record = createCodexQueueRecord(base);
  assert.match(record.jobId, /^codex-job-[a-f0-9]{20}$/);
  assert.equal(record.status, 'QUEUED');
  assert.deepEqual(record.history.map((entry) => entry.toStatus), ['QUEUED']);
  assert.equal(record.approvalRequirements.approvalReceipt, '');
  assert.equal(record.approvalRequirements.requiresOperatorApprovalBeforeDispatch, true);
  assert.equal(record.approvalRequirements.requiresExactHeadApproval, true);
  assert.equal(record.integrationState.automatedCodexDispatchProven, false);
  assert.equal(record.integrationState.blocker, 'BLOCKED_BY_MISSING_CODEX_AUTOMATED_DISPATCH_INTEGRATION_1293');
  assert.equal(record.sharedWorkspaceMessage.eventKind, 'codex-job-created');
  assert.equal(validateCodexQueueRecord(record).finalVerdict, 'CODEX_QUEUE_RECORD_PASS');
});

test('constructor cannot create ready or dispatched records even when status, receipt, and history are supplied', () => {
  const attempted = createCodexQueueRecord({
    ...base,
    status: 'READY_FOR_MANUAL_DISPATCH',
    approvalRequirements: { ...base.approvalRequirements, approvalReceipt: 'untrusted-receipt' },
    history: [{ fromStatus: '', toStatus: 'READY_FOR_MANUAL_DISPATCH' }],
    dispatchedAt: '2026-07-07T00:02:00Z',
  });
  assert.equal(attempted.status, 'QUEUED');
  assert.equal(attempted.approvalRequirements.approvalReceipt, '');
  assert.equal(attempted.dispatchedAt, '');
  assert.deepEqual(attempted.history.map((entry) => entry.toStatus), ['QUEUED']);
});

test('state transitions enforce approval before manual dispatch and keep deterministic history', () => {
  const queued = createCodexQueueRecord(base);
  const waiting = transitionCodexQueueRecord(queued, 'WAITING_OPERATOR_APPROVAL', { timestamp: '2026-07-07T00:01:00Z' });
  const blockedReady = transitionCodexQueueRecord(waiting.record, 'READY_FOR_MANUAL_DISPATCH', { timestamp: '2026-07-07T00:02:00Z' });
  assert.equal(blockedReady.valid, false);
  assert.equal(blockedReady.error, 'missing-operator-approval-receipt');

  const ready = transitionCodexQueueRecord(waiting.record, 'READY_FOR_MANUAL_DISPATCH', { timestamp: '2026-07-07T00:02:00Z', approvalReceipt: 'operator-approved-head-cda63ec' });
  const manual = transitionCodexQueueRecord(ready.record, 'DISPATCHED_MANUAL', { timestamp: '2026-07-07T00:03:00Z' });
  const claimed = transitionCodexQueueRecord(manual.record, 'CLAIMED', { timestamp: '2026-07-07T00:04:00Z' });
  const running = transitionCodexQueueRecord(claimed.record, 'RUNNING', { timestamp: '2026-07-07T00:05:00Z' });
  const waitingProof = transitionCodexQueueRecord(running.record, 'WAITING_PROOF', { timestamp: '2026-07-07T00:06:00Z' });
  const proof = transitionCodexQueueRecord(waitingProof.record, 'PROOF_RECEIVED', { timestamp: '2026-07-07T00:07:00Z' });
  const verified = transitionCodexQueueRecord(proof.record, 'VERIFIED', { timestamp: '2026-07-07T00:08:00Z' });
  const done = transitionCodexQueueRecord(verified.record, 'DONE', { timestamp: '2026-07-07T00:09:00Z', resultMetadata: { proofPassed: true } });

  assert.equal(manual.record.dispatchedAt, '2026-07-07T00:03:00Z');
  assert.equal(done.record.completedAt, '2026-07-07T00:09:00Z');
  assert.deepEqual(done.record.history.map((entry) => entry.toStatus), ['QUEUED', 'WAITING_OPERATOR_APPROVAL', 'READY_FOR_MANUAL_DISPATCH', 'DISPATCHED_MANUAL', 'CLAIMED', 'RUNNING', 'WAITING_PROOF', 'PROOF_RECEIVED', 'VERIFIED', 'DONE']);
  assert.equal(validateCodexQueueRecord(done.record).valid, true);
});

test('legacy lowercase dispatched input cannot bypass operator approval path', () => {
  const queued = createCodexQueueRecord(base);
  const legacy = transitionCodexQueueRecord(queued, 'dispatched', { timestamp: '2026-07-07T00:01:00Z' });
  assert.equal(legacy.valid, false);
  assert.equal(legacy.error, 'invalid-transition');
  assert.equal(legacy.fromStatus, 'QUEUED');
  assert.equal(legacy.toStatus, 'DISPATCHED_MANUAL');
});

test('tampered history cannot manufacture a ready queue record', () => {
  const queued = createCodexQueueRecord(base);
  const tampered = {
    ...queued,
    status: 'READY_FOR_MANUAL_DISPATCH',
    approvalRequirements: { ...queued.approvalRequirements, approvalReceipt: 'fabricated' },
    history: [{ ...queued.history[0], toStatus: 'READY_FOR_MANUAL_DISPATCH' }],
  };
  const validation = validateCodexQueueRecord(tampered);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes('history-must-start-queued'), true);
});

test('default proof refs satisfy ProofReferenceVerifier', () => {
  const record = createCodexQueueRecord(base);
  const verifier = runVerifier('ProofReferenceVerifier', { proofRefs: record.proofRequirements.refs }, { timestampUtc: '2026-07-07T00:21:30Z' });
  assert.equal(verifier.status, 'PASS');
  assert.equal(verifier.finalVerdict, 'PROOF_REFERENCE_VERIFIER_PASS');
});

test('unsafe proof refs fail queue validation using the canonical bounded path rules', () => {
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
});

test('manual handoff packet never claims automated dispatch and requires approved ready state', () => {
  const queued = createCodexQueueRecord(base);
  assert.equal(buildManualCodexHandoffPacket(queued).finalVerdict, 'CODEX_MANUAL_HANDOFF_BLOCKED');
  const ready = readyRecord();
  const packet = buildManualCodexHandoffPacket(ready);
  assert.equal(packet.dispatchMode, 'manual_operator_dispatch_only');
  assert.equal(packet.validForManualDispatch, true);
  assert.equal(packet.safety.automaticCodexLaunchAllowed, false);
  assert.equal(packet.automatedDispatchBlockedBy, 'BLOCKED_BY_MISSING_CODEX_AUTOMATED_DISPATCH_INTEGRATION_1293');
});

test('Shared Agent Workspace write/read and status publish stay in bounded temp workspace', async () => {
  const root = await tempWorkspace();
  try {
    const record = createCodexQueueRecord(base);
    const write = await writeCodexQueueRecordToSharedWorkspace(root, record, { repoRoot: REPO_ROOT });
    assert.equal(write.ok, true);
    assert.equal(write.path.includes('/codex-dispatch/queue/'), true);
    const read = await readCodexQueueRecordFromSharedWorkspace(root, record.jobId, { repoRoot: REPO_ROOT });
    assert.equal(read.ok, true);
    assert.equal(read.record.jobId, record.jobId);
    const publish = await publishCodexQueueStatusToSharedWorkspace(root, record, { repoRoot: REPO_ROOT, timestampUtc: '2026-07-07T00:10:00Z' });
    assert.equal(publish.ok, true);
    assert.equal(publish.statusRecord.status, 'QUEUED');
    assert.equal(publish.eventRecord.eventKind, 'codex-job-created');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid queue records publish no Shared Workspace truth', async () => {
  const root = await tempWorkspace();
  try {
    const record = createCodexQueueRecord(base);
    const invalid = { ...record, approvalRequirements: { ...record.approvalRequirements, requiresExactHeadApproval: false } };
    const publish = await publishCodexQueueStatusToSharedWorkspace(root, invalid, { repoRoot: REPO_ROOT, timestampUtc: '2026-07-07T00:10:00Z' });
    assert.equal(publish.ok, false);
    assert.equal(publish.reason, 'exact-head-approval-not-required');
    assert.deepEqual(publish.writes, []);
    await assert.rejects(access(join(root, 'status', 'codex-dispatch-queue.json')));
    await assert.rejects(access(join(root, 'events', 'codex-dispatch-queue.jsonl')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unsafe proof refs cannot be persisted or published', async () => {
  const root = await tempWorkspace();
  try {
    const invalid = createCodexQueueRecord({ ...base, proofRequirements: { refs: ['../proof/foo.json'] } });
    assert.equal((await writeCodexQueueRecordToSharedWorkspace(root, invalid, { repoRoot: REPO_ROOT })).ok, false);
    assert.equal((await publishCodexQueueStatusToSharedWorkspace(root, invalid, { repoRoot: REPO_ROOT })).ok, false);
    await assert.rejects(access(join(root, 'status', 'codex-dispatch-queue.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dashboard projection and verification harness queue verifier are deterministic', () => {
  const queued = createCodexQueueRecord(base);
  const waiting = transitionCodexQueueRecord(queued, 'WAITING_OPERATOR_APPROVAL', { timestamp: '2026-07-07T00:01:00Z' }).record;
  const dashboard = projectCodexQueueDashboard([waiting, queued], { generatedAt: '2026-07-07T00:20:00Z' });
  assert.equal(dashboard.queueDepth, 2);
  assert.equal(dashboard.counts.QUEUED, 1);
  assert.equal(dashboard.counts.WAITING_OPERATOR_APPROVAL, 1);
  assert.deepEqual(dashboard.jobs.map((job) => job.jobId), [queued.jobId, waiting.jobId].sort());

  const verifier = runVerifier('CodexQueueRecordVerifier', { record: queued }, { timestampUtc: '2026-07-07T00:21:00Z' });
  assert.equal(verifier.status, 'PASS');
  assert.equal(verifier.finalVerdict, 'CODEX_QUEUE_RECORD_VERIFIER_PASS');
});

test('unsafe proof commands and unapproved dispatch records are blocked', () => {
  const record = createCodexQueueRecord({ ...base, requestedProofCommands: ['node --test shared/agents/codexDispatchQueue.test.mjs', 'git reset --hard HEAD'] });
  assert.deepEqual(record.requestedProofCommands, ['node --test shared/agents/codexDispatchQueue.test.mjs']);
  const tampered = { ...record, approvalRequirements: { ...record.approvalRequirements, requiresExactHeadApproval: false } };
  const validation = validateCodexQueueRecord(tampered);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes('exact-head-approval-not-required'), true);
});
