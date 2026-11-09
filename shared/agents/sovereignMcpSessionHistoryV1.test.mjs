import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSovereignMcpSessionHistoryV1,
  SOVEREIGN_MCP_SESSION_HISTORY_TOOLS_V1,
  SOVEREIGN_MCP_SESSION_HISTORY_LIMITS_V1,
} from './sovereignMcpSessionHistoryV1.mjs';

function fixture(limits = {}) {
  let current = 1_700_000_000_000;
  const history = createSovereignMcpSessionHistoryV1({ nowMs: () => current, limits });
  return { history, advance: delta => { current += delta; }, setNow: value => { current = value; } };
}
function start(history, callId, extra = {}) {
  return history.begin({ callId, tool: 'read_file', transportKind: 'local-stdio-mcp',
    privateResultAllowed: true, ...extra });
}
function complete(history, callId, value = { ok: true, value: 'returned value' }, extra = {}) {
  assert.equal(start(history, callId, extra).recorded, true);
  assert.equal(history.finish(callId, value).recorded, true);
}
const usage = history => history.execute('get_usage_stats', {});
const recent = (history, args = {}) => history.execute('get_recent_tool_calls', args);
const stored = (history, callId) => history.execute('get_tool_result', { callId });

test('default scope is ephemeral own-handler advice, with no vendor, billing or execution truth', () => {
  const { history } = fixture();
  const response = usage(history);
  assert.equal(response.ok, true);
  assert.equal(response.scope, 'THIS_SOVEREIGN_MCP_HANDLER_SESSION');
  assert.equal(response.advisoryOnly, true);
  assert.equal(response.durable, false);
  assert.equal(response.executionAuthority, false);
  assert.equal(response.nativeOutcome, 'UNKNOWN');
  assert.equal(response.vendorHistoryIncluded, false);
  assert.equal(response.vendorMeterUsage, 'NOT_OBSERVED');
  assert.equal(response.billingUsage, 'NOT_OBSERVED');
  assert.equal(response.counters.observedToolCalls, 0);
  assert.equal(response.retainedEntries, 0);
  assert.deepEqual(response.limits, SOVEREIGN_MCP_SESSION_HISTORY_LIMITS_V1);
});

test('concurrent responses retain their own immutable call identities and start ordering', () => {
  const { history, advance } = fixture();
  start(history, 'call-a');
  advance(5); start(history, 'call-b');
  const pending = stored(history, 'call-a');
  assert.equal(pending.call.responseState, 'PENDING');
  assert.equal(pending.call.nativeOutcome, 'UNKNOWN');
  assert.equal(pending.resultAvailable, false);
  advance(10); history.finish('call-b', { ok: true, value: 'B' });
  advance(7); history.finish('call-a', { ok: true, value: 'A' });
  const list = recent(history);
  assert.deepEqual(list.calls.map(call => call.callId), ['call-b', 'call-a']);
  assert.equal(stored(history, 'call-a').result.value, 'A');
  assert.equal(stored(history, 'call-b').result.value, 'B');
  assert.equal(stored(history, 'call-a').call.durationMs, 22);
  assert.equal(stored(history, 'call-b').call.durationMs, 10);
  assert.equal(usage(history).counters.returnedResponses, 2);
  assert.equal(usage(history).retainedPendingResponses, 0);
});

test('listing and usage never disclose successful private result paths, contents or arguments', () => {
  const { history } = fixture();
  const privatePath = 'C:\\Private-Operator\\unique-sensitive-document.txt';
  const privateContent = 'private-content-must-not-enter-listing';
  complete(history, 'call-private', { ok: true, path: privatePath, content: privateContent });
  for (const response of [recent(history), usage(history), history.execute('list_remote_tool_calls', {})]) {
    const wire = JSON.stringify(response);
    assert.ok(!wire.includes(privatePath));
    assert.ok(!wire.includes(privateContent));
    assert.ok(!wire.includes('"arguments"'));
    assert.ok(!wire.includes('"content"'));
  }
  const full = stored(history, 'call-private');
  assert.equal(full.result.path, privatePath);
  assert.equal(full.result.content, privateContent);
  assert.equal(full.independentlyVerified, false);
  assert.equal(full.resultProvenance, 'COPY_OF_THIS_SESSION_RETURNED_VALUE');
});

