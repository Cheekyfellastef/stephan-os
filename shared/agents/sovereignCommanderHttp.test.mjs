import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSovereignCommanderHttpServer,
} from '../../scripts/sovereign-commander-http.mjs';

const TOKEN = 't'.repeat(48);

async function withServer(action, overrides = {}) {
  const observed = [];
  const created = await createSovereignCommanderHttpServer({
    token: TOKEN,
    host: '127.0.0.1',
    port: 0,
    handlerFactory: overrides.handlerFactory || (() => {
      let ready = false;
      return async (method, params, message) => {
        observed.push({ method, params, message });
        if (method === 'initialize') return {
          protocolVersion: params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'test-sovereign', version: '1.0.0' },
        };
        if (method === 'notifications/initialized') { ready = true; return undefined; }
        if (!ready) throw new Error('MCP_SESSION_NOT_READY');
        if (method === 'tools/list') return { tools: [{ name: 'get_config' }] };
        return {};
      };
    }),
    now: overrides.now || (() => '2026-09-29T21:00:00.000Z'),
    nowMs: overrides.nowMs,
  });
  await new Promise((resolve, reject) => {
    created.server.once('error', reject);
    created.server.listen(0, created.host, resolve);
  });
  const address = created.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try { return await action({ base, created, observed }); }
  finally { await new Promise((resolve) => created.server.close(resolve)); }
}

test('HTTP transport is bearer authenticated and health exposes no secret', async () => withServer(async ({ base }) => {
  const health = await fetch(base + '/health');
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.vendorMeterRequired, false);
  assert.equal(JSON.stringify(healthBody).includes(TOKEN), false);

  const denied = await fetch(base + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
  });
  assert.equal(denied.status, 401);
}));

test('HTTP transport carries one correlated MCP session after authenticated initialize', async () => withServer(async ({ base, created }) => {
  const headers = {
    authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json',
  };
  const init = await fetch(base + '/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test-client', version: '1' } },
    }),
  });
  assert.equal(init.status, 200);
  const sessionId = init.headers.get('mcp-session-id');
  assert.ok(sessionId);
  assert.equal(created.sessionCount(), 1);

  const initialized = await fetch(base + '/mcp', {
    method: 'POST',
    headers: { ...headers, 'mcp-session-id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
  });
  assert.equal(initialized.status, 202);

  const listed = await fetch(base + '/mcp', {
    method: 'POST',
    headers: { ...headers, 'mcp-session-id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  assert.equal(listed.status, 200);
  const body = await listed.json();
  assert.deepEqual(body.result.tools, [{ name: 'get_config' }]);

  const closed = await fetch(base + '/mcp', {
    method: 'DELETE',
    headers: { authorization: `Bearer ${TOKEN}`, 'mcp-session-id': sessionId },
  });
  assert.equal(closed.status, 204);
  assert.equal(created.sessionCount(), 0);
}));

test('HTTP transport refuses non-loopback bind unless explicitly approved', async () => {
  await assert.rejects(
    createSovereignCommanderHttpServer({ token: TOKEN, host: '0.0.0.0', port: 18791 }),
    /NON_LOOPBACK_BIND_REQUIRES_EXPLICIT_APPROVAL/,
  );
});


test('failed initialize does not retain a leaked session', async () => {
  const created = await createSovereignCommanderHttpServer({
    token: TOKEN,
    host: '127.0.0.1',
    port: 0,
    handlerFactory: () => async (method) => {
      if (method === 'initialize') throw new Error('MCP_PROTOCOL_NOT_SUPPORTED');
      return {};
    },
  });
  await new Promise((resolve, reject) => {
    created.server.once('error', reject);
    created.server.listen(0, created.host, resolve);
  });
  const address = created.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(base + '/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'bad' } }),
    });
    assert.equal(response.status, 500);
    assert.equal(created.sessionCount(), 0);
  } finally {
    await new Promise((resolve) => created.server.close(resolve));
  }
});


test('tailnet ignition page exposes only fixed ignition and consumes a single-use nonce', async () => {
  let maintenanceCalls = 0;
  const handlerFactory = () => {
    let ready = false;
    return async (method, params) => {
      if (method === 'initialize') return { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'test', version: '1' } };
      if (method === 'notifications/initialized') { ready = true; return undefined; }
      if (!ready) throw new Error('MCP_SESSION_NOT_READY');
      if (method === 'tools/list') return { tools: [{ name: 'maintenance_action' }] };
      if (method === 'tools/call') {
        maintenanceCalls += 1;
        assert.equal(params.name, 'maintenance_action');
        assert.deepEqual(params.arguments, { actionId: 'ignite-stephanos' });
        return {
          structuredContent: {
            ok: true,
            finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
            structuredContent: {
              ok: true,
              finalVerdict: 'BATTLE_BRIDGE_IGNITION_GREEN',
            },
          },
          isError: false,
        };
      }
      return {};
    };
  };

  await withServer(async ({ base, created }) => {
    const page = await fetch(base + '/ignite');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const html = await page.text();
    assert.match(html, /Ignite Stephanos/);
    const match = html.match(/const nonce=("[^"]+");/);
    assert.ok(match);
    const nonce = JSON.parse(match[1]);
    assert.equal(created.ignitionNonceCount(), 1);

    const ignition = await fetch(base + '/ignite', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-stephanos-ignition-nonce': nonce,
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ action: 'ignite-stephanos' }),
    });
    assert.equal(ignition.status, 200);
    const body = await ignition.json();
    assert.equal(body.ok, true);
    assert.equal(body.action, 'ignite-stephanos');
    assert.equal(body.finalVerdict, 'BATTLE_BRIDGE_IGNITION_GREEN');
    assert.equal(body.arbitraryShellAllowed, false);
    assert.equal(body.pcRestartAllowed, false);
    assert.equal(maintenanceCalls, 1);
    assert.equal(created.ignitionNonceCount(), 0);

    const replay = await fetch(base + '/ignite', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-stephanos-ignition-nonce': nonce },
      body: JSON.stringify({ action: 'ignite-stephanos' }),
    });
    assert.equal(replay.status, 403);
    assert.equal(maintenanceCalls, 1);
  }, { handlerFactory, nowMs: () => Date.parse('2026-09-29T21:00:00.000Z') });
});

test('tailnet ignition blocks cross-site and caller-selected actions', async () => withServer(async ({ base }) => {
  const crossSite = await fetch(base + '/ignite', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(crossSite.status, 403);

  const page = await fetch(base + '/ignite');
  const html = await page.text();
  const match = html.match(/const nonce=("[^"]+");/);
  assert.ok(match);
  const nonce = JSON.parse(match[1]);
  const widened = await fetch(base + '/ignite', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-stephanos-ignition-nonce': nonce },
    body: JSON.stringify({ action: 'run-any-shell' }),
  });
  assert.equal(widened.status, 400);
  const body = await widened.json();
  assert.equal(body.blocker, 'REMOTE_IGNITION_ACTION_NOT_ALLOWED');
}));
