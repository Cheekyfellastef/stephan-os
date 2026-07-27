import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionScheduler } from './missionScheduler.mjs';

const NOW = '2026-07-24T21:00:00.000Z';
const FRESH = '2026-07-24T20:55:00.000Z';

function goal(issue, prerequisites = []) {
  return {
    issue,
    title: `Goal ${issue}`,
    state: 'QUEUED',
    prerequisites,
    priority: 1,
    criticalPathWeight: 1,
    reversibility: 'HIGH',
    route: 'CHATGPT_GITHUB',
    evidenceAt: FRESH,
  };
}

test('oversized prerequisite arrays fail closed before normalization', () => {
  const prerequisites = Array.from({ length: 1001 }, (_, index) => index + 2);
  const result = buildMissionScheduler({ now: NOW, goals: [goal(1, prerequisites)] });

  assert.equal(result.failClosed, true);
  assert.equal(result.programmeStatus, 'BLOCKED');
  assert.equal(result.selectedGoal, null);
  assert.deepEqual(result.nextEligible, []);
  assert.equal(result.portfolio[0].prerequisiteBoundExceeded, true);
  assert.equal(result.portfolio[0].suppliedPrerequisiteCount, 1001);
  assert.ok(result.contradictions.some(({ code, maximumPrerequisiteCount }) =>
    code === 'PREREQUISITE_BOUND_EXCEEDED' && maximumPrerequisiteCount === 1000));
});

test('iterative cycle detection handles the maximum bounded chain', () => {
  const goals = Array.from({ length: 1000 }, (_, index) => goal(index + 1, index === 999 ? [] : [index + 2]));
  const result = buildMissionScheduler({ now: NOW, goals });

  assert.equal(result.failClosed, false);
  assert.equal(result.programmeStatus, 'READY_TO_ADVANCE');
  assert.equal(result.selectedGoal, '#1000');
});
