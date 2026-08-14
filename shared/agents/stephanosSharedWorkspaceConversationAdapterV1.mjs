import { createHash } from 'node:crypto';

import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';
import {
  evaluateStephanosCapabilityRound,
  validateStephanosCapabilityAnswer,
  validateStephanosCapabilityQuestion,
  validateStephanosCapabilityRound,
} from './stephanosConversationalCapabilityLadderV1.mjs';

export const STEPHANOS_SHARED_WORKSPACE_CONVERSATION_ADAPTER_SCHEMA_VERSION = 'stephanos.shared-workspace-conversation-adapter.v1';
export const STEPHANOS_SHARED_WORKSPACE_CONVERSATION_CHANNEL = 'shared-participant-qa';
export const STEPHANOS_SHARED_WORKSPACE_CONVERSATION_SUBTYPE = Object.freeze({
  QUESTION: 'conversation-question',
  ANSWER: 'conversation-answer',
});

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) ? normalized : '';
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function uniqueRefs(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(text).filter(Boolean))];
}

function authorityBoundary() {
  return Object.freeze({
    sourceMutationAllowed: false,
    commandExecutionAllowed: false,
    approvalAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
  });
}

function recordProofRefs(messageId, supplied = []) {
  return uniqueRefs([`receipts/${messageId}`, ...supplied]);
}

function baseConversationRecord({
  messageId,
  participantId,
  recipientParticipantId,
  timestampUtc,
  correlationId,
  relatedIssue,
  relatedPr,
  subtype,
  subjectId,
  summary,
  body,
  proofRefs,
}) {
  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.MESSAGE,
    messageId,
    participantId,
    recipientParticipantId,
    timestampUtc,
    correlationId,
    relatedIssue,
    relatedPr,
    proofRefs,
    channel: STEPHANOS_SHARED_WORKSPACE_CONVERSATION_CHANNEL,
    recordSubtype: subtype,
    subjectId,
    summary,
    body,
    ...authorityBoundary(),
  });
}

function conversationBody(subtype, payload) {
  return JSON.stringify({
    schemaVersion: STEPHANOS_SHARED_WORKSPACE_CONVERSATION_ADAPTER_SCHEMA_VERSION,
    subtype,
    payload,
  });
}

function validateAuthorityBoundary(record = {}) {
  const errors = [];
  for (const field of ['sourceMutationAllowed', 'commandExecutionAllowed', 'approvalAllowed', 'mergeAllowed', 'deploymentAllowed']) {
    if (record[field] !== false) errors.push(`${field}-must-remain-false`);
  }
  return errors;
}

function parseConversationBody(record = {}, expectedSubtype) {
  const errors = [];
  let parsed = null;
  try {
    parsed = JSON.parse(text(record.body));
  } catch {
    errors.push('conversation-body-invalid-json');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    errors.push('conversation-body-must-be-object');
    return { valid: false, errors, payload: null };
  }
  if (parsed.schemaVersion !== STEPHANOS_SHARED_WORKSPACE_CONVERSATION_ADAPTER_SCHEMA_VERSION) errors.push('conversation-body-schema-version-mismatch');
  if (parsed.subtype !== expectedSubtype) errors.push('conversation-body-subtype-mismatch');
  if (!parsed.payload || typeof parsed.payload !== 'object' || Array.isArray(parsed.payload)) errors.push('conversation-body-payload-invalid');
  return { valid: errors.length === 0, errors, payload: parsed.payload || null };
}

function workspaceValidation(record, options = {}) {
  const validation = validateSharedWorkspaceRecord(record, options.workspaceValidationOptions);
  return {
    valid: validation.valid,
    errors: validation.errors || [],
    validation,
  };
}

function roundValidationOptions(options = {}) {
  return {
    priorRoundIntentFingerprints: options.priorRoundIntentFingerprints,
  };
}

