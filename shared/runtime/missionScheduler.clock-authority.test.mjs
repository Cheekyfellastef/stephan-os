import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionScheduler } from './missionScheduler.mjs';

const NOW = '2026-07-24T21:00:00.000Z';
const FRESH = '2026-07-24T20:55:00.000Z';

function goal(issue) {
  return {
    issue,
    title:`Goal ${issue}`,
    state:'QUEUED',
    prerequisites:[],
    priority:1,
    criticalPathWeight:1,
    reversibility:'HIGH',
    route:'CHATGPT_GITHUB',
    evidenceAt:FRESH,
  };
}

test('coercible non-string scheduler clocks fail closed', () => {
  const invalidValues = [
    [NOW],
    { toString:() => NOW },
    new String(NOW),
    1,
    true,
  ];

  for (const now of invalidValues) {
    const result = buildMissionScheduler({ now, goals:[goal(1)] });
    assert.equal(result.failClosed, true);
    assert.equal(result.programmeStatus, 'BLOCKED');
    assert.equal(result.selectedGoal, null);
    assert.ok(result.contradictions.some(({code}) => code === 'INVALID_SCHEDULER_CLOCK'));
    assert.equal(result.decisionReceipt.status, 'BLOCKED_FAIL_CLOSED');
  }
});

test('primitive string scheduler clock remains valid', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1)] });
  assert.equal(result.failClosed, false);
  assert.equal(result.selectedGoal, '#1');
});
