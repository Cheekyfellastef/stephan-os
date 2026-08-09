import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSharedWorkspaceConversationConnectionRecord,
  createSharedWorkspaceMessageRecord,
  createAgentCapabilityRecord,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';

import {
  CHATGPT_SHARED_WORKSPACE_OWNER,
  CHATGPT_SHARED_WORKSPACE_REQUEST_COMMENT_ID,
  CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER,
  CHATGPT_SHARED_WORKSPACE_RESPONSE_COMMENT_ID,
  createFixedChatGptSharedWorkspaceGitHubAdapter,
  buildConversationReplyProjection,
  buildParticipantConnectionsProjection,
  loadConversationReply,
  loadParticipantConnectionReceipts,
  loadConversationTargetRegistration,
  parseChatGptSharedWorkspaceRequestComment,
  runChatGptSharedWorkspaceGitHubRelay,
  validateChatGptSharedWorkspaceResponseBody,
} from './chatgpt-shared-workspace-github-relay.mjs';

function envelope(request = null, state = request ? 'REQUEST_READY' : 'IDLE') {
  return `${CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER}
## Request
\`\`\`json
${JSON.stringify({ schemaVersion: 'chatgpt-participant-bridge.v1', state, request })}
\`\`\``;
}

function request(overrides = {}) {
  return {
    schemaVersion: 'chatgpt-participant-bridge.v1',
    requestId: 'request-live-1',
    timestampUtc: '2026-07-16T19:00:00.000Z',
    participantId: 'chatgpt-bridge',
    operation: 'READ_CURRENT_STATUS',
    recordKind: 'current-status-projection',
    relatedGoal: '#1506',
    relatedPr: '',
    correlationId: 'goal-1506-live-proof',
    boundedPayload: {},
    approvalRef: '',
    expiryUtc: '2026-07-16T20:00:00.000Z',
    redactionPolicy: 'sanitize-secrets-and-runtime-paths',
    ...overrides,
  };
}

function projection() {
  return {
    aggregationOk: true,
    aggregationReason: 'LATEST_STATUS_AGGREGATED',
    currentGoal: { title: 'Shared Workspace live proof' },
    currentStatus: { status: 'CURRENT', summary: 'runtime at C:\\Users\\Stephan\\private' },
    latestProof: { status: 'PASS', summary: 'proof ready' },
    freshnessUtc: '2026-07-16T19:10:00.000Z',
  };
}

function fakeWorkspace() {
  const records = new Map();
  const writes = [];
  const events = [];
  const keyFor = (segments) => segments.join('/');
  return {
    records,
    writes,
    events,
    recordExistsFn: async ({ segments }) => records.has(keyFor(segments)),
    receiptExistsFn: async ({ receiptId }) => records.has(`receipts/${receiptId}.json`),
    writeAtomicJsonFn: async (_root, segments, record) => {
      const entry = { segments, record };
      records.set(keyFor(segments), record);
      if (segments[0] === 'events') events.push(entry);
      else writes.push(entry);
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', bytes: 100 };
    },
  };
}

function baseOptions(workspace, adapter) {
  return {
    now: new Date('2026-07-16T19:10:00.000Z'),
    paths: { repoRoot: '/repo', workspaceRoot: '/shared' },
    adapter,
    receiptExistsFn: workspace.receiptExistsFn,
    recordExistsFn: workspace.recordExistsFn,
    writeAtomicJsonFn: workspace.writeAtomicJsonFn,
    headTruthEvidenceLoader: async () => ({ records: {
      sync: {
        timestampUtc: '2026-07-16T19:09:00.000Z',
        classification: 'SYNC_NO_CHANGE',
        localHeadBefore: 'a'.repeat(40),
        remoteHeadObserved: 'a'.repeat(40),
      },
    } }),
  };
}

test('parser accepts exactly one canonical request envelope and recognizes idle', () => {
  assert.equal(parseChatGptSharedWorkspaceRequestComment(envelope()).state, 'IDLE');
  const parsed = parseChatGptSharedWorkspaceRequestComment(envelope(request()));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state, 'REQUEST_READY');
  assert.equal(parsed.request.requestId, 'request-live-1');
  assert.equal(parseChatGptSharedWorkspaceRequestComment('no marker').reason, 'REQUEST_MARKER_MISSING');
});

