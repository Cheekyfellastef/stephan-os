import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHATGPT_SHARED_WORKSPACE_OWNER,
  CHATGPT_SHARED_WORKSPACE_REQUEST_COMMENT_ID,
  CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER,
  CHATGPT_SHARED_WORKSPACE_RESPONSE_COMMENT_ID,
  createFixedChatGptSharedWorkspaceGitHubAdapter,
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
    projectionBuilder: async () => projection(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_COMPLETED');
  assert.equal(result.deliveryStatus, 'WORKSPACE_READ_PASS');
  assert.equal(workspace.writes.length, 2);
  assert.deepEqual(workspace.writes[0].segments, ['receipts', 'chatgpt-bridge-request-live-1.json']);
  assert.deepEqual(workspace.writes[1].segments, ['receipts', `${result.completionReceiptId}.json`]);
  assert.equal(workspace.events.length, 1);
  assert.equal(responseBody.includes('C:\\Users\\Stephan'), false);
  assert.match(responseBody, /\[REDACTED\]/);
  assert.equal(validateChatGptSharedWorkspaceResponseBody(responseBody).valid, true);
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
