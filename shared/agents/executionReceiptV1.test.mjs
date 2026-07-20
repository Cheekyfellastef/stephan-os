import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { appendFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
function queueBase(overrides = {}) {
  return createCodexQueueRecord({
    issueNumber: 1568,
    branch: BASE.branch,
    prompt: 'Implement the bounded execution receipt slice.',
    requestedProofCommands: ['node --test shared/agents/executionReceiptV1.test.mjs'],
    proofRequirements: { refs: BASE.proofRefs },
    integrationState: { automatedCodexDispatchProven: true },
    createdAt: BASE.timestampUtc,
    ...overrides,
  });
}
function transition(record, status, timestamp, input = {}) {
  const result = transitionCodexQueueRecord(record, status, { timestamp, ...input });
  assert.equal(result.valid, true, result.errors?.join(',') || result.error);
  return result.record;
}
async function appendInChildProcess(root, candidate) {
  const inputDirectory = join(root, 'child-inputs');
  const candidatePath = join(inputDirectory, `${candidate.receiptId}.json`);
  await mkdir(inputDirectory, { recursive: true });
  await writeFile(candidatePath, JSON.stringify(candidate));
  const worker = `
    const [root, candidatePath, repoRoot, moduleUrl] = process.argv.slice(1);
    const { readFile } = await import('node:fs/promises');
    const { appendExecutionReceipt } = await import(moduleUrl);
    const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
    const result = await appendExecutionReceipt(root, candidate, { repoRoot });
    process.stdout.write(JSON.stringify({ ok: result.ok, reason: result.reason }));
  `;
  const child = spawn(process.execPath, [
    '--input-type=module',
    '--eval',
    worker,
    root,
    candidatePath,
    resolve('.'),
    pathToFileURL(resolve('shared/agents/executionReceiptV1.mjs')).href,
  ], { cwd: resolve('.'), windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [exitCode] = await once(child, 'close');
  assert.equal(exitCode, 0, stderr);
  return JSON.parse(stdout);
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

test('proof references must contain normalized nonempty safe evidence', () => {
  for (const proofRefs of [[null], [''], ['   '], [null, '   ']]) {
    const invalid = { ...receipt(), proofRefs };
    const validation = validateExecutionReceipt(invalid);
    assert.equal(validation.valid, false);
    assert.equal(validation.refusalReason, 'missing-proof-refs');
    assert.equal(toSharedWorkspaceExecutionReceipt(invalid).ok, false);
  }
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

test('idempotent replay repairs a missing current-by-lease projection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'execution-receipt-missing-current-'));
  const currentPath = join(root, 'receipts', `${BASE.leaseKey}.json`);
  try {
    const first = receipt();
    assert.equal((await appendExecutionReceipt(root, first, { repoRoot: resolve('.') })).ok, true);
    await rm(currentPath, { force: true });

    const replay = await appendExecutionReceipt(root, first, { repoRoot: resolve('.') });
    assert.equal(replay.ok, true);
    assert.equal(replay.reason, 'EXECUTION_RECEIPT_ALREADY_APPENDED');
    assert.equal(replay.current.repaired, true);
    const persisted = JSON.parse(await readFile(currentPath, 'utf8'));
    assert.deepEqual(persisted, toSharedWorkspaceExecutionReceipt(first).record);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('idempotent replay replaces a stale current-by-lease projection with canonical latest history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'execution-receipt-stale-current-'));
  const currentPath = join(root, 'receipts', `${BASE.leaseKey}.json`);
  try {
    const first = receipt();
    const second = receipt({
      state: 'accepted',
      sequence: 2,
      predecessorReceiptId: first.receiptId,
      timestampUtc: '2026-07-20T10:01:00.000Z',
      expectedNextAction: 'start worker',
    });
    assert.equal((await appendExecutionReceipt(root, first, { repoRoot: resolve('.') })).ok, true);
    assert.equal((await appendExecutionReceipt(root, second, { repoRoot: resolve('.') })).ok, true);
    await writeFile(currentPath, `${JSON.stringify(toSharedWorkspaceExecutionReceipt(first).record, null, 2)}\n`);

    const replay = await appendExecutionReceipt(root, first, { repoRoot: resolve('.') });
    assert.equal(replay.ok, true);
    assert.equal(replay.reason, 'EXECUTION_RECEIPT_ALREADY_APPENDED');
    assert.equal(replay.current.repaired, true);
    const persisted = JSON.parse(await readFile(currentPath, 'utf8'));
    assert.deepEqual(persisted, toSharedWorkspaceExecutionReceipt(second).record);
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

test('cross-process same-lease concurrency stress preserves one canonical active execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'execution-receipt-concurrent-'));
  try {
    const workerCount = 12;
    const candidates = Array.from({ length: workerCount }, (_, index) => receipt({
      executionId: `execution-concurrent-${index}`,
      receiptId: `execution-concurrent-${index}-1`,
    }));
    const results = await Promise.all(candidates.map((candidate) => appendInChildProcess(root, candidate)));
    assert.equal(results.filter((result) => result.reason === 'EXECUTION_RECEIPT_APPENDED').length, 1);
    assert.equal(results.filter((result) => result.reason === 'DUPLICATE_ACTIVE_EXECUTION_LEASE').length, workerCount - 1);
    const current = await readCurrentExecutionReceipt(root, { leaseKey: BASE.leaseKey }, { repoRoot: resolve('.') });
    assert.equal(current.ok, true);
    assert.equal(current.receipts.length, 1);
    assert.equal(candidates.some((candidate) => candidate.executionId === current.receipt.executionId), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cross-process different-lease shared-history stress keeps large JSONL records whole', async () => {
  const root = await mkdtemp(join(tmpdir(), 'execution-receipt-shared-history-'));
  try {
    const workerCount = 8;
    const largeProofPayload = 'x'.repeat(1024 * 1024);
    const candidates = Array.from({ length: workerCount }, (_, index) => receipt({
      executionId: `execution-shared-history-${index}`,
      receiptId: `execution-shared-history-${index}-1`,
      leaseKey: `issue-1568-shared-history-${index}`,
      proofRefs: [`proof/${largeProofPayload}-${index}`],
    }));
    const results = await Promise.all(candidates.map((candidate) => appendInChildProcess(root, candidate)));
    assert.equal(results.filter((result) => result.reason === 'EXECUTION_RECEIPT_APPENDED').length, workerCount);

    const payload = await readFile(join(root, 'receipts', 'execution-receipts.jsonl'), 'utf8');
    const lines = payload.split('\n').filter(Boolean);
    assert.equal(lines.length, workerCount);
    const records = lines.map((line) => JSON.parse(line));
    assert.deepEqual(
      new Set(records.map((record) => record.executionReceipt.leaseKey)),
      new Set(candidates.map((candidate) => candidate.leaseKey)),
    );
    assert.equal(records.every((record) => record.executionReceipt.proofRefs[0].length > 1024 * 1024), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('same-lease lock has deterministic contention refusal and stale-lock recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'execution-receipt-stale-lock-'));
  const lockDirectory = join(root, 'receipt-locks');
  const lockPath = join(lockDirectory, `${BASE.leaseKey}.lock`);
  try {
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({ token: 'abandoned-lock' })}\n`);
    const blocked = await appendExecutionReceipt(root, receipt(), {
      repoRoot: resolve('.'),
      executionReceiptLockTimeoutMs: 0,
      executionReceiptStaleLockMs: 60_000,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'EXECUTION_RECEIPT_LEASE_LOCK_TIMEOUT');

    const staleTime = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleTime, staleTime);
    const recovered = await appendExecutionReceipt(root, receipt(), {
      repoRoot: resolve('.'),
      executionReceiptLockTimeoutMs: 1_000,
      executionReceiptStaleLockMs: 1,
    });
    assert.equal(recovered.ok, true);
    assert.equal(recovered.reason, 'EXECUTION_RECEIPT_APPENDED');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('workspace history lock has deterministic contention refusal and stale-lock recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'execution-receipt-history-lock-'));
  const lockDirectory = join(root, 'receipt-locks', 'history');
  const lockPath = join(lockDirectory, 'execution-receipts.lock');
  try {
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({ token: 'abandoned-history-lock' })}\n`);
    const blocked = await appendExecutionReceipt(root, receipt(), {
      repoRoot: resolve('.'),
      executionReceiptHistoryLockTimeoutMs: 0,
      executionReceiptHistoryStaleLockMs: 60_000,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'EXECUTION_RECEIPT_HISTORY_LOCK_TIMEOUT');

    const staleTime = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleTime, staleTime);
    const recovered = await appendExecutionReceipt(root, receipt(), {
      repoRoot: resolve('.'),
      executionReceiptHistoryLockTimeoutMs: 1_000,
      executionReceiptHistoryStaleLockMs: 1,
    });
    assert.equal(recovered.ok, true);
    assert.equal(recovered.reason, 'EXECUTION_RECEIPT_APPENDED');
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

test('malformed nested execution identity is validated before identity filtering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'execution-receipt-invalid-nested-identity-'));
  try {
    const first = receipt();
    assert.equal((await appendExecutionReceipt(root, first, { repoRoot: resolve('.') })).ok, true);
    const second = receipt({
      state: 'accepted',
      sequence: 2,
      predecessorReceiptId: first.receiptId,
      timestampUtc: '2026-07-20T10:01:00.000Z',
      expectedNextAction: 'start worker',
    });
    const converted = toSharedWorkspaceExecutionReceipt(second);
    assert.equal(converted.ok, true);
    const poisoned = {
      ...converted.record,
      executionReceipt: { ...second, executionId: 'execution-poisoned' },
    };
    await appendFile(join(root, 'receipts', 'execution-receipts.jsonl'), `${JSON.stringify(poisoned)}\n`);
    const current = await readCurrentExecutionReceipt(
      root,
      { executionId: first.executionId, leaseKey: first.leaseKey },
      { repoRoot: resolve('.') },
    );
    assert.equal(current.ok, false);
    assert.equal(current.receipt, null);
    assert.equal(current.reason, 'DUPLICATE_ACTIVE_EXECUTION_LEASE');
    assert.equal(current.projection.operationalState, 'UNKNOWN');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing nested execution receipt blocks filtered reads instead of falling back', async () => {
  const root = await mkdtemp(join(tmpdir(), 'execution-receipt-missing-nested-'));
  try {
    const first = receipt();
    assert.equal((await appendExecutionReceipt(root, first, { repoRoot: resolve('.') })).ok, true);
    const second = receipt({
      state: 'accepted',
      sequence: 2,
      predecessorReceiptId: first.receiptId,
      timestampUtc: '2026-07-20T10:01:00.000Z',
      expectedNextAction: 'start worker',
    });
    const converted = toSharedWorkspaceExecutionReceipt(second);
    assert.equal(converted.ok, true);
    const { executionReceipt: _removed, ...poisoned } = converted.record;
    await appendFile(join(root, 'receipts', 'execution-receipts.jsonl'), `${JSON.stringify(poisoned)}\n`);
    const current = await readCurrentExecutionReceipt(
      root,
      { executionId: first.executionId, leaseKey: first.leaseKey },
      { repoRoot: resolve('.') },
    );
    assert.equal(current.ok, false);
    assert.equal(current.reason, 'unbounded-schema');
    assert.equal(current.receipt, null);
    assert.equal(current.projection.operationalState, 'UNKNOWN');
  } finally { await rm(root, { recursive: true, force: true }); }
});

// First producer adapter safety.
test('Codex dispatch queue adapter rejects invalid source evidence before projecting state', () => {
  const invalid = executionReceiptFromCodexQueueRecord({ jobId: 'partial', status: 'RUNNING' }, { repository: BASE.repository, sourceHead: HEAD });
  assert.equal(invalid, null);
});

test('Codex dispatch queue approval wait blocker wins over conflicting metadata', () => {
  const waiting = transition(
    queueBase({ integrationState: { automatedCodexDispatchProven: false } }),
    CODEX_QUEUE_STATUS.WAITING_OPERATOR_APPROVAL,
    '2026-07-20T10:00:01.000Z',
    { blockerMetadata: { reason: 'QUEUE_METADATA_BLOCKER' } },
  );
  const adapted = executionReceiptFromCodexQueueRecord(waiting, {
    repository: BASE.repository,
    sourceHead: HEAD,
    sequence: 1,
    blocker: 'CALLER_BLOCKER',
  });
  assert.equal(adapted.operatorActionRequired, true);
  assert.equal(adapted.blocker, 'WAITING_OPERATOR_APPROVAL');
  assert.equal(validateExecutionReceipt(adapted).valid, true);
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
