import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GOAL_BUILDING_RUNTIME_STATES,
  projectGoalBuildingRuntimeTruth,
} from './goalBuildingAgentV1.observation.mjs';
import { evaluateGoalBuildingProgramme } from './goalBuildingAgentV1.evaluator.mjs';

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
      goalId: 'goal-1',
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

for (const [field, reason] of [
  ['evidenceProblems', 'source-lease-identity-contradictory'],
  ['blockingReasons', 'physical-build-pickup-unproven'],
]) {
  test(`hard programme ${field} cannot be erased by a fresh RUNNING worker`, () => {
    const result = projectGoalBuildingRuntimeTruth({
      certificate: certificate({ [field]: [reason] }),
      workerBeacon: runningBeacon(),
      protectedMainHead: head,
      installedMainHead: head,
      servedHead: head,
      nowMs,
    });
    assert.equal(result.workerState, 'RUNNING');
    assert.equal(result.proofBasis.workerBeaconProven, true);
    assert.equal(result.meaningfulMovementFresh, true);
    assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.BLOCKED);
    assert.equal(result.buildingProven, false);
    assert.equal(result.falseBuildingRejected, true);
    assert.equal(result.blocker, reason);
  });
}

test('soft degraded reasons alone do not erase otherwise qualified worker progress', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate({ degradedReasons: ['unrelated-read-only-surface-stale'] }),
    workerBeacon: runningBeacon(),
    nowMs,
  });
  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.BUILDING);
  assert.equal(result.buildingProven, true);
});

test('same-mission operator approval cannot be masked by a fresh worker and movement', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate({
      operatorActionRequired: true,
      operatorActionTarget: 'Approve the protected merge for goal-1.',
      blockers: [{
        blockerId: 'approval-goal-1',
        route: 'REQUEST_EXACT_OPERATOR_APPROVAL',
        missionId: 'mission-1',
        goalId: 'goal-1',
      }],
    }),
    workerBeacon: runningBeacon(),
    nowMs,
  });
  assert.equal(result.workerState, 'RUNNING');
  assert.equal(result.meaningfulMovementFresh, true);
  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.BLOCKED);
  assert.equal(result.buildingProven, false);
  assert.equal(result.falseBuildingRejected, true);
  assert.equal(result.blocker, 'PROGRAMME_OPERATOR_GATE_SCOPE_UNPROVEN');
  assert.equal(result.operatorActionRequired, true);
});

test('unbound operator gate fails closed even with a plausible action title', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate({
      operatorActionRequired: true,
      operatorActionTarget: 'Approve goal-2 while goal-1 builds.',
      degradedReasons: ['unrelated-health-surface-stale'],
    }),
    workerBeacon: runningBeacon(),
    nowMs,
  });
  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.BLOCKED);
  assert.equal(result.buildingProven, false);
  assert.equal(result.blocker, 'PROGRAMME_OPERATOR_GATE_SCOPE_UNPROVEN');
  assert.equal(result.falseBuildingRejected, true);
});

test('lineage-proven disjoint operator wait does not hide genuinely productive work', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate({
      activeMissions: [
        mission(),
        mission({
          missionId: 'mission-2',
          goalId: 'goal-2',
          phase: 'WAITING_FOR_OPERATOR',
          lastProgressAtUtc: '2026-08-28T09:20:00.000Z',
        }),
      ],
      operatorActionRequired: true,
      operatorActionTarget: 'Approve exact protected merge for mission-2.',
      blockers: [{
        blockerId: 'approval-goal-2',
        route: 'REQUEST_EXACT_OPERATOR_APPROVAL',
        missionId: 'mission-2',
        goalId: 'goal-2',
      }],
    }),
    workerBeacon: runningBeacon(),
    nowMs,
  });
  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.BUILDING);
  assert.equal(result.buildingProven, true);
  assert.equal(result.currentMissionId, 'mission-1');
  assert.equal(result.operatorActionRequired, true);
});

