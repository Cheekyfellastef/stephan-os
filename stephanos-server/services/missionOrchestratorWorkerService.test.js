import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMissionRecord, readMissionRecord } from './missionOrchestratorStore.js';
import {
  collectAgentWorkerResult,
  publishMissionWorkerAction,
  publishNextMissionWorkerAction,
  readMissionWorkerQueue,
  resolveMissionWorkerQueueRoot,
} from './missionOrchestratorWorkerService.js';

const now = new Date('2026-06-24T22:30:00.000Z');
const intent = {
  missionId: 'worker-service-test',
  operatorIntent: 'Implement a bounded source change.',
  intendedOutcome: 'The change is delivered with deterministic evidence.',
  missionKind: 'implementation',
  repository: 'Cheekyfellastef/stephan-os',
  repositoryRoot: 'C:\\repo',
  branch: 'openclaw/worker-service-test',
  worktreePath: 'C:\\worktrees\\worker-service-test',
  allowedFiles: ['shared/agents/**'],
  requiredEvidence: ['focused test output'],
  requiredTests: ['node --test focused.test.mjs'],
};

function proof(requirement, id) {
  return {
    receiptId: id,
    requirement,
    source: 'test-runner',
    evidenceType: 'command-output',
    verified: true,
    exitCode: 0,
  };
}

async function options() {
  const parent = await mkdtemp(join(tmpdir(), 'mission-worker-service-'));
  const { privateKey } = generateKeyPairSync('ed25519');
  return {
    root: join(parent, 'state'),
    snapshotRoot: join(parent, 'proof'),
    queueRoot: join(parent, 'queue'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    now,
  };
}

test('queue root defaults beneath the external Mission Runner orchestrator root', () => {
  const root = resolveMissionWorkerQueueRoot({ USERPROFILE: 'C:\\Users\\Operator' }).replace(/\\/g, '/');
  assert.match(root, /mission-runner\/orchestrator\/worker-queue$/);
});

test('publishes a signed single-use OpenClaw request atomically and only once', async () => {
  const runtime = await options();
  const created = await createMissionRecord(intent, runtime);
  const first = await publishMissionWorkerAction(created.state, runtime);
  assert.equal(first.published, true);
  assert.equal(first.adapter, 'openclaw-signed');
  const queueItem = JSON.parse(await readFile(first.path, 'utf8'));
  assert.equal(queueItem.payload.finalVerdict, 'MISSION_WORKER_REQUEST_ISSUED');
  assert.equal(queueItem.payload.authorization.claims.singleUse, true);
  const duplicate = await publishMissionWorkerAction(created.state, runtime);
  assert.equal(duplicate.published, false);
  assert.equal(duplicate.reason, 'action-already-published');
});

test('publishes one Codex handoff and records the active dispatch', async () => {
  const runtime = await options();
  const created = await createMissionRecord(intent, runtime);
  const worktreeReady = await import('./missionOrchestratorStore.js').then(({ appendMissionEvent }) => appendMissionEvent(intent.missionId, {
    eventId: 'worktree-worker-service-001',
    eventType: 'WORKTREE_READY',
    worktreePath: intent.worktreePath,
    clean: true,
    receipt: proof('isolated worktree', 'worktree-proof'),
  }, runtime));
  const published = await publishMissionWorkerAction(worktreeReady.state, runtime);
  assert.equal(published.published, true);
  assert.equal(published.adapter, 'codex');
  const current = await readMissionRecord(intent.missionId, runtime);
  assert.equal(current.state.dispatch.status, 'running');
  const duplicate = await publishMissionWorkerAction(current.state, runtime);
  assert.equal(duplicate.published, false);
  assert.equal(duplicate.reason, 'agent-already-running');
  const queue = await readMissionWorkerQueue(runtime);
  assert.equal(queue.filter((entry) => entry.adapter === 'codex').length, 1);
  assert.equal(created.state.currentPhase, 'CREATE_WORKTREE');
});

test('collects a matching Codex result and rejects the wrong adapter', async () => {
  const runtime = await options();
  await createMissionRecord(intent, runtime);
  const { appendMissionEvent } = await import('./missionOrchestratorStore.js');
  const ready = await appendMissionEvent(intent.missionId, {
    eventId: 'worktree-worker-service-002',
    eventType: 'WORKTREE_READY',
    worktreePath: intent.worktreePath,
    clean: true,
    receipt: proof('isolated worktree', 'worktree-proof-2'),
  }, runtime);
  const handoff = await publishMissionWorkerAction(ready.state, runtime);
  await assert.rejects(() => collectAgentWorkerResult({
    missionId: intent.missionId,
    actionId: handoff.action.actionId,
    adapter: 'openclaw-readonly',
    success: true,
    receipt: proof('focused test output', 'wrong-adapter'),
  }, runtime), /does not match/);
  const collected = await collectAgentWorkerResult({
    missionId: intent.missionId,
    actionId: handoff.action.actionId,
    adapter: 'codex',
    success: true,
    resultId: 'codex-result-1',
    changedFiles: ['shared/agents/example.mjs'],
    receipt: proof('codex result', 'codex-result-proof'),
  }, runtime);
  assert.equal(collected.state.dispatch.status, 'complete');
  assert.equal(collected.state.currentPhase, 'VERIFYING');
});

test('publishes at most one runnable mission action per worker tick', async () => {
  const runtime = await options();
  await createMissionRecord({ ...intent, missionId: 'worker-first', branch: 'openclaw/worker-first' }, runtime);
  await createMissionRecord({ ...intent, missionId: 'worker-second', branch: 'openclaw/worker-second' }, runtime);
  const result = await publishNextMissionWorkerAction(runtime);
  assert.equal(result.published, true);
  const queue = await readMissionWorkerQueue(runtime);
  assert.equal(queue.length, 1);
});
