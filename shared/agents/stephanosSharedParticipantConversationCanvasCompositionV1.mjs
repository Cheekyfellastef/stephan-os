import {
  answerStephanosWorkspaceQuestionRecord,
} from './stephanosSharedParticipantLiveQaV1.mjs';
import {
  buildStephanosConversationCanvasHandoffV1,
} from './stephanosConversationCanvasHandoffV1.mjs';

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
    privatePresentation: Object.freeze({
      sharedWorkspacePrivateHandoffRequired: true,
      persistencePerformed: false,
      publicRelayProjectionAllowed: false,
      rawAnswerMayEnterPublicRelay: false,
      servedPresentationClaimed: false,
    }),
    ...authorityBoundary(),
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

  const canvasHandoff = buildStephanosConversationCanvasHandoffV1({
    richResponse: answered.richResponse,
    surface,
    state: text(options.state),
    expandedSections: Array.isArray(options.expandedSections) ? options.expandedSections : [],
    prefersReducedMotion: options.prefersReducedMotion === true,
    statusMessage: text(options.statusMessage),
  });
  if (!canvasHandoff.valid) {
    return blocked('CONVERSATION_CANVAS_HANDOFF_BUILD_FAILED', canvasHandoff.errors, answered);
  }

  return Object.freeze({
    ok: true,
    schemaVersion: STEPHANOS_SHARED_PARTICIPANT_CONVERSATION_CANVAS_COMPOSITION_SCHEMA_VERSION,
    classification: 'STEPHANOS_CONVERSATION_CANVAS_HANDOFF_READY',
    errors: Object.freeze([]),
    question: answered.question,
    answer: answered.answer,
    answerRecord: answered.answerRecord,
    richResponse: answered.richResponse,
    canvasHandoff,
    privatePresentation: Object.freeze({
      sharedWorkspacePrivateHandoffRequired: true,
      persistencePerformed: false,
      publicRelayProjectionAllowed: false,
      rawAnswerMayEnterPublicRelay: false,
      servedPresentationClaimed: false,
      targetPresenterSchemaVersion: canvasHandoff.targetPresenterSchemaVersion,
      targetPayloadField: canvasHandoff.targetPayloadField,
      surface: canvasHandoff.surface,
      handoffId: canvasHandoff.handoffId,
    }),
    ...authorityBoundary(),
  });
}