test('a gate on either productive mission cannot be masked by the other mission', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate({
      activeMissions: [
        mission(),
        mission({ missionId: 'mission-2', goalId: 'goal-2' }),
      ],
      operatorActionRequired: true,
      operatorActionTarget: 'Approve goal-2 merge.',
      blockers: [{
        blockerId: 'approval-goal-2',
        route: 'REQUEST_EXACT_OPERATOR_APPROVAL',
        missionId: 'mission-2',
        goalId: 'goal-2',
      }],
    }),
    workerBeacon: runningBeacon(),
    nowMs,
  });
  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.BLOCKED);
  assert.equal(result.buildingProven, false);
});

test('contradictory operator blocker mission and goal identities fail closed', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate({
      activeMissions: [
        mission(),
        mission({ missionId: 'mission-2', goalId: 'goal-2', phase: 'WAITING_FOR_OPERATOR' }),
      ],
      operatorActionRequired: true,
      operatorActionTarget: 'Approve exact protected merge.',
      blockers: [{
        blockerId: 'mixed-identity',
        route: 'REQUEST_EXACT_OPERATOR_APPROVAL',
        missionId: 'mission-2',
        goalId: 'goal-1',
      }],
    }),
    workerBeacon: runningBeacon(),
    nowMs,
  });
  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.BLOCKED);
  assert.equal(result.buildingProven, false);
});


test('same-goal structured approval cannot be hidden by false operatorActionRequired summary', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate({
      operatorActionRequired: false,
      blockers: [{ blockerId: 'approval-1', route: 'REQUEST_EXACT_OPERATOR_APPROVAL', missionId: 'mission-1', goalId: 'goal-1' }],
    }),
    workerBeacon: runningBeacon(),
    nowMs,
  });
  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.BLOCKED);
  assert.equal(result.buildingProven, false);
  assert.equal(result.blocker, 'PROGRAMME_OPERATOR_GATE_SCOPE_UNPROVEN');
});

test('disjoint operator approval cannot hide a same-goal qualified-review hold', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate({
      activeMissions: [mission(), mission({ missionId: 'mission-2', goalId: 'goal-2', phase: 'WAITING_FOR_OPERATOR' })],
      operatorActionRequired: true,
      operatorActionTarget: 'Approve exact protected merge for mission-2.',
      blockers: [
        { blockerId: 'approval-2', route: 'REQUEST_EXACT_OPERATOR_APPROVAL', missionId: 'mission-2', goalId: 'goal-2' },
        { blockerId: 'review-1', route: 'REQUEST_QUALIFIED_REVIEW_OR_PROOF', missionId: 'mission-1', goalId: 'goal-1' },
      ],
    }),
    workerBeacon: runningBeacon(),
    nowMs,
  });
  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.BLOCKED);
  assert.equal(result.buildingProven, false);
  assert.equal(result.blocker, 'PROGRAMME_BLOCKER_SCOPE_UNPROVEN');
});

test('disjoint structured approval conflicting with productive-mission action target fails closed', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate({
      activeMissions: [mission(), mission({ missionId: 'mission-2', goalId: 'goal-2', phase: 'WAITING_FOR_OPERATOR' })],
      operatorActionRequired: true,
      operatorActionTarget: 'Approve the active mission-1 protected merge.',
      blockers: [{ blockerId: 'approval-2', route: 'REQUEST_EXACT_OPERATOR_APPROVAL', missionId: 'mission-2', goalId: 'goal-2' }],
    }),
    workerBeacon: runningBeacon(),
    nowMs,
  });
  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.BLOCKED);
  assert.equal(result.buildingProven, false);
  assert.equal(result.blocker, 'PROGRAMME_OPERATOR_GATE_SCOPE_UNPROVEN');
});

test('fully lineage-bound disjoint non-operator review gate preserves real productive progress', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate({
      activeMissions: [mission(), mission({ missionId: 'mission-2', goalId: 'goal-2', phase: 'WAIT_INDEPENDENT_REVIEW' })],
      blockers: [{ blockerId: 'review-2', route: 'REQUEST_QUALIFIED_REVIEW_OR_PROOF', missionId: 'mission-2', goalId: 'goal-2' }],
    }),
    workerBeacon: runningBeacon(),
    nowMs,
  });
  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.BUILDING);
  assert.equal(result.buildingProven, true);
});

