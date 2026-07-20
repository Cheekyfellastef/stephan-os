import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  appendExecutionReceipt,
  buildExecutionWorkerAdapterContract,
  classifyExecutionReceiptSet,
  classifyExecutionReceiptTransition,
  createExecutionReceipt,
  executionReceiptFromCodexQueueRecord,
  projectExecutionReceipt,
  readCurrentExecutionReceipt,
  renderExecutionReceiptStatus,
  toSharedWorkspaceExecutionReceipt,
  validateExecutionReceipt,
} from './executionReceiptV1.mjs';
import {
  CODEX_QUEUE_STATUS,
  createCodexQueueRecord,
  transitionCodexQueueRecord,
} from './codexDispatchQueue.mjs';

const HEAD = 'a'.repeat(40);
const BASE = {
  repository: 'Cheekyfellastef/stephan-os',
  issueNumber: 1568,
  branch: 'goal-1568-execution-receipts-v1',
  sourceHead: HEAD,
  workerId: 'github-first-worker',
  workerType: 'github-first',
  executionId: 'execution-1568',
  leaseKey: 'issue-1568',
  timestampUtc: '2026-07-20T10:00:00.000Z',
  heartbeatExpiresAtUtc: '2026-07-20T10:02:00.000Z',
  proofRefs: ['proof/execution-1568.json'],
  expectedNextAction: 'start implementation',
};
function receipt(overrides = {}) { return createExecutionReceipt({ ...BASE, ...overrides }); }
function queueBase() {
  return createCodexQueueRecord({
    issueNumber: 1568,
    branch: BASE.branch,
    prompt: 'Implement the bounded execution receipt slice.',
    requestedProofCommands: ['node --test shared/agents/executionReceiptV1.test.mjs'],
    proofRequirements: { refs: BASE.proofRefs },
    integrationState: { automatedCodexDispatchProven: true },
    createdAt: BASE.timestampUtc,
  });
}
function transition(record, status, timestamp, input = {}) {
  const result = transitionCodexQueueRecord(record, status, { timestamp, ...input });
  assert.equal(result.valid, true, result.errors?.join(',') || result.error);
  return result.record;
}

// Core schema and transition safety.
test('canonical receipt validates and is exact-head bound', () => {
  const result = validateExecutionReceipt(receipt(), { repository: BASE.repository, issueNumber: 1568, expectedHead: HEAD });
  assert.equal(result.valid, true);
  assert.equal(validateExecutionReceipt(receipt(), { expectedHead: 'b'.repeat(40) }).refusalReason, 'head-mismatch');
});

test('unknown state and malformed identities fail closed', () => {
  const invalid = { ...receipt(), state: 'imagined', workerId: '../worker' };
  const result = validateExecutionReceipt(invalid);
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('invalid-worker-id'), true);
  assert.equal(result.errors.includes('invalid-state'), true);
});

test('transition rejects out-of-order receipts and cross-repository mutation', () => {
  const first = receipt({ state: 'queued', sequence: 1, expectedNextAction: 'accept task' });
  const next = receipt({ state: 'accepted', sequence: 3, predecessorReceiptId: first.receiptId, repository: 'other/repo', timestampUtc: '2026-07-20T10:00:10.000Z' });
  const result = classifyExecutionReceiptTransition(first, next);
  assert.equal(result.accepted, false);
  assert.equal(result.errors.includes('repository-changed'), true);
  assert.equal(result.errors.includes('out-of-order-sequence'), true);
});

test('conflicting terminal states are rejected', () => {
  const completed = receipt({ state: 'completed', phase: 'done', sequence: 4, predecessorReceiptId: 'execution-1568-3', timestampUtc: '2026-07-20T10:03:00.000Z', expectedNextAction: '' });
  const failed = receipt({ state: 'failed', phase: 'failed', sequence: 5, predecessorReceiptId: completed.receiptId, timestampUtc: '2026-07-20T10:04:00.000Z', expectedNextAction: '' });
  const result = classifyExecutionReceiptTransition(completed, failed);
  assert.equal(result.accepted, false);
  assert.equal(result.errors.includes('conflicting-terminal-state'), true);
});

