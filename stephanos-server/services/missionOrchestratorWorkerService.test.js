import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendMissionEvent, createMissionRecord, readMissionRecord } from './missionOrchestratorStore.js';
import { collectAgentWorkerResult, publishMissionWorkerAction, readMissionWorkerQueue, resolveMissionWorkerQueueRoot } from './missionOrchestratorWorkerService.js';

const intent = {
  missionId: 'worker-service-test', operatorIntent: 'Implement a bounded source change.', intendedOutcome: 'Deliver grounded evidence.',
  missionKind: 'implementation', repository: 'Cheekyfellastef/stephan-os', repositoryRoot: 'C:\\repo', branch: 'openclaw/worker-service-test',
  worktreePath: 'C:\\worktree', allowedFiles: ['shared/agents/**'], requiredEvidence: ['focused test output'], requiredTests: ['node --test focused.test.mjs'],
};
const proof = (requirement, receiptId) => ({ receiptId, requirement, source: 'test', evidenceType: 'command-output', verified: true, exitCode: 0 });
async function runtime() {
  const parent = await mkdtemp(join(tmpdir(), 'mission-worker-service-'));
  const { privateKey } = generateKeyPairSync('ed25519');
  return { root: join(parent, 'state'), snapshotRoot: join(parent, 'proof'), queueRoot: join(parent, 'queue'), privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

test('queue root defaults below Mission Runner orchestrator state', () => {
  assert.match(resolveMissionWorkerQueueRoot({ USERPROFILE: 'C:\\Users\\Operator' }).replace(/\\/g, '/'), /mission-runner\/orchestrator\/worker-queue$/);
});

test('publishes worktree then one Codex dispatch and collects grounded result', async () => {
  const options = await runtime();
  const created = await createMissionRecord(intent, options);
  assert.equal((await publishMissionWorkerAction(created.state, options)).adapter, 'openclaw-signed');
  const ready = await appendMissionEvent(intent.missionId, { eventId: 'worktree-1', eventType: 'WORKTREE_READY', worktreePath: intent.worktreePath, clean: true, receipt: proof('isolated worktree', 'worktree') }, options);
  const dispatch = await publishMissionWorkerAction(ready.state, options);
  assert.equal(dispatch.adapter, 'codex');
  assert.equal((await readMissionWorkerQueue(options)).some((entry) => entry.adapter === 'codex'), true);
  const collected = await collectAgentWorkerResult({ missionId: intent.missionId, actionId: dispatch.action.actionId, adapter: 'codex', success: true, changedFiles: ['shared/agents/example.mjs'], receipt: proof('codex result', 'result'), evidenceReceipts: [proof('focused test output', 'evidence')] }, options);
  assert.equal(collected.state.currentPhase, 'GITHUB_COMMIT');
  assert.equal((await readMissionRecord(intent.missionId, options)).state.dispatch.status, 'complete');
});