test('fixed adapter uses only the two canonical GitHub comment endpoints without shell execution', () => {
  const calls = [];
  const spawnSyncFn = (command, args, options) => {
    calls.push({ command, args, options });
    if (args[0] === 'api' && args.length === 2) {
      return {
        status: 0,
        stdout: JSON.stringify({
          id: CHATGPT_SHARED_WORKSPACE_REQUEST_COMMENT_ID,
          body: envelope(),
          user: { login: CHATGPT_SHARED_WORKSPACE_OWNER },
          updated_at: '2026-07-16T19:00:00Z',
        }),
        stderr: '',
      };
    }
    return { status: 0, stdout: '{}', stderr: '' };
  };
  const adapter = createFixedChatGptSharedWorkspaceGitHubAdapter({ spawnSyncFn, ghCommand: 'gh.exe' });
  assert.equal(adapter.readRequest().ok, true);
  const response = '<!-- stephanos-chatgpt-shared-workspace-response-v1 -->\n```json\n{"ok":true}\n```';
  assert.equal(adapter.writeResponse(response).ok, true);

  assert.deepEqual(calls[0].args, [
    'api',
    `repos/Cheekyfellastef/stephan-os/issues/comments/${CHATGPT_SHARED_WORKSPACE_REQUEST_COMMENT_ID}`,
  ]);
  assert.deepEqual(calls[1].args.slice(0, 4), [
    'api',
    '--method',
    'PATCH',
    `repos/Cheekyfellastef/stephan-os/issues/comments/${CHATGPT_SHARED_WORKSPACE_RESPONSE_COMMENT_ID}`,
  ]);
  assert.equal(calls.every((call) => call.options.shell === false), true);
});

