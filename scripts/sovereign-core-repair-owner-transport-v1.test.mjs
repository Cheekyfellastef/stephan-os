import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createSovereignCommanderMcpHandler } from './sovereign-commander-mcp.mjs';
import { executeSovereignCommanderCommandV1 } from '../shared/agents/sovereignCommanderV1.mjs';
import {
  callSovereignMaintenanceOwnerV1,
  querySovereignMaintenanceRequestStatusV1,
  prepareSovereignMaintenanceRequestV1,
} from '../shared/agents/sovereignCommanderRemoteMailboxV1.mjs';
import { SOVEREIGN_MAINTENANCE_OWNER_VERSION } from '../shared/agents/sovereignMaintenanceAdmissionV1.mjs';
import {
  captureCoreRepairContinuationV1, captureCoreRepairContinuationStatusV1,
  unknownCoreRepairRequestStatusV1,
} from '../shared/agents/sovereignMaintenanceAdmissionV1.mjs';
import {
  buildStephanosExecutionCommandEnvelopeV1, buildStephanosExecutionSurfaceCatalogV1,
  STEPHANOS_EXECUTION_SURFACE,
} from '../shared/agents/stephanosExecutionCommandFabricV1.mjs';

const root = resolve(import.meta.dirname, '..');
const token = 'fixture-only-core-owner-token-'.repeat(3);
const sourceHead = 'a'.repeat(40), observerHead = 'b'.repeat(40);
const now = '2026-11-17T10:00:00.000Z';
const protocol = { ok: true, service: 'stephanos-sovereign-commander',
  maintenanceOwnerAdmissionVersion: SOVEREIGN_MAINTENANCE_OWNER_VERSION,
  observationScope: 'TRANSPORT_PROTOCOL_ONLY', maintenanceAdmissionProven: false };

function continuation(overrides = {}) {
  const result = captureCoreRepairContinuationV1({
    schemaVersion: 'stephanos.core-repair-continuation.v1', requestId: 'core-original-0001',
    missionId: 'stephanos-core-octopus-self-heal', relatedIssue: '#2961',
    actionId: 'repair-goal-builder-flow', sourceHead, sequence: 1, previousRequestId: '',
    enrollmentId: 'd'.repeat(64),
    ...overrides,
  });
  assert(result, 'valid test correlation');
  return result;
}
function status(original, overrides = {}) {
  const result = captureCoreRepairContinuationStatusV1({
    ...unknownCoreRepairRequestStatusV1({ continuation: original, observedAtUtc: now, observerSourceHead: sourceHead }),
    ok: true, state: 'SUCCEEDED', historyAuthenticated: true,
    custodyReleased: true, currentAdmissionAvailable: true,
    nextSequence: original.sequence + 1, previousRequestId: original.requestId,
    terminalProofHash: 'c'.repeat(64), blocker: '',
    ownerProtocolVersion: 'core-request-prepare-execute-v1', enrollmentId: original.enrollmentId,
    initialEpochProven: true, preparationRequired: true,
    sameRequestPreparationAllowed: false, sameRequestDeliveryAllowed: false,
    ...overrides,
  });
  assert(result, 'valid test owner observation');
  return result;
}
function preparedStatus(original) {
  return status(original, { state: 'PREPARED', terminalProofHash: '',
    custodyReleased: false, currentAdmissionAvailable: false, nextSequence: null,
    previousRequestId: '', sameRequestDeliveryAllowed: true });
}
function request(original, overrides = {}) {
  return { actionId: original.actionId, arguments: { actionId: original.actionId },
    timeoutMs: 160_000, coreContinuation: original, ...overrides };
}
function envelope(original, overrides = {}) {
  return buildStephanosExecutionCommandEnvelopeV1({
    catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: root }),
    surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
    actionId: original.requestId, missionId: original.missionId, relatedIssue: original.relatedIssue,
    operation: 'MAINTENANCE_ACTION', payload: { actionId: original.actionId }, ...overrides,
  });
}
const message = (id = 3) => ({ id, isRequest: true, isNotification: false,
  transportKind: 'authenticated-http-jsonrpc', transportAuthenticated: true });

