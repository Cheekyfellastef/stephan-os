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

function fakeWriters() {
  const writes = [];
  const events = [];
  return {
    writes,
    events,
    writeAtomicJsonFn: async (_root, segments, record) => {
      writes.push({ segments, record });
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', bytes: 100 };
    },
    appendWorkspaceJsonlFn: async (_root, segments, record) => {
      events.push({ segments, record });
      return { ok: true, reason: 'JSONL_EVENT_APPENDED', bytes: 100 };
    },
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

test('authenticated read publishes a sanitized projection and durable audit receipt', async () => {
  let responseBody = '';
  const writers = fakeWriters();
  const result = await runChatGptSharedWorkspaceGitHubRelay({
    now: new Date('2026-07-16T19:10:00.000Z'),
    paths: { repoRoot: '/repo', workspaceRoot: '/shared' },
    adapter: {
      readRequest: () => ({
        ok: true,
        body: envelope(request()),
        authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER,
      }),
      writeResponse: (body) => {
        responseBody = body;
        return { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' };
      },
    },
    receiptExistsFn: async () => false,
    projectionBuilder: async () => ({
      aggregationOk: true,
      aggregationReason: 'LATEST_STATUS_AGGREGATED',
      currentGoal: { title: 'Shared Workspace live proof' },
      currentStatus: { status: 'CURRENT', summary: 'runtime at C:\\Users\\Stephan\\private' },
      latestProof: { status: 'PASS', summary: 'proof ready' },
      freshnessUtc: '2026-07-16T19:10:00.000Z',
    }),
    writeAtomicJsonFn: writers.writeAtomicJsonFn,
    appendWorkspaceJsonlFn: writers.appendWorkspaceJsonlFn,
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_COMPLETED');
  assert.equal(result.deliveryStatus, 'WORKSPACE_READ_PASS');
  assert.equal(writers.writes.length, 1);
  assert.deepEqual(writers.writes[0].segments, ['receipts', 'chatgpt-bridge-request-live-1.json']);
  assert.equal(writers.events.length, 1);
  assert.equal(responseBody.includes('C:\\Users\\Stephan'), false);
  assert.match(responseBody, /\[REDACTED\]/);
  assert.equal(validateChatGptSharedWorkspaceResponseBody(responseBody).valid, true);
});

test('authenticated bounded write persists only the canonical message, receipt and event', async () => {
  let responseBody = '';
  const writers = fakeWriters();
  const result = await runChatGptSharedWorkspaceGitHubRelay({
    now: new Date('2026-07-16T19:10:00.000Z'),
    paths: { repoRoot: '/repo', workspaceRoot: '/shared' },
    adapter: {
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
    },
    receiptExistsFn: async () => false,
    writeAtomicJsonFn: writers.writeAtomicJsonFn,
    appendWorkspaceJsonlFn: writers.appendWorkspaceJsonlFn,
  });

  assert.equal(result.ok, true);
  assert.equal(result.deliveryStatus, 'WORKSPACE_WRITE_PASS');
  assert.equal(writers.writes.length, 2);
  assert.deepEqual(writers.writes[0].segments, ['inbox', 'request-live-1.json']);
  assert.deepEqual(writers.writes[1].segments, ['receipts', 'chatgpt-bridge-request-live-1.json']);
  assert.equal(writers.writes[0].record.channel, 'chatgpt-participant-bridge');
  assert.match(responseBody, /"completed": true/);
});

test('unsafe requests are rejected, audited and projected without failing the watchdog lane', async () => {
  let responseBody = '';
  const writers = fakeWriters();
  const result = await runChatGptSharedWorkspaceGitHubRelay({
    now: new Date('2026-07-16T19:10:00.000Z'),
    paths: { repoRoot: '/repo', workspaceRoot: '/shared' },
    adapter: {
      readRequest: () => ({
        ok: true,
        body: envelope(request({ operation: 'EXECUTE', recordKind: 'execute' })),
        authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER,
      }),
      writeResponse: (body) => {
        responseBody = body;
        return { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' };
      },
    },
    receiptExistsFn: async () => false,
    writeAtomicJsonFn: writers.writeAtomicJsonFn,
    appendWorkspaceJsonlFn: writers.appendWorkspaceJsonlFn,
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_REJECTED_SAFELY');
  assert.equal(result.verificationStatus, 'BLOCKED_OPERATION_NOT_ALLOWLISTED');
  assert.equal(writers.writes.length, 1);
  assert.match(responseBody, /BLOCKED_OPERATION_NOT_ALLOWLISTED/);
});

test('an already receipted request is not executed or published again', async () => {
  let responseWrites = 0;
  const writers = fakeWriters();
  const result = await runChatGptSharedWorkspaceGitHubRelay({
    now: new Date('2026-07-16T19:10:00.000Z'),
    paths: { repoRoot: '/repo', workspaceRoot: '/shared' },
    adapter: {
      readRequest: () => ({
        ok: true,
        body: envelope(request()),
        authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER,
      }),
      writeResponse: () => {
        responseWrites += 1;
        return { ok: true };
      },
    },
    receiptExistsFn: async () => true,
    writeAtomicJsonFn: writers.writeAtomicJsonFn,
    appendWorkspaceJsonlFn: writers.appendWorkspaceJsonlFn,
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_ALREADY_PROCESSED');
  assert.equal(responseWrites, 0);
  assert.equal(writers.writes.length, 0);
});
