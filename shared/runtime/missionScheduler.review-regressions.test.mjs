import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionScheduler } from './missionScheduler.mjs';

const NOW = '2026-07-24T21:00:00.000Z';
const fresh = '2026-07-24T20:55:00.000Z';
const PROVEN_HEAD = '1111111111111111111111111111111111111111';
function goal(issue, overrides = {}) {
  return { issue, title:`Goal ${issue}`, state:'QUEUED', prerequisites:[], priority:1, criticalPathWeight:1, reversibility:'HIGH', route:'CHATGPT_GITHUB', evidenceAt:fresh, ...overrides };
}

test('supplied non-array goals evidence fails closed', () => {
  for (const goals of [{}, 'not-a-portfolio', 42, null]) {
    const result = buildMissionScheduler({ now:NOW, goals });
    assert.equal(result.failClosed, true);
    assert.equal(result.programmeStatus, 'BLOCKED');
    assert.ok(result.contradictions.some(({ code }) => code === 'INVALID_GOALS_CONTAINER'));
    assert.equal(result.decisionReceipt.status, 'BLOCKED_FAIL_CLOSED');
  }
});

test('omitted goals remains a valid empty programme', () => {
  const result = buildMissionScheduler({ now:NOW });
  assert.equal(result.failClosed, false);
  assert.equal(result.programmeStatus, 'WAITING');
});

test('merge-ready work is surfaced in the top-level projection and receipt', () => {
  const result = buildMissionScheduler({ now:NOW, proofHeadShas:[PROVEN_HEAD], goals:[goal(1556,{state:'IMPLEMENTED',proofState:'PASS',activePr:1601,headSha:PROVEN_HEAD})] });
  assert.equal(result.programmeStatus, 'MERGE_READY');
  assert.equal(result.selectedGoal, '#1556');
  assert.equal(result.selectedLifecycle, 'MERGE_READY');
  assert.equal(result.decisionReceipt.status, 'MERGE_READY');
  assert.equal(result.decisionReceipt.selectedIssue, 1556);
});

test('close-ready work is surfaced in the top-level projection and receipt', () => {
  const result = buildMissionScheduler({ now:NOW, goals:[goal(1556,{state:'COMPLETE'})] });
  assert.equal(result.programmeStatus, 'CLOSE_READY');
  assert.equal(result.selectedGoal, '#1556');
  assert.equal(result.selectedLifecycle, 'CLOSE_READY');
  assert.equal(result.decisionReceipt.status, 'CLOSE_READY');
});

test('unsafe integer issue identities and prerequisites are rejected', () => {
  const oversized = '9007199254740992';
  const result = buildMissionScheduler({ now:NOW, goals:[goal(oversized),goal(2,{prerequisites:['9007199254740993']})] });
  assert.equal(result.portfolio[0].issue, null);
  assert.equal(result.portfolio[0].lifecycle, 'BLOCKED');
  assert.deepEqual(result.portfolio[1].invalidPrerequisites, ['9007199254740993']);
  assert.equal(result.portfolio[1].lifecycle, 'BLOCKED');
  assert.equal(result.selectedGoal, null);
});
