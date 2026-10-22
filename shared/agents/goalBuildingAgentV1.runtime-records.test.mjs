import test from 'node:test';
import assert from 'node:assert/strict';

import {
  answerGoalBuildingQuestion,
  createGoalBuildingAgentWorkspaceRecords,
} from './goalBuildingAgentV1.records.mjs';
import { GOAL_BUILDING_RUNTIME_STATES } from './goalBuildingAgentV1.observation.mjs';

const head = 'c'.repeat(40);
const nowMs = Date.parse('2026-08-28T09:45:00.000Z');
const timestampUtc = new Date(nowMs).toISOString();

function certificate() {
  return {
    expectedHead: head,
    protectedMainHead: head,
    installedMainHead: head,
    evaluatedAtUtc: timestampUtc,
    state: 'FULLY_OPERATIONAL',
    summary: 'Stephanos is actively building one mission.',
    isCapableOfBuilding: true,
    isActuallyBuilding: true,
    programmeMode: 'ACTIVE_PROGRESS_PROVEN',
    activeMissionCount: 1,
    productiveMissionCount: 1,
    waitingMissionCount: 0,
    stalledMissionCount: 0,
    eligibleQueuedGoalCount: 0,
    qualifiedCapacity: 1,
    idleQualifiedCapacity: 0,
    activeMissions: [{
      missionId: 'mission-runtime-1',
      goalId: 'goal-runtime-1',
      laneId: 'lane-runtime-1',
      ownerId: 'goal-building-agent',
      phase: 'IMPLEMENT',
      authorityHead: head,
      observedAtUtc: '2026-08-28T09:44:55.000Z',
      lastProgressAtUtc: '2026-08-28T09:44:40.000Z',
      nextAction: 'Publish the next proof.',
    }],
    blockers: [],
    evidenceProblems: [],
    blockingReasons: [],
    degradedReasons: [],
    operatorActionRequired: false,
    operatorActionTarget: '',
    nextAction: 'Publish the next proof.',
    safetyLocks: {
      mutationAuthority: false,
      mergeAuthority: false,
      deploymentAuthority: false,
      arbitraryShellAllowed: false,
      leaseSeizureAllowed: false,
      selfPromotionAllowed: false,
    },
  };
}

function workerBeacon() {
  return {
    timestampUtc: '2026-08-28T09:44:58.000Z',
    workerState: 'MISSION_WORKER_RUNNING',
    headSha: head,
    activeTaskId: 'task-runtime-1',
    activeReceiptId: 'receipt-runtime-1',
    executionPhase: 'publishing-proof',
  };
}

test('building Q&A uses physical runtime truth when a worker beacon is supplied', () => {
  const result = answerGoalBuildingQuestion({
    question: 'Is Stephanos actually building now?',
    certificate: certificate(),
    workerBeacon: workerBeacon(),
    nowMs,
  });

  assert.equal(result.questionKind, 'ACTIVE_BUILD_TRUTH');
  assert.equal(result.runtimeTruthState, GOAL_BUILDING_RUNTIME_STATES.BUILDING);
  assert.equal(result.isActuallyBuilding, true);
  assert.match(result.answer, /^Yes\. BUILDING is physically proven/);
  assert.match(result.answer, /goal-runtime-1/);
  assert.equal(result.secondsSinceMeaningfulMovement, 20);
});

test('Shared Workspace participant status contains the same runtime truth without creating a second store', () => {
  const records = createGoalBuildingAgentWorkspaceRecords({
    certificate: certificate(),
    workerBeacon: workerBeacon(),
    protectedMainHead: head,
    installedMainHead: head,
    servedHead: head,
    timestampUtc,
    nowMs,
    validationOptions: { nowMs },
    proofRefs: ['evidence/receipts/mission-worker-heartbeat-current.json'],
  });
  const body = JSON.parse(records.status.body);

  assert.equal(records.runtimeTruth.state, GOAL_BUILDING_RUNTIME_STATES.BUILDING);
  assert.equal(body.runtimeTruth.state, GOAL_BUILDING_RUNTIME_STATES.BUILDING);
  assert.equal(body.runtimeTruth.workerReceiptId, 'receipt-runtime-1');
  assert.equal(body.runtimeTruth.currentGoalId, 'goal-runtime-1');
  assert.equal(body.runtimeTruth.servedHeadMatches, true);
  assert.equal(body.isActuallyBuilding, true);
});

test('stalled runtime truth overrides a falsely green programme certificate in Q&A', () => {
  const staleProgress = certificate();
  staleProgress.activeMissions = staleProgress.activeMissions.map((mission) => ({
    ...mission,
    lastProgressAtUtc: '2026-08-28T09:30:00.000Z',
  }));

  const result = answerGoalBuildingQuestion({
    question: 'What is building right now?',
    certificate: staleProgress,
    workerBeacon: workerBeacon(),
    nowMs,
    stallAfterMs: 5 * 60 * 1000,
  });

  assert.equal(result.runtimeTruthState, GOAL_BUILDING_RUNTIME_STATES.ALIVE_BUT_STALLED);
  assert.equal(result.isActuallyBuilding, false);
  assert.match(result.answer, /^No\. The Mission Worker is alive but stalled/);
});
