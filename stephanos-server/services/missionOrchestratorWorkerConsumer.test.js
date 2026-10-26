import { runMissionWorkerTick } from '../../scripts/mission-orchestrator-worker.mjs';
import { appendExecutionReceipt, createExecutionReceipt, readExecutionReceiptHistory } from '../../shared/agents/executionReceiptV1.mjs';
import { writeFileSync, unlinkSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SOURCE_ARTIFACT_ESCROW_V1_SCHEMA, SOURCE_ARTIFACT_KIND } from '../../shared/agents/sourceArtifactEscrowContinuityV1.mjs';
import { appendMissionEvent, createMissionRecord, readMissionRecord } from './missionOrchestratorStore.js';
import { publishMissionWorkerAction } from './missionOrchestratorWorkerService.js';
import { claimNextMissionWorkerItem, appendMissionWorkerExecutionReceiptTransition, processNextForgePublicationItem, processNextGitHubInspectionItem, processNextCodexItem, processNextOpenClawLocalItem, processNextOpenClawReadonlyItem, processNextOpenClawStandaloneItem, processNextSignedOpenClawItem, processNextVerificationItem, proveMissionWorkerRetryOwnershipReleased } from './missionOrchestratorWorkerConsumer.js';

const proof = (requirement, receiptId) => ({ receiptId, requirement, source: 'test', evidenceType: 'command-output', verified: true, exitCode: 0 });

async function grantedForgePublicationFixture() {
  const options = await runtime();
  options.sharedWorkspaceRoot = join(options.root, '..', 'workspace');
  options.repoRoot = join(options.root, '..', 'repo');
  const missionId = 'critical-1819-elastic-goal';
  const created = await createMissionRecord(intent(missionId), options);
  const state = created.state;
  state.currentPhase = 'GITHUB_COMMIT'; state.revision = 5;
  state.git.worktreeReady = true;
  state.dispatch = { ...state.dispatch, adapter: 'foundry-forge', status: 'complete' };
  state.sourcePublication = { artifactSha256: 'e'.repeat(64), outboxId: 'offline-publication-' + 'f'.repeat(24),
    exactParentHead: 'a'.repeat(40), exactResultTree: 'c'.repeat(40), canonicalBranch: state.git.branch };
  await writeFile(created.statePath, JSON.stringify(state));
  const actionId = 'forge-publication-receipt-test';
  const action = { actionId, missionId, adapter: 'forge-publication', actionKind: 'forge-escrow-publication',
    operation: 'publish-forge-escrow', repository: state.repository, branch: state.git.branch,
    ...state.sourcePublication, receiptRequirement: 'signed exact-tree Forge draft PR publication' };
  const grant = { schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    grantId: 'grant-' + actionId, actionId, missionId, missionRevision: 5,
    repository: state.repository, issueNumber: 1819, prNumber: null, branch: state.git.branch,
    headSha: '', sourceRevision: 'a'.repeat(40), adapter: 'forge-publication',
    workerId: 'github-first', capacityProofRefs: ['forge-publication-fixture-proof'] };
  const item = { schemaVersion: 'stephanos.mission-worker-queue-item.v1', adapter: 'forge-publication',
    actionId, missionId, payload: action, actionGrant: grant, createdAt: new Date(Date.now() - 1000).toISOString(),
    executionBinding: { ...grant, schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1',
      executionId: actionId, leaseKey: missionId + '-r5-lease' } };
  const pending = join(options.queueRoot, 'forge-publication', 'pending');
  await mkdir(pending, { recursive: true });
  const path = join(pending, actionId + '.json');
  await writeFile(path, JSON.stringify(item));
  options.actionGrant = grant;
  const history = () => readExecutionReceiptHistory(options.sharedWorkspaceRoot, { executionId: actionId }, { repoRoot: options.repoRoot });
  return { options, item, path, state, history };
}

