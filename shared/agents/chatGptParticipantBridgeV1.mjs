import { createHash, randomUUID } from 'node:crypto';

import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  aggregateLatestSharedWorkspaceStatus,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';
import { validateDeliveryStatusSubject } from './sharedWorkspaceScopedDeliveryStatusV1.mjs';
import {
  CONVERSATION_DELIVERY_STATE,
  PARTICIPANT_ROLE,
  createRoomMessage,
  validateRoomMessage,
} from './sharedWorkspaceMissionRoomV2.mjs';

export const CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION = 'chatgpt-participant-bridge.v1';
export const CHATGPT_BRIDGE_PARTICIPANT_ID = 'chatgpt-bridge';
export const CHATGPT_BRIDGE_TRANSPORT_STATUS = 'BLOCKED_TRANSPORT_NOT_CONFIGURED';
export const CHATGPT_BRIDGE_MAX_PAYLOAD_BYTES = 4096;
export const CHATGPT_BRIDGE_REDACTED_TEXT = '[REDACTED]';

export const CHATGPT_BRIDGE_READ_OPERATIONS = Object.freeze([
  'READ_CURRENT_STATUS',
  'READ_LATEST_PROOF',
  'READ_OPERATOR_ATTENTION',
  'READ_DELIVERY_STATUS',
  'READ_CONVERSATION_REPLY',
  'READ_PARTICIPANT_CONNECTIONS',
]);

export const CHATGPT_BRIDGE_WRITE_OPERATIONS = Object.freeze([
  'WRITE_GOAL_INTENT_PROPOSAL',
  'WRITE_NEXT_ACTION_PACKET',
  'WRITE_BLOCKER_CLASSIFICATION',
  'WRITE_OPERATOR_ATTENTION_REQUEST',
  'WRITE_APPROVAL_REQUEST',
  'WRITE_CONVERSATION_TURN',
]);

export const CHATGPT_BRIDGE_FORBIDDEN_OPERATIONS = Object.freeze(['READ_FILE', 'WRITE_FILE', 'EXECUTE']);

export const CHATGPT_BRIDGE_RECORD_KINDS = Object.freeze({
  CURRENT_STATUS: 'current-status-projection',
  LATEST_PROOF: 'latest-proof-projection',
  OPERATOR_ATTENTION: 'operator-attention-projection',
  DELIVERY_STATUS: 'delivery-status-projection',
  CONVERSATION_REPLY: 'conversation-reply-projection',
  PARTICIPANT_CONNECTIONS: 'participant-connections-projection',
  GOAL_INTENT_PROPOSAL: 'goal-intent-proposal',
  NEXT_ACTION_PACKET: 'next-action-packet',
  BLOCKER_CLASSIFICATION: 'blocker-classification',
  OPERATOR_ATTENTION_REQUEST: 'operator-attention-request',
  APPROVAL_REQUEST: 'approval-request',
  CONVERSATION_TURN: 'conversation-turn',
});

export const CHATGPT_BRIDGE_OPERATION_RECORD_KIND_MAP = Object.freeze({
  READ_CURRENT_STATUS: CHATGPT_BRIDGE_RECORD_KINDS.CURRENT_STATUS,
  READ_LATEST_PROOF: CHATGPT_BRIDGE_RECORD_KINDS.LATEST_PROOF,
  READ_OPERATOR_ATTENTION: CHATGPT_BRIDGE_RECORD_KINDS.OPERATOR_ATTENTION,
  READ_DELIVERY_STATUS: CHATGPT_BRIDGE_RECORD_KINDS.DELIVERY_STATUS,
  READ_CONVERSATION_REPLY: CHATGPT_BRIDGE_RECORD_KINDS.CONVERSATION_REPLY,
  READ_PARTICIPANT_CONNECTIONS: CHATGPT_BRIDGE_RECORD_KINDS.PARTICIPANT_CONNECTIONS,
  WRITE_GOAL_INTENT_PROPOSAL: CHATGPT_BRIDGE_RECORD_KINDS.GOAL_INTENT_PROPOSAL,
  WRITE_NEXT_ACTION_PACKET: CHATGPT_BRIDGE_RECORD_KINDS.NEXT_ACTION_PACKET,
  WRITE_BLOCKER_CLASSIFICATION: CHATGPT_BRIDGE_RECORD_KINDS.BLOCKER_CLASSIFICATION,
  WRITE_OPERATOR_ATTENTION_REQUEST: CHATGPT_BRIDGE_RECORD_KINDS.OPERATOR_ATTENTION_REQUEST,
  WRITE_APPROVAL_REQUEST: CHATGPT_BRIDGE_RECORD_KINDS.APPROVAL_REQUEST,
  WRITE_CONVERSATION_TURN: CHATGPT_BRIDGE_RECORD_KINDS.CONVERSATION_TURN,
});

