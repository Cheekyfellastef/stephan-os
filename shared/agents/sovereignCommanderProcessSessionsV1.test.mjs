import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSovereignCommanderMcpHandler } from '../../scripts/sovereign-commander-mcp.mjs';
import { createSovereignCommanderHttpServer } from '../../scripts/sovereign-commander-http.mjs';
import { buildSovereignCommanderCommandV1, executeSovereignCommanderCommandV1 } from './sovereignCommanderV1.mjs';
import { createSovereignProcessSessionsV1 } from './sovereignProcessSessionsV1.mjs';
import { buildStephanosExecutionCommandEnvelopeV1, STEPHANOS_EXECUTION_SURFACE } from './stephanosExecutionCommandFabricV1.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PROFILES = Object.freeze(['status-recovery-mesh', 'status-worker-watchdog']);
const SCRIPTS = Object.freeze({
  'status-recovery-mesh': 'scripts/windows/status-battle-bridge-recovery-mesh.ps1',
  'status-worker-watchdog': 'scripts/windows/status-battle-bridge-worker-watchdog.ps1',
});
const TOOLS = ['start_process', 'read_process_output', 'list_sessions'];
const SCHEMA = 'stephanos.sovereign-process-sessions.v1';
const local = { id: 1, isRequest: true, isNotification: false, transportKind: 'local-stdio-mcp', transportAuthenticated: false };
const http = { ...local, transportKind: 'authenticated-http-jsonrpc', transportAuthenticated: true };
const privateRoute = { mcpSessionReady: true, commandPathProven: true, transport: 'local-stdio-mcp', authenticatedMcp: false };
const call = (handler, name, args = {}, transport = local) => handler('tools/call', { name, arguments: args }, transport);
const operation = response => response.structuredContent;
const value = response => operation(response).structuredContent;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), 3000);
    })]);
  } finally { clearTimeout(timer); }
}
async function ready(options = {}, factory = createSovereignCommanderMcpHandler) {
  const handler = factory({ repoRoot: ROOT, ...options });
  await handler('initialize', {}, local);
  await handler('notifications/initialized', {}, { isNotification: true, isRequest: false });
  const listed = await handler('tools/list', {}, local);
  return { handler, listed };
}
function envelope(operation, payload = {}, targetPaths = []) {
  return buildStephanosExecutionCommandEnvelopeV1({
    surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
    actionId: 'private-process-fixture', missionId: 'process-session-fixture', relatedIssue: '#2573',
    operation, payload, targetPaths,
  });
}
function pendingReceipt(profile) {
  const sessionId = 'process-12345678-1234-4234-8234-123456789abc';
  return { ok: true, schemaVersion: SCHEMA, operation: 'START_PROCESS_SESSION', launchState: 'SPAWN_OBSERVED', sessionId,
    session: { sessionId, profile, state: 'RUNNING', spawnObserved: true, rootExitObserved: false,
      stdioClosed: false, outcome: 'PENDING', blocker: '', outputTruncated: false, nextOffset: 0,
      nativeCustodyQualified: false, descendantsExcluded: false } };
}

// Real process-session services and canonical MCP/executor code, with only
// process creation replaced by owned inert children. No Windows action runs.
function processHarness({ autoCloseOnKill = true, serviceOptions = {} } = {}) {
  const records = [];
  const factory = () => {
    const record = { children: [], calls: [], disposals: 0 };
    records.push(record);
    const service = createSovereignProcessSessionsV1({ platform: 'win32',
      environment: { ...process.env, USERPROFILE: 'C:\\Users\\SovereignFixture' }, ...serviceOptions,
      spawnFn(executable, args, settings) {
        const killed = deferred();
        const child = new EventEmitter();
        child.pid = 42000 + records.length * 100 + record.children.length;
        child.stdin = null; child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.killCalls = 0; child.fixtureClosed = false; child.killedObservation = killed.promise;
        child.invocation = { executable, args, settings };
        child.finish = (code = 0, signal = null) => {
          if (child.fixtureClosed) return;
          child.fixtureClosed = true;
          child.emit('exit', code, signal);
          child.stdout.end(); child.stderr.end();
          child.emit('close', code, signal);
        };
        child.kill = () => {
          child.killCalls++; killed.resolve();
          if (autoCloseOnKill) queueMicrotask(() => child.finish(null, 'SIGTERM'));
          return true;
        };
        record.children.push(child);
        queueMicrotask(() => child.emit('spawn'));
        return child;
      },
    });
    record.service = service;
    return {
      execute: (op, args) => { record.calls.push({ operation: op, args }); return service.execute(op, args); },
      dispose: async () => { record.disposals++; await service.dispose(); },
    };
  };
  return {
    records, factory,
    finishAll() { for (const record of records) for (const child of record.children) child.finish(null, 'SIGTERM'); },
  };
}

