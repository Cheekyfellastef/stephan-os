import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMissionRecord, readMissionRecord } from './missionOrchestratorStore.js';
import { publishMissionWorkerAction } from './missionOrchestratorWorkerService.js';
import { claimNextMissionWorkerItem, processNextSignedOpenClawItem } from './missionOrchestratorWorkerConsumer.js';

const intent = {
  missionId: 'worker-consumer-test', operatorIntent: 'Implement a bounded source change.',
  intendedOutcome: 'The change is safely promoted.', missionKind: 'implementation',
  repository: 'Cheekyfellastef/stephan-os', repositoryRoot: 'C:\\repo', branch: 'openclaw/worker-consumer-test',
  worktreePath: 'C:\\worktrees\\worker-consumer-test', allowedFiles: ['shared/agents/**'],
  requiredEvidence: ['focused test output'], requiredTests: ['node --test focused.test.mjs'],
};

async function options() {
  const parent = await mkdtemp(join(tmpdir(), 'mission-worker-consumer-'));
  const { privateKey } = generateKeyPairSync('ed25519');
  return { root: join(parent, 'state'), snapshotRoot: join(parent, 'proof'), queueRoot: join(parent, 'queue'), privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), now: new Date('2026-06-24T23:00:00.000Z') };
}

test('claims a pending queue item exactly once by moving it to processing', async () => {
  const runtime = await options();
  const created = await createMissionRecord(intent, runtime);
  await publishMissionWorkerAction(created.state, runtime);
  const claim = await claimNextMissionWorkerItem('openclaw-signed', runtime);
  assert.equal(claim.item.missionId, intent.missionId);
  assert.equal(await claimNextMissionWorkerItem('openclaw-signed', runtime), null);
});

test('consumes a signed worktree item, appends the canonical event, and archives deterministic result', async () => {
  const runtime = await options();
  const created = await createMissionRecord(intent, runtime);
  await publishMissionWorkerAction(created.state, runtime);
  const processed = await processNextSignedOpenClawItem({
    ...runtime,
    executeSignedOperation: async () => ({ success: true, commandOutputHash: 'a'.repeat(64), completedAt: '2026-06-24T23:01:00.000Z' }),
    inspectSignedOperation: async () => ({ worktreePath: intent.worktreePath, clean: true }),
  });
  assert.equal(processed.processed, true);
  assert.equal(processed.event.eventType, 'WORKTREE_READY');
  assert.equal(processed.applied.state.currentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(JSON.parse(await readFile(processed.resultPath, 'utf8')).finalVerdict, 'MISSION_WORKER_ITEM_COMPLETE');
  assert.equal((await readMissionRecord(intent.missionId, runtime)).state.git.worktreeReady, true);
});

test('failed signed execution records a blocked mission event and archives the item as failed', async () => {
  const runtime = await options();
  const created = await createMissionRecord({ ...intent, missionId: 'worker-failure-test', branch: 'openclaw/worker-failure-test' }, runtime);
  await publishMissionWorkerAction(created.state, runtime);
  const processed = await processNextSignedOpenClawItem({
    ...runtime,
    executeSignedOperation: async () => ({ success: false, error: 'git unavailable', commandOutputHash: 'b'.repeat(64), completedAt: '2026-06-24T23:02:00.000Z' }),
    inspectSignedOperation: async () => { throw new Error('must not inspect failed execution'); },
  });
  assert.equal(processed.event.eventType, 'MISSION_BLOCKED');
  assert.equal(processed.applied.state.currentPhase, 'BLOCKED');
  assert.match(processed.resultPath.replace(/\\/g, '/'), /\/failed\//);
});

test('invalid success inspection fails closed without claiming mission progress', async () => {
  const runtime = await options();
  const created = await createMissionRecord({ ...intent, missionId: 'worker-inspection-test', branch: 'openclaw/worker-inspection-test' }, runtime);
  await publishMissionWorkerAction(created.state, runtime);
  const processed = await processNextSignedOpenClawItem({
    ...runtime,
    executeSignedOperation: async () => ({ success: true, commandOutputHash: 'c'.repeat(64), completedAt: '2026-06-24T23:03:00.000Z' }),
    inspectSignedOperation: async () => ({ worktreePath: '', clean: false }),
  });
  assert.equal(processed.result.finalVerdict, 'MISSION_WORKER_ITEM_FAILED');
  assert.equal((await readMissionRecord('worker-inspection-test', runtime)).state.currentPhase, 'CREATE_WORKTREE');
});
