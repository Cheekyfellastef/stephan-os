import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSovereignCommanderMcpHandler } from '../../scripts/sovereign-commander-mcp.mjs';
import { executeSovereignCommanderCommandV1, captureSovereignPrivateSessionArgumentsV1 } from './sovereignCommanderV1.mjs';
import { buildStephanosExecutionCommandEnvelopeV1, STEPHANOS_EXECUTION_SURFACE } from './stephanosExecutionCommandFabricV1.mjs';

const local = { id: 1, isRequest: true, isNotification: false,
  transportKind: 'local-stdio-mcp', transportAuthenticated: false };
const http = { ...local, transportKind: 'authenticated-http-jsonrpc', transportAuthenticated: true };
const names = ['start_search', 'get_more_search_results', 'stop_search', 'list_searches',
  'get_usage_stats', 'get_recent_tool_calls', 'get_tool_result', 'list_remote_tool_calls'];
const call = (handler, name, args = {}, transport = local) => handler('tools/call', { name, arguments: args }, transport);
const value = response => response.structuredContent.structuredContent;
async function ready(options = {}) {
  const handler = createSovereignCommanderMcpHandler(options);
  await handler('initialize', {}, local);
  await handler('notifications/initialized', {}, { isNotification: true, isRequest: false });
  const listed = await handler('tools/list', {}, local);
  return { handler, listed };
}

test('new session tools are discoverable but require a real private request before execution', async () => {
  let calls = 0;
  const { handler, listed } = await ready({ executor: async () => { calls++; return { ok: true }; } });
  try {
    for (const name of names) assert.ok(listed.tools.some(tool => tool.name === name), name);
    for (const transport of [{ id: 1, isRequest: true }, { ...http, transportAuthenticated: false },
      { ...local, isRequest: false, isNotification: true }, { ...http, transportKind: 'public-mailbox' }]) {
      const denied = await call(handler, 'get_usage_stats', {}, transport);
      assert.equal(denied.isError, true);
      assert.equal(denied.structuredContent.blocker, 'SOVEREIGN_PRIVATE_SESSION_REQUIRED');
    }
    assert.equal(calls, 0);
    assert.equal((await call(handler, 'get_usage_stats', {}, local)).isError, false);
    assert.equal((await call(handler, 'get_usage_stats', {}, http)).isError, false);
    assert.equal(calls, 2);
  } finally { await handler.close(); }
});

test('session input rejects authority extras, accessors, symbols and coerced numbers without observing them', async () => {
  let calls = 0;
  const { handler } = await ready({ executor: async () => { calls++; return { ok: true }; } });
  try {
    for (const args of [null, [], Object.create({ offset: 0 }), { offset: '0' }, { limit: 51 },
      { offset: -1 }, { offset: 257 }, { path: 'C:\\outside' }, { sessionId: 'other' },
      { get limit() { throw Error('accessor must not execute'); } }, { [Symbol('authority')]: true }]) {
      const denied = await call(handler, 'get_recent_tool_calls', args);
      assert.equal(denied.isError, true);
      assert.equal(denied.structuredContent.blocker, 'SOVEREIGN_PRIVATE_SESSION_ARGUMENTS_INVALID');
    }
    assert.equal(calls, 0);
    assert.equal(captureSovereignPrivateSessionArgumentsV1('START_SEARCH',
      { path: ' C:\\scope', query: 'x' }), null);
    assert.equal(captureSovereignPrivateSessionArgumentsV1('START_SEARCH',
      { path: 'C:\\scope', query: 'x', command: 'powershell' }), null);
  } finally { await handler.close(); }
});

test('canonical executor binds search scope and cannot execute session tools through another carrier', async () => {
  let called = 0;
  const envelope = buildStephanosExecutionCommandEnvelopeV1({
    surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
    actionId: 'fixture-action', missionId: 'fixture-session', relatedIssue: '#2573',
    operation: 'START_SEARCH', targetPaths: ['C:\\scope'], payload: { path: 'C:\\scope', query: 'needle' },
  });
  const searchSessions = { execute: async (operation, args) => {
    called++; assert.equal(operation, 'START_SEARCH'); assert.equal(args.path, 'C:\\scope');
    return { ok: true, status: 'RUNNING', complete: false };
  } };
  for (const options of [{}, { searchSessions }, { searchSessions,
    routeProof: { mcpSessionReady: true, commandPathProven: true, transport: 'public-mailbox', authenticatedMcp: true } }]) {
    assert.equal((await executeSovereignCommanderCommandV1(envelope, options)).blocker, 'SOVEREIGN_PRIVATE_SESSION_REQUIRED');
  }
  assert.equal(called, 0);
  const options = { searchSessions, routeProof: { mcpSessionReady: true, commandPathProven: true,
    transport: 'local-stdio-mcp', authenticatedMcp: false } };
  const allowed = await executeSovereignCommanderCommandV1(envelope, options);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.structuredContent.status, 'RUNNING');
  assert.equal(allowed.structuredContent.complete, false);
  assert.equal(allowed.command.mergeAuthority, false);
  assert.equal(allowed.command.pcRestartAuthority, false);
  assert.match(allowed.proofHash, /^[a-f0-9]{64}$/);
  assert.equal((await executeSovereignCommanderCommandV1({ ...envelope, targetPaths: ['C:\\other'] }, options)).ok, false);
  assert.equal(called, 1);
});