export const CHATGPT_BRIDGE_RESPONSE_STATUSES = Object.freeze([
  'BRIDGE_VERIFIED_PASS',
  'BLOCKED_OPERATION_NOT_ALLOWLISTED',
  'BLOCKED_RECORD_KIND_NOT_ALLOWLISTED',
  'BLOCKED_AUTHENTICATION_FAILED',
  'BLOCKED_AUTHORIZATION_FAILED',
  'BLOCKED_APPROVAL_REQUIRED',
  'BLOCKED_APPROVAL_MISMATCH',
  'BLOCKED_EXPIRED_REQUEST',
  'BLOCKED_REPLAY_DETECTED',
  'BLOCKED_PAYLOAD_UNSAFE',
  'BLOCKED_SECRET_SHAPED_DATA',
  CHATGPT_BRIDGE_TRANSPORT_STATUS,
]);

const SECRET_KEY_PATTERN = /secret|token|session|password|credential|private[_-]?key|api[_-]?key|cookie|env/i;
const SECRET_VALUE_PATTERN = /BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY|xox[baprs]-|gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,}|\.env\b|browser cookies?|session\b/i;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const CONVERSATION_TARGETS = Object.freeze(['stephanos', 'openclaw', 'codex']);
const CONVERSATION_MAX_BODY_BYTES = 2048;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function safeId(value, fallback = '') {
  const out = text(value);
  return SAFE_ID_PATTERN.test(out) ? out : fallback;
}

function serializePayload(value) {
  try {
    const json = JSON.stringify(value ?? {});
    if (typeof json !== 'string') return { ok: false, json: '', bytes: Number.POSITIVE_INFINITY };
    return { ok: true, json, bytes: Buffer.byteLength(json, 'utf8') };
  } catch {
    return { ok: false, json: '', bytes: Number.POSITIVE_INFINITY };
  }
}

function hasSecretShapedData(value, path = [], seen = new WeakSet()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) return true;
    seen.add(value);
    return value.some((item, index) => hasSecretShapedData(item, [...path, String(index)], seen));
  }
  if (!value || typeof value !== 'object') return typeof value === 'string' && SECRET_VALUE_PATTERN.test(value);
  if (seen.has(value)) return true;
  seen.add(value);
  try {
    return Object.entries(value).some(([key, child]) => SECRET_KEY_PATTERN.test(key) || hasSecretShapedData(child, [...path, key], seen));
  } catch {
    return true;
  }
}

function serializedPayloadHasSecretShapedData(serializedPayload) {
  if (!serializedPayload?.ok || typeof serializedPayload.json !== 'string') return true;
  try {
    return hasSecretShapedData(JSON.parse(serializedPayload.json));
  } catch {
    return true;
  }
}

function sanitizedProjectionText(value) {
  const out = text(value);
  if (!out) return '';
  return SECRET_VALUE_PATTERN.test(out) ? CHATGPT_BRIDGE_REDACTED_TEXT : out;
}

function canonicalHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validateConversationIdentityPayload(payload = {}, { replyRead = false, registeredParticipantIds = [] } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'CONVERSATION_PAYLOAD_INVALID' };
  const conversationId = safeId(payload.conversationId);
  const threadId = safeId(payload.threadId);
  const requestMessageId = safeId(payload.requestMessageId || payload.messageId);
  const requestedEntityId = safeId(payload.requestedEntityId);
  const correlationId = safeId(payload.correlationId, conversationId);
  const knownTarget = CONVERSATION_TARGETS.includes(requestedEntityId);
  const registeredFutureTarget = requestedEntityId.startsWith('future-agent-')
    && safeId(payload.targetCapabilityId)
    && registeredParticipantIds.includes(requestedEntityId);
  if (!conversationId || !threadId || !requestMessageId || !requestedEntityId || !correlationId) {
    return { ok: false, reason: 'CONVERSATION_IDENTITY_INCOMPLETE' };
  }
  if (!knownTarget && !registeredFutureTarget) return { ok: false, reason: 'CONVERSATION_TARGET_NOT_REGISTERED' };
  const expectedTargetSourceHead = text(payload.expectedTargetSourceHead).toLowerCase();
  if (expectedTargetSourceHead && !SHA_PATTERN.test(expectedTargetSourceHead)) return { ok: false, reason: 'CONVERSATION_TARGET_HEAD_INVALID' };
  if (replyRead) {
    return { ok: true, conversationId, threadId, requestMessageId, requestedEntityId, correlationId, expectedTargetSourceHead };
  }
  const body = text(payload.body);
  if (!body || Buffer.byteLength(body, 'utf8') > CONVERSATION_MAX_BODY_BYTES) return { ok: false, reason: 'CONVERSATION_BODY_INVALID' };
  const createdAtUtc = text(payload.createdAtUtc);
  const expiresAtUtc = text(payload.expiresAtUtc);
  if (!Number.isFinite(Date.parse(createdAtUtc)) || !Number.isFinite(Date.parse(expiresAtUtc)) || Date.parse(expiresAtUtc) <= Date.parse(createdAtUtc)) {
    return { ok: false, reason: 'CONVERSATION_EXPIRY_INVALID' };
  }
  return { ok: true, conversationId, threadId, requestMessageId, requestedEntityId, correlationId, expectedTargetSourceHead, body, createdAtUtc, expiresAtUtc };
}

export function validateConversationTurnPayload(payload = {}, options = {}) {
  return validateConversationIdentityPayload(payload, { replyRead: false, registeredParticipantIds: options.registeredParticipantIds || [] });
}

export function validateConversationReplyReadPayload(payload = {}, options = {}) {
  return validateConversationIdentityPayload(payload, { replyRead: true, registeredParticipantIds: options.registeredParticipantIds || [] });
}

export function validateParticipantConnectionsReadPayload(payload = {}) {
  const participantIds = Array.isArray(payload?.participantIds) && payload.participantIds.length
    ? payload.participantIds
    : CONVERSATION_TARGETS;
  if (participantIds.length > 8) return { ok: false, reason: 'CONVERSATION_PARTICIPANT_SET_TOO_LARGE' };
  const normalized = participantIds.map((value) => safeId(value));
  if (normalized.some((value) => !value) || new Set(normalized).size !== normalized.length) {
    return { ok: false, reason: 'CONVERSATION_PARTICIPANT_SET_INVALID' };
  }
  return { ok: true, participantIds: normalized };
}

function auditReceipt(input = {}) {
  const timestampUtc = text(input.timestampUtc, new Date(0).toISOString());
  const requestId = safeId(input.request?.requestId, 'unknown-request');
  const responseStatus = text(input.responseStatus, 'BLOCKED_AUTHORIZATION_FAILED');
  return Object.freeze({
    schemaVersion: CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION,
    kind: 'stephanos.chatgpt_bridge.audit_receipt',
    auditReceiptId: `audit-${canonicalHash({ requestId, responseStatus, timestampUtc }).slice(0, 24)}`,
    timestampUtc,
    participantId: text(input.request?.participantId, ''),
    requestId,
    operation: text(input.request?.operation, ''),
    recordKind: text(input.request?.recordKind, ''),
    responseStatus,
    accepted: responseStatus === 'BRIDGE_VERIFIED_PASS',
    proofRefs: Array.isArray(input.proofRefs) ? input.proofRefs.map(String) : [],
  });
}

export function createChatGptBridgeRequest(input = {}) {
  return {
    schemaVersion: CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION,
    requestId: safeId(input.requestId, `request-${randomUUID()}`),
    timestampUtc: text(input.timestampUtc, new Date().toISOString()),
    participantId: text(input.participantId, CHATGPT_BRIDGE_PARTICIPANT_ID),
    operation: text(input.operation),
    recordKind: text(input.recordKind),
    relatedGoal: text(input.relatedGoal),
    relatedPr: text(input.relatedPr),
    correlationId: safeId(input.correlationId),
    boundedPayload: input.boundedPayload && typeof input.boundedPayload === 'object' ? input.boundedPayload : {},
    approvalRef: text(input.approvalRef),
    expiryUtc: text(input.expiryUtc),
    redactionPolicy: text(input.redactionPolicy, 'sanitize-secrets-and-runtime-paths'),
  };
}

