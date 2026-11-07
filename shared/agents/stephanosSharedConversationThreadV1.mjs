import { createHash } from 'node:crypto';

import {
  DEFAULT_STALE_AFTER_MS,
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

export const STEPHANOS_SHARED_CONVERSATION_THREAD_SCHEMA_VERSION =
  'stephanos.shared-conversation-thread.v1';
export const STEPHANOS_SHARED_CONVERSATION_CHANNEL = 'shared-stephanos-chat';
export const STEPHANOS_SHARED_CONVERSATION_SUBTYPE = 'conversation-turn';
export const STEPHANOS_SHARED_CONVERSATION_PARTICIPANTS = Object.freeze([
  'operator',
  'chatgpt-bridge',
  'stephanos',
]);

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const MAX_TURN_TEXT = 6000;
const MAX_TURNS = 256;
const SECRET_SHAPED_TEXT =
  /(?:BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY|xox[baprs]-|gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,}|(?:password|api[_-]?key|access[_-]?token)\s*[:=]\s*\S+)/i;
const BODY_KEYS = Object.freeze([
  'schemaVersion',
  'subtype',
  'threadId',
  'turnId',
  'senderParticipantId',
  'replyToTurnId',
  'text',
  'visibleToParticipantIds',
]);
const RECORD_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'messageId',
  'participantId',
  'timestampUtc',
  'correlationId',
  'relatedIssue',
  'relatedPr',
  'proofRefs',
  'channel',
  'recordSubtype',
  'subjectId',
  'summary',
  'body',
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
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) ? normalized : '';
}

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
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
  });
}

function exactObject(value, expectedKeys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(descriptors).sort();
    const expected = [...expectedKeys].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return null;
    const output = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        return null;
      }
      Object.defineProperty(output, key, {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(output);
  } catch {
    return null;
  }
}

function denseStringList(value, limit = 64) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > limit) return null;
    const expectedKeys = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
    if (Object.keys(descriptors).some((key) => !expectedKeys.has(key))) return null;
    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      const normalized = text(descriptor.value);
      if (!normalized) return null;
      output.push(normalized);
    }
    return Object.freeze(output);
  } catch {
    return null;
  }
}

function canonicalParticipantList(value) {
  const list = denseStringList(value, STEPHANOS_SHARED_CONVERSATION_PARTICIPANTS.length);
  if (!list) return null;
  if (JSON.stringify(list) !== JSON.stringify(STEPHANOS_SHARED_CONVERSATION_PARTICIPANTS)) return null;
  return list;
}

function workspaceValidation(record, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const validation = validateSharedWorkspaceRecord(record, {
    nowMs,
    staleAfterMs: Number.isFinite(options.staleAfterMs) ? options.staleAfterMs : DEFAULT_STALE_AFTER_MS,
  });
  const errors = [...(validation.errors || [])];
  const recordMs = Date.parse(text(record?.timestampUtc));
  if (validation.stale) errors.push('stale-record');
  if (Number.isFinite(recordMs) && recordMs > nowMs) errors.push('future-record');
  return Object.freeze({
    valid: validation.valid && errors.length === 0,
    errors: Object.freeze([...new Set(errors)]),
    validation,
  });
}

function validateAuthorityBoundary(record) {
  const errors = [];
  for (const field of Object.keys(authorityBoundary())) {
    if (record[field] !== false) errors.push(`${field}-must-remain-false`);
  }
  return errors;
}

