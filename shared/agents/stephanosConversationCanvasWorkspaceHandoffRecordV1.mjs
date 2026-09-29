import { createHash } from 'node:crypto';

import {
  SHARED_WORKSPACE_RECORD_KINDS,
  createSharedWorkspaceHandoffRecord,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';
import { UI_AGENT_ID } from './uiAgentParticipantV1.mjs';
import {
  STEPHANOS_CONVERSATION_CANVAS_HANDOFF_SCHEMA_VERSION,
  STEPHANOS_CONVERSATION_CANVAS_TARGET_PAYLOAD_FIELD,
  STEPHANOS_CONVERSATION_CANVAS_TARGET_PRESENTER_SCHEMA_VERSION,
} from './stephanosConversationCanvasHandoffV1.mjs';
import { STEPHANOS_RICH_CONVERSATIONAL_RESPONSE_SCHEMA_VERSION } from './stephanosRichConversationalResponseV1.mjs';

export const STEPHANOS_CONVERSATION_CANVAS_WORKSPACE_HANDOFF_RECORD_SCHEMA_VERSION =
  'stephanos.conversation-canvas-workspace-handoff-record.v1';

const STEPHANOS_PARTICIPANT_ID = 'stephanos';
const MAX_PRIVATE_HANDOFF_BODY_BYTES = 15 * 1024;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const ALLOWED_SURFACES = new Set(['desktop-browser', 'ipad', 'iphone']);
const ALLOWED_STATES = new Set(['READY', 'PARTIAL']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function plainObject(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    return value;
  } catch {
    return null;
  }
}

function uniqueStrings(value, limit = 64) {
  if (!Array.isArray(value) || value.length > limit) return Object.freeze([]);
  const output = [];
  for (const item of value) {
    const normalized = text(item);
    if (normalized) output.push(normalized);
  }
  return Object.freeze([...new Set(output)]);
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function authorityBoundary() {
  return Object.freeze({
    sourceMutationAllowed: false,
    commandExecutionAllowed: false,
    approvalAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    providerSelectionAuthorityAdded: false,
    presenterActionExecutionAllowed: false,
    publicRelayProjectionAllowed: false,
  });
}

function exactZeroAuthority(authority) {
  const record = plainObject(authority);
  if (!record) return false;
  for (const field of [
    'sourceMutationAllowed',
    'commandExecutionAllowed',
    'approvalAuthorityAdded',
    'mergeAllowed',
    'deploymentAllowed',
    'runtimeMutationAllowed',
    'providerSelectionAuthorityAdded',
    'publicRelayProjectionAllowed',
    'presenterActionExecutionAllowed',
  ]) {
    if (record[field] !== false) return false;
  }
  return true;
}

function richResponseAuthorityIsZero(response) {
  const authority = plainObject(response?.authority);
  if (!authority) return false;
  for (const field of [
    'sourceMutationAllowed',
    'commandExecutionAllowed',
    'approvalAuthorityAdded',
    'mergeAllowed',
    'deploymentAllowed',
    'providerSelectionAuthorityAdded',
    'privateUiTruthAllowed',
  ]) {
    if (authority[field] !== false) return false;
  }
  return true;
}

function invalid(errors) {
  return Object.freeze({
    schemaVersion: STEPHANOS_CONVERSATION_CANVAS_WORKSPACE_HANDOFF_RECORD_SCHEMA_VERSION,
    valid: false,
    state: 'SAFE_HOLD',
    record: null,
    workspaceSegments: null,
    errors: Object.freeze([...new Set(errors)]),
    authority: authorityBoundary(),
  });
}

export function buildStephanosConversationCanvasWorkspaceHandoffRecordV1(input = {}, options = {}) {
  try {
    const packet = plainObject(input);
    const handoff = plainObject(packet?.canvasHandoff);
    if (!packet || !handoff) return invalid(['canvas-handoff-required']);
    if (
      handoff.schemaVersion !== STEPHANOS_CONVERSATION_CANVAS_HANDOFF_SCHEMA_VERSION
      || handoff.valid !== true
      || handoff.state !== 'PRIVATE_PRESENTATION_HANDOFF_READY'
    ) {
      return invalid(['canvas-handoff-not-ready']);
    }
    if (
      handoff.targetPresenterSchemaVersion !== STEPHANOS_CONVERSATION_CANVAS_TARGET_PRESENTER_SCHEMA_VERSION
      || handoff.targetPayloadField !== STEPHANOS_CONVERSATION_CANVAS_TARGET_PAYLOAD_FIELD
    ) {
      return invalid(['canvas-target-lineage-mismatch']);
    }
    if (
      handoff.privacy?.sharedWorkspacePrivateHandoffRequired !== true
      || handoff.privacy?.rawAnswerMayEnterPublicRelay !== false
      || handoff.privacy?.publicRelayProjectionAllowed !== false
    ) {
      return invalid(['canvas-privacy-boundary-mismatch']);
    }
    if (!exactZeroAuthority(handoff.authority)) return invalid(['canvas-authority-must-remain-zero']);

    const continuity = plainObject(handoff.continuity);
    const presenterInput = plainObject(handoff.presenterInput);
    const richResponse = plainObject(presenterInput?.richResponse);
    if (!continuity || !presenterInput || !richResponse) return invalid(['canvas-presentation-lineage-required']);
    if (
      richResponse.schemaVersion !== STEPHANOS_RICH_CONVERSATIONAL_RESPONSE_SCHEMA_VERSION
      || richResponse.valid !== true
      || !richResponseAuthorityIsZero(richResponse)
    ) {
      return invalid(['rich-response-not-valid-for-private-workspace']);
    }

    const roundId = text(continuity.roundId);
    const questionId = text(continuity.questionId);
    const responseId = text(continuity.responseId);
    if (!SAFE_ID.test(roundId) || !SAFE_ID.test(questionId) || !SAFE_ID.test(responseId)) {
      return invalid(['canvas-continuity-identity-invalid']);
    }
    if (
      text(richResponse.continuity?.roundId) !== roundId
      || text(richResponse.continuity?.questionId) !== questionId
      || text(richResponse.responseId) !== responseId
    ) {
      return invalid(['rich-response-continuity-mismatch']);
    }

    const surface = text(handoff.surface);
    const state = text(presenterInput.state).toUpperCase();
    if (!ALLOWED_SURFACES.has(surface) || text(presenterInput.surface) !== surface) {
      return invalid(['canvas-surface-lineage-mismatch']);
    }
    if (!ALLOWED_STATES.has(state)) return invalid(['canvas-state-invalid']);
    if (Array.isArray(richResponse.unknowns) && richResponse.unknowns.length > 0 && state === 'READY') {
      return invalid(['partial-rich-response-cannot-be-promoted-to-ready']);
    }

    const correlationId = text(packet.correlationId || roundId);
    if (correlationId !== roundId) return invalid(['workspace-correlation-must-match-round']);
    const proofRefs = uniqueStrings(packet.proofRefs);
    if (proofRefs.length === 0) return invalid(['workspace-proofRefs-required']);

    const timestampUtc = text(packet.timestampUtc || options.timestampUtc || new Date().toISOString());
    const relatedIssue = text(packet.relatedIssue || '#1308');
    const relatedPr = text(packet.relatedPr || '#1896');
    if (!timestampUtc || (!relatedIssue && !relatedPr)) return invalid(['workspace-lineage-required']);

    const privatePayload = Object.freeze({
      schemaVersion: STEPHANOS_CONVERSATION_CANVAS_WORKSPACE_HANDOFF_RECORD_SCHEMA_VERSION,
      handoffSchemaVersion: handoff.schemaVersion,
      targetPresenterSchemaVersion: handoff.targetPresenterSchemaVersion,
      targetPayloadField: handoff.targetPayloadField,
      surface,
      continuity: Object.freeze({ roundId, questionId, responseId }),
      presenterInput,
      privacy: Object.freeze({
        sharedWorkspacePrivateHandoffRequired: true,
        rawAnswerMayEnterPublicRelay: false,
        publicRelayProjectionAllowed: false,
      }),
      authority: authorityBoundary(),
    });
    const body = JSON.stringify(privatePayload);
    if (Buffer.byteLength(body, 'utf8') > MAX_PRIVATE_HANDOFF_BODY_BYTES) {
      return invalid(['private-canvas-handoff-body-too-large']);
    }

    const record = createSharedWorkspaceHandoffRecord({
      handoffId: handoff.handoffId || `conversation-canvas-workspace-${digest(privatePayload).slice(0, 24)}`,
      participantId: STEPHANOS_PARTICIPANT_ID,
      fromParticipantId: STEPHANOS_PARTICIPANT_ID,
      toParticipantId: UI_AGENT_ID,
      timestampUtc,
      correlationId,
      relatedIssue,
      relatedPr,
      proofRefs,
      summary: `Private Conversation Canvas handoff for ${questionId} to ${UI_AGENT_ID}.`,
      body,
    });
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.parse(timestampUtc);
    const validation = validateSharedWorkspaceRecord(record, { nowMs });
    if (!validation.valid) return invalid([`workspace-record:${validation.refusalReason || 'invalid'}`]);
    if (record.kind !== SHARED_WORKSPACE_RECORD_KINDS.HANDOFF) return invalid(['workspace-record-kind-mismatch']);
    if (
      record.participantId !== STEPHANOS_PARTICIPANT_ID
      || record.fromParticipantId !== STEPHANOS_PARTICIPANT_ID
      || record.toParticipantId !== UI_AGENT_ID
    ) {
      return invalid(['workspace-participant-lineage-mismatch']);
    }

    const workspaceSegments = Object.freeze(['outbox', `${record.handoffId}.json`]);
    return Object.freeze({
      schemaVersion: STEPHANOS_CONVERSATION_CANVAS_WORKSPACE_HANDOFF_RECORD_SCHEMA_VERSION,
      valid: true,
      state: 'PRIVATE_CANVAS_WORKSPACE_HANDOFF_RECORD_READY',
      record: Object.freeze(record),
      workspaceSegments,
      errors: Object.freeze([]),
      authority: authorityBoundary(),
    });
  } catch {
    return invalid(['private-canvas-workspace-handoff-failed-closed']);
  }
}
