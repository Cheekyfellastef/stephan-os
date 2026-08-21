import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
} from './stephanosConversationalCapabilityLadderV1.mjs';
import {
  createStephanosWorkspaceQuestionRecord,
} from './stephanosSharedWorkspaceConversationAdapterV1.mjs';
import {
  STEPHANOS_SHARED_PARTICIPANT_CONVERSATION_CANVAS_COMPOSITION_SCHEMA_VERSION,
  answerStephanosWorkspaceQuestionForConversationCanvasV1,
} from './stephanosSharedParticipantConversationCanvasCompositionV1.mjs';

const NOW = new Date('2026-08-21T00:10:00.000Z');

function questionRecord() {
  const built = createStephanosWorkspaceQuestionRecord({
    schemaVersion: STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
    roundId: 'live-chatgpt-to-stephanos-round-001',
    questionId: 'q-provider-outage-route',
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    questionText: 'What happens to Stephanos if the optional provider is unavailable?',
    questionClass: 'ARCHITECTURE_AND_RELATIONSHIPS',
    intentFingerprint: 'intent-provider-outage-route-001',
    noveltyRefs: [],
    contextRefs: ['goal:#1308', 'goal:#1898'],
    expectedEvidenceClass: 'ZERO_CODEX_CONTINUITY_EVIDENCE',
    createdAtUtc: NOW.toISOString(),
  }, {
    relatedIssue: '#1308',
    proofRefs: ['proof/provider-outage-question'],
    workspaceValidationOptions: { nowMs: NOW.getTime() },
  });
  assert.equal(built.valid, true, built.errors?.join(','));
  return built.record;
}

function groundedResponse() {
  return {
    success: true,
    output_text: 'Stephanos keeps the mission owned locally and routes optional provider loss through the qualified continuity mesh.',
    data: {
      liveGoalProjection: {
        schemaVersion: 'stephanos.live-goal-projection.v1',
        generatedAt: NOW.toISOString(),
        projectionSource: 'live-goal-projection-service',
        sourceTruth: 'live',
        backendStatus: { status: 'live', ok: true },
        heartbeat: {
          generatedAt: NOW.toISOString(),
          backendLive: true,
          projectionSource: 'live-goal-projection-service',
        },
        missionOperationsStatus: { status: 'ready' },
        proofTruth: { github: 'adapter-provided' },
      },
      execution_metadata: {
        freshness_integrity_preserved: true,
        retrieval_used: false,
        grounding_active_for_request: false,
      },
    },
    memory_hits: [],
    debug: { request_id: 'req-provider-outage-001' },
  };
}

test('real live-QA result composes directly into the existing private Conversation Canvas handoff for iPad', async () => {
  let queryCalls = 0;
  const result = await answerStephanosWorkspaceQuestionForConversationCanvasV1(questionRecord(), {
    now: NOW,
    surface: 'ipad',
    prefersReducedMotion: true,
    expandedSections: ['evidence', 'contributors'],
    queryFn: async () => {
      queryCalls += 1;
      return groundedResponse();
    },
  });

  assert.equal(queryCalls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, STEPHANOS_SHARED_PARTICIPANT_CONVERSATION_CANVAS_COMPOSITION_SCHEMA_VERSION);
  assert.equal(result.classification, 'STEPHANOS_CONVERSATION_CANVAS_HANDOFF_READY');
  assert.equal(result.richResponse.valid, true);
  assert.equal(result.canvasHandoff.valid, true);
  assert.equal(result.canvasHandoff.schemaVersion, 'stephanos.conversation-canvas-handoff.v1');
  assert.equal(result.canvasHandoff.targetPresenterSchemaVersion, 'stephanos.ui-agent.conversation-canvas-presenter.v1');
  assert.equal(result.canvasHandoff.targetPayloadField, 'conversation_canvas_view');
  assert.equal(result.canvasHandoff.surface, 'ipad');
  assert.equal(result.canvasHandoff.presenterInput.richResponse, result.richResponse);
  assert.equal(result.canvasHandoff.presenterInput.prefersReducedMotion, true);
  assert.deepEqual(result.canvasHandoff.presenterInput.expandedSections, ['evidence', 'contributors']);
  assert.equal(result.canvasHandoff.privacy.rawAnswerMayEnterPublicRelay, false);
  assert.equal(result.canvasHandoff.privacy.publicRelayProjectionAllowed, false);
  assert.equal(result.privatePresentation.persistencePerformed, false);
  assert.equal(result.privatePresentation.servedPresentationClaimed, false);
});

test('partial live-QA truth cannot be promoted to READY during Canvas composition', async () => {
  const result = await answerStephanosWorkspaceQuestionForConversationCanvasV1(questionRecord(), {
    now: NOW,
    surface: 'desktop-browser',
    state: 'READY',
    queryFn: async () => ({
      success: true,
      output_text: 'A provisional route exists, but the current response does not carry live durable system proof.',
      data: { execution_metadata: { freshness_integrity_preserved: false } },
      memory_hits: [],
      debug: { request_id: 'req-provider-outage-partial-001' },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'CONVERSATION_CANVAS_HANDOFF_BUILD_FAILED');
  assert.equal(result.answer.answerVerdict, 'ANSWERED_PARTIAL');
  assert.equal(result.richResponse.valid, true);
  assert.equal(result.canvasHandoff, null);
  assert.equal(result.errors.includes('partial-response-cannot-be-promoted-to-ready'), true);
  assert.equal(result.privatePresentation.persistencePerformed, false);
  assert.equal(result.privatePresentation.publicRelayProjectionAllowed, false);
});

test('unsupported served surface is rejected before Stephanos cognition is called', async () => {
  let queryCalls = 0;
  const result = await answerStephanosWorkspaceQuestionForConversationCanvasV1(questionRecord(), {
    now: NOW,
    surface: 'quest-headset',
    queryFn: async () => {
      queryCalls += 1;
      return groundedResponse();
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'CONVERSATION_CANVAS_SURFACE_REJECTED');
  assert.deepEqual(result.errors, ['unsupported-surface']);
  assert.equal(queryCalls, 0);
});

test('composition adds no execution, approval, merge, deployment, provider-selection, worker, scheduler or mailbox authority', async () => {
  const result = await answerStephanosWorkspaceQuestionForConversationCanvasV1(questionRecord(), {
    now: NOW,
    surface: 'iphone',
    queryFn: async () => groundedResponse(),
  });

  assert.equal(result.ok, true);
  for (const key of [
    'sourceMutationAllowed',
    'commandExecutionAllowed',
    'approvalAllowed',
    'mergeAllowed',
    'deploymentAllowed',
    'runtimeMutationAllowed',
    'schedulerCreationAllowed',
    'workerCreationAllowed',
    'mailboxCreationAllowed',
    'providerSelectionAuthorityAdded',
    'presentationExecutionAllowed',
  ]) assert.equal(result[key], false, key);
  assert.equal(result.canvasHandoff.authority.publicRelayProjectionAllowed, false);
  assert.equal(result.canvasHandoff.authority.presenterActionExecutionAllowed, false);
});
