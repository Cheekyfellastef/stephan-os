import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileDurableFlywheelController,
  renderDurableFlywheelReceipt,
  runDurableFlywheelStartupCycle,
} from './durableFlywheelControllerVNext.mjs';

const NOW = '2026-07-29T14:00:00+01:00';
const MAIN = '21dd7e30db529fea6eed0f0085f1b67fe858891c';

function healthy(overrides = {}) {
  return {
    observedAt:NOW,
    github:{
      mainHead:MAIN,
      implementationLanes:[{ id:'goal-1497-pr-1603', state:'IMPLEMENTING', headSha:'762a64949d4e335bbf75b5aa4d2e50bac857d47a' }],
      goals:[],
    },
    sharedWorkspace:{
      sourceMutationLease:{ owner:'github-first-chatgpt', laneId:'goal-1497-pr-1603', expiresAt:'2026-07-29T14:30:00+01:00' },
      controllerHeartbeat:{ at:'2026-07-29T13:55:00+01:00' },
      machineryInventory:[
        { id:'scheduler-primary', kind:'scheduler', state:'RUNNING' },
        { id:'worker-primary', kind:'worker', state:'RUNNING' },
        { id:'audit-primary', kind:'audit-monitor', state:'RUNNING' },
      ],
    },
    receipts:{
      scheduler:{ kind:'scheduler', state:'COMPLETE', at:'2026-07-29T13:56:00+01:00' },
      execution:{ kind:'execution', state:'COMPLETE', laneId:'goal-1497-pr-1603', at:'2026-07-29T13:57:00+01:00' },
      proofHeadShas:[],
      proofReceipts:[],
      proofRefs:[],
    },
    battleBridge:{ proof:null },
    ...overrides,
  };
}

function idleWithGoal() {
  const snapshot = healthy();
  snapshot.github.implementationLanes = [];
  snapshot.sharedWorkspace.sourceMutationLease = null;
  snapshot.receipts.execution = null;
  snapshot.github.goals = [{
    issue:1700,
    title:'Use existing machinery automatically',
    state:'READY',
    prerequisites:[],
    priority:100,
    criticalPathWeight:100,
    reversibility:'HIGH',
    route:'CHATGPT_GITHUB',
    evidenceAt:'2026-07-29T13:58:00+01:00',
  }];
  return snapshot;
}

test('healthy durable state advances only one bounded step', () => {
  const result = reconcileDurableFlywheelController(healthy(), { now:NOW });
  assert.equal(result.status, 'HEALTHY');
  assert.equal(result.activeLaneCount, 1);
  assert.equal(result.nextAction, 'advance-one-bounded-step-under-existing-lease');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.chatMemoryAuthoritative, false);
});

test('multiple active lanes fail closed as split brain', () => {
  const snapshot = healthy();
  snapshot.github.implementationLanes.push({ id:'goal-other-pr-9999', state:'ACTIVE', headSha:MAIN });
  const result = reconcileDurableFlywheelController(snapshot, { now:NOW });
  assert.equal(result.status, 'HOLD');
  assert.ok(result.blockers.includes('split-brain-multiple-active-implementation-lanes'));
  assert.equal(result.nextAction, 'publish-reconciliation-receipt-and-stop-without-mutation');
});

test('expired lease cannot be seized implicitly', () => {
  const snapshot = healthy();
  snapshot.sharedWorkspace.sourceMutationLease.expiresAt = '2026-07-29T13:59:59+01:00';
  const result = reconcileDurableFlywheelController(snapshot, { now:NOW });
  assert.equal(result.status, 'HOLD');
  assert.ok(result.blockers.includes('active-lane-without-valid-source-mutation-lease'));
  assert.equal(result.leaseSeizureAllowed, false);
});

test('stale heartbeat and duplicate machinery are surfaced', () => {
  const snapshot = healthy();
  snapshot.sharedWorkspace.controllerHeartbeat.at = '2026-07-29T12:00:00+01:00';
  snapshot.sharedWorkspace.machineryInventory.push({ id:'worker-duplicate', kind:'worker', state:'DISPATCHED' });
  const result = reconcileDurableFlywheelController(snapshot, { now:NOW });
  assert.ok(result.blockers.includes('controller-heartbeat-stale-or-missing'));
  assert.ok(result.blockers.includes('duplicate-active-machinery'));
  assert.deepEqual(result.duplicateMachinery, [{ kind:'worker', entries:['worker-primary', 'worker-duplicate'] }]);
});

