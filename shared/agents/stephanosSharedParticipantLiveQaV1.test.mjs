import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
} from './stephanosConversationalCapabilityLadderV1.mjs';
import {
  createStephanosWorkspaceQuestionRecord,
  decodeStephanosWorkspaceAnswerRecord,
} from './stephanosSharedWorkspaceConversationAdapterV1.mjs';
import {
  STEPHANOS_SHARED_PARTICIPANT_LIVE_QA_SCHEMA_VERSION,
  answerStephanosWorkspaceQuestionRecord,
} from './stephanosSharedParticipantLiveQaV1.mjs';

const NOW = new Date('2026-08-18T19:30:00.000Z');

function questionRecord(overrides = {}) {
  const question = {
    schemaVersion: STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
    roundId: 'live-chatgpt-to-stephanos-round-001',
    questionId: 'q-current-programme-truth',
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    questionText: 'What is the current Stephanos programme state and what evidence supports it?',
    questionClass: 'CURRENT_PROGRAMME_TRUTH',
    intentFingerprint: 'intent-current-programme-truth-001',
    noveltyRefs: [],
    contextRefs: ['goal:#1776', 'goal:#1308'],
    expectedEvidenceClass: 'CURRENT_PROGRAMME_STATE',
    createdAtUtc: NOW.toISOString(),
    ...overrides,
  };
  const built = createStephanosWorkspaceQuestionRecord(question, {
    relatedIssue: '#1308',
    proofRefs: ['proof/question-message'],
    workspaceValidationOptions: { nowMs: NOW.getTime() },
  });
  assert.equal(built.valid, true, built.errors?.join(','));
  return built.record;
}

function groundedResponse() {
  return {
    success: true,
    type: 'live_telemetry_result',
    output_text: 'The product controller is active and the current programme state is evidence-bound.',
    data: {
      liveGoalProjection: {
        schemaVersion: 'stephanos.live-goal-projection.v1',
        generatedAt: NOW.toISOString(),
        sourceTruth: 'CURRENT',
        proofTruth: { github: 'CURRENT', local: 'UNKNOWN', browser: 'UNKNOWN' },
      },
      execution_metadata: {
        freshness_integrity_preserved: true,
        retrieval_used: false,
        grounding_active_for_request: false,
      },
    },
    memory_hits: [],
    debug: { request_id: 'req-grounded-001' },
  };
}

test('valid Shared Workspace question is answered through existing Stephanos query seam and preserves correlation', async () => {
  let queryCalls = 0;
  const result = await answerStephanosWorkspaceQuestionRecord(questionRecord(), {
    now: NOW,
    queryFn: async (request) => {
      queryCalls += 1;
      assert.equal(request.routeMode, 'auto');
      assert.equal(request.fallbackEnabled, true);
      assert.equal(request.messages[0].content.includes('current Stephanos programme state'), true);
      assert.equal(request.context.surface, 'shared-participant-qa');
      return groundedResponse();
    },
  });

  assert.equal(queryCalls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, STEPHANOS_SHARED_PARTICIPANT_LIVE_QA_SCHEMA_VERSION);
  assert.equal(result.classification, 'STEPHANOS_GROUNDED_ANSWER_READY');
  assert.equal(result.answer.answerVerdict, 'ANSWERED_GROUNDED');
  assert.equal(result.answer.epistemicState, 'OBSERVED_FROM_RUNTIME_OR_PROOF');
  assert.equal(result.answer.freshness, 'FRESH');
  assert.equal(result.answer.evidenceRefs.length > 0, true);
  assert.deepEqual(result.answer.sourcesConsulted, ['live-goal-projection']);
  assert.equal(result.answerRecord.correlationId, 'live-chatgpt-to-stephanos-round-001');
  assert.equal(result.answerRecord.subjectId, 'q-current-programme-truth');
  assert.equal(result.answerRecord.participantId, 'stephanos');
  assert.equal(result.answerRecord.recipientParticipantId, 'chatgpt-bridge');

  const decoded = decodeStephanosWorkspaceAnswerRecord(result.answerRecord, {
    expectedRecipientParticipantId: 'chatgpt-bridge',
    workspaceValidationOptions: { nowMs: NOW.getTime() },
  });
  assert.equal(decoded.valid, true, decoded.errors?.join(','));
});