test('actual Forge publication consumer records canonical custody before publisher and completion after consumption', async () => {
  const f = await grantedForgePublicationFixture();
  let calls = 0;
  const result = await processNextForgePublicationItem({ ...f.options, executeForgePublication: async () => {
    calls++;
    const h = await f.history();
    assert.deepEqual(h.receipts.map(r => r.state), ['queued', 'accepted', 'started', 'progress']);
    assert.ok(h.receipts.every(r => r.workerType === 'github-first'));
    assert.ok(h.receipts.every(r => r.executionId === f.item.actionId && r.sourceHead === 'a'.repeat(40)));
    assert.equal((await readMissionRecord(f.state.missionId, f.options)).state.pullRequest.number, null);
    return { ok: true, finalVerdict: 'FORGE_PRE_PR_DRAFT_PUBLISHED_WITH_EXACT_TREE_PROOF',
      draft: true, mergeAuthority: false, forcePushAllowed: false,
      repository: f.state.repository, branch: f.state.git.branch,
      exactResultTree: f.state.sourcePublication.exactResultTree,
      sourceArtifactSha256: f.state.sourcePublication.artifactSha256,
      commitSha: 'd'.repeat(40), prNumber: 3002 };
  } });
  assert.equal(calls, 1, result.error?.stack);
  assert.equal(result.result.finalVerdict, 'MISSION_WORKER_ITEM_COMPLETE', result.error?.stack);
  const h = await f.history();
  assert.deepEqual(h.receipts.map(r => r.state), ['queued', 'accepted', 'started', 'progress', 'completed']);
  const state = (await readMissionRecord(f.state.missionId, f.options)).state;
  assert.equal(state.pullRequest.number, 3002);
  assert.equal(state.pullRequest.state, 'draft');
  assert.equal(state.approval.status, 'not-requested');
  // Even a restored duplicate queue file cannot execute this terminal action.
  await writeFile(f.path, JSON.stringify(f.item));
  const replay = await processNextForgePublicationItem({ ...f.options,
    executeForgePublication: async () => assert.fail('terminal publication replay executed') });
  assert.match(replay.result.error, /EXECUTION_RECEIPT_CLAIM_STATE_INVALID:completed/);
  assert.equal((await f.history()).receipts.length, 5);
});

test('Forge publication foreign persisted binding refuses before publisher or receipt fabrication', async () => {
  const f = await grantedForgePublicationFixture();
  f.item.executionBinding.sourceRevision = 'f'.repeat(40);
  await writeFile(f.path, JSON.stringify(f.item));
  const result = await processNextForgePublicationItem({ ...f.options,
    executeForgePublication: async () => assert.fail('foreign grant reached publisher') });
  assert.match(result.result.error, /EXECUTION_RECEIPT_QUEUE_GRANT_BINDING_MISMATCH/);
  assert.equal((await f.history()).receipts.length, 0);
  assert.equal((await readMissionRecord(f.state.missionId, f.options)).state.revision, 5);
});

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

function validOutbox(missionId, actionId) {
  const escrow = validEscrow(missionId, actionId);
  return {
    schemaVersion: 'stephanos.offline-publication-outbox.v1',
    outboxId: 'offline-publication-test',
    state: 'PENDING_PUBLICATION',
    missionId,
    actionId,
    completeArtifactSha256: escrow.completeArtifactSha256,
    artifactRef: escrow.artifactRef,
    preserveVerifiedArtifact: true,
    rebuildRequired: false,
    pushAuthority: false,
    mergeAuthority: false,
  };
}

