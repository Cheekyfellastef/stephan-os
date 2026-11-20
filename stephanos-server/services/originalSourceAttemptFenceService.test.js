import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createMissionRecord, readMissionRecord, appendMissionEvent, runWithMissionStatePrecondition } from './missionOrchestratorStore.js';
import {
  proveOriginalSourceQuarantine, quarantineOriginalSourceAttempt,
  originalSourceFenceBindsLease, assertOriginalSourceAttemptNotFenced,
} from './originalSourceAttemptFenceService.js';

const digest = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture() {
  const missionId = 'critical-2962-elastic-goal';
  const action = `${missionId}-r1-27828c3fdb2c`;
  const mission = { missionId, revision: 7, repository: 'Cheekyfellastef/stephan-os',
    currentPhase: 'REPAIR_REQUIRED', git: { branch: 'openclaw/elastic-goal-2962', worktreePath: '/worktree' },
    pullRequest: { number: 2987, headSha: 'a'.repeat(40) },
    dispatch: { status: 'complete', adapter: 'foundry-forge', resultId: 'opaque-result' } };
  const lease = { leaseId: `${missionId}-r7-lease`, laneId: missionId,
    repository: mission.repository, issueNumber: 2962, prNumber: 2987,
    branch: mission.git.branch, headSha: mission.pullRequest.headSha, ownerId: 'mission-worker' };
  const receipt = { state: 'completed', executionId: action,
    receiptId: `${action}-5`, leaseKey: `${missionId}-r1-lease`, repository: mission.repository,
    branch: lease.branch, sourceHead: 'b'.repeat(40), issueNumber: 2962, prNumber: 0 };
  const pair = { item: { schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter: 'foundry-forge', missionId, actionId: action,
    actionGrant: { schemaVersion: 'stephanos.mission-worker-action-grant.v1', adapter: 'foundry-forge',
      missionId, actionId: action, missionRevision: 1, repository: mission.repository,
      branch: lease.branch, issueNumber: 2962, sourceRevision: receipt.sourceHead }, executionBinding: {
    schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1', missionRevision: 1,
    missionId, executionId: action, leaseKey: receipt.leaseKey, repository: receipt.repository,
    branch: receipt.branch, headSha: '', sourceRevision: receipt.sourceHead, issueNumber: 2962, prNumber: null } },
    result: { schemaVersion: 'stephanos.provider-neutral-source-builder.v1', adapter: 'foundry-forge',
      providerAdapter: 'foundry-forge', providerInvoked: true, providerCompleted: true,
      failureStage: '', missionId, actionId: action, processed: true, success: true, testsPassed: true,
      changedFiles: ['shared/agents/goal-2962.mjs'], sourceArtifactRef: 'receipts/source-artifacts/goal-2962',
      offlinePublicationOutboxId: 'goal-2962-outbox', preservationVerdict: 'PROVIDER_NEUTRAL_SOURCE_ESCROWED_FOR_OFFLINE_PUBLICATION',
      finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED' }, pairDigest: 'f'.repeat(64) };
  const writerExclusionEvidence = { schemaVersion: 'stephanos.original-source-writer-exclusion.v1',
    missionId, sourceExecutionId: action, leaseId: lease.leaseId, leaseDigest: digest(lease),
    repository: lease.repository, branch: lease.branch, headSha: lease.headSha,
    worktreePath: '/worktree',
    verdict: 'NO_SOURCE_WRITING_DESCENDANTS', authorityReceiptId: 'containment-receipt-2962',
    authorityReceiptSha256: 'c'.repeat(64) };
  const input = { missionId, commandId: 'fence-original-2962-test', reason: 'Retire source attempt only.',
    operatorSourceRevision: 'd'.repeat(40), operatorRequestId: 'fence-original-2962-test-request',
    expectedMissionRevision: 7, originalLeaseId: lease.leaseId, originalLeaseDigest: digest(lease),
    writerExclusionEvidence };
  const options = { env: { STEPHANOS_MISSION_WORKER_QUEUE_DIR: '/queue' },
    paths: { workspaceRoot: '/workspace', repoRoot: '/repo' },
    readSourceMutationLease: async ({ nowUtc }) => {
      assert.equal(Number.isFinite(Date.parse(nowUtc)), true);
      return { ok: true, record: lease, validation: { valid: true, active: false, stale: true } };
    },
    readOriginalSourceExecutionId: async () => action,
    readExecutionReceiptHistory: async (_root, filter) => filter.leaseKey
      ? { ok: true, receipts: [], latestReceipt: null }
      : { ok: true, receipts: [receipt], latestReceipt: receipt },
    readTerminalSourcePair: async () => pair,
    originalMissionHasQueuedWork: async () => false,
    authenticateOriginalWriterExclusionEvidence: async (evidence, expected) => {
      assert.equal(evidence.missionId, expected.missionId);
      return { authenticated: true, evidence };
    },
    withOriginalSourceLeaseFenceGuard: async (operation) => operation(),
  };
  return { mission, lease, receipt, pair, input, options };
}

test('authenticated older source completion can fence r7 without fabricating an r7 terminal receipt', async () => {
  const f = fixture(); const proof = await proveOriginalSourceQuarantine(f.mission, f.input, f.options);
  assert.equal(originalSourceFenceBindsLease(proof, f.lease), true);
  assert.equal(proof.sourceReceiptId, f.receipt.receiptId);
  assert.equal(proof.goalComplete, false);
  assert.equal(proof.leaseSeizureAllowed, false);
  assert.equal(proof.detachedSourceWritersExcluded, true);
});

for (const [label, change] of [
  ['mission revision race', f => { f.mission.revision++; }],
  ['running original writer', f => { f.mission.dispatch.status = 'running'; }],
  ['different source branch', f => { f.receipt.branch = 'other'; }],
  ['wrong original source lease', f => { f.receipt.leaseKey = f.lease.leaseId; }],
  ['source receipt is active', f => { f.receipt.state = 'progress'; }],
  ['source result is not terminal', f => { f.pair.result.success = false; }],
  ['source result schema mismatch', f => { f.pair.result.schemaVersion = 'stephanos.mission-worker-consumption-result.v1'; }],
  ['result adapter mismatch', f => { f.pair.result.adapter = 'sovereign-commander'; }],
  ['result provider adapter mismatch', f => { f.pair.result.providerAdapter = 'chatgpt-github'; }],
  ['source provider not invoked', f => { f.pair.result.providerInvoked = false; }],
  ['source provider not completed', f => { f.pair.result.providerCompleted = false; }],
  ['source failure stage present', f => { f.pair.result.failureStage = 'PROVIDER'; }],
  ['source artifact not preserved', f => { f.pair.result.sourceArtifactRef = ''; }],
  ['source outbox missing', f => { f.pair.result.offlinePublicationOutboxId = ''; }],
  ['source preservation verdict missing', f => { f.pair.result.preservationVerdict = ''; }],
  ['source changes empty', f => { f.pair.result.changedFiles = []; }],
  ['source terminal verdict forged', f => { f.pair.result.finalVerdict = 'MISSION_WORKER_ITEM_COMPLETE'; }],
  ['source item schema mismatch', f => { f.pair.item.schemaVersion = 'legacy'; }],
  ['source grant adapter mismatch', f => { f.pair.item.actionGrant.adapter = 'chatgpt-github'; }],
  ['source tests unproven', f => { f.pair.result.testsPassed = false; }],
  ['queue source head mismatch', f => { f.pair.item.executionBinding.headSha = 'c'.repeat(40); }],
  ['pre-PR source revision mismatch', f => { f.pair.item.executionBinding.sourceRevision = 'c'.repeat(40); }],
  ['pre-PR source rewritten to held r7 PR', f => { f.pair.item.executionBinding.prNumber = f.lease.prNumber; }],
  ['current lease digest mismatch', f => { f.input.originalLeaseDigest = 'e'.repeat(64); }],
  ['queue activity', f => { f.options.originalMissionHasQueuedWork = async () => true; }],
  ['queue nonactivity unknown', f => { f.options.originalMissionHasQueuedWork = async () => null; }],
  ['source binding ambiguity', f => { f.options.readOriginalSourceExecutionId = async () => ''; }],
  ['source signature unavailable', f => { f.options.readExecutionReceiptHistory = async () => ({ ok: false }); }],
]) test(`quarantine refuses ${label}`, async () => {
  const f = fixture(); change(f);
  await assert.rejects(proveOriginalSourceQuarantine(f.mission, f.input, f.options));
});

test('completed direct child and idle queues stay SAFE_HOLD without physical descendant exclusion', async () => {
  const f = fixture();
  delete f.options.authenticateOriginalWriterExclusionEvidence;
  await assert.rejects(proveOriginalSourceQuarantine(f.mission, f.input, f.options),
    /WRITER_EXCLUSION_UNAVAILABLE/);
});

test('an actual detached Node descendant cannot be hidden by direct-child completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'detached-source-writer-'));
  const marker = join(root, 'late-source-write');
  const child = spawn(process.execPath, ['-e',
    `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'mutated'), 30000)`],
  { detached: true, stdio: 'ignore' });
  child.unref();
  try {
    const f = fixture();
    delete f.options.authenticateOriginalWriterExclusionEvidence;
    await assert.rejects(proveOriginalSourceQuarantine(f.mission, f.input, f.options),
      /WRITER_EXCLUSION_UNAVAILABLE/);
  } finally {
    try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch {}
  }
});

test('detached descendant evidence must be authenticated and exactly mission, execution, and lease bound', async () => {
  for (const mutate of [
    evidence => { evidence.sourceExecutionId = 'detached-other-execution'; },
    evidence => { evidence.leaseDigest = '0'.repeat(64); },
    evidence => { evidence.missionId = 'critical-9999-elastic-goal'; },
    evidence => { evidence.worktreePath = '/other'; },
  ]) {
    const f = fixture(); mutate(f.input.writerExclusionEvidence);
    await assert.rejects(proveOriginalSourceQuarantine(f.mission, f.input, f.options),
      /WRITER_EXCLUSION_UNPROVEN|AssertionError/);
  }
  const f = fixture();
  f.options.authenticateOriginalWriterExclusionEvidence = async (_, expected) => ({
    authenticated: false, evidence: { ...f.input.writerExclusionEvidence, missionId: expected.missionId },
  });
  await assert.rejects(proveOriginalSourceQuarantine(f.mission, f.input, f.options),
    /WRITER_EXCLUSION_UNPROVEN/);
});

test('writer exclusion is re-evaluated after an asynchronous race and before lease CAS', async () => {
  const f = fixture(); let leaseReads = 0;
  f.options.readSourceMutationLease = async () => ({ ok: true,
    record: ++leaseReads === 1 ? f.lease : { ...f.lease, renewedAtUtc: 'race' },
    validation: { valid: true, active: false, stale: true } });
  await assert.rejects(proveOriginalSourceQuarantine(f.mission, f.input, f.options), /LEASE_CHANGED/);
});

test('mailbox-valid uppercase request ID is normalized only after admission', async () => {
  const f = fixture(); const root = await mkdtemp(join(tmpdir(), 'original-source-uppercase-'));
  const created = await createMissionRecord({ missionId: f.mission.missionId,
    repository: f.mission.repository, repositoryRoot: '/repo', branch: f.mission.git.branch,
    worktreePath: '/worktree', operatorIntent: 'Repair original source.', intendedOutcome: 'Preserve same goal.',
    allowedFiles: [], requiredTests: [], requiredEvidence: [] }, { root, env: {} });
  await writeFile(created.statePath, JSON.stringify({ ...created.state, ...f.mission }));
  f.input.operatorRequestId = 'Fence-Original-2962-Request';
  const result = await quarantineOriginalSourceAttempt(f.input, { ...f.options, root });
  assert.equal(result.state.storeMetadata.originalSourceAttemptFence.operatorRequestId,
    'fence-original-2962-request');
});

test('lease renewal between proof reads prevents fencing', async () => {
  const f = fixture(); let reads = 0;
  f.options.readSourceMutationLease = async () => ({ ok: true,
    record: ++reads === 1 ? f.lease : { ...f.lease, renewedAtUtc: 'changed' },
    validation: { valid: true, active: false, stale: true } });
  await assert.rejects(proveOriginalSourceQuarantine(f.mission, f.input, f.options), /LEASE_CHANGED/);
});

test('an active exact r7 execution cannot be concealed by older source completion', async () => {
  const f = fixture(); const reader = f.options.readExecutionReceiptHistory;
  f.options.readExecutionReceiptHistory = async (root, filter) => filter.leaseKey
    ? { ok: true, receipts: [{ ...f.receipt, executionId: 'current-r7-execution',
      leaseKey: f.lease.leaseId, sourceHead: f.lease.headSha, prNumber: f.lease.prNumber, state: 'progress' }] }
    : reader(root, filter);
  await assert.rejects(proveOriginalSourceQuarantine(f.mission, f.input, f.options), /HELD_EXECUTION_ACTIVE/);
});

test('durable cancellation and fence commit share the existing mission and lease locks and survive restart', async () => {
  const f = fixture(); const root = await mkdtemp(join(tmpdir(), 'original-source-fence-'));
  const created = await createMissionRecord({ missionId: f.mission.missionId,
    repository: f.mission.repository, repositoryRoot: '/repo', branch: f.mission.git.branch,
    worktreePath: '/worktree', operatorIntent: 'Repair original source.', intendedOutcome: 'Preserve same goal.',
    allowedFiles: ['shared/test.mjs'], requiredTests: [], requiredEvidence: [] }, { root, env: {} });
  const realistic = { ...created.state, ...f.mission };
  await writeFile(created.statePath, JSON.stringify(realistic));
  let insideLeaseLock = false;
  f.options.withOriginalSourceLeaseFenceGuard = async (operation) => {
    insideLeaseLock = true; try { return await operation(); } finally { insideLeaseLock = false; }
  };
  const originalRead = f.options.readSourceMutationLease;
  f.options.readSourceMutationLease = async (input) => { assert.equal(insideLeaseLock, true); return originalRead(input); };
  const result = await quarantineOriginalSourceAttempt(f.input, { ...f.options, root });
  assert.equal(result.state.currentPhase, 'CANCELLED');
  assert.equal(result.state.revision, 8);
  assert.equal(result.state.storeMetadata.originalSourceAttemptFence.originalLeaseId, f.lease.leaseId);
  const restarted = await readMissionRecord(f.mission.missionId, { root });
  assert.equal(originalSourceFenceBindsLease(restarted.state.storeMetadata.originalSourceAttemptFence, f.lease), true);
  const log = await readFile(restarted.eventPath, 'utf8');
  assert.match(log, /originalSourceAttemptFence/);
  await assert.rejects(assertOriginalSourceAttemptNotFenced(f.mission.missionId,
    { missionStoreOptions: { root } }), /FENCED/);
  const duplicate = await quarantineOriginalSourceAttempt(f.input, { ...f.options, root });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state.revision, 8);
});