async function readyHandler(options = {}) {
  const handler = createSovereignCommanderMcpHandler({ repoRoot: root, ...options });
  await handler('initialize', { protocolVersion: '2025-06-18' }, message(1));
  await handler('notifications/initialized', {}, { isNotification: true });
  await handler('tools/list', {}, message(2));
  return handler;
}

// The wire bridge runs the actual client, MCP handler and Commander. Its owner
// callback and process primitive are inert test seams, not native qualification.
function bridge(t, options = {}) {
  const sessions = new Map(), calls = [], envelopes = [], ownerCalls = [], nativeCalls = [];
  let nextSession = 0, credentialReads = 0;
  const handlers = [];
  t.after(async () => { for (const handler of handlers) await handler.close(); });
  const owner = options.owner || (async (command, run, context) => {
    const result = await run();
    return context.coreContinuation ? { ...result, coreContinuation: context.coreContinuation,
      coreRequestStatus: status(context.coreContinuation) } : result;
  });
  const makeHandler = () => {
    const handler = createSovereignCommanderMcpHandler({ repoRoot: root,
      readMaintenanceRequestStatus: options.readStatus || (query => preparedStatus(query.continuation)),
      prepareMaintenanceRequest: options.prepare,
      withMaintenanceOwner: async (command, run, context) => {
        ownerCalls.push({ command, context }); return owner(command, run, context);
      },
      executor: async (input, context) => {
        envelopes.push({ input, context });
        return executeSovereignCommanderCommandV1(input, { ...context,
          spawnSyncFn: (executable, args, settings) => {
            nativeCalls.push({ executable, args, settings });
            return { status: 0, stdout: '{"fixture":true}', stderr: '' };
          },
        });
      },
    });
    handlers.push(handler); return handler;
  };
  return { calls, envelopes, ownerCalls, nativeCalls, credentials: () => credentialReads, options: {
    readFileFn: async () => { credentialReads++; return token; },
    fetchFn: async (url, init) => {
      assert(url.startsWith('http://127.0.0.1:18791/'));
      calls.push({ url, method: init.method, message: init.body ? JSON.parse(init.body) : null });
      if (init.method === 'GET') {
        assert.equal(url, 'http://127.0.0.1:18791/health?view=protocol');
        await options.onHealth?.();
        return new Response(JSON.stringify(options.health === undefined ? protocol : options.health));
      }
      assert.equal(url, 'http://127.0.0.1:18791/mcp');
      assert.equal(init.headers.authorization, `Bearer ${token}`);
      const sessionId = init.headers['mcp-session-id'];
      if (init.method === 'DELETE') {
        assert(sessions.has(sessionId)); await sessions.get(sessionId).close();
        sessions.delete(sessionId); return new Response(null, { status: 204 });
      }
      const input = JSON.parse(init.body);
      if (input.method === 'initialize') {
        const id = `fixture-session-${++nextSession}`, handler = makeHandler();
        sessions.set(id, handler);
        const result = await handler(input.method, input.params, message(input.id));
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }), {
          headers: { 'mcp-session-id': id },
        });
      }
      assert(sessions.has(sessionId));
      const transport = input.id === undefined ? { isNotification: true } : message(input.id);
      let result = await sessions.get(sessionId)(input.method, input.params || {}, transport);
      if (input.method === 'tools/list' && options.hideTool)
        result = { tools: result.tools.filter(tool => tool.name !== options.hideTool) };
      if (input.method === 'tools/call') result = await options.afterTool?.(result, input) ?? result;
      if (input.id === undefined) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }));
    },
  } };
}