function forgeSourceFields(missionId) {
  const escrow = { ...validEscrow(missionId, 'test-source'),
    canonicalPr: null,
    artifactRef: 'shared-workspace://source-artifacts/' + 'e'.repeat(64) + '.json',
  };
  const outbox = { ...validOutbox(missionId, 'test-source'),
    outboxId: 'offline-publication-' + 'f'.repeat(24),
    artifactRef: escrow.artifactRef, publicationPaused: true,
  };
  return { sourceArtifactEscrow: escrow, offlinePublicationOutbox: outbox };
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

test('verification consumer binds canonical elastic goal evidence to proven source and tests', async () => {
  const options = await runtime();
  const missionId = 'critical-1818-elastic-goal';
  const requirement = 'Goal #1818 bounded implementation and focused verification evidence';
  await createMissionRecord({ ...intent(missionId), requiredEvidence: [requirement] }, options);
  let state = (await appendMissionEvent(missionId, {
    eventId: 'verification-worktree',
    eventType: 'WORKTREE_READY',
    worktreePath: 'C:\\worktree',
    clean: true,
    receipt: proof('isolated worktree', 'verification-worktree-proof'),
  }, options)).state;
  state = (await appendMissionEvent(missionId, {
    eventId: 'verification-dispatch',
    eventType: 'AGENT_DISPATCHED',
    agentId: 'foundry-forge',
  }, options)).state;
  state = (await appendMissionEvent(missionId, {
    eventId: 'verification-source-result',
    eventType: 'AGENT_RESULT_RECEIVED',
    success: true,
    resultId: 'verification-source-result',
    ...forgeSourceFields('critical-1818-elastic-goal'),
    changedFiles: ['shared/agents/example.mjs'],
    receipt: {
      receiptId: 'verification-source-receipt',
      requirement: 'provider-neutral bounded source change',
      source: 'foundry-forge',
      evidenceType: 'source-mutation',
      verified: true,
      commandOutputHash: 'a'.repeat(64),
    },
  }, options)).state;
  state = (await appendMissionEvent(missionId, {
    eventId: 'verification-test-evidence',
    eventType: 'EVIDENCE_RECORDED',
    receipts: [{
      receiptId: 'verification-test-receipt',
      requirement: 'source deterministic test',
      source: 'provider-neutral-local-builder',
      evidenceType: 'source-test-command',
      verified: true,
      commandOutputHash: 'b'.repeat(64),
    }],
  }, options)).state;
  assert.equal(state.currentPhase, 'VERIFYING');

  const published = await publishMissionWorkerAction(state, options);
  assert.equal(published.published, true);
  assert.equal(published.adapter, 'verification');

  const result = await processNextVerificationItem(options);
  assert.equal(result.processed, true);
  assert.equal(result.result.finalVerdict, 'VERIFICATION_EVIDENCE_GROUNDED');
  assert.equal(result.applied.state.currentPhase, 'GITHUB_COMMIT');

  const current = (await readMissionRecord(missionId, options)).state;
  const grounded = current.evidenceReceipts.find((receipt) => receipt.requirement === requirement);
  assert.ok(grounded);
  assert.equal(grounded.source, 'verification-judge');
  assert.equal(grounded.evidenceType, 'source-test-suite');
  assert.match(grounded.commandOutputHash, /^[0-9a-f]{64}$/);
});

test('verification consumer refuses browser evidence from source-test receipts', async () => {
  const options = await runtime();
  const missionId = 'verification-browser-proof-test';
  await createMissionRecord({ ...intent(missionId), requiredEvidence: ['browser proof'] }, options);
  let state = (await appendMissionEvent(missionId, {
    eventId: 'browser-verification-worktree',
    eventType: 'WORKTREE_READY',
    worktreePath: 'C:\\worktree',
    clean: true,
    receipt: proof('isolated worktree', 'browser-verification-worktree-proof'),
  }, options)).state;
  state = (await appendMissionEvent(missionId, {
    eventId: 'browser-verification-dispatch',
    eventType: 'AGENT_DISPATCHED',
    agentId: 'foundry-forge',
  }, options)).state;
  state = (await appendMissionEvent(missionId, {
    eventId: 'browser-verification-source-result',
    eventType: 'AGENT_RESULT_RECEIVED',
    success: true,
    resultId: 'browser-verification-source-result',
    ...forgeSourceFields('verification-browser-proof-test'),
    changedFiles: ['shared/agents/example.mjs'],
    receipt: {
      receiptId: 'browser-verification-source-receipt',
      requirement: 'provider-neutral bounded source change',
      source: 'foundry-forge',
      evidenceType: 'source-mutation',
      verified: true,
      commandOutputHash: 'c'.repeat(64),
    },
  }, options)).state;
  state = (await appendMissionEvent(missionId, {
    eventId: 'browser-verification-test-evidence',
    eventType: 'EVIDENCE_RECORDED',
    receipts: [{
      receiptId: 'browser-verification-test-receipt',
      requirement: 'source deterministic test',
      source: 'provider-neutral-local-builder',
      evidenceType: 'source-test-command',
      verified: true,
      commandOutputHash: 'd'.repeat(64),
    }],
  }, options)).state;
  assert.equal(state.currentPhase, 'VERIFYING');

  const published = await publishMissionWorkerAction(state, options);
  assert.equal(published.published, true);
  assert.equal(published.adapter, 'verification');

  const result = await processNextVerificationItem(options);
  assert.equal(result.processed, true);
  assert.equal(result.result.finalVerdict, 'VERIFICATION_EVIDENCE_NOT_GROUNDED');
  assert.equal((await readMissionRecord(missionId, options)).state.currentPhase, 'VERIFYING');
});

test('OpenClaw Standalone consumer is a first-class queue surface', async () => {
  const options = await runtime();
  const result = await processNextOpenClawStandaloneItem({
    ...options,
    executeOpenClawStandaloneAction: async () => ({ success: true }),
  });
  assert.deepEqual(result, { processed: false, reason: 'queue-empty' });
});

test('OpenClaw Local consumer is a first-class queue surface', async () => {
  const options = await runtime();
  const result = await processNextOpenClawLocalItem({
    ...options,
    executeOpenClawLocalAction: async () => ({ success: true }),
  });
  assert.deepEqual(result, { processed: false, reason: 'queue-empty' });
});

test('claims each queue item exactly once', async () => {
  const options = await runtime();
  const created = await createMissionRecord(intent('claim-test'), options);
  await publishMissionWorkerAction(created.state, options);
  assert.ok(await claimNextMissionWorkerItem('openclaw-signed', options));
  assert.equal(await claimNextMissionWorkerItem('openclaw-signed', options), null);
});

test('signed pickup racing cancellation cannot invoke a writer after queue rename', async () => {
  const options = await runtime(); const missionId = 'critical-2962-elastic-goal';
  const created = await createMissionRecord(intent(missionId), { ...options, env: {} });
  const published = await publishMissionWorkerAction(created.state, { ...options, env: {} });
  const record = await readMissionRecord(missionId, options);
  const lockPath = join(options.root, missionId + '.lock');
  await writeFile(lockPath, 'test holds the existing mission lock');
  const claiming = claimNextMissionWorkerItem('openclaw-signed', options);
  const processing = join(options.queueRoot, 'openclaw-signed', 'processing', published.action.actionId + '.json');
  try {
    let renamed = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await access(processing).then(() => true, () => false)) { renamed = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(renamed, true);
    await writeFile(record.statePath, JSON.stringify({ ...record.state, cancelled: true,
      currentPhase: 'CANCELLED', revision: record.state.revision + 1 }));
  } finally { await unlink(lockPath); }
  assert.equal(await claiming, null);
  assert.deepEqual(await readdir(join(options.queueRoot, 'openclaw-signed', 'processing')), []);
});

test('agent handoff stays pending until atomic processing claim proves pickup', async () => {
  const options = await runtime();
  options.capacityRouting = freshCodexCapacityRouting();
  await createMissionRecord(intent('pickup-truth-test'), options);
  const ready = await appendMissionEvent('pickup-truth-test', {
    eventId: 'pickup-truth-worktree',
    eventType: 'WORKTREE_READY',
    worktreePath: 'C:\\worktree',
    clean: true,
    receipt: proof('isolated worktree', 'pickup-truth-worktree-proof'),
  }, options);
  const published = await publishMissionWorkerAction(ready.state, options);
  assert.equal(published.published, true);
  assert.equal(published.adapter, 'codex');
  assert.equal((await readMissionRecord('pickup-truth-test', options)).state.dispatch.status, 'pending');

  const claimed = await claimNextMissionWorkerItem('codex', options);
  assert.ok(claimed);
  assert.equal(claimed.pickupProof.state, 'PROCESSING_CLAIM_PROVEN');
  const running = (await readMissionRecord('pickup-truth-test', options)).state;
  assert.equal(running.dispatch.status, 'running');
  assert.equal(running.dispatch.adapter, 'codex');
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
      offlinePublicationOutbox: validOutbox('codex-test', dispatch.action.actionId),
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


test('malformed pending poison pill is quarantined and cannot block a valid item behind it', async () => {
  const options = await runtime();
  const created = await createMissionRecord(intent('pending-poison-valid-behind'), options);
  const published = await publishMissionWorkerAction(created.state, options);
  assert.equal(published.published, true);

  const pendingRoot = join(options.queueRoot, 'openclaw-signed', 'pending');
  const failedRoot = join(options.queueRoot, 'openclaw-signed', 'failed');
  await mkdir(pendingRoot, { recursive: true });
  const poisonPath = join(pendingRoot, '000-poison.json');
  const poisonBytes = '{"schemaVersion":"truncated"';
  await writeFile(poisonPath, poisonBytes, 'utf8');
  const diagnostics = [];

  const claim = await claimNextMissionWorkerItem('openclaw-signed', {
    ...options,
    onPendingQueueDiagnostic: async (diagnostic) => diagnostics.push(diagnostic),
  });

  assert.ok(claim);
  assert.equal(claim.item.actionId, published.action.actionId);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].reason, 'MISSION_WORKER_PENDING_ITEM_QUARANTINED');
  assert.equal(diagnostics[0].sourceReason, 'MISSION_WORKER_PENDING_ITEM_JSON_INVALID');
  await assert.rejects(access(poisonPath));
  const quarantined = (await readdir(failedRoot))
    .filter((name) => name.startsWith('000-poison.invalid-') && name.endsWith('.bin'));
  assert.equal(quarantined.length, 1);
  assert.equal(await readFile(join(failedRoot, quarantined[0]), 'utf8'), poisonBytes);
});

test('valid JSON pending item with mismatched immutable identity is quarantined before claim', async () => {
  const options = await runtime();
  const pendingRoot = join(options.queueRoot, 'openclaw-signed', 'pending');
  await mkdir(pendingRoot, { recursive: true });
  const invalid = {
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter: 'openclaw-signed',
    actionId: 'different-action',
    missionId: 'invalid-pending-mission',
    payload: {
      actionKind: 'signed-openclaw-operation',
      actionId: 'different-action',
      missionId: 'invalid-pending-mission',
      operation: 'create-worktree',
    },
  };
  await writeFile(
    join(pendingRoot, 'expected-action.json'),
    `${JSON.stringify(invalid)}\n`,
    'utf8',
  );
  const diagnostics = [];

  const claim = await claimNextMissionWorkerItem('openclaw-signed', {
    ...options,
    onPendingQueueDiagnostic: async (diagnostic) => diagnostics.push(diagnostic),
  });

  assert.equal(claim, null);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].reason, 'MISSION_WORKER_PENDING_ITEM_QUARANTINED');
  assert.equal(diagnostics[0].sourceReason, 'MISSION_WORKER_PENDING_ITEM_IDENTITY_INVALID');
});


