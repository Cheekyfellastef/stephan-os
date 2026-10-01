import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHATGPT_BRIDGE_PARTICIPANT_ID,
  CHATGPT_BRIDGE_SHARED_CONVERSATION_TURN_OPERATION,
  CHATGPT_BRIDGE_SHARED_CONVERSATION_TURN_RECORD_KIND,
  CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION,
} from './chatGptParticipantBridgeV1.mjs';
import { createStephanosSharedConversationTurnRecord } from './stephanosSharedConversationThreadV1.mjs';
import {
  CHATGPT_SHARED_WORKSPACE_OWNER,
  CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER,
  runChatGptSharedWorkspaceGitHubRelay,
} from '../../scripts/chatgpt-shared-workspace-github-relay.mjs';

const NOW = new Date('2026-09-25T18:30:00.000Z');

function envelope(request) {
  return `${CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER}\n## Request\n\`\`\`json\n${JSON.stringify({
    schemaVersion: CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION,
    state: 'REQUEST_READY',
    request,
  })}\n\`\`\``;
}

function canonicalTurn({ senderParticipantId = 'operator', turnId = 'turn-001', text = 'Remember the current shared-chat intent.', replyToTurnId = '' } = {}) {
  const built = createStephanosSharedConversationTurnRecord({
    threadId: 'shared-thread-1290',
    turnId,
    senderParticipantId,
    replyToTurnId,
    text,
    timestampUtc: NOW.toISOString(),
  }, {
    relatedIssue: '#1290',
    relatedPr: '',
    proofRefs: [`receipts/source-${turnId}`],
    workspaceValidationOptions: { nowMs: NOW.getTime() },
  });
  assert.equal(built.valid, true, built.errors.join(', '));
  return built.record;
}

function requestFor(turnRecord, overrides = {}) {
  return {
    schemaVersion: CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION,
    requestId: `request-${turnRecord.subjectId}`,
    timestampUtc: NOW.toISOString(),
    participantId: CHATGPT_BRIDGE_PARTICIPANT_ID,
    operation: CHATGPT_BRIDGE_SHARED_CONVERSATION_TURN_OPERATION,
    recordKind: CHATGPT_BRIDGE_SHARED_CONVERSATION_TURN_RECORD_KIND,
    relatedGoal: turnRecord.relatedIssue,
    relatedPr: turnRecord.relatedPr,
    correlationId: turnRecord.correlationId,
    boundedPayload: {
      turnRecord,
      transportAttestation: {
        sourceSurface: 'chatgpt-web',
        sourceMessageId: `source-${turnRecord.subjectId}`,
        operatorAuthored: turnRecord.participantId === 'operator',
      },
    },
    approvalRef: '',
    expiryUtc: new Date(NOW.getTime() + 10 * 60 * 1000).toISOString(),
    redactionPolicy: 'sanitize-secrets-and-runtime-paths',
    ...overrides,
  };
}

function fakeWorkspace() {
  const records = new Map();
  const writes = [];
  const keyFor = (segments) => segments.join('/');
  return {
    records,
    writes,
    receiptExistsFn: async ({ receiptId }) => records.has(`receipts/${receiptId}.json`),
    recordExistsFn: async ({ segments }) => records.has(keyFor(segments)),
    readWorkspaceRecordFn: async ({ segments }) => {
      const key = keyFor(segments);
      return records.has(key)
        ? { ok: true, reason: 'WORKSPACE_RECORD_READ', record: records.get(key) }
        : { ok: false, reason: 'WORKSPACE_RECORD_NOT_FOUND', record: null };
    },
    writeAtomicJsonFn: async (_root, segments, record) => {
      const key = keyFor(segments);
      records.set(key, record);
      writes.push({ segments, record });
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', bytes: 100 };
    },
  };
}

function relayOptions(workspace, request, writeResponse = () => ({ ok: true, reason: 'RESPONSE_COMMENT_UPDATED' })) {
  return {
    now: NOW,
    paths: { repoRoot: '/repo', workspaceRoot: '/shared' },
    adapter: {
      readRequest: () => ({ ok: true, body: envelope(request), authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER }),
      writeResponse,
    },
    receiptExistsFn: workspace.receiptExistsFn,
    recordExistsFn: workspace.recordExistsFn,
    readWorkspaceRecordFn: workspace.readWorkspaceRecordFn,
    writeAtomicJsonFn: workspace.writeAtomicJsonFn,
  };
}