test('receipt-set classification validates every adjacent execution transition', () => {
  const first = receipt({ state: 'started', sequence: 1, expectedNextAction: 'continue work' });
  const fabricated = receipt({ state: 'completed', sequence: 3, predecessorReceiptId: 'fabricated-2', timestampUtc: '2026-07-20T10:01:00.000Z', expectedNextAction: '' });
  const result = classifyExecutionReceiptSet([first, fabricated]);
  assert.equal(result.finalVerdict, 'EXECUTION_RECEIPT_SET_BLOCKED');
  assert.equal(result.chainErrors.some((error) => error.includes('out-of-order-sequence')), true);
  assert.equal(result.chainErrors.some((error) => error.includes('predecessor-mismatch')), true);
});

test('duplicate active leases fail closed while one valid chain passes', () => {
  const one = receipt({ executionId: 'execution-a', receiptId: 'execution-a-1' });
  const same = receipt({ executionId: 'execution-a', receiptId: 'execution-a-2', sequence: 2, predecessorReceiptId: one.receiptId, state: 'accepted', timestampUtc: '2026-07-20T10:00:10.000Z' });
  const duplicate = receipt({ executionId: 'execution-b', receiptId: 'execution-b-1' });
  assert.equal(classifyExecutionReceiptSet([one, same]).finalVerdict, 'EXECUTION_RECEIPT_SET_PASS');
  assert.equal(classifyExecutionReceiptSet([one, same, duplicate]).finalVerdict, 'DUPLICATE_ACTIVE_EXECUTION_LEASE');
});

// Projection and persistence safety.
test('missing receipt projects UNKNOWN and expired heartbeat projects STALE', () => {
  assert.equal(projectExecutionReceipt(null).operationalState, 'UNKNOWN');
  const projection = projectExecutionReceipt(receipt(), { nowMs: Date.parse('2026-07-20T10:03:00.000Z') });
  assert.equal(projection.operationalState, 'STALE');
  assert.equal(projection.blocker, 'EXECUTION_HEARTBEAT_STALE');
  assert.match(renderExecutionReceiptStatus(receipt(), { nowMs: Date.parse('2026-07-20T10:01:00.000Z') }), /EXECUTION_STATE=QUEUED/);
});