test('Core identity crosses the actual Commander/client/MCP/owner chain without becoming process arguments', async t => {
  const original = continuation(), fixture = bridge(t);
  const result = await executeSovereignCommanderCommandV1(envelope(original), { repoRoot: root,
    coreContinuation: original,
    callMaintenanceOwner: value => callSovereignMaintenanceOwnerV1(value, fixture.options),
    spawnSyncFn: () => assert.fail('Core caller must not launch beside its existing owner'),
  });
  assert.equal(result.ok, true);
  assert.equal(result.command.commandId, original.requestId);
  assert.equal(result.command.missionId, original.missionId);
  assert.equal(result.command.relatedIssue, original.relatedIssue);
  assert.deepEqual(result.coreContinuation, original);
  assert.equal(result.structuredContent.ownerCommandId, original.requestId);
  assert.equal(fixture.ownerCalls.length, 1); assert.equal(fixture.nativeCalls.length, 1);
  assert.equal(fixture.ownerCalls[0].command.commandId, original.requestId);
  assert.deepEqual(fixture.ownerCalls[0].context.coreContinuation, original);
  assert.deepEqual(fixture.envelopes[0].input.payload, { actionId: original.actionId });
  assert.equal(fixture.envelopes[0].input.relatedIssue, '#2961');
  assert(!fixture.nativeCalls[0].args.some(arg => String(arg).includes(original.requestId)));
  assert.equal(fixture.calls.filter(call => call.message?.params?.name === 'maintenance_action').length, 1);
  assert.equal(fixture.calls.filter(call => call.message?.params?.name === 'maintenance_request_status').length, 1);
});

test('a new authenticated session preserves the same original identity and its owner response', async t => {
  const original = continuation(), observed = [];
  const fixture = bridge(t, { owner: async (command, _run, context) => {
    observed.push(command.commandId);
    return { ok: false, command, blocker: 'CORE_REPAIR_REQUEST_RESERVED',
      finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED', coreContinuation: context.coreContinuation,
      coreRequestStatus: status(original, { state: 'RESERVED', custodyReleased: false,
        currentAdmissionAvailable: false, nextSequence: null, terminalProofHash: '',
        previousRequestId: '', blocker: 'CORE_REPAIR_REQUEST_RESERVED' }) };
  } });
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await callSovereignMaintenanceOwnerV1(request(original), fixture.options);
    assert.equal(result.command.commandId, original.requestId);
    assert.equal(result.coreRequestStatus.state, 'RESERVED');
  }
  assert.deepEqual(observed, [original.requestId, original.requestId]);
  assert.equal(fixture.calls.filter(call => call.message?.method === 'initialize').length, 2);
  assert.equal(fixture.nativeCalls.length, 0, 'status-like owner refusal never runs the fixed action');
});

test('malformed or widened Core metadata is rejected before the owner client reads credentials or sends requests', async () => {
  const original = continuation();
  let touched = 0, getters = 0;
  const options = { fetchFn: () => { touched++; assert.fail('invalid metadata reached transport'); },
    readFileFn: () => { touched++; assert.fail('invalid metadata read credential'); } };
  const invalid = [
    request(original, { actionId: 'repair-control-plane' }),
    request(original, { arguments: { actionId: original.actionId, command: 'caller-shell' } }),
    request(original, { arbitraryPath: 'C:\\private' }),
    request(original, { coreContinuation: { ...original, sourceHead: 'foreign' } }),
    request(original, { coreContinuation: { ...original, enrollmentId: '' } }),
    request(original, { coreContinuation: Object.fromEntries(Object.entries(original).filter(([key]) => key !== 'enrollmentId')) }),
    request(original, { coreContinuation: { ...original, callerQualified: true } }),
    request(original, { coreContinuation: { ...original, get sourceHead() { getters++; return sourceHead; } } }),
    Object.assign(Object.create({ coreContinuation: original }), { actionId: original.actionId,
      arguments: { actionId: original.actionId } }),
  ];
  for (const input of invalid) assert.equal((await callSovereignMaintenanceOwnerV1(input, options)).blocker,
    'SOVEREIGN_CORE_REPAIR_CORRELATION_INVALID');
  assert.equal(touched, 0); assert.equal(getters, 0);
});

