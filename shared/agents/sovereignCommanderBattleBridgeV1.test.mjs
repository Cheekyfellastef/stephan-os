import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOVEREIGN_COMMANDER_INSTALL_OPERATION,
  executeSovereignCommanderInstallOnBattleBridge,
  validateSovereignCommanderInstallCommandShape,
} from './sovereignCommanderBattleBridgeV1.mjs';

const HEAD = 'a'.repeat(40);

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'sovereign-install-20260930-001',
    operation: SOVEREIGN_COMMANDER_INSTALL_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2158,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-09-30T05:00:00.000Z',
    ...overrides,
  };
}

function response({ status = 200, body = null, sessionId = '' } = {}) {
  const serialized = body == null ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => String(name).toLowerCase() === 'mcp-session-id' ? sessionId : null },
    async json() { return body; },
    async text() { return serialized; },
  };
}

test('sovereign bootstrap command is exact-head and rejects widened fields', () => {
  const valid = validateSovereignCommanderInstallCommandShape(command());
  assert.equal(valid.ok, true);
  assert.equal(valid.expectedHead, HEAD);

  const widened = validateSovereignCommanderInstallCommandShape(command({ command: 'whoami' }));
  assert.equal(widened.ok, false);
  assert.equal(widened.blocker, 'SOVEREIGN_COMMANDER_INSTALL_FIELD_NOT_ALLOWED');
});

test('sovereign bootstrap installs fixed task and proves authenticated MCP posture', async () => {
  const processCalls = [];
  const spawnSyncFn = (executable, args) => {
    processCalls.push({ executable, args });
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: HEAD + '\n', stderr: '' };
    if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('/Query') && args.includes('Stephanos Sovereign Commander')) return { status: 1, stdout: '', stderr: 'not found' };
    if (args.some((arg) => String(arg).endsWith('run-sovereign-commander-hidden.ps1'))) {
      return {
        status: 0,
        stdout: JSON.stringify({
          healthy: true,
          blocker: '',
          startRequested: true,
          afterProcessCount: 1,
        }),
        stderr: '',
      };
    }
    if (args.some((arg) => String(arg).endsWith('install-sovereign-commander.ps1'))) {
      return {
        status: 0,
        stdout: JSON.stringify({
          finalVerdict: 'SOVEREIGN_COMMANDER_TASK_INSTALLED',
          installed: true,
          startedNow: true,
          taskName: 'Stephanos Sovereign Commander',
          hidden: true,
          intervalMinutes: 1,
          vendorMeterRequired: false,
          externalSaasRelayRequired: false,
          arbitraryShellAllowed: false,
          pcRestartAllowed: false,
        }),
        stderr: '',
      };
    }
    throw new Error('unexpected process call: ' + JSON.stringify(args));
  };

  let fetchCall = 0;
  const healthy = () => response({
    body: {
      ok: true,
      service: 'stephanos-sovereign-commander',
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
    },
  });
  const fetchFn = async () => {
    fetchCall += 1;
    if (fetchCall === 1) return response({ status: 503, body: { ok: false } });
    if (fetchCall === 2) return healthy();
    if (fetchCall === 3) {
      return response({
        sessionId: 'session-1',
        body: { result: { protocolVersion: '2025-11-25' } },
      });
    }
    if (fetchCall === 4) return response({ status: 202 });
    if (fetchCall === 5) {
      return response({
        body: {
          result: {
            tools: [
              { name: 'get_config' },
              { name: 'maintenance_action' },
              { name: 'read_file' },
            ],
          },
        },
      });
    }
    if (fetchCall === 6) {
      return response({
        body: {
          result: {
            structuredContent: {
              implementation: 'stephanos-local-node',
              vendorMeterRequired: false,
              externalSaasRelayRequired: false,
              arbitraryUnboundedCommandAllowed: false,
              mergeAuthority: false,
              pcRestartAuthority: false,
              canRunFocusedNodeTests: false,
              sourceControlledMaintenanceOnly: true,
            },
          },
        },
      });
    }
    throw new Error('unexpected fetch call');
  };

  const result = await executeSovereignCommanderInstallOnBattleBridge(command(), {
    env: { USERPROFILE: 'C:\\Users\\Operator' },
    spawnSyncFn,
    fetchFn,
    readFileFn: async () => 'x'.repeat(48),
    healthAttempts: 1,
    healthDelayMs: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_INSTALLED_STARTED_AND_AUTHENTICATED');
  assert.equal(result.expectedHeadMatch, true);
  assert.equal(result.healthReady, true);
  assert.equal(result.authenticatedMcpReady, true);
  assert.equal(result.negotiatedProtocolVersion, '2025-11-25');
  assert.equal(result.vendorMeterRequired, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.pcRestartAuthority, false);
  assert.equal(result.credentialExported, false);
  assert.equal(result.taskAlreadyInstalled, false);
  assert.equal(result.installerRun, true);
  assert.ok(result.tools.includes('maintenance_action'));
  assert.equal(result.tools.includes('run_node_test'), false);
  assert.ok(processCalls.some((call) => call.args.some((arg) => String(arg).endsWith('install-sovereign-commander.ps1'))));
});


