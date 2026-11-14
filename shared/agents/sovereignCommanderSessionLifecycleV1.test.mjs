import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSovereignCommanderHttpServer,
  SOVEREIGN_COMMANDER_HTTP_MAX_MCP_SESSIONS,
  SOVEREIGN_COMMANDER_HTTP_MCP_IDLE_TTL_MS,
} from '../../scripts/sovereign-commander-http.mjs';

const TOKEN = 'lifecycle-fixture-token-'.padEnd(64, 'x');
const INITIAL_TIME = Date.parse('2026-11-06T22:00:00.000Z');
const MAX_SESSIONS = SOVEREIGN_COMMANDER_HTTP_MAX_MCP_SESSIONS;
const IDLE_TTL = SOVEREIGN_COMMANDER_HTTP_MCP_IDLE_TTL_MS;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function bounded(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), 3000);
    timer.unref();
  });
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(timer); }
}

async function withLifecycleServer(action, { behavior, handlerFactory } = {}) {
  let current = INITIAL_TIME, nextRpcId = 1, stopPromise;
  const records = [], gates = [], inFlight = new Set();
  const harness = {
    records,
    gate() { const gate = deferred(); gates.push(gate); return gate; },
    advance(milliseconds) { current += milliseconds; },
    setTime(milliseconds) { current = milliseconds; },
  };
  const created = await createSovereignCommanderHttpServer({
    token: TOKEN, host: '127.0.0.1', port: 0, continuousRepairEnabled: false,
    now: () => new Date(current).toISOString(), nowMs: () => current,
    handlerFactory: () => {
      const disposal = deferred();
      const record = {
        index: records.length, methods: [], initializeCalls: 0, toolCalls: 0,
        closeCalls: 0, disposed: false, actionSignals: [], disposal: disposal.promise,
      };
      records.push(record);
      const specific = behavior?.(record, harness) || {};
      const original = handlerFactory?.(record, harness);
      const handler = async (method, params, message) => {
        record.methods.push(method);
        assert.equal(message.transportKind, 'authenticated-http-jsonrpc');
        assert.equal(message.transportAuthenticated, true);
        if (method === 'initialize') record.initializeCalls++;
        if (method === 'tools/call') {
          record.toolCalls++;
          record.actionSignals.push(message.signal);
        }
        if (original) return original(method, params, message);
        if (method === 'initialize') {
          await specific.initialize?.(params, message);
          return {
            protocolVersion: '2025-11-25', capabilities: { tools: {} },
            serverInfo: { name: 'sovereign-lifecycle-fixture', version: '1' },
            lifecycleHandlerIndex: record.index,
          };
        }
        if (method === 'notifications/initialized') return undefined;
        if (method === 'tools/list') return { tools: [{ name: 'fixture_read_only' }] };
        if (method === 'tools/call') return specific.call
          ? specific.call(params, message)
          : { ok: true, observationOnly: true, executionCustodyReleased: false };
        if (method === 'ping') return {};
        throw new Error('UNEXPECTED_FIXTURE_METHOD');
      };
      handler.close = async () => {
        record.closeCalls++;
        await original?.close?.();
        await specific.close?.();
        record.disposed = true;
        disposal.resolve();
      };
      return handler;
    },
  });
  await new Promise((resolve, reject) => {
    created.server.once('error', reject);
    created.server.listen(0, created.host, resolve);
  });
  const address = created.server.address();
  const base = 'http://127.0.0.1:' + address.port;
  const request = (method, message, { sessionId, authorization = 'Bearer ' + TOKEN, signal } = {}) => {
    const promise = (async () => {
      const headers = { 'content-type': 'application/json' };
      if (authorization !== null) headers.authorization = authorization;
      if (sessionId) headers['mcp-session-id'] = sessionId;
      const response = await fetch(base + '/mcp', {
        method, headers, ...(message === undefined ? {} : { body: JSON.stringify(message) }),
        signal: signal || AbortSignal.timeout(5000),
      });
      const text = await response.text();
      return {
        status: response.status, body: text ? JSON.parse(text) : null,
        sessionId: response.headers.get('mcp-session-id'),
      };
    })();
    inFlight.add(promise);
    promise.then(() => inFlight.delete(promise), () => inFlight.delete(promise));
    return promise;
  };
  harness.created = created;
  harness.base = base;
  harness.rpc = (method, params = {}, options = {}) => request('POST', {
    jsonrpc: '2.0',
    ...(method.startsWith('notifications/') ? {} : { id: nextRpcId++ }),
    method, params,
  }, options);
  harness.remove = (sessionId, options = {}) => request('DELETE', undefined, { sessionId, ...options });
  harness.open = async () => {
    const opened = await harness.rpc('initialize');
    assert.equal(opened.status, 200);
    assert.ok(opened.sessionId);
    assert.equal((await harness.rpc('notifications/initialized', {}, { sessionId: opened.sessionId })).status, 202);
    assert.equal((await harness.rpc('tools/list', {}, { sessionId: opened.sessionId })).status, 200);
    return { ...opened, record: records[opened.body.result.lifecycleHandlerIndex] };
  };
  harness.stop = () => {
    if (!stopPromise) stopPromise = new Promise((resolve, reject) => {
      created.server.close(error => error ? reject(error) : resolve());
    });
    return stopPromise;
  };
  try { return await action(harness); }
  finally {
    for (const gate of gates) gate.resolve({ ok: false, executionCustodyReleased: false });
    await Promise.allSettled([...inFlight]);
    await harness.stop();
  }
}

