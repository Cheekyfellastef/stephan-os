import { readFile } from 'node:fs/promises';

import {
  SHARED_WORKSPACE_RECORD_KINDS,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import { UI_AGENT_ID } from './uiAgentParticipantV1.mjs';
import {
  STEPHANOS_CONVERSATION_CANVAS_WORKSPACE_HANDOFF_RECORD_SCHEMA_VERSION,
} from './stephanosConversationCanvasWorkspaceHandoffRecordV1.mjs';

export const STEPHANOS_CONVERSATION_CANVAS_WORKSPACE_HANDOFF_PERSISTENCE_SCHEMA_VERSION =
  'stephanos.conversation-canvas-workspace-handoff-persistence.v1';

const STEPHANOS_PARTICIPANT_ID = 'stephanos';
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const REQUIRED_INPUT_ZERO_AUTHORITY_FIELDS = Object.freeze([
  'sourceMutationAllowed',
  'commandExecutionAllowed',
  'approvalAllowed',
  'mergeAllowed',
  'deploymentAllowed',
  'runtimeMutationAllowed',
  'providerSelectionAuthorityAdded',
  'presenterActionExecutionAllowed',
  'publicRelayProjectionAllowed',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function plainObject(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null ? value : null;
  } catch {
    return null;
  }
}

function sameJson(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
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

function exactZeroAuthority(authority) {
  const record = plainObject(authority);
  if (!record) return false;
  return REQUIRED_INPUT_ZERO_AUTHORITY_FIELDS.every((field) => record[field] === false);
}

function blocked(classification, errors = []) {
  return Object.freeze({
    ok: false,
    schemaVersion: STEPHANOS_CONVERSATION_CANVAS_WORKSPACE_HANDOFF_PERSISTENCE_SCHEMA_VERSION,
    classification,
    errors: Object.freeze([...new Set(errors)]),
    persisted: false,
    resumed: false,
    handoffId: '',
    workspaceSegments: null,
    publicProjection: null,
    authority: authorityBoundary(),
  });
}

async function defaultReadWorkspaceRecord({ workspaceRoot, repoRoot, segments, readFileFn = readFile }) {
  const resolved = resolveSharedWorkspacePath({ root: workspaceRoot, repoRoot, segments });
  if (!resolved.ok) return Object.freeze({ ok: false, reason: resolved.reason, record: null });
  try {
    return Object.freeze({
      ok: true,
      reason: 'WORKSPACE_RECORD_READ',
      record: JSON.parse(await readFileFn(resolved.path, 'utf8')),
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error?.code === 'ENOENT' ? 'WORKSPACE_RECORD_NOT_FOUND' : 'WORKSPACE_RECORD_READ_FAILED',
      record: null,
    });
  }
}

function validatePersistenceInput(workspaceHandoffRecord, nowMs) {
  const envelope = plainObject(workspaceHandoffRecord);
  const record = plainObject(envelope?.record);
  const segments = Array.isArray(envelope?.workspaceSegments) ? envelope.workspaceSegments.map(String) : [];
  const errors = [];

  if (!envelope) errors.push('workspace-handoff-envelope-required');
  if (envelope?.schemaVersion !== STEPHANOS_CONVERSATION_CANVAS_WORKSPACE_HANDOFF_RECORD_SCHEMA_VERSION) {
    errors.push('workspace-handoff-schema-mismatch');
  }
  if (envelope?.valid !== true || envelope?.state !== 'PRIVATE_CANVAS_WORKSPACE_HANDOFF_RECORD_READY') {
    errors.push('workspace-handoff-not-ready');
  }
  if (!exactZeroAuthority(envelope?.authority)) errors.push('workspace-handoff-authority-must-remain-zero');
  if (!record) errors.push('workspace-handoff-record-required');

  if (record) {
    const validation = validateSharedWorkspaceRecord(record, { nowMs });
    if (!validation.valid) errors.push(`workspace-record:${validation.refusalReason || 'invalid'}`);
    if (record.kind !== SHARED_WORKSPACE_RECORD_KINDS.HANDOFF) errors.push('workspace-record-kind-mismatch');
    if (
      text(record.participantId) !== STEPHANOS_PARTICIPANT_ID
      || text(record.fromParticipantId) !== STEPHANOS_PARTICIPANT_ID
      || text(record.toParticipantId) !== UI_AGENT_ID
    ) {
      errors.push('workspace-participant-lineage-mismatch');
    }
  }

  if (segments.length !== 2 || segments[0] !== 'outbox' || segments.some((segment) => !SAFE_SEGMENT.test(segment))) {
    errors.push('workspace-segments-invalid');
  }
  if (record && segments[1] !== `${text(record.handoffId)}.json`) errors.push('workspace-handoff-path-mismatch');

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze([...new Set(errors)]),
    record,
    segments: Object.freeze(segments),
  });
}

export async function persistStephanosConversationCanvasWorkspaceHandoffV1({
  workspaceRoot,
  repoRoot,
  workspaceHandoffRecord,
  nowMs = Date.now(),
  readWorkspaceRecordFn = defaultReadWorkspaceRecord,
  writeAtomicJsonFn = writeAtomicJson,
  readFileFn = readFile,
} = {}) {
  const checked = validatePersistenceInput(workspaceHandoffRecord, nowMs);
  if (!checked.valid) return blocked('PRIVATE_CANVAS_WORKSPACE_HANDOFF_REJECTED', checked.errors);

  const existing = await readWorkspaceRecordFn({
    workspaceRoot,
    repoRoot,
    segments: checked.segments,
    readFileFn,
  });

  if (existing?.ok) {
    if (!sameJson(existing.record, checked.record)) {
      return blocked('PRIVATE_CANVAS_WORKSPACE_HANDOFF_CONFLICT', ['existing-workspace-handoff-conflict']);
    }
    return Object.freeze({
      ok: true,
      schemaVersion: STEPHANOS_CONVERSATION_CANVAS_WORKSPACE_HANDOFF_PERSISTENCE_SCHEMA_VERSION,
      classification: 'PRIVATE_CANVAS_WORKSPACE_HANDOFF_ALREADY_PERSISTED',
      errors: Object.freeze([]),
      persisted: true,
      resumed: true,
      handoffId: checked.record.handoffId,
      workspaceSegments: checked.segments,
      publicProjection: Object.freeze({
        handoffId: checked.record.handoffId,
        correlationId: checked.record.correlationId,
        relatedIssue: checked.record.relatedIssue,
        relatedPr: checked.record.relatedPr,
        toParticipantId: checked.record.toParticipantId,
        bodyIncluded: false,
        rawAnswerIncluded: false,
      }),
      authority: authorityBoundary(),
    });
  }
  if (existing?.reason !== 'WORKSPACE_RECORD_NOT_FOUND') {
    return blocked('PRIVATE_CANVAS_WORKSPACE_HANDOFF_READ_FAILED', [text(existing?.reason) || 'workspace-handoff-read-failed']);
  }

  const write = await writeAtomicJsonFn(workspaceRoot, checked.segments, checked.record, {
    repoRoot,
    nowMs,
  });
  if (!write?.ok) {
    return blocked('PRIVATE_CANVAS_WORKSPACE_HANDOFF_WRITE_FAILED', [text(write?.reason) || 'workspace-handoff-write-failed']);
  }

  return Object.freeze({
    ok: true,
    schemaVersion: STEPHANOS_CONVERSATION_CANVAS_WORKSPACE_HANDOFF_PERSISTENCE_SCHEMA_VERSION,
    classification: 'PRIVATE_CANVAS_WORKSPACE_HANDOFF_PERSISTED',
    errors: Object.freeze([]),
    persisted: true,
    resumed: false,
    handoffId: checked.record.handoffId,
    workspaceSegments: checked.segments,
    publicProjection: Object.freeze({
      handoffId: checked.record.handoffId,
      correlationId: checked.record.correlationId,
      relatedIssue: checked.record.relatedIssue,
      relatedPr: checked.record.relatedPr,
      toParticipantId: checked.record.toParticipantId,
      bodyIncluded: false,
      rawAnswerIncluded: false,
    }),
    authority: authorityBoundary(),
  });
}