test('proof-running lane requires observed exact-main Battle Bridge proof', () => {
  const snapshot = healthy();
  snapshot.github.implementationLanes[0].state = 'PROOF_RUNNING';
  snapshot.battleBridge.proof = {
    state:'OBSERVED',
    at:'2026-07-29T13:58:00+01:00',
    sourceHead:'0000000000000000000000000000000000000000',
  };
  const result = reconcileDurableFlywheelController(snapshot, { now:NOW });
  assert.equal(result.status, 'HOLD');
  assert.ok(result.blockers.includes('battle-bridge-proof-source-head-mismatch'));
});

test('idle healthy controller lets scheduler select one goal', () => {
  const snapshot = idleWithGoal();
  const result = reconcileDurableFlywheelController(snapshot, { now:NOW });
  assert.equal(result.status, 'HEALTHY');
  assert.equal(result.nextAction, 'scheduler-may-select-one-runnable-goal');
});

test('startup cycle reconstructs durable state and advances active lane once', async () => {
  const calls = [];
  const receipts = [];
  const result = await runDurableFlywheelStartupCycle({
    loadDurableSnapshot:async () => healthy(),
    advanceActiveLane:async (packet) => {
      calls.push(packet);
      return { status:'ACTIVE_LANE_ADVANCED', laneId:packet.lane.id };
    },
    publishReceipt:async (receipt) => receipts.push(receipt),
  }, { now:NOW });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].boundedSteps, 1);
  assert.equal(calls[0].mergeAuthority, false);
  assert.equal(calls[0].leaseSeizureAllowed, false);
  assert.equal(result.status, 'ACTIVE_LANE_ADVANCED');
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].chatMemoryAuthoritative, false);
});

test('startup cycle uses existing mission scheduler and dispatches one selected goal', async () => {
  const dispatched = [];
  const receipts = [];
  const result = await runDurableFlywheelStartupCycle({
    loadDurableSnapshot:async () => idleWithGoal(),
    dispatchSelectedGoal:async (packet) => {
      dispatched.push(packet);
      return { status:'GOAL_DISPATCHED', selectedGoal:packet.selectedGoal };
    },
    publishReceipt:async (receipt) => receipts.push(receipt),
  }, { now:NOW });

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].selectedGoal, '#1700');
  assert.equal(dispatched[0].selectedRoute, 'CHATGPT_GITHUB');
  assert.equal(dispatched[0].boundedSteps, 1);
  assert.equal(dispatched[0].createReplacementMachinery, false);
  assert.equal(result.status, 'GOAL_DISPATCHED');
  assert.equal(receipts[0].schedulerDecision.selectedIssue, 1700);
});

test('startup cycle publishes hold receipt and performs no mutation', async () => {
  const snapshot = healthy();
  snapshot.sharedWorkspace.controllerHeartbeat.at = '2026-07-29T12:00:00+01:00';
  let mutationCalls = 0;
  const receipts = [];
  const result = await runDurableFlywheelStartupCycle({
    loadDurableSnapshot:async () => snapshot,
    advanceActiveLane:async () => { mutationCalls += 1; },
    dispatchSelectedGoal:async () => { mutationCalls += 1; },
    publishReceipt:async (receipt) => receipts.push(receipt),
  }, { now:NOW });

  assert.equal(result.status, 'HOLD');
  assert.equal(mutationCalls, 0);
  assert.equal(receipts.length, 1);
});

test('receipt renderer preserves fail-closed authority posture', () => {
  const result = reconcileDurableFlywheelController(healthy(), { now:NOW });
  const receipt = renderDurableFlywheelReceipt(result);
  assert.match(receipt, /Durable Flywheel Reconciliation Receipt VNext/);
  assert.match(receipt, /Merge-Authority: false/);
  assert.match(receipt, /Lease-Seizure-Allowed: false/);
  assert.match(receipt, /Blockers: none/);
});