test('Shared Workspace append, transition and idempotent replay preserve canonical truth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'execution-receipt-test-'));
  try {
    const first = receipt();
    assert.equal((await appendExecutionReceipt(root, first, { repoRoot: resolve('.') })).reason, 'EXECUTION_RECEIPT_APPENDED');
    assert.equal((await appendExecutionReceipt(root, first, { repoRoot: resolve('.') })).reason, 'EXECUTION_RECEIPT_ALREADY_APPENDED');
    const second = receipt({ state: 'accepted', sequence: 2, predecessorReceiptId: first.receiptId, timestampUtc: '2026-07-20T10:01:00.000Z', expectedNextAction: 'start worker' });
    assert.equal((await appendExecutionReceipt(root, second, { repoRoot: resolve('.') })).ok, true);
    const current = await readCurrentExecutionReceipt(root, { executionId: first.executionId }, { repoRoot: resolve('.'), nowMs: Date.parse('2026-07-20T10:01:30.000Z') });
    assert.equal(current.ok, true);
    assert.equal(current.receipt.receiptId, second.receiptId);
    assert.equal(current.projection.operationalState, 'ACCEPTED');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('persistence refuses a duplicate active execution before overwriting current state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'execution-receipt-duplicate-'));
  try {
    const first = receipt({ executionId: 'execution-a', receiptId: 'execution-a-1' });
    const duplicate = receipt({ executionId: 'execution-b', receiptId: 'execution-b-1' });
    assert.equal((await appendExecutionReceipt(root, first, { repoRoot: resolve('.') })).ok, true);
    const result = await appendExecutionReceipt(root, duplicate, { repoRoot: resolve('.') });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'DUPLICATE_ACTIVE_EXECUTION_LEASE');
    const current = await readCurrentExecutionReceipt(root, { leaseKey: BASE.leaseKey }, { repoRoot: resolve('.') });
    assert.equal(current.receipt.executionId, 'execution-a');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('newest invalid receipt blocks current projection instead of falling back to older state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'execution-receipt-invalid-latest-'));
  try {
    const first = receipt();
    assert.equal((await appendExecutionReceipt(root, first, { repoRoot: resolve('.') })).ok, true);
    const second = receipt({ state: 'accepted', sequence: 2, predecessorReceiptId: first.receiptId, timestampUtc: '2026-07-20T10:01:00.000Z', expectedNextAction: 'start worker' });
    const converted = toSharedWorkspaceExecutionReceipt(second);
    assert.equal(converted.ok, true);
    const poisoned = { ...converted.record, executionReceipt: { ...second, sourceHead: 'b'.repeat(40) } };
    await appendFile(join(root, 'receipts', 'execution-receipts.jsonl'), `${JSON.stringify(poisoned)}\n`);
    const current = await readCurrentExecutionReceipt(root, { executionId: first.executionId, expectedHead: HEAD }, { repoRoot: resolve('.') });
    assert.equal(current.ok, false);
    assert.equal(current.receipt, null);
    assert.equal(current.projection.operationalState, 'UNKNOWN');
    assert.equal(current.projection.blocker, 'head-mismatch');
  } finally { await rm(root, { recursive: true, force: true }); }
});

// First producer adapter safety.
test('Codex dispatch queue adapter rejects invalid source evidence before projecting state', () => {
  const invalid = executionReceiptFromCodexQueueRecord({ jobId: 'partial', status: 'RUNNING' }, { repository: BASE.repository, sourceHead: HEAD });
  assert.equal(invalid, null);
});

test('Codex dispatch queue adapter accepts a canonical RUNNING record', () => {
  let queueRecord = queueBase();
  queueRecord = transition(queueRecord, CODEX_QUEUE_STATUS.WAITING_OPERATOR_APPROVAL, '2026-07-20T10:00:01.000Z');
  queueRecord = transition(queueRecord, CODEX_QUEUE_STATUS.READY_FOR_MANUAL_DISPATCH, '2026-07-20T10:00:02.000Z', { approvalReceipt: 'operator-approved-1568' });
  queueRecord = transition(queueRecord, CODEX_QUEUE_STATUS.DISPATCHED_MANUAL, '2026-07-20T10:00:03.000Z');
  queueRecord = transition(queueRecord, CODEX_QUEUE_STATUS.CLAIMED, '2026-07-20T10:00:04.000Z');
  queueRecord = transition(queueRecord, CODEX_QUEUE_STATUS.RUNNING, '2026-07-20T10:00:05.000Z');
  const adapted = executionReceiptFromCodexQueueRecord(queueRecord, { repository: BASE.repository, sourceHead: HEAD, sequence: 1, expectedNextAction: 'publish progress heartbeat' });
  assert.equal(adapted.state, 'started');
  assert.equal(validateExecutionReceipt(adapted).valid, true);
  assert.equal(buildExecutionWorkerAdapterContract().firstProducer, 'codex-dispatch-queue');
});

test('Codex queue BLOCKED remains terminal in the execution projection', () => {
  const blockedQueue = transition(queueBase(), CODEX_QUEUE_STATUS.BLOCKED, '2026-07-20T10:00:01.000Z', { blockerMetadata: { reason: 'capacity unavailable' } });
  const adapted = executionReceiptFromCodexQueueRecord(blockedQueue, { repository: BASE.repository, sourceHead: HEAD, sequence: 1 });
  assert.equal(adapted.state, 'failed');
  assert.equal(adapted.expectedNextAction, '');
  assert.equal(projectExecutionReceipt(adapted).operationalState, 'FAILED');
});