export function createInMemoryReplayStore(seed = []) {
  const seen = new Set(seed);
  return {
    has: (requestId) => seen.has(requestId),
    remember: (requestId) => seen.add(requestId),
    snapshot: () => [...seen].sort(),
  };
}

export function createInertChatGptBridgeTransportAdapter() {
  return Object.freeze({
    inert: true,
    opensSocket: false,
    bindsNetworkInterface: false,
    publicBindingAllowed: false,
    send: async (request = {}) => verifyChatGptBridgeRequest(request, { transportConfigured: false }),
  });
}

export function buildChatGptBridgeRecord(request = {}, options = {}) {
  if (request.recordKind === 'approval-result') return { ok: false, reason: 'BLOCKED_APPROVAL_REQUIRED' };
  if (!Object.values(CHATGPT_BRIDGE_RECORD_KINDS).includes(request.recordKind) || !CHATGPT_BRIDGE_WRITE_OPERATIONS.includes(request.operation)) {
    return { ok: false, reason: 'BLOCKED_RECORD_KIND_NOT_ALLOWLISTED' };
  }
  if (CHATGPT_BRIDGE_OPERATION_RECORD_KIND_MAP[request.operation] !== request.recordKind) {
    return { ok: false, reason: 'BLOCKED_RECORD_KIND_NOT_ALLOWLISTED' };
  }
  const serializedPayload = serializePayload(request.boundedPayload);
  if (!serializedPayload.ok || serializedPayload.bytes > CHATGPT_BRIDGE_MAX_PAYLOAD_BYTES) return { ok: false, reason: 'BLOCKED_PAYLOAD_UNSAFE' };
  if (serializedPayloadHasSecretShapedData(serializedPayload)) return { ok: false, reason: 'BLOCKED_SECRET_SHAPED_DATA' };

  const requestId = safeId(request.requestId);
  const correlationId = safeId(request.correlationId);
  if (!requestId || requestId !== text(request.requestId) || !correlationId || correlationId !== text(request.correlationId)) {
    return { ok: false, reason: 'BLOCKED_AUTHORIZATION_FAILED' };
  }
  if (!text(request.relatedGoal) && !text(request.relatedPr)) return { ok: false, reason: 'BLOCKED_AUTHORIZATION_FAILED' };
  if (text(request.approvalRef)) {
    const approvalCheck = verifyOperatorApprovalSeparation(request, options.operatorApproval);
    if (!approvalCheck.ok) return { ok: false, reason: approvalCheck.responseStatus };
  }

  const timestampUtc = text(options.timestampUtc, request.timestampUtc);
  const conversation = request.operation === 'WRITE_CONVERSATION_TURN'
    ? validateConversationTurnPayload(request.boundedPayload, { registeredParticipantIds: options.registeredConversationParticipantIds || [] })
    : null;
  if (conversation && !conversation.ok) return { ok: false, reason: conversation.reason };
  const roomMessage = conversation?.ok ? createRoomMessage({
    messageId: conversation.requestMessageId,
    participantId: 'chatgpt',
    role: PARTICIPANT_ROLE.PLANNER,
    recipientParticipantId: 'stephanos',
    requestedEntityId: conversation.requestedEntityId,
    conversationId: conversation.conversationId,
    threadId: conversation.threadId,
    correlationId: conversation.correlationId,
    body: conversation.body,
    createdAtUtc: conversation.createdAtUtc,
    expiresAtUtc: conversation.expiresAtUtc,
    deliveryState: CONVERSATION_DELIVERY_STATE.QUEUED,
    sourceHead: conversation.expectedTargetSourceHead,
    proofRefs: [`receipts/${requestId}`],
  }) : null;
  if (roomMessage && !validateRoomMessage(roomMessage).valid) return { ok: false, reason: 'CONVERSATION_MESSAGE_INVALID' };
  const record = {
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.MESSAGE,
    messageId: safeId(`${request.recordKind}-${requestId}`, `bridge-${canonicalHash({ recordKind: request.recordKind, requestId }).slice(0, 16)}`),
    participantId: CHATGPT_BRIDGE_PARTICIPANT_ID,
    timestampUtc,
    correlationId,
    relatedIssue: text(request.relatedGoal),
    relatedPr: text(request.relatedPr),
    proofRefs: [`receipts/${requestId}`],
    channel: conversation ? 'stephanos-conversation' : 'chatgpt-participant-bridge',
    summary: text(request.boundedPayload?.summary, request.recordKind),
    body: `{"recordKind":${JSON.stringify(request.recordKind)},"boundedPayload":${serializedPayload.json}}`,
    ...(roomMessage ? {
      senderParticipantId: roomMessage.senderParticipantId,
      recipientParticipantId: roomMessage.recipientParticipantId,
      requestedEntityId: roomMessage.requestedEntityId,
      conversationId: roomMessage.conversationId,
      threadId: roomMessage.threadId,
      replyToMessageId: roomMessage.replyToMessageId,
      deliveryState: roomMessage.deliveryState,
      originTimestampUtc: roomMessage.createdAtUtc,
      expiresAtUtc: roomMessage.expiresAtUtc,
      expectedTargetSourceHead: roomMessage.sourceHead,
    } : {}),
  };
  const validation = validateSharedWorkspaceRecord(record, options.workspaceValidationOptions);
  if (!validation.valid) return { ok: false, reason: 'BLOCKED_WORKSPACE_RECORD_INVALID', validation };
  return { ok: true, record, validation };
}

