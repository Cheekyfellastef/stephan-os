import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SOURCE_ARTIFACT_ESCROW_V1_SCHEMA, SOURCE_ARTIFACT_KIND } from '../../shared/agents/sourceArtifactEscrowContinuityV1.mjs';
import { appendMissionEvent, createMissionRecord } from './missionOrchestratorStore.js';
import { publishMissionWorkerAction } from './missionOrchestratorWorkerService.js';
import { claimNextMissionWorkerItem, processNextCodexItem, processNextOpenClawReadonlyItem, processNextSignedOpenClawItem } from './missionOrchestratorWorkerConsumer.js';

const proof = (requirement, receiptId) => ({ receiptId, requirement, source: 'test', evidenceType: 'command-output', verified: true, exitCode: 0 });

function freshCodexCapacityRouting() {
  const now = new Date();
  return {
    nowUtc: now.toISOString(),
    codexStatus: {
      schemaVersion: 'shared-agent-workspace-record.v1',
      statusId: 'codex-capacity-current',
      truthState: 'CURRENT',
      meterTruthUsable: true,
      observedAtUtc: new Date(now.getTime() - 1000).toISOString(),
      remainingPercent: 90,
      availability: 'AVAILABLE',
      confidence: 'high',
      naturalResetAtUtc: '',
    },
    githubLaneReceipt: null,
    forgeLaneReceipt: null,
    forgeSidecar: null,
  };
}

function sourceIdentity(missionId, actionId) {
  return {
    missionId,
    actionId,
    repository: 'Cheekyfellastef/stephan-os',
    canonicalPr: 2163,
    canonicalBranch: `openclaw/${missionId}`,
    exactParentHead: 'a'.repeat(40),
    exactParentTree: 'b'.repeat(40),
    exactResultTree: 'c'.repeat(40),
    executorIdentity: `mission-worker:${missionId}`,
    changedFiles: [{ path: 'shared/agents/example.mjs', beforeBlobSha: '1'.repeat(40), afterBlobSha: '2'.repeat(40), sha256: '3'.repeat(64) }],
  };
}

function validEscrow(missionId, actionId) {
  const now = Date.now();
  return {
    schemaVersion: SOURCE_ARTIFACT_ESCROW_V1_SCHEMA,
    artifactKind: SOURCE_ARTIFACT_KIND.COMPLETE_FILE_BUNDLE,
    missionId,
    actionId,
    repository: 'Cheekyfellastef/stephan-os',
    canonicalPr: 2163,
    canonicalBranch: `openclaw/${missionId}`,
    exactParentHead: 'a'.repeat(40),
    exactParentTree: 'b'.repeat(40),
    exactResultTree: 'c'.repeat(40),
    localCommitSha: 'd'.repeat(40),
    completeArtifactSha256: 'e'.repeat(64),
    artifactRef: `shared-workspace://source-artifacts/${missionId}/proof`,
    externallyReadable: true,
    commitMessage: 'Test escrowed source completion',
    executorIdentity: `mission-worker:${missionId}`,
    createdAtUtc: new Date(now - 1000).toISOString(),
    expiresAtUtc: new Date(now + 60_000).toISOString(),
    changedFiles: [{ path: 'shared/agents/example.mjs', beforeBlobSha: '1'.repeat(40), afterBlobSha: '2'.repeat(40), sha256: '3'.repeat(64) }],
    testsRun: ['node --test focused.test.mjs'],
    testVerdicts: ['PASS'],
    diffCheckVerdict: 'PASS',
  };
}

