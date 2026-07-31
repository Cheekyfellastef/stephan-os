import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendMissionEvent, createMissionRecord, readMissionRecord } from './missionOrchestratorStore.js';
import { buildMissionWorkerAction } from '../../shared/agents/missionOrchestratorWorker.mjs';
import {
  collectAgentWorkerResult,
  publishMissionWorkerAction,
  publishNextMissionWorkerAction,
  readMissionWorkerQueue,
  resolveMissionWorkerQueueRoot,
} from './missionOrchestratorWorkerService.js';

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

test('publisher rejects retargeting and publishes only the exact granted mission action', async () => {
  const options = await runtime();
  const first = await createMissionRecord({ ...intent, missionId: 'grant-first', branch: 'openclaw/grant-first' }, options);
  const second = await createMissionRecord({ ...intent, missionId: 'grant-second', branch: 'openclaw/grant-second' }, options);
  const action = buildMissionWorkerAction(second.state, options);
  const grant = {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    controllerId: 'durable-flywheel-controller',
    sourceRevision: 'a'.repeat(40),
    boundedActionCount: 1,
    missionId: second.state.missionId,
    missionRevision: second.state.revision,
    currentPhase: second.state.currentPhase,
    actionId: action.actionId,
    actionKind: action.actionKind,
    adapter: 'openclaw-signed',
    operation: action.operation,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  };
  const published = await publishNextMissionWorkerAction({ ...options, actionGrant: grant });
  assert.equal(published.published, true);
  assert.equal(published.action.missionId, second.state.missionId);
  assert.equal(published.actionGrantAccepted, true);
  const queued = await readMissionWorkerQueue(options);
  assert.deepEqual(queued.map(({ item }) => item.missionId), [second.state.missionId]);

  const retargeted = await publishNextMissionWorkerAction({
    ...options,
    actionGrant: { ...grant, actionId: buildMissionWorkerAction(first.state, options).actionId },
  });
  assert.equal(retargeted.published, false);
  assert.equal(retargeted.reason, 'action-grant-mismatch');
});
