import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SOVEREIGN_COMMANDER_REMOTE_OPERATION,
  executeSovereignCommanderRemoteOnBattleBridge,
  validateSovereignCommanderRemoteCommandShape,
} from './sovereignCommanderRemoteMailboxV1.mjs';

const HEAD = 'e42d31670da802cc15d4c323dd8dcff10a03033f';

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'sovereign-mobile-1001',
    operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2158,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-10-01T12:00:00.000Z',
    remoteAction: 'status',
    ...overrides,
  };
}

function spawnForHead(head = HEAD) {
  return (_executable, args) => {
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: `${head}\n`, stderr: '' };
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
}

function response(body, { status = 200, sessionId = '' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === 'mcp-session-id' ? sessionId : '' },
    json: async () => body,
    text: async () => body === null || body === undefined ? '' : JSON.stringify(body),
  };
}

function mcpFetch({ maintenance = null, config = null } = {}) {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/health')) {
      return response({
        ok: true,
        service: 'stephanos-sovereign-commander',
        vendorMeterRequired: false,
        externalSaasRelayRequired: false,
      });
    }
    const message = JSON.parse(options.body || '{}');
    if (message.method === 'initialize') {
      return response({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' } }, { sessionId: 'session-1' });
    }
    if (message.method === 'notifications/initialized') return response(null, { status: 202, sessionId: 'session-1' });
    if (message.method === 'tools/list') {
      return response({
        jsonrpc: '2.0',
        id: 2,
        result: { tools: [{ name: 'get_config' }, { name: 'maintenance_action' }] },
      }, { sessionId: 'session-1' });
    }
    if (message.method === 'tools/call' && message.params?.name === 'get_config') {
      return response({
        jsonrpc: '2.0',
        id: 3,
        result: {
          structuredContent: {
            ok: true,
            finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
            proofHash: 'c'.repeat(64),
            structuredContent: config || {
              implementation: 'stephanos-local-node',
              vendorMeterRequired: false,
              externalSaasRelayRequired: false,
              sourceControlledMaintenanceOnly: true,
              arbitraryUnboundedCommandAllowed: false,
              mergeAuthority: false,
              pcRestartAuthority: false,
              canRunFocusedNodeTests: false,
            },
          },
        },
      }, { sessionId: 'session-1' });
    }
    if (message.method === 'tools/call' && message.params?.name === 'maintenance_action') {
      return response({
        jsonrpc: '2.0',
        id: 3,
        result: {
          structuredContent: maintenance || {
            ok: true,
            finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
            proofHash: 'a'.repeat(64),
            command: { plan: { processId: message.params.arguments.actionId } },
            contentText: 'SECRET-LIKE-RAW-OUTPUT-MUST-NOT-ESCAPE',
            structuredContent: {
              ok: true,
              status: 0,
              stdout: 'PRIVATE RAW STDOUT',
              stderr: '',
              errorCode: '',
            },
          },
        },
      }, { sessionId: 'session-1' });
    }
    return response({ error: 'unexpected' }, { status: 500 });
  };
  return { calls, fetchFn };
}

const readToken = async () => 'x'.repeat(44);

test('mobile command shape is closed-world and action allowlisted', () => {
  assert.equal(validateSovereignCommanderRemoteCommandShape(command()).ok, true);
  for (const [field, value] of [
    ['path', 'C:\\secret.txt'],
    ['content', 'secret'],
    ['token', 'secret'],
    ['args', ['whoami']],
    ['command', 'powershell.exe'],
  ]) {
    const result = validateSovereignCommanderRemoteCommandShape(command({ [field]: value }));
    assert.equal(result.ok, false, field);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_FIELD_NOT_ALLOWED', field);
  }
  const arbitrary = validateSovereignCommanderRemoteCommandShape(command({ remoteAction: 'run-any-shell' }));
  assert.equal(arbitrary.ok, false);
  assert.equal(arbitrary.blocker, 'SOVEREIGN_COMMANDER_REMOTE_ACTION_NOT_ALLOWED');
});

test('status route proves authenticated local commander without returning secrets', async () => {
  const { fetchFn } = mcpFetch();
  const result = await executeSovereignCommanderRemoteOnBattleBridge(command(), {
    spawnSyncFn: spawnForHead(),
    readFileFn: readToken,
    fetchFn,
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_STATUS_COMPLETE');
  assert.equal(result.publicReceiptSafe, true);
  assert.equal(result.secretMaterialReturned, false);
  assert.equal(result.vendorMeterRequired, false);
  assert.equal(result.arbitraryUnboundedCommandAllowed, false);
  assert.equal(result.result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_STATUS_COMPLETE');
  assert.equal(result.result.remoteAction, 'status');
  assert.equal(JSON.stringify(result).includes('x'.repeat(20)), false);
});

test('maintenance route publishes only sanitised proof metadata', async () => {
  const { fetchFn } = mcpFetch();
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'battle-bridge-status' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.maintenance.proofHash, 'a'.repeat(64));
  assert.equal(result.maintenance.processId, 'battle-bridge-status');
  assert.equal(result.maintenance.status, 0);
  assert.equal(result.result.remoteAction, 'battle-bridge-status');
  assert.equal(result.result.proofHash, 'a'.repeat(64));
  assert.equal(result.result.processId, 'battle-bridge-status');
  assert.equal(result.result.status, 0);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE RAW STDOUT'), false);
  assert.equal(serialized.includes('SECRET-LIKE-RAW-OUTPUT-MUST-NOT-ESCAPE'), false);
});

test('unsafe Commander posture blocks before maintenance mutation', async () => {
  const { calls, fetchFn } = mcpFetch({
    config: {
      implementation: 'stephanos-local-node',
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      sourceControlledMaintenanceOnly: true,
      arbitraryUnboundedCommandAllowed: false,
      mergeAuthority: true,
      pcRestartAuthority: false,
      canRunFocusedNodeTests: false,
    },
  });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'battle-bridge-status' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_CONFIG_POSTURE_INVALID');
  const maintenanceCalls = calls
    .filter((entry) => entry.url.endsWith('/mcp'))
    .map((entry) => JSON.parse(entry.options.body || '{}'))
    .filter((message) => message.method === 'tools/call' && message.params?.name === 'maintenance_action');
  assert.equal(maintenanceCalls.length, 0);
});

test('maintenance receipt must contain exact completion proof', async () => {
  const baseline = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'battle-bridge-status' } },
    structuredContent: { ok: true, status: 0, errorCode: '' },
  };
  for (const maintenance of [
    { ...baseline, finalVerdict: 'SOMETHING_ELSE' },
    { ...baseline, proofHash: 'bad' },
    { ...baseline, command: { plan: { processId: 'other-action' } } },
    { ...baseline, structuredContent: { ok: false, status: 1, errorCode: 'FAILED' } },
  ]) {
    const { fetchFn } = mcpFetch({ maintenance });
    const result = await executeSovereignCommanderRemoteOnBattleBridge(
      command({ remoteAction: 'battle-bridge-status' }),
      {
        spawnSyncFn: spawnForHead(),
        readFileFn: readToken,
        fetchFn,
        env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_RECEIPT_INVALID');
  }
});

test('main-head drift blocks before authenticated MCP mutation', async () => {
  const { calls, fetchFn } = mcpFetch();
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'restart-stephanos-runtime' }),
    {
      spawnSyncFn: spawnForHead('b'.repeat(40)),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_HEAD_MISMATCH');
  assert.equal(calls.length, 0);
});
