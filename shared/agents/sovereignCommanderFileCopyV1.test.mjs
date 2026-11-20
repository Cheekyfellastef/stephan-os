import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSovereignCommanderMcpHandler } from '../../scripts/sovereign-commander-mcp.mjs';
import { createSovereignCommanderHttpServer } from '../../scripts/sovereign-commander-http.mjs';
import { executeSovereignCommanderCommandV1 } from './sovereignCommanderV1.mjs';
import { buildStephanosExecutionCommandEnvelopeV1, STEPHANOS_EXECUTION_SURFACE } from './stephanosExecutionCommandFabricV1.mjs';
import { classifyRemoteCommanderCapabilityObservation } from './sovereignCommanderCapabilityParityV1.mjs';

const local = { id: 1, isRequest: true, isNotification: false,
  transportKind: 'local-stdio-mcp', transportAuthenticated: false };
const http = { ...local, transportKind: 'authenticated-http-jsonrpc', transportAuthenticated: true };
const args = Object.freeze({ source: 'C:\\SovereignFixture\\source\\asset.dat',
  destination: 'C:\\SovereignFixture\\destination\\asset-copy.dat', expectedSha256: 'a'.repeat(64) });
const call = (handler, name, arguments_ = {}, transport = local) =>
  handler('tools/call', { name, arguments: arguments_ }, transport);
const value = response => response.structuredContent.structuredContent;
const common = () => ({ schemaVersion: 'stephanos.sovereign-file-copy.v1',
  source: args.source, destination: args.destination,
  sourceIdentity: '12345678:0000000000000001', destinationIdentity: '12345678:0000000000000002',
  hashSemantics: 'BOUNDED_PRE_POST_OBSERVATION_NOT_ATOMIC_CONTENT_CAS',
  mappedWriterExclusionProven: false, retryAllowed: false,
  sourceMutationAttempted: false, copyScope: 'UNNAMED_DATA_STREAM_ONLY' });
const copied = () => ({ ...common(), ok: true, mutationState: 'COPIED', stage: 'POSTCONDITION',
  mutationAttempted: true, copied: true, overwritten: false, wholeFileAtomicityProven: false,
  sourceContentObservedUnchanged: true, metadataPreserved: false, filesystem: 'NTFS',
  sha256: args.expectedSha256, sourceParentIdentity: '12345678:0000000000000003',
  destinationParentIdentity: '12345678:0000000000000004', bytes: 4, bytesRead: 16, durationMs: 1 });
const refused = () => ({ ...common(), ok: false, mutationState: 'NOT_STARTED', stage: 'PRECONDITION',
  destinationIdentity: null, mutationAttempted: false, blocker: 'SOVEREIGN_COPY_HASH_MISMATCH' });
const unknown = () => ({ ...common(), ok: false, mutationState: 'UNKNOWN', stage: 'COPY',
  mutationAttempted: true, blocker: 'SOVEREIGN_COPY_WRITE_UNPROVEN' });
const hashed = () => ({ schemaVersion: 'stephanos.sovereign-file-hash.v1', ok: true,
  path: args.source, identity: '12345678:0000000000000001', parentIdentity: '12345678:0000000000000003',
  observationState: 'HASHED', stage: 'POSTCONDITION', mutationAttempted: false, sourceMutationAttempted: false,
  hashSemantics: 'BOUNDED_PRE_POST_OBSERVATION_NOT_ATOMIC_CONTENT_CAS', mappedWriterExclusionProven: false,
  retryAllowed: false, hashScope: 'UNNAMED_DATA_STREAM_ONLY', filesystem: 'NTFS', sha256: args.expectedSha256,
  bytes: 4, bytesRead: 8, durationMs: 1, sourceContentObservedUnchanged: true });
async function ready(options = {}) {
  const handler = createSovereignCommanderMcpHandler(options);
  await handler('initialize', {}, local);
  await handler('notifications/initialized', {}, { isNotification: true, isRequest: false });
  const listed = await handler('tools/list', {}, local);
  return { handler, listed };
}