function parseBody(body) {
  let parsed;
  try {
    parsed = JSON.parse(text(body));
  } catch {
    return { valid: false, errors: ['conversation-body-invalid-json'], body: null };
  }
  const snapshot = exactObject(parsed, BODY_KEYS);
  if (!snapshot) return { valid: false, errors: ['conversation-body-shape-mismatch'], body: null };

  const errors = [];
  if (snapshot.schemaVersion !== STEPHANOS_SHARED_CONVERSATION_THREAD_SCHEMA_VERSION) {
    errors.push('conversation-body-schema-version-mismatch');
  }
  if (snapshot.subtype !== STEPHANOS_SHARED_CONVERSATION_SUBTYPE) {
    errors.push('conversation-body-subtype-mismatch');
  }
  const threadId = safeId(snapshot.threadId);
  const turnId = safeId(snapshot.turnId);
  const senderParticipantId = safeId(snapshot.senderParticipantId);
  const replyToTurnId = text(snapshot.replyToTurnId);
  const turnText = text(snapshot.text);
  const visibleToParticipantIds = canonicalParticipantList(snapshot.visibleToParticipantIds);

  if (!threadId) errors.push('threadId-invalid');
  if (!turnId) errors.push('turnId-invalid');
  if (!STEPHANOS_SHARED_CONVERSATION_PARTICIPANTS.includes(senderParticipantId)) {
    errors.push('senderParticipantId-not-allowed');
  }
  if (replyToTurnId && !safeId(replyToTurnId)) errors.push('replyToTurnId-invalid');
  if (!turnText) errors.push('turn-text-required');
  if (turnText.length > MAX_TURN_TEXT) errors.push('turn-text-too-large');
  if (SECRET_SHAPED_TEXT.test(turnText)) errors.push('turn-text-secret-shaped');
  if (!visibleToParticipantIds) errors.push('visibleToParticipantIds-must-be-canonical');

  return {
    valid: errors.length === 0,
    errors,
    body: errors.length === 0
      ? Object.freeze({
          ...snapshot,
          threadId,
          turnId,
          senderParticipantId,
          replyToTurnId,
          text: turnText,
          visibleToParticipantIds,
        })
      : null,
  };
}

function proofRefs(value) {
  return denseStringList(value, 64) || Object.freeze([]);
}

export function createStephanosSharedConversationTurnRecord(turn = {}, options = {}) {
  const threadId = safeId(turn.threadId);
  const turnId = safeId(turn.turnId);
  const senderParticipantId = safeId(turn.senderParticipantId);
  const replyToTurnId = text(turn.replyToTurnId);
  const turnText = text(turn.text);
  const timestampUtc = text(turn.timestampUtc);
  const relatedIssue = text(options.relatedIssue || '#1290');
  const relatedPr = text(options.relatedPr);
  const suppliedProofRefs = proofRefs(options.proofRefs);

  const errors = [];
  if (!threadId) errors.push('threadId-invalid');
  if (!turnId) errors.push('turnId-invalid');
  if (!STEPHANOS_SHARED_CONVERSATION_PARTICIPANTS.includes(senderParticipantId)) {
    errors.push('senderParticipantId-not-allowed');
  }
  if (replyToTurnId && !safeId(replyToTurnId)) errors.push('replyToTurnId-invalid');
  if (!turnText) errors.push('turn-text-required');
  if (turnText.length > MAX_TURN_TEXT) errors.push('turn-text-too-large');
  if (SECRET_SHAPED_TEXT.test(turnText)) errors.push('turn-text-secret-shaped');
  if (!timestampUtc || !Number.isFinite(Date.parse(timestampUtc))) errors.push('timestampUtc-invalid');
  if (!relatedIssue && !relatedPr) errors.push('related-issue-or-pr-required');
  if (suppliedProofRefs.length === 0) errors.push('proofRefs-required-from-caller');

  if (errors.length > 0) {
    return Object.freeze({
      valid: false,
      record: null,
      errors: Object.freeze(errors),
      authority: authorityBoundary(),
    });
  }

  const body = JSON.stringify({
    schemaVersion: STEPHANOS_SHARED_CONVERSATION_THREAD_SCHEMA_VERSION,
    subtype: STEPHANOS_SHARED_CONVERSATION_SUBTYPE,
    threadId,
    turnId,
    senderParticipantId,
    replyToTurnId,
    text: turnText,
    visibleToParticipantIds: [...STEPHANOS_SHARED_CONVERSATION_PARTICIPANTS],
  });

  const record = Object.freeze({
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.MESSAGE,
    messageId: `shared-turn-${hash(JSON.stringify({ threadId, turnId, senderParticipantId, turnText })).slice(0, 24)}`,
    participantId: senderParticipantId,
    timestampUtc,
    correlationId: threadId,
    relatedIssue,
    relatedPr,
    proofRefs: suppliedProofRefs,
    channel: STEPHANOS_SHARED_CONVERSATION_CHANNEL,
    recordSubtype: STEPHANOS_SHARED_CONVERSATION_SUBTYPE,
    subjectId: turnId,
    summary: `Shared conversation turn ${turnId} from ${senderParticipantId}`,
    body,
    ...authorityBoundary(),
  });

  const workspace = workspaceValidation(record, options.workspaceValidationOptions || {});
  return Object.freeze({
    valid: workspace.valid,
    record: workspace.valid ? record : null,
    errors: Object.freeze(workspace.errors.map((error) => `workspace:${error}`)),
    workspaceValidation: workspace.validation,
    authority: authorityBoundary(),
  });
}

