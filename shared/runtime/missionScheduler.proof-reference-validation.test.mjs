import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionScheduler } from './missionScheduler.mjs';

const NOW = '2026-07-24T21:00:00.000Z';
const FRESH = '2026-07-24T20:55:00.000Z';

function goal(overrides = {}) {
  return {
    issue:1,
    title:'Goal 1',
    state:'COMPLETE',
    prerequisites:[],
    priority:1,
    criticalPathWeight:1,
    reversibility:'HIGH',
    route:'CHATGPT_GITHUB',
    evidenceAt:FRESH,
    resultProofRefs:['proof-ok'],
    reusableCapabilityId:'capability-1',
    sharedLessonId:'lesson-1',
    ...overrides,
  };
}

test('mixed malformed goal-level proof references fail closed', () => {
  const result = buildMissionScheduler({
    now:NOW,
    goals:[goal({ resultProofRefs:['proof-ok', null] })],
  });

  assert.equal(result.failClosed, true);
  assert.equal(result.programmeStatus, 'BLOCKED');
  assert.ok(result.contradictions.some(({ code }) => code === 'INVALID_GOAL_PROOF_REFERENCE_EVIDENCE'));
});

test('sparse top-level proof references fail closed', () => {
  const proofRefs = new Array(2);
  proofRefs[0] = 'proof-ok';
  const result = buildMissionScheduler({
    now:NOW,
    goals:[goal({ state:'QUEUED' })],
    proofRefs,
  });

  assert.equal(result.failClosed, true);
  assert.ok(result.contradictions.some(({ code }) => code === 'INVALID_PROOF_REFERENCE_EVIDENCE'));
});

test('hostile proof-reference objects are rejected without coercion', () => {
  const hostile = Object.create(null);
  const result = buildMissionScheduler({
    now:NOW,
    goals:[goal({ state:'QUEUED' })],
    proofRefs:[hostile],
  });

  assert.equal(result.failClosed, true);
  assert.ok(result.contradictions.some(({ code }) => code === 'INVALID_PROOF_REFERENCE_EVIDENCE'));
});
