import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedWorkspaceProofRecord } from './sharedAgentWorkspaceStore.mjs';
import {
  CHATGPT_BRIDGE_PARTICIPANT_ID,
  CHATGPT_BRIDGE_RECORD_KINDS,
  CHATGPT_BRIDGE_READ_OPERATIONS,
  createChatGptBridgeRequest,
  createSanitizedSharedWorkspaceProjection,
  verifyChatGptBridgeRequest,
} from './chatGptParticipantBridgeV1.mjs';

const NOW = Date.parse('2026-10-27T16:00:00.000Z');
const OP = 'READ_PROOF_INDEX';
function request(overrides = {}) {
  return createChatGptBridgeRequest({
    requestId: 'read-proof-index-1290',
    timestampUtc: new Date(NOW).toISOString(),
    participantId: CHATGPT_BRIDGE_PARTICIPANT_ID,
    operation: OP,
    recordKind: CHATGPT_BRIDGE_RECORD_KINDS.PROOF_INDEX,
    relatedGoal: '#1290',
    correlationId: 'proof-index-1290',
    boundedPayload: {},
    expiryUtc: new Date(NOW + 300_000).toISOString(),
    ...overrides,
  });
}

test('READ_PROOF_INDEX is an authenticated bounded READ and cannot bypass expiry or become a write', () => {
  assert.ok(CHATGPT_BRIDGE_READ_OPERATIONS.includes(OP));
  assert.equal(CHATGPT_BRIDGE_RECORD_KINDS.PROOF_INDEX, 'proof-index-projection');
  const exact = request();
  assert.equal(verifyChatGptBridgeRequest(exact, { authenticated: true, transportConfigured: true, nowMs: NOW }).responseStatus, 'BRIDGE_VERIFIED_PASS');
  assert.equal(verifyChatGptBridgeRequest(exact, { authenticated: false, transportConfigured: true, nowMs: NOW }).responseStatus, 'BLOCKED_AUTHENTICATION_FAILED');
  assert.equal(verifyChatGptBridgeRequest(exact, { authenticated: true, transportConfigured: true, nowMs: NOW + 600_000 }).responseStatus, 'BLOCKED_EXPIRED_REQUEST');
  assert.equal(verifyChatGptBridgeRequest(request({recordKind:CHATGPT_BRIDGE_RECORD_KINDS.CURRENT_STATUS}), { authenticated: true, transportConfigured: true, nowMs: NOW }).responseStatus, 'BLOCKED_RECORD_KIND_NOT_ALLOWLISTED');
  assert.equal(verifyChatGptBridgeRequest(request({boundedPayload:{exec:'whoami'}}), {authenticated:true,transportConfigured:true,nowMs:NOW}).responseStatus, 'BRIDGE_VERIFIED_PASS');
  // The read request payload is never used as an execution or arbitrary file selector.
});

test('bridge uses already validated shared proof records without reading arbitrary paths', async () => {
  const record = createSharedWorkspaceProofRecord({
    proofId: 'proof-1290', participantId: 'stephanos', correlationId: 'proof-1290',
    timestampUtc: new Date(NOW - 30_000).toISOString(),
    relatedIssue: '#1290', relatedPr: '#3268',
    status: 'CLAIMED', summary: 'Evidence recorded', proofRefs: ['proof/proof-1290'],
  });
  const projection = await createSanitizedSharedWorkspaceProjection({
    latest: {},
    dashboardFeed: {
      proofIndex: { sourceAvailable: true },
      records: { proofRecords: [record] },
    },
    timestampUtc: new Date(NOW).toISOString(),
    nowMs: NOW,
  });
  assert.equal(projection.proofIndex.readOnly, true);
  assert.equal(projection.proofIndex.visibleCount, 1);
  assert.equal(projection.proofIndex.entries[0].verification, 'VALID_WORKSPACE_RECORD_NOT_INDEPENDENTLY_VERIFIED');
  assert.equal(projection.proofIndex.entries[0].approvalGranted, false);
  assert.equal(projection.proofIndex.independentVerificationPerformed, false);
  const missing = await createSanitizedSharedWorkspaceProjection({
    latest: {}, dashboardFeed: { records: { proofRecords: [record] } }, nowMs: NOW,
  });
  assert.equal(missing.proofIndex.state, 'UNAVAILABLE');
  assert.equal(missing.proofIndex.visibleCount, 0);
});
