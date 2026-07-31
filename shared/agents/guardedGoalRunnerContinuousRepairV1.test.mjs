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
    dispatchContext:[],
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
      persistCycleReceipt:async (receipt) => {
        calls.cycle.push(receipt);
        return { ok:true };
      },
      persistExecutionReceipt:async (receipt) => {
        calls.execution.push(receipt);
        return { ok:true };
      },
      dispatchRepair:async (order, context) => {
        calls.dispatch.push(order);
        calls.dispatchContext.push(context);
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
  assert.deepEqual(h.calls.cycle.map(({ status }) => status), ['repair-attempt-recorded', 'repair-dispatched']);
  assert.equal(h.calls.dispatchContext[0].idempotencyKey, h.calls.dispatch[0].executionId);
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
  assert.equal(requested.receipt.verificationPurpose, 'PRE_MERGE_EXACT_HEAD_CI');

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
  assert.equal(blocked.receipt.terminalExecutionPersisted, true);
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
  assert.equal(a.history[0].predecessorCycleId, null);
  assert.equal(a.receipt.predecessorCycleId, a.history[0].cycleId);
});

test('queued receipt persistence must be affirmed before dispatch', async () => {
  const h = harness([snapshot()], {
    persistExecutionReceipt:async (receipt) => {
      h.calls.execution.push(receipt);
      return { ok:false, reason:'workspace lock unavailable' };
    },
  });
  const blocked = await runGuardedContinuousRepairCycle(h.options);
  assert.equal(blocked.status, 'BLOCKED_EXECUTION_RECEIPT_PERSISTENCE');
  assert.equal(blocked.receipt.status, 'blocked-execution-receipt-persistence');
  assert.equal(blocked.receipt.dispatchAttempted, false);
  assert.equal(h.calls.dispatch.length, 0);
});

test('durable dispatch intent recovers after queued-receipt persistence fails', async () => {
  const first = harness([snapshot()], {
    persistExecutionReceipt:async (receipt) => {
      first.calls.execution.push(receipt);
      return { ok:false, reason:'workspace lock unavailable' };
    },
  });
  const blocked = await runGuardedContinuousRepairCycle(first.options);
  assert.equal(blocked.status, 'BLOCKED_EXECUTION_RECEIPT_PERSISTENCE');
  assert.deepEqual(
    blocked.history.map(({ status }) => status),
    ['repair-attempt-recorded', 'blocked-execution-receipt-persistence'],
  );
  assert.equal(first.calls.dispatch.length, 0);

  const resumed = harness([snapshot()], {
    attemptId:'attempt-2',
    history:blocked.history,
    maxRepairsPerHead:1,
  });
  const recovered = await runGuardedContinuousRepairCycle(resumed.options);
  assert.equal(recovered.status, 'WAITING_FOR_REPAIR');
  assert.equal(resumed.calls.execution.length, 1);
  assert.equal(resumed.calls.execution[0].state, 'queued');
  assert.equal(resumed.calls.dispatch.length, 1);
  assert.equal(
    recovered.receipt.recoveredDispatchIntentCycleId,
    blocked.history[0].cycleId,
  );
});

test('terminal receipt persistence must be affirmed after dispatch rejection', async () => {
  let persistenceAttempt = 0;
  const h = harness([snapshot()], {
    dispatchRepair:async (repairOrder) => {
      h.calls.dispatch.push(repairOrder);
      return { accepted:false, reason:'worker unavailable' };
    },
    persistExecutionReceipt:async (receipt) => {
      persistenceAttempt += 1;
      h.calls.execution.push(receipt);
      return persistenceAttempt === 1 ? { ok:true } : { ok:false, reason:'terminal write failed' };
    },
  });
  const blocked = await runGuardedContinuousRepairCycle(h.options);
  assert.equal(blocked.status, 'BLOCKED_EXECUTION_RECEIPT_PERSISTENCE');
  assert.equal(blocked.receipt.status, 'blocked-dispatch-rejected');
  assert.equal(blocked.receipt.terminalExecutionPersisted, false);
  assert.equal(blocked.receipt.terminalExecutionReceiptId, null);
});

