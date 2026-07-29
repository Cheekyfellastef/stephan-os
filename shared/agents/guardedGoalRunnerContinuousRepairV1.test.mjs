import test from 'node:test';
import assert from 'node:assert/strict';
import { runGuardedContinuousRepairCycle } from './guardedGoalRunnerContinuousRepairV1.mjs';

const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);
const BASE = 'c'.repeat(40);

function baseSnapshot(overrides = {}) {
  return {
    repository: 'cheekyfellastef/stephan-os', issueNumber: 1497, prNumber: 1617,
    branch: 'feat/durable-flywheel-controller-vnext', baseSha: BASE, expectedBaseSha: BASE,
    headSha: HEAD_A, activeLaneKnown: true, currentPrCount: 1,
    reviewProofAvailable: true, reviewHeadSha: HEAD_A, findingsEvidenceAvailable: true,
    findings: [], activeRepairOrders: [], receipts: [], nowUtc: '2026-07-29T15:00:00.000Z',
    ciGreen: false, ciHeadSha: HEAD_A, mergeable: true, merged: false,
    workerAvailability: { githubFirstAvailable: true, githubFirstWorkerId: 'github-worker' },
    receiptTimestampUtc: '2026-07-29T15:00:00.000Z',
    receiptHeartbeatExpiresAtUtc: '2026-07-29T15:02:00.000Z',
    ...overrides,
  };
}

function harness(snapshots, options = {}) {
  const cycleReceipts = []; const executionReceipts = []; const repairs = []; const verifications = [];
  let index = 0;
  return {
    calls: { cycleReceipts, executionReceipts, repairs, verifications },
    options: {
      loadSnapshot: async () => snapshots[Math.min(index++, snapshots.length - 1)],
      persistCycleReceipt: async (receipt) => cycleReceipts.push(receipt),
      persistExecutionReceipt: async (receipt) => executionReceipts.push(receipt),
      dispatchRepair: async (order) => { repairs.push(order); return { accepted: true, workerTaskId: `worker-${repairs.length}` }; },
      requestExactHeadVerification: async (request) => { verifications.push(request); return { accepted: true, verificationId: `verify-${verifications.length}` }; },
      maxIterations: snapshots.length,
      ...options,
    },
  };
}

const finding = { id: 'P1-lease-binding', severity: 'P1', bounded: true, file: 'shared/agents/durableFlywheelControllerVNext.mjs', message: 'Bind receipt to lease.' };

test('dispatches a discovered bounded finding without an operator prompt', async () => {
  const first = baseSnapshot({ findings: [finding], allowedTests: ['node --test relevant.test.mjs'] });
  const h = harness([first], { maxIterations: 1 });
  const result = await runGuardedContinuousRepairCycle(h.options);
  assert.equal(h.calls.repairs.length, 1);
  assert.equal(h.calls.executionReceipts.length, 1);
  assert.equal(h.calls.cycleReceipts[0].status, 'repair-dispatched');
  assert.equal(result.status, 'BLOCKED_ITERATION_BUDGET');
});

