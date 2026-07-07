import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION,
  BLOCKED_BY_MISSING_INTEGRATION,
  CODEX_DISPATCH_CAPABILITY,
  CODEX_DISPATCHER_STATE,
  assessCodexIntegration,
  buildAutomatedCodexDispatcherContract,
  createDispatcherDashboard,
  createDispatchPacket,
  createDispatchReceipt,
  dispatchQueuedCodexJob,
  verifyDispatchReceipt,
} from './automatedCodexDispatcher.mjs';
import { createCodexQueueRecord, transitionCodexQueueRecord } from './codexDispatchQueue.mjs';

const job = createCodexQueueRecord({
  issueNumber: 1293,
  branch: 'codex/issues-1293-automated-dispatcher',
  prompt: 'Dispatch queued Codex jobs only when the integration can really launch Codex.',
  requestedProofCommands: ['node --test shared/agents/automatedCodexDispatcher*.test.mjs'],
});

test('dispatcher contract consumes existing queue and exposes state/capability dashboard visibility', () => {
  const contract = buildAutomatedCodexDispatcherContract();
  assert.equal(contract.schemaVersion, AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION);
  assert.equal(contract.consumes, 'stephanos.codex_dispatch.queue.contract');
  assert.equal(contract.reuses.battleBridgeSupervisor, 'stephanos.battle_bridge.supervisor.contract');
  assert.deepEqual(contract.states, Object.values(CODEX_DISPATCHER_STATE));
  assert.deepEqual(contract.capabilityModes, Object.values(CODEX_DISPATCH_CAPABILITY));
  assert.equal(contract.requiredMessages.includes('codex-waiting-operator'), true);
  assert.deepEqual(contract.dashboardFields, ['queueDepth', 'currentJob', 'dispatcherState', 'capabilityMode', 'lastDispatchReceipt', 'lastProof', 'lastBlocker', 'operatorActionRequired']);
  assert.equal(contract.guardrails.fakeDispatchAllowed, false);
  assert.equal(contract.guardrails.browserAutomationAllowed, false);
  assert.equal(contract.guardrails.mergeAllowed, false);
});

test('capability detection distinguishes manual, automated supported, and unavailable states', () => {
  const manual = assessCodexIntegration({ manualDispatch: true, capabilities: { returnDispatchReceipt: true } });
  const automatic = assessCodexIntegration({ capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true }, dispatch: () => ({ accepted: true }) });
  const unavailable = assessCodexIntegration({ capabilities: { returnDispatchReceipt: true } });

  assert.equal(manual.mode, CODEX_DISPATCH_CAPABILITY.MANUAL_ONLY);
  assert.equal(manual.finalVerdict, 'CODEX_MANUAL_DISPATCH_ONLY');
  assert.equal(automatic.mode, CODEX_DISPATCH_CAPABILITY.AUTOMATED_SUPPORTED);
  assert.equal(automatic.supported, true);
  assert.equal(unavailable.mode, CODEX_DISPATCH_CAPABILITY.AUTOMATED_UNAVAILABLE);
  assert.deepEqual(unavailable.missingCapabilities, ['launchCodexJob', 'returnProofMetadata']);
  assert.equal(unavailable.finalVerdict, BLOCKED_BY_MISSING_INTEGRATION);
});

test('manual mode produces exact packet, waits for operator, and never claims work started', () => {
  const result = dispatchQueuedCodexJob({
    queueRecord: job,
    integration: { manualDispatch: true },
    now: '2026-07-07T00:00:00Z',
  });

  assert.equal(result.dispatcherState, CODEX_DISPATCHER_STATE.WAITING_FOR_OPERATOR);
  assert.equal(result.decision, 'MANUAL_PACKET_READY');
  assert.equal(result.record.status, 'queued');
  assert.equal(result.dispatchPacket.jobId, job.jobId);
  assert.equal(result.dispatchPacket.prompt, job.prompt);
  assert.equal(result.dispatchPacket.mergeAuthority, false);
  assert.equal(result.sharedWorkspaceMessage.eventKind, 'codex-waiting-operator');
  assert.equal(result.workspacePublication.statusRecord.status, CODEX_DISPATCHER_STATE.WAITING_FOR_OPERATOR);
  assert.equal(result.finalVerdict, 'CODEX_MANUAL_DISPATCH_PACKET_READY');
});

test('unsupported integration publishes deterministic missing integration blocker and exact reason', () => {
  const result = dispatchQueuedCodexJob({
    queueRecord: job,
    integration: { capabilities: { returnDispatchReceipt: true } },
    now: '2026-07-07T00:01:00Z',
  });

  assert.equal(result.dispatcherState, CODEX_DISPATCHER_STATE.BLOCKED_BY_MISSING_INTEGRATION);
  assert.equal(result.finalVerdict, BLOCKED_BY_MISSING_INTEGRATION);
  assert.equal(result.record.status, 'blocked');
  assert.equal(result.blockerMetadata.code, BLOCKED_BY_MISSING_INTEGRATION);
  assert.equal(result.blockerMetadata.reason, 'Missing automated Codex integration capability: launchCodexJob, returnProofMetadata.');
  assert.deepEqual(result.missingCapabilities, ['launchCodexJob', 'returnProofMetadata']);
  assert.equal(result.sharedWorkspaceMessage.eventKind, 'codex-job-blocked');
  assert.equal(result.workspacePublication.eventRecord.eventKind, 'blocked-reason');
});