test('three process tools require initialization and an actual private request before executor admission', async () => {
  let calls = 0;
  const h = processHarness();
  const handler = createSovereignCommanderMcpHandler({ repoRoot: ROOT, processSessionsFactory: h.factory,
    executor: async (command, options) => { calls++; return executeSovereignCommanderCommandV1(command, options); } });
  try {
    await assert.rejects(call(handler, 'start_process', { profile: PROFILES[0] }), /MCP_SESSION_NOT_READY/);
    await handler('initialize', {}, local);
    await handler('notifications/initialized', {}, { isNotification: true, isRequest: false });
    const listed = await handler('tools/list', {}, local);
    for (const name of TOOLS) {
      const tool = listed.tools.find(tool => tool.name === name); assert.ok(tool, name);
      assert.equal(tool.inputSchema.additionalProperties, false);
    }
    assert.deepEqual(listed.tools.find(tool => tool.name === 'start_process').inputSchema.properties.profile.enum.slice().sort(), PROFILES.slice().sort());
    assert.deepEqual(listed.tools.find(tool => tool.name === 'start_process').inputSchema.required, ['profile']);
    for (const transport of [{ id: 1, isRequest: true }, { ...http, transportAuthenticated: false },
      { ...local, isRequest: false, isNotification: true }, { ...http, transportKind: 'public-mailbox' }]) {
      for (const name of TOOLS) {
        const args = name === 'start_process' ? { profile: PROFILES[0] }
          : name === 'read_process_output' ? { sessionId: pendingReceipt(PROFILES[0]).sessionId } : {};
        const denied = await call(handler, name, args, transport);
        assert.equal(denied.isError, true); assert.equal(operation(denied).blocker, 'SOVEREIGN_PRIVATE_SESSION_REQUIRED');
      }
    }
    assert.equal(calls, 0); assert.equal(h.records.length, 1); assert.equal(h.records[0].children.length, 0);
    assert.deepEqual(value(await call(handler, 'list_sessions')).sessions, []);
    assert.deepEqual(value(await call(handler, 'list_sessions', {}, http)).sessions, []);
    assert.equal(calls, 2);
  } finally { await handler.close(); h.finishAll(); }
});

test('the MCP boundary refuses commands, mutable profile shapes, PIDs, stdin and pagination coercion', async () => {
  let calls = 0, getters = 0;
  const h = processHarness();
  const { handler } = await ready({ processSessionsFactory: h.factory,
    executor: async (command, options) => { calls++; return executeSovereignCommanderCommandV1(command, options); } });
  const profile = PROFILES[0];
  try {
    for (const args of [null, [], {}, { profile: 'status-stephanos-core-daemon' }, { profile: 'repair-ui-4173' },
      { profile: 'powershell' }, { profile: profile.toUpperCase() }, { profile: `${profile} ` },
      { profile, executable: 'cmd.exe' }, { profile, command: 'whoami' }, { profile, args: ['-Command', 'x'] },
      { profile, env: { SECRET: 'x' } }, { profile, cwd: 'C:\\outside' }, { profile, stdin: 'x' },
      { profile, pid: 1234 }, { profile, timeoutMs: 120000 }, { profile, processSessions: {} },
      { get profile() { getters++; return profile; } }, { profile, [Symbol('authority')]: true },
      Object.assign(Object.create({ profile }), {})]) {
      assert.equal((await call(handler, 'start_process', args)).isError, true);
    }
    const sessionId = pendingReceipt(profile).sessionId;
    for (const args of [null, { sessionId: 1234 }, { sessionId: '1234' }, { sessionId, pid: 1234 },
      { sessionId, offset: '0' }, { sessionId, offset: -1 }, { sessionId, limit: 51 },
      { sessionId, stdin: 'x' }, { sessionId, command: 'x' }, { sessionId, get limit() { getters++; return 1; } }])
      assert.equal((await call(handler, 'read_process_output', args)).isError, true);
    for (const args of [null, [], { sessionId }, { pid: 1234 }, { profile }, { allUsers: true }])
      assert.equal((await call(handler, 'list_sessions', args)).isError, true);
    assert.equal(calls, 0); assert.equal(getters, 0); assert.equal(h.records[0].children.length, 0);
  } finally { await handler.close(); h.finishAll(); }
});