test('full result is opt-in from a recognized trusted private transport, never a tool argument', () => {
  const { history } = fixture();
  start(history, 'metadata-only', { privateResultAllowed: false });
  history.finish('metadata-only', { ok: true, content: 'not retained' });
  assert.equal(stored(history, 'metadata-only').resultAvailable, false);
  start(history, 'unknown-transport', { transportKind: 'external-or-caller-selected' });
  history.finish('unknown-transport', { ok: true, content: 'not retained' });
  assert.equal(stored(history, 'unknown-transport').resultAvailable, false);
  const refused = history.execute('get_tool_result', { callId: 'metadata-only', privateResultAllowed: true });
  assert.equal(refused.blocker, 'SOVEREIGN_HISTORY_ARGUMENTS_INVALID');
  assert.equal(usage(history).retainedResults, 0);
});

test('independent handler instances cannot retrieve or discover each other’s calls', () => {
  const a = fixture().history, b = fixture().history;
  complete(a, 'opaque-a-only', { ok: true, value: 'A private result' });
  assert.equal(stored(b, 'opaque-a-only').blocker, 'SOVEREIGN_HISTORY_CALL_NOT_FOUND_OR_EXPIRED');
  assert.equal(recent(b).retainedMatchingCalls, 0);
  assert.equal(usage(b).counters.observedToolCalls, 0);
  complete(b, 'opaque-b-only', { ok: true, value: 'B private result' });
  assert.equal(stored(a, 'opaque-b-only').blocker, 'SOVEREIGN_HISTORY_CALL_NOT_FOUND_OR_EXPIRED');
});

test('retained results and returned snapshots cannot be rewritten through mutable aliases', () => {
  const { history } = fixture();
  const value = { ok: true, data: { values: [1, 2], proof: { kind: 'advisory' } } };
  complete(history, 'snapshot-call', value);
  value.data.values.push(3); value.data.proof.kind = 'forged';
  const first = stored(history, 'snapshot-call');
  assert.deepEqual(first.result, { ok: true, data: { values: [1, 2], proof: { kind: 'advisory' } } });
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.result.data.values));
  assert.throws(() => { first.result.data.values[0] = 900; }, TypeError);
  const second = stored(history, 'snapshot-call');
  assert.notEqual(first.result, second.result);
  assert.equal(second.result.data.values[0], 1);
});

test('error and thrown responses record transport outcome without raw errors or native completion', () => {
  const { history } = fixture();
  const secret = 'throw-secret C:\\private-path\\credentials.txt';
  start(history, 'failed-return');
  history.finish('failed-return', { ok: false, error: secret, blocker: secret,
    executionCustodyReleased: false, state: 'CANCELLED' });
  start(history, 'thrown-call');
  history.finish('thrown-call', new Error(secret), { threw: true });
  assert.equal(stored(history, 'failed-return').call.responseState, 'RETURNED');
  assert.equal(stored(history, 'failed-return').call.responseOk, false);
  assert.equal(stored(history, 'thrown-call').call.responseState, 'THREW');
  for (const id of ['failed-return', 'thrown-call']) {
    const response = stored(history, id);
    assert.equal(response.resultAvailable, false);
    assert.equal(response.call.nativeOutcome, 'UNKNOWN');
    assert.equal(response.call.executionAuthority, false);
    assert.ok(!JSON.stringify(response).includes(secret));
    assert.ok(!JSON.stringify(response).includes('COMPLETED'));
  }
  const count = usage(history).counters;
  assert.equal(count.unsuccessfulResponses, 1);
  assert.equal(count.thrownResponses, 1);
});

