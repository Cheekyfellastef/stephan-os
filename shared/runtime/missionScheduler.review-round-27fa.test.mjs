import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionScheduler } from './missionScheduler.mjs';

const NOW = '2026-07-24T21:00:00.000Z';
const FRESH = '2026-07-24T20:55:00.000Z';

function completedGoal(issue, prerequisites = []) {
  return {
    issue,
    state:'COMPLETE',
    prerequisites,
    route:'CHATGPT_GITHUB',
    evidenceAt:FRESH,
    resultProofRefs:[`proof-${issue}`],
    reusableCapabilityId:`capability-${issue}`,
    sharedLessonId:`lesson-${issue}`,
  };
}

test('shared dependency subgraphs are memoized and remain bounded', () => {
  const goals = [completedGoal(1), completedGoal(2, [1])];
  for (let issue = 3; issue <= 35; issue += 1) goals.push(completedGoal(issue, [issue - 1, issue - 2]));
  goals.push({
    issue:36,
    state:'QUEUED',
    prerequisites:[35],
    route:'CHATGPT_GITHUB',
    evidenceAt:FRESH,
  });

  const started = performance.now();
  const result = buildMissionScheduler({ now:NOW, goals });
  const elapsedMs = performance.now() - started;

  assert.equal(result.failClosed, false);
  assert.equal(result.selectedGoal, '#36');
  assert.ok(elapsedMs < 1000, `scheduler took ${elapsedMs}ms`);
});

test('scheduler and evidence timestamps require an explicit timezone', () => {
  const timezoneLessNow = buildMissionScheduler({
    now:'2026-07-24T21:00:00',
    goals:[{ issue:1, state:'QUEUED', prerequisites:[], route:'CHATGPT_GITHUB', evidenceAt:FRESH }],
  });
  assert.equal(timezoneLessNow.failClosed, true);
  assert.ok(timezoneLessNow.contradictions.some(({code}) => code === 'INVALID_SCHEDULER_CLOCK'));

  const timezoneLessEvidence = buildMissionScheduler({
    now:NOW,
    goals:[{ issue:1, state:'QUEUED', prerequisites:[], route:'CHATGPT_GITHUB', evidenceAt:'2026-07-24T20:55:00' }],
  });
  assert.equal(timezoneLessEvidence.failClosed, true);
  assert.ok(timezoneLessEvidence.contradictions.some(({code}) => code === 'INVALID_EVIDENCE_TIMESTAMP'));
});

test('malformed proof references fail closed instead of being stringified', () => {
  const malformedValues = [
    { proofRefs:{ ref:'proof-1' } },
    { proofRefs:['proof-1', null] },
    { proofRefs:['proof-1', true] },
    { proofRefs:['proof-1', { ref:'proof-2' }] },
  ];

  for (const evidence of malformedValues) {
    const result = buildMissionScheduler({
      now:NOW,
      goals:[{ issue:1, state:'QUEUED', prerequisites:[], route:'CHATGPT_GITHUB', evidenceAt:FRESH }],
      ...evidence,
    });
    assert.equal(result.failClosed, true);
    assert.equal(result.selectedGoal, null);
    assert.ok(result.contradictions.some(({code}) => code === 'INVALID_PROOF_REFERENCE_EVIDENCE'));
  }
});
