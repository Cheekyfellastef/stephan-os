import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionScheduler } from './missionScheduler.mjs';

const NOW = '2026-07-24T21:00:00.000Z';
const FRESH = '2026-07-24T20:55:00.000Z';

function goal(issue, prerequisite) {
  return {
    issue,
    title: `Goal ${issue}`,
    state: 'QUEUED',
    prerequisites: prerequisite ? [prerequisite] : [],
    priority: 1,
    criticalPathWeight: 1,
    reversibility: 'HIGH',
    route: 'CHATGPT_GITHUB',
    evidenceAt: FRESH,
  };
}

test('oversized deep portfolios fail closed before recursive graph traversal', () => {
  const goals = Array.from({ length: 6000 }, (_, index) => goal(index + 1, index === 5999 ? null : index + 2));
  const result = buildMissionScheduler({ now: NOW, goals });

  assert.equal(result.failClosed, true);
  assert.equal(result.programmeStatus, 'BLOCKED');
  assert.equal(result.selectedGoal, null);
  assert.deepEqual(result.nextEligible, []);
  assert.equal(result.portfolio.length, 0);
  assert.ok(result.contradictions.some(({ code, suppliedGoalCount, maximumGoalCount }) =>
    code === 'PORTFOLIO_BOUND_EXCEEDED' && suppliedGoalCount === 6000 && maximumGoalCount === 1000));
});
