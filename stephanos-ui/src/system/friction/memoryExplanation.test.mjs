import test from 'node:test';
import assert from 'node:assert/strict';
import { explainStephanosMemory } from './memoryExplanation.js';

test('memory explanation summary excludes raw events and returns concise narrative', () => {
  const result = explainStephanosMemory({
    acceptedSurfaceRules: [{ id: 'rule-1', scope: 'profile', appliedProtocols: ['stacked-panels'] }],
    surfaceFrictionPatterns: [{ id: 'pattern-1', patternStrength: 'strong', frictionType: 'panel-dragging', subsystem: 'mission-console', surfaceProfileId: 'field-tablet', recurrenceCount: 5, aggregatedConfidence: 0.8 }],
    surfaceProtocolRecommendations: [{ id: 'rec-1', status: 'active', proposalType: 'protocol-adjustment', affectedProtocols: ['safari-safe-dragging'], confidence: 0.71, requiresApproval: true }],
    elevatedMemories: [{ id: 'mem-1', summary: 'Tablet users need lower density.', confidence: 0.82, sourceType: 'surface-memory' }],
  }, { mode: 'summary' });

  assert.equal(result.mode, 'summary');
  assert.equal(typeof result.text, 'string');
  assert.equal(result.categories.learnedPreferences, 1);
  assert.equal(result.categories.recurringPatterns, 1);
});

test('memory explanation supports expanded and diagnostic progressive disclosure', () => {
  const expanded = explainStephanosMemory({
    acceptedSurfaceRules: [{ id: 'rule-1', scope: 'session', appliedProtocols: ['comfortable-density'] }],
  }, { mode: 'expanded' });
  assert.equal(expanded.mode, 'expanded');
  assert.match(expanded.text, /Learned preferences/);

  const diagnostic = explainStephanosMemory({
    acceptedSurfaceRules: [{ id: 'rule-1', scope: 'global', appliedProtocols: ['telemetry-lite'] }],
  }, { mode: 'diagnostic' });
  assert.equal(diagnostic.mode, 'diagnostic');
  assert.match(diagnostic.text, /learnedPreferences/);
  assert.equal(diagnostic.diagnostic.classification, 'operator-explicit-diagnostic');
});
