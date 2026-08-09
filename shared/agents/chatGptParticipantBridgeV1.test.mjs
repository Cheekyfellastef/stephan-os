import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { validateSharedWorkspaceRecord } from './sharedAgentWorkspaceStore.mjs';
import {
  CHATGPT_BRIDGE_FORBIDDEN_OPERATIONS,
  CHATGPT_BRIDGE_MAX_PAYLOAD_BYTES,
  CHATGPT_BRIDGE_OPERATION_RECORD_KIND_MAP,
  CHATGPT_BRIDGE_READ_OPERATIONS,
  CHATGPT_BRIDGE_RECORD_KINDS,
  CHATGPT_BRIDGE_REDACTED_TEXT,
  CHATGPT_BRIDGE_RESPONSE_STATUSES,
  CHATGPT_BRIDGE_TRANSPORT_STATUS,
  CHATGPT_BRIDGE_WRITE_OPERATIONS,
  CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION,
  CHATGPT_BRIDGE_PARTICIPANT_ID,
  buildChatGptBridgeRecord,
  createChatGptBridgeRequest,
  createInMemoryReplayStore,
  createInertChatGptBridgeTransportAdapter,
  createSanitizedSharedWorkspaceProjection,
  verifyChatGptBridgeRequest,
  verifyOperatorApprovalSeparation,
  validateConversationReplyReadPayload,
  validateConversationTurnPayload,
  validateParticipantConnectionsReadPayload,
} from './chatGptParticipantBridgeV1.mjs';

const NOW = Date.parse('2026-07-13T00:00:00.000Z');
const EXPIRY = '2026-07-13T00:10:00.000Z';

function validRequest(overrides = {}) {
  return createChatGptBridgeRequest({
    requestId: 'request-1506',
    timestampUtc: '2026-07-13T00:00:00.000Z',
    participantId: CHATGPT_BRIDGE_PARTICIPANT_ID,
    operation: 'WRITE_NEXT_ACTION_PACKET',
    recordKind: CHATGPT_BRIDGE_RECORD_KINDS.NEXT_ACTION_PACKET,
    relatedGoal: '1506',
    relatedPr: '1510',
    correlationId: 'issue-1506',
    boundedPayload: { summary: 'Propose next bounded action.', nextAction: 'Review bridge proof.' },
    expiryUtc: EXPIRY,
    ...overrides,
  });
}

function verify(request, options = {}) {
  return verifyChatGptBridgeRequest(request, { authenticated: true, nowMs: NOW, timestampUtc: '2026-07-13T00:00:00.000Z', ...options });
}

test('V1 exposes exact read/write allowlists and no generic file or execute capability', () => {
  assert.deepEqual(CHATGPT_BRIDGE_READ_OPERATIONS, ['READ_CURRENT_STATUS', 'READ_LATEST_PROOF', 'READ_OPERATOR_ATTENTION', 'READ_DELIVERY_STATUS', 'READ_CONVERSATION_REPLY', 'READ_PARTICIPANT_CONNECTIONS']);
  assert.deepEqual(CHATGPT_BRIDGE_WRITE_OPERATIONS, [
    'WRITE_GOAL_INTENT_PROPOSAL',
    'WRITE_NEXT_ACTION_PACKET',
    'WRITE_BLOCKER_CLASSIFICATION',
    'WRITE_OPERATOR_ATTENTION_REQUEST',
    'WRITE_APPROVAL_REQUEST',
    'WRITE_CONVERSATION_TURN',
  ]);
  assert.deepEqual(CHATGPT_BRIDGE_FORBIDDEN_OPERATIONS, ['READ_FILE', 'WRITE_FILE', 'EXECUTE']);
  for (const forbidden of CHATGPT_BRIDGE_FORBIDDEN_OPERATIONS) {
    assert.equal(CHATGPT_BRIDGE_READ_OPERATIONS.includes(forbidden), false);
    assert.equal(CHATGPT_BRIDGE_WRITE_OPERATIONS.includes(forbidden), false);
  }
});