test('the client captures the original tuple before health or session awaits', async t => {
  const original = continuation(), mutable = JSON.parse(JSON.stringify(request(original)));
  const fixture = bridge(t, { onHealth: () => {
    mutable.coreContinuation.requestId = 'core-replacement-0002';
    mutable.coreContinuation.sourceHead = observerHead;
    mutable.coreContinuation.enrollmentId = 'e'.repeat(64);
    mutable.arguments.actionId = 'repair-control-plane';
    mutable.actionId = 'repair-control-plane';
  } });
  const result = await callSovereignMaintenanceOwnerV1(mutable, fixture.options);
  assert.equal(result.ok, true);
  assert.deepEqual(fixture.ownerCalls[0].context.coreContinuation, original);
  assert.equal(fixture.ownerCalls[0].command.plan.processId, original.actionId);
});

test('even rehashed success cannot replace the original identity, source, mission or status binding', async t => {
  const original = continuation();
  const rewrites = [
    value => ({ ...value, command: { ...value.command, commandId: 'mcp-replacement-0001' } }),
    value => ({ ...value, command: { ...value.command, missionId: 'mcp-session-replacement' } }),
    value => ({ ...value, coreContinuation: { ...original, sourceHead: observerHead } }),
    value => ({ ...value, coreContinuation: { ...original, enrollmentId: 'e'.repeat(64) } }),
    value => ({ ...value, coreContinuation: undefined }),
    value => ({ ...value, coreRequestStatus: undefined }),
    value => ({ ...value, coreRequestStatus: status(continuation({ requestId: 'core-foreign-0002' })) }),
    value => ({ ...value, coreRequestStatus: status(continuation({ enrollmentId: 'e'.repeat(64) })) }),
  ];
  for (const rewrite of rewrites) {
    const fixture = bridge(t, { afterTool: (result, input) => {
      if (input.params.name !== 'maintenance_action') return result;
      const value = rewrite(result.structuredContent);
      value.proofHash = createHash('sha256').update(JSON.stringify({ commandId: value.command.commandId,
        missionId: value.command.missionId, operation: value.command.operation, plan: value.command.plan,
        contentText: value.contentText, structuredContent: value.structuredContent })).digest('hex');
      return { ...result, structuredContent: value };
    } });
    const result = await callSovereignMaintenanceOwnerV1(request(original), fixture.options);
    assert.equal(result.blocker, 'SOVEREIGN_MAINTENANCE_OWNER_RECEIPT_INVALID');
    assert.equal(fixture.nativeCalls.length, 1);
    assert.equal(fixture.calls.filter(call => call.message?.params?.name === 'maintenance_action').length, 1,
      'an invalid response after launch must not retry');
  }
});

test('Commander rejects a correlation that does not bind its actual operation and envelope', async () => {
  const original = continuation();
  for (const input of [envelope(original, { actionId: 'different-command-0001' }),
    envelope(original, { missionId: 'different-mission' }), envelope(original, { relatedIssue: '#2573' }),
    envelope(original, { payload: { actionId: 'repair-control-plane' } }),
    envelope(original, { payload: { actionId: original.actionId, requestedPath: 'C:\\private' } }),
    envelope(original, { operation: 'GET_CONFIG', payload: {} })]) {
    const result = await executeSovereignCommanderCommandV1(input, { repoRoot: root, coreContinuation: original,
      withMaintenanceOwner: () => assert.fail('unbound request acquired owner'),
      callMaintenanceOwner: () => assert.fail('unbound request delegated'),
      spawnSyncFn: () => assert.fail('unbound request launched'),
    });
    assert.equal(result.blocker, 'SOVEREIGN_CORE_REPAIR_CORRELATION_INVALID');
  }
  const inherited = Object.assign(Object.create({ coreContinuation: original }), { repoRoot: root,
    callMaintenanceOwner: () => assert.fail('inherited tuple silently became a legacy request'),
    spawnSyncFn: () => assert.fail('inherited tuple launched'),
  });
  assert.equal((await executeSovereignCommanderCommandV1(envelope(original), inherited)).blocker,
    'SOVEREIGN_CORE_REPAIR_CORRELATION_INVALID');
});

