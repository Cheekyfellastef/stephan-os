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
    sourceTruth: 'live',
    heartbeat: { backendLive: true },
    importedGoals: { verificationState: 'none', candidates: [] },
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

test('builds bounded Project Intelligence grounding from verified live goal truth', () => {
  const result = buildProjectIntelligenceGrounding({
    prompt: 'Why is project intelligence blocked?',
    liveGoalProjection: liveProjection(),
  });
  assert.equal(result.available, true);
  assert.equal(result.truthState, 'live-verified');
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

test('does not promote mixed or static fallback projection state to proven facts', () => {
  for (const sourceTruth of ['mixed', 'static-fallback']) {
    const result = buildProjectIntelligenceGrounding({
      prompt: 'What is the current status?',
      liveGoalProjection: liveProjection({ sourceTruth }),
    });
    assert.equal(result.truthState, 'unverified');
    assert.equal(result.finalVerdict, 'PROJECT_INTELLIGENCE_GROUNDING_UNVERIFIED');
    assert.equal(result.answer.provenFacts.length, 0);
    assert.ok(result.answer.hypotheses.length > 0);
    assert.equal(result.answer.nextActions.length, 0);
  }
});

test('keeps imported_unverified goal state out of proven facts while preserving verified native goals', () => {
  const imported = { candidateId: '#1776', title: 'Imported product goal', status: 'QUEUED' };
  const result = buildProjectIntelligenceGrounding({
    prompt: 'goal',
    liveGoalProjection: liveProjection({
      importedGoals: { verificationState: 'imported_unverified', candidates: [imported] },
      queuedCandidates: [
        imported,
        { candidateId: '#1308', title: 'Native verified project intelligence goal', status: 'QUEUED' },
      ],
      activeProofLane: [],
      blockedCandidates: [],
      blockers: [],
    }),
  });
  assert.ok(result.answer.provenFacts.some((fact) => fact.includes('#1308')));
  assert.ok(result.answer.hypotheses.some((fact) => fact.includes('#1776')));
  assert.ok(!result.answer.provenFacts.some((fact) => fact.includes('#1776')));
});

test('deduplicates queued candidates behind blocked and active canonical state', () => {
  const active = { candidateId: '#1308', title: 'Project Intelligence', status: 'ACTIVE' };
  const blocked = { candidateId: '#1556', title: 'Mission Scheduler', status: 'BLOCKED' };
  const result = buildProjectIntelligenceGrounding({
    prompt: 'goal status',
    liveGoalProjection: liveProjection({
      activeProofLane: [active],
      blockedCandidates: [blocked],
      queuedCandidates: [
        active,
        blocked,
        { candidateId: '#1776', title: 'Product programme', status: 'QUEUED' },
      ],
      blockers: [],
    }),
  });
  const facts = result.answer.provenFacts.join(' | ');
  assert.match(facts, /#1308.*ACTIVE/);
  assert.match(facts, /#1556.*BLOCKED/);
  assert.match(facts, /#1776.*QUEUED/);
  assert.doesNotMatch(facts, /#1308.*QUEUED/);
  assert.doesNotMatch(facts, /#1556.*QUEUED/);
});