test('operation-to-record-kind authorization mapping is fixed and fail closed', () => {
  assert.equal(CHATGPT_BRIDGE_OPERATION_RECORD_KIND_MAP.WRITE_NEXT_ACTION_PACKET, CHATGPT_BRIDGE_RECORD_KINDS.NEXT_ACTION_PACKET);
  assert.equal(verify(validRequest({ recordKind: CHATGPT_BRIDGE_RECORD_KINDS.GOAL_INTENT_PROPOSAL })).responseStatus, 'BLOCKED_RECORD_KIND_NOT_ALLOWLISTED');
  assert.equal(verify(validRequest({ operation: 'READ_FILE', recordKind: 'file' })).responseStatus, 'BLOCKED_OPERATION_NOT_ALLOWLISTED');
});

test('schema/authentication/correlation/expiry/replay guards produce required statuses and audit receipts', () => {
  assert.equal(verify(validRequest()).responseStatus, 'BRIDGE_VERIFIED_PASS');
  assert.equal(verify(validRequest({ participantId: 'codex' })).responseStatus, 'BLOCKED_AUTHENTICATION_FAILED');
  assert.equal(verify({ ...validRequest(), schemaVersion: 'wrong' }).responseStatus, 'BLOCKED_AUTHORIZATION_FAILED');
  assert.equal(verify(validRequest({ correlationId: '' })).responseStatus, 'BLOCKED_AUTHORIZATION_FAILED');
  assert.equal(verify(validRequest({ expiryUtc: '2026-07-12T23:59:00.000Z' })).responseStatus, 'BLOCKED_EXPIRED_REQUEST');
  assert.equal(verify({ ...validRequest(), expiryUtc: 'not-a-date' }).responseStatus, 'BLOCKED_EXPIRED_REQUEST');
  assert.equal(verify({ ...validRequest(), requestId: '' }).responseStatus, 'BLOCKED_AUTHORIZATION_FAILED');
  assert.equal(verify({ ...validRequest(), requestId: 'bad request id' }).responseStatus, 'BLOCKED_AUTHORIZATION_FAILED');
  assert.equal(verify({ ...validRequest(), requestId: 'request:1506' }).responseStatus, 'BLOCKED_AUTHORIZATION_FAILED');
  assert.equal(verify({ ...validRequest(), correlationId: 'issue:1506' }).responseStatus, 'BLOCKED_AUTHORIZATION_FAILED');

  const replayStore = createInMemoryReplayStore();
  assert.equal(verify(validRequest({ requestId: 'request-replay' }), { replayStore }).responseStatus, 'BRIDGE_VERIFIED_PASS');
  const replay = verify(validRequest({ requestId: 'request-replay' }), { replayStore });
  assert.equal(replay.responseStatus, 'BLOCKED_REPLAY_DETECTED');
  assert.equal(replay.auditReceipt.accepted, false);
  assert.match(replay.auditReceiptId, /^audit-/);
});

test('payload bounds and secret-shaped data are rejected before workspace records are built', () => {
  assert.equal(verify(validRequest({ boundedPayload: { summary: 'x'.repeat(CHATGPT_BRIDGE_MAX_PAYLOAD_BYTES + 1) } })).responseStatus, 'BLOCKED_PAYLOAD_UNSAFE');
  assert.equal(verify(validRequest({ boundedPayload: { apiToken: 'ghp_1234567890abcdef' } })).responseStatus, 'BLOCKED_SECRET_SHAPED_DATA');
  assert.equal(verify(validRequest({ boundedPayload: { summary: 'contains .env path' } })).responseStatus, 'BLOCKED_SECRET_SHAPED_DATA');
  assert.equal(buildChatGptBridgeRecord(validRequest({ boundedPayload: { apiToken: 'ghp_1234567890abcdef' } })).reason, 'BLOCKED_SECRET_SHAPED_DATA');
  assert.equal(buildChatGptBridgeRecord(validRequest({ boundedPayload: { summary: 'x'.repeat(CHATGPT_BRIDGE_MAX_PAYLOAD_BYTES + 1) } })).reason, 'BLOCKED_PAYLOAD_UNSAFE');
});