test('unbound structured review gate fails closed even when summary does not declare an operator action', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate({ blockers: [{ blockerId: 'review-unbound', route: 'REQUEST_QUALIFIED_REVIEW_OR_PROOF', missionId: '', goalId: 'goal-2' }] }),
    workerBeacon: runningBeacon(),
    nowMs,
  });
  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.BLOCKED);
  assert.equal(result.blocker, 'PROGRAMME_BLOCKER_SCOPE_UNPROVEN');
});

test('fresh unbound execution timestamps cannot revive an otherwise stalled mission', () => {
  const complete = {
    observedAtUtc: '2026-08-28T09:29:59.000Z',
    missionId: 'mission-1',
    goalId: 'goal-1',
    taskId: 'task-1',
    receiptId: 'receipt-1',
  };
  for (const [missing, expectedBlocker] of [
    ['missionId', 'MEANINGFUL_MOVEMENT_MISSION_UNPROVEN'],
    ['goalId', 'MEANINGFUL_MOVEMENT_GOAL_UNPROVEN'],
    ['taskId', 'MEANINGFUL_MOVEMENT_TASK_UNPROVEN'],
    ['receiptId', 'MEANINGFUL_MOVEMENT_RECEIPT_UNPROVEN'],
  ]) {
    const executionMovement = { ...complete };
    delete executionMovement[missing];
    const result = projectGoalBuildingRuntimeTruth({
      certificate: certificate({ activeMissions: [mission({ lastProgressAtUtc: '2026-08-28T09:20:00.000Z' })] }),
      workerBeacon: runningBeacon(),
      executionMovement,
      nowMs,
    });
    assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.ALIVE_BUT_STALLED, missing);
    assert.equal(result.stallReason, expectedBlocker, missing);
    assert.equal(result.proofBasis.explicitMovementIdentityAccepted, false, missing);
    assert.equal(result.buildingProven, false, missing);
  }
});

test('an explicit movement with wrong goal or nonproductive mission cannot prove BUILDING', () => {
  const stale = mission({ lastProgressAtUtc: '2026-08-28T09:20:00.000Z' });
  const baseMovement = {
    observedAtUtc: '2026-08-28T09:29:59.000Z',
    missionId: 'mission-1',
    goalId: 'goal-1',
    taskId: 'task-1',
    receiptId: 'receipt-1',
  };
  const scenarios = [
    ['contradictory goal lineage', { ...baseMovement, goalId: 'goal-other' }, 'MEANINGFUL_MOVEMENT_GOAL_MISMATCH'],
    ['unknown mission', { ...baseMovement, missionId: 'mission-other' }, 'MEANINGFUL_MOVEMENT_MISSION_MISMATCH'],
    ['waiting-mission substitution', { ...baseMovement, missionId: 'mission-2', goalId: 'goal-2' }, 'MEANINGFUL_MOVEMENT_MISSION_NOT_PRODUCTIVE'],
  ];
  for (const [label, executionMovement, expectedBlocker] of scenarios) {
    const result = projectGoalBuildingRuntimeTruth({
      certificate: certificate({
        activeMissions: [
          stale,
          mission({ missionId: 'mission-2', goalId: 'goal-2', phase: 'WAITING_FOR_OPERATOR', lastProgressAtUtc: '2026-08-28T09:20:00.000Z' }),
        ],
      }),
      workerBeacon: runningBeacon(),
      executionMovement,
      nowMs,
    });
    assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.ALIVE_BUT_STALLED, label);
    assert.equal(result.stallReason, expectedBlocker, label);
    assert.equal(result.proofBasis.explicitMovementIdentityAccepted, false, label);
    assert.equal(result.buildingProven, false, label);
  }
});

test('duplicate mission identity cannot turn one explicit progress event into BUILDING', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate({
      activeMissions: [
        mission({ lastProgressAtUtc: '2026-08-28T09:20:00.000Z' }),
        mission({ lastProgressAtUtc: '2026-08-28T09:19:00.000Z' }),
      ],
    }),
    workerBeacon: runningBeacon(),
    executionMovement: {
      observedAtUtc: '2026-08-28T09:29:59.000Z',
      missionId: 'mission-1',
      goalId: 'goal-1',
      taskId: 'task-1',
      receiptId: 'receipt-1',
    },
    nowMs,
  });
  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.ALIVE_BUT_STALLED);
  assert.equal(result.stallReason, 'MEANINGFUL_MOVEMENT_MISSION_MISMATCH');
  assert.equal(result.buildingProven, false);
});

