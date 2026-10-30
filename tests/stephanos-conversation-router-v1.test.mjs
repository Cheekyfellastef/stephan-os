import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_CONVERSATION_ROUTER_SCHEMA_VERSION,
  routeStephanosConversationV1,
} from '../shared/agents/stephanosConversationRouterV1.mjs';

test('Everyone routes a VR telemetry question to relevant contributors while Stephanos remains responder', () => {
  const result = routeStephanosConversationV1({
    prompt: 'What did the Starfield VR telemetry show on the Battle Bridge?',
    requestedTargetId: 'everyone',
  });
  assert.equal(result.schemaVersion, STEPHANOS_CONVERSATION_ROUTER_SCHEMA_VERSION);
  assert.equal(result.responder.id, 'stephanos');
  assert.equal(result.directParticipantDispatchProven, false);
  assert.deepEqual(result.selectedContributors.map((entry) => entry.id), ['vr-agent', 'battle-bridge']);
  assert.equal(result.routeState, 'STEPHANOS_SYNTHESIS_WITH_RELEVANT_CONTRIBUTORS');
});

test('Everyone routes Flywheel questions without pretending Flywheel directly spoke', () => {
  const result = routeStephanosConversationV1({
    prompt: 'Flywheel, what did you learn and what should improve next?',
    requestedTargetId: 'everyone',
  });
  assert.equal(result.responder.label, 'Stephanos AI');
  assert.equal(result.selectedContributors[0].id, 'flywheel');
  assert.equal(result.selectedContributors[0].directReplyInAiRoute, false);
  assert.match(result.contextBlock, /Only the responder may be presented as having answered/);
});

test('explicit worker tab remains addressable but uses Stephanos synthesis until direct chat exists', () => {
  const result = routeStephanosConversationV1({
    prompt: 'What are you working on?',
    requestedTargetId: 'openclaw-local',
  });
  assert.equal(result.routeState, 'STEPHANOS_SYNTHESIS_FOR_EXPLICIT_TARGET');
  assert.equal(result.responder.id, 'stephanos');
  assert.equal(result.selectedContributors[0].availability, 'WORKER_NOT_CONVERSATIONAL');
});

test('unknown target fails soft to Stephanos rather than inventing a participant', () => {
  const result = routeStephanosConversationV1({
    prompt: 'hello',
    requestedTargetId: 'imaginary-agent',
  });
  assert.equal(result.routeState, 'UNKNOWN_TARGET_FALLBACK_TO_STEPHANOS');
  assert.equal(result.selectedContributors.length, 0);
  assert.equal(result.responder.id, 'stephanos');
});
