import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
  validateExecutionReceipt,
} from './executionReceiptV1.mjs';

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

test('duplicate active leases fail closed while repeated history for one execution does not', () => {
  const one = receipt({ executionId: 'execution-a', receiptId: 'execution-a-1' });
  const same = receipt({ executionId: 'execution-a', receiptId: 'execution-a-2', sequence: 2, predecessorReceiptId: one.receiptId, state: 'accepted', timestampUtc: '2026-07-20T10:00:10.000Z' });
  const duplicate = receipt({ executionId: 'execution-b', receiptId: 'execution-b-1' });
  assert.equal(classifyExecutionReceiptSet([one, same]).finalVerdict, 'EXECUTION_RECEIPT_SET_PASS');
  assert.equal(classifyExecutionReceiptSet([same, duplicate]).finalVerdict, 'DUPLICATE_ACTIVE_EXECUTION_LEASE');
});

test('missing receipt projects UNKNOWN and expired heartbeat projects STALE', () => {
  assert.equal(projectExecutionReceipt(null).operationalState, 'UNKNOWN');
  const projection = projectExecutionReceipt(receipt(), { nowMs: Date.parse('2026-07-20T10:03:00.000Z') });
  assert.equal(projection.operationalState, 'STALE');
  assert.equal(projection.blocker, 'EXECUTION_HEARTBEAT_STALE');
  assert.match(renderExecutionReceiptStatus(receipt(), { nowMs: Date.parse('2026-07-20T10:01:00.000Z') }), /EXECUTION_STATE=QUEUED/);
});

test('Shared Workspace append and read preserve canonical execution truth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'execution-receipt-test-'));
  try {
    const first = receipt();
    assert.equal((await appendExecutionReceipt(root, first, { repoRoot: resolve('.') })).ok, true);
    const current = await readCurrentExecutionReceipt(root, { executionId: first.executionId }, { repoRoot: resolve('.'), nowMs: Date.parse('2026-07-20T10:01:00.000Z') });
    assert.equal(current.ok, true);
    assert.equal(current.receipt.receiptId, first.receiptId);
    assert.equal(current.projection.operationalState, 'QUEUED');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Codex dispatch queue adapter is the first real producer contract', () => {
  const queueRecord = {
    jobId: 'codex-job-1568',
    issueNumber: 1568,
    branch: BASE.branch,
    status: 'RUNNING',
    createdAt: BASE.timestampUtc,
    history: [{ timestamp: BASE.timestampUtc }],
    proofRequirements: { refs: BASE.proofRefs },
    blockerMetadata: {},
    integrationState: {},
  };
  const adapted = executionReceiptFromCodexQueueRecord(queueRecord, { repository: BASE.repository, sourceHead: HEAD, sequence: 1, expectedNextAction: 'publish progress heartbeat' });
  assert.equal(adapted.state, 'started');
  assert.equal(validateExecutionReceipt(adapted).valid, true);
  assert.equal(buildExecutionWorkerAdapterContract().firstProducer, 'codex-dispatch-queue');
});
