import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  DEFAULT_STALE_AFTER_MS,
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  ensureSharedWorkspaceLayout,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
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

function inspectStephanosWorkspaceQuestionRecord(record, options = {}) {
  const safeRecord = dataOnlyRecord(record);
  if (!safeRecord) {
    return Object.freeze({ valid: false, record: null, question: null, lineage: null, errors: Object.freeze(['record-invalid']) });
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

  let selected = null;
  if (payload) {
    selected = validateStephanosWorkspaceQuestionByLineage(safeRecord, payload, options);
    errors.push(...selected.errors.map((error) => `question:${error}`));
    if (safeRecord.participantId !== payload.askerParticipantId) errors.push('asker-participant-lineage-mismatch');
    if (safeRecord.recipientParticipantId !== payload.targetParticipantId) errors.push('target-participant-lineage-mismatch');
    if (safeRecord.subjectId !== payload.questionId) errors.push('question-lineage-mismatch');
  }

  const unique = Object.freeze([...new Set(errors)]);
  return Object.freeze({
    valid: unique.length === 0,
    record: unique.length === 0 ? Object.freeze(safeRecord) : null,
    question: unique.length === 0 ? (selected?.question || payload) : null,
    lineage: unique.length === 0 ? selected?.lineage || null : null,
    errors: unique,
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
  const inspected = inspectStephanosWorkspaceQuestionRecord(record, options);
  if (!inspected.valid) {
    return Object.freeze({ valid: false, question: null, errors: inspected.errors });
  }
  if (inspected.lineage?.ambient !== true) {
    return Object.freeze({ valid: false, question: null, errors: Object.freeze(['ambient-lineage-required']) });
  }
  return Object.freeze({ valid: true, question: inspected.question, errors: Object.freeze([]) });
}

export async function persistStephanosWorkspaceQuestionRecord(rootInput, record, options = {}) {
  const inspected = inspectStephanosWorkspaceQuestionRecord(record, options);
  if (!inspected.valid) {
    return Object.freeze({ ok: false, reason: inspected.errors[0] || 'record-invalid', errors: inspected.errors, record: null, question: null, lineage: null });
  }

  const nowMs = Number.isFinite(options.workspaceValidationOptions?.nowMs)
    ? options.workspaceValidationOptions.nowMs
    : Date.now();
  const validation = validateSharedWorkspaceRecord(inspected.record, { nowMs, staleAfterMs: DEFAULT_STALE_AFTER_MS });
  if (!validation.valid || validation.stale) {
    const reason = validation.errors[0] || (validation.stale ? 'stale-record' : 'workspace-record-invalid');
    return Object.freeze({ ok: false, reason, errors: Object.freeze([reason]), record: null, question: null, lineage: null });
  }

  const layout = await ensureSharedWorkspaceLayout({ root: rootInput, repoRoot: options.repoRoot });
  if (!layout.ok) {
    return Object.freeze({ ok: false, reason: layout.reason, errors: Object.freeze([layout.reason]), record: null, question: null, lineage: null });
  }

  const write = await writeAtomicJson(
    layout.root,
    ['inbox', `${inspected.record.messageId}.json`],
    inspected.record,
    { repoRoot: options.repoRoot, nowMs, staleAfterMs: DEFAULT_STALE_AFTER_MS },
  );
  if (!write.ok) {
    return Object.freeze({ ok: false, reason: write.reason, errors: Object.freeze([write.reason]), record: null, question: null, lineage: null, write });
  }

  return Object.freeze({
    ok: true,
    reason: 'STEPHANOS_WORKSPACE_QUESTION_PERSISTED',
    record: inspected.record,
    question: inspected.question,
    lineage: inspected.lineage,
    write,
  });
}

export async function readPersistedStephanosWorkspaceQuestionRecord(rootInput, messageId, options = {}) {
  const normalizedMessageId = text(messageId);
  if (!normalizedMessageId) {
    return Object.freeze({ ok: false, reason: 'messageId-required', record: null, question: null, lineage: null, errors: Object.freeze(['messageId-required']) });
  }

  const resolved = resolveSharedWorkspacePath({
    root: rootInput,
    repoRoot: options.repoRoot,
    segments: ['inbox', `${normalizedMessageId}.json`],
  });
  if (!resolved.ok) {
    return Object.freeze({ ok: false, reason: resolved.reason, record: null, question: null, lineage: null, errors: Object.freeze([resolved.reason]) });
  }

  let record = null;
  try {
    record = JSON.parse(await readFile(resolved.path, 'utf8'));
  } catch {
    return Object.freeze({ ok: false, reason: 'workspace-question-not-found', record: null, question: null, lineage: null, errors: Object.freeze(['workspace-question-not-found']) });
  }

  const inspected = inspectStephanosWorkspaceQuestionRecord(record, options);
  if (!inspected.valid) {
    return Object.freeze({ ok: false, reason: inspected.errors[0] || 'record-invalid', record: null, question: null, lineage: null, errors: inspected.errors });
  }

  return Object.freeze({
    ok: true,
    reason: 'STEPHANOS_WORKSPACE_QUESTION_READBACK_READY',
    record: inspected.record,
    question: inspected.question,
    lineage: inspected.lineage,
    errors: Object.freeze([]),
  });
}
