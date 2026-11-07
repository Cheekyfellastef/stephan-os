import test from 'node:test';
import assert from 'node:assert/strict';
import { createSovereignCommanderHttpServer } from '../../scripts/sovereign-commander-http.mjs';
import { callSovereignMaintenanceOwnerV1,
  consumeSovereignMaintenancePreDispatchRefusalV1 } from './sovereignCommanderRemoteMailboxV1.mjs';
import { SOVEREIGN_MAINTENANCE_OWNER_VERSION } from './sovereignMaintenanceAdmissionV1.mjs';

const token = 'fixture-only-token-'.repeat(3);
const protocol = { ok: true, service: 'stephanos-sovereign-commander',
  maintenanceOwnerAdmissionVersion: SOVEREIGN_MAINTENANCE_OWNER_VERSION,
  observationScope: 'TRANSPORT_PROTOCOL_ONLY', maintenanceAdmissionProven: false };

async function serverFixture(run, { held = false } = {}) {
  let reads = 0, reserves = 0;
  const created = await createSovereignCommanderHttpServer({ token, port: 0,
    continuousRepairEnabled: false,
    custodyStore: {
      status() { reads++; return { held, blocker: held ? 'MAINTENANCE_CUSTODY_RESERVED' : '' }; },
      reserve() { reserves++; assert.fail('health observation reserved custody'); },
      release() { assert.fail('health observation released custody'); },
      close() {},
    },
  });
  await new Promise(resolve => created.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${created.server.address().port}`;
  try { await run({ base, reads: () => reads, reserves: () => reserves }); }
  finally { await new Promise(resolve => created.server.close(resolve)); }
}

test('protocol health does not invoke the synchronous native custody observation', async () => {
  await serverFixture(async ({ base, reads, reserves }) => {
    const before = reads();
    const response = await fetch(base + '/health?view=protocol');
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(reads(), before, 'transport preflight must not wait for native journal inspection');
    assert.deepEqual(body, protocol);
    assert.equal(reserves(), 0);
    assert.equal(JSON.stringify(body).includes(token), false);
  });
});

test('ordinary health still reports live held custody; protocol health makes no admission claim', async () => {
  await serverFixture(async ({ base, reads }) => {
    const before = reads();
    const full = await (await fetch(base + '/health')).json();
    assert.equal(reads(), before + 1);
    assert.equal(full.continuousRepairGuardian.persistentCustody.held, true);
    const small = await (await fetch(base + '/health?view=protocol')).json();
    assert.equal(small.maintenanceAdmissionProven, false);
    assert.equal('continuousRepairGuardian' in small, false);
  }, { held: true });
});

function delegationFixture(health = protocol, resultOverride) {
  const calls = []; let credentialReads = 0;
  const result = resultOverride ?? { ok: false, blocker: 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN',
    command: { plan: { processId: 'repair-goal-builder-flow' } }, finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED' };
  return { calls, credentials: () => credentialReads, result, options: {
    readFileFn: async () => { credentialReads++; return token; },
    fetchFn: async (url, options) => {
      calls.push({ url, method: options.method, message: options.body ? JSON.parse(options.body) : null });
      if (options.method === 'GET') {
        assert.equal(url, 'http://127.0.0.1:18791/health?view=protocol');
        assert.equal(credentialReads, 0);
        return new Response(JSON.stringify(health));
      }
      assert.equal(url, 'http://127.0.0.1:18791/mcp');
      assert.equal(options.headers.authorization, `Bearer ${token}`);
      if (options.method === 'DELETE') return new Response(null, { status: 204 });
      const message = JSON.parse(options.body);
      if (message.method === 'initialize') return new Response(JSON.stringify({ result: {} }), { headers: { 'mcp-session-id': 'same-session' } });
      assert.equal(options.headers['mcp-session-id'], 'same-session');
      if (message.method === 'notifications/initialized') return new Response(null, { status: 204 });
      if (message.method === 'tools/list') return new Response(JSON.stringify({ result: { tools: [{ name: 'maintenance_action' }] } }));
      assert.equal(message.method, 'tools/call');
      return new Response(JSON.stringify({ result: { structuredContent: result } }));
    },
  } };
}

test('delegation uses protocol-only preflight and preserves the same authenticated owner refusal', async () => {
  const fixture = delegationFixture();
  const actual = await callSovereignMaintenanceOwnerV1({ actionId: 'repair-goal-builder-flow' }, fixture.options);
  assert.deepEqual(actual, fixture.result);
  assert.equal(fixture.credentials(), 1);
  assert.equal(fixture.calls.filter(x => x.message?.method === 'tools/call').length, 1);
  assert.equal(fixture.calls.filter(x => x.method === 'DELETE').length, 1);
});

test('missing, wrong and admission-bearing protocol projections fail before credential reads', async () => {
  for (const health of [null, {}, { ...protocol, ok: false },
    { ...protocol, service: 'foreign' }, { ...protocol, maintenanceOwnerAdmissionVersion: 'old' },
    { ...protocol, observationScope: undefined }, { ...protocol, observationScope: 'CUSTODY' },
    { ...protocol, maintenanceAdmissionProven: true }, { ...protocol, maintenanceAdmissionProven: undefined }]) {
    const fixture = delegationFixture(health);
    const actual = await callSovereignMaintenanceOwnerV1({ actionId: 'repair-goal-builder-flow' }, fixture.options);
    assert.equal(actual.blocker, 'SOVEREIGN_MAINTENANCE_OWNER_PROTOCOL_REQUIRED');
    assert.equal(fixture.credentials(), 0);
    assert.equal(fixture.calls.length, 1);
  }
});

test('an unbound response is not retried or accepted after a possible dispatch', async () => {
  const fixture = delegationFixture(protocol, { ok: true });
  const actual = await callSovereignMaintenanceOwnerV1({ actionId: 'repair-goal-builder-flow' }, fixture.options);
  assert.equal(actual.blocker, 'SOVEREIGN_MAINTENANCE_OWNER_RECEIPT_INVALID');
  assert.equal(fixture.calls.filter(x => x.message?.method === 'tools/call').length, 1);
});

const frozenRequest = actionId => Object.freeze({ actionId,
  arguments: Object.freeze({ actionId }), timeoutMs: 160000 });

test('only the actual parsed protocol refusal has one-use exact-request provenance without owner claims', async () => {
  const request = frozenRequest('repair-goal-builder-flow');
  for (const health of [null, {}, { ...protocol, maintenanceOwnerAdmissionVersion: 'old' },
    { ...protocol, observationScope: undefined }, { ...protocol, maintenanceAdmissionProven: true }]) {
    const fixture = delegationFixture(health);
    const actual = await callSovereignMaintenanceOwnerV1(request, fixture.options);
    assert.equal(fixture.credentials(), 0); assert.equal(fixture.calls.length, 1);
    assert.equal(Object.isFrozen(actual), true);
    for (const field of ['command', 'finalVerdict', 'proofHash', 'ownerAuthenticated', 'executionCustodyReleased'])
      assert.equal(Object.hasOwn(actual, field), false, 'local transport fact must not impersonate owner evidence');
    assert.equal(consumeSovereignMaintenancePreDispatchRefusalV1({ ...actual }, request), false);
    assert.equal(consumeSovereignMaintenancePreDispatchRefusalV1(JSON.parse(JSON.stringify(actual)), request), false);
    assert.equal(consumeSovereignMaintenancePreDispatchRefusalV1(actual, request), true);
    assert.equal(consumeSovereignMaintenancePreDispatchRefusalV1(actual, request), false);
  }
});

test('pre-dispatch proof is bound to the exact immutable request and action, not an equivalent object', async () => {
  for (const other of [frozenRequest('repair-goal-builder-flow'), frozenRequest('repair-stephanos')]) {
    const request = frozenRequest('repair-goal-builder-flow'), fixture = delegationFixture({});
    const actual = await callSovereignMaintenanceOwnerV1(request, fixture.options);
    assert.equal(consumeSovereignMaintenancePreDispatchRefusalV1(actual, other), false);
    assert.equal(consumeSovereignMaintenancePreDispatchRefusalV1(actual, request), false,
      'a mismatched consumption cannot leave reusable provenance');
  }
  for (const request of [{ actionId: 'repair-goal-builder-flow', arguments: { actionId: 'repair-goal-builder-flow' } },
    Object.freeze({ actionId: 'repair-goal-builder-flow', arguments: { actionId: 'repair-goal-builder-flow' } }),
    frozenRequest('unknown-action')]) {
    const fixture = delegationFixture({});
    const actual = await callSovereignMaintenanceOwnerV1(request, fixture.options);
    assert.equal(consumeSovereignMaintenancePreDispatchRefusalV1(actual, request), false);
  }
  let accessed = false;
  const forged = Object.defineProperty({}, 'blocker', { get() { accessed = true; throw Error('untrusted getter'); } });
  assert.equal(consumeSovereignMaintenancePreDispatchRefusalV1(forged, frozenRequest('repair-goal-builder-flow')), false);
  assert.equal(accessed, false);
});

test('health transport and parsing failures retain uncertainty rather than creating a local refusal proof', async () => {
  for (const mode of ['network-error', 'malformed-json', 'timeout']) {
    const request = frozenRequest('repair-goal-builder-flow'); let reads = 0, calls = 0;
    const actual = await callSovereignMaintenanceOwnerV1(request, {
      readFileFn: async () => { reads++; assert.fail('unexpected token read'); },
      fetchFn: async (_url, options) => {
        calls++; assert.equal(options.method, 'GET');
        if (mode === 'network-error') throw Error('connection lost');
        if (mode === 'malformed-json') return new Response('not JSON');
        return new Promise(() => {});
      },
    });
    assert.equal(actual.blocker, 'SOVEREIGN_MAINTENANCE_OWNER_UNAVAILABLE', mode);
    assert.equal(reads, 0); assert.equal(calls, 1);
    assert.equal(consumeSovereignMaintenancePreDispatchRefusalV1(actual, request), false, mode);
  }
});

test('initialization and post-call uncertainty never acquire health pre-dispatch provenance', async () => {
  for (const mode of ['initialize-refused', 'initialize-lost', 'call-lost', 'unbound-call-result']) {
    const request = frozenRequest('repair-goal-builder-flow'), fixture = delegationFixture();
    const original = fixture.options.fetchFn; let toolCalls = 0;
    fixture.options.fetchFn = async (url, options) => {
      const message = options.body ? JSON.parse(options.body) : null;
      if (message?.method === 'initialize' && mode === 'initialize-refused')
        return Response.json({ error: { message: 'refused' } }, { status: 403 });
      if (message?.method === 'initialize' && mode === 'initialize-lost') throw Error('lost initialization');
      if (message?.method === 'tools/call') {
        toolCalls++;
        if (mode === 'call-lost') throw Error('lost after potential owner pickup');
        if (mode === 'unbound-call-result') return Response.json({ result: { structuredContent: {
          ok: false, blocker: 'SOVEREIGN_MAINTENANCE_OWNER_PROTOCOL_REQUIRED', beforeDispatchProven: true,
        } } });
      }
      return original(url, options);
    };
    const actual = await callSovereignMaintenanceOwnerV1(request, fixture.options);
    assert.equal(consumeSovereignMaintenancePreDispatchRefusalV1(actual, request), false, mode);
    assert.equal(fixture.credentials(), 1);
    assert.equal(toolCalls, mode.startsWith('initialize-') ? 0 : 1);
  }
});