test('contradictory or missing success evidence cannot retain an apparent successful result', () => {
  const { history } = fixture();
  complete(history, 'contradiction', { ok: true, isError: true, value: 'never retained' });
  complete(history, 'missing-ok', { status: 'DONE', value: 'never retained' });
  for (const id of ['contradiction', 'missing-ok']) {
    assert.equal(stored(history, id).call.responseOk, null);
    assert.equal(stored(history, id).resultAvailable, false);
    assert.equal(stored(history, id).call.nativeOutcome, 'UNKNOWN');
  }
});

test('sensitive keys and credential-shaped values cannot enter even the private result cache', () => {
  const { history } = fixture();
  const values = [
    { ok: true, authorization: 'secret' }, { ok: true, api_key: 'secret' },
    { ok: true, nested: { refreshToken: 'secret' } },
    { ok: true, content: 'Bearer abcdefghijklmnopqrstuvwxyz' },
    { ok: true, content: 'ghp_abcdefghijklmnopqrstuvwxyz123' },
    { ok: true, content: '-----BEGIN PRIVATE KEY-----' },
    { ok: true, error: 'raw internal failure' }, { ok: true, stack: 'private stack' },
  ];
  values.forEach((value, index) => {
    const id = 'sensitive-' + index;
    complete(history, id, value);
    assert.equal(stored(history, id).resultAvailable, false);
    assert.match(stored(history, id).call.retentionReason, /^RESULT_SENSITIVE_/);
  });
  assert.equal(usage(history).retainedResults, 0);
});

test('accessors, functions, symbols, cycles and non-JSON object types are not evaluated or retained', () => {
  const { history } = fixture();
  let getterReads = 0;
  const accessor = { ok: true };
  Object.defineProperty(accessor, 'content', { enumerable: true, get() { getterReads++; return 'secret'; } });
  const cycle = { ok: true }; cycle.self = cycle;
  const inherited = Object.assign(Object.create({ private: 'secret' }), { ok: true });
  const symbolic = { ok: true, [Symbol('hidden')]: 'secret' };
  const arrayExtra = []; arrayExtra.extra = 'secret';
  const sparse = new Array(3);
  const values = [accessor, cycle, inherited, symbolic, { ok: true, toJSON() { throw new Error('must not execute'); } },
    { ok: true, nested: new Date() }, { ok: true, bytes: Buffer.from('secret') },
    { ok: true, value: 1n }, { ok: true, value: NaN }, { ok: true, value: arrayExtra },
    { ok: true, value: sparse }];
  values.forEach((value, index) => {
    complete(history, 'unsafe-' + index, value);
    assert.equal(stored(history, 'unsafe-' + index).resultAvailable, false);
  });
  assert.equal(getterReads, 0);
});

test('hostile success getter and proxy traps cannot break or leak an executor response', () => {
  const { history } = fixture();
  let getterReads = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'ok', { get() { getterReads++; throw new Error('secret'); } });
  complete(history, 'ok-accessor', accessor);
  assert.equal(getterReads, 0);
  assert.equal(stored(history, 'ok-accessor').call.responseOk, null);
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('private proxy failure'); } });
  complete(history, 'proxy-value', proxy);
  assert.equal(stored(history, 'proxy-value').resultAvailable, false);
});

test('per-result byte and structural limits retain only a bounded refusal', () => {
  const { history } = fixture({ maxResultBytes: 1024 });
  complete(history, 'oversize', { ok: true, content: 'x'.repeat(2048) });
  assert.equal(stored(history, 'oversize').call.retentionReason, 'RESULT_BYTE_LIMIT');
  complete(history, 'deep', { ok: true, value: Array.from({ length: 5000 }, () => 0) });
  assert.equal(stored(history, 'deep').call.retentionReason, 'RESULT_STRUCTURE_LIMIT');
  assert.equal(usage(history).retainedResults, 0);
});