test('the canonical process plan binds the two observed profiles, fixed source digest and ten-second deadline', async () => {
  let executions = 0, ownerCalls = 0;
  const service = { execute: async (op, args) => {
    executions++; assert.equal(op, 'START_PROCESS_SESSION'); return pendingReceipt(args.profile);
  } };
  const options = { repoRoot: ROOT, processSessions: service, routeProof: privateRoute,
    withMaintenanceOwner: () => { ownerCalls++; throw new Error('observations must not acquire maintenance ownership'); } };
  for (const profile of PROFILES) {
    const command = envelope('START_PROCESS_SESSION', { profile });
    for (const deniedOptions of [{ repoRoot: ROOT }, { repoRoot: ROOT, processSessions: service },
      { ...options, routeProof: { ...privateRoute, transport: 'public-mailbox' } },
      { ...options, routeProof: { ...privateRoute, transport: 'authenticated-http-jsonrpc', authenticatedMcp: false } },
      { ...options, repoRoot: '' }]) assert.equal((await executeSovereignCommanderCommandV1(command, deniedOptions)).ok, false);
    assert.equal((await executeSovereignCommanderCommandV1({ ...command, targetPaths: ['C:\\outside'] }, options)).ok, false);
    assert.equal((await executeSovereignCommanderCommandV1(envelope('START_PROCESS_SESSION', {
      profile, profileBinding: { executable: 'cmd.exe' },
    }), options)).ok, false);
    const result = await executeSovereignCommanderCommandV1(command, options);
    assert.equal(result.ok, true); assert.equal(result.command.operation, 'START_PROCESS_SESSION');
    assert.equal(result.command.plan.kind, 'private-session'); assert.equal(result.command.plan.family, 'process');
    assert.deepEqual(result.command.plan.args, { profile });
    assert.deepEqual(result.command.plan.profileBinding, {
      profile, scriptPath: SCRIPTS[profile], timeoutMs: 10000,
      scriptSha256: createHash('sha256').update(readFileSync(new URL(`../../${SCRIPTS[profile]}`, import.meta.url))).digest('hex'),
    });
    assert.equal(result.command.mergeAuthority, false); assert.equal(result.command.pcRestartAuthority, false);
    assert.match(result.proofHash, /^[a-f0-9]{64}$/);
    assert.equal(result.structuredContent.session.outcome, 'PENDING');
    assert.equal(result.structuredContent.session.nativeCustodyQualified, false);
    assert.equal(result.structuredContent.session.descendantsExcluded, false);
  }
  assert.equal(executions, 2); assert.equal(ownerCalls, 0);
  const legacy = buildSovereignCommanderCommandV1(envelope('START_PROCESS', { processId: PROFILES[0] }), { repoRoot: ROOT });
  assert.equal(legacy.dispatchAllowed, true); assert.equal(legacy.plan.kind, 'fixed-process');
  assert.equal(legacy.plan.processId, PROFILES[0]);
});