test('sovereign bootstrap reuses an existing healthy task without reinstalling it', async () => {
  const processCalls = [];
  const spawnSyncFn = (executable, args) => {
    processCalls.push({ executable, args });
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: HEAD + '\n', stderr: '' };
    if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('/Query') && args.includes('Stephanos Sovereign Commander')) {
      return { status: 0, stdout: 'TaskName: Stephanos Sovereign Commander', stderr: '' };
    }
    throw new Error('unexpected process call: ' + JSON.stringify(args));
  };

  let fetchCall = 0;
  const healthy = () => response({
    body: {
      ok: true,
      service: 'stephanos-sovereign-commander',
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
    },
  });
  const fetchFn = async () => {
    fetchCall += 1;
    if (fetchCall === 1 || fetchCall === 2) return healthy();
    if (fetchCall === 3) return response({ sessionId: 'session-existing', body: { result: { protocolVersion: '2025-11-25' } } });
    if (fetchCall === 4) return response({ status: 202 });
    if (fetchCall === 5) return response({ body: { result: { tools: [{ name: 'get_config' }, { name: 'maintenance_action' }] } } });
    if (fetchCall === 6) {
      return response({
        body: {
          result: {
            structuredContent: {
              implementation: 'stephanos-local-node',
              vendorMeterRequired: false,
              externalSaasRelayRequired: false,
              arbitraryUnboundedCommandAllowed: false,
              mergeAuthority: false,
              pcRestartAuthority: false,
              canRunFocusedNodeTests: false,
              sourceControlledMaintenanceOnly: true,
            },
          },
        },
      });
    }
    throw new Error('unexpected fetch call');
  };

  const result = await executeSovereignCommanderInstallOnBattleBridge(command(), {
    env: { USERPROFILE: 'C:\\Users\\Operator' },
    spawnSyncFn,
    fetchFn,
    readFileFn: async () => 'x'.repeat(48),
    healthAttempts: 1,
    healthDelayMs: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.taskAlreadyInstalled, true);
  assert.equal(result.installerRun, false);
  assert.equal(processCalls.some((call) => call.args.some((arg) => String(arg).endsWith('install-sovereign-commander.ps1'))), false);
  assert.equal(processCalls.some((call) => call.args.some((arg) => String(arg).endsWith('run-sovereign-commander-hidden.ps1'))), false);
});


