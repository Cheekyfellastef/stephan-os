import {
  decodeStephanosWorkspaceAnswerRecord,
  decodeStephanosWorkspaceQuestionRecord,
} from './stephanosSharedWorkspaceConversationAdapterV1.mjs';
import {
  answerStephanosWorkspaceQuestionRecord,
} from './stephanosSharedParticipantLiveQaV1.mjs';
import {
  buildStephanosConversationCanvasHandoffV1,
} from './stephanosConversationCanvasHandoffV1.mjs';
import {
  buildStephanosConversationCanvasWorkspaceHandoffRecordV1,
} from './stephanosConversationCanvasWorkspaceHandoffRecordV1.mjs';
import {
  buildStephanosRichConversationalResponseV1,
} from './stephanosRichConversationalResponseV1.mjs';

export const STEPHANOS_SHARED_PARTICIPANT_CONVERSATION_CANVAS_COMPOSITION_SCHEMA_VERSION =
  'stephanos.shared-participant-conversation-canvas-composition.v1';

const ALLOWED_SURFACES = new Set(['desktop-browser', 'ipad', 'iphone']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function authorityBoundary() {
  return Object.freeze({
    sourceMutationAllowed: false,
    commandExecutionAllowed: false,
    approvalAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    schedulerCreationAllowed: false,
    workerCreationAllowed: false,
    mailboxCreationAllowed: false,
    providerSelectionAuthorityAdded: false,
    presentationExecutionAllowed: false,
  });
}

function blocked(classification, errors = [], answered = null) {
  return Object.freeze({
    ok: false,
    schemaVersion: STEPHANOS_SHARED_PARTICIPANT_CONVERSATION_CANVAS_COMPOSITION_SCHEMA_VERSION,
    classification,
    errors: Object.freeze([...new Set(errors)]),
    question: answered?.question || null,
    answer: answered?.answer || null,
    answerRecord: answered?.answerRecord || null,
    richResponse: answered?.richResponse || null,
    canvasHandoff: null,
    workspaceHandoffRecord: null,
    privatePresentation: Object.freeze({
      sharedWorkspacePrivateHandoffRequired: true,
      workspaceRecordReady: false,
      persistencePerformed: false,
      publicRelayProjectionAllowed: false,
      rawAnswerMayEnterPublicRelay: false,
      servedPresentationClaimed: false,
    }),
    ...authorityBoundary(),
  });
}

function composeConversationCanvasArtifacts({
  questionRecord,
  question,
  answer,
  answerRecord,
  richResponse,
  options = {},
}) {
  const surface = text(options.surface) || 'desktop-browser';
  if (!ALLOWED_SURFACES.has(surface)) {
    return blocked('CONVERSATION_CANVAS_SURFACE_REJECTED', ['unsupported-surface'], {
      question,
      answer,
      answerRecord,
      richResponse,
    });
  }

  const canvasHandoff = buildStephanosConversationCanvasHandoffV1({
    richResponse,
    surface,
    state: text(options.state),
    expandedSections: Array.isArray(options.expandedSections) ? options.expandedSections : [],
    prefersReducedMotion: options.prefersReducedMotion === true,
    statusMessage: text(options.statusMessage),
  });
  if (!canvasHandoff.valid) {
    return blocked('CONVERSATION_CANVAS_HANDOFF_BUILD_FAILED', canvasHandoff.errors, {
      question,
      answer,
      answerRecord,
      richResponse,
    });
  }

  const workspaceHandoffRecord = buildStephanosConversationCanvasWorkspaceHandoffRecordV1({
    canvasHandoff,
    correlationId: question.roundId,
    proofRefs: Array.isArray(questionRecord?.proofRefs) ? [...questionRecord.proofRefs] : [],
    timestampUtc: answer.answeredAtUtc,
    relatedIssue: text(questionRecord?.relatedIssue) || '#1308',
    relatedPr: text(questionRecord?.relatedPr),
  }, {
    nowMs: Number.isFinite(options.nowMs) ? options.nowMs : Date.parse(answer.answeredAtUtc),
  });
  if (!workspaceHandoffRecord.valid) {
    return blocked(
      'CONVERSATION_CANVAS_WORKSPACE_HANDOFF_RECORD_BUILD_FAILED',
      workspaceHandoffRecord.errors,
      { question, answer, answerRecord, richResponse },
    );
  }

  return Object.freeze({
    ok: true,
    schemaVersion: STEPHANOS_SHARED_PARTICIPANT_CONVERSATION_CANVAS_COMPOSITION_SCHEMA_VERSION,
    classification: 'STEPHANOS_CONVERSATION_CANVAS_WORKSPACE_HANDOFF_READY',
    errors: Object.freeze([]),
    question,
    answer,
    answerRecord,
    richResponse,
    canvasHandoff,
    workspaceHandoffRecord,
    privatePresentation: Object.freeze({
      sharedWorkspacePrivateHandoffRequired: true,
      workspaceRecordReady: true,
      persistencePerformed: false,
      publicRelayProjectionAllowed: false,
      rawAnswerMayEnterPublicRelay: false,
      servedPresentationClaimed: false,
      targetPresenterSchemaVersion: canvasHandoff.targetPresenterSchemaVersion,
      targetPayloadField: canvasHandoff.targetPayloadField,
      surface: canvasHandoff.surface,
      handoffId: canvasHandoff.handoffId,
      workspaceHandoffId: workspaceHandoffRecord.record.handoffId,
      workspaceSegments: workspaceHandoffRecord.workspaceSegments,
    }),
    ...authorityBoundary(),
  });
}

export function buildStephanosConversationCanvasFromPersistedQaV1(questionRecord, answerRecord, options = {}) {
  const surface = text(options.surface) || 'desktop-browser';
  if (!ALLOWED_SURFACES.has(surface)) {
    return blocked('CONVERSATION_CANVAS_SURFACE_REJECTED', ['unsupported-surface']);
  }

  const nowMs = Number.isFinite(options.nowMs)
    ? options.nowMs
    : Date.parse(text(answerRecord?.timestampUtc)) || Date.now();
  const decodedQuestion = decodeStephanosWorkspaceQuestionRecord(questionRecord, {
    workspaceValidationOptions: { nowMs },
    questionValidationOptions: options.questionValidationOptions,
  });
  if (!decodedQuestion.valid) {
    return blocked('PERSISTED_CONVERSATION_QUESTION_REJECTED', decodedQuestion.errors);
  }

  const decodedAnswer = decodeStephanosWorkspaceAnswerRecord(answerRecord, {
    expectedRecipientParticipantId: decodedQuestion.question.askerParticipantId,
    workspaceValidationOptions: { nowMs },
  });
  if (!decodedAnswer.valid) {
    return blocked('PERSISTED_CONVERSATION_ANSWER_REJECTED', decodedAnswer.errors, {
      question: decodedQuestion.question,
      answerRecord,
    });
  }

  const question = decodedQuestion.question;
  const answer = decodedAnswer.answer;
  const lineageMatches = answer.roundId === question.roundId
    && answer.questionId === question.questionId
    && text(answerRecord?.correlationId) === text(questionRecord?.correlationId)
    && text(answerRecord?.subjectId) === text(questionRecord?.subjectId)
    && text(answerRecord?.relatedIssue) === text(questionRecord?.relatedIssue)
    && text(answerRecord?.relatedPr) === text(questionRecord?.relatedPr);
  if (!lineageMatches) {
    return blocked('PERSISTED_CONVERSATION_LINEAGE_REJECTED', ['persisted-question-answer-lineage-mismatch'], {
      question,
      answer,
      answerRecord,
    });
  }

  const richResponse = buildStephanosRichConversationalResponseV1({
    question,
    answer,
    structured: options.richResponseStructured,
  });
  if (!richResponse.valid) {
    return blocked('PERSISTED_RICH_RESPONSE_BUILD_FAILED', richResponse.errors, {
      question,
      answer,
      answerRecord,
      richResponse,
    });
  }

  return composeConversationCanvasArtifacts({
    questionRecord,
    question,
    answer,
    answerRecord,
    richResponse,
    options: { ...options, surface, nowMs },
  });
}

export async function answerStephanosWorkspaceQuestionForConversationCanvasV1(questionRecord, options = {}) {
  const surface = text(options.surface) || 'desktop-browser';
  if (!ALLOWED_SURFACES.has(surface)) {
    return blocked('CONVERSATION_CANVAS_SURFACE_REJECTED', ['unsupported-surface']);
  }

  const answered = await answerStephanosWorkspaceQuestionRecord(questionRecord, options);
  if (!answered?.ok || !answered.richResponse) {
    return blocked(
      'LIVE_QA_NOT_READY_FOR_CONVERSATION_CANVAS',
      Array.isArray(answered?.errors) && answered.errors.length > 0 ? answered.errors : ['live-qa-not-ready'],
      answered,
    );
  }

  return composeConversationCanvasArtifacts({
    questionRecord,
    question: answered.question,
    answer: answered.answer,
    answerRecord: answered.answerRecord,
    richResponse: answered.richResponse,
    options: { ...options, surface },
  });
}