async function runtime() {
  const parent = await mkdtemp(join(tmpdir(), 'mission-worker-consumer-'));
  const { privateKey } = generateKeyPairSync('ed25519');
  return { root: join(parent, 'state'), snapshotRoot: join(parent, 'proof'), queueRoot: join(parent, 'queue'), privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}
function intent(missionId, missionKind = 'implementation') {
  return { missionId, operatorIntent: 'Bounded mission.', intendedOutcome: 'Grounded completion.', missionKind, repository: 'Cheekyfellastef/stephan-os', repositoryRoot: 'C:\\repo', branch: `openclaw/${missionId}`, worktreePath: 'C:\\worktree', allowedFiles: missionKind === 'implementation' ? ['shared/agents/**'] : [], requiredEvidence: ['focused evidence'], requiredTests: missionKind === 'implementation' ? ['node --test focused.test.mjs'] : [], browserProofRequired: missionKind !== 'implementation' };
}

async function readyCodexMission(missionId, options) {
  await createMissionRecord(intent(missionId), options);
  const ready = await appendMissionEvent(missionId, { eventId: 'worktree', eventType: 'WORKTREE_READY', worktreePath: 'C:\\worktree', clean: true, receipt: proof('isolated worktree', 'worktree') }, options);
  return publishMissionWorkerAction(ready.state, options);
}

test('claims each queue item exactly once', async () => {
  const options = await runtime();
  const created = await createMissionRecord(intent('claim-test'), options);
  await publishMissionWorkerAction(created.state, options);
  assert.ok(await claimNextMissionWorkerItem('openclaw-signed', options));
  assert.equal(await claimNextMissionWorkerItem('openclaw-signed', options), null);
});

test('exact action grant cannot consume another mission queue item', async () => {
  const options = await runtime();
  const first = await createMissionRecord(intent('claim-first'), options);
  const second = await createMissionRecord(intent('claim-second'), options);
  const firstPublish = await publishMissionWorkerAction(first.state, options);
  const secondPublish = await publishMissionWorkerAction(second.state, options);
  const granted = await claimNextMissionWorkerItem('openclaw-signed', {
    ...options,
    actionGrant: {
      missionId: second.state.missionId,
      actionId: secondPublish.action.actionId,
      adapter: 'openclaw-signed',
    },
  });
  assert.equal(granted.item.missionId, second.state.missionId);
  assert.equal(granted.item.actionId, secondPublish.action.actionId);

  const remaining = await claimNextMissionWorkerItem('openclaw-signed', options);
  assert.equal(remaining.item.missionId, first.state.missionId);
  assert.equal(remaining.item.actionId, firstPublish.action.actionId);
});

test('signed worktree result advances to implementation', async () => {
  const options = await runtime();
  const created = await createMissionRecord(intent('signed-test'), options);
  await publishMissionWorkerAction(created.state, options);
  const processed = await processNextSignedOpenClawItem({ ...options, executeSignedOperation: async () => ({ success: true, commandOutputHash: 'a'.repeat(64), completedAt: new Date().toISOString() }), inspectSignedOperation: async () => ({ worktreePath: 'C:\\worktree', clean: true }) });
  assert.equal(processed.applied.state.currentPhase, 'AGENT_IMPLEMENTATION');
});

test('source-changing Mission Worker result fails closed before terminal completion without external escrow', async () => {
  const options = await runtime();
  options.capacityRouting = freshCodexCapacityRouting();
  const dispatch = await readyCodexMission('unescrowed-source', options);
  const processed = await processNextCodexItem({
    ...options,
    executeCodexAction: async () => ({
      success: true,
      changedFiles: ['shared/agents/example.mjs'],
      receipt: proof('codex result', 'result'),
      evidenceReceipts: [proof('focused evidence', 'evidence')],
      completedAt: new Date().toISOString(),
    }),
    finalizeSourceArtifactEscrow: async (_action, execution) => ({
      ...execution,
      stage: 'TESTED',
      testsPassed: true,
      sourceArtifactIdentity: sourceIdentity('unescrowed-source', dispatch.action.actionId),
      sourceArtifactEscrow: null,
    }),
  });
  assert.equal(processed.result.finalVerdict, 'MISSION_WORKER_ITEM_FAILED');
  assert.equal(processed.result.error, 'SOURCE_ARTIFACT_ESCROW_REQUIRED');
});

test('source-changing Mission Worker rejects an escrow that is not bound to exact execution identity', async () => {
  const options = await runtime();
  options.capacityRouting = freshCodexCapacityRouting();
  const dispatch = await readyCodexMission('identity-required', options);
  const processed = await processNextCodexItem({
    ...options,
    executeCodexAction: async () => ({
      success: true,
      stage: 'TESTED',
      testsPassed: true,
      changedFiles: ['shared/agents/example.mjs'],
      receipt: proof('codex result', 'result'),
      evidenceReceipts: [proof('focused evidence', 'evidence')],
      sourceArtifactEscrow: validEscrow('identity-required', dispatch.action.actionId),
      completedAt: new Date().toISOString(),
    }),
    finalizeSourceArtifactEscrow: async (_action, execution) => execution,
  });
  assert.equal(processed.result.finalVerdict, 'MISSION_WORKER_ITEM_FAILED');
  assert.equal(processed.result.error, 'SOURCE_ARTIFACT_ESCROW_IDENTITY_REQUIRED');
});

test('Codex and OpenClaw adapters collect bounded results with one active writer', async () => {
  const codexOptions = await runtime();
  codexOptions.capacityRouting = freshCodexCapacityRouting();
  const dispatch = await readyCodexMission('codex-test', codexOptions);
  const codex = await processNextCodexItem({
    ...codexOptions,
    executeCodexAction: async () => ({
      success: true,
      changedFiles: ['shared/agents/example.mjs'],
      receipt: proof('codex result', 'result'),
      evidenceReceipts: [proof('focused evidence', 'evidence')],
      completedAt: new Date().toISOString(),
    }),
    finalizeSourceArtifactEscrow: async (_action, execution) => ({
      ...execution,
      stage: 'TESTED',
      testsPassed: true,
      sourceArtifactIdentity: sourceIdentity('codex-test', dispatch.action.actionId),
      sourceArtifactEscrow: validEscrow('codex-test', dispatch.action.actionId),
    }),
  });
  assert.equal(codex.applied.state.currentPhase, 'GITHUB_COMMIT');

  const openClawOptions = await runtime();
  const created = await createMissionRecord(intent('readonly-test', 'live-runtime-investigation'), openClawOptions);
  await publishMissionWorkerAction(created.state, openClawOptions);
  const openclaw = await processNextOpenClawReadonlyItem({ ...openClawOptions, executeOpenClawReadonlyAction: async () => ({ success: true, changedFiles: [], receipt: proof('openclaw result', 'result'), evidenceReceipts: [proof('focused evidence', 'evidence')] }) });
  assert.equal(openclaw.applied.state.activeWriter, 'none');
  assert.deepEqual(openclaw.result.changedFiles, []);
});
