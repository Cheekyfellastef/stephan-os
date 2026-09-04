import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GOAL_BUILDING_RUNTIME_STATES,
  projectGoalBuildingRuntimeTruth,
} from './goalBuildingAgentV1.observation.mjs';

const head = 'a'.repeat(40);
const otherHead = 'b'.repeat(40);
const nowMs = Date.parse('2026-08-28T09:30:00.000Z');

function mission(overrides = {}) {
  return {
    missionId: 'mission-1',
    goalId: 'goal-1',
    laneId: 'lane-1',
    ownerId: 'goal-building-agent',
    phase: 'IMPLEMENT',
    authorityHead: head,
    observedAtUtc: '2026-08-28T09:29:50.000Z',
    lastProgressAtUtc: '2026-08-28T09:29:40.000Z',
    nextAction: 'Continue implementation and publish proof.',
    ...overrides,
  };
}

function certificate(overrides = {}) {
  const activeMissions = overrides.activeMissions ?? [mission()];
  return {
    expectedHead: head,
    protectedMainHead: head,
    installedMainHead: head,
    isActuallyBuilding: true,
    activeMissionCount: activeMissions.length,
    productiveMissionCount: activeMissions.length,
    eligibleQueuedGoalCount: 0,
    activeMissions,
    evidenceProblems: [],
    blockingReasons: [],
    degradedReasons: [],
    operatorActionRequired: false,
    operatorActionTarget: '',
    nextAction: 'Continue the current scheduler-authorized goal and publish the next durable progress receipt.',
    ...overrides,
  };
}

function runningBeacon(overrides = {}) {
  return {
    timestampUtc: '2026-08-28T09:29:55.000Z',
    workerState: 'MISSION_WORKER_RUNNING',
    headSha: head,
    activeTaskId: 'task-1',
    activeReceiptId: 'receipt-1',
    executionPhase: 'running-tests',
    requestId: 'request-1',
    retryCount: 1,
    nextRetryAt: '2026-08-28T09:31:00.000Z',
    ...overrides,
  };
}

test('BUILDING requires exact worker identity plus recent meaningful mission movement', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate(),
    workerBeacon: runningBeacon(),
    protectedMainHead: head,
    installedMainHead: head,
    servedHead: head,
    nowMs,
  });

  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.BUILDING);
  assert.equal(result.buildingProven, true);
  assert.equal(result.stalled, false);
  assert.equal(result.currentMissionId, 'mission-1');
  assert.equal(result.currentGoalId, 'goal-1');
  assert.equal(result.workerTaskId, 'task-1');
  assert.equal(result.workerReceiptId, 'receipt-1');
  assert.equal(result.currentPhase, 'running-tests');
  assert.equal(result.secondsSinceMeaningfulMovement, 20);
  assert.equal(result.meaningfulMovementFresh, true);
  assert.equal(result.protectedHeadMatches, true);
  assert.equal(result.installedHeadMatches, true);
  assert.equal(result.servedHeadMatches, true);
});

test('fresh heartbeat with old meaningful movement is ALIVE_BUT_STALLED instead of falsely BUILDING', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate({
      activeMissions: [mission({ lastProgressAtUtc: '2026-08-28T09:20:00.000Z' })],
    }),
    workerBeacon: runningBeacon(),
    nowMs,
    stallAfterMs: 5 * 60 * 1000,
  });

  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.ALIVE_BUT_STALLED);
  assert.equal(result.buildingProven, false);
  assert.equal(result.stalled, true);
  assert.equal(result.stallReason, 'NO_RECENT_MEANINGFUL_MOVEMENT');
  assert.equal(result.secondsSinceMeaningfulMovement, 600);
});

test('RUNNING without an active receipt is BLOCKED and cannot count as building', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate(),
    workerBeacon: runningBeacon({ activeReceiptId: '' }),
    nowMs,
  });

  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.BLOCKED);
  assert.equal(result.buildingProven, false);
  assert.equal(result.blocker, 'MISSION_WORKER_ACTIVE_RECEIPT_UNPROVEN');
  assert.equal(result.falseBuildingRejected, true);
});

test('worker head mismatch is BLOCKED even when programme evidence claims progress', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate(),
    workerBeacon: runningBeacon({ headSha: otherHead }),
    nowMs,
  });

  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.BLOCKED);
  assert.equal(result.buildingProven, false);
  assert.equal(result.exactWorkerHeadMatches, false);
  assert.equal(result.blocker, 'MISSION_WORKER_HEAD_MISMATCH');
});

test('fresh exact-head idle worker with no active or queued work is truthfully IDLE', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate({
      isActuallyBuilding: false,
      activeMissions: [],
      activeMissionCount: 0,
      productiveMissionCount: 0,
      eligibleQueuedGoalCount: 0,
      nextAction: 'Wait for the next eligible goal.',
    }),
    workerBeacon: runningBeacon({
      workerState: 'MISSION_WORKER_TICK_PASS',
      activeTaskId: '',
      activeReceiptId: '',
      executionPhase: '',
    }),
    nowMs,
  });

  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.IDLE);
  assert.equal(result.buildingProven, false);
  assert.equal(result.blocker, '');
});

test('stale heartbeat yields UNKNOWN rather than recycling old build proof', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate(),
    workerBeacon: runningBeacon({ timestampUtc: '2026-08-28T09:00:00.000Z' }),
    nowMs,
  });

  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.UNKNOWN);
  assert.equal(result.buildingProven, false);
  assert.equal(result.blocker, 'MISSION_WORKER_HEARTBEAT_STALE');
});

test('mismatched explicit movement identity does not count as progress', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate(),
    workerBeacon: runningBeacon(),
    executionMovement: {
      observedAtUtc: '2026-08-28T09:29:59.000Z',
      missionId: 'mission-1',
      taskId: 'task-1',
      receiptId: 'receipt-other',
      description: 'Tests advanced.',
    },
    nowMs,
  });

  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.ALIVE_BUT_STALLED);
  assert.equal(result.buildingProven, false);
  assert.equal(result.stallReason, 'MEANINGFUL_MOVEMENT_RECEIPT_MISMATCH');
  assert.equal(result.lastMeaningfulStateMovementAt, '');
  assert.equal(result.proofBasis.explicitMovementIdentityAccepted, false);
});

test('retry and operator-boundary telemetry remains visible without inventing progress', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate({
      isActuallyBuilding: false,
      operatorActionRequired: true,
      operatorActionTarget: 'Approve exact protected merge of PR #999.',
      blockingReasons: ['waiting-for-operator'],
    }),
    workerBeacon: runningBeacon({
      workerState: 'MISSION_WORKER_TICK_FAILED',
      blocker: 'WAITING_FOR_OPERATOR',
      retryCount: 3,
      nextRetryAt: '2026-08-28T09:35:00.000Z',
    }),
    nowMs,
  });

  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.BLOCKED);
  assert.equal(result.retryCount, 3);
  assert.equal(result.nextRetryAt, '2026-08-28T09:35:00.000Z');
  assert.equal(result.operatorActionRequired, true);
  assert.equal(result.operatorActionTarget, 'Approve exact protected merge of PR #999.');
});