test('retests and rereviews a repaired head before declaring merge readiness', async () => {
  const findingSnapshot = baseSnapshot({ findings: [finding] });
  const repairedHead = baseSnapshot({
    headSha: HEAD_B, reviewHeadSha: HEAD_B, findings: [], ciHeadSha: HEAD_B,
    activeRepairOrders: [{
      repository: 'cheekyfellastef/stephan-os', issueNumber: 1497, prNumber: 1617,
      branch: 'feat/durable-flywheel-controller-vnext', headSha: HEAD_B,
      executionId: 'repair-execution', leaseKey: 'repair-lease', assignedWorkerId: 'github-worker',
      worker: { workerType: 'github-first' }, laneGeneration: 1,
    }],
    receipts: [{
      schemaVersion: 'stephanos.execution.receipt.v1', kind: 'stephanos.execution.receipt',
      repository: 'cheekyfellastef/stephan-os', issueNumber: 1497, prNumber: 1617,
      branch: 'feat/durable-flywheel-controller-vnext', sourceHead: HEAD_B,
      workerId: 'github-worker', workerType: 'github-first', executionId: 'repair-execution', leaseKey: 'repair-lease',
      state: 'completed', phase: 'repair-published', sequence: 1,
      timestampUtc: '2026-07-29T15:01:00.000Z', heartbeatExpiresAtUtc: '2026-07-29T15:03:00.000Z',
      proofRefs: ['proofs/repair'], expectedNextAction: 'Verify exact head.',
    }],
    ciGreen: false,
  });
  const green = { ...repairedHead, ciGreen: true };
  const h = harness([findingSnapshot, repairedHead, green]);
  const result = await runGuardedContinuousRepairCycle(h.options);
  assert.equal(h.calls.repairs.length, 1);
  assert.equal(h.calls.verifications.length, 1);
  assert.equal(result.status, 'MERGE_READY');
  assert.equal(result.receipt.expectedHeadSha, HEAD_B);
  assert.equal(result.receipt.mergeAuthority, false);
});

test('loops through a second finding on the repaired head', async () => {
  const first = baseSnapshot({ findings: [finding] });
  const secondFinding = { id: 'P1-proof-container', severity: 'P1', bounded: true, file: 'shared/agents/durableFlywheelControllerVNext.mjs', message: 'Preserve malformed proof evidence.' };
  const second = baseSnapshot({ headSha: HEAD_B, reviewHeadSha: HEAD_B, ciHeadSha: HEAD_B, findings: [secondFinding] });
  const h = harness([first, second], { maxIterations: 2 });
  const result = await runGuardedContinuousRepairCycle(h.options);
  assert.equal(h.calls.repairs.length, 2);
  assert.equal(result.status, 'BLOCKED_ITERATION_BUDGET');
});

test('stops when automatic repair budget is exhausted', async () => {
  const snapshot = baseSnapshot({ findings: [finding] });
  const prior = [{ status: 'repair-dispatched', headSha: HEAD_A }, { status: 'repair-dispatched', headSha: HEAD_A }];
  const h = harness([snapshot], { history: prior, maxRepairsPerHead: 2, maxIterations: 1 });
  const result = await runGuardedContinuousRepairCycle(h.options);
  assert.equal(result.status, 'BLOCKED_REPAIR_BUDGET');
  assert.equal(h.calls.repairs.length, 0);
});

test('never merges or approves and hands merge-ready state to the operator gate', async () => {
  const order = {
    repository: 'cheekyfellastef/stephan-os', issueNumber: 1497, prNumber: 1617,
    branch: 'feat/durable-flywheel-controller-vnext', headSha: HEAD_A,
    executionId: 'repair-execution', leaseKey: 'repair-lease', assignedWorkerId: 'github-worker',
    worker: { workerType: 'github-first' }, laneGeneration: 1,
  };
  const completed = {
    schemaVersion: 'stephanos.execution.receipt.v1', kind: 'stephanos.execution.receipt',
    repository: 'cheekyfellastef/stephan-os', issueNumber: 1497, prNumber: 1617,
    branch: 'feat/durable-flywheel-controller-vnext', sourceHead: HEAD_A,
    workerId: 'github-worker', workerType: 'github-first', executionId: 'repair-execution', leaseKey: 'repair-lease',
    state: 'completed', phase: 'repair-published', sequence: 1,
    timestampUtc: '2026-07-29T15:00:00.000Z', heartbeatExpiresAtUtc: '2026-07-29T15:02:00.000Z',
    proofRefs: ['proofs/repair'], expectedNextAction: 'Verify exact head.',
  };
  const snapshot = baseSnapshot({ activeRepairOrders: [order], receipts: [completed], ciGreen: true });
  const h = harness([snapshot]);
  const result = await runGuardedContinuousRepairCycle(h.options);
  assert.equal(result.status, 'MERGE_READY');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.approvalAuthority, false);
  assert.equal(h.calls.repairs.length, 0);
});