test('content copy advertises its exact bounded contract and requires a discovered private request', async () => {
  let calls = 0;
  const { handler, listed } = await ready({ fileCopyExecutor: async () => { calls++; return copied(); } });
  try {
    const tool = listed.tools.find(row => row.name === 'copy_file_content');
    assert.ok(tool);
    assert.deepEqual(tool.inputSchema.required.slice().sort(), ['destination', 'expectedSha256', 'source']);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
    for (const transport of [{ id: 1, isRequest: true }, { ...http, transportAuthenticated: false },
      { ...local, isRequest: false, isNotification: true }, { ...http, transportKind: 'public-mailbox' }]) {
      const denied = await call(handler, 'copy_file_content', args, transport);
      assert.equal(denied.isError, true);
      assert.equal(denied.structuredContent.blocker, 'SOVEREIGN_PRIVATE_SESSION_REQUIRED');
    }
    assert.equal(calls, 0);
    for (const transport of [local, http]) {
      const result = await call(handler, 'copy_file_content', args, transport);
      assert.equal(result.isError, false);
      assert.deepEqual(value(result), copied());
    }
    assert.equal(calls, 2);
  } finally { await handler.close(); }
});

test('content copy cannot be called before initialize, ready notification and tools discovery', async () => {
  let calls = 0;
  const handler = createSovereignCommanderMcpHandler({ fileCopyExecutor: async () => { calls++; return copied(); } });
  try {
    await assert.rejects(call(handler, 'copy_file_content', args));
    await handler('initialize', {}, local);
    await assert.rejects(call(handler, 'copy_file_content', args));
    await handler('notifications/initialized', {}, { isNotification: true, isRequest: false });
    const undiscovered = await call(handler, 'copy_file_content', args);
    assert.equal(undiscovered.isError, true);
    assert.equal(undiscovered.structuredContent.blocker, 'MCP_TOOLS_LIST_REQUIRED');
    assert.equal(calls, 0);
    await handler('tools/list', {}, local);
    assert.equal((await call(handler, 'copy_file_content', args)).isError, false);
    assert.equal(calls, 1);
  } finally { await handler.close(); }
});

test('content copy rejects widened, private-authority and malformed arguments before its adapter', async () => {
  let calls = 0, getterCalls = 0;
  const { handler } = await ready({ fileCopyExecutor: async () => { calls++; return copied(); } });
  try {
    for (const attack of [null, [], Object.create(args), { ...args, overwrite: true },
      { ...args, deleteSource: true }, { ...args, command: 'caller-selected' },
      { ...args, fileCopyExecutor: 'caller-selected' }, { ...args, transportAuthenticated: true },
      { ...args, routeProof: { mcpSessionReady: true } }, { ...args, expectedSha256: '' },
      { ...args, expectedSha256: 'A'.repeat(64) }, { ...args, source: ' ' + args.source },
      { ...args, destination: args.source }, { ...args, source: '\\\\server\\share\\asset.dat' },
      { ...args, destination: 'C:\\SovereignFixture\\asset.dat:stream' },
      { ...args, source: 'C:\\SovereignFixture\\.env' },
      { ...args, destination: 'C:\\SovereignFixture\\new\udfff.dat' },
      { ...args, get source() { getterCalls++; throw Error('must not evaluate'); } },
      { ...args, [Symbol('authority')]: true }]) {
      assert.equal((await call(handler, 'copy_file_content', attack)).isError, true);
    }
    assert.equal(calls, 0);
    assert.equal(getterCalls, 0);
  } finally { await handler.close(); }
});