test('serialized toJSON output is inspected for secret-shaped data', () => {
  const boundedPayload = {
    summary: 'Safe before serialization.',
    toJSON() {
      return { apiToken: 'ghp_1234567890abcdef' };
    },
  };
  const request = validRequest({ boundedPayload });
  assert.equal(verify(request).responseStatus, 'BLOCKED_SECRET_SHAPED_DATA');
  assert.equal(buildChatGptBridgeRecord(request).reason, 'BLOCKED_SECRET_SHAPED_DATA');
});

test('unserializable payloads fail closed without throwing', () => {
  const cyclicPayload = {};
  cyclicPayload.self = cyclicPayload;
  for (const boundedPayload of [cyclicPayload, { count: 1n }]) {
    const verified = verify(validRequest({ boundedPayload }));
    assert.equal(verified.responseStatus, 'BLOCKED_PAYLOAD_UNSAFE');
    assert.equal(verified.accepted, false);
    assert.match(verified.auditReceiptId, /^audit-/);
    assert.equal(buildChatGptBridgeRecord(validRequest({ boundedPayload })).reason, 'BLOCKED_PAYLOAD_UNSAFE');
  }
});

test('approvalRef writes require independent canonical operator proof', () => {
  const request = validRequest({ approvalRef: 'approval-1' });
  const validOperatorApproval = { participantId: 'operator-stephan', approvalRef: 'approval-1', correlationId: 'issue-1506' };

  assert.equal(verify(request).responseStatus, 'BLOCKED_APPROVAL_REQUIRED');
  assert.equal(verify(request, { operatorApproval: { approvalRef: 'approval-1', correlationId: 'issue-1506' } }).responseStatus, 'BLOCKED_APPROVAL_REQUIRED');
  assert.equal(verify(request, { operatorApproval: { ...validOperatorApproval, participantId: CHATGPT_BRIDGE_PARTICIPANT_ID } }).responseStatus, 'BLOCKED_APPROVAL_MISMATCH');
  assert.equal(verify(request, { operatorApproval: { ...validOperatorApproval, approvalRef: 'approval-2' } }).responseStatus, 'BLOCKED_APPROVAL_MISMATCH');
  assert.equal(verify(request, { operatorApproval: validOperatorApproval }).responseStatus, 'BRIDGE_VERIFIED_PASS');

  assert.equal(buildChatGptBridgeRecord(request).reason, 'BLOCKED_APPROVAL_REQUIRED');
  assert.equal(buildChatGptBridgeRecord(request, { operatorApproval: validOperatorApproval }).ok, true);
});

test('ChatGPT cannot create approval-result truth or self-approve operator decisions', () => {
  assert.equal(buildChatGptBridgeRecord(validRequest({ recordKind: 'approval-result' })).reason, 'BLOCKED_APPROVAL_REQUIRED');
  assert.deepEqual(verifyOperatorApprovalSeparation(validRequest({ approvalRef: 'approval-1' }), {}), { ok: false, responseStatus: 'BLOCKED_APPROVAL_REQUIRED' });
  assert.deepEqual(verifyOperatorApprovalSeparation(validRequest({ approvalRef: 'approval-1' }), { participantId: CHATGPT_BRIDGE_PARTICIPANT_ID, approvalRef: 'approval-1', correlationId: 'issue-1506' }), { ok: false, responseStatus: 'BLOCKED_APPROVAL_MISMATCH' });
  assert.deepEqual(verifyOperatorApprovalSeparation(validRequest({ approvalRef: 'approval-1' }), { participantId: 'operator-stephan', approvalRef: 'approval-1', correlationId: 'issue-1506' }), { ok: true, responseStatus: 'BRIDGE_VERIFIED_PASS' });
});