test('verification lifecycle retires pre-merge purpose before post-merge runtime verification', async () => {
  const repairOrder = order();
  const preMerge = snapshot({
    findings:[],
    activeRepairOrders:[repairOrder],
    receipts:completedChain(repairOrder),
    ciGreen:false,
    ciHeadSha:HEAD,
    mergeable:true,
  });
  const first = harness([preMerge]);
  const requested = await runGuardedContinuousRepairCycle(first.options);
  const postMerge = snapshot({
    findings:[],
    activeRepairOrders:[repairOrder],
    receipts:completedChain(repairOrder),
    merged:true,
    operatorApprovalRecorded:true,
    approvalHeadSha:HEAD,
    approvalPrNumber:1617,
    ciGreen:true,
    ciHeadSha:HEAD,
    runtimeProofRequired:true,
    runtimeProofGreen:false,
    runtimeHeadSha:HEAD,
  });
  const resumed = harness([postMerge], {
    attemptId:'attempt-2',
    history:requested.history,
  });
  const runtimeRequest = await runGuardedContinuousRepairCycle(resumed.options);
  assert.equal(runtimeRequest.status, 'WAITING_FOR_VERIFICATION');
  assert.equal(resumed.calls.verify.length, 1);
  assert.equal(resumed.calls.verify[0].purpose, 'POST_MERGE_RUNTIME');
  assert.deepEqual(
    resumed.calls.cycle.map(({ status }) => status),
    ['verification-completed', 'verification-intent-recorded', 'verification-requested'],
  );
  assert.equal(runtimeRequest.receipt.verificationPurpose, 'POST_MERGE_RUNTIME');
});

test('accepted verification response without durable ID is rejected', async () => {
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
      return { accepted:true };
    },
  });
  const blocked = await runGuardedContinuousRepairCycle(h.options);
  assert.equal(blocked.status, 'BLOCKED_VERIFICATION_REJECTED');
  assert.equal(blocked.receipt.verificationAccepted, false);
  assert.equal(blocked.receipt.verificationId, null);
});

test('rejected dispatch attempts count against the durable exact-head budget', async () => {
  const first = harness([snapshot()], {
    dispatchRepair:async (repairOrder) => {
      first.calls.dispatch.push(repairOrder);
      return { accepted:false, reason:'worker unavailable' };
    },
  });
  const rejected = await runGuardedContinuousRepairCycle(first.options);
  assert.equal(rejected.status, 'BLOCKED_DISPATCH_REJECTED');

  const resumed = harness([snapshot()], {
    attemptId:'attempt-2',
    history:rejected.history,
    maxRepairsPerHead:1,
  });
  const blocked = await runGuardedContinuousRepairCycle(resumed.options);
  assert.equal(blocked.status, 'BLOCKED_REPAIR_BUDGET');
  assert.equal(resumed.calls.dispatch.length, 0);
  assert.equal(resumed.calls.execution.length, 0);
});

test('rehydrated history requires canonical cycle IDs and an unbroken predecessor chain', async () => {
  const first = harness([snapshot()]);
  const prior = await runGuardedContinuousRepairCycle(first.options);
  const tampered = prior.history.map((entry) => ({
    ...entry,
    predecessorCycleId:'spliced-cycle',
  }));
  const resumed = harness([snapshot()], {
    attemptId:'attempt-2',
    history:tampered,
  });
  const blocked = await runGuardedContinuousRepairCycle(resumed.options);
  assert.equal(blocked.status, 'BLOCKED_HISTORY_INVALID');
  assert.equal(resumed.calls.dispatch.length, 0);

  const forgedId = harness([snapshot()], {
    attemptId:'attempt-3',
    history:prior.history.map((entry) => ({ ...entry, cycleId:'forged-cycle' })),
  });
  const forgedBlocked = await runGuardedContinuousRepairCycle(forgedId.options);
  assert.equal(forgedBlocked.status, 'BLOCKED_HISTORY_INVALID');

  const tamperedStatus = harness([snapshot()], {
    attemptId:'attempt-4',
    history:prior.history.map((entry, index) => (
      index === 0 ? { ...entry, status:'waiting-repair' } : entry
    )),
  });
  const statusBlocked = await runGuardedContinuousRepairCycle(tamperedStatus.options);
  assert.equal(statusBlocked.status, 'BLOCKED_HISTORY_INVALID');

  const otherHead = harness([snapshot({ headSha:'c'.repeat(40) })], {
    attemptId:'attempt-5',
    history:prior.history,
  });
  const headBlocked = await runGuardedContinuousRepairCycle(otherHead.options);
  assert.equal(headBlocked.status, 'BLOCKED_HISTORY_INVALID');
});