export function createStephanosWorkspaceQuestionRecord(question, options = {}) {
  const validation = validateStephanosCapabilityQuestion(question, options.questionValidationOptions);
  if (!validation.valid) {
    return Object.freeze({ valid: false, record: null, errors: Object.freeze(validation.errors.map((error) => `question:${error}`)) });
  }

  const relatedIssue = text(options.relatedIssue || '#1308');
  const relatedPr = text(options.relatedPr);
  if (!relatedIssue && !relatedPr) {
    return Object.freeze({ valid: false, record: null, errors: Object.freeze(['related-issue-or-pr-required']) });
  }

  const messageId = `qa-q-${stableHash({ roundId: question.roundId, questionId: question.questionId, askerParticipantId: question.askerParticipantId }).slice(0, 24)}`;
  const record = baseConversationRecord({
    messageId,
    participantId: question.askerParticipantId,
    recipientParticipantId: question.targetParticipantId,
    timestampUtc: question.createdAtUtc,
    correlationId: question.roundId,
    relatedIssue,
    relatedPr,
    subtype: STEPHANOS_SHARED_WORKSPACE_CONVERSATION_SUBTYPE.QUESTION,
    subjectId: question.questionId,
    summary: `Question ${question.questionId} for ${question.targetParticipantId}`,
    body: conversationBody(STEPHANOS_SHARED_WORKSPACE_CONVERSATION_SUBTYPE.QUESTION, question),
    proofRefs: recordProofRefs(messageId, options.proofRefs),
  });
  const workspace = workspaceValidation(record, options);
  return Object.freeze({
    valid: workspace.valid,
    record: workspace.valid ? record : null,
    errors: Object.freeze(workspace.errors.map((error) => `workspace:${error}`)),
    workspaceValidation: workspace.validation,
  });
}

export function createStephanosWorkspaceAnswerRecord(answer, options = {}) {
  const validation = validateStephanosCapabilityAnswer(answer);
  if (!validation.valid) {
    return Object.freeze({ valid: false, record: null, errors: Object.freeze(validation.errors.map((error) => `answer:${error}`)) });
  }
  const recipientParticipantId = safeId(options.recipientParticipantId);
  if (!recipientParticipantId) {
    return Object.freeze({ valid: false, record: null, errors: Object.freeze(['recipientParticipantId-invalid']) });
  }
  const relatedIssue = text(options.relatedIssue || '#1308');
  const relatedPr = text(options.relatedPr);
  if (!relatedIssue && !relatedPr) {
    return Object.freeze({ valid: false, record: null, errors: Object.freeze(['related-issue-or-pr-required']) });
  }

  const messageId = `qa-a-${stableHash({ roundId: answer.roundId, questionId: answer.questionId, answerId: answer.answerId }).slice(0, 24)}`;
  const record = baseConversationRecord({
    messageId,
    participantId: answer.responderParticipantId,
    recipientParticipantId,
    timestampUtc: answer.answeredAtUtc,
    correlationId: answer.roundId,
    relatedIssue,
    relatedPr,
    subtype: STEPHANOS_SHARED_WORKSPACE_CONVERSATION_SUBTYPE.ANSWER,
    subjectId: answer.questionId,
    summary: `Answer ${answer.answerId} to ${answer.questionId}`,
    body: conversationBody(STEPHANOS_SHARED_WORKSPACE_CONVERSATION_SUBTYPE.ANSWER, answer),
    proofRefs: recordProofRefs(messageId, options.proofRefs),
  });
  const workspace = workspaceValidation(record, options);
  return Object.freeze({
    valid: workspace.valid,
    record: workspace.valid ? record : null,
    errors: Object.freeze(workspace.errors.map((error) => `workspace:${error}`)),
    workspaceValidation: workspace.validation,
  });
}

export function decodeStephanosWorkspaceQuestionRecord(record, options = {}) {
  const errors = [];
  const workspace = workspaceValidation(record, options);
  if (!workspace.valid) errors.push(...workspace.errors.map((error) => `workspace:${error}`));
  if (record?.kind !== SHARED_WORKSPACE_RECORD_KINDS.MESSAGE) errors.push('record-kind-mismatch');
  if (record?.channel !== STEPHANOS_SHARED_WORKSPACE_CONVERSATION_CHANNEL) errors.push('channel-mismatch');
  if (record?.recordSubtype !== STEPHANOS_SHARED_WORKSPACE_CONVERSATION_SUBTYPE.QUESTION) errors.push('record-subtype-mismatch');
  errors.push(...validateAuthorityBoundary(record));
  const body = parseConversationBody(record, STEPHANOS_SHARED_WORKSPACE_CONVERSATION_SUBTYPE.QUESTION);
  errors.push(...body.errors);
  if (body.payload) {
    const questionValidation = validateStephanosCapabilityQuestion(body.payload, options.questionValidationOptions);
    errors.push(...questionValidation.errors.map((error) => `question:${error}`));
    if (record.participantId !== body.payload.askerParticipantId) errors.push('asker-participant-lineage-mismatch');
    if (record.recipientParticipantId !== body.payload.targetParticipantId) errors.push('target-participant-lineage-mismatch');
    if (record.correlationId !== body.payload.roundId) errors.push('round-lineage-mismatch');
    if (record.subjectId !== body.payload.questionId) errors.push('question-lineage-mismatch');
  }
  return Object.freeze({ valid: errors.length === 0, question: errors.length === 0 ? body.payload : null, errors: Object.freeze(errors) });
}