test('bounded record builders preserve Shared Workspace boundaries and validate canonically', () => {
  for (const [operation, recordKind] of Object.entries(CHATGPT_BRIDGE_OPERATION_RECORD_KIND_MAP)) {
    if (!operation.startsWith('WRITE_')) continue;
    const boundedPayload = operation === 'WRITE_CONVERSATION_TURN' ? {
      conversationId: 'conversation-1506',
      threadId: 'thread-1506',
      requestMessageId: 'message-1506-1',
      requestedEntityId: 'openclaw',
      correlationId: 'turn-1506-1',
      body: 'Give Stephanos a grounded conversational reply.',
      createdAtUtc: '2026-07-13T00:00:00.000Z',
      expiresAtUtc: '2026-07-13T00:10:00.000Z',
    } : validRequest().boundedPayload;
    const built = buildChatGptBridgeRecord(validRequest({ operation, recordKind, requestId: `request-${recordKind}`, boundedPayload }));
    assert.equal(built.ok, true);
    assert.equal(built.record.channel, operation === 'WRITE_CONVERSATION_TURN' ? 'stephanos-conversation' : 'chatgpt-participant-bridge');
    assert.equal(built.record.participantId, CHATGPT_BRIDGE_PARTICIPANT_ID);
    assert.equal(built.record.body.includes('EXECUTE'), false);
    assert.equal(validateSharedWorkspaceRecord(built.record).valid, true);
  }
});

test('conversation turns are addressed to Stephanos and preserve the requested entity and exact reply identity', () => {
  const boundedPayload = {
    conversationId: 'conversation-1506',
    threadId: 'thread-1506',
    requestMessageId: 'message-1506-1',
    requestedEntityId: 'openclaw',
    correlationId: 'turn-1506-1',
    body: 'What is your grounded assessment of the current control plane?',
    createdAtUtc: '2026-07-13T00:00:00.000Z',
    expiresAtUtc: '2026-07-13T00:10:00.000Z',
    expectedTargetSourceHead: 'a'.repeat(40),
  };
  assert.equal(validateConversationTurnPayload(boundedPayload).ok, true);
  const built = buildChatGptBridgeRecord(validRequest({
    operation: 'WRITE_CONVERSATION_TURN',
    recordKind: CHATGPT_BRIDGE_RECORD_KINDS.CONVERSATION_TURN,
    boundedPayload,
  }));
  assert.equal(built.ok, true);
  assert.equal(built.record.senderParticipantId, 'chatgpt');
  assert.equal(built.record.recipientParticipantId, 'stephanos');
  assert.equal(built.record.requestedEntityId, 'openclaw');
  assert.equal(built.record.conversationId, 'conversation-1506');
  assert.equal(built.record.threadId, 'thread-1506');
  assert.equal(built.record.deliveryState, 'QUEUED');
  assert.equal(built.record.expectedTargetSourceHead, 'a'.repeat(40));
});

test('conversation payloads fail closed for unregistered targets, missing reply identity, invalid heads and unsafe expiry', () => {
  const base = {
    conversationId: 'conversation-1506',
    threadId: 'thread-1506',
    requestMessageId: 'message-1506-1',
    requestedEntityId: 'openclaw',
    correlationId: 'turn-1506-1',
    body: 'Bounded conversation.',
    createdAtUtc: '2026-07-13T00:00:00.000Z',
    expiresAtUtc: '2026-07-13T00:10:00.000Z',
  };
  assert.equal(validateConversationTurnPayload({ ...base, requestedEntityId: 'mystery-agent' }).reason, 'CONVERSATION_TARGET_NOT_REGISTERED');
  assert.equal(validateConversationTurnPayload({ ...base, expectedTargetSourceHead: 'wrong' }).reason, 'CONVERSATION_TARGET_HEAD_INVALID');
  assert.equal(validateConversationTurnPayload({ ...base, expiresAtUtc: base.createdAtUtc }).reason, 'CONVERSATION_EXPIRY_INVALID');
  assert.equal(validateConversationReplyReadPayload({ ...base, requestMessageId: '' }).reason, 'CONVERSATION_IDENTITY_INCOMPLETE');

  const rejected = verify(validRequest({
    operation: 'WRITE_CONVERSATION_TURN',
    recordKind: CHATGPT_BRIDGE_RECORD_KINDS.CONVERSATION_TURN,
    boundedPayload: { ...base, requestedEntityId: 'mystery-agent' },
  }));
  assert.equal(rejected.responseStatus, 'BLOCKED_PAYLOAD_UNSAFE');
});

