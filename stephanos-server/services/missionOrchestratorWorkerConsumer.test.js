import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendMissionEvent, createMissionRecord } from './missionOrchestratorStore.js';
import { publishMissionWorkerAction } from './missionOrchestratorWorkerService.js';
import { claimNextMissionWorkerItem, processNextCodexItem, processNextOpenClawReadonlyItem, processNextSignedOpenClawItem } from './missionOrchestratorWorkerConsumer.js';

const proof = (requirement, receiptId) => ({ receiptId, requirement, source: 'test', evidenceType: 'command-output', verified: true, exitCode: 0 });
async function runtime() {
  const parent = await mkdtemp(join(tmpdir(), 'mission-worker-consumer-'));
  const { privateKey } = generateKeyPairSync('ed25519');
  return { root: join(parent, 'state'), snapshotRoot: join(parent, 'proof'), queueRoot: join(parent, 'queue'), privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}
function intent(missionId, missionKind = 'implementation') {
  return { missionId, operatorIntent: 'Bounded mission.', intendedOutcome: 'Grounded completion.', missionKind, repository: 'Cheekyfellastef/stephan-os', repositoryRoot: 'C:\\repo', branch: `openclaw/${missionId}`, worktreePath: 'C:\\worktree', allowedFiles: missionKind === 'implementation' ? ['shared/agents/**'] : [], requiredEvidence: ['focused evidence'], requiredTests: missionKind === 'implementation' ? ['node --test focused.test.mjs'] : [], browserProofRequired: missionKind !== 'implementation' };
}

test('claims each queue item exactly once', async () => {
  const options = await runtime();
  const created = await createMissionRecord(intent('claim-test'), options);
  await publishMissionWorkerAction(created.state, options);
  assert.ok(await claimNextMissionWorkerItem('openclaw-signed', options));
  assert.equal(await claimNextMissionWorkerItem('openclaw-signed', options), null);
});

test('signed worktree result advances to implementation', async () => {
  const options = await runtime();
  const created = await createMissionRecord(intent('signed-test'), options);
  await publishMissionWorkerAction(created.state, options);
  const processed = await processNextSignedOpenClawItem({ ...options, executeSignedOperation: async () => ({ success: true, commandOutputHash: 'a'.repeat(64), completedAt: new Date().toISOString() }), inspectSignedOperation: async () => ({ worktreePath: 'C:\\worktree', clean: true }) });
  assert.equal(processed.applied.state.currentPhase, 'AGENT_IMPLEMENTATION');
});

test('Codex and OpenClaw adapters collect bounded results with one active writer', async () => {
  const codexOptions = await runtime();
  await createMissionRecord(intent('codex-test'), codexOptions);
  const ready = await appendMissionEvent('codex-test', { eventId: 'worktree', eventType: 'WORKTREE_READY', worktreePath: 'C:\\worktree', clean: true, receipt: proof('isolated worktree', 'worktree') }, codexOptions);
  await publishMissionWorkerAction(ready.state, codexOptions);
  const codex = await processNextCodexItem({ ...codexOptions, executeCodexAction: async () => ({ success: true, changedFiles: ['shared/agents/example.mjs'], receipt: proof('codex result', 'result'), evidenceReceipts: [proof('focused evidence', 'evidence')] }) });
  assert.equal(codex.applied.state.currentPhase, 'GITHUB_COMMIT');

  const openClawOptions = await runtime();
  const created = await createMissionRecord(intent('readonly-test', 'live-runtime-investigation'), openClawOptions);
  await publishMissionWorkerAction(created.state, openClawOptions);
  const openclaw = await processNextOpenClawReadonlyItem({ ...openClawOptions, executeOpenClawReadonlyAction: async () => ({ success: true, changedFiles: [], receipt: proof('openclaw result', 'result'), evidenceReceipts: [proof('focused evidence', 'evidence')] }) });
  assert.equal(openclaw.applied.state.activeWriter, 'none');
  assert.deepEqual(openclaw.result.changedFiles, []);
});