test('real HTTP admission caps established sessions at 16 before constructing another handler', { timeout: 10000 }, async () => {
  assert.equal(MAX_SESSIONS, 16);
  await withLifecycleServer(async h => {
    const sessions = [];
    for (let index = 0; index < MAX_SESSIONS; index++) sessions.push(await h.open());
    const refused = await h.rpc('initialize');
    assert.equal(refused.status, 429);
    assert.equal(refused.body.error.message, 'MCP_SESSION_CAPACITY_REACHED');
    assert.equal(h.created.sessionCount(), 16);
    assert.equal(h.records.length, 16);
    assert.ok(h.records.every(record => record.initializeCalls === 1 && record.closeCalls === 0));
    assert.equal(h.records.reduce((total, record) => total + record.toolCalls, 0), 0);
    assert.equal((await h.rpc('ping', {}, { sessionId: sessions[0].sessionId })).status, 200);
  });
});

test('concurrently pending HTTP initializations reserve all 16 slots without an oversubscription race', { timeout: 10000 }, async () => {
  let initGate, allEntered;
  await withLifecycleServer(async h => {
    initGate = h.gate(); allEntered = h.gate();
    const requests = Array.from({ length: MAX_SESSIONS + 1 }, () => h.rpc('initialize'));
    try {
      await bounded(allEntered.promise, 'PENDING_INITIALIZATIONS_DID_NOT_ENTER');
      assert.equal(h.created.sessionCount(), 0, 'no pending initialization is an established session');
      const refusal = await bounded(Promise.race(requests), 'UNRESERVED_INITIALIZATIONS_OVERSUBSCRIBED_CAPACITY');
      assert.equal(refusal.status, 429);
      assert.equal(h.records.length, 16);
      assert.ok(h.records.every(record => record.initializeCalls === 1));
    } finally { initGate.resolve(); }
    const responses = await Promise.all(requests);
    assert.equal(responses.filter(response => response.status === 200).length, 16);
    assert.equal(responses.filter(response => response.status === 429).length, 1);
    assert.equal(h.created.sessionCount(), 16);
    assert.equal(new Set(responses.filter(response => response.status === 200).map(response => response.sessionId)).size, 16);
    assert.equal(h.records.reduce((total, record) => total + record.toolCalls, 0), 0);
  }, { behavior: (record, h) => ({
    async initialize() {
      if (h.records.filter(row => row.initializeCalls === 1).length === MAX_SESSIONS) allEntered.resolve();
      await initGate.promise;
    },
  }) });
});

