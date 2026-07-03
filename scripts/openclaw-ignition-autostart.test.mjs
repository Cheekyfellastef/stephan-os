import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateOpenClawRuntimeAutostartWithDeps,
  resolveApprovedOpenClawAutostartTargets,
} from './ignite-stephanos-local.mjs';

function identity(overrides = {}) {
  return {
    product: 'OpenClaw',
    runtimeId: 'openclaw-local-runtime',
    version: '1.0.0',
    endpoint: 'http://127.0.0.1:18789/identity',
    status: 'ready',
    ...overrides,
  };
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

const approvedEnv = {
  STEPHANOS_OPENCLAW_GATEWAY_COMMAND: 'node local-openclaw-gateway.js --port 18789',
  STEPHANOS_OPENCLAW_CHAT_COMMAND: 'node local-openclaw-chat.js',
  STEPHANOS_OPENCLAW_DASHBOARD_COMMAND: 'node local-openclaw-dashboard.js',
};

function noWindowsDiscovery(label, command, args) {
  if (label.includes('service')) return { stdout: '[]' };
  if (label.includes('process')) return { stdout: '[]' };
  if (label.includes('port')) return { stdout: '[]' };
  if (command === 'sc.exe') throw new Error('missing service');
  return { stdout: '{}' };
}


test('configured OpenClaw gateway endpoint selects 18789 identity before fallback', async () => {
  const calls = [];
  const env = {
    ...approvedEnv,
    STEPHANOS_OPENCLAW_GATEWAY_ENDPOINT: 'http://127.0.0.1:18789',
  };
  const result = await evaluateOpenClawRuntimeAutostartWithDeps({
    platform: 'win32',
    env,
    captureStep: noWindowsDiscovery,
    spawnFn: () => ({ pid: 42, unref() {} }),
    fetchFn: async (url) => {
      calls.push(url);
      assert.equal(url, 'http://127.0.0.1:18789/identity');
      return response(identity({ endpoint: 'http://127.0.0.1:18789/identity' }));
    },
    waitMs: 0,
    log: () => {},
  });

  assert.equal(result.state, 'openclaw-reused-existing-runtime');
  assert.equal(result.selectedGatewayEndpoint, 'http://127.0.0.1:18789');
  assert.equal(result.selectedGatewayEndpointSource, 'env:STEPHANOS_OPENCLAW_GATEWAY_ENDPOINT');
  assert.deepEqual(calls, ['http://127.0.0.1:18789/identity']);
});

test('successful autostart verification uses canonical OpenClaw identity endpoint', async () => {
  const spawned = [];
  let fetchCount = 0;
  const result = await evaluateOpenClawRuntimeAutostartWithDeps({
    platform: 'win32',
    env: approvedEnv,
    captureStep: noWindowsDiscovery,
    spawnFn: (command, commandArgs, options) => {
      spawned.push({ command, commandArgs, options });
      return { pid: 9000 + spawned.length, unref() {} };
    },
    fetchFn: async (url) => {
      fetchCount += 1;
      assert.equal(url, 'http://127.0.0.1:18789/identity');
      return fetchCount <= 1 ? Promise.reject(new Error('missing')) : response(identity());
    },
    waitMs: 0,
    readinessTimeoutMs: 50,
    retryIntervalMs: 0,
    log: () => {},
  });

  assert.equal(result.state, 'openclaw-autostart-identity-verified');
  assert.deepEqual(spawned.map((entry) => entry.commandArgs[0]), ['local-openclaw-gateway.js', 'local-openclaw-chat.js', 'local-openclaw-dashboard.js']);
  assert.equal(result.guardrails.openClawTaskExecutionAllowed, false);
  assert.equal(result.guardrails.mutationAllowed, false);
});


test('default fallback keeps approved 18789 identity first when no gateway endpoint is configured or discovered', async () => {
  const calls = [];
  const result = await evaluateOpenClawRuntimeAutostartWithDeps({
    platform: 'win32',
    env: approvedEnv,
    captureStep: noWindowsDiscovery,
    spawnFn: () => ({ pid: 42, unref() {} }),
    fetchFn: async (url) => {
      calls.push(url);
      return response(identity());
    },
    waitMs: 0,
    log: () => {},
  });

  assert.equal(result.state, 'openclaw-reused-existing-runtime');
  assert.equal(result.selectedGatewayEndpoint, 'http://127.0.0.1:18789');
  assert.equal(result.selectedGatewayEndpointSource, 'env:STEPHANOS_OPENCLAW_GATEWAY_COMMAND:--port');
  assert.equal(calls[0], 'http://127.0.0.1:18789/identity');
});

test('OpenClaw already running is reused and no duplicate start is attempted', async () => {
  const spawned = [];
  const result = await evaluateOpenClawRuntimeAutostartWithDeps({
    platform: 'win32',
    env: approvedEnv,
    captureStep: noWindowsDiscovery,
    spawnFn: (...args) => spawned.push(args),
    fetchFn: async () => response(identity()),
    waitMs: 0,
    log: () => {},
  });

  assert.equal(result.state, 'openclaw-reused-existing-runtime');
  assert.equal(result.duplicateStartAvoided, true);
  assert.equal(spawned.length, 0);
});

test('delayed startup retries until identity is ready', async () => {
  let fetchCount = 0;
  const result = await evaluateOpenClawRuntimeAutostartWithDeps({
    platform: 'win32',
    env: {},
    captureStep: noWindowsDiscovery,
    spawnFn: () => ({ pid: 42, unref() {} }),
    fetchFn: async () => (++fetchCount < 4 ? Promise.reject(new Error('down')) : response(identity())),
    waitMs: 0,
    readinessTimeoutMs: 100,
    retryIntervalMs: 0,
    log: () => {},
  });

  assert.equal(result.healthy, true);
  assert.equal(fetchCount >= 4, true);
});


test('identity failure diagnostics include selected gateway endpoint and source', async () => {
  await assert.rejects(() => evaluateOpenClawRuntimeAutostartWithDeps({
    platform: 'win32',
    env: {},
    captureStep: noWindowsDiscovery,
    spawnFn: () => ({ pid: 42, unref() {} }),
    fetchFn: async () => { throw new Error('down'); },
    waitMs: 0,
    readinessTimeoutMs: 0,
    log: () => {},
  }), /selectedGatewayEndpoint.*18789.*selectedGatewayEndpointSource.*openclaw-control-panel-start-gateway.*expectedEndpoint.*18789.*endpoint-unreachable/);
});

test('wrong endpoint blocks with explicit diagnostics', async () => {
  await assert.rejects(() => evaluateOpenClawRuntimeAutostartWithDeps({
    platform: 'win32',
    env: {},
    captureStep: noWindowsDiscovery,
    spawnFn: () => ({ pid: 42, unref() {} }),
    fetchFn: async () => response(identity({ endpoint: 'http://127.0.0.1:9999/identity' })),
    waitMs: 0,
    readinessTimeoutMs: 0,
    log: () => {},
  }), /expectedEndpoint.*actualEndpoint.*identityPayload.*endpoint-mismatch/);
});

test('wrong runtime blocks with runtime diagnostics', async () => {
  await assert.rejects(() => evaluateOpenClawRuntimeAutostartWithDeps({
    platform: 'win32',
    env: {},
    captureStep: noWindowsDiscovery,
    spawnFn: () => ({ pid: 42, unref() {} }),
    fetchFn: async () => response(identity({ runtimeId: 'other-runtime' })),
    waitMs: 0,
    readinessTimeoutMs: 0,
    log: () => {},
  }), /runtime-id-mismatch/);
});

test('timeout blocks when gateway never becomes reachable', async () => {
  let fetchCount = 0;
  await assert.rejects(() => evaluateOpenClawRuntimeAutostartWithDeps({
    platform: 'win32',
    env: {},
    captureStep: noWindowsDiscovery,
    spawnFn: () => ({ pid: 42, unref() {} }),
    fetchFn: async () => { fetchCount += 1; throw new Error('down'); },
    waitMs: 0,
    readinessTimeoutMs: 5,
    retryIntervalMs: 1,
    log: () => {},
  }), /endpoint-unreachable/);
  assert.equal(fetchCount > 1, true);
});

test('identity mismatch blocks when product or version is not approved', async () => {
  await assert.rejects(() => evaluateOpenClawRuntimeAutostartWithDeps({
    platform: 'win32',
    env: {},
    captureStep: noWindowsDiscovery,
    spawnFn: () => ({ pid: 42, unref() {} }),
    fetchFn: async () => response(identity({ product: 'Unknown Gateway', version: '' })),
    waitMs: 0,
    readinessTimeoutMs: 0,
    log: () => {},
  }), /product-mismatch,version-missing/);
});

test('guardrails reject OpenClaw task execution and mutation launch commands', () => {
  const targets = resolveApprovedOpenClawAutostartTargets({
    env: { STEPHANOS_OPENCLAW_GATEWAY_COMMAND: 'openclaw task execute mutate-files' },
  });

  assert.equal(targets[0].blocked, true);
  assert.equal(targets[0].reason, 'approved-launch-command-violates-guardrails');
});

test('ignition uses shared Control Panel gateway startup path on approved 18789 port', async () => {
  const spawned = [];
  let fetchCount = 0;
  const result = await evaluateOpenClawRuntimeAutostartWithDeps({
    platform: 'win32',
    env: {},
    captureStep: noWindowsDiscovery,
    spawnFn: (command, commandArgs) => {
      spawned.push({ command, commandArgs });
      return { pid: 18789, unref() {} };
    },
    fetchFn: async (url) => {
      fetchCount += 1;
      assert.equal(url, 'http://127.0.0.1:18789/identity');
      return fetchCount <= 1 ? Promise.reject(new Error('starting')) : response(identity({ endpoint: 'http://127.0.0.1:18789/identity' }));
    },
    waitMs: 0,
    readinessTimeoutMs: 50,
    retryIntervalMs: 0,
    log: () => {},
  });

  assert.equal(result.state, 'openclaw-autostart-identity-verified');
  assert.equal(result.ignitionPhase, 'openclaw-gateway-startup');
  assert.equal(result.startupSource, 'shared:openclaw-control-panel-start-gateway');
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].command, 'powershell.exe');
  assert.match(spawned[0].commandArgs.join(' '), /openclaw gateway --host 127\.0\.0\.1 --port 18789/);
});

test('splash/status diagnostics report OpenClaw startup phase and endpoint unreachable details', async () => {
  const logs = [];
  await assert.rejects(() => evaluateOpenClawRuntimeAutostartWithDeps({
    platform: 'win32',
    env: {},
    captureStep: noWindowsDiscovery,
    spawnFn: () => ({ pid: 42, unref() {} }),
    fetchFn: async () => { throw new Error('down'); },
    waitMs: 0,
    readinessTimeoutMs: 0,
    log: (message) => logs.push(message),
  }), /startupSource.*shared:openclaw-control-panel-start-gateway.*startupCommand.*18789.*processStartResult.*probeAttempts.*endpoint-unreachable/);
  assert.match(logs.join('\n'), /openclaw-gateway-startup/);
});