export function decodeStephanosWorkspaceAnswerRecord(record, options = {}) {
  const errors = [];
  const workspace = workspaceValidation(record, options);
  if (!workspace.valid) errors.push(...workspace.errors.map((error) => `workspace:${error}`));
  if (record?.kind !== SHARED_WORKSPACE_RECORD_KINDS.MESSAGE) errors.push('record-kind-mismatch');
  if (record?.channel !== STEPHANOS_SHARED_WORKSPACE_CONVERSATION_CHANNEL) errors.push('channel-mismatch');
  if (record?.recordSubtype !== STEPHANOS_SHARED_WORKSPACE_CONVERSATION_SUBTYPE.ANSWER) errors.push('record-subtype-mismatch');
  errors.push(...validateAuthorityBoundary(record));
  const body = parseConversationBody(record, STEPHANOS_SHARED_WORKSPACE_CONVERSATION_SUBTYPE.ANSWER);
  errors.push(...body.errors);
  if (body.payload) {
    const answerValidation = validateStephanosCapabilityAnswer(body.payload);
    errors.push(...answerValidation.errors.map((error) => `answer:${error}`));
    if (record.participantId !== body.payload.responderParticipantId) errors.push('responder-participant-lineage-mismatch');
    if (record.correlationId !== body.payload.roundId) errors.push('round-lineage-mismatch');
    if (record.subjectId !== body.payload.questionId) errors.push('question-lineage-mismatch');
  }
  return Object.freeze({ valid: errors.length === 0, answer: errors.length === 0 ? body.payload : null, errors: Object.freeze(errors) });
}

export function buildStephanosWorkspaceQuestionRound(round, options = {}) {
  const validation = validateStephanosCapabilityRound(round, roundValidationOptions(options));
  if (!validation.valid) {
    return Object.freeze({ valid: false, roundId: text(round?.roundId), records: Object.freeze([]), errors: Object.freeze(validation.errors.map((error) => `round:${error}`)) });
  }
  const records = [];
  const errors = [];
  for (const question of round.questions) {
    const built = createStephanosWorkspaceQuestionRecord(question, options);
    if (!built.valid) errors.push(...built.errors.map((error) => `${question.questionId}:${error}`));
    else records.push(built.record);
  }
  return Object.freeze({
    valid: errors.length === 0 && records.length === 10,
    roundId: round.roundId,
    records: Object.freeze(records),
    errors: Object.freeze(errors),
    authority: authorityBoundary(),
  });
}

export function evaluateStephanosWorkspaceConversation(input = {}) {
  const round = input.round;
  const roundValidation = validateStephanosCapabilityRound(round, roundValidationOptions(input));
  const errors = roundValidation.errors.map((error) => `round:${error}`);
  const answerRecords = Array.isArray(input.answerRecords) ? input.answerRecords : [];
  if (answerRecords.length !== 10) errors.push('answer-records-must-contain-exactly-10');
  const answers = [];
  for (let index = 0; index < answerRecords.length; index += 1) {
    const decoded = decodeStephanosWorkspaceAnswerRecord(answerRecords[index], input);
    if (!decoded.valid) {
      errors.push(...decoded.errors.map((error) => `answer-record-${index + 1}:${error}`));
      continue;
    }
    if (decoded.answer.roundId !== round?.roundId) errors.push(`answer-record-${index + 1}:round-mismatch`);
    if (decoded.answer.responderParticipantId !== round?.targetParticipantId) errors.push(`answer-record-${index + 1}:responder-mismatch`);
    if (answerRecords[index].recipientParticipantId !== round?.askerParticipantId) errors.push(`answer-record-${index + 1}:recipient-mismatch`);
    answers.push(decoded.answer);
  }
  if (errors.length > 0) {
    return Object.freeze({
      schemaVersion: STEPHANOS_SHARED_WORKSPACE_CONVERSATION_ADAPTER_SCHEMA_VERSION,
      valid: false,
      roundId: text(round?.roundId),
      state: 'SAFE_HOLD',
      errors: Object.freeze(errors),
      evaluation: null,
      authority: authorityBoundary(),
    });
  }
  const evaluation = evaluateStephanosCapabilityRound({
    round,
    answers,
    priorRoundIntentFingerprints: input.priorRoundIntentFingerprints,
  });
  return Object.freeze({
    schemaVersion: STEPHANOS_SHARED_WORKSPACE_CONVERSATION_ADAPTER_SCHEMA_VERSION,
    valid: evaluation.valid,
    roundId: round.roundId,
    state: evaluation.state,
    errors: Object.freeze([...(evaluation.errors || [])]),
    evaluation,
    authority: authorityBoundary(),
  });
}