test('30-minute idle expiry frees abandoned capacity on the same listening HTTP server', { timeout: 10000 }, async () => {
  assert.equal(IDLE_TTL, 30 * 60 * 1000);
  await withLifecycleServer(async h => {
    const firstAddress = h.created.server.address();
    const sessions = [];
    for (let index = 0; index < MAX_SESSIONS; index++) sessions.push(await h.open());
    h.advance(IDLE_TTL - 1);
    assert.equal((await h.rpc('initialize')).status, 429, 'one millisecond before expiry retains sessions');
    assert.ok(h.records.every(record => record.closeCalls === 0));
    h.advance(1);
    const replacement = await h.open();
    assert.equal(h.created.sessionCount(), 1);
    assert.equal(h.records.length, 17);
    for (const session of sessions) {
      assert.equal(session.record.closeCalls, 1);
      assert.equal(session.record.disposed, true);
    }
    assert.equal(replacement.record.closeCalls, 0);
    assert.equal((await h.rpc('ping', {}, { sessionId: sessions[0].sessionId })).status, 400);
    assert.equal((await h.rpc('ping', {}, { sessionId: replacement.sessionId })).status, 200);
    assert.deepEqual(h.created.server.address(), firstAddress);
    assert.equal(h.created.server.listening, true);
    assert.equal(h.records.reduce((total, record) => total + record.toolCalls, 0), 0);
  });
});

test('an active HTTP request survives idle-clock advancement and is neither disposed nor replayed', { timeout: 10000 }, async () => {
  let actionGate, entered;
  await withLifecycleServer(async h => {
    actionGate = h.gate(); entered = h.gate();
    const active = await h.open(), abandoned = await h.open();
    const pending = h.rpc('tools/call', { name: 'fixture_native_operation' }, { sessionId: active.sessionId });
    await bounded(entered.promise, 'ORIGINAL_ACTION_DID_NOT_ENTER');
    h.advance(IDLE_TTL + 1);
    const replacement = await h.open();
    assert.equal(active.record.closeCalls, 0);
    assert.equal(active.record.actionSignals[0].aborted, false);
    assert.equal(active.record.toolCalls, 1);
    assert.equal(abandoned.record.closeCalls, 1);
    assert.equal(h.created.sessionCount(), 2);
    actionGate.resolve({ ok: false, executionCustodyReleased: false, nativeOutcome: 'UNKNOWN' });
    const original = await pending;
    assert.equal(original.status, 200);
    assert.equal(original.body.result.executionCustodyReleased, false);
    assert.equal(original.body.result.nativeOutcome, 'UNKNOWN');
    assert.equal(active.record.toolCalls, 1, 'lifecycle observation did not replay the original action');
    assert.equal((await h.rpc('ping', {}, { sessionId: active.sessionId })).status, 200);
    assert.equal(replacement.record.closeCalls, 0);
    assert.equal(active.record.closeCalls, 0);
  }, { behavior: record => record.index === 0 ? {
    async call(_params, message) { entered.resolve(); return actionGate.promise; },
  } : {} });
});