test('entry capacity evicts old returned records without changing underlying native outcomes', () => {
  const { history } = fixture({ maxEntries: 3, maxPending: 2 });
  for (let index = 0; index < 100; index++) complete(history, 'bounded-' + index);
  const stats = usage(history);
  assert.equal(stats.retainedEntries, 3);
  assert.equal(stats.counters.observedToolCalls, 100);
  assert.equal(stats.counters.returnedResponses, 100);
  assert.equal(stats.counters.capacityEvictions, 97);
  assert.equal(stored(history, 'bounded-0').blocker, 'SOVEREIGN_HISTORY_CALL_NOT_FOUND_OR_EXPIRED');
  assert.deepEqual(recent(history).calls.map(row => row.callId), ['bounded-99', 'bounded-98', 'bounded-97']);
});

test('total byte capacity covers metadata plus JSON and stays bounded during repeated large responses', () => {
  const { history } = fixture({ maxEntries: 10, maxPending: 4, maxTotalBytes: 2400, maxResultBytes: 1600 });
  for (let index = 0; index < 50; index++) {
    complete(history, 'byte-bound-' + index, { ok: true, content: 'x'.repeat(1100) });
    assert.ok(usage(history).retainedSerializedBytes <= 2400);
    assert.ok(usage(history).retainedEntries <= 10);
  }
  assert.ok(usage(history).counters.capacityEvictions > 0);
});

test('pending response capacity drops observation, never executes or cancels work', () => {
  const { history } = fixture({ maxEntries: 3, maxPending: 2 });
  assert.equal(start(history, 'pending-a').recorded, true);
  assert.equal(start(history, 'pending-b').recorded, true);
  const refused = start(history, 'pending-c');
  assert.equal(refused.recorded, false);
  assert.equal(refused.reason, 'HISTORY_CAPACITY');
  assert.equal(usage(history).retainedPendingResponses, 2);
  assert.equal(usage(history).counters.unrecordedToolCalls, 1);
  history.finish('pending-a', { ok: true });
  assert.equal(start(history, 'pending-d').recorded, true);
  assert.equal(stored(history, 'pending-b').call.nativeOutcome, 'UNKNOWN');
});

test('age expiry includes pending records, late completion cannot resurrect an expired record', () => {
  const { history, advance } = fixture({ maxAgeMs: 100 });
  start(history, 'expired-pending');
  complete(history, 'expired-returned');
  advance(100);
  assert.equal(stored(history, 'expired-pending').blocker, 'SOVEREIGN_HISTORY_CALL_NOT_FOUND_OR_EXPIRED');
  assert.equal(history.finish('expired-pending', { ok: true, value: 'late' }).recorded, false);
  const stats = usage(history);
  assert.equal(stats.retainedEntries, 0);
  assert.equal(stats.retainedSerializedBytes, 0);
  assert.equal(stats.counters.expiredRecords, 2);
  assert.equal(stats.counters.expiredPendingResponses, 1);
  assert.equal(stats.nativeOutcome, 'UNKNOWN');
});

test('history reads do not extend retention and backwards wall time cannot revive records', () => {
  const { history, advance, setNow } = fixture({ maxAgeMs: 100 });
  complete(history, 'clock-bound');
  advance(50); assert.equal(stored(history, 'clock-bound').ok, true);
  setNow(1_699_999_000_000); assert.equal(stored(history, 'clock-bound').ok, true);
  setNow(1_700_000_000_100);
  assert.equal(stored(history, 'clock-bound').blocker, 'SOVEREIGN_HISTORY_CALL_NOT_FOUND_OR_EXPIRED');
  setNow(1_699_999_000_000);
  assert.equal(stored(history, 'clock-bound').blocker, 'SOVEREIGN_HISTORY_CALL_NOT_FOUND_OR_EXPIRED');
});