test('post-merge verification requests exact-head CI before runtime proof', async () => {
  const repairOrder = order();
  const h = harness([snapshot({
    findings:[],
    activeRepairOrders:[repairOrder],
    receipts:completedChain(repairOrder),
    merged:true,
    operatorApprovalRecorded:true,
    approvalHeadSha:HEAD,
    approvalPrNumber:1617,
    ciGreen:false,
    ciHeadSha:HEAD,
    runtimeProofRequired:true,
    runtimeProofGreen:false,
    runtimeHeadSha:HEAD,
  })]);
  const waiting = await runGuardedContinuousRepairCycle(h.options);
  assert.equal(waiting.status, 'WAITING_FOR_VERIFICATION');
  assert.equal(h.calls.verify[0].purpose, 'POST_MERGE_EXACT_HEAD_CI');
  assert.equal(waiting.receipt.verificationPurpose, 'POST_MERGE_EXACT_HEAD_CI');
});

test('pre-merge verification refreshes mergeability without re-running green exact-head CI', async () => {
  const repairOrder = order();
  const h = harness([snapshot({
    findings:[],
    activeRepairOrders:[repairOrder],
    receipts:completedChain(repairOrder),
    ciGreen:true,
    ciHeadSha:HEAD,
    mergeable:false,
  })]);
  const waiting = await runGuardedContinuousRepairCycle(h.options);
  assert.equal(waiting.status, 'WAITING_FOR_VERIFICATION');
  assert.equal(h.calls.verify.length, 1);
  assert.equal(h.calls.verify[0].purpose, 'PRE_MERGE_MERGEABILITY');
  assert.equal(waiting.receipt.verificationPurpose, 'PRE_MERGE_MERGEABILITY');
});

test('failed dispatch terminalization is retried durably before more evaluation', async () => {
  let executionPersistence = 0;
  const first = harness([snapshot()], {
    dispatchRepair:async (repairOrder) => {
      first.calls.dispatch.push(repairOrder);
      return { accepted:false, reason:'worker unavailable' };
    },
    persistExecutionReceipt:async (receipt) => {
      executionPersistence += 1;
      first.calls.execution.push(receipt);
      return executionPersistence === 1 ? { ok:true } : { ok:false, reason:'terminal write failed' };
    },
  });
  const blocked = await runGuardedContinuousRepairCycle(first.options);
  assert.equal(blocked.status, 'BLOCKED_EXECUTION_RECEIPT_PERSISTENCE');
  assert.equal(blocked.receipt.pendingTerminalExecutionReceipt.state, 'failed');

  const resumed = harness([snapshot()], {
    attemptId:'attempt-2',
    history:blocked.history,
  });
  const recovered = await runGuardedContinuousRepairCycle(resumed.options);
  assert.equal(recovered.status, 'TERMINALIZATION_RECOVERED');
  assert.equal(resumed.calls.execution.length, 1);
  assert.equal(resumed.calls.execution[0].state, 'failed');
  assert.equal(resumed.calls.dispatch.length, 0);
  assert.equal(recovered.receipt.status, 'dispatch-terminalization-recovered');
});

test('recorded repair intent is idempotently recovered before the repair budget is applied', async () => {
  const first = harness([snapshot()], {
    persistCycleReceipt:async (receipt) => {
      first.calls.cycle.push(receipt);
      return { ok:receipt.status !== 'repair-dispatched' };
    },
  });
  const failedOutcome = await runGuardedContinuousRepairCycle(first.options);
  assert.equal(failedOutcome.status, 'BLOCKED_CYCLE_RECEIPT_PERSISTENCE');
  assert.equal(first.calls.dispatch.length, 1);
  assert.deepEqual(failedOutcome.history.map(({ status }) => status), ['repair-attempt-recorded']);

  const resumed = harness([snapshot()], {
    attemptId:'attempt-2',
    history:failedOutcome.history,
    maxRepairsPerHead:1,
  });
  const recovered = await runGuardedContinuousRepairCycle(resumed.options);
  assert.equal(recovered.status, 'WAITING_FOR_REPAIR');
  assert.equal(resumed.calls.dispatch.length, 1);
  assert.equal(resumed.calls.dispatch[0].executionId, failedOutcome.receipt?.dispatchAttemptId ?? failedOutcome.history[0].dispatchAttemptId);
  assert.equal(recovered.receipt.status, 'repair-dispatched');
  assert.equal(recovered.receipt.dispatchAttemptId, failedOutcome.history[0].dispatchAttemptId);
  assert.equal(recovered.receipt.recoveredDispatchIntentCycleId, failedOutcome.history[0].cycleId);
});