test('successful AI text without evidence remains partial rather than being painted grounded', async () => {
  const result = await answerStephanosWorkspaceQuestionRecord(questionRecord(), {
    now: NOW,
    queryFn: async () => ({
      success: true,
      output_text: 'I can provide a provisional answer, but this response carries no standardized grounding evidence.',
      data: { execution_metadata: { freshness_integrity_preserved: false } },
      memory_hits: [],
      debug: { request_id: 'req-partial-001' },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'STEPHANOS_PARTIAL_ANSWER_READY');
  assert.equal(result.answer.answerVerdict, 'ANSWERED_PARTIAL');
  assert.equal(result.answer.freshness, 'UNKNOWN');
  assert.deepEqual(result.answer.evidenceRefs, []);
});

test('failed existing AI route becomes an explicit buildable gap answer instead of a fake success', async () => {
  const result = await answerStephanosWorkspaceQuestionRecord(questionRecord(), {
    now: NOW,
    queryFn: async () => ({
      success: false,
      output_text: 'No provider was available.',
      error: 'provider unavailable',
      data: {},
      memory_hits: [],
      debug: { request_id: 'req-failed-001' },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'STEPHANOS_GAP_ANSWER_READY');
  assert.equal(result.answer.answerVerdict, 'GAP_TOOL_OR_DATA_ACCESS');
  assert.equal(result.answer.epistemicState, 'UNKNOWN');
  assert.equal(result.answer.cannotAnswerReason, 'provider unavailable');
  assert.deepEqual(result.answer.gapRefs, ['#1308']);
});

test('invalid or mis-targeted question fails closed before any AI call', async () => {
  let queryCalls = 0;
  const queryFn = async () => {
    queryCalls += 1;
    return groundedResponse();
  };

  const invalid = await answerStephanosWorkspaceQuestionRecord({ not: 'a conversation record' }, { now: NOW, queryFn });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.classification, 'QUESTION_RECORD_REJECTED');

  const wrongTarget = await answerStephanosWorkspaceQuestionRecord(questionRecord({ targetParticipantId: 'stephanos-vr-research' }), { now: NOW, queryFn });
  assert.equal(wrongTarget.ok, false);
  assert.equal(wrongTarget.classification, 'QUESTION_TARGET_NOT_STEPHANOS');
  assert.equal(queryCalls, 0);
});

test('secret-shaped AI output is not published into the Shared Workspace answer fabric', async () => {
  const result = await answerStephanosWorkspaceQuestionRecord(questionRecord(), {
    now: NOW,
    queryFn: async () => ({
      success: true,
      output_text: 'api_key=sk-abcdefghijklmnopqrstuvwxyz1234567890',
      data: {},
      memory_hits: [],
      debug: { request_id: 'req-secret-001' },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'AI_RESPONSE_UNSAFE_FOR_SHARED_WORKSPACE');
  assert.equal(result.answerRecord, null);
});

test('adapter adds no source, command, approval, merge, deployment, worker, scheduler, mailbox or provider-selection authority', async () => {
  const result = await answerStephanosWorkspaceQuestionRecord(questionRecord(), {
    now: NOW,
    queryFn: async () => groundedResponse(),
  });
  for (const key of [
    'sourceMutationAllowed',
    'commandExecutionAllowed',
    'approvalAllowed',
    'mergeAllowed',
    'deploymentAllowed',
    'schedulerCreationAllowed',
    'workerCreationAllowed',
    'mailboxCreationAllowed',
    'providerSelectionAuthorityAdded',
  ]) assert.equal(result[key], false, key);
});
