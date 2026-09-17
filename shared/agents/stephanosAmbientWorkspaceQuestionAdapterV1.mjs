import { createHash } from 'node:crypto';

import {
  DEFAULT_STALE_AFTER_MS,
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';
import {
  validateStephanosAmbientCapabilityQuestion,
} from './stephanosAmbientCapabilityQuestionV1.mjs';
import {
  validateStephanosWorkspaceQuestionByLineage,
} from './stephanosWorkspaceConversationLineageV1.mjs';

export const STEPHANOS_AMBIENT_WORKSPACE_QUESTION_ADAPTER_VERSION = 'stephanos.ambient-workspace-question-adapter.v1';
export const STEPHANOS_AMBIENT_WORKSPACE_QUESTION_CHANNEL = 'shared-participant-qa';
export const STEPHANOS_AMBIENT_WORKSPACE_QUESTION_SUBTYPE = 'conversation-question';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function proofRefs(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const output = values.map(text);
  if (output.some((value) => !value) || new Set(output).size !== output.length) return null;
  return Object.freeze(output);
}

function dataOnlyRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
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

export function createStephanosAmbientWorkspaceQuestionRecord(question, options = {}) {
  const validation = validateStephanosAmbientCapabilityQuestion(question, options.ambientQuestionValidationOptions);
  if (!validation.valid) {
    return Object.freeze({ valid: false, record: null, errors: Object.freeze(validation.errors.map((error) => `question:${error}`)) });
  }

  const refs = proofRefs(options.proofRefs);
  if (!refs) return Object.freeze({ valid: false, record: null, errors: Object.freeze(['proofRefs-required-from-caller']) });
  const correlationId = text(options.correlationId);
  if (!correlationId) return Object.freeze({ valid: false, record: null, errors: Object.freeze(['correlationId-required']) });
  const relatedIssue = text(options.relatedIssue || '#1721');
  const relatedPr = text(options.relatedPr);
  if (!relatedIssue && !relatedPr) return Object.freeze({ valid: false, record: null, errors: Object.freeze(['related-issue-or-pr-required']) });

  const payload = validation.question;
  const body = JSON.stringify({
    schemaVersion: 'stephanos.shared-workspace-conversation-adapter.v1',
    subtype: STEPHANOS_AMBIENT_WORKSPACE_QUESTION_SUBTYPE,
    payload,
  });
  const record = Object.freeze({
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.MESSAGE,
    messageId: `qa-q-${stableHash({ correlationId, questionId: payload.questionId, askerParticipantId: payload.askerParticipantId }).slice(0, 24)}`,
    participantId: payload.askerParticipantId,
    recipientParticipantId: payload.targetParticipantId,
    timestampUtc: payload.createdAtUtc,
    correlationId,
    relatedIssue,
    relatedPr,
    proofRefs: refs,
    channel: STEPHANOS_AMBIENT_WORKSPACE_QUESTION_CHANNEL,
    recordSubtype: STEPHANOS_AMBIENT_WORKSPACE_QUESTION_SUBTYPE,
    subjectId: payload.questionId,
    summary: `Ambient question ${payload.questionId} for ${payload.targetParticipantId}`,
    body,
    ...authorityBoundary(),
  });

  const nowMs = Number.isFinite(options.workspaceValidationOptions?.nowMs)
    ? options.workspaceValidationOptions.nowMs
    : Date.now();
  const workspace = validateSharedWorkspaceRecord(record, { nowMs, staleAfterMs: DEFAULT_STALE_AFTER_MS });
  const errors = [...(workspace.errors || [])];
  if (workspace.stale) errors.push('stale-record');
  const recordMs = Date.parse(record.timestampUtc);
  if (Number.isFinite(recordMs) && recordMs > nowMs) errors.push('future-record');
  if (errors.length > 0 || !workspace.valid) {
    return Object.freeze({ valid: false, record: null, errors: Object.freeze(errors.map((error) => `workspace:${error}`)) });
  }

  return Object.freeze({ valid: true, record, errors: Object.freeze([]), workspaceValidation: workspace });
}

export function decodeStephanosAmbientWorkspaceQuestionRecord(record, options = {}) {
  const safeRecord = dataOnlyRecord(record);
  if (!safeRecord) {
    return Object.freeze({ valid: false, question: null, errors: Object.freeze(['record-invalid']) });
  }
  const errors = [];
  if (safeRecord.channel !== STEPHANOS_AMBIENT_WORKSPACE_QUESTION_CHANNEL) errors.push('channel-mismatch');
  if (safeRecord.recordSubtype !== STEPHANOS_AMBIENT_WORKSPACE_QUESTION_SUBTYPE) errors.push('record-subtype-mismatch');
  for (const field of ['sourceMutationAllowed', 'commandExecutionAllowed', 'approvalAllowed', 'mergeAllowed', 'deploymentAllowed']) {
    if (safeRecord[field] !== false) errors.push(`${field}-must-remain-false`);
  }

  let parsed = null;
  try { parsed = JSON.parse(text(safeRecord.body)); } catch { errors.push('conversation-body-invalid-json'); }
  const payload = parsed?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) errors.push('conversation-body-payload-invalid');
  if (payload) {
    const selected = validateStephanosWorkspaceQuestionByLineage(safeRecord, payload, options);
    errors.push(...selected.errors.map((error) => `question:${error}`));
    if (selected.lineage?.ambient !== true) errors.push('ambient-lineage-required');
    if (safeRecord.participantId !== payload.askerParticipantId) errors.push('asker-participant-lineage-mismatch');
    if (safeRecord.recipientParticipantId !== payload.targetParticipantId) errors.push('target-participant-lineage-mismatch');
    if (safeRecord.subjectId !== payload.questionId) errors.push('question-lineage-mismatch');
  }
  return Object.freeze({ valid: errors.length === 0, question: errors.length === 0 ? payload : null, errors: Object.freeze([...new Set(errors)]) });
}
