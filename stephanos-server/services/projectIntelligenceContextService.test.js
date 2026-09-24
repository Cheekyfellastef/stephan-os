import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECT_INTELLIGENCE_GROUNDING_SCHEMA_VERSION,
  buildProjectIntelligenceGrounding,
} from './projectIntelligenceContextService.js';

function liveProjection(overrides = {}) {
  return {
    schemaVersion: 'stephanos.live-goal-projection.v1',
    generatedAt: '2026-09-24T22:55:00.000Z',
    sourceTruth: 'CURRENT',
    heartbeat: { backendLive: true },
    activeProofLane: [
      { candidateId: '#1308', title: 'Stephanos Project Intelligence & Conversational Understanding V1', status: 'ACTIVE' },
    ],
    queuedCandidates: [
      { candidateId: '#1776', title: 'Stephanos Product, Intelligence and Experience Completion V1', status: 'QUEUED' },
    ],
    blockedCandidates: [
      { candidateId: '#1556', title: 'Mission Scheduler and Goal Flywheel V1', status: 'BLOCKED' },
    ],
    blockers: ['project-intelligence-not-connected-to-canonical-ai-chat'],
    nextOperatorAction: 'Wire Project Intelligence into the canonical AI chat grounding path.',
    ...overrides,
  };
}

test('fails closed when live goal projection is unavailable', () => {
  const result = buildProjectIntelligenceGrounding({ prompt: 'status', liveGoalProjection: {} });
  assert.equal(result.schemaVersion, PROJECT_INTELLIGENCE_GROUNDING_SCHEMA_VERSION);
  assert.equal(result.available, false);
  assert.equal(result.contextBlock, '');
  assert.equal(result.finalVerdict, 'PROJECT_INTELLIGENCE_GROUNDING_UNAVAILABLE');
});

test('builds bounded Project Intelligence grounding from live goal truth', () => {
  const result = buildProjectIntelligenceGrounding({
    prompt: 'Why is project intelligence blocked?',
    liveGoalProjection: liveProjection(),
  });
  assert.equal(result.available, true);
  assert.equal(result.finalVerdict, 'PROJECT_INTELLIGENCE_GROUNDING_READY');
  assert.equal(result.answer.finalVerdict, 'PROJECT_INTELLIGENCE_ANSWER_READY');
  assert.match(result.contextBlock, /project-intelligence-not-connected-to-canonical-ai-chat/);
  assert.match(result.contextBlock, /Project Intelligence V1/);
  assert.equal(result.answer.hypotheses.length, 0);
});

test('falls back to a bounded overview when the operator question has no direct token match', () => {
  const result = buildProjectIntelligenceGrounding({
    prompt: 'Wake up.',
    liveGoalProjection: liveProjection(),
  });
  assert.equal(result.available, true);
  assert.ok(result.answer.provenFacts.length > 0);
  assert.match(result.contextBlock, /nextActions:/);
});