test('real private file receipt is retrieved without replay and remains inaccessible to another handler', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sovereign-history-integration-'));
  const file = join(root, 'private.txt');
  const secretMarker = 'LOCAL_FIXTURE_PRIVATE_CONTENT';
  await writeFile(file, secretMarker);
  const first = await ready(), second = await ready();
  try {
    const original = await call(first.handler, 'read_file', { path: file });
    assert.equal(original.isError, false);
    const callId = original.structuredContent.command.commandId;
    const listing = value(await call(first.handler, 'get_recent_tool_calls'));
    assert.equal(listing.calls.length, 1);
    assert.equal(listing.calls[0].callId, callId);
    assert.equal(JSON.stringify(listing).includes(secretMarker), false);
    assert.equal(JSON.stringify(listing).includes(file), false);
    assert.equal(listing.calls[0].nativeOutcome, 'UNKNOWN');
    await writeFile(file, 'changed after execution');
    const retained = value(await call(first.handler, 'get_tool_result', { callId }));
    assert.equal(retained.resultAvailable, true);
    assert.equal(retained.result.contentText, secretMarker);
    assert.equal(retained.independentlyVerified, false);
    assert.equal((await call(second.handler, 'get_tool_result', { callId })).isError, true);
    assert.equal(value(await call(first.handler, 'list_remote_tool_calls')).calls.length, 0);
    const stats = value(await call(first.handler, 'get_usage_stats'));
    assert.equal(stats.counters.recordedToolCalls, 1, 'history queries do not recursively fill history');
    assert.equal(stats.billingUsage, 'NOT_OBSERVED');
  } finally {
    await first.handler.close(); await second.handler.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('HTTP receipt history is session-local and failed actions expose only metadata', async () => {
  const { handler } = await ready({ executor: async (envelope, options) => {
    if (envelope.operation.startsWith('GET_') || envelope.operation === 'LIST_REMOTE_TOOL_CALLS')
      return executeSovereignCommanderCommandV1(envelope, options);
    return { ok: false, blocker: 'PRIVATE_ERROR_LOCATION', contentText: 'PRIVATE_ERROR_CONTENT' };
  } });
  try {
    await call(handler, 'read_file', { path: 'C:\\private' }, http);
    const listing = value(await call(handler, 'list_remote_tool_calls', {}, http));
    assert.equal(listing.calls.length, 1);
    assert.equal(listing.calls[0].responseOk, false);
    assert.equal(listing.calls[0].resultAvailable, false);
    assert.equal(JSON.stringify(listing).includes('PRIVATE_ERROR'), false);
  } finally { await handler.close(); }
});

test('advisory history failure cannot replace original action receipts or release custody', async () => {
  const original = Object.freeze({ ok: true, executionCustodyReleased: false, proofHash: 'a'.repeat(64) });
  const { handler } = await ready({ executor: async () => original,
    sessionHistoryFactory: () => ({ begin: () => ({ recorded: true }), finish: () => { throw Error('cache failure'); },
      execute: () => ({ ok: false }), dispose() {} }) });
  try {
    const received = await call(handler, 'get_config');
    assert.equal(received.structuredContent, original);
    assert.equal(received.structuredContent.executionCustodyReleased, false);
  } finally { await handler.close(); }
});

test('transport close disposes only private session state and refuses reuse', async () => {
  let searchClosed = 0, historyClosed = 0;
  const { handler } = await ready({
    searchSessionsFactory: () => ({ execute: () => ({ ok: true }), dispose: () => { searchClosed++; } }),
    sessionHistoryFactory: () => ({ begin: () => ({ recorded: false }), finish() {}, execute: () => ({ ok: true }),
      dispose: () => { historyClosed++; } }),
  });
  await handler.close(); await handler.close();
  assert.equal(searchClosed, 1); assert.equal(historyClosed, 1);
  await assert.rejects(call(handler, 'get_usage_stats'), /MCP_SESSION_CLOSED/);
});