test('canonical content copy binds both paths in order and only reaches the private host service', async () => {
  let calls = 0;
  const envelope = buildStephanosExecutionCommandEnvelopeV1({
    surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
    actionId: 'copy-scope-fixture', missionId: 'private-copy-fixture', relatedIssue: '#2573',
    operation: 'COPY_FILE_CONTENT', targetPaths: [args.source, args.destination], payload: args,
  });
  const fileCopies = { execute: async (operation, captured) => {
    assert.equal(operation, 'COPY_FILE_CONTENT'); assert.deepEqual(captured, args);
    calls++; return copied();
  } };
  const routeProof = { mcpSessionReady: true, commandPathProven: true,
    transport: 'local-stdio-mcp', authenticatedMcp: false };
  for (const options of [{}, { fileCopies }, { fileCopies, routeProof: { ...routeProof, transport: 'public-mailbox' } },
    { fileCopies, routeProof: { ...routeProof, transport: 'authenticated-http-jsonrpc', authenticatedMcp: false } }])
    assert.equal((await executeSovereignCommanderCommandV1(envelope, options)).ok, false);
  for (const targetPaths of [[], [args.source], [args.destination, args.source],
    [args.source, 'C:\\SovereignFixture\\other.dat']])
    assert.equal((await executeSovereignCommanderCommandV1({ ...envelope, targetPaths }, { fileCopies, routeProof })).ok, false);
  assert.equal(calls, 0);
  const admitted = await executeSovereignCommanderCommandV1(envelope, { fileCopies, routeProof });
  assert.equal(admitted.ok, true);
  assert.equal(admitted.command.plan.family, 'copy');
  assert.equal(admitted.command.mergeAuthority, false);
  assert.equal(admitted.command.pcRestartAuthority, false);
  assert.equal(calls, 1);
});

test('canonical content copy preserves genuine pre-create refusal and post-create uncertainty', async () => {
  for (const [receipt, verdict] of [[refused(), 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED'],
    [unknown(), 'SOVEREIGN_COMMANDER_EXECUTION_EFFECT_UNKNOWN']]) {
    const { handler } = await ready({ fileCopyExecutor: async () => receipt });
    try {
      const result = await call(handler, 'copy_file_content', args);
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.finalVerdict, verdict);
      assert.deepEqual(value(result), receipt);
      assert.equal(value(result).retryAllowed, false);
    } finally { await handler.close(); }
  }
});

test('malformed or optimistic service receipts become bounded UNKNOWN without raw extras', async () => {
  let getterCalls = 0;
  for (const receipt of [null, { ok: true }, { ...copied(), mutationState: 'UNKNOWN' },
    { ...copied(), source: args.destination }, { ...copied(), sha256: 'b'.repeat(64) },
    { ...copied(), sourceMutationAttempted: true }, { ...copied(), wholeFileAtomicityProven: true },
    { ...copied(), metadataPreserved: true }, { ...copied(), overwritten: true },
    { ...copied(), retryAllowed: true }, { ...copied(), raw: 'PRIVATE_COPY_DETAIL' },
    { ...refused(), mutationAttempted: true }, { ...refused(), blocker: 'SOVEREIGN_COPY_WRITE_UNPROVEN' },
    { ...unknown(), mutationState: 'NOT_STARTED' },
    { ...copied(), get bytes() { getterCalls++; throw Error('PRIVATE_COPY_DETAIL'); } }]) {
    const { handler } = await ready({ fileCopyExecutor: async () => receipt });
    try {
      const result = await call(handler, 'copy_file_content', args);
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.finalVerdict, 'SOVEREIGN_COMMANDER_EXECUTION_EFFECT_UNKNOWN');
      assert.equal(value(result).mutationState, 'UNKNOWN');
      assert.equal(value(result).retryAllowed, false);
      assert.equal(JSON.stringify(result).includes('PRIVATE_COPY_DETAIL'), false);
    } finally { await handler.close(); }
  }
  assert.equal(getterCalls, 0);
});

test('retained content-copy receipt cannot repeat the copy or be read by another handler', async () => {
  let calls = 0;
  const first = await ready({ fileCopyExecutor: async captured => {
    assert.deepEqual(captured, args); calls++; return copied();
  } });
  const second = await ready();
  try {
    const original = await call(first.handler, 'copy_file_content', args, http);
    const callId = original.structuredContent.command.commandId;
    assert.equal(original.isError, false);
    const listing = value(await call(first.handler, 'get_recent_tool_calls'));
    assert.equal(listing.calls[0].tool, 'copy_file_content');
    assert.equal(JSON.stringify(listing).includes(args.source), false);
    const retained = value(await call(first.handler, 'get_tool_result', { callId }));
    assert.equal(retained.resultAvailable, true);
    assert.deepEqual(retained.result.structuredContent, value(original));
    assert.equal((await call(second.handler, 'get_tool_result', { callId })).isError, true);
    assert.equal(calls, 1);
  } finally { await first.handler.close(); await second.handler.close(); }
});

