import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStephanosRichConversationalResponseV1 } from './stephanosRichConversationalResponseV1.mjs';
import {
  buildStephanosConversationCanvasHandoffV1,
  STEPHANOS_CONVERSATION_CANVAS_HANDOFF_SCHEMA_VERSION,
  STEPHANOS_CONVERSATION_CANVAS_TARGET_PAYLOAD_FIELD,
  STEPHANOS_CONVERSATION_CANVAS_TARGET_PRESENTER_SCHEMA_VERSION,
} from './stephanosConversationCanvasHandoffV1.mjs';

function richResponse({ partial = false, ambient = false } = {}) {
  const built = buildStephanosRichConversationalResponseV1({
    question: {
      ...(ambient ? {} : { roundId: 'stephanos-round-001' }),
      questionId: 'stephanos-round-001-q01',
      questionClass: 'CURRENT_PROGRAMME_TRUTH',
    },
    answer: {
      answerText: 'The current programme state is bounded by live durable evidence and exact-head proof.',
      epistemicState: 'OBSERVED_FROM_RUNTIME_OR_PROOF',
      evidenceRefs: ['receipts/live-programme-truth'],
      sourcesConsulted: ['live-goal-projection'],
      answerVerdict: partial ? 'ANSWERED_PARTIAL' : 'ANSWERED_GROUNDED',
      cannotAnswerReason: partial ? 'One provider health receipt is not fresh enough to settle the route.' : null,
    },
    ...(ambient ? { correlationId: 'ambient-canvas-001' } : {}),
  });
  assert.equal(built.valid, true, built.errors?.join(','));
  return built;
}

test('builds one private presenter handoff for the existing Conversation Canvas consumer', () => {
  const handoff = buildStephanosConversationCanvasHandoffV1({
    richResponse: richResponse(),
    surface: 'ipad',
    expandedSections: ['evidence', 'contributors'],
    prefersReducedMotion: true,
    statusMessage: 'Live durable truth is available.',
  });

  assert.equal(handoff.valid, true, handoff.errors?.join(','));
  assert.equal(handoff.schemaVersion, STEPHANOS_CONVERSATION_CANVAS_HANDOFF_SCHEMA_VERSION);
  assert.equal(handoff.state, 'PRIVATE_PRESENTATION_HANDOFF_READY');
  assert.equal(handoff.targetPresenterSchemaVersion, STEPHANOS_CONVERSATION_CANVAS_TARGET_PRESENTER_SCHEMA_VERSION);
  assert.equal(handoff.targetPayloadField, STEPHANOS_CONVERSATION_CANVAS_TARGET_PAYLOAD_FIELD);
  assert.equal(handoff.surface, 'ipad');
  assert.equal(handoff.presenterInput.state, 'READY');
  assert.deepEqual(handoff.presenterInput.expandedSections, ['evidence', 'contributors']);
  assert.equal(handoff.presenterInput.prefersReducedMotion, true);
  assert.equal(handoff.continuity.roundId, 'stephanos-round-001');
  assert.equal(handoff.continuity.questionId, 'stephanos-round-001-q01');
  assert.equal(handoff.privacy.sharedWorkspacePrivateHandoffRequired, true);
  assert.equal(handoff.privacy.rawAnswerMayEnterPublicRelay, false);
  assert.equal(handoff.privacy.publicRelayProjectionAllowed, false);
  assert.equal(handoff.authority.sourceMutationAllowed, false);
  assert.equal(handoff.authority.commandExecutionAllowed, false);
  assert.equal(handoff.authority.approvalAuthorityAdded, false);
  assert.equal(handoff.authority.presenterActionExecutionAllowed, false);
});

test('partial rich responses remain visibly partial and cannot be promoted to READY by the handoff', () => {
  const response = richResponse({ partial: true });
  const derived = buildStephanosConversationCanvasHandoffV1({ richResponse: response, surface: 'iphone' });
  assert.equal(derived.valid, true, derived.errors?.join(','));
  assert.equal(derived.presenterInput.state, 'PARTIAL');

  const promoted = buildStephanosConversationCanvasHandoffV1({
    richResponse: response,
    surface: 'iphone',
    state: 'READY',
  });
  assert.equal(promoted.valid, false);
  assert.equal(promoted.state, 'SAFE_HOLD');
  assert.deepEqual(promoted.errors, ['partial-response-cannot-be-promoted-to-ready']);
});

test('fails closed when rich-response presentation authority is widened', () => {
  const response = richResponse();
  const forged = {
    ...response,
    authority: {
      ...response.authority,
      providerSelectionAuthorityAdded: true,
    },
  };
  const handoff = buildStephanosConversationCanvasHandoffV1({ richResponse: forged });
  assert.equal(handoff.valid, false);
  assert.equal(handoff.state, 'SAFE_HOLD');
  assert.deepEqual(handoff.errors, ['rich-response-authority-must-remain-zero']);
});

test('rejects unsupported presentation surfaces without inventing another renderer', () => {
  const handoff = buildStephanosConversationCanvasHandoffV1({
    richResponse: richResponse(),
    surface: 'vr-headset',
  });
  assert.equal(handoff.valid, false);
  assert.equal(handoff.state, 'SAFE_HOLD');
  assert.deepEqual(handoff.errors, ['unsupported-surface']);
});

test('ambient canvas handoffs preserve correlation and reject mixed or accessor-bearing continuity', () => {
  const response = richResponse({ ambient: true });
  const handoff = buildStephanosConversationCanvasHandoffV1({ richResponse: response });
  assert.equal(handoff.valid, true, handoff.errors.join(','));
  assert.equal(handoff.continuity.conversationMode, 'AMBIENT');
  assert.equal(handoff.continuity.correlationId, 'ambient-canvas-001');
  assert.equal(Object.hasOwn(handoff.continuity, 'roundId'), false);
  assert.equal(handoff.privacy.rawAnswerMayEnterPublicRelay, false);
  for (const continuity of [
    { ...response.continuity, roundId: 'different-round' },
    { ...response.continuity, conversationMode: 'FORMAL_ROUND' },
    { ...response.continuity, correlationId: '' },
  ]) {
    const rejected = buildStephanosConversationCanvasHandoffV1({ richResponse: { ...response, continuity } });
    assert.equal(rejected.valid, false);
    assert.deepEqual(rejected.errors, ['continuity-identity-invalid']);
  }
  let getterCalls = 0;
  const continuity = { ...response.continuity };
  Object.defineProperty(continuity, 'correlationId', {
    enumerable: true,
    get() { getterCalls += 1; return 'ambient-canvas-001'; },
  });
  assert.equal(buildStephanosConversationCanvasHandoffV1({ richResponse: { ...response, continuity } }).valid, false);
  assert.equal(getterCalls, 0);
});
