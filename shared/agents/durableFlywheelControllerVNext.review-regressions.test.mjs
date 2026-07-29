import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileDurableFlywheelController,
  runDurableFlywheelStartupCycle,
} from './durableFlywheelControllerVNext.mjs';

const NOW = '2026-07-29T14:00:00+01:00';
const MAIN = '21dd7e30db529fea6eed0f0085f1b67fe858891c';
const HEAD = '762a64949d4e335bbf75b5aa4d2e50bac857d47a';
const LANE_ID = 'goal-1497-pr-1603';
const OWNER = 'github-first-chatgpt';

function schedulerReceipt(overrides = {}) {
  return {
    correlationId:'scheduler-1497', decidedAt:'2026-07-29T13:56:00+01:00', status:'ACTIVE_LANE',
    failClosed:false, contradictionCodes:[], selectedIssue:null, selectedLifecycle:null,
    activeIssue:1497, route:'CHATGPT_GITHUB', proofRefs:[], proofHeadShas:[], proofReceipts:[],
    ...overrides,
  };
}

function executionReceipt(overrides = {}) {
  return {
    schemaVersion:'stephanos.execution-receipt.v1', kind:'stephanos.execution.receipt', receiptId:'execution-1497-1',
    repository:'Cheekyfellastef/stephan-os', issueNumber:1497, prNumber:1603,
    branch:'feat/durable-flywheel-controller-vnext', sourceHead:HEAD,
    workerId:OWNER, workerType:'github-first', executionId:'execution-1497', leaseKey:LANE_ID,
    state:'completed', phase:'completed', sequence:1, predecessorReceiptId:'',
    timestampUtc:'2026-07-29T13:57:00+01:00', heartbeatExpiresAtUtc:'2026-07-29T13:57:00+01:00',
    blocker:'', operatorActionRequired:false, proofRefs:['proofs/execution-1497.json'], expectedNextAction:'',
    ...overrides,
  };
}

function activeSnapshot() {
  return {
    observedAt:NOW,
    github:{ mainHead:MAIN, implementationLanes:[{ id:LANE_ID, state:'IMPLEMENTING', headSha:HEAD }], goals:[] },
    sharedWorkspace:{
      sourceMutationLease:{ owner:OWNER, laneId:LANE_ID, expiresAt:'2026-07-29T14:30:00+01:00' },
      controllerHeartbeat:{ at:'2026-07-29T13:55:00+01:00' },
      machineryInventory:[
        { id:'scheduler-primary', kind:'scheduler', state:'RUNNING' },
        { id:'worker-primary', kind:'worker', state:'RUNNING' },
      ],
    },
    receipts:{ scheduler:schedulerReceipt(), execution:executionReceipt(), proofHeadShas:[], proofReceipts:[], proofRefs:[] },
    battleBridge:{ proof:null },
  };
}

function idleSnapshot() {
  const snapshot = activeSnapshot();
  snapshot.github.implementationLanes = [];
  snapshot.sharedWorkspace.sourceMutationLease = null;
  snapshot.receipts.execution = null;
  snapshot.receipts.scheduler = schedulerReceipt({ status:'LANE_SELECTED', selectedIssue:1700, selectedLifecycle:'READY', activeIssue:null });
  snapshot.github.goals = [{
    issue:1700, title:'Bounded goal', state:'READY', prerequisites:[], priority:100,
    criticalPathWeight:100, reversibility:'HIGH', route:'CHATGPT_GITHUB', evidenceAt:'2026-07-29T13:58:00+01:00',
  }];
  return snapshot;
}

test('fail-closed scheduler receipt blocks active-lane advancement', async () => {
  const snapshot = activeSnapshot();
  snapshot.receipts.scheduler = schedulerReceipt({ status:'BLOCKED_FAIL_CLOSED', failClosed:true, contradictionCodes:['split-brain'] });
  let advances = 0;
  const result = await runDurableFlywheelStartupCycle({
    loadDurableSnapshot:async () => snapshot,
    advanceActiveLane:async () => { advances += 1; },
    publishReceipt:async () => {},
  }, { now:NOW });
  assert.equal(result.status, 'HOLD');
  assert.equal(advances, 0);
  assert.ok(result.reconciliation.blockers.includes('scheduler-receipt-fail-closed'));
});

test('malformed scheduler proof containers reach canonical validation and prevent dispatch', async () => {
  const snapshot = idleSnapshot();
  snapshot.receipts.proofReceipts = { malformed:true };
  let dispatches = 0;
  const result = await runDurableFlywheelStartupCycle({
    loadDurableSnapshot:async () => snapshot,
    dispatchSelectedGoal:async () => { dispatches += 1; },
    publishReceipt:async () => {},
  }, { now:NOW });
  assert.equal(dispatches, 0);
  assert.equal(result.status, 'SCHEDULER_DECIDED');
  assert.equal(result.schedulerDecision.failClosed, true);
  assert.ok(result.schedulerDecision.contradictionCodes.length > 0);
});

test('execution receipt must bind to active lease key', () => {
  const snapshot = activeSnapshot();
  snapshot.receipts.execution = executionReceipt({ leaseKey:'another-lane' });
  const result = reconcileDurableFlywheelController(snapshot, { now:NOW });
  assert.equal(result.status, 'HOLD');
  assert.ok(result.blockers.some((blocker) => blocker.startsWith('execution-receipt-')));
});

test('execution receipt worker must match active lease owner', () => {
  const snapshot = activeSnapshot();
  snapshot.receipts.execution = executionReceipt({ workerId:'different-worker' });
  const result = reconcileDurableFlywheelController(snapshot, { now:NOW });
  assert.equal(result.status, 'HOLD');
  assert.ok(result.blockers.includes('execution-receipt-worker-lease-owner-mismatch'));
});
