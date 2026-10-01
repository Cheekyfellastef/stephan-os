import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SOVEREIGN_COMMANDER_REMOTE_OPERATION,
  SOVEREIGN_COMMANDER_REMOTE_PLAN_MAX_STEPS,
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

function mcpFetch({ maintenance = null, maintenanceByAction = {}, config = null, configReceipt = null, configIsError = false } = {}) {
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
          isError: configIsError,
          structuredContent: configReceipt || {
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
      const actionId = message.params.arguments.actionId;
      const selectedMaintenance = maintenanceByAction[actionId] || maintenance;
      return response({
        jsonrpc: '2.0',
        id: 3,
        result: {
          structuredContent: selectedMaintenance || {
            ok: true,
            finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
            proofHash: 'a'.repeat(64),
            command: { plan: { processId: actionId } },
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


test('remote repair delegation exposes the bounded local repair/orchestration registry without arbitrary shell', () => {
  for (const remoteAction of [
    'ignite-stephanos',
    'repair-battle-bridge',
    'repair-control-plane',
    'goal-discovery-heartbeat',
    'fleet-goal-supervisor',
    'start-mission-orchestrator-worker',
    'status-mission-orchestrator-worker',
    'start-stephanos-backend',
    'status-stephanos-backend',
    'status-openclaw-whatsapp',
    'repair-openclaw-ignite',
    'reconcile-remote-commander-parity',
  ]) {
    const result = validateSovereignCommanderRemoteCommandShape(command({ remoteAction }));
    assert.equal(result.ok, true, remoteAction);
  }
  for (const remoteAction of ['run-any-shell', 'powershell', 'cmd', 'restart-pc', 'merge-main']) {
    const result = validateSovereignCommanderRemoteCommandShape(command({ remoteAction }));
    assert.equal(result.ok, false, remoteAction);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_ACTION_NOT_ALLOWED', remoteAction);
  }
});

test('remote plan is bounded to unique admitted maintenance actions', () => {
  const valid = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['battle-bridge-status', 'repair-control-plane', 'ignite-stephanos'],
  }));
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.command.remotePlan, ['battle-bridge-status', 'repair-control-plane', 'ignite-stephanos']);
  assert.equal(valid.command.remoteAction, '');

  const conflict = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'battle-bridge-status',
    remotePlan: ['repair-control-plane'],
  }));
  assert.equal(conflict.ok, false);
  assert.equal(conflict.blocker, 'SOVEREIGN_COMMANDER_REMOTE_ACTION_PLAN_CONFLICT');

  for (const remotePlan of ['repair-control-plane', { actionId: 'repair-control-plane' }, null]) {
    const result = validateSovereignCommanderRemoteCommandShape(command({ remoteAction: '', remotePlan }));
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_TYPE_INVALID');
  }

  for (const remotePlan of [
    [],
    Array.from({ length: SOVEREIGN_COMMANDER_REMOTE_PLAN_MAX_STEPS + 1 }, (_, index) => index % 2 ? 'repair-ui-4173' : 'battle-bridge-status'),
  ]) {
    const result = validateSovereignCommanderRemoteCommandShape(command({ remoteAction: '', remotePlan }));
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_SIZE_INVALID');
  }

  const statusInPlan = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['status'],
  }));
  assert.equal(statusInPlan.ok, false);
  assert.equal(statusInPlan.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED');

  const arbitrary = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['repair-control-plane', 'run-any-shell'],
  }));
  assert.equal(arbitrary.ok, false);
  assert.equal(arbitrary.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED');

  const duplicate = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['battle-bridge-status', 'battle-bridge-status'],
  }));
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_DUPLICATE_ACTION');
});

test('remote plan executes admitted actions in order and returns only bounded proof', async () => {
  const { calls, fetchFn } = mcpFetch();
  const remotePlan = ['battle-bridge-status', 'repair-control-plane', 'ignite-stephanos'];
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: '', remotePlan }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_COMPLETE');
  assert.equal(result.stepCount, 3);
  assert.match(result.planProofHash, /^[0-9a-f]{64}$/);
  assert.equal(result.result.planProofHash, result.planProofHash);
  assert.deepEqual(result.remotePlan, remotePlan);
  assert.deepEqual(result.completedSteps.map((step) => step.remoteAction), remotePlan);
  assert.equal(result.completedSteps.every((step) => step.status === 0), true);
  const maintenanceCalls = calls
    .filter((entry) => entry.url.endsWith('/mcp'))
    .map((entry) => JSON.parse(entry.options.body || '{}'))
    .filter((message) => message.method === 'tools/call' && message.params?.name === 'maintenance_action');
  assert.deepEqual(maintenanceCalls.map((message) => message.params.arguments.actionId), remotePlan);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE RAW STDOUT'), false);
  assert.equal(serialized.includes('SECRET-LIKE-RAW-OUTPUT-MUST-NOT-ESCAPE'), false);
});

