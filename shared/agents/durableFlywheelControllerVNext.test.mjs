import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileDurableFlywheelController, renderDurableFlywheelReceipt } from './durableFlywheelControllerVNext.mjs';

const NOW = '2026-07-29T14:00:00+01:00';
const MAIN = '21dd7e30db529fea6eed0f0085f1b67fe858891c';

function healthy(overrides = {}) {
  return {
    observedAt:NOW,
    github:{
      mainHead:MAIN,
      implementationLanes:[{ id:'goal-1497-pr-1603', state:'IMPLEMENTING', headSha:'762a64949d4e335bbf75b5aa4d2e50bac857d47a' }],
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
    },
    battleBridge:{ proof:null },
    ...overrides,
  };
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
  const snapshot = healthy();
  snapshot.github.implementationLanes = [];
  snapshot.sharedWorkspace.sourceMutationLease = null;
  snapshot.receipts.execution = null;
  const result = reconcileDurableFlywheelController(snapshot, { now:NOW });
  assert.equal(result.status, 'HEALTHY');
  assert.equal(result.nextAction, 'scheduler-may-select-one-runnable-goal');
});

test('receipt renderer preserves fail-closed authority posture', () => {
  const result = reconcileDurableFlywheelController(healthy(), { now:NOW });
  const receipt = renderDurableFlywheelReceipt(result);
  assert.match(receipt, /Durable Flywheel Reconciliation Receipt VNext/);
  assert.match(receipt, /Merge-Authority: false/);
  assert.match(receipt, /Lease-Seizure-Allowed: false/);
  assert.match(receipt, /Blockers: none/);
});