export async function createSanitizedSharedWorkspaceProjection(input = {}) {
  let aggregation = { ok: true, reason: 'LATEST_STATUS_SUPPLIED', latest: input.latest || {} };
  if (!input.latest && input.workspaceRoot) {
    try {
      aggregation = await aggregateLatestSharedWorkspaceStatus(input.workspaceRoot, input);
    } catch {
      aggregation = {
        ok: false,
        reason: 'SHARED_WORKSPACE_AGGREGATION_FAILED',
        finalVerdict: 'SHARED_WORKSPACE_AGGREGATION_BLOCKED',
        latest: {},
      };
    }
  }
  const latest = aggregation?.latest || {};
  const sanitizeRecord = (record = null) => record ? {
    kind: sanitizedProjectionText(record.kind),
    timestampUtc: sanitizedProjectionText(record.timestampUtc),
    status: sanitizedProjectionText(record.status),
    summary: sanitizedProjectionText(record.summary),
    title: sanitizedProjectionText(record.title),
    proofRefs: Array.isArray(record.proofRefs) ? record.proofRefs.map(String).filter((ref) => !SECRET_VALUE_PATTERN.test(ref)) : [],
  } : null;
  return Object.freeze({
    schemaVersion: CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION,
    projectionKind: 'sanitized-shared-workspace-status',
    aggregationOk: aggregation?.ok !== false,
    aggregationReason: sanitizedProjectionText(aggregation?.reason),
    aggregationVerdict: sanitizedProjectionText(aggregation?.finalVerdict),
    currentGoal: sanitizeRecord(latest.goal),
    currentStatus: sanitizeRecord(latest.status),
    latestProof: sanitizeRecord(latest.proof),
    freshnessUtc: text(input.timestampUtc, new Date(0).toISOString()),
    arbitraryFilesystemAccess: false,
    commandExecutionAccess: false,
    sourceMutationAccess: false,
  });
}

