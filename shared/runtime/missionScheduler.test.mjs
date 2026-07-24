import test from 'node:test';
import assert from 'node:assert/strict';
import { answerMissionQuery, buildMissionScheduler } from './missionScheduler.mjs';

const NOW = '2026-07-24T21:00:00.000Z';
const fresh = '2026-07-24T20:55:00.000Z';

function goal(issue, overrides = {}) {
  return {
    issue,
    title: `Goal ${issue}`,
    state: 'QUEUED',
    prerequisites: [],
    priority: 1,
    criticalPathWeight: 1,
    reversibility: 'HIGH',
    route: 'CHATGPT_GITHUB',
    evidenceAt: fresh,
    ...overrides,
  };
}

test('completed prerequisite unlocks dependant and selects one lane', () => {
  const result = buildMissionScheduler({
    now: NOW,
    goals: [
      goal(1, { state: 'COMPLETE' }),
      goal(2, { prerequisites: [1], priority: 5 }),
      goal(3, { priority: 2 }),
    ],
  });
  assert.equal(result.failClosed, false);
  assert.equal(result.selectedGoal, '#2');
  assert.equal(result.selectedRoute, 'CHATGPT_GITHUB');
  assert.equal(result.operatorAction, 'NO_OPERATOR_ACTION_REQUIRED');
});

test('missing prerequisite blocks readiness', () => {
  const result = buildMissionScheduler({ now: NOW, goals: [goal(2, { prerequisites: [999] })] });
  assert.equal(result.portfolio[0].lifecycle, 'BLOCKED');
  assert.equal(result.selectedGoal, null);
});

test('dependency cycle fails closed', () => {
  const result = buildMissionScheduler({
    now: NOW,
    goals: [goal(1, { prerequisites: [2] }), goal(2, { prerequisites: [1] })],
  });
  assert.equal(result.failClosed, true);
  assert.ok(result.contradictions.some(({ code }) => code === 'DEPENDENCY_CYCLE'));
  assert.equal(result.selectedGoal, null);
});

test('exactly one active lane remains authoritative', () => {
  const result = buildMissionScheduler({
    now: NOW,
    goals: [goal(1, { state: 'ACTIVE', activePr: 1601 }), goal(2, { priority: 99 })],
  });
  assert.equal(result.activeGoal, '#1');
  assert.equal(result.activeLane, 'PR #1601');
  assert.equal(result.selectedGoal, null);
  assert.match(result.whyNow, /authoritative/);
});

test('multiple active lanes fail closed', () => {
  const result = buildMissionScheduler({
    now: NOW,
    goals: [goal(1, { state: 'ACTIVE' }), goal(2, { state: 'IMPLEMENTING' })],
  });
  assert.equal(result.failClosed, true);
  assert.ok(result.contradictions.some(({ code }) => code === 'MULTIPLE_ACTIVE_LANES'));
});

test('operator priority outranks ordinary score', () => {
  const result = buildMissionScheduler({
    now: NOW,
    goals: [goal(1, { priority: 100 }), goal(2, { operatorPriority: true, priority: 1 })],
  });
  assert.equal(result.selectedGoal, '#2');
});

test('duplicate and superseded work is not selected', () => {
  const result = buildMissionScheduler({
    now: NOW,
    goals: [goal(1, { duplicateOf: 10, priority: 100 }), goal(2, { supersededBy: 11, priority: 100 }), goal(3)],
  });
  assert.equal(result.selectedGoal, '#3');
  assert.equal(result.portfolio[0].lifecycle, 'DUPLICATE');
  assert.equal(result.portfolio[1].lifecycle, 'SUPERSEDED');
});

test('stale evidence is reported as stale and not selected', () => {
  const result = buildMissionScheduler({
    now: NOW,
    goals: [goal(1, { evidenceAt: '2026-07-24T19:00:00.000Z' })],
  });
  assert.equal(result.portfolio[0].evidenceFreshness, 'STALE');
  assert.equal(result.portfolio[0].lifecycle, 'STALLED');
  assert.equal(result.selectedGoal, null);
});

test('runtime-required work routes away from GitHub-only execution', () => {
  const result = buildMissionScheduler({
    now: NOW,
    goals: [goal(1, { route: 'BATTLE_BRIDGE_FIXED_TEST' })],
  });
  assert.equal(result.selectedRoute, 'BATTLE_BRIDGE_FIXED_TEST');
});

test('approval route asks the operator and no-action state remains explicit', () => {
  const approval = buildMissionScheduler({ now: NOW, goals: [goal(1, { route: 'OPERATOR_APPROVAL' })] });
  assert.equal(approval.operatorNeeded, true);
  assert.equal(approval.operatorAction, 'OPERATOR_APPROVAL_REQUIRED');

  const ordinary = buildMissionScheduler({ now: NOW, goals: [goal(2)] });
  assert.equal(ordinary.operatorAction, 'NO_OPERATOR_ACTION_REQUIRED');
});

test('chat query returns current lane rationale without guessing', () => {
  const answer = answerMissionQuery({
    now: NOW,
    proofRefs: ['receipt-1601'],
    goals: [goal(1, { state: 'ACTIVE', activePr: 1601 })],
  }, 'what is going on');
  assert.equal(answer.programmeStatus, 'IN_PROGRESS');
  assert.equal(answer.activeGoal, '#1');
  assert.equal(answer.activeLane, 'PR #1601');
  assert.equal(answer.operatorAction, 'NO_OPERATOR_ACTION_REQUIRED');
  assert.deepEqual(answer.proofRefs, ['receipt-1601']);
});