test('MCP metadata is closed and private; malformed correlation never becomes a fresh legacy request', async t => {
  const original = continuation(); let calls = 0, getters = 0;
  const handler = await readyHandler({ executor: () => { calls++; assert.fail('invalid MCP tuple executed'); } });
  t.after(() => handler.close());
  const invalid = [
    { actionId: original.actionId, coreContinuation: null },
    { actionId: original.actionId, coreContinuation: original, path: 'C:\\private' },
    { actionId: 'repair-control-plane', coreContinuation: original },
    { actionId: original.actionId, coreContinuation: { ...original, authority: true } },
    { actionId: original.actionId, coreContinuation: { ...original, enrollmentId: '' } },
    { actionId: original.actionId, get coreContinuation() { getters++; return original; } },
    Object.create({ actionId: original.actionId, coreContinuation: original }),
    { actionId: original.actionId, coreContinuation: original, [Symbol('proof')]: true },
  ];
  for (const args of invalid) {
    const result = await handler('tools/call', { name: 'maintenance_action', arguments: args }, message());
    assert.equal(result.structuredContent.blocker, 'SOVEREIGN_CORE_REPAIR_CORRELATION_INVALID');
  }
  for (const transport of [{ isRequest: true }, { ...message(), transportAuthenticated: false },
    { ...message(), transportKind: 'public-mailbox' }]) {
    const result = await handler('tools/call', { name: 'maintenance_action',
      arguments: { actionId: original.actionId, coreContinuation: original } }, transport);
    assert.equal(result.structuredContent.blocker, 'SOVEREIGN_CORE_REPAIR_CORRELATION_INVALID');
  }
  assert.equal(calls, 0); assert.equal(getters, 0);
});

test('legacy maintenance retains its session identity and does not borrow Core correlation', async t => {
  const fixture = bridge(t), original = continuation();
  const { coreContinuation: _omitted, ...legacy } = request(original);
  const result = await callSovereignMaintenanceOwnerV1(legacy, fixture.options);
  assert.equal(result.ok, true);
  assert.match(result.command.commandId, /^mcp-/);
  assert.match(result.command.missionId, /^mcp-session-/);
  assert.equal(Object.hasOwn(fixture.ownerCalls[0].context, 'coreContinuation'), false);
  assert.equal(Object.hasOwn(result, 'coreContinuation'), false);
});

test('original request observation preserves historical source and terminal custody distinction', async t => {
  const original = continuation(); let reads = 0;
  const terminalWithoutRelease = status(original, { observerSourceHead: observerHead,
    custodyReleased: false, currentAdmissionAvailable: false, nextSequence: null,
    previousRequestId: '', blocker: 'CORE_REPAIR_REQUEST_RELEASE_UNPROVEN' });
  const fixture = bridge(t, { readStatus: query => {
    reads++; assert.deepEqual(query, { continuation: original }); return terminalWithoutRelease;
  } });
  const result = await querySovereignMaintenanceRequestStatusV1({ continuation: original }, fixture.options);
  assert.deepEqual(result, terminalWithoutRelease);
  assert.equal(result.continuation.sourceHead, sourceHead); assert.equal(result.observerSourceHead, observerHead);
  assert.equal(result.state, 'SUCCEEDED'); assert.equal(result.custodyReleased, false);
  assert.equal(result.currentAdmissionAvailable, false); assert.equal(result.nextSequence, null);
  assert.equal(reads, 1); assert.equal(fixture.envelopes.length, 0); assert.equal(fixture.ownerCalls.length, 0);
  assert.equal(fixture.nativeCalls.length, 0);
  assert.equal(fixture.calls.filter(call => call.message?.params?.name === 'maintenance_action').length, 0);
});