test('closing a session does not replay or pretend to cancel its in-flight native copy', async () => {
  let calls = 0, finish;
  const { handler } = await ready({ fileCopyExecutor: () => {
    calls++; return new Promise(resolve => { finish = resolve; });
  } });
  const pending = call(handler, 'copy_file_content', args, http);
  await new Promise(resolve => setImmediate(resolve));
  await handler.close();
  finish(unknown());
  const result = await pending;
  assert.equal(result.isError, true);
  assert.equal(value(result).mutationState, 'UNKNOWN');
  assert.equal(value(result).retryAllowed, false);
  await assert.rejects(call(handler, 'copy_file_content', args), /MCP_SESSION_CLOSED/);
  assert.equal(calls, 1);
});

test('copy adapter exceptions cannot expose raw details or claim a proven non-mutation', async () => {
  const { handler } = await ready({ fileCopyExecutor: async () => { throw Error('PRIVATE_COPY_DETAIL'); } });
  try {
    const result = await call(handler, 'copy_file_content', args);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.finalVerdict, 'SOVEREIGN_COMMANDER_EXECUTION_EFFECT_UNKNOWN');
    assert.equal(value(result).mutationState, 'UNKNOWN');
    assert.equal(JSON.stringify(result).includes('PRIVATE_COPY_DETAIL'), false);
  } finally { await handler.close(); }
});

test('content-copy source scope cannot be reported as full move parity or installed acceptance', () => {
  const event = operation => ({ adapter: 'remote-desktop-commander', item: { operation } });
  const copy = classifyRemoteCommanderCapabilityObservation(event('copy-file-content'));
  assert.equal(copy.sovereignEquivalent, 'copy_file_content');
  assert.equal(copy.functionalScope, 'CREATE_ONLY_SAME_VOLUME_REGULAR_FILE_CONTENT_COPY');
  assert.equal(copy.runtimeParityProven, false);
  assert.equal(copy.privateTransportRequired, true);
  const move = classifyRemoteCommanderCapabilityObservation(event('move-file'));
  assert.equal(move.state, 'BUILDABLE_GAP');
  assert.equal(move.partialSovereignEquivalent, 'move_file');
  assert.equal(move.parityGapReason, 'CROSS_DIRECTORY_FILE_MOVE_UNQUALIFIED');
});

test('file hash supplies a private bounded observation with no mutation or content authority', async () => {
  let calls = 0, getters = 0;
  const { handler, listed } = await ready({ fileHashExecutor: async captured => {
    assert.deepEqual(captured, { path: args.source }); calls++; return hashed();
  } });
  try {
    const tool = listed.tools.find(row => row.name === 'get_file_hash');
    assert.deepEqual(tool.inputSchema.required, ['path']);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.readOnlyHint, true);
    for (const transport of [{ ...http, transportAuthenticated: false },
      { ...local, isRequest: false, isNotification: true }, { ...http, transportKind: 'public-mailbox' }])
      assert.equal((await call(handler, 'get_file_hash', { path: args.source }, transport)).isError, true);
    for (const attack of [{}, null, [], { source: args.source }, { path: args.source, destination: args.destination },
      { path: args.source, algorithm: 'md5' }, { path: args.source, expectedSha256: args.expectedSha256 },
      { path: args.source, fileHashExecutor: 'caller-selected' }, { path: args.source, transportAuthenticated: true },
      { path: 'C:\\SovereignFixture\\.env' }, { path: args.source + ':alternate' },
      { get path() { getters++; throw Error('must not evaluate'); } }, Object.create({ path: args.source })])
      assert.equal((await call(handler, 'get_file_hash', attack)).isError, true);
    assert.equal(calls, 0); assert.equal(getters, 0);
    const result = await call(handler, 'get_file_hash', { path: args.source });
    assert.equal(result.isError, false);
    assert.deepEqual(value(result), hashed());
    const retained = value(await call(handler, 'get_tool_result', { callId: result.structuredContent.command.commandId }));
    assert.deepEqual(retained.result.structuredContent, hashed());
    assert.equal(calls, 1);
  } finally { await handler.close(); }
});

