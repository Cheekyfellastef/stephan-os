import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION,
  BLOCKED_BY_MISSING_INTEGRATION,
  buildAutomatedCodexDispatcherContract,
  assessCodexIntegration,
  createDispatcherDashboard,
  dispatchQueuedCodexJob,
} from './automatedCodexDispatcher.mjs';
import {
  createCodexQueueRecord,
  transitionCodexQueueRecord,
  validateCodexQueueRecord,
  writeCodexQueueRecordToSharedWorkspace,
} from './codexDispatchQueue.mjs';

const job = createCodexQueueRecord({
  issueNumber: 1293,
  branch: 'codex/issues-1292-1293-dispatcher',
  prompt: 'Dispatch queued Codex jobs only when the integration can really launch Codex.',
  requestedProofCommands: ['node --test shared/agents/automatedCodexDispatcher.test.mjs'],
});

test('dispatcher contract consumes queue and exposes dashboard visibility', () => {
  const contract = buildAutomatedCodexDispatcherContract();
  assert.equal(contract.schemaVersion, AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION);
  assert.equal(contract.requiredMessages.includes('codex-job-dispatched'), true);
  assert.deepEqual(contract.dashboardFields, ['queueDepth', 'currentJob', 'lastProof', 'lastBlocker']);
  assert.equal(contract.guardrails.fakeDispatchAllowed, false);
  assert.equal(contract.guardrails.mergeAllowed, false);
});

test('integration assessment names missing automatic Codex launch capability', () => {
  const assessment = assessCodexIntegration({ capabilities: { returnDispatchReceipt: true, returnProofMetadata: true } });
  assert.equal(assessment.supported, false);
  assert.deepEqual(assessment.missingCapabilities, ['launchCodexJob']);
  assert.equal(assessment.finalVerdict, BLOCKED_BY_MISSING_INTEGRATION);
});

test('unsupported integration produces deterministic missing integration blocker and never fakes dispatch', () => {
  const result = dispatchQueuedCodexJob({
    queueRecord: job,
    integration: { capabilities: { returnDispatchReceipt: true } },
    now: '2026-06-30T00:00:00Z',
  });

  assert.equal(result.finalVerdict, BLOCKED_BY_MISSING_INTEGRATION);
  assert.equal(result.record.status, 'BLOCKED');
  assert.equal(validateCodexQueueRecord(result.record).valid, true);
  assert.equal(result.blockerMetadata.code, BLOCKED_BY_MISSING_INTEGRATION);
  assert.deepEqual(result.missingCapabilities, ['launchCodexJob', 'returnProofMetadata']);
  assert.equal(result.sharedWorkspaceMessage.eventKind, 'codex-job-blocked');
});

test('supported integration dispatches queued job and records receipt plus proof metadata', () => {
  const result = dispatchQueuedCodexJob({
    queueRecord: job,
    integration: {
      capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
      dispatch: (record) => ({ receiptId: `receipt-${record.jobId}`, accepted: true }),
    },
    proofMetadata: { commands: job.requestedProofCommands, status: 'accepted' },
    now: '2026-06-30T00:01:00Z',
  });

  assert.equal(result.finalVerdict, 'CODEX_JOB_DISPATCHED');
  assert.equal(result.record.status, 'DISPATCHED_MANUAL');
  assert.equal(validateCodexQueueRecord(result.record).valid, true);
  assert.equal(result.record.dispatchedAt, '2026-06-30T00:01:00Z');
  assert.equal(result.dispatchReceipt.accepted, true);
  assert.deepEqual(result.proofMetadata.commands, job.requestedProofCommands);
  assert.equal(result.sharedWorkspaceMessage.eventKind, 'codex-job-dispatched');
});

test('dispatcher blocked and dispatched records remain persistable queue records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-codex-dispatcher-'));
  try {
    const blocked = dispatchQueuedCodexJob({ queueRecord: job, integration: {}, now: '2026-06-30T00:03:00Z' }).record;
    const dispatched = dispatchQueuedCodexJob({
      queueRecord: job,
      integration: {
        capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
        dispatch: (record) => ({ receiptId: `receipt-${record.jobId}`, accepted: true }),
      },
      now: '2026-06-30T00:04:00Z',
    }).record;

    assert.equal(validateCodexQueueRecord(blocked).valid, true);
    assert.equal(validateCodexQueueRecord(dispatched).valid, true);
    assert.equal((await writeCodexQueueRecordToSharedWorkspace(root, blocked)).ok, true);
    assert.equal((await writeCodexQueueRecordToSharedWorkspace(root, dispatched)).ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('approval requirements are not treated as bypassable by queue presence', () => {
  const gated = createCodexQueueRecord({
    ...job,
    approvalRequirements: { requiresOperatorApprovalBeforeDispatch: true, requiresOperatorApprovalBeforeMerge: true },
  });
  const result = dispatchQueuedCodexJob({
    queueRecord: gated,
    integration: { capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true } },
  });

  assert.equal(result.decision, 'BLOCKED_BY_OPERATOR_APPROVAL');
  assert.equal(result.finalVerdict, 'CODEX_DISPATCHER_BLOCKED');
});

test('dashboard reports queue depth, current job, last proof, and last blocker', () => {
  const dispatched = dispatchQueuedCodexJob({
    queueRecord: job,
    integration: {
      capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
      dispatch: (record) => ({ receiptId: `receipt-${record.jobId}`, accepted: true }),
    },
    now: '2026-06-30T00:01:00Z',
  }).record;
  const proof = transitionCodexQueueRecord(dispatched, 'running', { timestamp: '2026-06-30T00:02:00Z' }).record;
  const blocked = dispatchQueuedCodexJob({ queueRecord: job, integration: {}, now: '2026-06-30T00:03:00Z' }).record;
  const dashboard = createDispatcherDashboard({
    queueRecords: [job, { ...proof, resultMetadata: { proofId: 'proof-1' } }, blocked],
  });

  assert.equal(dashboard.queueDepth, 1);
  assert.equal(dashboard.currentJob, proof.jobId);
  assert.deepEqual(dashboard.lastProof, { proofId: 'proof-1' });
  assert.equal(dashboard.lastBlocker.code, BLOCKED_BY_MISSING_INTEGRATION);
});
