import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionScheduler } from './missionScheduler.mjs';

const NOW = '2026-07-24T21:00:00.000Z';
const FRESH = '2026-07-24T20:55:00.000Z';

function goal(issue, overrides = {}) {
  return {
    issue,
    state: 'QUEUED',
    prerequisites: [],
    priority: 1,
    criticalPathWeight: 1,
    reversibility: 'HIGH',
    route: 'CHATGPT_GITHUB',
    evidenceAt: FRESH,
    ...overrides,
  };
}

test('oversized proof-head evidence fails closed before normalization', () => {
  const proofHeadShas = new Array(10001);
  const result = buildMissionScheduler({ now: NOW, goals: [goal(1)], proofHeadShas });
  const contradiction = result.contradictions.find(({ code }) => code === 'INVALID_PROOF_HEAD_EVIDENCE');

  assert.equal(result.failClosed, true);
  assert.equal(contradiction?.boundExceeded, true);
  assert.equal(contradiction?.suppliedCount, 10001);
  assert.equal(contradiction?.maximumCount, 10000);
});

test('oversized top-level proof references fail closed before iteration', () => {
  const proofRefs = new Array(10001);
  const result = buildMissionScheduler({ now: NOW, goals: [goal(1)], proofRefs });
  const contradiction = result.contradictions.find(({ code }) => code === 'INVALID_PROOF_REFERENCE_EVIDENCE');

  assert.equal(result.failClosed, true);
  assert.equal(contradiction?.boundExceeded, true);
  assert.equal(contradiction?.suppliedCount, 10001);
});

test('oversized goal proof-reference evidence fails closed before iteration', () => {
  const resultProofRefs = new Array(10001);
  const result = buildMissionScheduler({ now: NOW, goals: [goal(1, { resultProofRefs })] });
  const contradiction = result.contradictions.find(({ code }) => code === 'GOAL_PROOF_REFERENCE_EVIDENCE_BOUND_EXCEEDED');

  assert.equal(result.failClosed, true);
  assert.equal(result.portfolio[0].boundExceededFlywheelEvidence[0].suppliedCount, 10001);
  assert.equal(contradiction?.maximumCount, 10000);
});

test('hostile numeric advisory scores degrade safely without coercion', () => {
  const hostile = { valueOf() { throw new Error('must not coerce'); } };
  const result = buildMissionScheduler({
    now: NOW,
    goals: [
      goal(1, { priority: Symbol('priority'), criticalPathWeight: hostile }),
      goal(2, { priority: 1, criticalPathWeight: 1 }),
    ],
  });

  assert.equal(result.failClosed, false);
  assert.equal(result.selectedGoal, '#2');
  assert.equal(result.portfolio.find(({ issue }) => issue === 1).priority, 0);
  assert.equal(result.portfolio.find(({ issue }) => issue === 1).criticalPathWeight, 0);
});