test('remote plan stops at first invalid maintenance receipt', async () => {
  const badReceipt = {
    ok: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
    proofHash: 'b'.repeat(64),
    command: { plan: { processId: 'repair-control-plane' } },
    structuredContent: { ok: false, status: 1, errorCode: 'FAILED' },
  };
  const { calls, fetchFn } = mcpFetch({
    maintenanceByAction: { 'repair-control-plane': badReceipt },
  });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({
      remoteAction: '',
      remotePlan: ['battle-bridge-status', 'repair-control-plane', 'ignite-stephanos'],
    }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_RECEIPT_INVALID');
  assert.equal(result.stepIndex, 1);
  assert.equal(result.remoteAction, 'repair-control-plane');
  assert.equal(result.completedSteps.length, 1);
  assert.equal(result.stepCount, 1);
  assert.deepEqual(result.remotePlan, ['battle-bridge-status', 'repair-control-plane', 'ignite-stephanos']);
  assert.equal(result.publicReceiptSafe, true);
  assert.equal(result.secretMaterialReturned, false);
  const maintenanceCalls = calls
    .filter((entry) => entry.url.endsWith('/mcp'))
    .map((entry) => JSON.parse(entry.options.body || '{}'))
    .filter((message) => message.method === 'tools/call' && message.params?.name === 'maintenance_action');
  assert.deepEqual(maintenanceCalls.map((message) => message.params.arguments.actionId), [
    'battle-bridge-status',
    'repair-control-plane',
  ]);
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

test('failed outer config receipts are rejected before maintenance mutation', async () => {
  const safeConfig = {
    implementation: 'stephanos-local-node',
    vendorMeterRequired: false,
    externalSaasRelayRequired: false,
    sourceControlledMaintenanceOnly: true,
    arbitraryUnboundedCommandAllowed: false,
    mergeAuthority: false,
    pcRestartAuthority: false,
    canRunFocusedNodeTests: false,
  };
  const baseReceipt = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'c'.repeat(64),
    structuredContent: safeConfig,
  };
  const cases = [
    { configReceipt: { ...baseReceipt, ok: false } },
    { configReceipt: { ...baseReceipt, finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED' } },
    { configReceipt: { ...baseReceipt, proofHash: 'bad' } },
    { configReceipt: baseReceipt, configIsError: true },
  ];
  for (const options of cases) {
    const { calls, fetchFn } = mcpFetch(options);
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
  }
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

test('maintenance receipt normalizes one extra MCP structured-content wrapper', async () => {
  const nestedReceipt = {
    structuredContent: {
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
      proofHash: 'd'.repeat(64),
      command: { plan: { processId: 'gaming-resource-acceptance' } },
      structuredContent: { ok: true, status: 0, errorCode: '' },
    },
  };
  const { fetchFn } = mcpFetch({ maintenance: nestedReceipt });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'gaming-resource-acceptance' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.result.remoteAction, 'gaming-resource-acceptance');
  assert.equal(result.result.proofHash, 'd'.repeat(64));
  assert.equal(result.result.processId, 'gaming-resource-acceptance');
  assert.equal(result.result.status, 0);
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


test('aggregate plan proof is request-specific even with identical step receipts', async () => {
  const remotePlan = ['battle-bridge-status', 'repair-control-plane'];
  const run = async (requestId) => {
    const { fetchFn } = mcpFetch();
    return executeSovereignCommanderRemoteOnBattleBridge(
      command({ requestId, remoteAction: '', remotePlan }),
      {
        spawnSyncFn: spawnForHead(),
        readFileFn: readToken,
        fetchFn,
        env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
      },
    );
  };
  const first = await run('sovereign-plan-proof-a');
  const second = await run('sovereign-plan-proof-b');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.match(first.planProofHash, /^[0-9a-f]{64}$/);
  assert.match(second.planProofHash, /^[0-9a-f]{64}$/);
  assert.notEqual(first.planProofHash, second.planProofHash);
});