test('canonical hash binds the original single path and cannot reach mutation or maintenance services', async () => {
  let calls = 0, maintenance = 0;
  const envelope = buildStephanosExecutionCommandEnvelopeV1({
    surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER, actionId: 'hash-scope-fixture',
    missionId: 'private-hash-fixture', relatedIssue: '#2573', operation: 'GET_FILE_HASH',
    targetPaths: [args.source], payload: { path: args.source },
  });
  const options = {
    fileCopies: { execute: async (operation, captured) => {
      assert.equal(operation, 'GET_FILE_HASH'); assert.deepEqual(captured, { path: args.source }); calls++; return hashed();
    } },
    routeProof: { mcpSessionReady: true, commandPathProven: true, transport: 'local-stdio-mcp', authenticatedMcp: false },
    withMaintenanceOwner: () => { maintenance++; throw Error('must not enter maintenance'); },
  };
  for (const targetPaths of [[], [args.destination], [args.source, args.destination]])
    assert.equal((await executeSovereignCommanderCommandV1({ ...envelope, targetPaths }, options)).ok, false);
  assert.equal(calls, 0);
  const result = await executeSovereignCommanderCommandV1(envelope, options);
  assert.equal(result.ok, true); assert.equal(result.structuredContent.mutationAttempted, false);
  assert.equal(calls, 1); assert.equal(maintenance, 0);
});

test('malformed or thrown hash results cannot supply a digest or reveal raw service data', async () => {
  let getters = 0;
  for (const receipt of [null, { ok: true, sha256: args.expectedSha256 },
    { ...hashed(), path: args.destination }, { ...hashed(), mutationAttempted: true },
    { ...hashed(), observationState: 'NOT_OBSERVED' }, { ...hashed(), sourceContentObservedUnchanged: false },
    { ...hashed(), bytesRead: 4 }, { ...hashed(), raw: 'PRIVATE_HASH_DETAIL' },
    { ...hashed(), get sha256() { getters++; throw Error('PRIVATE_HASH_DETAIL'); } }, 'throw']) {
    const { handler } = await ready({ fileHashExecutor: async () => {
      if (receipt === 'throw') throw Error('PRIVATE_HASH_DETAIL');
      return receipt;
    } });
    try {
      const result = await call(handler, 'get_file_hash', { path: args.source });
      assert.equal(result.isError, true);
      assert.equal(value(result).observationState, 'NOT_OBSERVED');
      assert.equal(value(result).mutationAttempted, false);
      assert.equal(value(result).retryAllowed, false);
      assert.equal(Object.hasOwn(value(result), 'sha256'), false);
      assert.equal(JSON.stringify(result).includes('PRIVATE_HASH_DETAIL'), false);
    } finally { await handler.close(); }
  }
  assert.equal(getters, 0);
});

