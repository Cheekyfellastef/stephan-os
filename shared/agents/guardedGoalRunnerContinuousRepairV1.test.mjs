import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionReceipt } from './executionReceiptV1.mjs';
import { evaluateGuardedRepairLoop } from './guardedGoalRunnerRepairLoopV1.mjs';
import { runGuardedContinuousRepairCycle } from './guardedGoalRunnerContinuousRepairV1.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const FINDING = {
  id:'P1-loop',
  severity:'P1',
  bounded:true,
  file:'shared/agents/example.mjs',
  message:'repair me',
};

function snapshot(overrides = {}) {
  return {
    repository:'cheekyfellastef/stephan-os',
    issueNumber:1497,
    prNumber:1617,
    branch:'feat/example',
    baseSha:BASE,
    expectedBaseSha:BASE,
    headSha:HEAD,
    activeLaneKnown:true,
    currentPrCount:1,
    reviewProofAvailable:true,
    reviewHeadSha:HEAD,
    findingsEvidenceAvailable:true,
    findings:[FINDING],
    activeRepairOrders:[],
    receipts:[],
    nowUtc:'2026-07-29T15:00:00.000Z',
    workerAvailability:{
      githubFirstAvailable:true,
      githubFirstWorkerId:'github-worker',
    },
    receiptTimestampUtc:'2026-07-29T15:00:00.000Z',
    receiptHeartbeatExpiresAtUtc:'2026-07-29T15:02:00.000Z',
    ...overrides,
  };
}

function harness(states, extra = {}) {
  let index = 0;
  const calls = {
    cycle:[],
    execution:[],
    dispatch:[],
    verify:[],
    history:[],
  };
  return {
    calls,
    options:{
      attemptId:'attempt-1',
      history:[],
      loadSnapshot:async () => states[Math.min(index++, states.length - 1)],
      loadCycleHistory:async (context) => {
        calls.history.push(context);
        return [];
      },
      persistCycleReceipt:async (receipt) => calls.cycle.push(receipt),
      persistExecutionReceipt:async (receipt) => calls.execution.push(receipt),
      dispatchRepair:async (order) => {
        calls.dispatch.push(order);
        return { accepted:true, workerTaskId:'worker-1' };
      },
      requestExactHeadVerification:async (request) => {
        calls.verify.push(request);
        return { accepted:true, verificationId:'verify-1' };
      },
      maxIterations:states.length,
      ...extra,
    },
  };
}

function order() {
  return {
    repository:'cheekyfellastef/stephan-os',
    issueNumber:1497,
    prNumber:1617,
    branch:'feat/example',
    headSha:HEAD,
    executionId:'exec',
    leaseKey:'lease',
    assignedWorkerId:'github-worker',
    worker:{ workerType:'github-first' },
    laneGeneration:1,
  };
}

function executionReceipt(repairOrder, state, sequence, predecessorReceiptId = '') {
  return createExecutionReceipt({
    repository:repairOrder.repository,
    issueNumber:repairOrder.issueNumber,
    prNumber:repairOrder.prNumber,
    branch:repairOrder.branch,
    sourceHead:repairOrder.headSha,
    workerId:repairOrder.assignedWorkerId,
    workerType:repairOrder.worker.workerType,
    executionId:repairOrder.executionId,
    leaseKey:repairOrder.leaseKey,
    state,
    phase:state,
    sequence,
    predecessorReceiptId,
    timestampUtc:new Date(Date.parse('2026-07-29T15:00:00.000Z') + (sequence - 1) * 1000).toISOString(),
    heartbeatExpiresAtUtc:'2026-07-29T15:02:00.000Z',
    proofRefs:['proof'],
    expectedNextAction:state === 'completed' ? '' : 'continue',
  });
}

function completedChain(repairOrder) {
  const queued = executionReceipt(repairOrder, 'queued', 1);
  const accepted = executionReceipt(repairOrder, 'accepted', 2, queued.receiptId);
  const started = executionReceipt(repairOrder, 'started', 3, accepted.receiptId);
  return [queued, accepted, started, executionReceipt(repairOrder, 'completed', 4, started.receiptId)];
}

test('automatically dispatches a bounded review repair and durably waits', async () => {
  const h = harness([snapshot()]);
  const cycle = await runGuardedContinuousRepairCycle(h.options);
  assert.equal(h.calls.dispatch.length, 1);
  assert.equal(h.calls.execution.length, 1);
  assert.equal(h.calls.cycle[0].status, 'repair-dispatched');
  assert.equal(cycle.status, 'WAITING_FOR_REPAIR');
});

test('requests exact-head verification once and rehydrates the outstanding request', async () => {
  const repairOrder = order();
  const state = snapshot({
    findings:[],
    activeRepairOrders:[repairOrder],
    receipts:completedChain(repairOrder),
    ciGreen:false,
    ciHeadSha:HEAD,
    mergeable:true,
  });
  const first = harness([state]);
  const requested = await runGuardedContinuousRepairCycle(first.options);
  assert.equal(requested.status, 'WAITING_FOR_VERIFICATION');
  assert.equal(first.calls.verify.length, 1);
  assert.equal(requested.receipt.status, 'verification-requested');

  const resumed = harness([state], {
    attemptId:'attempt-2',
    history:requested.history,
  });
  const waiting = await runGuardedContinuousRepairCycle(resumed.options);
  assert.equal(waiting.status, 'WAITING_FOR_VERIFICATION');
  assert.equal(resumed.calls.verify.length, 0);
  assert.equal(waiting.receipt.verificationId, 'verify-1');
});

