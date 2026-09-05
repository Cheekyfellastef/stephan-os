import {
  buildStephanosConversationCanvasFromPersistedQaV1,
} from './stephanosSharedParticipantConversationCanvasCompositionV1.mjs';
import {
  persistStephanosConversationCanvasWorkspaceHandoffV1,
} from './stephanosConversationCanvasWorkspaceHandoffPersistenceV1.mjs';

export const STEPHANOS_SHARED_PARTICIPANT_RELAY_CANVAS_PERSISTENCE_SCHEMA_VERSION =
  'stephanos.shared-participant-relay-canvas-persistence.v1';

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
    publicRelayProjectionAllowed: false,
    rawAnswerMayEnterPublicRelay: false,
  });
}

function blocked(classification, errors = [], details = {}) {
  return Object.freeze({
    ok: false,
    schemaVersion: STEPHANOS_SHARED_PARTICIPANT_RELAY_CANVAS_PERSISTENCE_SCHEMA_VERSION,
    classification,
    errors: Object.freeze([...new Set(errors)]),
    persisted: false,
    resumed: false,
    handoffId: '',
    workspaceSegments: null,
    publicProjection: null,
    privatePresentation: Object.freeze({
      workspaceRecordReady: details.workspaceRecordReady === true,
      persistencePerformed: false,
      publicRelayProjectionAllowed: false,
      rawAnswerMayEnterPublicRelay: false,
      servedPresentationClaimed: false,
    }),
    authority: authorityBoundary(),
  });
}

export async function persistStephanosConversationCanvasFromPersistedQaV1({
  questionRecord,
  answerRecord,
  workspaceRoot,
  repoRoot,
  surface = 'desktop-browser',
  state = '',
  expandedSections = [],
  prefersReducedMotion = false,
  statusMessage = '',
  nowMs,
  richResponseStructured,
  readWorkspaceRecordFn,
  writeAtomicJsonFn,
  readFileFn,
} = {}) {
  const normalizedSurface = text(surface) || 'desktop-browser';
  if (!ALLOWED_SURFACES.has(normalizedSurface)) {
    return blocked('RELAY_CANVAS_SURFACE_REJECTED', ['unsupported-surface']);
  }

  const effectiveNowMs = Number.isFinite(nowMs)
    ? nowMs
    : Date.parse(text(answerRecord?.timestampUtc)) || Date.now();

  const composition = buildStephanosConversationCanvasFromPersistedQaV1(
    questionRecord,
    answerRecord,
    {
      surface: normalizedSurface,
      state: text(state),
      expandedSections: Array.isArray(expandedSections) ? expandedSections : [],
      prefersReducedMotion: prefersReducedMotion === true,
      statusMessage: text(statusMessage),
      nowMs: effectiveNowMs,
      richResponseStructured,
    },
  );

  if (!composition?.ok || !composition.workspaceHandoffRecord?.valid) {
    return blocked(
      'RELAY_CANVAS_COMPOSITION_REJECTED',
      Array.isArray(composition?.errors) && composition.errors.length > 0
        ? composition.errors
        : ['conversation-canvas-composition-not-ready'],
    );
  }

  const persistence = await persistStephanosConversationCanvasWorkspaceHandoffV1({
    workspaceRoot,
    repoRoot,
    workspaceHandoffRecord: composition.workspaceHandoffRecord,
    nowMs: effectiveNowMs,
    readWorkspaceRecordFn,
    writeAtomicJsonFn,
    readFileFn,
  });

  if (!persistence?.ok) {
    return blocked(
      'RELAY_CANVAS_PERSISTENCE_REJECTED',
      Array.isArray(persistence?.errors) && persistence.errors.length > 0
        ? persistence.errors
        : [text(persistence?.classification) || 'conversation-canvas-persistence-failed'],
      { workspaceRecordReady: true },
    );
  }

  return Object.freeze({
    ok: true,
    schemaVersion: STEPHANOS_SHARED_PARTICIPANT_RELAY_CANVAS_PERSISTENCE_SCHEMA_VERSION,
    classification: persistence.resumed
      ? 'RELAY_CANVAS_PRIVATE_HANDOFF_ALREADY_PERSISTED'
      : 'RELAY_CANVAS_PRIVATE_HANDOFF_PERSISTED',
    errors: Object.freeze([]),
    persisted: persistence.persisted === true,
    resumed: persistence.resumed === true,
    handoffId: persistence.handoffId,
    workspaceSegments: persistence.workspaceSegments,
    publicProjection: persistence.publicProjection,
    privatePresentation: Object.freeze({
      workspaceRecordReady: true,
      persistencePerformed: true,
      publicRelayProjectionAllowed: false,
      rawAnswerMayEnterPublicRelay: false,
      servedPresentationClaimed: false,
      targetPresenterSchemaVersion: composition.canvasHandoff.targetPresenterSchemaVersion,
      targetPayloadField: composition.canvasHandoff.targetPayloadField,
      surface: composition.canvasHandoff.surface,
      handoffId: composition.canvasHandoff.handoffId,
      workspaceHandoffId: persistence.handoffId,
      continuity: Object.freeze({
        roundId: composition.question.roundId,
        questionId: composition.question.questionId,
        answerId: composition.answer.answerId,
      }),
    }),
    authority: authorityBoundary(),
  });
}