test('actual HTTP authentication, discovery and session history govern hash and content copy', { timeout: 15000 }, async () => {
  const token = 'sovereign-copy-fixture-token-'.padEnd(64, 'x');
  let copies = 0, hashes = 0, id = 1;
  const created = await createSovereignCommanderHttpServer({ token, host: '127.0.0.1', port: 0,
    continuousRepairEnabled: false, handlerFactory: () => createSovereignCommanderMcpHandler({
      fileCopyExecutor: async () => { copies++; return copied(); },
      fileHashExecutor: async () => { hashes++; return hashed(); },
    }) });
  await new Promise((resolve, reject) => { created.server.once('error', reject); created.server.listen(0, created.host, resolve); });
  const url = 'http://127.0.0.1:' + created.server.address().port + '/mcp';
  async function rpc(method, params = {}, sessionId, authenticated = true) {
    const response = await fetch(url, { method: 'POST',
      headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: 'Bearer ' + token } : {}),
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(method.startsWith('notifications/') ? {} : { id: id++ }), method, params }),
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.text();
    return { status: response.status, sessionId: response.headers.get('mcp-session-id'), body: body ? JSON.parse(body) : null };
  }
  async function open() {
    const initialized = await rpc('initialize');
    assert.equal(initialized.status, 200);
    const sessionId = initialized.sessionId; assert.ok(sessionId);
    assert.equal((await rpc('notifications/initialized', {}, sessionId)).status, 202);
    assert.equal((await rpc('tools/list', {}, sessionId)).status, 200);
    return sessionId;
  }
  try {
    assert.equal((await rpc('initialize', {}, undefined, false)).status, 401);
    const first = await open(), second = await open();
    const tool = (name, arguments_) => ({ name, arguments: arguments_ });
    for (const [name, arguments_] of [['get_file_hash', { path: args.source }], ['copy_file_content', args]])
      assert.equal((await rpc('tools/call', tool(name, arguments_), first, false)).status, 401);
    assert.equal(copies, 0); assert.equal(hashes, 0);
    const hash = await rpc('tools/call', tool('get_file_hash', { path: args.source }), first);
    assert.equal(hash.body.result.isError, false);
    const digest = value(hash.body.result).sha256;
    assert.equal(digest, args.expectedSha256);
    const copy = await rpc('tools/call', tool('copy_file_content', { ...args, expectedSha256: digest }), first);
    assert.equal(copy.body.result.isError, false);
    const callId = copy.body.result.structuredContent.command.commandId;
    const retained = await rpc('tools/call', tool('get_tool_result', { callId }), first);
    assert.deepEqual(value(retained.body.result).result.structuredContent, copied());
    const foreign = await rpc('tools/call', tool('get_tool_result', { callId }), second);
    assert.equal(foreign.body.result.isError, true);
    assert.equal(copies, 1); assert.equal(hashes, 1);
  } finally {
    await new Promise((resolve, reject) => created.server.close(error => error ? reject(error) : resolve()));
  }
});

test('Windows private MCP hashes a binary source, copies across folders and independently hashes the destination',
  { skip: process.platform !== 'win32', timeout: 120000 }, async t => {
    const root = join(process.cwd(), 'sovereign-content-copy-mcp-' + randomUUID());
    const sourceDirectory = join(root, 'source'), destinationDirectory = join(root, 'destination');
    t.after(async () => rm(root, { recursive: true, force: true }));
    await mkdir(sourceDirectory, { recursive: true }); await mkdir(destinationDirectory, { recursive: true });
    const source = join(sourceDirectory, 'asset.dat'), destination = join(destinationDirectory, 'asset-copy.dat');
    const bytes = Buffer.alloc(131072); for (let index = 0; index < bytes.length; index++) bytes[index] = index % 256;
    await writeFile(source, bytes);
    const expectedSha256 = createHash('sha256').update(bytes).digest('hex');
    const { handler } = await ready(); t.after(() => handler.close());
    const before = await call(handler, 'get_file_hash', { path: source });
    assert.equal(before.isError, false, JSON.stringify(before));
    assert.equal(value(before).sha256, expectedSha256);
    assert.equal(value(before).bytesRead, bytes.length * 2);
    const result = await call(handler, 'copy_file_content', { source, destination, expectedSha256: value(before).sha256 });
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.equal(value(result).mutationState, 'COPIED');
    assert.equal(value(result).bytesRead, bytes.length * 4);
    assert.equal(value(result).sourceMutationAttempted, false);
    assert.equal(value(result).metadataPreserved, false);
    const after = await call(handler, 'get_file_hash', { path: destination });
    assert.equal(after.isError, false, JSON.stringify(after));
    assert.equal(value(after).sha256, expectedSha256);
    assert.deepEqual(await readFile(source), bytes); assert.deepEqual(await readFile(destination), bytes);
    t.diagnostic(JSON.stringify({ route: 'INITIALIZED_PRIVATE_MCP', sourceHash: value(before).sha256,
      copyState: value(result).mutationState, destinationHash: value(after).sha256, bytes: bytes.length,
      sourceMutationAttempted: false, metadataPreserved: false, installedBattleBridgeAcceptance: false }));
  });
