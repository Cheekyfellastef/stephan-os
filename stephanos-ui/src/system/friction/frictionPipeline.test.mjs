import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptSurfaceProtocolRecommendation,
  appendAcceptedSurfaceRule,
  appendFrictionEvent,
  createFrictionEvent,
  DEFAULT_PROMOTION_CONFIG,
  deriveFrictionMemoryCandidates,
  detectSurfaceFrictionPatterns,
  generateSurfaceProtocolRecommendations,
  interpretSurfaceFrictionText,
  revertAcceptedSurfaceRule,
} from './frictionPipeline.js';

test('friction interpretation produces bounded explainable classifications', () => {
  const drag = interpretSurfaceFrictionText('Dragging panels is awkward here', { surfaceProfileId: 'field-tablet' });
  assert.equal(drag.frictionType, 'panel-dragging');
  assert.equal(drag.subsystem, 'mission-console');
  assert.equal(drag.likelyProtocolMismatch, 'safari-safe-dragging');
  assert.equal(drag.noFakeCertainty, true);
  assert.equal(Array.isArray(drag.reasoning), true);
  assert.equal(typeof drag.confidence, 'number');
  assert.equal(drag.confidence <= 0.95, true);
});

test('surface friction event is stage-1 only and structured', () => {
  const event = createFrictionEvent({
    userText: 'This is too cluttered on iPad',
    surfaceProfileId: 'field-tablet',
    activeProtocolIds: ['touch-first-input'],
    sessionId: 'session-a',
    now: { toISOString: () => '2026-04-10T00:00:00.000Z' },
  });

  assert.equal(event.lifecycleStage, 'surfaceFrictionEvent');
  assert.equal(event.surfaceProfileId, 'field-tablet');
  assert.equal(event.sessionId, 'session-a');
  assert.equal(event.frictionType, 'layout-clutter');
  assert.equal(typeof event.structuredInterpretation.reasoning?.[0], 'string');
});

test('pattern detection requires explicit recurrence threshold', () => {
  const base = {
    frictionType: 'panel-dragging',
    subsystem: 'mission-console',
    surfaceProfileId: 'field-tablet',
    confidence: 0.7,
    structuredInterpretation: { reasoning: ['matched deterministic rule'] },
  };
  const events = [
    { ...base, id: 'evt-1', timestamp: '2026-04-10T00:00:01.000Z' },
    { ...base, id: 'evt-2', timestamp: '2026-04-10T00:00:02.000Z' },
  ];

  const patterns = detectSurfaceFrictionPatterns({ events, promotionConfig: DEFAULT_PROMOTION_CONFIG });
  assert.equal(patterns.length, 0);

  const promoted = detectSurfaceFrictionPatterns({
    events: [...events, { ...base, id: 'evt-3', timestamp: '2026-04-10T00:00:03.000Z' }],
  });
  assert.equal(promoted.length, 1);
  assert.equal(promoted[0].lifecycleStage, 'surfaceFrictionPattern');
  assert.equal(promoted[0].recurrenceCount, 3);
});

test('recommendations are generated only from patterns, not single events', () => {
  const emptyRecommendations = generateSurfaceProtocolRecommendations({ patterns: [] });
  assert.equal(emptyRecommendations.length, 0);

  const pattern = {
    id: 'pattern-1',
    frictionType: 'panel-dragging',
    subsystem: 'mission-console',
    surfaceProfileId: 'field-tablet',
    recurrenceCount: 3,
    aggregatedConfidence: 0.66,
    patternStrength: 'emerging',
    reasoning: ['recurrence threshold met'],
  };
  const recommendations = generateSurfaceProtocolRecommendations({ patterns: [pattern] });
  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].lifecycleStage, 'surfaceProtocolRecommendation');
  assert.equal(recommendations[0].requiresApproval, true);
});

test('approval gating and reversibility for accepted surface rules', () => {
  const recommendation = {
    id: 'rec-1',
    affectedProtocols: ['panel-dragging'],
    proposedChanges: ['Apply bounded transient adjustment'],
  };
  const accepted = acceptSurfaceProtocolRecommendation({
    recommendation,
    scope: 'session',
    operatorId: 'operator-a',
    now: { toISOString: () => '2026-04-10T00:01:00.000Z' },
  });

  assert.equal(accepted.operatorApproved, true);
  assert.equal(accepted.lifecycleStage, 'acceptedSurfaceRule');

  const rules = appendAcceptedSurfaceRule([], accepted);
  const reverted = revertAcceptedSurfaceRule(rules, accepted.id, {
    operatorId: 'operator-a',
    now: { toISOString: () => '2026-04-10T00:02:00.000Z' },
  });

  assert.equal(reverted[0].status, 'reverted');
  assert.match(reverted[0].auditTrail[reverted[0].auditTrail.length - 1], /operator reverted rule/);
});

test('friction memory integration keeps event data out of long-term eligibility', () => {
  const memory = deriveFrictionMemoryCandidates({
    patterns: [{ id: 'p-1', frictionType: 'panel-dragging', recurrenceCount: 5, patternStrength: 'strong' }],
    recommendations: [{ id: 'r-1', proposalType: 'transient-adjustment' }],
    acceptedRules: [{ id: 'rule-1', sourceRecommendationId: 'r-1', scope: 'profile' }],
  });

  assert.equal(memory.frictionEventsEligible, false);
  assert.equal(memory.patternMemories.length, 1);
  assert.equal(memory.recommendationMemories.length, 1);
  assert.equal(memory.acceptedRuleMemories.length, 1);
});

test('appendFrictionEvent keeps bounded event buffer', () => {
  let history = [];
  for (let index = 0; index < 30; index += 1) {
    history = appendFrictionEvent(history, { id: `evt-${index}` });
  }
  assert.equal(history.length, 20);
  assert.equal(history[0].id, 'evt-10');
});