test('stops at merge-ready and never gains merge authority', async () => {
  const repairOrder = order();
  const h = harness([snapshot({
    findings:[],
    activeRepairOrders:[repairOrder],
    receipts:completedChain(repairOrder),
    ciGreen:true,
    ciHeadSha:HEAD,
    mergeable:true,
  })]);
  const cycle = await runGuardedContinuousRepairCycle(h.options);
  assert.equal(cycle.status, 'MERGE_READY');
  assert.equal(cycle.mergeAuthority, false);
  assert.equal(cycle.approvalAuthority, false);
});

test('rehydrates durable history before enforcing the exact-head repair budget', async () => {
  const first = harness([snapshot()]);
  const prior = await runGuardedContinuousRepairCycle(first.options);
  const resumed = harness([snapshot()], {
    attemptId:'attempt-2',
    history:undefined,
    loadCycleHistory:async (context) => {
      resumed.calls.history.push(context);
      return prior.history;
    },
    maxRepairsPerHead:1,
  });
  const blocked = await runGuardedContinuousRepairCycle(resumed.options);
  assert.equal(resumed.calls.history.length, 1);
  assert.equal(blocked.status, 'BLOCKED_REPAIR_BUDGET');
  assert.equal(blocked.receipt.status, 'blocked-repair-budget');
  assert.equal(resumed.calls.dispatch.length, 0);
});

test('fails closed and persists a receipt when durable history is unavailable', async () => {
  const h = harness([snapshot()], {
    history:undefined,
    loadCycleHistory:undefined,
  });
  const blocked = await runGuardedContinuousRepairCycle(h.options);
  assert.equal(blocked.status, 'BLOCKED_HISTORY_UNAVAILABLE');
  assert.equal(blocked.receipt.status, 'blocked-history-unavailable');
  assert.equal(h.calls.cycle.length, 1);
});

test('dispatch rejection terminalizes the queued execution chain', async () => {
  const h = harness([snapshot()], {
    dispatchRepair:async (repairOrder) => {
      h.calls.dispatch.push(repairOrder);
      return { accepted:false, reason:'worker unavailable' };
    },
  });
  const blocked = await runGuardedContinuousRepairCycle(h.options);
  assert.equal(blocked.status, 'BLOCKED_DISPATCH_REJECTED');
  assert.equal(blocked.receipt.status, 'blocked-dispatch-rejected');
  assert.equal(h.calls.execution.length, 2);
  assert.equal(h.calls.execution[0].state, 'queued');
  assert.equal(h.calls.execution[1].state, 'failed');
  assert.equal(h.calls.execution[1].predecessorReceiptId, h.calls.execution[0].receiptId);
});

test('verification rejection is persisted as the durable blocked state', async () => {
  const repairOrder = order();
  const h = harness([snapshot({
    findings:[],
    activeRepairOrders:[repairOrder],
    receipts:completedChain(repairOrder),
    ciGreen:false,
    ciHeadSha:HEAD,
    mergeable:true,
  })], {
    requestExactHeadVerification:async (request) => {
      h.calls.verify.push(request);
      return { accepted:false, reason:'verification queue unavailable' };
    },
  });
  const blocked = await runGuardedContinuousRepairCycle(h.options);
  assert.equal(blocked.status, 'BLOCKED_VERIFICATION_REJECTED');
  assert.equal(blocked.receipt.status, 'blocked-verification-rejected');
  assert.equal(blocked.receipt.verificationAccepted, false);
});

test('iteration-budget exhaustion is persisted after bounded observation', async () => {
  const admitted = evaluateGuardedRepairLoop(snapshot());
  const active = snapshot({
    activeRepairOrders:[admitted.repairOrder],
    receipts:[admitted.nextReceipt],
  });
  const h = harness([active, active], { maxIterations:2 });
  const blocked = await runGuardedContinuousRepairCycle(h.options);
  assert.equal(blocked.status, 'BLOCKED_ITERATION_BUDGET');
  assert.equal(blocked.receipt.status, 'blocked-iteration-budget');
  assert.equal(h.calls.cycle.at(-1).status, 'blocked-iteration-budget');
});

test('cycle identity binds the full lane and durable attempt', async () => {
  const first = harness([snapshot()], { attemptId:'attempt-a' });
  const second = harness([snapshot()], { attemptId:'attempt-b' });
  const otherRepo = harness([snapshot({ repository:'other/repo' })], { attemptId:'attempt-a' });
  const [a, b, c] = await Promise.all([
    runGuardedContinuousRepairCycle(first.options),
    runGuardedContinuousRepairCycle(second.options),
    runGuardedContinuousRepairCycle(otherRepo.options),
  ]);
  assert.notEqual(a.receipt.cycleId, b.receipt.cycleId);
  assert.notEqual(a.receipt.cycleId, c.receipt.cycleId);
  assert.equal(a.receipt.predecessorCycleId, null);
});