test('quarantine audit repairs persisted state after a failed append, exactly once on duplicate retry', async () => {
  const f = fixture(); const root = await mkdtemp(join(tmpdir(), 'original-source-audit-replay-'));
  const created = await createMissionRecord({ missionId: f.mission.missionId,
    repository: f.mission.repository, repositoryRoot: '/repo', branch: f.mission.git.branch,
    worktreePath: '/worktree', operatorIntent: 'Repair source.', intendedOutcome: 'Retain one fence.',
    allowedFiles: [], requiredTests: [], requiredEvidence: [] }, { root, env: {} });
  await writeFile(created.statePath, JSON.stringify({ ...created.state, ...f.mission }));
  const failOptions = { ...f.options, root,
    appendMissionAuditFile: async () => { throw new Error('SIMULATED_AUDIT_APPEND_FAILURE'); } };
  await assert.rejects(quarantineOriginalSourceAttempt(f.input, failOptions),
    /SIMULATED_AUDIT_APPEND_FAILURE/);
  const stranded = await readMissionRecord(f.mission.missionId, { root });
  assert.equal(stranded.state.currentPhase, 'CANCELLED');
  assert.equal(stranded.state.revision, 8);
  assert.equal(stranded.state.storeMetadata.pendingQuarantineAuditEvent.eventId,
    'cancel-fence-original-2962-test');
  const repaired = await quarantineOriginalSourceAttempt(f.input, { ...f.options, root });
  assert.equal(repaired.duplicate, true);
  assert.equal(repaired.state.revision, 8);
  assert.equal(repaired.state.storeMetadata.pendingQuarantineAuditEvent, undefined);
  const log = (await readFile(created.eventPath, 'utf8')).split('\n').filter(Boolean);
  assert.equal(log.filter(line => JSON.parse(line).eventId === 'cancel-fence-original-2962-test').length, 1);
  assert.equal(originalSourceFenceBindsLease(repaired.state.storeMetadata.originalSourceAttemptFence, f.lease), true);
  const duplicate = await quarantineOriginalSourceAttempt(f.input, { ...f.options, root });
  assert.equal(duplicate.duplicate, true);
  const again = (await readFile(created.eventPath, 'utf8')).split('\n').filter(Boolean);
  assert.equal(again.filter(line => JSON.parse(line).eventId === 'cancel-fence-original-2962-test').length, 1);
});

