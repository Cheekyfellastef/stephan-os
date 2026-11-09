import assert from 'node:assert/strict';
import test from 'node:test';

import { projectMissionWorkerBeaconState } from './missionWorkerBeaconStateV1.mjs';

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);
const NOW = Date.parse('2026-08-26T18:45:00.000Z');

function heartbeat(overrides = {}) {
  return {
    timestampUtc: '2026-08-26T18:44:55.000Z',
    headSha: HEAD,
    branch: 'main',
    lastTickVerdict: 'MISSION_WORKER_TICK_PASS',
    ...overrides,
  };
}

test('fresh exact-head pass is IDLE and cannot be reported as building', () => {
  const state = projectMissionWorkerBeaconState(heartbeat(), { nowMs: NOW, expectedHead: HEAD });
  assert.equal(state.state, 'IDLE');
  assert.equal(state.exactHeadMatch, true);
  assert.equal(state.buildingProven, false);
  assert.equal(state.falseBuildingRejected, true);
  assert.equal(state.blocker, '');
});

test('RUNNING requires an exact active task, receipt and execution phase', () => {
  const state = projectMissionWorkerBeaconState(heartbeat({
    lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
    activeTaskId: 'task-1951-review',
    activeReceiptId: 'receipt-1951-running-1',
    executionPhase: 'deterministic-tests',
  }), { nowMs: NOW, expectedHead: HEAD });
  assert.equal(state.state, 'RUNNING');
  assert.equal(state.activeTaskId, 'task-1951-review');
  assert.equal(state.activeReceiptId, 'receipt-1951-running-1');
  assert.equal(state.executionPhase, 'deterministic-tests');
  assert.equal(state.activeExecutionIdentityComplete, true);
  assert.equal(state.buildingProven, true);
  assert.equal(state.falseBuildingRejected, false);
});

test('RUNNING without a receipt is live but fails closed as not building', () => {
  const state = projectMissionWorkerBeaconState(heartbeat({
    lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
    activeTaskId: 'task-1951-review',
    executionPhase: 'deterministic-tests',
  }), { nowMs: NOW, expectedHead: HEAD });
  assert.equal(state.state, 'RUNNING');
  assert.equal(state.buildingProven, false);
  assert.equal(state.falseBuildingRejected, true);
  assert.equal(state.blocker, 'MISSION_WORKER_ACTIVE_RECEIPT_UNPROVEN');
});

test('failed tick, stale heartbeat and wrong head classify BLOCKED or STALE', () => {
  const blocked = projectMissionWorkerBeaconState(heartbeat({
    lastTickVerdict: 'MISSION_WORKER_TICK_FAILED',
    blocker: 'WORKER_TICK_FAILED',
  }), { nowMs: NOW, expectedHead: HEAD });
  assert.equal(blocked.state, 'BLOCKED');
  assert.equal(blocked.blocker, 'WORKER_TICK_FAILED');
  assert.equal(blocked.buildingProven, false);

  const stale = projectMissionWorkerBeaconState(heartbeat({
    timestampUtc: '2026-08-26T18:40:00.000Z',
    lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
    activeTaskId: 'task-1',
    activeReceiptId: 'receipt-1',
    executionPhase: 'build',
  }), { nowMs: NOW, staleAfterMs: 180_000, expectedHead: HEAD });
  assert.equal(stale.state, 'STALE');
  assert.equal(stale.blocker, 'MISSION_WORKER_HEARTBEAT_STALE');
  assert.equal(stale.buildingProven, false);

  const wrongHead = projectMissionWorkerBeaconState(heartbeat({
    headSha: OTHER_HEAD,
    lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
    activeTaskId: 'task-1',
    activeReceiptId: 'receipt-1',
    executionPhase: 'build',
  }), { nowMs: NOW, expectedHead: HEAD });
  assert.equal(wrongHead.state, 'BLOCKED');
  assert.equal(wrongHead.exactHeadMatch, false);
  assert.equal(wrongHead.blocker, 'MISSION_WORKER_HEAD_MISMATCH');
  assert.equal(wrongHead.buildingProven, false);
});

test('unsafe receipt identity is rejected rather than echoed into telemetry', () => {
  const state = projectMissionWorkerBeaconState(heartbeat({
    lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
    activeTaskId: 'task-1',
    activeReceiptId: '../private/receipt',
    executionPhase: 'build',
  }), { nowMs: NOW, expectedHead: HEAD });
  assert.equal(state.activeReceiptId, '');
  assert.equal(state.buildingProven, false);
  assert.equal(state.blocker, 'MISSION_WORKER_ACTIVE_RECEIPT_UNPROVEN');
});

test('future-dated RUNNING heartbeat cannot promote unobserved physical pickup', () => {
  const state = projectMissionWorkerBeaconState(heartbeat({
    timestampUtc: '2026-08-26T18:46:00.000Z',
    lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
    activeTaskId: 'task-physical-1', activeReceiptId: 'receipt-physical-1',
    executionPhase: 'source-build',
  }), { nowMs: NOW, expectedHead: HEAD });
  assert.equal(state.futureDated, true);
  assert.equal(state.state, 'BLOCKED');
  assert.equal(state.blocker, 'MISSION_WORKER_HEARTBEAT_FUTURE_DATED');
  assert.equal(state.buildingProven, false);
  assert.equal(state.falseBuildingRejected, true);
});

