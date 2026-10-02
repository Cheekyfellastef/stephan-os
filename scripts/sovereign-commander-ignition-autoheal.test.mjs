import test from 'node:test';
import assert from 'node:assert/strict';

import { runSovereignCommanderIgnitionAutoheal } from './sovereign-commander-ignition-autoheal.mjs';

function response({ ok = true, status = 200, body = null, sessionId = '' } = {}) {
  return {
    ok,
    status,
    headers: { get: (name) => name.toLowerCase() === 'mcp-session-id' ? sessionId : null },
    async json() { return body; },
    async text() { return body === null ? '' : JSON.stringify(body); },
  };
}

function greenFetch() {
  let post = 0;
  return async (_url, options = {}) => {
    if ((options.method || 'GET') === 'GET') {
      return response({ body: { ok: true, service: 'stephanos-sovereign-commander', capabilityVersion: '2026-10-02-project-search-v1' } });
    }
    post += 1;
    if (post === 1) return response({ sessionId: 'session-1', body: { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' } } });
    if (post === 2) return response({ status: 202, sessionId: 'session-1', body: null });
    if (post === 3) return response({
      sessionId: 'session-1',
      body: {
        jsonrpc: '2.0',
        id: 2,
        result: {
          tools: [{
            name: 'maintenance_action',
            inputSchema: { properties: { actionId: { enum: ['repair-control-plane'] } } },
          }],
        },
      },
    });
    return response({
      sessionId: 'session-1',
      body: {
        jsonrpc: '2.0',
        id: 3,
        result: {
          isError: false,
          structuredContent: {
            ok: true,
            finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
            proofHash: 'b'.repeat(64),
            contentText: '{"finalVerdict":"SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_GREEN"}',
          },
        },
      },
    });
  };
}

test('ignition autoheal uses authenticated Sovereign Commander maintenance action and returns proof', async () => {
  const result = await runSovereignCommanderIgnitionAutoheal({
    repoRoot: 'C:\\repo',
    fetchFn: greenFetch(),
    readFileFn: async () => 'x'.repeat(44),
    spawnSyncFn: () => { throw new Error('healthy Commander should not need bootstrap'); },
    env: { USERPROFILE: 'C:\\Users\\Operator' },
    home: 'C:\\Users\\Operator',
  });
  assert.equal(result.ok, true);
  assert.equal(result.commanderBootstrapAttempted, false);
  assert.equal(result.proofHash, 'b'.repeat(64));
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_IGNITION_AUTOHEAL_GREEN');
});

test('ignition autoheal fails closed when repair-control-plane is not exposed', async () => {
  let post = 0;
  const fetchFn = async (_url, options = {}) => {
    if ((options.method || 'GET') === 'GET') return response({ body: { ok: true, service: 'stephanos-sovereign-commander', capabilityVersion: '2026-10-02-project-search-v1' } });
    post += 1;
    if (post === 1) return response({ sessionId: 'session-1', body: { result: { protocolVersion: '2025-11-25' } } });
    if (post === 2) return response({ status: 202, sessionId: 'session-1' });
    return response({ sessionId: 'session-1', body: { result: { tools: [{ name: 'maintenance_action', inputSchema: { properties: { actionId: { enum: ['battle-bridge-status'] } } } }] } } });
  };
  const result = await runSovereignCommanderIgnitionAutoheal({
    repoRoot: 'C:\\repo',
    fetchFn,
    readFileFn: async () => 'x'.repeat(44),
    spawnSyncFn: () => { throw new Error('healthy Commander should not need bootstrap'); },
    env: { USERPROFILE: 'C:\\Users\\Operator' },
    home: 'C:\\Users\\Operator',
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_CONTROL_PLANE_ACTION_UNAVAILABLE');
});


test('ignition autoheal recycles a healthy but stale Commander before requiring repair capability', async () => {
  let getCount = 0;
  let post = 0;
  const processCalls = [];
  const fetchFn = async (_url, options = {}) => {
    if ((options.method || 'GET') === 'GET') {
      getCount += 1;
      return response({
        body: getCount === 1
          ? { ok: true, service: 'stephanos-sovereign-commander' }
          : { ok: true, service: 'stephanos-sovereign-commander', capabilityVersion: '2026-10-02-project-search-v1' },
      });
    }
    post += 1;
    if (post === 1) return response({ sessionId: 'session-1', body: { result: { protocolVersion: '2025-11-25' } } });
    if (post === 2) return response({ status: 202, sessionId: 'session-1' });
    if (post === 3) return response({
      sessionId: 'session-1',
      body: { result: { tools: [{ name: 'maintenance_action', inputSchema: { properties: { actionId: { enum: ['repair-control-plane'] } } } }] } },
    });
    return response({
      sessionId: 'session-1',
      body: { result: { isError: false, structuredContent: { ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED', proofHash: 'c'.repeat(64), contentText: '{}' } } },
    });
  };
  const result = await runSovereignCommanderIgnitionAutoheal({
    repoRoot: 'C:\\repo',
    fetchFn,
    readFileFn: async () => 'x'.repeat(44),
    spawnSyncFn(executable, args) {
      processCalls.push({ executable, args });
      return { status: 0, stdout: '{}', stderr: '' };
    },
    env: { USERPROFILE: 'C:\\Users\\Operator' },
    home: 'C:\\Users\\Operator',
  });
  assert.equal(result.ok, true);
  assert.equal(result.commanderBootstrapAttempted, true);
  assert.equal(result.staleCapabilityRecycleRequested, true);
  assert.equal(processCalls.length, 1);
  assert.ok(processCalls[0].args.includes('-RequireCapabilityVersion'));
  assert.ok(processCalls[0].args.includes('2026-10-02-project-search-v1'));
});
