import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  CODEX_DISPATCH_QUEUE_SCHEMA_VERSION,
  CODEX_QUEUE_STATUS,
  buildCodexDispatchQueueContract,
  createCodexQueueRecord,
  publishCodexQueueRecordToSharedWorkspace,
  transitionCodexQueueRecord,
  validateCodexQueueRecord,
} from './codexDispatchQueue.mjs';

const REPO_ROOT = resolve('.');
const base = {
  issueNumber: 1292,
  branch: 'codex/issues-1292-1293-dispatch-queue',
  prompt: 'Build Codex Dispatch Queue V1 without writing queue data into the source tree.',
  requestedProofCommands: ['node --test shared/agents/codexDispatchQueue.test.mjs', 'git diff --check'],
};

test('contract exposes bounded deterministic queue schema', () => {
  const contract = buildCodexDispatchQueueContract();
  assert.equal(contract.schemaVersion, CODEX_DISPATCH_QUEUE_SCHEMA_VERSION);
  assert.deepEqual(contract.statuses, ['queued', 'dispatched', 'running', 'waiting-proof', 'succeeded', 'blocked', 'failed']);
  assert.equal(contract.workspaceBoundary, 'Shared Agent Workspace outside source tree');
  assert.equal(contract.guardrails.sourceTreeQueueWritesAllowed, false);
  assert.equal(contract.guardrails.arbitraryShellAllowed, false);
  assert.equal(contract.sharedWorkspaceEventKinds.includes('codex-job-proof'), true);
});

test('queue creation creates unique job id and required fields', () => {
  const record = createCodexQueueRecord({ ...base, createdAt: '2026-06-30T00:00:00Z' });
  assert.match(record.jobId, /^codex-job-[a-f0-9]{20}$/);
  assert.equal(record.issueNumber, 1292);
  assert.equal(record.status, CODEX_QUEUE_STATUS.QUEUED);
  assert.equal(record.createdAt, '2026-06-30T00:00:00Z');
  assert.equal(record.dispatchedAt, '');
  assert.equal(record.completedAt, '');
  assert.equal(record.sharedWorkspaceMessage.eventKind, 'codex-job-created');
  assert.equal(validateCodexQueueRecord(record).finalVerdict, 'CODEX_QUEUE_RECORD_PASS');
});

test('queue transition validity records dispatch and proof flow timestamps', () => {
  const queued = createCodexQueueRecord(base);
  const dispatched = transitionCodexQueueRecord(queued, 'dispatched', { timestamp: '2026-06-30T00:01:00Z' });
  const running = transitionCodexQueueRecord(dispatched.record, 'running', { timestamp: '2026-06-30T00:02:00Z' });
  const proof = transitionCodexQueueRecord(running.record, 'waiting-proof', { timestamp: '2026-06-30T00:03:00Z' });
  const succeeded = transitionCodexQueueRecord(proof.record, 'succeeded', {
    timestamp: '2026-06-30T00:04:00Z',
    resultMetadata: { proofCommands: base.requestedProofCommands, proofPassed: true },
  });

  assert.equal(dispatched.record.dispatchedAt, '2026-06-30T00:01:00Z');
  assert.equal(succeeded.record.completedAt, '2026-06-30T00:04:00Z');
  assert.equal(succeeded.record.resultMetadata.proofPassed, true);
  assert.deepEqual(succeeded.record.history.map((entry) => entry.toStatus), ['queued', 'dispatched', 'running', 'waiting-proof', 'succeeded']);
});

test('immutable history returns new frozen records without mutating prior records', () => {
  const original = createCodexQueueRecord({ ...base, createdAt: '2026-06-30T00:00:00Z' });
  const transitioned = transitionCodexQueueRecord(original, 'dispatched', { timestamp: '2026-06-30T00:01:00Z' }).record;

  assert.notEqual(original, transitioned);
  assert.equal(Object.isFrozen(original), true);
  assert.equal(Object.isFrozen(original.history), true);
  assert.equal(original.status, 'queued');
  assert.equal(original.history.length, 1);
  assert.equal(transitioned.status, 'dispatched');
  assert.equal(transitioned.history.length, 2);
});

test('invalid transition rejection never mutates queue record', () => {
  const queued = createCodexQueueRecord(base);
  const result = transitionCodexQueueRecord(queued, 'succeeded', { timestamp: '2026-06-30T00:10:00Z' });

  assert.equal(result.valid, false);
  assert.equal(result.error, 'invalid-transition');
  assert.equal(result.finalVerdict, 'CODEX_QUEUE_TRANSITION_REJECTED');
  assert.equal(queued.status, 'queued');
  assert.equal(queued.completedAt, '');
});

test('bounded schema rejects extra fields and unsafe proof commands', () => {
  const record = createCodexQueueRecord({ ...base, requestedProofCommands: ['node --test shared/agents/codexDispatchQueue.test.mjs', 'git reset --hard HEAD'] });
  const tampered = { ...record, arbitraryShell: 'bash anything' };

  assert.deepEqual(record.requestedProofCommands, ['node --test shared/agents/codexDispatchQueue.test.mjs']);
  assert.equal(validateCodexQueueRecord(tampered).errors.includes('unbounded-schema'), true);
});

test('Shared Agent Workspace write/read and status publish stay in bounded temp workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-codex-queue-workspace-test-'));
  try {
    const record = createCodexQueueRecord({
      ...base,
      createdAt: '2026-06-30T00:00:00Z',
    });
    const publication = await publishCodexQueueRecordToSharedWorkspace(root, record, { repoRoot: REPO_ROOT });

    assert.equal(publication.ok, true);
    assert.equal(publication.statusWrite.path.startsWith(root), true);
    assert.equal(publication.eventAppend.path.startsWith(root), true);
    const status = JSON.parse(await readFile(join(root, 'status', 'codex-dispatch-queue.json'), 'utf8'));
    const events = (await readFile(join(root, 'events', 'codex-dispatch-queue.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(status.kind, 'stephanos.shared_workspace.status');
    assert.equal(status.status, 'queued');
    assert.equal(events.at(-1).kind, 'stephanos.shared_workspace.event');
    assert.equal(events.at(-1).eventKind, 'codex-job-created');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