test('bounded five-second clock skew retains legitimate running exact-head proof', () => {
  const state = projectMissionWorkerBeaconState(heartbeat({
    timestampUtc: '2026-08-26T18:45:03.000Z',
    lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
    activeTaskId: 'task-physical-2', activeReceiptId: 'receipt-physical-2',
    executionPhase: 'source-build',
  }), { nowMs: NOW, expectedHead: HEAD });
  assert.equal(state.futureDated, false);
  assert.equal(state.state, 'RUNNING');
  assert.equal(state.buildingProven, true);
});

test('extra SHA suffix is not an exact head despite matching 40-hex prefix', () => {
  for (const invalid of [HEAD + 'b', HEAD + '-suffix']) {
    const state = projectMissionWorkerBeaconState(heartbeat({
      headSha: invalid,
      lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
      activeTaskId: 'task-physical-3', activeReceiptId: 'receipt-physical-3',
      executionPhase: 'source-build',
    }), { nowMs: NOW, expectedHead: HEAD });
    assert.equal(state.head, '', invalid);
    assert.equal(state.exactHeadMatch, false, invalid);
    assert.equal(state.blocker, 'MISSION_WORKER_HEAD_MISMATCH', invalid);
    assert.equal(state.buildingProven, false, invalid);
  }
});

test('overlong task or receipt identity cannot be truncated into false BUILDING proof', () => {
  for (const [field, invalid] of [
    ['activeTaskId', 't'.repeat(128) + '!'],
    ['activeReceiptId', 'r'.repeat(128) + '!'],
    ['executionPhase', 'p'.repeat(160) + '!'],
  ]) {
    const state = projectMissionWorkerBeaconState(heartbeat({
      lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
      activeTaskId: 'task-exact',
      activeReceiptId: 'receipt-exact',
      executionPhase: 'source-build',
      [field]: invalid,
    }), { nowMs: NOW, expectedHead: HEAD });
    assert.equal(state.state, 'RUNNING', field);
    assert.equal(state[field], '', field);
    assert.equal(state.activeExecutionIdentityComplete, false, field);
    assert.equal(state.buildingProven, false, field);
    assert.equal(state.falseBuildingRejected, true, field);
    assert.equal(state.blocker, 'MISSION_WORKER_ACTIVE_RECEIPT_UNPROVEN', field);
  }
});

test('maximum valid full-length worker identities retain legitimate running proof', () => {
  const state = projectMissionWorkerBeaconState(heartbeat({
    lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
    activeTaskId: 't'.repeat(128),
    activeReceiptId: 'r'.repeat(128),
    executionPhase: 'p'.repeat(160),
  }), { nowMs: NOW, expectedHead: HEAD });
  assert.equal(state.activeExecutionIdentityComplete, true);
  assert.equal(state.buildingProven, true);
  assert.equal(state.blocker, '');
});

test('Goal #2961: non-string worker identities cannot be coerced into false BUILDING', () => {
  const ordinary = heartbeat({
    lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
    activeTaskId: 'task-1', activeReceiptId: 'receipt-1',
    executionPhase: 'source-build',
  });
  const baseline = projectMissionWorkerBeaconState(ordinary, { nowMs: NOW, expectedHead: HEAD });
  assert.equal(baseline.buildingProven, true);
  const adversarial = [
    ['activeTaskId-array', { activeTaskId: ['task-1'] }],
    ['activeReceiptId-array', { activeReceiptId: ['receipt-1'] }],
    ['executionPhase-array', { executionPhase: ['source-build'] }],
    ['headSha-array', { headSha: [HEAD] }],
    ['timestampUtc-array', { timestampUtc: ['2026-08-26T18:44:55.000Z'] }],
    ['activeTaskId-number', { activeTaskId: 123 }],
    ['activeReceiptId-boolean', { activeReceiptId: true }],
    ['lastTickVerdict-array', { lastTickVerdict: ['MISSION_WORKER_TICK_RUNNING'] }],
    ['executionPhase-object', { executionPhase: { value: 'source-build' } }],
  ];
  for (const [label, change] of adversarial) {
    const result = projectMissionWorkerBeaconState({ ...ordinary, ...change },
      { nowMs: NOW, expectedHead: HEAD });
    assert.equal(result.buildingProven, false, label);
    assert.equal(result.falseBuildingRejected, true, label);
    assert.notEqual(result.blocker, '', label);
  }
  const wrongExpected = projectMissionWorkerBeaconState(ordinary,
    { nowMs: NOW, expectedHead: [HEAD] });
  assert.equal(wrongExpected.buildingProven, false);
  assert.equal(wrongExpected.exactHeadMatch, false);
});

test('Goal #2961: hostile object coercion is never called for trusted worker fields', () => {
  const hostile = { toString() { throw new Error('Untrusted coercion executed'); } };
  const valid = heartbeat({
    lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
    activeTaskId: 'task-1', activeReceiptId: 'receipt-1',
    executionPhase: 'source-build',
  });
  for (const key of ['headSha', 'activeTaskId', 'activeReceiptId',
    'executionPhase', 'timestampUtc', 'lastTickVerdict']) {
    const result = projectMissionWorkerBeaconState({ ...valid, [key]: hostile },
      { nowMs: NOW, expectedHead: HEAD });
    assert.equal(result.buildingProven, false, key);
    assert.equal(result.falseBuildingRejected, true, key);
  }
});