test('future conversation targets require an explicit registered capability identity', () => {
  const base = {
    conversationId: 'conversation-1506',
    threadId: 'thread-1506',
    requestMessageId: 'message-1506-1',
    requestedEntityId: 'future-agent-42',
    correlationId: 'turn-1506-1',
    body: 'Hello future participant.',
    createdAtUtc: '2026-07-13T00:00:00.000Z',
    expiresAtUtc: '2026-07-13T00:10:00.000Z',
  };
  assert.equal(validateConversationTurnPayload(base).reason, 'CONVERSATION_TARGET_NOT_REGISTERED');
  assert.equal(validateConversationTurnPayload({ ...base, targetCapabilityId: 'future-agent-42-conversation' }).reason, 'CONVERSATION_TARGET_NOT_REGISTERED');
  assert.equal(validateConversationTurnPayload(
    { ...base, targetCapabilityId: 'future-agent-42-conversation' },
    { registeredParticipantIds: ['future-agent-42'] },
  ).ok, true);
});

test('participant connection reads default to core entities and reject ambiguous or oversized sets', () => {
  assert.deepEqual(validateParticipantConnectionsReadPayload({}).participantIds, ['stephanos', 'openclaw', 'codex']);
  assert.deepEqual(validateParticipantConnectionsReadPayload({ participantIds: ['stephanos', 'future-agent-42'] }).participantIds, ['stephanos', 'future-agent-42']);
  assert.equal(validateParticipantConnectionsReadPayload({ participantIds: ['codex', 'codex'] }).ok, false);
  assert.equal(validateParticipantConnectionsReadPayload({ participantIds: Array.from({ length: 9 }, (_, index) => `future-agent-${index}`) }).reason, 'CONVERSATION_PARTICIPANT_SET_TOO_LARGE');
});

test('sanitized status/proof projection redacts secret-shaped strings and omits execution capability', async () => {
  const projection = await createSanitizedSharedWorkspaceProjection({
    timestampUtc: '2026-07-13T00:00:00.000Z',
    latest: {
      goal: { kind: 'goal', timestampUtc: '2026-07-13T00:00:00.000Z', title: 'ghp_1234567890abcdef', status: 'open' },
      status: { kind: 'status', timestampUtc: '2026-07-13T00:00:00.000Z', status: 'sk-12345678901234567890', summary: 'Current.' },
      proof: { kind: 'proof', timestampUtc: '2026-07-13T00:00:00.000Z', status: 'PASS', summary: 'ghp_1234567890abcdef', proofRefs: ['proof/ok', '.env'] },
    },
  });
  assert.equal(projection.schemaVersion, CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION);
  assert.equal(projection.arbitraryFilesystemAccess, false);
  assert.equal(projection.commandExecutionAccess, false);
  assert.equal(projection.sourceMutationAccess, false);
  assert.equal(projection.currentGoal.title, CHATGPT_BRIDGE_REDACTED_TEXT);
  assert.equal(projection.currentStatus.status, CHATGPT_BRIDGE_REDACTED_TEXT);
  assert.equal(projection.latestProof.summary, CHATGPT_BRIDGE_REDACTED_TEXT);
  assert.deepEqual(projection.latestProof.proofRefs, ['proof/ok']);
});

