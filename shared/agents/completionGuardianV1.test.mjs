import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPLETION_GUARDIAN_STATE,
  buildCompletionGuardianProjection,
  classifyCompletionMission,
} from './completionGuardianV1.mjs';

function mission(overrides = {}) {
  return {
    missionId: 'critical-1284-1286-completion-controller',
    title: 'Complete autonomous programme completion controller',
    currentPhase: 'CREATE_WORKTREE',
    blockers: [],
    continuity: { parkingStatus: 'ACTIVE', repairOwner: '', reason: '' },
    approval: { status: 'not-requested' },
    pullRequest: { merged: false, mergeCommitSha: '' },
    deployment: {
      sync: { status: 'pending' },
      build: { status: 'pending' },
      verify: { status: 'pending' },
      restart: { status: 'pending' },
    },
    evidenceReceipts: [],
    nextAction: { type: 'CREATE_WORKTREE' },
    ...overrides,
  };
}
const backlog = [{
  issueNumbers: [1284, 1286],
  mission: { missionId: 'critical-1284-1286-completion-controller' },
}];

test('orphan-parked mission becomes buildable repair, not forgotten work', () => {
  const state = classifyCompletionMission(mission({
    currentPhase: 'BLOCKED',
    blockers: ['ORPHANED_ACTIVE_MISSION: no active claim and no progress.'],
    continuity: {
      parkingStatus: 'PARKED_BLOCKED',
      repairOwner: 'goal-building-agent',
      reason: 'ORPHANED_ACTIVE_MISSION: no progress.',
    },
  }));
  assert.equal(state, COMPLETION_GUARDIAN_STATE.BUILDABLE_REPAIR);
});

test('approval gate remains parked and never auto-repairs', () => {
  const state = classifyCompletionMission(mission({
    currentPhase: 'AWAITING_OPERATOR_APPROVAL',
    approval: { status: 'pending' },
  }));
  assert.equal(state, COMPLETION_GUARDIAN_STATE.APPROVAL_GATED);
});

test('complete requires merge, deterministic evidence, and all runtime deployment steps', () => {
  const complete = mission({
    currentPhase: 'COMPLETE',
    pullRequest: { merged: true, mergeCommitSha: 'a'.repeat(40) },
    deployment: {
      sync: { status: 'success' },
      build: { status: 'success' },
      verify: { status: 'success' },
      restart: { status: 'success' },
    },
    evidenceReceipts: [{ receiptId: 'proof-1', verified: true }],
  });
  assert.equal(classifyCompletionMission(complete), COMPLETION_GUARDIAN_STATE.COMPLETE_PROVEN);
  assert.equal(
    classifyCompletionMission({ ...complete, deployment: { ...complete.deployment, restart: { status: 'pending' } } }),
    COMPLETION_GUARDIAN_STATE.PROOF_PENDING,
  );
});

test('regression reopens previously complete mission', () => {
  assert.equal(
    classifyCompletionMission(mission({ currentPhase: 'COMPLETE' }), {
      regressedMissionIds: ['critical-1284-1286-completion-controller'],
    }),
    COMPLETION_GUARDIAN_STATE.REGRESSION_REPAIR_REQUIRED,
  );
});

test('projection exposes repair queue and ready goals without inventing another scheduler', () => {
  const projected = buildCompletionGuardianProjection({
    observedAtUtc: '2026-09-27T12:50:00.000Z',
    backlog,
    missions: [mission({
      currentPhase: 'BLOCKED',
      blockers: ['ORPHANED_ACTIVE_MISSION: no progress.'],
      continuity: {
        parkingStatus: 'PARKED_BLOCKED',
        repairOwner: 'goal-building-agent',
        reason: 'ORPHANED_ACTIVE_MISSION: no progress.',
      },
    })],
    goals: [
      { issueNumber: 1284, state: 'READY', mirrorBuildPickupAllowed: true },
      { issueNumber: 1286, state: 'READY', mirrorBuildPickupAllowed: true },
      { issueNumber: 2434, state: 'READY', mirrorBuildPickupAllowed: true },
    ],
  });
  assert.equal(projected.finalVerdict, 'COMPLETION_GUARDIAN_ACTION_REQUIRED');
  assert.equal(projected.repairQueue.length, 1);
  assert.deepEqual(projected.readyUnownedGoalIssueNumbers, [2434]);
  assert.equal(projected.duplicateSchedulerCreated, false);
  assert.equal(projected.mergeAuthority, false);
});