test('an accepted action with a lost response is observed in a new session without another execution', async t => {
  const original = continuation(); let saved = null, dropped = false;
  const fixture = bridge(t, {
    owner: async (command, run, context) => {
      const executed = await run(); saved = status(context.coreContinuation);
      return { ...executed, command, coreContinuation: context.coreContinuation, coreRequestStatus: saved };
    },
    readStatus: query => { assert.deepEqual(query.continuation, original); return saved || preparedStatus(original); },
    afterTool: (result, input) => {
      if (!dropped && input.params.name === 'maintenance_action') { dropped = true; throw new Error('response lost'); }
      return result;
    },
  });
  assert.equal((await callSovereignMaintenanceOwnerV1(request(original), fixture.options)).ok, false);
  const observed = await querySovereignMaintenanceRequestStatusV1({ continuation: original }, fixture.options);
  assert.equal(observed.state, 'SUCCEEDED'); assert.deepEqual(observed.continuation, original);
  assert.equal(fixture.nativeCalls.length, 1); assert.equal(fixture.ownerCalls.length, 1);
  assert.equal(fixture.calls.filter(call => call.message?.method === 'initialize').length, 2);
});

test('fixed metadata preparation requires the complete original tuple and cannot invoke the executor', async t => {
  const original = continuation(); let preparations = 0;
  const prepared = preparedStatus(original);
  const fixture = bridge(t, { prepare: query => {
    preparations++; assert.deepEqual(query, { continuation: original }); return prepared;
  } });
  const result = await prepareSovereignMaintenanceRequestV1({ continuation: original }, fixture.options);
  assert.deepEqual(result, prepared); assert.equal(preparations, 1);
  assert.equal(fixture.envelopes.length, 0); assert.equal(fixture.ownerCalls.length, 0);
  assert.equal(fixture.nativeCalls.length, 0);
  assert.equal((await prepareSovereignMaintenanceRequestV1({}, fixture.options)).ok, false);
  assert.equal(preparations, 1);
  const handler = await readyHandler({ prepareMaintenanceRequest: () => assert.fail('stdio preparation is forbidden') });
  t.after(() => handler.close());
  const listed = await handler('tools/list', {}, message());
  assert.equal(listed.tools.find(tool => tool.name === 'maintenance_request_prepare').annotations.readOnlyHint, false);
  assert.equal(listed.tools.find(tool => tool.name === 'maintenance_request_status').annotations.readOnlyHint, true);
  const denied = await handler('tools/call', { name: 'maintenance_request_prepare',
    arguments: { continuation: original } }, { ...message(), transportKind: 'local-stdio-mcp' });
  assert.equal(denied.isError, true);
});

test('status and preparation reject arbitrary locators, receipt bodies and authority before transport', async () => {
  const original = continuation(); let touches = 0, getters = 0;
  const options = { fetchFn: () => { touches++; assert.fail('bad query reached transport'); },
    readFileFn: () => { touches++; assert.fail('bad query read credential'); } };
  const bad = [null, [], { path: 'C:\\archive' }, { requestId: original.requestId },
    { continuation: original, pid: 123 }, { continuation: original, receipt: {} },
    { continuation: { ...original, executionAuthority: true } },
    { continuation: { ...original, enrollmentId: '' } },
    { get continuation() { getters++; return original; } }, Object.create({ continuation: original })];
  for (const value of bad) for (const call of [querySovereignMaintenanceRequestStatusV1, prepareSovereignMaintenanceRequestV1])
    assert.equal((await call(value, options)).blocker, 'SOVEREIGN_MAINTENANCE_REQUEST_STATUS_ARGUMENTS_INVALID');
  assert.equal(touches, 0); assert.equal(getters, 0);
});