export function decodeStephanosSharedConversationTurnRecord(record, options = {}) {
  const safeRecord = exactObject(record, RECORD_KEYS);
  if (!safeRecord) {
    return Object.freeze({
      valid: false,
      turn: null,
      errors: Object.freeze(['record-shape-mismatch']),
      authority: authorityBoundary(),
    });
  }

  const errors = [];
  const refs = denseStringList(safeRecord.proofRefs, 64);
  if (!refs) errors.push('proofRefs-invalid');
  const workspace = workspaceValidation(safeRecord, options.workspaceValidationOptions || {});
  errors.push(...workspace.errors.map((error) => `workspace:${error}`));
  if (safeRecord.kind !== SHARED_WORKSPACE_RECORD_KINDS.MESSAGE) errors.push('record-kind-mismatch');
  if (safeRecord.channel !== STEPHANOS_SHARED_CONVERSATION_CHANNEL) errors.push('channel-mismatch');
  if (safeRecord.recordSubtype !== STEPHANOS_SHARED_CONVERSATION_SUBTYPE) errors.push('record-subtype-mismatch');
  errors.push(...validateAuthorityBoundary(safeRecord));

  const parsed = parseBody(safeRecord.body);
  errors.push(...parsed.errors);

  if (parsed.body) {
    if (safeRecord.participantId !== parsed.body.senderParticipantId) errors.push('sender-participant-lineage-mismatch');
    if (safeRecord.correlationId !== parsed.body.threadId) errors.push('thread-lineage-mismatch');
    if (safeRecord.subjectId !== parsed.body.turnId) errors.push('turn-lineage-mismatch');
  }

  return Object.freeze({
    valid: errors.length === 0,
    turn: errors.length === 0
      ? Object.freeze({
          threadId: parsed.body.threadId,
          turnId: parsed.body.turnId,
          senderParticipantId: parsed.body.senderParticipantId,
          replyToTurnId: parsed.body.replyToTurnId,
          text: parsed.body.text,
          visibleToParticipantIds: parsed.body.visibleToParticipantIds,
          timestampUtc: safeRecord.timestampUtc,
          messageId: safeRecord.messageId,
          relatedIssue: safeRecord.relatedIssue,
          relatedPr: safeRecord.relatedPr,
          proofRefs: refs,
        })
      : null,
    errors: Object.freeze([...new Set(errors)]),
    authority: authorityBoundary(),
  });
}