test('operator-authored shared turn persists once with canonical thread lineage and zero authority', async () => {
  const workspace = fakeWorkspace();
  const turnRecord = canonicalTurn();
  const result = await runChatGptSharedWorkspaceGitHubRelay(
    relayOptions(workspace, requestFor(turnRecord)),
  );

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_COMPLETED');
  assert.equal(result.verificationStatus, 'BRIDGE_VERIFIED_PASS');
  assert.equal(result.deliveryStatus, 'WORKSPACE_SHARED_TURN_PASS');
  const turnWrites = workspace.writes.filter((entry) =>
    entry.segments[0] === 'inbox' && /^shared-turn-/.test(entry.segments[1]));
  assert.equal(turnWrites.length, 1);
  assert.equal(turnWrites[0].record.correlationId, 'shared-thread-1290');
  assert.equal(turnWrites[0].record.participantId, 'operator');
  assert.equal(turnWrites[0].record.sourceMutationAllowed, false);
  assert.equal(turnWrites[0].record.commandExecutionAllowed, false);
  assert.equal(turnWrites[0].record.approvalAllowed, false);
  assert.equal(turnWrites[0].record.mergeAllowed, false);
  assert.equal(turnWrites[0].record.deploymentAllowed, false);
});

test('ChatGPT-authored shared turn uses the same durable conversation thread without impersonating the operator', async () => {
  const workspace = fakeWorkspace();
  const turnRecord = canonicalTurn({
    senderParticipantId: 'chatgpt-bridge',
    turnId: 'turn-002',
    text: 'I have added evidence about the current build lane.',
  });
  const result = await runChatGptSharedWorkspaceGitHubRelay(
    relayOptions(workspace, requestFor(turnRecord)),
  );

  assert.equal(result.ok, true);
  assert.equal(result.deliveryStatus, 'WORKSPACE_SHARED_TURN_PASS');
  const turnWrite = workspace.writes.find((entry) =>
    entry.segments[0] === 'inbox' && /^shared-turn-/.test(entry.segments[1]));
  assert.equal(turnWrite.record.participantId, CHATGPT_BRIDGE_PARTICIPANT_ID);
  assert.equal(requestFor(turnRecord).boundedPayload.transportAttestation.operatorAuthored, false);
});

test('request/thread mismatch fails closed before any conversation turn is persisted', async () => {
  const workspace = fakeWorkspace();
  const turnRecord = canonicalTurn();
  const request = requestFor(turnRecord, { correlationId: 'wrong-thread-1290' });
  const result = await runChatGptSharedWorkspaceGitHubRelay(relayOptions(workspace, request));

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_REJECTED_SAFELY');
  assert.equal(result.deliveryStatus, 'WORKSPACE_SHARED_TURN_LINEAGE_REJECTED');
  assert.equal(
    workspace.writes.some((entry) => entry.segments[0] === 'inbox' && /^shared-turn-/.test(entry.segments[1])),
    false,
  );
});

test('response retry resumes the already persisted shared turn without duplicating it', async () => {
  const workspace = fakeWorkspace();
  const turnRecord = canonicalTurn();
  const request = requestFor(turnRecord);
  let attempts = 0;
  const options = relayOptions(workspace, request, () => {
    attempts += 1;
    return attempts === 1
      ? { ok: false, reason: 'RESPONSE_COMMENT_WRITE_FAILED' }
      : { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' };
  });

  const first = await runChatGptSharedWorkspaceGitHubRelay(options);
  const second = await runChatGptSharedWorkspaceGitHubRelay(options);

  assert.equal(first.deliveryStatus, 'WORKSPACE_SHARED_TURN_PASS');
  assert.equal(first.ok, false);
  assert.equal(second.ok, true);
  assert.equal(second.primaryWrite.reason, 'WORKSPACE_RECORD_ALREADY_PERSISTED');
  assert.equal(
    workspace.writes.filter((entry) => entry.segments[0] === 'inbox' && /^shared-turn-/.test(entry.segments[1])).length,
    1,
  );
});