test('authenticated read publishes a sanitized projection, audit event and final completion receipt', async () => {
  let responseBody = '';
  const workspace = fakeWorkspace();
  const result = await runChatGptSharedWorkspaceGitHubRelay({
    ...baseOptions(workspace, {
      readRequest: () => ({
        ok: true,
        body: envelope(request()),
        authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER,
      }),
      writeResponse: (body) => {
        responseBody = body;
        return { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' };
      },
    }),
    headTruthEvidenceLoader: async () => ({ records: {} }),
    headTruthProjectionBuilder: () => ({
      aggregationOk: true,
      projectionKind: 'shared-workspace-head-truth',
      githubMainHead: 'a'.repeat(40),
      windowsCheckoutHead: 'a'.repeat(40),
      state: 'CURRENT',
      freshness: 'CURRENT',
    }),
    projectionBuilder: async () => projection(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_COMPLETED');
  assert.equal(result.deliveryStatus, 'WORKSPACE_READ_PASS');
  assert.equal(workspace.writes.length, 2);
  assert.deepEqual(workspace.writes[0].segments, ['receipts', 'chatgpt-bridge-request-live-1.json']);
  assert.deepEqual(workspace.writes[1].segments, ['receipts', `${result.completionReceiptId}.json`]);
  assert.equal(workspace.events.length, 1);
  assert.match(responseBody, /"projectionKind": "shared-workspace-head-truth"/);
  assert.match(responseBody, new RegExp(`"githubMainHead": "${'a'.repeat(40)}"`));
  assert.equal(responseBody.includes('C:\\Users\\Stephan'), false);
  assert.match(responseBody, /\[REDACTED\]/);
  assert.equal(validateChatGptSharedWorkspaceResponseBody(responseBody).valid, true);
});

test('current-status read uses canonical head truth and does not fall back to unrelated latest global status', async () => {
  let responseBody = '';
  let globalProjectionCalls = 0;
  const workspace = fakeWorkspace();
  const main = 'c'.repeat(40);
  const result = await runChatGptSharedWorkspaceGitHubRelay({
    ...baseOptions(workspace, {
      readRequest: () => ({ ok: true, body: envelope(request()), authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER }),
      writeResponse: (body) => { responseBody = body; return { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' }; },
    }),
    projectionBuilder: async () => { globalProjectionCalls += 1; return projection(); },
    headTruthEvidenceLoader: async () => ({ records: {
      sync: {
        timestampUtc: '2026-07-16T19:09:00.000Z',
        classification: 'SYNC_NO_CHANGE',
        localHeadBefore: main,
        remoteHeadObserved: main,
      },
    } }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.deliveryStatus, 'WORKSPACE_READ_PASS');
  assert.equal(globalProjectionCalls, 1);
  assert.match(responseBody, /"projectionKind": "shared-workspace-head-truth"/);
  assert.match(responseBody, new RegExp(`"windowsCheckoutHead": "${main}"`));
  assert.match(responseBody, /"sourceHeadsAgree": true/);
  assert.match(responseBody, /"currentStatus"/);
});

test('authenticated bounded write persists only the canonical message, audit, event and completion records', async () => {
  let responseBody = '';
  const workspace = fakeWorkspace();
  const result = await runChatGptSharedWorkspaceGitHubRelay(baseOptions(workspace, {
    readRequest: () => ({
      ok: true,
      body: envelope(request({
        operation: 'WRITE_NEXT_ACTION_PACKET',
        recordKind: 'next-action-packet',
        boundedPayload: { summary: 'Run the exact current proof lane.' },
      })),
      authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER,
    }),
    writeResponse: (body) => {
      responseBody = body;
      return { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' };
    },
  }));

  assert.equal(result.ok, true);
  assert.equal(result.deliveryStatus, 'WORKSPACE_WRITE_PASS');
  assert.equal(workspace.writes.length, 3);
  assert.deepEqual(workspace.writes[0].segments, ['inbox', 'request-live-1.json']);
  assert.deepEqual(workspace.writes[1].segments, ['receipts', 'chatgpt-bridge-request-live-1.json']);
  assert.deepEqual(workspace.writes[2].segments, ['receipts', `${result.completionReceiptId}.json`]);
  assert.equal(workspace.events.length, 1);
  assert.equal(workspace.writes[0].record.channel, 'chatgpt-participant-bridge');
  assert.match(responseBody, /"completed": true/);
});

test('conversation write persists one addressed Stephanos turn without granting execution authority', async () => {
  let responseBody = '';
  const workspace = fakeWorkspace();
  const boundedPayload = {
    conversationId: 'conversation-1506',
    threadId: 'thread-1506',
    requestMessageId: 'message-1506-1',
    requestedEntityId: 'openclaw',
    correlationId: 'turn-1506-1',
    body: 'Give a grounded conversational reply through Stephanos.',
    createdAtUtc: '2026-07-16T19:00:00.000Z',
    expiresAtUtc: '2026-07-16T19:20:00.000Z',
    expectedTargetSourceHead: 'a'.repeat(40),
  };
  const result = await runChatGptSharedWorkspaceGitHubRelay(baseOptions(workspace, {
    readRequest: () => ({
      ok: true,
      body: envelope(request({
        operation: 'WRITE_CONVERSATION_TURN',
        recordKind: 'conversation-turn',
        correlationId: boundedPayload.correlationId,
        boundedPayload,
      })),
      authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER,
    }),
    writeResponse: (body) => { responseBody = body; return { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' }; },
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(workspace.writes[0].segments, ['inbox', 'conversation-message-1506-1.json']);
  const record = workspace.writes[0].record;
  assert.equal(record.channel, 'stephanos-conversation');
  assert.equal(record.senderParticipantId, 'chatgpt');
  assert.equal(record.recipientParticipantId, 'stephanos');
  assert.equal(record.requestedEntityId, 'openclaw');
  assert.equal(record.deliveryState, 'QUEUED');
  assert.match(responseBody, /"commandExecutionAccess": false/);
  assert.match(responseBody, /"sourceMutationAccess": false/);
});

test('conversation reply reads require the exact responder, thread, reply-to, correlation and source head', async () => {
  const requestEnvelope = request({
    operation: 'READ_CONVERSATION_REPLY',
    recordKind: 'conversation-reply-projection',
    correlationId: 'turn-1506-1',
    boundedPayload: {
      conversationId: 'conversation-1506',
      threadId: 'thread-1506',
      requestMessageId: 'message-1506-1',
      requestedEntityId: 'openclaw',
      correlationId: 'turn-1506-1',
      expectedTargetSourceHead: 'a'.repeat(40),
    },
  });
  const reply = createSharedWorkspaceMessageRecord({
    messageId: 'message-1506-2',
    timestampUtc: '2026-07-16T19:09:00.000Z',
    participantId: 'openclaw',
    correlationId: 'turn-1506-1',
    relatedIssue: '#1506',
    proofRefs: ['receipts/openclaw-turn-1506-1'],
    channel: 'stephanos-conversation',
    senderParticipantId: 'openclaw',
    recipientParticipantId: 'chatgpt',
    requestedEntityId: 'openclaw',
    conversationId: 'conversation-1506',
    threadId: 'thread-1506',
    replyToMessageId: 'message-1506-1',
    deliveryState: 'REPLIED',
    originTimestampUtc: '2026-07-16T19:09:00.000Z',
    expiresAtUtc: '2026-07-16T19:15:00.000Z',
    expectedTargetSourceHead: 'a'.repeat(40),
    body: 'OpenClaw grounded reply.',
  });
  const readFileFn = async (file) => {
    assert.match(file.replace(/\\/g, '/'), /\/outbox\/conversation-reply-message-1506-1\.json$/);
    return JSON.stringify(reply);
  };
  const loaded = await loadConversationReply({
    workspaceRoot: '/shared', repoRoot: '/repo', request: requestEnvelope,
    nowMs: Date.parse('2026-07-16T19:10:00.000Z'), readFileFn,
  });
  assert.equal(loaded.ok, true);
  const projected = buildConversationReplyProjection({ loadStatus: loaded, request: requestEnvelope, timestampUtc: '2026-07-16T19:10:00.000Z' });
  assert.equal(projected.state, 'REPLIED');
  assert.equal(projected.reply.senderParticipantId, 'openclaw');
  assert.equal(projected.reply.replyToMessageId, 'message-1506-1');

  const mismatch = await loadConversationReply({
    workspaceRoot: '/shared', repoRoot: '/repo', request: { ...requestEnvelope, boundedPayload: { ...requestEnvelope.boundedPayload, threadId: 'wrong-thread' } },
    nowMs: Date.parse('2026-07-16T19:10:00.000Z'), readFileFn,
  });
  assert.equal(mismatch.reason, 'CONVERSATION_REPLY_IDENTITY_MISMATCH');
});

test('missing conversation reply is a terminal UNPROVEN projection, not a fabricated answer', async () => {
  let responseBody = '';
  const workspace = fakeWorkspace();
  const result = await runChatGptSharedWorkspaceGitHubRelay({
    ...baseOptions(workspace, {
      readRequest: () => ({
        ok: true,
        body: envelope(request({
          operation: 'READ_CONVERSATION_REPLY',
          recordKind: 'conversation-reply-projection',
          correlationId: 'turn-1506-1',
          boundedPayload: {
            conversationId: 'conversation-1506', threadId: 'thread-1506', requestMessageId: 'message-1506-1',
            requestedEntityId: 'codex', correlationId: 'turn-1506-1',
          },
        })),
        authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER,
      }),
      writeResponse: (body) => { responseBody = body; return { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' }; },
    }),
    conversationReplyLoader: async () => ({ ok: false, reason: 'CONVERSATION_REPLY_NOT_READY', record: null }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.deliveryStatus, 'WORKSPACE_READ_PASS');
  assert.match(responseBody, /"state": "UNPROVEN"/);
  assert.match(responseBody, /CONVERSATION_REPLY_NOT_READY/);
  assert.doesNotMatch(responseBody, /fabricated reply/i);
});

test('participant connection projection requires fresh authenticated exact-correlated round-trip receipts', async () => {
  const head = 'a'.repeat(40);
  const openClawReceipt = createSharedWorkspaceConversationConnectionRecord({
    connectionReceiptId: 'openclaw-conversation-current',
    participantId: 'openclaw',
    conversationAdapterId: 'openclaw-readonly-agent',
    timestampUtc: '2026-07-16T19:09:00.000Z',
    observedAtUtc: '2026-07-16T19:09:00.000Z',
    sourceHead: head,
    correlationId: 'conversation-roundtrip-openclaw',
    relatedIssue: '#1506',
    proofRefs: ['receipts/openclaw-conversation-roundtrip'],
    receiveProven: true,
    replyProven: true,
    exactCorrelationProven: true,
    authenticatedIdentityProven: true,
  });
  const loadStatus = await loadParticipantConnectionReceipts({
    workspaceRoot: '/shared',
    repoRoot: '/repo',
    participantIds: ['stephanos', 'openclaw', 'codex'],
    nowMs: Date.parse('2026-07-16T19:10:00.000Z'),
    readFileFn: async (file) => {
      if (file.includes('conversation-participant-openclaw-current.json')) return JSON.stringify(openClawReceipt);
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    },
  });
  const projection = buildParticipantConnectionsProjection({
    loadStatus,
    participantIds: ['stephanos', 'openclaw', 'codex'],
    nowMs: Date.parse('2026-07-16T19:10:00.000Z'),
  });
  assert.equal(projection.connections.find((entry) => entry.participant.participantId === 'openclaw').connection.state, 'CONNECTED');
  assert.equal(projection.connections.find((entry) => entry.participant.participantId === 'stephanos').connection.state, 'UNPROVEN');
  assert.equal(projection.connections.find((entry) => entry.participant.participantId === 'codex').connection.state, 'UNPROVEN');
  assert.equal(projection.allConnected, false);
  assert.equal(projection.loads.stephanos, 'CONVERSATION_CONNECTION_RECEIPT_MISSING');
});

test('future entities become routable only through a fresh exact capability record', async () => {
  const requestEnvelope = request({
    operation: 'WRITE_CONVERSATION_TURN',
    recordKind: 'conversation-turn',
    boundedPayload: {
      conversationId: 'conversation-1506',
      threadId: 'thread-1506',
      requestMessageId: 'message-1506-future',
      requestedEntityId: 'future-agent-42',
      targetCapabilityId: 'future-agent-42-adapter',
      correlationId: 'turn-1506-future',
      body: 'Join the canonical Stephanos conversation.',
      createdAtUtc: '2026-07-16T19:00:00.000Z',
      expiresAtUtc: '2026-07-16T19:20:00.000Z',
    },
  });
  const capability = createAgentCapabilityRecord({
    agentId: 'future-agent-42',
    timestampUtc: '2026-07-16T19:09:00.000Z',
    conversationAdapterId: 'future-agent-42-adapter',
    conversationOperations: ['RECEIVE_TURN', 'REPLY_TURN'],
    proofRefs: ['receipts/future-agent-42-capability'],
  });
  const registered = await loadConversationTargetRegistration({
    workspaceRoot: '/shared', repoRoot: '/repo', request: requestEnvelope,
    nowMs: Date.parse('2026-07-16T19:10:00.000Z'), readFileFn: async () => JSON.stringify(capability),
  });
  assert.equal(registered.registered, true);

  const mismatched = await loadConversationTargetRegistration({
    workspaceRoot: '/shared', repoRoot: '/repo', request: { ...requestEnvelope, boundedPayload: { ...requestEnvelope.boundedPayload, targetCapabilityId: 'wrong-adapter' } },
    nowMs: Date.parse('2026-07-16T19:10:00.000Z'), readFileFn: async () => JSON.stringify(capability),
  });
  assert.equal(mismatched.registered, false);
  assert.equal(mismatched.reason, 'CONVERSATION_TARGET_NOT_REGISTERED');
});

test('live participant connection read returns separate Stephanos, OpenClaw and Codex truth', async () => {
  let responseBody = '';
  const workspace = fakeWorkspace();
  const result = await runChatGptSharedWorkspaceGitHubRelay({
    ...baseOptions(workspace, {
      readRequest: () => ({
        ok: true,
        body: envelope(request({
          operation: 'READ_PARTICIPANT_CONNECTIONS',
          recordKind: 'participant-connections-projection',
          boundedPayload: {},
        })),
        authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER,
      }),
      writeResponse: (body) => { responseBody = body; return { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' }; },
    }),
    participantConnectionLoader: async () => ({
      receipts: [],
      loads: {
        stephanos: 'CONVERSATION_CONNECTION_RECEIPT_MISSING',
        openclaw: 'CONVERSATION_CONNECTION_RECEIPT_MISSING',
        codex: 'CONVERSATION_CONNECTION_RECEIPT_MISSING',
      },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.deliveryStatus, 'WORKSPACE_READ_PASS');
  assert.match(responseBody, /SHARED_CONVERSATION_CONNECTIONS_INCOMPLETE/);
  assert.match(responseBody, /CONVERSATION_CONNECTION_RECEIPT_MISSING/);
  assert.match(responseBody, /"participantId": "stephanos"/);
  assert.match(responseBody, /"participantId": "openclaw"/);
  assert.match(responseBody, /"participantId": "codex"/);
});

test('unsafe requests are rejected once, audited and projected without failing the watchdog lane', async () => {
  let responseBody = '';
  const workspace = fakeWorkspace();
  const adapter = {
    readRequest: () => ({
      ok: true,
      body: envelope(request({ operation: 'EXECUTE', recordKind: 'execute' })),
      authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER,
    }),
    writeResponse: (body) => {
      responseBody = body;
      return { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' };
    },
  };
  const first = await runChatGptSharedWorkspaceGitHubRelay(baseOptions(workspace, adapter));
  const second = await runChatGptSharedWorkspaceGitHubRelay(baseOptions(workspace, adapter));

  assert.equal(first.ok, true);
  assert.equal(first.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_REJECTED_SAFELY');
  assert.equal(first.verificationStatus, 'BLOCKED_OPERATION_NOT_ALLOWLISTED');
  assert.equal(second.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_ALREADY_PROCESSED');
  assert.equal(workspace.writes.length, 2);
  assert.equal(workspace.events.length, 1);
  assert.match(responseBody, /BLOCKED_OPERATION_NOT_ALLOWLISTED/);
});

test('an existing completion receipt is the only durable already-processed marker', async () => {
  let responseWrites = 0;
  const workspace = fakeWorkspace();
  const result = await runChatGptSharedWorkspaceGitHubRelay({
    ...baseOptions(workspace, {
      readRequest: () => ({
        ok: true,
        body: envelope(request()),
        authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER,
      }),
      writeResponse: () => {
        responseWrites += 1;
        return { ok: true };
      },
    }),
    receiptExistsFn: async () => true,
    projectionBuilder: async () => projection(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_ALREADY_PROCESSED');
  assert.equal(responseWrites, 0);
  assert.equal(workspace.writes.length, 0);
});

test('response publication failure resumes from persisted audit and event without duplicating either', async () => {
  const workspace = fakeWorkspace();
  let responseAttempts = 0;
  const adapter = {
    readRequest: () => ({
      ok: true,
      body: envelope(request()),
      authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER,
    }),
    writeResponse: () => {
      responseAttempts += 1;
      return responseAttempts === 1
        ? { ok: false, reason: 'RESPONSE_COMMENT_WRITE_FAILED' }
        : { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' };
    },
  };

  const first = await runChatGptSharedWorkspaceGitHubRelay({
    ...baseOptions(workspace, adapter),
    projectionBuilder: async () => projection(),
  });
  const second = await runChatGptSharedWorkspaceGitHubRelay({
    ...baseOptions(workspace, adapter),
    projectionBuilder: async () => projection(),
  });

  assert.equal(first.ok, false);
  assert.equal(first.classification, 'CHATGPT_SHARED_WORKSPACE_RELAY_FAILED');
  assert.equal(first.completionWrite.ok, false);
  assert.equal(second.ok, true);
  assert.equal(second.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_COMPLETED');
  assert.equal(responseAttempts, 2);
  assert.equal(workspace.events.length, 1);
  assert.equal(workspace.writes.filter((entry) => entry.segments[0] === 'receipts').length, 2);
});

test('event persistence failure retries the missing event and does not mark completion early', async () => {
  const workspace = fakeWorkspace();
  let eventAttempts = 0;
  const baseWrite = workspace.writeAtomicJsonFn;
  const flakyWrite = async (root, segments, record, options) => {
    if (segments[0] === 'events') {
      eventAttempts += 1;
      if (eventAttempts === 1) return { ok: false, reason: 'EVENT_WRITE_FAILED', bytes: 0 };
    }
    return baseWrite(root, segments, record, options);
  };
  const adapter = {
    readRequest: () => ({
      ok: true,
      body: envelope(request()),
      authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER,
    }),
    writeResponse: () => ({ ok: true, reason: 'RESPONSE_COMMENT_UPDATED' }),
  };

  const first = await runChatGptSharedWorkspaceGitHubRelay({
    ...baseOptions(workspace, adapter),
    projectionBuilder: async () => projection(),
    writeAtomicJsonFn: flakyWrite,
  });
  const second = await runChatGptSharedWorkspaceGitHubRelay({
    ...baseOptions(workspace, adapter),
    projectionBuilder: async () => projection(),
    writeAtomicJsonFn: flakyWrite,
  });

  assert.equal(first.ok, false);
  assert.equal(first.eventWrite.ok, false);
  assert.equal(first.completionWrite.ok, false);
  assert.equal(second.ok, true);
  assert.equal(eventAttempts, 2);
  assert.equal(workspace.events.length, 1);
});

test('unchanged malformed request bodies are rejected once without unbounded event or response churn', async () => {
  const workspace = fakeWorkspace();
  let responseWrites = 0;
  const malformed = `${CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER}\n\`\`\`json\n{not-json}\n\`\`\``;
  const adapter = {
    readRequest: () => ({
      ok: true,
      body: malformed,
      authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER,
    }),
    writeResponse: () => {
      responseWrites += 1;
      return { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' };
    },
  };

  const first = await runChatGptSharedWorkspaceGitHubRelay(baseOptions(workspace, adapter));
  const second = await runChatGptSharedWorkspaceGitHubRelay(baseOptions(workspace, adapter));

  assert.equal(first.ok, true);
  assert.equal(first.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_REJECTED_SAFELY');
  assert.equal(first.deliveryStatus, 'REQUEST_JSON_INVALID');
  assert.equal(second.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_ALREADY_PROCESSED');
  assert.equal(responseWrites, 1);
  assert.equal(workspace.events.length, 1);
  assert.equal(workspace.writes.filter((entry) => entry.segments[0] === 'receipts').length, 2);
});


test('scoped delivery read uses exact subject evidence rather than the unrelated latest global status', async () => {
  let responseBody = '';
  let globalProjectionCalls = 0;
  const workspace = fakeWorkspace();
  const statusSubject = {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1668,
    mergeCommit: 'b83f7df46d9d52233f0b4f5dc2e034f50c0bae93',
    deploymentHead: 'c094260434fbe7cf35b9472f69ed07099216da0c',
    deploymentRequestId: 'req-1507-deploy-1668-20260806T1459Z',
    featureId: 'music-tile-auto-url-artwork',
  };
  const result = await runChatGptSharedWorkspaceGitHubRelay({
    ...baseOptions(workspace, {
      readRequest: () => ({
        ok: true,
        body: envelope(request({
          operation: 'READ_DELIVERY_STATUS',
          recordKind: 'delivery-status-projection',
          relatedGoal: '#1507',
          relatedPr: '#1668',
          boundedPayload: { statusSubject },
        })),
        authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER,
      }),
      writeResponse: (body) => {
        responseBody = body;
        return { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' };
      },
    }),
    projectionBuilder: async () => {
      globalProjectionCalls += 1;
      return projection();
    },
    deliveryEvidenceLoader: async () => ({
      ok: true,
      reason: 'SCOPED_DELIVERY_EVIDENCE_LOADED',
      records: [{
        schemaVersion: 'stephanos.runtime-proof.v1',
        recordId: 'music-live',
        timestampUtc: '2026-07-16T19:09:00.000Z',
        repository: statusSubject.repository,
        relatedPr: '#1668',
        mergeCommit: statusSubject.mergeCommit,
        deploymentHead: statusSubject.deploymentHead,
        correlationId: statusSubject.deploymentRequestId,
        featureId: statusSubject.featureId,
        servedBrowserHead: statusSubject.deploymentHead,
        updatedMusicTileServed: true,
        playbackContinuedAfterRating: true,
        autoUrlAndArtworkRuntimeProof: true,
        status: 'SOURCE_AND_RUNTIME_EXACT_HEAD',
        proofRefs: ['proof/music-live.json'],
      }],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.deliveryStatus, 'WORKSPACE_READ_PASS');
  assert.equal(globalProjectionCalls, 0);
  assert.match(responseBody, /"projectionKind": "scoped-delivery-status"/);
  assert.match(responseBody, /"overallStatus": "LIVE"/);
  assert.match(responseBody, /"live": true/);
  assert.doesNotMatch(responseBody, /Programme controller is STARTING/);
});