export function buildStephanosSharedConversationThread(turnRecords, options = {}) {
  if (!Array.isArray(turnRecords) || Object.getPrototypeOf(turnRecords) !== Array.prototype) {
    return Object.freeze({
      valid: false,
      classification: 'SHARED_CONVERSATION_THREAD_REJECTED',
      errors: Object.freeze(['turnRecords-must-be-array']),
      thread: null,
      authority: authorityBoundary(),
    });
  }
  if (turnRecords.length === 0 || turnRecords.length > MAX_TURNS) {
    return Object.freeze({
      valid: false,
      classification: 'SHARED_CONVERSATION_THREAD_REJECTED',
      errors: Object.freeze(['turnRecords-count-invalid']),
      thread: null,
      authority: authorityBoundary(),
    });
  }

  const decoded = turnRecords.map((record) => decodeStephanosSharedConversationTurnRecord(record, options));
  const decodeErrors = decoded.flatMap((result, index) => result.errors.map((error) => `turn[${index}]:${error}`));
  if (decodeErrors.length > 0) {
    return Object.freeze({
      valid: false,
      classification: 'SHARED_CONVERSATION_THREAD_REJECTED',
      errors: Object.freeze(decodeErrors),
      thread: null,
      authority: authorityBoundary(),
    });
  }

  const turns = decoded.map((result) => result.turn);
  const threadId = safeId(options.threadId || turns[0].threadId);
  const errors = [];
  if (!threadId) errors.push('threadId-invalid');
  if (turns.some((turn) => turn.threadId !== threadId)) errors.push('mixed-thread-lineage');

  const messageIds = new Set();
  const turnIds = new Set();
  for (const turn of turns) {
    if (messageIds.has(turn.messageId)) errors.push(`duplicate-messageId:${turn.messageId}`);
    if (turnIds.has(turn.turnId)) errors.push(`duplicate-turnId:${turn.turnId}`);
    messageIds.add(turn.messageId);
    turnIds.add(turn.turnId);
  }

  const ordered = [...turns].sort((left, right) => {
    const delta = Date.parse(left.timestampUtc) - Date.parse(right.timestampUtc);
    return delta || left.turnId.localeCompare(right.turnId);
  });
  const seenTurns = new Set();
  for (const turn of ordered) {
    if (turn.replyToTurnId && !seenTurns.has(turn.replyToTurnId)) {
      errors.push(`reply-target-not-earlier:${turn.turnId}:${turn.replyToTurnId}`);
    }
    seenTurns.add(turn.turnId);
  }

  if (errors.length > 0) {
    return Object.freeze({
      valid: false,
      classification: 'SHARED_CONVERSATION_THREAD_REJECTED',
      errors: Object.freeze([...new Set(errors)]),
      thread: null,
      authority: authorityBoundary(),
    });
  }

  const participantState = Object.freeze(Object.fromEntries(
    STEPHANOS_SHARED_CONVERSATION_PARTICIPANTS.map((participantId) => {
      const participantTurns = ordered.filter((turn) => turn.senderParticipantId === participantId);
      return [participantId, Object.freeze({
        turnCount: participantTurns.length,
        lastTurnAtUtc: participantTurns.at(-1)?.timestampUtc || '',
      })];
    }),
  ));

  return Object.freeze({
    valid: true,
    classification: 'SHARED_CONVERSATION_THREAD_READY',
    errors: Object.freeze([]),
    thread: Object.freeze({
      schemaVersion: STEPHANOS_SHARED_CONVERSATION_THREAD_SCHEMA_VERSION,
      threadId,
      participantIds: STEPHANOS_SHARED_CONVERSATION_PARTICIPANTS,
      participantState,
      turnCount: ordered.length,
      transcript: Object.freeze(ordered.map((turn) => Object.freeze({
        turnId: turn.turnId,
        senderParticipantId: turn.senderParticipantId,
        replyToTurnId: turn.replyToTurnId,
        timestampUtc: turn.timestampUtc,
        text: turn.text,
        proofRefs: turn.proofRefs,
      }))),
      lastTurnAtUtc: ordered.at(-1)?.timestampUtc || '',
    }),
    authority: authorityBoundary(),
  });
}
