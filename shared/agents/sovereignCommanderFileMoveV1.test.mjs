import test from 'node:test';
import assert from 'node:assert/strict';
import { createSovereignCommanderMcpHandler } from '../../scripts/sovereign-commander-mcp.mjs';
import { executeSovereignCommanderCommandV1 } from './sovereignCommanderV1.mjs';
import { buildStephanosExecutionCommandEnvelopeV1, STEPHANOS_EXECUTION_SURFACE } from './stephanosExecutionCommandFabricV1.mjs';

const local = { id: 1, isRequest: true, isNotification: false,
  transportKind: 'local-stdio-mcp', transportAuthenticated: false };
const http = { ...local, transportKind: 'authenticated-http-jsonrpc', transportAuthenticated: true };
const args = Object.freeze({ source: 'C:\\SovereignFixture\\old.txt',
  destination: 'C:\\SovereignFixture\\new.txt', expectedSha256: 'a'.repeat(64) });
const call = (handler, name, arguments_ = {}, transport = local) =>
  handler('tools/call', { name, arguments: arguments_ }, transport);
const value = response => response.structuredContent.structuredContent;
async function ready(options = {}) {
  const handler = createSovereignCommanderMcpHandler(options);
  await handler('initialize', {}, local);
  await handler('notifications/initialized', {}, { isNotification: true, isRequest: false });
  const listed = await handler('tools/list', {}, local);
  return { handler, listed };
}

test('move requires an actual initialized private request and cannot enter through another carrier', async () => {
  let calls = 0;
  const { handler, listed } = await ready({ fileMoveExecutor: async () => {
    calls++; return { ok: true, mutationState: 'MOVED' };
  } });
  try {
    const tool = listed.tools.find(tool => tool.name === 'move_file');
    assert.ok(tool);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.inputSchema.required.slice().sort(), ['destination', 'expectedSha256', 'source']);
    for (const transport of [{ id: 1, isRequest: true }, { ...http, transportAuthenticated: false },
      { ...local, isRequest: false, isNotification: true }, { ...http, transportKind: 'public-mailbox' }]) {
      const denied = await call(handler, 'move_file', args, transport);
      assert.equal(denied.isError, true);
      assert.equal(denied.structuredContent.blocker, 'SOVEREIGN_PRIVATE_SESSION_REQUIRED');
    }
    assert.equal(calls, 0);
  } finally { await handler.close(); }
});

test('move rejects widened, malformed or accessor-shaped arguments before the native adapter', async () => {
  let calls = 0;
  const { handler } = await ready({ fileMoveExecutor: async () => { calls++; return { ok: true }; } });
  try {
    for (const attack of [null, [], Object.create(args), { ...args, overwrite: true },
      { ...args, expectedSha256: '' }, { ...args, expectedSha256: 'A'.repeat(64) },
      { ...args, source: ' C:\\SovereignFixture\\old.txt' },
      { ...args, destination: args.source }, { ...args, source: '\\\\server\\share\\old.txt' },
      { ...args, destination: 'C:\\SovereignFixture\\new.txt:stream' },
      { ...args, source: 'C:\\SovereignFixture\\old\ud800.txt' },
      { ...args, destination: 'C:\\SovereignFixture\\new\udfff.txt' },
      { ...args, get source() { throw Error('must not evaluate caller accessor'); } },
      { ...args, [Symbol('authority')]: true }]) {
      const denied = await call(handler, 'move_file', attack);
      assert.equal(denied.isError, true);
    }
    assert.equal(calls, 0);
  } finally { await handler.close(); }
});