test('authenticated DELETE disposes only its selected handler and preserves an original in-flight response', { timeout: 10000 }, async () => {
  let actionGate, entered;
  await withLifecycleServer(async h => {
    actionGate = h.gate(); entered = h.gate();
    const original = await h.open(), other = await h.open();
    const pending = h.rpc('tools/call', { name: 'fixture_native_operation' }, { sessionId: original.sessionId });
    await bounded(entered.promise, 'ORIGINAL_ACTION_DID_NOT_ENTER');
    assert.equal((await h.remove(original.sessionId, { authorization: null })).status, 401);
    assert.equal(original.record.closeCalls, 0);
    assert.equal((await h.remove('unknown-session')).status, 404);
    assert.equal((await h.remove(original.sessionId)).status, 204);
    assert.equal(original.record.closeCalls, 1);
    assert.equal(original.record.disposed, true);
    assert.equal(other.record.closeCalls, 0);
    assert.equal(original.record.actionSignals[0].aborted, false, 'DELETE is not cancellation of native custody');
    assert.equal((await h.remove(original.sessionId)).status, 404);
    assert.equal(original.record.closeCalls, 1);
    assert.equal((await h.rpc('ping', {}, { sessionId: other.sessionId })).status, 200);
    actionGate.resolve({ ok: false, executionCustodyReleased: false, nativeOutcome: 'UNKNOWN' });
    const response = await pending;
    assert.equal(response.status, 200);
    assert.equal(response.body.result.executionCustodyReleased, false);
    assert.equal(response.body.result.nativeOutcome, 'UNKNOWN');
    assert.equal(original.record.toolCalls, 1);
    assert.equal(other.record.toolCalls, 0);
    assert.equal((await h.rpc('tools/call', {}, { sessionId: original.sessionId })).status, 400);
    assert.equal(original.record.toolCalls, 1);
    assert.equal(h.created.sessionCount(), 1);
  }, { behavior: record => record.index === 0 ? {
    async call() { entered.resolve(); return actionGate.promise; },
  } : {} });
});

test('failed initialization disposes that handler, preserves its peer and returns the reserved capacity', { timeout: 10000 }, async () => {
  await withLifecycleServer(async h => {
    const peer = await h.open();
    const failed = await h.rpc('initialize');
    assert.equal(failed.status, 500);
    assert.equal(failed.body.error.message, 'FIXTURE_INITIALIZATION_REFUSED');
    assert.equal(h.records[1].closeCalls, 1);
    assert.equal(h.records[1].disposed, true);
    assert.equal(peer.record.closeCalls, 0);
    assert.equal(h.created.sessionCount(), 1);
    for (let index = 1; index < MAX_SESSIONS; index++) await h.open();
    assert.equal(h.created.sessionCount(), 16, 'failed init did not leak a pending-init reservation');
    assert.equal((await h.rpc('initialize')).status, 429);
    assert.equal((await h.rpc('ping', {}, { sessionId: peer.sessionId })).status, 200);
    assert.equal(h.records[1].initializeCalls, 1);
    assert.equal(h.records.reduce((total, record) => total + record.toolCalls, 0), 0);
    await h.stop();
    assert.equal(h.created.sessionCount(), 0);
    assert.ok(h.records.every(record => record.closeCalls === 1), 'failed handler is not closed twice at shutdown');
  }, { behavior: record => record.index === 1 ? {
    initialize() { throw new Error('FIXTURE_INITIALIZATION_REFUSED'); },
  } : {} });
});

test('disconnect during initialize cannot publish an abandoned session or leak its pending slot', { timeout: 10000 }, async () => {
  let initGate, entered, aborted, disposed;
  await withLifecycleServer(async h => {
    initGate = h.gate(); entered = h.gate(); aborted = h.gate(); disposed = h.gate();
    const controller = new AbortController();
    const pending = h.rpc('initialize', {}, { signal: controller.signal });
    const rejected = assert.rejects(pending, error => error.name === 'AbortError');
    await bounded(entered.promise, 'INITIALIZATION_DID_NOT_ENTER');
    controller.abort();
    await rejected;
    await bounded(aborted.promise, 'TRANSPORT_DID_NOT_OBSERVE_INITIALIZATION_DISCONNECT');
    initGate.resolve();
    await bounded(disposed.promise, 'ABANDONED_INITIALIZATION_WAS_NOT_DISPOSED');
    assert.equal(h.created.sessionCount(), 0);
    assert.equal(h.records[0].closeCalls, 1);
    const next = await h.open();
    assert.equal(h.created.sessionCount(), 1);
    assert.equal(next.record.closeCalls, 0);
    assert.equal(h.records.reduce((total, record) => total + record.toolCalls, 0), 0);
  }, { behavior: record => record.index === 0 ? {
    async initialize(_params, message) {
      message.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
      entered.resolve(); await initGate.promise;
    },
    close() { disposed.resolve(); },
  } : {} });
});

