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

test('aggregate prerequisite receipts report the full supplied count including oversized arrays', () => {
  const goals = [goal(1, Array.from({ length: 1001 }, (_, index) => index + 1001))];
  for (let issue = 2; issue <= 20; issue += 1) {
    goals.push(goal(issue, Array.from({ length: 1000 }, (_, index) => index + 2001)));
  }
  const result = buildMissionScheduler({ now: NOW, goals });
  const contradiction = result.contradictions.find(({ code }) => code === 'TOTAL_PREREQUISITE_BOUND_EXCEEDED');

  assert.equal(result.failClosed, true);
  assert.equal(result.programmeStatus, 'BLOCKED');
  assert.equal(contradiction?.suppliedPrerequisiteCount, 20001);
  assert.equal(contradiction?.maximumPrerequisiteCount, 10000);
});

test('cycle evidence is bounded and reports truthful DFS back-edge semantics', () => {
  const goals = Array.from({ length: 1000 }, (_, index) => goal(index + 1, [index + 1]));
  const result = buildMissionScheduler({ now: NOW, goals });
  const contradiction = result.contradictions.find(({ code }) => code === 'DEPENDENCY_CYCLE');

  assert.equal(result.failClosed, true);
  assert.equal(result.programmeStatus, 'BLOCKED');
  assert.equal(contradiction?.detectedBackEdges, 1000);
  assert.equal(contradiction?.cycleEvidenceSemantics, 'DFS_BACK_EDGES_LOWER_BOUND');
  assert.equal('cyclesTotal' in contradiction, false);
  assert.equal(contradiction?.cyclesShown, 20);
  assert.equal(contradiction?.cycles.length, 20);
  assert.ok(JSON.stringify(contradiction).length < 5000);
});

test('overlapping cycles do not mislabel DFS back edges as an exact cycle total', () => {
  const result = buildMissionScheduler({ now: NOW, goals:[
    goal(1, [2, 3]),
    goal(2, [3]),
    goal(3, [1]),
  ] });
  const contradiction = result.contradictions.find(({ code }) => code === 'DEPENDENCY_CYCLE');

  assert.equal(result.failClosed, true);
  assert.equal(contradiction?.detectedBackEdges, 1);
  assert.equal(contradiction?.cycleEvidenceSemantics, 'DFS_BACK_EDGES_LOWER_BOUND');
  assert.equal('cyclesTotal' in contradiction, false);
});

test('truncated long-cycle evidence preserves only real contiguous edges', () => {
  const goals = Array.from({ length: 1000 }, (_, index) =>
    goal(index + 1, [index === 999 ? 1 : index + 2]));
  const result = buildMissionScheduler({ now: NOW, goals });
  const contradiction = result.contradictions.find(({ code }) => code === 'DEPENDENCY_CYCLE');
  const cycle = contradiction?.cycles[0];

  assert.equal(result.failClosed, true);
  assert.equal(cycle?.truncated, true);
  assert.equal(cycle?.totalIssues, 1001);
  assert.equal(cycle?.closesTo, 1);
  assert.deepEqual(cycle?.issues, Array.from({ length: 20 }, (_, index) => index + 1));
  for (let index = 1; index < cycle.issues.length; index += 1) {
    assert.equal(cycle.issues[index], cycle.issues[index - 1] + 1);
  }
});

test('iterative cycle detection handles the maximum bounded chain', () => {
  const goals = Array.from({ length: 1000 }, (_, index) => goal(index + 1, index === 999 ? [] : [index + 2]));
  const result = buildMissionScheduler({ now: NOW, goals });

  assert.equal(result.failClosed, false);
  assert.equal(result.programmeStatus, 'READY_TO_ADVANCE');
  assert.equal(result.selectedGoal, '#1000');
});
