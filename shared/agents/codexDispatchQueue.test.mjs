import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CODEX_DISPATCH_QUEUE_SCHEMA_VERSION,
  CODEX_QUEUE_STATUS,
  buildCodexDispatchQueueContract,
  buildManualCodexHandoffPacket,
  createCodexQueueRecord,
  projectCodexQueueDashboard,
  publishCodexQueueStatusToSharedWorkspace,
  readCodexQueueRecordFromSharedWorkspace,
  transitionCodexQueueRecord,
  validateCodexQueueRecord,
  writeCodexQueueRecordToSharedWorkspace,
} from './codexDispatchQueue.mjs';
import { runVerifier } from './verificationHarness.mjs';

const REPO_ROOT = new URL('../..', import.meta.url).pathname;
const base = {
  issueNumber: 1292,
  branch: 'codex/issues-1292-dispatch-queue',
  prompt: 'Build Codex Dispatch Queue V1 with manual dispatch and Shared Agent Workspace proof.',
  requestedProofCommands: ['node --test shared/agents/codexDispatchQueue.test.mjs', 'git diff --check'],
  createdAt: '2026-07-07T00:00:00Z',
  approvalRequirements: { requiresOperatorApprovalBeforeDispatch: true },
};

async function tempWorkspace() {
  return mkdtemp(join(tmpdir(), 'stephanos-codex-queue-'));
}

test('contract exposes required #1292 states, transitions, proof refs, and safety guardrails', () => {
  const contract = buildCodexDispatchQueueContract();
  assert.equal(contract.schemaVersion, CODEX_DISPATCH_QUEUE_SCHEMA_VERSION);
  assert.deepEqual(contract.statuses, Object.values(CODEX_QUEUE_STATUS));
  assert.deepEqual(contract.transitions.QUEUED, ['WAITING_OPERATOR_APPROVAL', 'BLOCKED']);
  assert.equal(contract.transitions.READY_FOR_MANUAL_DISPATCH.includes('DISPATCHED_MANUAL'), true);
  assert.equal(contract.guardrails.automaticCodexLaunchAllowed, false);
  assert.equal(contract.guardrails.fakeDispatchAllowed, false);
  assert.equal(contract.guardrails.queueBypassesApproval, false);
  assert.equal(contract.proofRequirementRefs.includes('#1287 Verification Harness'), true);
  assert.equal(contract.sharedWorkspacePaths.queueRecords, 'codex-dispatch/queue/*.json');
  assert.equal(contract.missingIntegrationBlocker, 'BLOCKED_BY_MISSING_CODEX_AUTOMATED_DISPATCH_INTEGRATION_1293');
});

test('queue creation produces bounded record requiring operator and exact-head approval', () => {
  const record = createCodexQueueRecord(base);
  assert.match(record.jobId, /^codex-job-[a-f0-9]{20}$/);
  assert.equal(record.status, 'QUEUED');
  assert.equal(record.approvalRequirements.requiresOperatorApprovalBeforeDispatch, true);
  assert.equal(record.approvalRequirements.requiresExactHeadApproval, true);
  assert.equal(record.integrationState.automatedCodexDispatchProven, false);
  assert.equal(record.integrationState.blocker, 'BLOCKED_BY_MISSING_CODEX_AUTOMATED_DISPATCH_INTEGRATION_1293');
  assert.equal(record.sharedWorkspaceMessage.eventKind, 'codex-job-created');
  assert.equal(validateCodexQueueRecord(record).finalVerdict, 'CODEX_QUEUE_RECORD_PASS');
});

test('state transitions enforce approval before manual dispatch and keep deterministic history', () => {
  const queued = createCodexQueueRecord(base);
  const waiting = transitionCodexQueueRecord(queued, 'WAITING_OPERATOR_APPROVAL', { timestamp: '2026-07-07T00:01:00Z' });
  const blockedReady = transitionCodexQueueRecord(waiting.record, 'READY_FOR_MANUAL_DISPATCH', { timestamp: '2026-07-07T00:02:00Z' });
  assert.equal(blockedReady.valid, false);
  assert.equal(blockedReady.error, 'missing-operator-approval-receipt');

  const ready = transitionCodexQueueRecord(waiting.record, 'READY_FOR_MANUAL_DISPATCH', { timestamp: '2026-07-07T00:02:00Z', approvalReceipt: 'operator-approved-head-cda63ec' });
  const manual = transitionCodexQueueRecord(ready.record, 'DISPATCHED_MANUAL', { timestamp: '2026-07-07T00:03:00Z' });
  const claimed = transitionCodexQueueRecord(manual.record, 'CLAIMED', { timestamp: '2026-07-07T00:04:00Z' });
  const running = transitionCodexQueueRecord(claimed.record, 'RUNNING', { timestamp: '2026-07-07T00:05:00Z' });
  const waitingProof = transitionCodexQueueRecord(running.record, 'WAITING_PROOF', { timestamp: '2026-07-07T00:06:00Z' });
  const proof = transitionCodexQueueRecord(waitingProof.record, 'PROOF_RECEIVED', { timestamp: '2026-07-07T00:07:00Z' });
  const verified = transitionCodexQueueRecord(proof.record, 'VERIFIED', { timestamp: '2026-07-07T00:08:00Z' });
  const done = transitionCodexQueueRecord(verified.record, 'DONE', { timestamp: '2026-07-07T00:09:00Z', resultMetadata: { proofPassed: true } });

  assert.equal(manual.record.dispatchedAt, '2026-07-07T00:03:00Z');
  assert.equal(done.record.completedAt, '2026-07-07T00:09:00Z');
  assert.deepEqual(done.record.history.map((entry) => entry.toStatus), ['QUEUED', 'WAITING_OPERATOR_APPROVAL', 'READY_FOR_MANUAL_DISPATCH', 'DISPATCHED_MANUAL', 'CLAIMED', 'RUNNING', 'WAITING_PROOF', 'PROOF_RECEIVED', 'VERIFIED', 'DONE']);
});

