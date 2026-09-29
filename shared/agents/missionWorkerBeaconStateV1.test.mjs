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
