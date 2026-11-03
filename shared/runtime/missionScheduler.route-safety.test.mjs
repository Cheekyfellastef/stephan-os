import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionScheduler } from './missionScheduler.mjs';

const NOW = '2026-07-24T21:00:00.000Z';
const FRESH = '2026-07-24T20:55:00.000Z';

function completedGoal(route) {
  return {
    issue: 1,
    title: 'Completed goal',
    state: 'COMPLETE',
    prerequisites: [],
    priority: 1,
    criticalPathWeight: 1,
    reversibility: 'HIGH',
    route,
    evidenceAt: FRESH,
  };
}

test('terminal goals cannot become close-ready through unsafe or waiting routes', () => {
  for (const route of ['BLOCKED_UNSAFE_OR_UNKNOWN', 'WAITING_FOR_EXTERNAL_CONDITION', 'unrecognized-route']) {
    const result = buildMissionScheduler({ now: NOW, goals: [completedGoal(route)] });
    assert.notEqual(result.portfolio[0].lifecycle, 'CLOSE_READY');
    assert.equal(result.selectedGoal, null);
    assert.ok(['BLOCKED', 'WAITING_FOR_EXTERNAL_CONDITION'].includes(result.portfolio[0].lifecycle));
  }
});