test('canonical move scope binds both original paths and denies transport or target substitution', async () => {
  let calls = 0;
  const envelope = buildStephanosExecutionCommandEnvelopeV1({
    surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
    actionId: 'move-scope-fixture', missionId: 'private-move-fixture', relatedIssue: '#2573',
    operation: 'MOVE_FILE', targetPaths: [args.source, args.destination], payload: args,
  });
  const fileMoves = { execute: async (operation, captured) => {
    assert.equal(operation, 'MOVE_FILE'); assert.deepEqual(captured, args);
    calls++; return { ok: true, mutationState: 'MOVED' };
  } };
  const routeProof = { mcpSessionReady: true, commandPathProven: true,
    transport: 'local-stdio-mcp', authenticatedMcp: false };
  for (const options of [{}, { fileMoves }, { fileMoves, routeProof: { ...routeProof, transport: 'public-mailbox' } }])
    assert.equal((await executeSovereignCommanderCommandV1(envelope, options)).ok, false);
  for (const targetPaths of [[], [args.source], [args.destination, args.source],
    [args.source, 'C:\\SovereignFixture\\other.txt']])
    assert.equal((await executeSovereignCommanderCommandV1({ ...envelope, targetPaths }, { fileMoves, routeProof })).ok, false);
  assert.equal(calls, 0);
  const permitted = await executeSovereignCommanderCommandV1(envelope, { fileMoves, routeProof });
  assert.equal(permitted.ok, true);
  assert.equal(calls, 1);
  assert.equal(permitted.command.mergeAuthority, false);
  assert.equal(permitted.command.pcRestartAuthority, false);
});

test('retained move receipt never repeats a mutation and cannot be obtained by another handler', async () => {
  let calls = 0;
  const first = await ready({ fileMoveExecutor: async captured => {
    assert.deepEqual(captured, args); calls++;
    return { ok: true, mutationState: 'MOVED', source: args.source, destination: args.destination,
      sha256: args.expectedSha256, bytes: 10, overwriteAllowed: false };
  } });
  const second = await ready();
  try {
    const original = await call(first.handler, 'move_file', args);
    assert.equal(original.isError, false);
    const callId = original.structuredContent.command.commandId;
    const listing = value(await call(first.handler, 'get_recent_tool_calls'));
    assert.equal(listing.calls[0].tool, 'move_file');
    assert.equal(JSON.stringify(listing).includes(args.source), false);
    const retained = value(await call(first.handler, 'get_tool_result', { callId }));
    assert.equal(retained.resultAvailable, true);
    assert.deepEqual(retained.result.structuredContent, value(original));
    assert.equal((await call(second.handler, 'get_tool_result', { callId })).isError, true);
    assert.equal(calls, 1);
  } finally { await first.handler.close(); await second.handler.close(); }
});

test('unknown move effect stays failed and unavailable for replay even after transport disposal', async () => {
  let calls = 0, finish;
  const { handler } = await ready({ fileMoveExecutor: () => {
    calls++; return new Promise(resolve => { finish = resolve; });
  } });
  const pending = call(handler, 'move_file', args, http);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  await handler.close();
  finish({ ok: false, mutationState: 'UNKNOWN', blocker: 'FILE_MOVE_EFFECT_UNKNOWN', retryAllowed: false });
  const original = await pending;
  assert.equal(original.isError, true);
  assert.equal(original.structuredContent.finalVerdict, 'SOVEREIGN_COMMANDER_EXECUTION_EFFECT_UNKNOWN');
  assert.equal(value(original).mutationState, 'UNKNOWN');
  assert.equal(value(original).retryAllowed, false);
  await assert.rejects(call(handler, 'move_file', args), /MCP_SESSION_CLOSED/);
  assert.equal(calls, 1);
});

test('an unexpected native-adapter exception cannot be presented as a proven non-mutation', async () => {
  let calls = 0;
  const { handler } = await ready({ fileMoveExecutor: async () => {
    calls++; throw Error('PRIVATE_NATIVE_FAILURE_DETAIL');
  } });
  try {
    const result = await call(handler, 'move_file', args);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.finalVerdict, 'SOVEREIGN_COMMANDER_EXECUTION_EFFECT_UNKNOWN');
    assert.equal(value(result).mutationState, 'UNKNOWN');
    assert.equal(value(result).retryAllowed, false);
    assert.equal(JSON.stringify(result).includes('PRIVATE_NATIVE_FAILURE_DETAIL'), false);
    assert.equal(calls, 1);
  } finally { await handler.close(); }
});