test('duplicate IDs and duplicate finish cannot rewrite original retained evidence', () => {
  const { history } = fixture();
  start(history, 'original-id');
  assert.equal(start(history, 'original-id').reason, 'DUPLICATE_CALL_ID');
  history.finish('original-id', { ok: true, value: 'original' });
  assert.equal(history.finish('original-id', { ok: true, value: 'forged' }).reason, 'RESPONSE_ALREADY_RECORDED');
  assert.equal(stored(history, 'original-id').result.value, 'original');
  assert.equal(usage(history).counters.observedToolCalls, 1);
  assert.equal(usage(history).counters.returnedResponses, 1);
});

test('all four history queries are excluded from their own counts and receipt ring', () => {
  const { history } = fixture();
  for (const tool of SOVEREIGN_MCP_SESSION_HISTORY_TOOLS_V1) {
    assert.equal(start(history, 'query-' + tool, { tool }).reason, 'HISTORY_QUERY_EXCLUDED');
    history.execute(tool, tool === 'get_tool_result' ? { callId: 'not-retained' } : {});
  }
  assert.equal(usage(history).counters.observedToolCalls, 0);
  assert.equal(recent(history).retainedMatchingCalls, 0);
});

test('remote listing truth is this session’s authenticated HTTP transport, not vendor or global history', () => {
  const { history } = fixture();
  complete(history, 'local-call');
  complete(history, 'http-call', { ok: true }, { transportKind: 'authenticated-http-jsonrpc' });
  complete(history, 'unknown-call', { ok: true }, { transportKind: 'unknown-carrier' });
  const remote = history.execute('list_remote_tool_calls', {});
  assert.equal(remote.ok, true);
  assert.deepEqual(remote.calls.map(row => row.callId), ['http-call']);
  assert.equal(remote.remoteDefinition, 'THIS_SESSION_AUTHENTICATED_HTTP_JSONRPC_CALLS');
  assert.equal(remote.vendorHistoryIncluded, false);
});

test('bounded pagination is validated and returns no caller-selected session or arbitrary filters', () => {
  const { history } = fixture();
  for (let index = 0; index < 5; index++) complete(history, 'page-' + index);
  const page = recent(history, { offset: 1, limit: 2 });
  assert.deepEqual(page.calls.map(row => row.callId), ['page-3', 'page-2']);
  assert.equal(page.nextOffset, 3);
  assert.equal(recent(history, { offset: 4, limit: 2 }).nextOffset, null);
  for (const args of [{ offset: -1 }, { offset: 1.5 }, { offset: 257 }, { limit: 0 },
    { limit: 51 }, { limit: '2' }, { sessionId: 'other' }, { path: '/private' }, [], null]) {
    assert.equal(recent(history, args).blocker, 'SOVEREIGN_HISTORY_ARGUMENTS_INVALID');
  }
});

test('tool arguments and metadata reject accessors, inherited values and extra keys without evaluating them', () => {
  const { history } = fixture();
  let reads = 0;
  const args = {};
  Object.defineProperty(args, 'limit', { get() { reads++; return 2; } });
  assert.equal(recent(history, args).ok, false);
  assert.equal(recent(history, Object.create({ offset: 0 })).ok, false);
  assert.equal(recent(history, { [Symbol('hidden')]: true }).ok, false);
  assert.equal(history.begin({ callId: 'args-refused', tool: 'read_file', arguments: { token: 'secret' } }).recorded, false);
  assert.equal(history.execute('get_usage_stats', { reset: true }).ok, false);
  assert.equal(reads, 0);
  assert.equal(usage(history).retainedEntries, 0);
});

test('unknown tool and transport labels are fixed projections rather than caller-controlled text', () => {
  const { history } = fixture();
  const secret = 'caller-secret-and-path';
  start(history, 'unknown-tool', { tool: secret, transportKind: secret });
  history.finish('unknown-tool', { ok: false, error: secret });
  const wire = JSON.stringify(recent(history));
  assert.ok(!wire.includes(secret));
  assert.equal(recent(history).calls[0].tool, 'unknown_tool');
  assert.equal(recent(history).calls[0].transportKind, 'unknown');
});

