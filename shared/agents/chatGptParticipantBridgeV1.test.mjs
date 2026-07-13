import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHATGPT_BRIDGE_FORBIDDEN_OPERATIONS,
  CHATGPT_BRIDGE_MAX_PAYLOAD_BYTES,
  CHATGPT_BRIDGE_OPERATION_RECORD_KIND_MAP,
  CHATGPT_BRIDGE_READ_OPERATIONS,
  CHATGPT_BRIDGE_RECORD_KINDS,
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
  assert.deepEqual(CHATGPT_BRIDGE_READ_OPERATIONS, ['READ_CURRENT_STATUS', 'READ_LATEST_PROOF', 'READ_OPERATOR_ATTENTION']);
  assert.deepEqual(CHATGPT_BRIDGE_WRITE_OPERATIONS, [
    'WRITE_GOAL_INTENT_PROPOSAL',
    'WRITE_NEXT_ACTION_PACKET',
    'WRITE_BLOCKER_CLASSIFICATION',
    'WRITE_OPERATOR_ATTENTION_REQUEST',
    'WRITE_APPROVAL_REQUEST',
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
});

test('ChatGPT cannot create approval-result truth or self-approve operator decisions', () => {
  assert.equal(buildChatGptBridgeRecord(validRequest({ recordKind: 'approval-result' })).reason, 'BLOCKED_APPROVAL_REQUIRED');
  assert.deepEqual(verifyOperatorApprovalSeparation(validRequest({ approvalRef: 'approval-1' }), { participantId: CHATGPT_BRIDGE_PARTICIPANT_ID, approvalRef: 'approval-1', correlationId: 'issue-1506' }), { ok: false, responseStatus: 'BLOCKED_APPROVAL_MISMATCH' });
  assert.deepEqual(verifyOperatorApprovalSeparation(validRequest({ approvalRef: 'approval-1' }), { participantId: 'operator-stephan', approvalRef: 'approval-1', correlationId: 'issue-1506' }), { ok: true, responseStatus: 'BRIDGE_VERIFIED_PASS' });
});

test('bounded record builders preserve Shared Workspace boundaries without shell or source mutation access', () => {
  for (const [operation, recordKind] of Object.entries(CHATGPT_BRIDGE_OPERATION_RECORD_KIND_MAP)) {
    if (!operation.startsWith('WRITE_')) continue;
    const built = buildChatGptBridgeRecord(validRequest({ operation, recordKind, requestId: `request-${recordKind}` }));
    assert.equal(built.ok, true);
    assert.equal(built.record.channel, 'chatgpt-participant-bridge');
    assert.equal(built.record.participantId, CHATGPT_BRIDGE_PARTICIPANT_ID);
    assert.equal(built.record.body.includes('EXECUTE'), false);
  }
});

test('sanitized status/proof projection omits arbitrary filesystem and execution capability', async () => {
  const projection = await createSanitizedSharedWorkspaceProjection({
    timestampUtc: '2026-07-13T00:00:00.000Z',
    latest: {
      goal: { kind: 'goal', timestampUtc: '2026-07-13T00:00:00.000Z', title: 'Bridge V1', status: 'open' },
      status: { kind: 'status', timestampUtc: '2026-07-13T00:00:00.000Z', status: 'PASS', summary: 'Current.' },
      proof: { kind: 'proof', timestampUtc: '2026-07-13T00:00:00.000Z', status: 'PASS', summary: 'Proof.', proofRefs: ['proof/ok', '.env'] },
    },
  });
  assert.equal(projection.schemaVersion, CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION);
  assert.equal(projection.arbitraryFilesystemAccess, false);
  assert.equal(projection.commandExecutionAccess, false);
  assert.equal(projection.sourceMutationAccess, false);
  assert.deepEqual(projection.latestProof.proofRefs, ['proof/ok']);
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