test('automatic mode dispatches only through supported integration and verifies structured receipt', () => {
  const result = dispatchQueuedCodexJob({
    queueRecord: job,
    integration: {
      integrationId: 'codex-supported-test-adapter',
      capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
      dispatch: (packet) => ({ receiptId: `receipt-${packet.jobId}`, accepted: true, started: true, proofRefs: [`receipts/${packet.jobId}.json`] }),
    },
    now: '2026-07-07T00:02:00Z',
  });

  assert.equal(result.dispatcherState, CODEX_DISPATCHER_STATE.WAITING_FOR_RESULT);
  assert.equal(result.finalVerdict, 'CODEX_JOB_DISPATCHED');
  assert.equal(result.record.status, 'dispatched');
  assert.equal(result.record.dispatchedAt, '2026-07-07T00:02:00Z');
  assert.equal(result.dispatchReceipt.accepted, true);
  assert.equal(result.dispatchReceipt.arbitraryShellAllowed, false);
  assert.equal(result.proofMetadata.status, 'PASS');
  assert.equal(result.proofMetadata.workspaceMessage.eventKind, 'verification-result');
  assert.equal(result.capabilityRecord.agentId, 'codex');
  assert.equal(result.sharedWorkspaceMessage.eventKind, 'codex-job-dispatched');
});

test('automatic mode rejects non-accepted receipt instead of faking success', () => {
  assert.throws(() => dispatchQueuedCodexJob({
    queueRecord: job,
    integration: {
      capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
      dispatch: () => ({ receiptId: 'receipt-rejected', accepted: false }),
    },
  }), /fake dispatch is forbidden/);
});

test('approval requirements are not bypassed by queue presence', () => {
  const gated = createCodexQueueRecord({
    ...job,
    approvalRequirements: { requiresOperatorApprovalBeforeDispatch: true, requiresOperatorApprovalBeforeMerge: true },
  });
  const result = dispatchQueuedCodexJob({
    queueRecord: gated,
    integration: { capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true }, dispatch: () => ({ accepted: true }) },
  });

  assert.equal(result.dispatcherState, CODEX_DISPATCHER_STATE.WAITING_FOR_OPERATOR);
  assert.equal(result.decision, 'BLOCKED_BY_OPERATOR_APPROVAL');
  assert.equal(result.finalVerdict, 'CODEX_DISPATCHER_BLOCKED');
});

test('receipt verifier uses Verification Harness command receipt and proof reference checks', () => {
  const receipt = createDispatchReceipt({ jobId: job.jobId, accepted: true, started: true, proofRefs: [`receipts/${job.jobId}.json`], timestampUtc: '2026-07-07T00:03:00Z' });
  const verified = verifyDispatchReceipt({ receipt });
  assert.equal(verified.status, 'PASS');
  assert.deepEqual(verified.evidence, ['command-receipt-proof: PASS', 'proof-reference-proof: PASS']);
});

test('dashboard reports state, capability mode, receipt, proof, and blocker fields', () => {
  const dispatched = dispatchQueuedCodexJob({
    queueRecord: job,
    integration: {
      capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
      dispatch: (packet) => ({ receiptId: `receipt-${packet.jobId}`, accepted: true, started: true, proofRefs: [`receipts/${packet.jobId}.json`] }),
    },
    now: '2026-07-07T00:04:00Z',
  }).record;
  const proof = transitionCodexQueueRecord(dispatched, 'running', { timestamp: '2026-07-07T00:05:00Z' }).record;
  const blocked = dispatchQueuedCodexJob({ queueRecord: job, integration: {}, now: '2026-07-07T00:06:00Z' }).record;
  const dashboard = createDispatcherDashboard({
    queueRecords: [job, { ...proof, resultMetadata: { ...proof.resultMetadata, proofMetadata: { proofId: 'proof-1293' } } }, blocked],
    dispatcherState: CODEX_DISPATCHER_STATE.WAITING_FOR_RESULT,
    capabilityMode: CODEX_DISPATCH_CAPABILITY.AUTOMATED_SUPPORTED,
  });

  assert.equal(dashboard.queueDepth, 1);
  assert.equal(dashboard.currentJob, proof.jobId);
  assert.equal(dashboard.dispatcherState, CODEX_DISPATCHER_STATE.WAITING_FOR_RESULT);
  assert.equal(dashboard.capabilityMode, CODEX_DISPATCH_CAPABILITY.AUTOMATED_SUPPORTED);
  assert.equal(dashboard.lastDispatchReceipt.accepted, true);
  assert.deepEqual(dashboard.lastProof, { proofId: 'proof-1293' });
  assert.equal(dashboard.lastBlocker.code, BLOCKED_BY_MISSING_INTEGRATION);
});

test('dispatch packets are deterministic queue projections rather than a second queue', () => {
  const packet = createDispatchPacket(job);
  assert.equal(packet.queueRecordRef, job.jobId);
  assert.equal(packet.jobId, job.jobId);
  assert.deepEqual(packet.requestedProofCommands, job.requestedProofCommands);
  assert.equal(packet.finalVerdict, 'CODEX_DISPATCH_PACKET_READY');
});