test('blocked workspace aggregation returns a bounded fail-closed projection', async () => {
  const projection = await createSanitizedSharedWorkspaceProjection({
    workspaceRoot: process.cwd(),
    repoRoot: process.cwd(),
    timestampUtc: '2026-07-13T00:00:00.000Z',
  });
  assert.equal(projection.aggregationOk, false);
  assert.equal(projection.aggregationReason, 'WORKSPACE_PATH_INSIDE_REPOSITORY');
  assert.equal(projection.aggregationVerdict, 'SHARED_WORKSPACE_AGGREGATION_BLOCKED');
  assert.equal(projection.currentGoal, null);
  assert.equal(projection.currentStatus, null);
  assert.equal(projection.latestProof, null);
});

test('workspace aggregation exceptions return a bounded fail-closed projection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chatgpt-bridge-v1-'));
  const fileRoot = join(root, 'not-a-directory');
  await writeFile(fileRoot, 'occupied', 'utf8');
  try {
    const projection = await createSanitizedSharedWorkspaceProjection({
      workspaceRoot: fileRoot,
      repoRoot: process.cwd(),
      timestampUtc: '2026-07-13T00:00:00.000Z',
    });
    assert.equal(projection.aggregationOk, false);
    assert.equal(projection.aggregationReason, 'SHARED_WORKSPACE_AGGREGATION_FAILED');
    assert.equal(projection.aggregationVerdict, 'SHARED_WORKSPACE_AGGREGATION_BLOCKED');
    assert.equal(projection.currentGoal, null);
    assert.equal(projection.currentStatus, null);
    assert.equal(projection.latestProof, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('inert transport adapter never opens a socket and reports transport not configured', async () => {
  const transport = createInertChatGptBridgeTransportAdapter();
  assert.equal(transport.inert, true);
  assert.equal(transport.opensSocket, false);
  assert.equal(transport.bindsNetworkInterface, false);
  const response = await transport.send(validRequest());
  assert.equal(response.responseStatus, CHATGPT_BRIDGE_TRANSPORT_STATUS);
  assert.equal(CHATGPT_BRIDGE_RESPONSE_STATUSES.includes(CHATGPT_BRIDGE_TRANSPORT_STATUS), true);
});


test('scoped delivery reads require exact bounded subject identity', () => {
  const statusSubject = {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1668,
    mergeCommit: 'b83f7df46d9d52233f0b4f5dc2e034f50c0bae93',
    deploymentHead: 'c094260434fbe7cf35b9472f69ed07099216da0c',
    deploymentRequestId: 'req-1507-deploy-1668-20260806T1459Z',
    featureId: 'music-tile-auto-url-artwork',
  };
  const accepted = verify(validRequest({
    operation: 'READ_DELIVERY_STATUS',
    recordKind: CHATGPT_BRIDGE_RECORD_KINDS.DELIVERY_STATUS,
    boundedPayload: { statusSubject },
  }));
  assert.equal(accepted.responseStatus, 'BRIDGE_VERIFIED_PASS');
  assert.equal(CHATGPT_BRIDGE_OPERATION_RECORD_KIND_MAP.READ_DELIVERY_STATUS, CHATGPT_BRIDGE_RECORD_KINDS.DELIVERY_STATUS);

  const missingDeploymentHead = verify(validRequest({
    operation: 'READ_DELIVERY_STATUS',
    recordKind: CHATGPT_BRIDGE_RECORD_KINDS.DELIVERY_STATUS,
    boundedPayload: { statusSubject: { ...statusSubject, deploymentHead: undefined } },
  }));
  assert.equal(missingDeploymentHead.responseStatus, 'BLOCKED_PAYLOAD_UNSAFE');

  const rejected = verify(validRequest({
    operation: 'READ_DELIVERY_STATUS',
    recordKind: CHATGPT_BRIDGE_RECORD_KINDS.DELIVERY_STATUS,
    boundedPayload: { statusSubject: { ...statusSubject, command: 'dir' } },
  }));
  assert.equal(rejected.responseStatus, 'BLOCKED_PAYLOAD_UNSAFE');
});