test('retry ownership proof blocks while the prior provider-neutral claim is still processing', async () => {
  const options = await runtime();
  const adapter = 'foundry-forge';
  const missionId = 'retry-ownership-processing';
  const actionId = 'retry-ownership-processing-r1';
  const processingRoot = join(options.queueRoot, adapter, 'processing');
  await mkdir(processingRoot, { recursive: true });
  await writeFile(join(processingRoot, actionId + '.json'), JSON.stringify({
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter,
    actionId,
    missionId,
    executionBinding: {
      executionId: actionId,
      leaseKey: 'retry-ownership-processing-lease',
      sourceRevision: 'a'.repeat(40),
    },
  }));

  const result = await proveMissionWorkerRetryOwnershipReleased({
    missionId,
    actionId,
    adapter,
    queueRoot: options.queueRoot,
    sharedWorkspaceRoot: options.root,
    repoRoot: 'C:\\repo',
    readReceiptHistory: async () => {
      throw new Error('receipt history must not be consulted while claim is processing');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'MISSION_WORKER_RETRY_PRIOR_CLAIM_STILL_PROCESSING');
});

test('transport retry proof requires both the failed provider result and matching terminal execution', async () => {
  const options=await runtime();
  const adapter='foundry-forge',missionId='critical-1721-elastic-goal',actionId='critical-1721-elastic-goal-r5-test';
  const leaseKey=missionId+'-r5-lease',sourceHead='a'.repeat(40);
  const failedRoot=join(options.queueRoot,adapter,'failed');
  await mkdir(failedRoot,{recursive:true});
  await writeFile(join(failedRoot,actionId+'.json'),JSON.stringify({
    schemaVersion:'stephanos.mission-worker-queue-item.v1',adapter,missionId,actionId,
    actionGrant:{schemaVersion:'stephanos.mission-worker-action-grant.v1'},
    executionBinding:{schemaVersion:'stephanos.mission-worker-queue-execution-binding.v1',executionId:actionId,leaseKey,sourceRevision:sourceHead},
  }));
  const result={schemaVersion:'stephanos.provider-neutral-source-builder.v1',processed:true,success:false,
    adapter,providerAdapter:adapter,missionId,actionId,error:'fetch failed',providerInvoked:true,providerCompleted:false,
    failureStage:'PROVIDER',finalVerdict:'PROVIDER_NEUTRAL_SOURCE_BUILD_BLOCKED'};
  const receipt={receiptId:actionId+'-5',executionId:actionId,leaseKey,sourceHead,state:'failed',
    phase:'provider-neutral-result-blocked',blocker:'fetch failed'};
  const observe=(present=true)=>proveMissionWorkerRetryOwnershipReleased({missionId,actionId,adapter,
    queueRoot:options.queueRoot,sharedWorkspaceRoot:options.root,repoRoot:'C:/repo',
    readReceiptHistory:async()=>({ok:true,latestReceipt:present?receipt:null})});
  await writeFile(join(failedRoot,actionId+'.result.json'),JSON.stringify(result));
  const valid=await observe();
  assert.equal(valid.providerTransportFailure.actionId,actionId);
  assert.equal(valid.providerTransportFailure.receiptId,receipt.receiptId);
  assert.equal((await observe(false)).providerTransportFailure,undefined,'queue-only fallback never proves model transport failure');
  for(const change of [{providerInvoked:false},{providerCompleted:true},{failureStage:'SOURCE'},
    {providerAdapter:'different'},{error:'PROVIDER_NEUTRAL_SCOPE_VIOLATION'}]) {
    await writeFile(join(failedRoot,actionId+'.result.json'),JSON.stringify({...result,...change}));
    assert.equal((await observe()).providerTransportFailure,null,JSON.stringify(change));
  }
});

test('retry ownership proof requires released failed claim plus terminal execution receipt', async () => {
  const options = await runtime();
  const adapter = 'foundry-forge';
  const missionId = 'retry-ownership-terminal';
  const actionId = 'retry-ownership-terminal-r1';
  const leaseKey = 'retry-ownership-terminal-lease';
  const sourceRevision = 'b'.repeat(40);
  const failedRoot = join(options.queueRoot, adapter, 'failed');
  await mkdir(failedRoot, { recursive: true });
  await writeFile(join(failedRoot, actionId + '.json'), JSON.stringify({
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter,
    actionId,
    missionId,
    executionBinding: {
      executionId: actionId,
      leaseKey,
      sourceRevision,
    },
  }));
  await writeFile(join(failedRoot, actionId + '.result.json'), JSON.stringify({
    schemaVersion: 'stephanos.provider-neutral-source-builder.v1',
    missionId,
    actionId,
    success: false,
    error: 'PROVIDER_NEUTRAL_MODEL_STRUCTURED_EDITS_MISSING',
  }));

  const missingReceipt = await proveMissionWorkerRetryOwnershipReleased({
    missionId,
    actionId,
    adapter,
    queueRoot: options.queueRoot,
    sharedWorkspaceRoot: options.root,
    repoRoot: 'C:\\repo',
    readReceiptHistory: async () => ({
      ok: true,
      reason: 'NO_EXECUTION_RECEIPTS',
      receipts: [],
      latestReceipt: null,
    }),
  });
  assert.equal(missingReceipt.ok, false);
  assert.equal(missingReceipt.classification, 'MISSION_WORKER_RETRY_TERMINAL_EXECUTION_RECEIPT_UNPROVEN');

  await writeFile(join(failedRoot, actionId + '.json'), JSON.stringify({
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter,
    actionId,
    missionId,
    actionGrant: {
      schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    },
    executionBinding: {
      schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1',
      executionId: actionId,
      leaseKey,
      sourceRevision,
    },
  }));
  await writeFile(join(failedRoot, actionId + '.result.json'), JSON.stringify({
    schemaVersion: 'stephanos.provider-neutral-source-builder.v1',
    processed: true,
    success: false,
    adapter,
    providerAdapter: adapter,
    missionId,
    actionId,
    error: 'PROVIDER_NEUTRAL_MODEL_STRUCTURED_EDITS_MISSING',
    finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_BUILD_BLOCKED',
  }));
  const legacyProven = await proveMissionWorkerRetryOwnershipReleased({
    missionId,
    actionId,
    adapter,
    queueRoot: options.queueRoot,
    sharedWorkspaceRoot: options.root,
    repoRoot: 'C:\\repo',
    readReceiptHistory: async () => ({
      ok: true,
      reason: 'NO_EXECUTION_RECEIPTS',
      receipts: [],
      latestReceipt: null,
    }),
  });
  assert.equal(legacyProven.ok, true);
  assert.equal(legacyProven.classification, 'MISSION_WORKER_RETRY_PROVIDER_NEUTRAL_QUEUE_RELEASE_PROVEN');
  assert.equal(legacyProven.executionReceiptState, 'provider-neutral-failed-queue');

  const proven = await proveMissionWorkerRetryOwnershipReleased({
    missionId,
    actionId,
    adapter,
    queueRoot: options.queueRoot,
    sharedWorkspaceRoot: options.root,
    repoRoot: 'C:\\repo',
    readReceiptHistory: async (_root, filters) => {
      assert.equal(filters.executionId, actionId);
      assert.equal(filters.leaseKey, leaseKey);
      assert.equal(filters.expectedHead, sourceRevision);
      return {
        ok: true,
        reason: 'EXECUTION_RECEIPTS_READ',
        latestReceipt: {
          receiptId: 'terminal-receipt',
          executionId: actionId,
          leaseKey,
          state: 'failed',
        },
      };
    },
  });
  assert.equal(proven.ok, true);
  assert.equal(proven.classification, 'MISSION_WORKER_RETRY_OWNERSHIP_RELEASE_PROVEN');
  assert.equal(proven.executionReceiptId, 'terminal-receipt');
});

test('claim custody is sampled after queue reads immediately before pending rename', async () => {
  const options = await runtime();
  const created = await createMissionRecord(intent('claim-custody-expiry'), options);
  await publishMissionWorkerAction(created.state, options);
  let checks = 0;
  await assert.rejects(claimNextMissionWorkerItem('openclaw-signed', {
    ...options, assertClaimCustody: () => { checks++; throw new Error('MISSION_WORKER_CUSTODY_UNPROVEN'); },
  }), /MISSION_WORKER_CUSTODY_UNPROVEN/);
  assert.equal(checks, 1);
  assert.deepEqual(await readdir(join(options.queueRoot, 'openclaw-signed', 'processing')), []);
  assert.ok(await claimNextMissionWorkerItem('openclaw-signed', options));
});

test('custody expiring while the actual pickup store waits for its lock never publishes running', async () => {
  const options = await runtime(); options.capacityRouting = freshCodexCapacityRouting();
  const missionId = 'pickup-lock-custody-expiry';
  await createMissionRecord(intent(missionId), options);
  const ready = await appendMissionEvent(missionId, { eventId: 'pickup-lock-worktree', eventType: 'WORKTREE_READY',
    worktreePath: 'C:\\worktree', clean: true, receipt: proof('isolated worktree', 'pickup-lock-worktree') }, options);
  const published = await publishMissionWorkerAction(ready.state, options);
  assert.equal(published.adapter, 'codex');
  const before = (await readMissionRecord(missionId, options)).state;
  let fresh = true; let samples = 0; let released;
  const release = new Promise(resolve => { released = resolve; });
  const lockPath = join(options.root, `${missionId}.lock`);
  const claim = await claimNextMissionWorkerItem('codex', { ...options,
    assertClaimCustody: () => {
      samples++;
      if (!fresh) throw new Error('MISSION_WORKER_CUSTODY_UNPROVEN');
      if (samples === 2) {
        // The second sample is immediately before appendMissionEvent. Its
        // actual lock acquisition must await this independently held lock.
        writeFileSync(lockPath, 'owned-test-lock', { flag: 'wx' });
        setTimeout(() => { fresh = false; unlinkSync(lockPath); released(); }, 25);
      }
    },
  });
  await release;
  assert.equal(claim, null); assert.equal(samples, 3);
  const after = (await readMissionRecord(missionId, options)).state;
  assert.equal(after.dispatch.status, 'pending'); assert.equal(after.revision, before.revision);
  assert.deepEqual(await readdir(join(options.queueRoot, 'codex', 'processing')), []);
  assert.equal((await readdir(join(options.queueRoot, 'codex', 'pending'))).length, 1);
  assert.ok(await claimNextMissionWorkerItem('codex', options));
});


async function queuedInspectionReceiptFixture() {
  const options = await runtime();
  options.sharedWorkspaceRoot = join(options.root, '..', 'Documents', 'Stephanos-openclaw-workspace');
  options.repoRoot = join(options.root, '..', 'repo');
  const created = await createMissionRecord(intent('inspection-receipt-test'), options);
  const state = created.state;
  state.revision = 6; state.currentPhase = 'CHECK_PULL_REQUEST'; state.issueNumber = 1802;
  state.git = { ...state.git, worktreeReady: true, commitSha: 'a'.repeat(40), pushed: true };
  state.dispatch = { ...state.dispatch, status: 'complete', startedAt: new Date().toISOString() };
  state.evidenceReceipts = [proof('focused evidence', 'inspection-fixture-source-proof')];
  state.pullRequest = { ...state.pullRequest, number: 2096, headSha: 'a'.repeat(40), state: 'open', mergeable: true, checks: [] };
  await writeFile(created.statePath, JSON.stringify(state));
  const published = await publishMissionWorkerAction(state, options);
  assert.equal(published.published, true);
  const item = JSON.parse(await readFile(published.path, 'utf8'));
  const grant = { schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    controllerId: 'durable-flywheel-controller', boundedActionCount: 1, actionKind: 'github-inspection', adapter: 'openclaw-github-readonly', operation: 'check-pr', currentPhase: 'CHECK_PULL_REQUEST', laneId: state.missionId, mergeAuthority: false, leaseSeizureAllowed: false,
    grantId: 'grant-' + item.actionId, missionId: state.missionId, missionRevision: state.revision,
    actionId: item.actionId, repository: state.repository, issueNumber: 1802, prNumber: 2096,
    branch: state.git.branch, headSha: state.pullRequest.headSha, sourceRevision: 'b'.repeat(40) };
  item.actionGrant = grant;
  item.executionBinding = { ...grant, schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1',
    executionId: item.actionId, leaseKey: state.missionId + '-r6-lease' };
  await writeFile(published.path, JSON.stringify(item));
  const receipt = createExecutionReceipt({ repository: grant.repository, issueNumber: grant.issueNumber,
    prNumber: grant.prNumber, branch: grant.branch, sourceHead: grant.headSha,
    workerId: 'openclaw-standalone', workerType: 'openclaw', executionId: item.actionId,
    leaseKey: item.executionBinding.leaseKey, state: 'queued', phase: 'pr-head-dispatch-queued', sequence: 1,
    timestampUtc: new Date(Date.now() - 1000).toISOString(), proofRefs: ['inspection-fixture-source-proof'], expectedNextAction: 'Accept exact inspection before execution.' });
  const appended = await appendExecutionReceipt(options.sharedWorkspaceRoot, receipt, { repoRoot: options.repoRoot });
  assert.equal(appended.ok, true, JSON.stringify(appended));
  const history = () => readExecutionReceiptHistory(options.sharedWorkspaceRoot,
    { executionId: item.actionId }, { repoRoot: options.repoRoot });
  return { options, history, state, item };
}

test('GitHub inspection records started before adapter and terminal receipt after consumed event', async () => {
  const f = await queuedInspectionReceiptFixture();
  let called = false;
  const result = await processNextGitHubInspectionItem({ ...f.options, inspectGitHub: async () => {
    called = true;
    assert.deepEqual((await f.history()).receipts.map(r => r.state), ['queued', 'accepted', 'started', 'progress']);
    return { execution: { success: true, commandOutputHash: 'f'.repeat(64), completedAt: new Date().toISOString() },
      inspection: { prNumber: 2096, headSha: 'a'.repeat(40), prState: 'open', mergeable: true,
        checks: [{ id: 'verify', name: 'verify', status: 'failure', required: true }] } };
  } });
  assert.equal(called, true, result.error?.stack || JSON.stringify(result.result));
  assert.equal(result.result.finalVerdict, 'MISSION_WORKER_ITEM_COMPLETE', result.error?.stack);
  assert.equal(result.applied.state.currentPhase, 'REPAIR_REQUIRED');
  const h = await f.history();
  assert.deepEqual(h.receipts.map(r => r.state), ['queued', 'accepted', 'started', 'progress', 'completed']);
  assert.ok(h.latestReceipt.proofRefs.includes(result.event.eventId));
  assert.equal(result.executionReceipt.receiptId, h.latestReceipt.receiptId);
});

test('GitHub inspector exception records failed truth and retains mission revision', async () => {
  const f = await queuedInspectionReceiptFixture();
  const result = await processNextGitHubInspectionItem({ ...f.options, inspectGitHub: async () => { throw Error('inspection fixture unavailable'); } });
  assert.equal(result.result.finalVerdict, 'MISSION_WORKER_ITEM_FAILED');
  assert.equal((await f.history()).latestReceipt.state, 'failed', result.error?.stack);
  assert.equal((await readMissionRecord(f.state.missionId, f.options)).state.revision, 6);
});


test('production tick binds receipt workspace with env absent and refuses terminal-chain inspection', async t => {
  for (const terminal of [false, true]) await t.test(terminal ? 'already terminal is refused before inspector' : 'canonical workspace reaches the actual consumer', async () => {
    const f = await queuedInspectionReceiptFixture();
    if (terminal) await appendMissionWorkerExecutionReceiptTransition((await f.history()).latestReceipt, 'failed', f.options, {
      phase: 'fixture-prior-terminal', blocker: 'fixture terminal', expectedNextAction: 'Do not execute a terminal action again.',
    });
    const env = { USERPROFILE: join(f.options.root, '..'), STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT: f.options.repoRoot,
      STEPHANOS_MISSION_WORKER_HEAD_SHA: 'b'.repeat(40) };
    const { sharedWorkspaceRoot: _notSupplied, ...options } = f.options;
    let inspectorCalls = 0;
    const result = await runMissionWorkerTick({ ...options, env, actionGrant: f.item.actionGrant,
      sourceRevision: 'b'.repeat(40), runCommand: (_exe, args) => {
        assert.deepEqual(args.slice(0, 2), ['pr', 'view']); inspectorCalls += 1;
        return { status: 0, stdout: JSON.stringify({ number: 2096, headRefOid: 'a'.repeat(40), mergeable: 'MERGEABLE',
          state: 'OPEN', statusCheckRollup: [{ name: 'verify', status: 'IN_PROGRESS' }] }), stderr: '' };
      } });
    const h = await f.history();
    assert.equal(inspectorCalls, terminal ? 0 : 1, result.processed?.error?.stack);
    assert.equal(h.latestReceipt.state, terminal ? 'failed' : 'completed');
    assert.deepEqual(h.receipts.map(r => r.state), terminal ? ['queued', 'failed'] : ['queued', 'accepted', 'started', 'progress', 'completed']);
  });
});

test('native inspection missing its receipt workspace refuses before execution', async () => {
  const f = await queuedInspectionReceiptFixture();
  const { sharedWorkspaceRoot: _notSupplied, ...options } = f.options;
  let calls = 0;
  const result = await processNextGitHubInspectionItem({ ...options, env: {}, inspectGitHub: async () => {
    calls += 1; throw Error('inspector must not be invoked without native receipt custody');
  } });
  assert.equal(calls, 0);
  assert.match(result.error?.message || '', /EXECUTION_RECEIPT_WORKSPACE_REQUIRED/);
  assert.equal((await f.history()).latestReceipt.state, 'queued');
});
