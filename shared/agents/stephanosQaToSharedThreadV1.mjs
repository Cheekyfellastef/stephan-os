import {
  createStephanosSharedConversationTurnRecord,
  buildStephanosSharedConversationThread,
} from './stephanosSharedConversationThreadV1.mjs';
import {
  decodeStephanosWorkspaceAnswerRecord,
  decodeStephanosWorkspaceQuestionRecord,
} from './stephanosSharedWorkspaceConversationAdapterV1.mjs';

export const STEPHANOS_QA_TO_SHARED_THREAD_SCHEMA_VERSION =
  'stephanos.qa-to-shared-thread.v1';

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) ? normalized : '';
}

function authorityBoundary() {
  return Object.freeze({
    sourceMutationAllowed: false,
    commandExecutionAllowed: false,
    approvalAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    memoryWriteAllowed: false,
    durablePromotionAllowed: false,
    providerSelectionAuthorityAdded: false,
  });
}

function blocked(classification, errors = []) {
  return Object.freeze({
    ok: false,
    schemaVersion: STEPHANOS_QA_TO_SHARED_THREAD_SCHEMA_VERSION,
    classification,
    errors: Object.freeze([...new Set(errors)]),
    questionTurnRecord: null,
    answerTurnRecord: null,
    threadProjection: null,
    authority: authorityBoundary(),
  });
}

export function projectPersistedStephanosQaIntoSharedThreadV1(input = {}, options = {}) {
  const threadId = safeId(input.threadId);
  if (!threadId) return blocked('SHARED_THREAD_ID_REQUIRED', ['threadId-invalid']);

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const decodedQuestion = decodeStephanosWorkspaceQuestionRecord(input.questionRecord, {
    workspaceValidationOptions: { nowMs },
  });
  if (!decodedQuestion.valid) {
    return blocked(
      'PERSISTED_QA_QUESTION_REJECTED',
      decodedQuestion.errors.map((error) => `question:${error}`),
    );
  }

  const question = decodedQuestion.question;
  if (text(question.askerParticipantId) !== 'chatgpt-bridge') {
    return blocked('PERSISTED_QA_ASKER_NOT_CHATGPT', ['question-asker-must-be-chatgpt-bridge']);
  }
  if (text(question.targetParticipantId) !== 'stephanos') {
    return blocked('PERSISTED_QA_TARGET_NOT_STEPHANOS', ['question-target-must-be-stephanos']);
  }

  const decodedAnswer = decodeStephanosWorkspaceAnswerRecord(input.answerRecord, {
    expectedRecipientParticipantId: 'chatgpt-bridge',
    workspaceValidationOptions: { nowMs },
  });
  if (!decodedAnswer.valid) {
    return blocked(
      'PERSISTED_QA_ANSWER_REJECTED',
      decodedAnswer.errors.map((error) => `answer:${error}`),
    );
  }

  const answer = decodedAnswer.answer;
  const lineageErrors = [];
  if (answer.roundId !== question.roundId) lineageErrors.push('round-lineage-mismatch');
  if (answer.questionId !== question.questionId) lineageErrors.push('question-lineage-mismatch');
  if (text(answer.responderParticipantId) !== 'stephanos') lineageErrors.push('answer-responder-must-be-stephanos');
  if (lineageErrors.length) return blocked('PERSISTED_QA_LINEAGE_REJECTED', lineageErrors);

  const questionTurnId = safeId(`q-${question.roundId}-${question.questionId}`);
  const answerTurnId = safeId(`a-${answer.roundId}-${answer.answerId}`);
  if (!questionTurnId || !answerTurnId) {
    return blocked('PERSISTED_QA_TURN_ID_REJECTED', ['derived-turn-id-invalid']);
  }

  const relatedIssue = text(options.relatedIssue || input.questionRecord?.relatedIssue || '#1290');
  const relatedPr = text(options.relatedPr || input.questionRecord?.relatedPr);
  const questionProofRefs = Object.freeze([
    ...(Array.isArray(input.questionRecord?.proofRefs) ? input.questionRecord.proofRefs : []),
    `workspace-message:${text(input.questionRecord?.messageId)}`,
  ].filter(Boolean));
  const answerProofRefs = Object.freeze([
    ...(Array.isArray(input.answerRecord?.proofRefs) ? input.answerRecord.proofRefs : []),
    `workspace-message:${text(input.answerRecord?.messageId)}`,
  ].filter(Boolean));

  const questionTurn = createStephanosSharedConversationTurnRecord({
    threadId,
    turnId: questionTurnId,
    senderParticipantId: 'chatgpt-bridge',
    replyToTurnId: '',
    text: question.questionText,
    timestampUtc: question.createdAtUtc,
  }, {
    relatedIssue,
    relatedPr,
    proofRefs: questionProofRefs,
    workspaceValidationOptions: { nowMs },
  });
  if (!questionTurn.valid) {
    return blocked(
      'SHARED_THREAD_QUESTION_TURN_REJECTED',
      questionTurn.errors.map((error) => `question-turn:${error}`),
    );
  }

  const answerTurn = createStephanosSharedConversationTurnRecord({
    threadId,
    turnId: answerTurnId,
    senderParticipantId: 'stephanos',
    replyToTurnId: questionTurnId,
    text: answer.answerText,
    timestampUtc: answer.answeredAtUtc,
  }, {
    relatedIssue,
    relatedPr,
    proofRefs: answerProofRefs,
    workspaceValidationOptions: { nowMs },
  });
  if (!answerTurn.valid) {
    return blocked(
      'SHARED_THREAD_ANSWER_TURN_REJECTED',
      answerTurn.errors.map((error) => `answer-turn:${error}`),
    );
  }

  const threadProjection = buildStephanosSharedConversationThread(
    [questionTurn.record, answerTurn.record],
    {
      threadId,
      workspaceValidationOptions: { nowMs },
    },
  );
  if (!threadProjection.valid) {
    return blocked(
      'SHARED_THREAD_PROJECTION_REJECTED',
      threadProjection.errors.map((error) => `thread:${error}`),
    );
  }

  return Object.freeze({
    ok: true,
    schemaVersion: STEPHANOS_QA_TO_SHARED_THREAD_SCHEMA_VERSION,
    classification: 'PERSISTED_QA_PROJECTED_INTO_SHARED_THREAD',
    errors: Object.freeze([]),
    sourceQa: Object.freeze({
      roundId: question.roundId,
      questionId: question.questionId,
      answerId: answer.answerId,
      questionMessageId: text(input.questionRecord.messageId),
      answerMessageId: text(input.answerRecord.messageId),
    }),
    questionTurnRecord: questionTurn.record,
    answerTurnRecord: answerTurn.record,
    threadProjection: threadProjection.thread,
    authority: authorityBoundary(),
  });
}