test('the start receipt and streamed output precede exit without presenting the observation as completed custody', async () => {
  let ownerCalls = 0;
  const h = processHarness();
  const { handler } = await ready({ processSessionsFactory: h.factory,
    withMaintenanceOwner: () => { ownerCalls++; throw new Error('must not enter owner'); } });
  try {
    const originalArgs = { profile: PROFILES[0] };
    const pending = call(handler, 'start_process', originalArgs);
    originalArgs.profile = PROFILES[1]; originalArgs.command = 'caller replacement';
    const started = await bounded(pending, 'START_DID_NOT_RETURN_AFTER_SPAWN');
    assert.equal(started.isError, false);
    assert.equal(operation(started).command.operation, 'START_PROCESS_SESSION');
    assert.equal(value(started).launchState, 'SPAWN_OBSERVED');
    assert.equal(value(started).session.profile, PROFILES[0]);
    const { sessionId } = value(started), child = h.records[0].children[0];
    assert.equal(value(started).session.spawnObserved, true); assert.equal(value(started).session.rootExitObserved, false);
    assert.equal(value(started).session.stdioClosed, false); assert.equal(value(started).session.outcome, 'PENDING');
    child.stdout.write('PROCESS_STDOUT_BEFORE_EXIT'); child.stderr.write('PROCESS_STDERR_BEFORE_EXIT');
    const streamed = value(await call(handler, 'read_process_output', { sessionId }));
    assert.deepEqual(streamed.chunks.map(chunk => [chunk.stream, chunk.text]), [
      ['stdout', 'PROCESS_STDOUT_BEFORE_EXIT'], ['stderr', 'PROCESS_STDERR_BEFORE_EXIT'],
    ]);
    assert.equal(streamed.outputComplete, false); assert.equal(streamed.session.rootExitObserved, false);
    assert.equal(streamed.session.outcome, 'PENDING'); assert.equal(child.fixtureClosed, false);
    const listed = value(await call(handler, 'list_sessions'));
    assert.equal(listed.sessions.length, 1); assert.equal(listed.sessions[0].sessionId, sessionId);
    assert.equal(JSON.stringify(listed).includes('PROCESS_STDOUT_BEFORE_EXIT'), false);
    child.finish(0, null);
    const finished = value(await call(handler, 'read_process_output', { sessionId, offset: streamed.nextOffset }));
    assert.equal(finished.outputComplete, true); assert.equal(finished.session.rootExitObserved, true);
    assert.equal(finished.session.stdioClosed, true); assert.equal(finished.session.outcome, 'SUCCEEDED');
    assert.equal(finished.session.nativeCustodyQualified, false); assert.equal(finished.session.descendantsExcluded, false);
    assert.equal(ownerCalls, 0);
  } finally { h.finishAll(); await handler.close(); }
});

test('process records and receipts stay private to one handler and history retrieval cannot relaunch or refresh them', async () => {
  const h = processHarness();
  const left = await ready({ processSessionsFactory: h.factory }), right = await ready({ processSessionsFactory: h.factory });
  try {
    const started = await call(left.handler, 'start_process', { profile: PROFILES[1] }, http);
    assert.equal(started.isError, false);
    const { sessionId } = value(started), callId = operation(started).command.commandId;
    const child = h.records[0].children[0]; child.stdout.write('PRIVATE_PROCESS_STREAM_CANARY');
    const read = await call(left.handler, 'read_process_output', { sessionId }, http);
    assert.equal(read.isError, false);
    assert.equal(value(read).chunks.map(chunk => chunk.text).join(''), 'PRIVATE_PROCESS_STREAM_CANARY');
    const foreign = await call(right.handler, 'read_process_output', { sessionId }, http);
    assert.equal(foreign.isError, true);
    assert.equal(JSON.stringify(foreign).includes('PRIVATE_PROCESS_STREAM_CANARY'), false);
    assert.equal(value(foreign)?.session, undefined);
    assert.deepEqual(value(await call(right.handler, 'list_sessions', {}, http)).sessions, []);
    assert.equal((await call(right.handler, 'get_tool_result', { callId }, http)).isError, true);
    const metadata = value(await call(left.handler, 'list_remote_tool_calls', {}, http));
    assert.equal(metadata.calls.length, 2);
    assert.ok(metadata.calls.every(row => row.nativeOutcome === 'UNKNOWN'));
    assert.equal(JSON.stringify(metadata).includes('PRIVATE_PROCESS_STREAM_CANARY'), false);
    child.finish(0, null);
    const callsBeforeHistory = h.records[0].calls.length;
    const retained = value(await call(left.handler, 'get_tool_result', { callId }, http));
    assert.equal(retained.resultAvailable, true); assert.equal(retained.independentlyVerified, false);
    assert.deepEqual(retained.result.structuredContent, value(started));
    assert.equal(retained.result.structuredContent.session.outcome, 'PENDING');
    assert.equal(retained.result.structuredContent.session.rootExitObserved, false);
    assert.equal(h.records[0].calls.length, callsBeforeHistory);
    assert.equal(h.records[0].children.length, 1); assert.equal(h.records[1].children.length, 0);
    const current = value(await call(left.handler, 'read_process_output', { sessionId }, http));
    assert.equal(current.session.outcome, 'SUCCEEDED');
  } finally { h.finishAll(); await left.handler.close(); await right.handler.close(); }
});