test('opaque call ID and fixed query names reject malformed or overlong selectors', () => {
  const { history } = fixture();
  for (const callId of ['', '../other-session', 'a'.repeat(161), 1, null]) {
    assert.equal(stored(history, callId).blocker, 'SOVEREIGN_HISTORY_ARGUMENTS_INVALID');
    assert.equal(start(history, callId).recorded, false);
  }
  assert.equal(history.execute('read_file', {}).blocker, 'SOVEREIGN_HISTORY_TOOL_UNKNOWN');
});

test('constructor limits cannot silently widen hard bounds or accept mutable authority input', () => {
  for (const limits of [{ maxEntries: 257 }, { maxTotalBytes: 2 * 1024 * 1024 + 1 },
    { maxResultBytes: 128 * 1024 + 1 }, { maxAgeMs: 60 * 60 * 1000 + 1 },
    { maxPending: 65 }, { maxAgeMs: Infinity }, { maxEntries: 1.5 },
    { maxEntries: 0 }, { arbitrary: true }, { maxEntries: 2, maxPending: 3 }]) {
    assert.throws(() => createSovereignMcpSessionHistoryV1({ limits }), /SOVEREIGN_HISTORY_LIMITS_INVALID/);
  }
  assert.throws(() => createSovereignMcpSessionHistoryV1({ nowMs: 1 }), /SOVEREIGN_HISTORY_CLOCK_INVALID/);
});

test('clock failures are typed observation failures and never expose exception content', () => {
  const history = createSovereignMcpSessionHistoryV1({ nowMs() { throw new Error('private-clock-error'); } });
  assert.equal(start(history, 'clock-failed').reason, 'CLOCK_UNPROVEN');
  const response = usage(history);
  assert.equal(response.blocker, 'SOVEREIGN_HISTORY_CLOCK_UNPROVEN');
  assert.ok(!JSON.stringify(response).includes('private-clock-error'));
});

test('dispose clears session history and cannot release custody or turn pending work into completion', () => {
  const { history } = fixture();
  complete(history, 'done-record');
  start(history, 'pending-record');
  const disposed = history.dispose();
  assert.equal(disposed.executionAuthority, false);
  assert.equal(disposed.nativeOutcome, 'UNKNOWN');
  assert.equal(history.execute('get_tool_result', { callId: 'done-record' }).blocker, 'SOVEREIGN_HISTORY_SESSION_CLOSED');
  assert.equal(start(history, 'after-close').reason, 'SESSION_CLOSED');
  assert.equal(history.finish('pending-record', { ok: true }).reason, 'SESSION_CLOSED');
  assert.equal(fixture().history.execute('get_recent_tool_calls', {}).retainedMatchingCalls, 0);
});


test('credential-shaped JSON keys cannot leak through successful private response snapshots', () => {
  const { history } = fixture();
  const syntheticNames = [
    'Bearer abcdefghijklmnopqrstuvwxyz',
    'ghp_abcdefghijklmnopqrstuvwxyz12345',
    '-----BEGIN PRIVATE KEY-----',
    'AKIAABCDEFGHIJKLMNOP',
  ];
  syntheticNames.forEach((secretKey, index) => {
    const callId = 'synthetic-secret-name-' + index;
    complete(history, callId, { ok: true, nested: { [secretKey]: 'ordinary value' } });
    const response = stored(history, callId);
    assert.equal(response.resultAvailable, false);
    assert.equal(response.call.retentionReason, 'RESULT_SENSITIVE_KEY');
    assert.equal(JSON.stringify(response).includes(secretKey), false);
  });
  complete(history, 'ordinary-name-still-retained', { ok: true, nested: { ordinaryKey: 'safe' } });
  assert.equal(stored(history, 'ordinary-name-still-retained').resultAvailable, true);
  assert.equal(usage(history).retainedResults, 1);
});