test('fully bound fresh movement on another productive mission preserves accurate current identity', () => {
  const result = projectGoalBuildingRuntimeTruth({
    certificate: certificate({
      activeMissions: [
        mission({ lastProgressAtUtc: '2026-08-28T09:20:00.000Z' }),
        mission({ missionId: 'mission-2', goalId: 'goal-2', phase: 'TEST', lastProgressAtUtc: '2026-08-28T09:19:00.000Z' }),
      ],
    }),
    workerBeacon: runningBeacon(),
    executionMovement: {
      observedAtUtc: '2026-08-28T09:29:59.000Z',
      missionId: 'mission-2',
      goalId: 'goal-2',
      taskId: 'task-1',
      receiptId: 'receipt-1',
      description: 'Exact productive test evidence advanced.',
    },
    nowMs,
  });
  assert.equal(result.state, GOAL_BUILDING_RUNTIME_STATES.BUILDING);
  assert.equal(result.buildingProven, true);
  assert.equal(result.currentMissionId, 'mission-2');
  assert.equal(result.currentGoalId, 'goal-2');
  assert.equal(result.proofBasis.explicitMovementIdentityAccepted, true);
  assert.equal(result.proofBasis.meaningfulMovementSource, 'execution-movement');
});

test('a READY worker cannot certify active building in source-only or physical reporting', () => {
  for (const physicalExecutionRequired of [false, true]) {
    const physicalSurfaces = physicalExecutionRequired
      ? ['battleBridge', 'ignition', 'recoveryMesh', 'mailbox'].map((id) => ({ id, state: 'READY' }))
      : [];
    const surfaces = [
      { id: 'sourceSync', state: 'SYNC_NO_CHANGE' },
      { id: 'scheduler', state: 'ACTIVE' },
      { id: 'continuityController', state: 'ACTIVE' },
      { id: 'missionWorker', state: 'READY' },
      { id: 'providerRouter', state: 'ROUTING' },
      { id: 'proofRoute', state: 'READY' },
      { id: 'reviewRoute', state: 'READY' },
      { id: 'statusFabric', state: 'READY' },
      ...physicalSurfaces,
    ].map((surface) => ({
      ...surface,
      head,
      observedAtUtc: '2026-08-28T09:29:55.000Z',
      blocker: '',
    }));
    const input = {
      expectedHead: head,
      protectedMainHead: head,
      installedMainHead: head,
      physicalExecutionRequired,
      surfaces,
      programme: {
        activeMissions: [mission()],
        eligibleQueuedGoalCount: 0,
        qualifiedCapacity: 1,
        idleQualifiedCapacity: 0,
      },
      blockers: [],
      operatorAction: { required: false, target: '' },
      validationOptions: { nowMs },
    };
    const ready = evaluateGoalBuildingProgramme(input);
    assert.equal(ready.isCapableOfBuilding, true, 'READY is permitted for capability');
    assert.equal(ready.isActuallyBuilding, false, 'READY is not productive worker pickup');
    assert.equal(ready.state, 'GOAL_BUILDING_BLOCKED');
    assert.equal(ready.programmeMode, 'BLOCKED');
    const observed = projectGoalBuildingRuntimeTruth({
      certificate: ready,
      workerBeacon: runningBeacon({
        workerState: 'MISSION_WORKER_TICK_PASS',
        activeTaskId: '',
        activeReceiptId: '',
        executionPhase: '',
      }),
      protectedMainHead: head,
      installedMainHead: head,
      servedHead: head,
      nowMs,
    });
    assert.equal(observed.buildingProven, false);
    assert.notEqual(observed.state, GOAL_BUILDING_RUNTIME_STATES.BUILDING);

    const executing = evaluateGoalBuildingProgramme({
      ...input,
      surfaces: surfaces.map((surface) => surface.id === 'missionWorker'
        ? { ...surface, state: 'RUNNING' }
        : surface),
    });
    assert.equal(executing.isActuallyBuilding, true, 'unchanged current RUNNING proof stays eligible');
  }
});