test('quarantine audit safely replays torn matching tail but holds a conflicting tail', async () => {
  for (const torn of [true, false]) {
    const f = fixture(); const root = await mkdtemp(join(tmpdir(), 'original-source-audit-tail-'));
    const created = await createMissionRecord({ missionId: f.mission.missionId,
      repository: f.mission.repository, repositoryRoot: '/repo', branch: f.mission.git.branch,
      worktreePath: '/worktree', operatorIntent: 'Repair source.', intendedOutcome: 'Retain fence.',
      allowedFiles: [], requiredTests: [], requiredEvidence: [] }, { root, env: {} });
    await writeFile(created.statePath, JSON.stringify({ ...created.state, ...f.mission }));
    const options = { ...f.options, root, appendMissionAuditFile: async () => { throw Error('AUDIT_WRITE_INTERRUPTED'); } };
    await assert.rejects(quarantineOriginalSourceAttempt(f.input, options), /AUDIT_WRITE_INTERRUPTED/);
    const pending = (await readMissionRecord(f.mission.missionId, { root })).state
      .storeMetadata.pendingQuarantineAuditEvent;
    const prefix = torn ? JSON.stringify(pending.event).slice(0, 53) : '{"eventId":"not-our-event"';
    await writeFile(created.eventPath, (await readFile(created.eventPath, 'utf8')) + prefix);
    if (!torn) {
      await assert.rejects(quarantineOriginalSourceAttempt(f.input, { ...f.options, root }),
        /ORIGINAL_QUARANTINE_AUDIT_LOG_CORRUPT/);
      assert.equal((await readMissionRecord(f.mission.missionId, { root })).state
        .storeMetadata.pendingQuarantineAuditEvent.eventId, pending.eventId);
    } else {
      const fixed = await quarantineOriginalSourceAttempt(f.input, { ...f.options, root });
      assert.equal(fixed.duplicate, true);
      const events = (await readFile(created.eventPath, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
      assert.equal(events.filter(x => x.eventId === pending.eventId).length, 1);
    }
  }
});

test('quarantine audit journal self-repairs within the canonical lease-release precondition lock', async () => {
  const f = fixture(); const root = await mkdtemp(join(tmpdir(), 'original-fence-release-journal-'));
  const created = await createMissionRecord({ missionId: f.mission.missionId,
    repository: f.mission.repository, repositoryRoot: '/repo', branch: f.mission.git.branch,
    worktreePath: '/worktree', operatorIntent: 'Keep original source safe.',
    intendedOutcome: 'One release authority.', allowedFiles: [], requiredTests: [],
    requiredEvidence: [] }, { root, env: {} });
  await writeFile(created.statePath, JSON.stringify({ ...created.state, ...f.mission }));
  await assert.rejects(quarantineOriginalSourceAttempt(f.input, { ...f.options, root,
    appendMissionAuditFile: async () => { throw Error('SIMULATED_LOG_APPEND_LOST'); } }),
  /SIMULATED_LOG_APPEND_LOST/);
  const result = await runWithMissionStatePrecondition(f.mission.missionId, {
    expectedRevision: 8, expectedCurrentPhase: 'CANCELLED',
  }, async (mission) => {
    assert.equal(mission.storeMetadata.pendingQuarantineAuditEvent, undefined);
    assert.equal(originalSourceFenceBindsLease(mission.storeMetadata.originalSourceAttemptFence, f.lease), true);
    const lines = (await readFile(created.eventPath, 'utf8')).split('\n').filter(Boolean);
    assert.equal(lines.filter(line => JSON.parse(line).eventId === 'cancel-fence-original-2962-test').length, 1);
    return 'RECOVERED_BEFORE_PRECONDITION';
  }, { root });
  assert.equal(result.preconditionFailed, false);
  assert.equal(result.result, 'RECOVERED_BEFORE_PRECONDITION');
});

test('quarantine journal fails closed on mutation of the persisted hash-bound event', async () => {
  const f = fixture(); const root = await mkdtemp(join(tmpdir(), 'original-fence-journal-tamper-'));
  const created = await createMissionRecord({ missionId: f.mission.missionId,
    repository: f.mission.repository, repositoryRoot: '/repo', branch: f.mission.git.branch,
    worktreePath: '/worktree', operatorIntent: 'Keep original source safe.',
    intendedOutcome: 'No forged audit.', allowedFiles: [], requiredTests: [],
    requiredEvidence: [] }, { root, env: {} });
  await writeFile(created.statePath, JSON.stringify({ ...created.state, ...f.mission }));
  await assert.rejects(quarantineOriginalSourceAttempt(f.input, { ...f.options, root,
    appendMissionAuditFile: async () => { throw Error('SIMULATED_CRASH'); } }), /SIMULATED_CRASH/);
  const stranded = (await readMissionRecord(f.mission.missionId, { root })).state;
  stranded.storeMetadata.pendingQuarantineAuditEvent.event.originalSourceAttemptFence.prNumber = 99999;
  await writeFile(created.statePath, JSON.stringify(stranded));
  await assert.rejects(runWithMissionStatePrecondition(f.mission.missionId, {
    expectedRevision: 8, expectedCurrentPhase: 'CANCELLED',
  }, async () => assert.fail('no source authority after tampered journal'), { root }),
  /ORIGINAL_QUARANTINE_AUDIT_JOURNAL_INVALID/);
  assert.equal((await readFile(created.eventPath, 'utf8')).includes('cancel-fence-original-2962-test'), false);
});

test('plain cancellation cannot fabricate a quarantine fence', async () => {
  const f = fixture(); const root = await mkdtemp(join(tmpdir(), 'unproved-source-fence-'));
  await createMissionRecord({ missionId: f.mission.missionId, operatorIntent: 'Test cancellation.',
    intendedOutcome: 'No invented authority.', repository: f.mission.repository, repositoryRoot: '/repo',
    branch: f.mission.git.branch, worktreePath: '/worktree', allowedFiles: [], requiredEvidence: [], requiredTests: [] }, { root, env: {} });
  await assert.rejects(appendMissionEvent(f.mission.missionId, {
    eventId: 'cancel-forged-proof', eventType: 'MISSION_CANCELLED', originalSourceQuarantineRequested: true,
  }, { root, env: {} }), /GUARD_REQUIRED/);
});

test('exact historical r7 can prepare exception fence without forging an original terminal receipt', async () => {
  const f = fixture();
  f.input.legacyOrphanQuarantineRequested = true;
  f.options.authenticateLegacyOrphanQuarantine = async (expected) => {
    assert.equal(expected.leaseId, f.lease.leaseId);
    assert.equal(expected.originalLeaseDigest, digest(f.lease));
    assert.equal(expected.revision, 7);
    assert.equal(expected.sourceExecutionId, f.receipt.executionId);
    assert.equal(expected.requestId, f.input.operatorRequestId);
    return {
      authenticated: true, historicalExecutionOutcome: 'UNKNOWN',
      eligibilityOnly: true, leaseReleaseAuthority: false,
      evidenceDigest: '2'.repeat(64), witnessDigest: '3'.repeat(64),
    };
  };
  const fence = await proveOriginalSourceQuarantine(f.mission, f.input, f.options);
  assert.equal(fence.schemaVersion, 'stephanos.original-source-attempt-legacy-orphan-fence.v2');
  assert.equal(fence.historicalExecutionOutcome, 'UNKNOWN');
  assert.equal(fence.historicalTerminalReceiptPresent, false);
  assert.equal(fence.historicalTerminalReceiptReconstructed, false);
  assert.equal(fence.sourceWriterTerminalProven, false);
  assert.equal(fence.originalQueuesIdle, true);
  assert.equal(fence.goalComplete, false);
  assert.equal(fence.leaseReleaseAuthority, false);
  assert.equal(fence.legacyEvidenceDigest, '2'.repeat(64));
  assert.equal(originalSourceFenceBindsLease(fence, f.lease), true);
  assert.equal(originalSourceFenceBindsLease(fence, { ...f.lease, headSha: '5'.repeat(40) }), false);
});

test('legacy orphan exception is fail-closed on missing signer, unresolved queue and real held execution', async () => {
  const make = () => {
    const f = fixture();
    f.input.legacyOrphanQuarantineRequested = true;
    f.options.authenticateLegacyOrphanQuarantine = async () => ({
      authenticated: true, historicalExecutionOutcome: 'UNKNOWN',
      eligibilityOnly: true, leaseReleaseAuthority: false,
      evidenceDigest: '2'.repeat(64), witnessDigest: '3'.repeat(64),
    });
    return f;
  };
  const noSigner = make();
  delete noSigner.options.authenticateLegacyOrphanQuarantine;
  await assert.rejects(proveOriginalSourceQuarantine(noSigner.mission, noSigner.input, noSigner.options),
    /INDEPENDENT_OS_AUTHORITY_NOT_INSTALLED/);
  const queueActive = make();
  queueActive.options.originalMissionHasQueuedWork = async () => true;
  await assert.rejects(proveOriginalSourceQuarantine(queueActive.mission, queueActive.input, queueActive.options),
    /QUEUE_STILL_ACTIVE_OR_UNKNOWN/);
  const heldActive = make();
  heldActive.options.readExecutionReceiptHistory = async () => ({
    ok: true, receipts: [{ state: 'progress', executionId: 'original-running' }],
  });
  await assert.rejects(proveOriginalSourceQuarantine(heldActive.mission, heldActive.input, heldActive.options),
    /HISTORICALLY_MISSING_RECEIPT_NOT_PROVEN/);
  const noHistory = make();
  noHistory.options.readExecutionReceiptHistory = async () => ({ ok: false });
  await assert.rejects(proveOriginalSourceQuarantine(noHistory.mission, noHistory.input, noHistory.options),
    /HISTORICALLY_MISSING_RECEIPT_NOT_PROVEN/);
  const forgedCompletion = make();
  forgedCompletion.options.authenticateLegacyOrphanQuarantine = async () => ({
    authenticated: true, historicalExecutionOutcome: 'COMPLETED',
    eligibilityOnly: true, leaseReleaseAuthority: false,
    evidenceDigest: '2'.repeat(64), witnessDigest: '3'.repeat(64),
  });
  await assert.rejects(proveOriginalSourceQuarantine(forgedCompletion.mission, forgedCompletion.input, forgedCompletion.options),
    /PROSPECTIVE_CONTAINMENT_NOT_AUTHENTICATED/);
});

test('legacy orphan flag is scoped to exact #2962 r7, never another goal/revision', async () => {
  for (const change of [
    { expectedMissionRevision: 8 }, { missionId: 'critical-2955-elastic-goal' },
    { originalLeaseId: 'critical-2962-elastic-goal-r8-lease' },
  ]) {
    const f = fixture();
    f.input.legacyOrphanQuarantineRequested = true;
    Object.assign(f.input, change);
    await assert.rejects(quarantineOriginalSourceAttempt(f.input, f.options),
      /LEGACY_ORPHAN_COMMAND_SCOPE_FORBIDDEN/);
  }
});