test('a specific request cannot borrow a foreign status or a current empty READY slot', async t => {
  const original = continuation(), foreign = continuation({ requestId: 'core-unrelated-0002' });
  const ready = { ...status(original), state: 'READY', continuation: null,
    nextSequence: 1, previousRequestId: '', terminalProofHash: '' };
  for (const returned of [status(foreign), ready]) {
    const fixture = bridge(t, { readStatus: () => returned });
    assert.equal((await querySovereignMaintenanceRequestStatusV1({ continuation: original }, fixture.options)).ok, false);
    assert.equal(fixture.nativeCalls.length, 0);
  }
});

test('legacy capability, unavailable owner and malformed positive receipt stay unknown without retries', async t => {
  const original = continuation();
  const hidden = bridge(t, { hideTool: 'maintenance_request_status', readStatus: () => assert.fail('missing capability called') });
  assert.equal((await querySovereignMaintenanceRequestStatusV1({ continuation: original }, hidden.options)).blocker,
    'SOVEREIGN_MAINTENANCE_REQUEST_STATUS_TOOL_UNAVAILABLE');
  assert.equal(hidden.calls.filter(call => call.message?.method === 'tools/call').length, 0);
  const old = bridge(t, { health: { ...protocol, maintenanceAdmissionProven: true } });
  assert.equal((await querySovereignMaintenanceRequestStatusV1({ continuation: original }, old.options)).blocker,
    'SOVEREIGN_MAINTENANCE_REQUEST_STATUS_PROTOCOL_REQUIRED');
  assert.equal(old.credentials(), 0);
  const unavailable = bridge(t, { readStatus: () => { throw new Error('private path must not leak'); } });
  const failed = await querySovereignMaintenanceRequestStatusV1({ continuation: original }, unavailable.options);
  assert.equal(failed.ok, false); assert(!JSON.stringify(failed).includes('private path'));
  assert.equal(unavailable.calls.filter(call => call.message?.method === 'tools/call').length, 1);
  const malformed = bridge(t, { readStatus: () => status(original), afterTool: result => ({ ...result,
    structuredContent: { ...result.structuredContent, executionAuthority: true } }) });
  assert.equal((await querySovereignMaintenanceRequestStatusV1({ continuation: original }, malformed.options)).blocker,
    'SOVEREIGN_MAINTENANCE_REQUEST_STATUS_RECEIPT_INVALID');
  assert.equal(malformed.nativeCalls.length, 0);
});

test('a downgraded owner cannot receive a correlated executable POST even after prior client preparation', async t => {
  const original = continuation();
  for (const hidden of ['maintenance_request_status', 'maintenance_request_prepare']) {
    const fixture = bridge(t, { hideTool: hidden });
    const result = await callSovereignMaintenanceOwnerV1(request(original), fixture.options);
    assert.equal(result.blocker, 'SOVEREIGN_CORE_REPAIR_OWNER_PROTOCOL_REQUIRED');
    assert.equal(fixture.calls.filter(call => call.message?.params?.name === 'maintenance_action').length, 0);
    assert.equal(fixture.nativeCalls.length, 0);
  }
  for (const returned of [
    unknownCoreRepairRequestStatusV1({ continuation: original, observedAtUtc: now, observerSourceHead: sourceHead }),
    status(original),
    status(original, { state: 'RESERVED', custodyReleased: false, currentAdmissionAvailable: false,
      nextSequence: null, terminalProofHash: '', previousRequestId: '' }),
    { ...preparedStatus(original), observerSourceHead: observerHead },
  ]) {
    const fixture = bridge(t, { readStatus: () => returned });
    assert.equal((await callSovereignMaintenanceOwnerV1(request(original), fixture.options)).ok, false);
    assert.equal(fixture.calls.filter(call => call.message?.params?.name === 'maintenance_action').length, 0);
    assert.equal(fixture.nativeCalls.length, 0);
  }
});