test('server shutdown disposes every remaining handler once and does not replay calls or re-close deleted sessions', { timeout: 10000 }, async () => {
  await withLifecycleServer(async h => {
    const deleted = await h.open(), remainingA = await h.open(), remainingB = await h.open();
    const response = await h.rpc('tools/call', { name: 'fixture_read_only' }, { sessionId: remainingA.sessionId });
    assert.equal(response.status, 200);
    assert.equal(response.body.result.executionCustodyReleased, false);
    assert.equal((await h.remove(deleted.sessionId)).status, 204);
    await h.stop();
    await bounded(Promise.all(h.records.map(record => record.disposal)), 'SHUTDOWN_DISPOSAL_DID_NOT_COMPLETE');
    assert.equal(h.created.server.listening, false);
    assert.equal(h.created.sessionCount(), 0);
    for (const session of [deleted, remainingA, remainingB]) {
      assert.equal(session.record.closeCalls, 1);
      assert.equal(session.record.disposed, true);
    }
    assert.equal(deleted.record.toolCalls, 0);
    assert.equal(remainingA.record.toolCalls, 1);
    assert.equal(remainingB.record.toolCalls, 0);
    assert.equal(h.created.continuousRepairStatus().enabled, false);
  });
});

test('real MCP custody remains held across HTTP DELETE and shutdown; session cleanup cannot authorize a replay', { timeout: 15000 }, async () => {
  // Separate module instance confines the intentionally unreleased inert fixture
  // to this test. No Windows process or native runtime is invoked.
  const { createSovereignCommanderMcpHandler } = await import(
    '../../scripts/sovereign-commander-mcp.mjs?session-lifecycle-held-custody-v1');
  let executions = 0;
  const factory = () => createSovereignCommanderMcpHandler({
    repoRoot: 'C:\\fixture-no-native-execution',
    executor: async () => {
      executions++;
      return Object.freeze({ ok: false, executionCustodyReleased: false,
        blocker: 'FIXTURE_ORIGINAL_NATIVE_OUTCOME_UNPROVEN' });
    },
  });
  const params = { name: 'maintenance_action', arguments: {
    actionId: 'repair-core-publication-directories', expectedMain: 'a'.repeat(40),
  } };
  await withLifecycleServer(async h => {
    const first = await h.open();
    const original = await h.rpc('tools/call', params, { sessionId: first.sessionId });
    assert.equal(original.body.result.structuredContent.executionCustodyReleased, false);
    assert.equal(executions, 1);
    assert.equal((await h.remove(first.sessionId)).status, 204);
    const successor = await h.open();
    const held = await h.rpc('tools/call', params, { sessionId: successor.sessionId });
    assert.equal(held.body.result.isError, true);
    assert.equal(held.body.result.structuredContent.blocker, 'CORE_DIRECTORY_ORIGINAL_REQUEST_REQUIRED_OR_BUSY');
    assert.equal(executions, 1);
    await h.stop();
    assert.ok(h.records.every(record => record.closeCalls === 1));
  }, { handlerFactory: factory });
  await withLifecycleServer(async h => {
    const successor = await h.open();
    const stillHeld = await h.rpc('tools/call', params, { sessionId: successor.sessionId });
    assert.equal(stillHeld.body.result.isError, true);
    assert.equal(stillHeld.body.result.structuredContent.blocker, 'CORE_DIRECTORY_ORIGINAL_REQUEST_REQUIRED_OR_BUSY');
    assert.equal(executions, 1, 'a new transport fixture still cannot replay the unproven original action');
  }, { handlerFactory: factory });
});