test('sovereign bootstrap repairs an existing unhealthy scheduled task instead of trusting task presence', async () => {
  const processCalls = [];
  const spawnSyncFn = (executable, args) => {
    processCalls.push({ executable, args });
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: HEAD + '\n', stderr: '' };
    if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('/Query') && args.includes('Stephanos Sovereign Commander')) {
      return { status: 0, stdout: 'TaskName: Stephanos Sovereign Commander', stderr: '' };
    }
    if (args.some((arg) => String(arg).endsWith('install-sovereign-commander.ps1'))) {
      return {
        status: 0,
        stdout: JSON.stringify({
          finalVerdict: 'SOVEREIGN_COMMANDER_TASK_INSTALLED',
          installed: true,
          startedNow: true,
          taskName: 'Stephanos Sovereign Commander',
          hidden: true,
          intervalMinutes: 1,
          vendorMeterRequired: false,
          externalSaasRelayRequired: false,
          arbitraryShellAllowed: false,
          pcRestartAllowed: false,
        }),
        stderr: '',
      };
    }
    if (args.some((arg) => String(arg).endsWith('run-sovereign-commander-hidden.ps1'))) {
      return { status: 0, stdout: JSON.stringify({ healthy: true, blocker: '', startRequested: false, afterProcessCount: 1 }), stderr: '' };
    }
    throw new Error('unexpected process call: ' + JSON.stringify(args));
  };

  let fetchCall = 0;
  const healthy = () => response({
    body: {
      ok: true,
      service: 'stephanos-sovereign-commander',
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
    },
  });
  const fetchFn = async () => {
    fetchCall += 1;
    if (fetchCall === 1) return response({ status: 503, body: { ok: false } });
    if (fetchCall === 2) return healthy();
    if (fetchCall === 3) return response({ sessionId: 'session-repaired', body: { result: { protocolVersion: '2025-11-25' } } });
    if (fetchCall === 4) return response({ status: 202 });
    if (fetchCall === 5) return response({ body: { result: { tools: [{ name: 'get_config' }, { name: 'maintenance_action' }] } } });
    if (fetchCall === 6) return response({
      body: {
        result: {
          structuredContent: {
            implementation: 'stephanos-local-node',
            vendorMeterRequired: false,
            externalSaasRelayRequired: false,
            arbitraryUnboundedCommandAllowed: false,
            mergeAuthority: false,
            pcRestartAuthority: false,
            canRunFocusedNodeTests: false,
            sourceControlledMaintenanceOnly: true,
          },
        },
      },
    });
    throw new Error('unexpected fetch call');
  };

  const result = await executeSovereignCommanderInstallOnBattleBridge(command(), {
    env: { USERPROFILE: 'C:\\Users\\Operator' },
    spawnSyncFn,
    fetchFn,
    readFileFn: async () => 'x'.repeat(48),
    healthAttempts: 1,
    healthDelayMs: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.taskAlreadyInstalled, true);
  assert.equal(result.installerRun, true);
  assert.ok(processCalls.some((call) => call.args.some((arg) => String(arg).endsWith('install-sovereign-commander.ps1'))));
});


test('sovereign bootstrap classifies installer access denied as a safe blocker without returning stderr', async () => {
  const spawnSyncFn = (_executable, args) => {
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: HEAD + '\n', stderr: '' };
    if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('/Query') && args.includes('Stephanos Sovereign Commander')) {
      return { status: 0, stdout: 'TaskName: Stephanos Sovereign Commander', stderr: '' };
    }
    if (args.some((arg) => String(arg).endsWith('install-sovereign-commander.ps1'))) {
      return { status: 1, stdout: '', stderr: 'Register-ScheduledTask : Access is denied at C:\\Users\\Operator\\secret-path' };
    }
    throw new Error('unexpected process call: ' + JSON.stringify(args));
  };

  const result = await executeSovereignCommanderInstallOnBattleBridge(command(), {
    env: { USERPROFILE: 'C:\\Users\\Operator' },
    spawnSyncFn,
    fetchFn: async () => response({ status: 503, body: { ok: false } }),
    healthAttempts: 1,
    healthDelayMs: 0,
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_INSTALL_FAILED_ACCESS_DENIED');
  assert.equal(result.status, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'stderr'), false);
});