export function verifyChatGptBridgeRequest(request = {}, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const replayStore = options.replayStore;
  let responseStatus = 'BRIDGE_VERIFIED_PASS';
  const operation = text(request.operation);
  const expectedRecordKind = CHATGPT_BRIDGE_OPERATION_RECORD_KIND_MAP[operation];
  const isAllowedOperation = [...CHATGPT_BRIDGE_READ_OPERATIONS, ...CHATGPT_BRIDGE_WRITE_OPERATIONS].includes(operation);
  const requestId = safeId(request.requestId);
  const correlationId = safeId(request.correlationId);
  const expiryMs = Date.parse(request.expiryUtc);

  if (options.transportConfigured === false) responseStatus = CHATGPT_BRIDGE_TRANSPORT_STATUS;
  else if (request.schemaVersion !== CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION) responseStatus = 'BLOCKED_AUTHORIZATION_FAILED';
  else if (text(request.participantId) !== CHATGPT_BRIDGE_PARTICIPANT_ID || options.authenticated !== true) responseStatus = 'BLOCKED_AUTHENTICATION_FAILED';
  else if (!isAllowedOperation || CHATGPT_BRIDGE_FORBIDDEN_OPERATIONS.includes(operation)) responseStatus = 'BLOCKED_OPERATION_NOT_ALLOWLISTED';
  else if (text(request.recordKind) !== expectedRecordKind) responseStatus = 'BLOCKED_RECORD_KIND_NOT_ALLOWLISTED';
  else if (!requestId || requestId !== text(request.requestId)) responseStatus = 'BLOCKED_AUTHORIZATION_FAILED';
  else if (!correlationId || correlationId !== text(request.correlationId) || (!text(request.relatedGoal) && !text(request.relatedPr))) responseStatus = 'BLOCKED_AUTHORIZATION_FAILED';
  else if (!text(request.expiryUtc) || !Number.isFinite(expiryMs) || expiryMs <= nowMs) responseStatus = 'BLOCKED_EXPIRED_REQUEST';
  else if (replayStore?.has?.(requestId)) responseStatus = 'BLOCKED_REPLAY_DETECTED';
  else {
    const serializedPayload = serializePayload(request.boundedPayload);
    if (!serializedPayload.ok || serializedPayload.bytes > CHATGPT_BRIDGE_MAX_PAYLOAD_BYTES) responseStatus = 'BLOCKED_PAYLOAD_UNSAFE';
    else if (serializedPayloadHasSecretShapedData(serializedPayload)) responseStatus = 'BLOCKED_SECRET_SHAPED_DATA';
    else if (operation === 'READ_DELIVERY_STATUS' && !validateDeliveryStatusSubject(request.boundedPayload?.statusSubject).ok) responseStatus = 'BLOCKED_PAYLOAD_UNSAFE';
    else if (operation === 'WRITE_CONVERSATION_TURN' && !validateConversationTurnPayload(request.boundedPayload, { registeredParticipantIds: options.registeredConversationParticipantIds || [] }).ok) responseStatus = 'BLOCKED_PAYLOAD_UNSAFE';
    else if (operation === 'READ_CONVERSATION_REPLY' && !validateConversationReplyReadPayload(request.boundedPayload, { registeredParticipantIds: options.registeredConversationParticipantIds || [] }).ok) responseStatus = 'BLOCKED_PAYLOAD_UNSAFE';
    else if (operation === 'READ_PARTICIPANT_CONNECTIONS' && !validateParticipantConnectionsReadPayload(request.boundedPayload).ok) responseStatus = 'BLOCKED_PAYLOAD_UNSAFE';
    else if (request.recordKind === 'approval-result') responseStatus = 'BLOCKED_APPROVAL_REQUIRED';
    else if (text(request.approvalRef)) {
      const approvalCheck = verifyOperatorApprovalSeparation(request, options.operatorApproval);
      if (!approvalCheck.ok) responseStatus = approvalCheck.responseStatus;
    }
  }

  if (responseStatus === 'BRIDGE_VERIFIED_PASS') replayStore?.remember?.(requestId);
  const auditReceiptRecord = auditReceipt({ request, responseStatus, timestampUtc: text(options.timestampUtc, new Date(nowMs).toISOString()), proofRefs: [`receipts/${requestId || 'request'}`] });
  return Object.freeze({
    schemaVersion: CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION,
    requestId: text(request.requestId),
    timestampUtc: auditReceiptRecord.timestampUtc,
    participantId: text(request.participantId),
    operation,
    recordKind: text(request.recordKind),
    responseStatus,
    proofRefs: auditReceiptRecord.proofRefs,
    auditReceiptId: auditReceiptRecord.auditReceiptId,
    auditReceipt: auditReceiptRecord,
    accepted: responseStatus === 'BRIDGE_VERIFIED_PASS',
  });
}

export function verifyOperatorApprovalSeparation(request = {}, operatorApproval = {}) {
  const participantId = safeId(operatorApproval.participantId);
  const approvalRef = text(operatorApproval.approvalRef);
  const correlationId = safeId(operatorApproval.correlationId);
  if (!participantId || !approvalRef || !correlationId) return { ok: false, responseStatus: 'BLOCKED_APPROVAL_REQUIRED' };
  if (participantId !== text(operatorApproval.participantId) || participantId === CHATGPT_BRIDGE_PARTICIPANT_ID) return { ok: false, responseStatus: 'BLOCKED_APPROVAL_MISMATCH' };
  if (approvalRef !== text(request.approvalRef)) return { ok: false, responseStatus: 'BLOCKED_APPROVAL_MISMATCH' };
  if (correlationId !== text(operatorApproval.correlationId) || correlationId !== text(request.correlationId)) return { ok: false, responseStatus: 'BLOCKED_APPROVAL_MISMATCH' };
  return { ok: true, responseStatus: 'BRIDGE_VERIFIED_PASS' };
}
