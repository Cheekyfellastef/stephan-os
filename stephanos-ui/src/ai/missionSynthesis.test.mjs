import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionSynthesis } from './missionSynthesis.js';

test('buildMissionSynthesis activates for self-build prompts and emits ranked plan', () => {
  const synthesis = buildMissionSynthesis({
    prompt: 'What should we build next to move Stephanos up the stack?',
    promptClassification: { selfBuild: { detected: true } },
    contextBundle: {
      memory: { summary: 'recent architecture work' },
      runtimeTruth: { routeKind: 'cloud' },
      operatorContext: { northStar: 'identity continuity' },
    },
    operatorContext: {
      subsystemInventory: ['memory', 'retrieval', 'knowledge-graph', 'proposal'],
    },
    contextDiagnostics: {
      sourcesUsed: ['memory', 'runtimeTruth', 'operatorContext'],
    },
    memoryElevation: {
      continuity_confidence: 'high',
      top_memory_influencers: [{ memoryClass: 'mission-critical-continuity-memory', summary: 'operator control no fake states' }],
      recurrence_signals: ['timeout truth drift (x3)'],
      memory_informed_recommendation: 'Prioritize mission-critical continuity memory first.',
    },
  });

  assert.equal(synthesis.planningIntentDetected, true);
  assert.equal(synthesis.planningMode, 'self-build-mission-synthesis');
  assert.ok(synthesis.rankedMoves.length > 0);
  assert.equal(synthesis.recommendedNextMove.moveId, synthesis.rankedMoves[0].moveId);
  assert.equal(typeof synthesis.recommendationReason, 'string');
  assert.equal(synthesis.proposalEligible, true);
  assert.match(synthesis.recommendationReason, /Memory influencers:/);
});

test('buildMissionSynthesis remains inactive for non-planning prompts', () => {
  const synthesis = buildMissionSynthesis({
    prompt: 'Explain what a transformer is in simple terms.',
    promptClassification: { selfBuild: { detected: false } },
    contextBundle: {},
    contextDiagnostics: { sourcesUsed: [] },
  });

  assert.equal(synthesis.planningIntentDetected, false);
  assert.equal(synthesis.rankedMoves.length, 0);
  assert.equal(synthesis.codexHandoffEligible, false);
});

test('buildMissionSynthesis ranking is deterministic for same evidence set', () => {
  const input = {
    prompt: 'How can the AI help build Stephanos itself?',
    promptClassification: { selfBuild: { detected: true } },
    contextBundle: {
      memory: { summary: 'memo' },
      runtimeTruth: { target: 'cloud' },
      tileContext: { activeTile: 'mission' },
    },
    operatorContext: {
      subsystemInventory: ['memory', 'tile-context'],
    },
    contextDiagnostics: {
      sourcesUsed: ['memory', 'runtimeTruth', 'tileContext'],
    },
  };

  const first = buildMissionSynthesis(input).rankedMoves.map((move) => move.moveId);
  const second = buildMissionSynthesis(input).rankedMoves.map((move) => move.moveId);
  assert.deepEqual(first, second);
});