test('failed or exceptional launch evidence remains unproven through the canonical result', async () => {
  for (const [execute, expectedVerdict] of [
    [async () => ({ ok: false, schemaVersion: SCHEMA, operation: 'START_PROCESS_SESSION',
      launchState: 'UNKNOWN', blocker: 'SOVEREIGN_PROCESS_LAUNCH_UNPROVEN' }), 'SOVEREIGN_COMMANDER_EXECUTION_EFFECT_UNKNOWN'],
    [async () => { throw new Error('PRIVATE_PROCESS_LAUNCH_EXCEPTION'); }, 'SOVEREIGN_COMMANDER_EXECUTION_EFFECT_UNKNOWN'],
    [async () => ({ ...pendingReceipt(PROFILES[0]), launchState: 'NOT_STARTED' }), 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED'],
    [async () => ({ ...pendingReceipt(PROFILES[0]), session: { ...pendingReceipt(PROFILES[0]).session, spawnObserved: false } }), 'SOVEREIGN_COMMANDER_EXECUTION_EFFECT_UNKNOWN'],
  ]) {
    const result = await executeSovereignCommanderCommandV1(envelope('START_PROCESS_SESSION', { profile: PROFILES[0] }), {
      repoRoot: ROOT, routeProof: privateRoute, processSessions: { execute },
    });
    assert.equal(result.ok, false); assert.equal(result.finalVerdict, expectedVerdict);
    assert.equal(JSON.stringify(result).includes('PRIVATE_PROCESS_LAUNCH_EXCEPTION'), false);
  }
});

test('successful output queries preserve failed and unproven child outcomes instead of manufacturing process success', async () => {
  const h = processHarness(); const { handler } = await ready({ processSessionsFactory: h.factory });
  try {
    const failed = value(await call(handler, 'start_process', { profile: PROFILES[0] }));
    h.records[0].children[0].stderr.write('OWNED_FIXTURE_PROFILE_FAILED');
    h.records[0].children[0].finish(2, null);
    const failedRead = await call(handler, 'read_process_output', { sessionId: failed.sessionId });
    assert.equal(failedRead.isError, false, 'reading the receipt succeeds independently of the child outcome');
    assert.equal(value(failedRead).session.outcome, 'FAILED');
    assert.equal(value(failedRead).session.exitCode, 2);
    assert.equal(value(failedRead).session.nativeCustodyQualified, false);
    assert.equal(value(failedRead).session.maintenanceCustodyReleased, false);
    const uncertain = value(await call(handler, 'start_process', { profile: PROFILES[1] }));
    const child = h.records[0].children[1];
    child.fixtureClosed = true; child.stdout.end(); child.stderr.end();
    child.emit('close', null, null); // No exit event, exit code or signal supplies root-exit evidence.
    const unknownRead = await call(handler, 'read_process_output', { sessionId: uncertain.sessionId });
    assert.equal(unknownRead.isError, false);
    assert.equal(value(unknownRead).session.rootExitObserved, false);
    assert.equal(value(unknownRead).session.outcome, 'UNKNOWN');
    assert.equal(value(unknownRead).session.nativeCustodyQualified, false);
    assert.equal(value(unknownRead).session.descendantsExcluded, false);
  } finally { h.finishAll(); await handler.close(); }
});

test('handler disposal affects only its own children and cannot turn pending output into success', async () => {
  const h = processHarness({ autoCloseOnKill: false });
  const left = await ready({ processSessionsFactory: h.factory }), right = await ready({ processSessionsFactory: h.factory });
  try {
    const a = value(await call(left.handler, 'start_process', { profile: PROFILES[0] }));
    const b = value(await call(right.handler, 'start_process', { profile: PROFILES[1] }));
    const leftChild = h.records[0].children[0], rightChild = h.records[1].children[0];
    const disposing = left.handler.close();
    await bounded(leftChild.killedObservation, 'OWNED_CHILD_WAS_NOT_CANCELLED');
    assert.equal(leftChild.fixtureClosed, false); assert.equal(rightChild.killCalls, 0);
    assert.equal(a.session.outcome, 'PENDING'); assert.equal(a.session.rootExitObserved, false);
    assert.equal((await h.records[0].service.execute('LIST_SESSIONS', {})).ok, false);
    await assert.rejects(call(left.handler, 'read_process_output', { sessionId: a.sessionId }), /MCP_SESSION_CLOSED/);
    const stillRunning = value(await call(right.handler, 'read_process_output', { sessionId: b.sessionId }));
    assert.equal(stillRunning.session.rootExitObserved, false); assert.equal(stillRunning.session.outcome, 'PENDING');
    leftChild.finish(null, 'SIGTERM'); await bounded(disposing, 'HANDLER_DISPOSAL_DID_NOT_FINISH');
    await left.handler.close(); assert.equal(h.records[0].disposals, 1);
    assert.equal(rightChild.killCalls, 0);
  } finally { h.finishAll(); await left.handler.close(); await right.handler.close(); }
});

async function withHttpProcesses(action, makeHandler) {
  const TOKEN = 'sovereign-process-session-http-fixture-'.padEnd(64, 'x');
  const entries = []; let nextId = 1, stop;
  const created = await createSovereignCommanderHttpServer({ token: TOKEN, host: '127.0.0.1', port: 0,
    continuousRepairEnabled: false,
    handlerFactory() {
      const raw = makeHandler(), disposed = deferred();
      const entry = { handler: raw, closeCalls: 0, disposed: disposed.promise }; entries.push(entry);
      const handler = (method, params, message) => raw(method, params, message);
      handler.close = async () => { entry.closeCalls++; try { await raw.close(); } finally { disposed.resolve(); } };
      return handler;
    },
  });
  await new Promise((resolve, reject) => { created.server.once('error', reject); created.server.listen(0, created.host, resolve); });
  const base = 'http://127.0.0.1:' + created.server.address().port;
  const request = async (method, message, { sessionId, authorization = `Bearer ${TOKEN}` } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (authorization !== null) headers.authorization = authorization;
    if (sessionId) headers['mcp-session-id'] = sessionId;
    const response = await fetch(base + '/mcp', { method, headers,
      ...(message === undefined ? {} : { body: JSON.stringify(message) }), signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, sessionId: response.headers.get('mcp-session-id') };
  };
  const h = {
    entries, created,
    rpc: (method, params = {}, options = {}) => request('POST', {
      jsonrpc: '2.0', ...(method.startsWith('notifications/') ? {} : { id: nextId++ }), method, params,
    }, options),
    remove: sessionId => request('DELETE', undefined, { sessionId }),
    stop: () => stop ||= new Promise((resolve, reject) => created.server.close(error => error ? reject(error) : resolve())),
  };
  h.open = async () => {
    const result = await h.rpc('initialize'); assert.equal(result.status, 200); assert.ok(result.sessionId);
    await h.rpc('notifications/initialized', {}, { sessionId: result.sessionId });
    assert.equal((await h.rpc('tools/list', {}, { sessionId: result.sessionId })).status, 200);
    return result.sessionId;
  };
  try { await action(h); } finally { await h.stop(); await bounded(Promise.all(entries.map(entry => entry.disposed)), 'HTTP_HANDLERS_NOT_DISPOSED'); }
}

test('actual HTTP authentication, deletion and shutdown preserve process privacy and original Core custody', { timeout: 15000 }, async () => {
  const isolated = await import('../../scripts/sovereign-commander-mcp.mjs?process-integration-held-core-v1');
  const processes = processHarness(); let coreExecutions = 0, ownerCalls = 0;
  const makeHandler = () => isolated.createSovereignCommanderMcpHandler({ repoRoot: ROOT, processSessionsFactory: processes.factory,
    withMaintenanceOwner: () => { ownerCalls++; throw new Error('must not acquire owner'); },
    executor: async (command, options) => {
      if (command.operation === 'MAINTENANCE_ACTION' && command.payload.actionId === 'repair-core-publication-directories') {
        coreExecutions++; return { ok: false, executionCustodyReleased: false, blocker: 'FIXTURE_ORIGINAL_CORE_OUTCOME_UNPROVEN' };
      }
      return executeSovereignCommanderCommandV1(command, options);
    },
  });
  const coreRequest = { name: 'maintenance_action', arguments: { actionId: 'repair-core-publication-directories', expectedMain: 'a'.repeat(40) } };
  try {
    await withHttpProcesses(async h => {
      const unauthenticated = await h.rpc('initialize', {}, { authorization: null });
      assert.equal(unauthenticated.status, 401); assert.equal(h.entries.length, 0);
      const a = await h.open(), b = await h.open();
      const originalCore = await h.rpc('tools/call', coreRequest, { sessionId: a });
      assert.equal(originalCore.body.result.structuredContent.executionCustodyReleased, false); assert.equal(coreExecutions, 1);
      const aStarted = await h.rpc('tools/call', { name: 'start_process', arguments: { profile: PROFILES[0] } }, { sessionId: a });
      const bStarted = await h.rpc('tools/call', { name: 'start_process', arguments: { profile: PROFILES[1] } }, { sessionId: b });
      assert.equal(aStarted.body.result.isError, false); assert.equal(bStarted.body.result.isError, false);
      const aId = value(aStarted.body.result).sessionId, bId = value(bStarted.body.result).sessionId;
      const aChild = processes.records[0].children[0], bChild = processes.records[1].children[0];
      aChild.stdout.write('HTTP_PRIVATE_PROCESS_CANARY');
      const denied = await h.rpc('tools/call', { name: 'read_process_output', arguments: { sessionId: aId } }, { sessionId: a, authorization: null });
      assert.equal(denied.status, 401);
      const foreign = await h.rpc('tools/call', { name: 'read_process_output', arguments: { sessionId: aId } }, { sessionId: b });
      assert.equal(foreign.body.result.isError, true); assert.equal(JSON.stringify(foreign).includes('HTTP_PRIVATE_PROCESS_CANARY'), false);
      const read = await h.rpc('tools/call', { name: 'read_process_output', arguments: { sessionId: aId } }, { sessionId: a });
      assert.equal(value(read.body.result).session.rootExitObserved, false);
      assert.equal(value(read.body.result).chunks.map(chunk => chunk.text).join(''), 'HTTP_PRIVATE_PROCESS_CANARY');
      assert.equal((await h.remove(a)).status, 204); await bounded(h.entries[0].disposed, 'DELETED_HANDLER_NOT_DISPOSED');
      assert.equal(aChild.killCalls, 1); assert.equal(bChild.killCalls, 0);
      assert.equal(value(aStarted.body.result).session.outcome, 'PENDING');
      const bRead = await h.rpc('tools/call', { name: 'read_process_output', arguments: { sessionId: bId } }, { sessionId: b });
      assert.equal(value(bRead.body.result).session.outcome, 'PENDING');
      const successor = await h.open();
      const held = await h.rpc('tools/call', coreRequest, { sessionId: successor });
      assert.equal(held.body.result.structuredContent.blocker, 'CORE_DIRECTORY_ORIGINAL_REQUEST_REQUIRED_OR_BUSY');
      assert.equal(coreExecutions, 1); assert.equal(ownerCalls, 0);
      await h.stop(); await bounded(Promise.all(h.entries.map(entry => entry.disposed)), 'SERVER_CLOSE_NOT_DISPOSED');
      assert.equal(bChild.killCalls, 1); assert.equal(coreExecutions, 1); assert.equal(ownerCalls, 0);
      assert.ok(h.entries.every(entry => entry.closeCalls === 1));
      assert.equal(h.created.continuousRepairStatus().enabled, false);
    }, makeHandler);
    const successor = await ready({}, makeHandler);
    try {
      const held = await call(successor.handler, coreRequest.name, coreRequest.arguments, http);
      assert.equal(operation(held).blocker, 'CORE_DIRECTORY_ORIGINAL_REQUEST_REQUIRED_OR_BUSY'); assert.equal(coreExecutions, 1);
    } finally { await successor.handler.close(); }
  } finally { processes.finishAll(); }
});