test('manual handoff packet never claims automated dispatch and requires approved ready state', () => {
  const queued = createCodexQueueRecord(base);
  assert.equal(buildManualCodexHandoffPacket(queued).finalVerdict, 'CODEX_MANUAL_HANDOFF_BLOCKED');
  const waiting = transitionCodexQueueRecord(queued, 'WAITING_OPERATOR_APPROVAL', { timestamp: '2026-07-07T00:01:00Z' }).record;
  const ready = transitionCodexQueueRecord(waiting, 'READY_FOR_MANUAL_DISPATCH', { timestamp: '2026-07-07T00:02:00Z', approvalReceipt: 'operator-approved-exact-head-cda63ec' }).record;
  const packet = buildManualCodexHandoffPacket(ready);
  assert.equal(packet.dispatchMode, 'manual_operator_dispatch_only');
  assert.equal(packet.validForManualDispatch, true);
  assert.equal(packet.safety.automaticCodexLaunchAllowed, false);
  assert.equal(packet.automatedDispatchBlockedBy, 'BLOCKED_BY_MISSING_CODEX_AUTOMATED_DISPATCH_INTEGRATION_1293');
});

test('Shared Agent Workspace write/read and status publish stay in bounded temp workspace', async () => {
  const root = await tempWorkspace();
  try {
    const record = createCodexQueueRecord(base);
    const write = await writeCodexQueueRecordToSharedWorkspace(root, record, { repoRoot: REPO_ROOT });
    assert.equal(write.ok, true);
    assert.equal(write.path.includes('/codex-dispatch/queue/'), true);
    const read = await readCodexQueueRecordFromSharedWorkspace(root, record.jobId, { repoRoot: REPO_ROOT });
    assert.equal(read.ok, true);
    assert.equal(read.record.jobId, record.jobId);
    const publish = await publishCodexQueueStatusToSharedWorkspace(root, record, { repoRoot: REPO_ROOT, timestampUtc: '2026-07-07T00:10:00Z' });
    assert.equal(publish.ok, true);
    assert.equal(publish.statusRecord.status, 'QUEUED');
    assert.equal(publish.eventRecord.eventKind, 'codex-job-created');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dashboard projection and verification harness queue verifier are deterministic', () => {
  const queued = createCodexQueueRecord(base);
  const waiting = transitionCodexQueueRecord(queued, 'WAITING_OPERATOR_APPROVAL', { timestamp: '2026-07-07T00:01:00Z' }).record;
  const dashboard = projectCodexQueueDashboard([waiting, queued], { generatedAt: '2026-07-07T00:20:00Z' });
  assert.equal(dashboard.queueDepth, 2);
  assert.equal(dashboard.counts.QUEUED, 1);
  assert.equal(dashboard.counts.WAITING_OPERATOR_APPROVAL, 1);
  assert.deepEqual(dashboard.jobs.map((job) => job.jobId), [queued.jobId, waiting.jobId].sort());

  const verifier = runVerifier('CodexQueueRecordVerifier', { record: queued }, { timestampUtc: '2026-07-07T00:21:00Z' });
  assert.equal(verifier.status, 'PASS');
  assert.equal(verifier.finalVerdict, 'CODEX_QUEUE_RECORD_VERIFIER_PASS');
});

test('unsafe proof commands and unapproved dispatch records are blocked', () => {
  const record = createCodexQueueRecord({ ...base, requestedProofCommands: ['node --test shared/agents/codexDispatchQueue.test.mjs', 'git reset --hard HEAD'] });
  assert.deepEqual(record.requestedProofCommands, ['node --test shared/agents/codexDispatchQueue.test.mjs']);
  const tampered = { ...record, approvalRequirements: { ...record.approvalRequirements, requiresExactHeadApproval: false } };
  const validation = validateCodexQueueRecord(tampered);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes('exact-head-approval-not-required'), true);
});