test('terminal execution evidence closes a recorded intent without replaying dispatch', async () => {
  const first = harness([snapshot()], {
    dispatchRepair:async (repairOrder) => {
      first.calls.dispatch.push(repairOrder);
      return { accepted:false, reason:'worker unavailable' };
    },
    persistCycleReceipt:async (receipt) => {
      first.calls.cycle.push(receipt);
      return { ok:receipt.status !== 'blocked-dispatch-rejected' };
    },
  });
  const lostCycleOutcome = await runGuardedContinuousRepairCycle(first.options);
  assert.equal(lostCycleOutcome.status, 'BLOCKED_CYCLE_RECEIPT_PERSISTENCE');
  assert.deepEqual(lostCycleOutcome.history.map(({ status }) => status), ['repair-attempt-recorded']);
  assert.deepEqual(first.calls.execution.map(({ state }) => state), ['queued', 'failed']);

  const intent = lostCycleOutcome.history[0];
  const resumed = harness([snapshot({
    activeRepairOrders:[intent.repairOrder],
    receipts:first.calls.execution,
  })], {
    attemptId:'attempt-2',
    history:lostCycleOutcome.history,
    maxRepairsPerHead:1,
  });
  const reconciled = await runGuardedContinuousRepairCycle(resumed.options);
  assert.equal(reconciled.status, 'TERMINAL_EXECUTION_RECONCILED');
  assert.equal(resumed.calls.dispatch.length, 0);
  assert.equal(resumed.calls.execution.length, 0);
  assert.equal(reconciled.receipt.status, 'dispatch-terminal-reconciled');
  assert.equal(reconciled.receipt.terminalExecutionState, 'failed');
  assert.equal(
    reconciled.receipt.terminalExecutionReceiptId,
    first.calls.execution.at(-1).receiptId,
  );
});

test('verification intent preserves one idempotency key across receipt-store failure', async () => {
  const repairOrder = order();
  const state = snapshot({
    findings:[],
    activeRepairOrders:[repairOrder],
    receipts:completedChain(repairOrder),
    ciGreen:false,
    ciHeadSha:HEAD,
    mergeable:true,
  });
  const first = harness([state], {
    persistCycleReceipt:async (receipt) => {
      first.calls.cycle.push(receipt);
      return { ok:receipt.status !== 'verification-requested' };
    },
  });
  const lostResult = await runGuardedContinuousRepairCycle(first.options);
  assert.equal(lostResult.status, 'BLOCKED_CYCLE_RECEIPT_PERSISTENCE');
  assert.deepEqual(lostResult.history.map(({ status }) => status), ['verification-intent-recorded']);
  const firstKey = first.calls.verify[0].idempotencyKey;

  const resumed = harness([state], {
    attemptId:'attempt-2',
    history:lostResult.history,
  });
  const waiting = await runGuardedContinuousRepairCycle(resumed.options);
  assert.equal(waiting.status, 'WAITING_FOR_VERIFICATION');
  assert.equal(resumed.calls.verify[0].idempotencyKey, firstKey);
  assert.deepEqual(resumed.calls.cycle.map(({ status }) => status), ['verification-requested']);
});

test('invalid explicit repair and iteration budgets fail closed', async () => {
  for (const [name, value] of [
    ['maxIterations', 0],
    ['maxIterations', 1.5],
    ['maxRepairsPerHead', 0],
    ['maxRepairsPerHead', '1'],
  ]) {
    const h = harness([snapshot()], { [name]:value });
    await assert.rejects(
      runGuardedContinuousRepairCycle(h.options),
      new RegExp(name),
    );
    assert.equal(h.calls.dispatch.length, 0);
  }
});
