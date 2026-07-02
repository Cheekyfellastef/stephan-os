import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateOpenClawRuntimeAutostartWithDeps,
  resolveApprovedOpenClawAutostartTargets,
} from './ignite-stephanos-local.mjs';

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

const approvedEnv = {
  STEPHANOS_OPENCLAW_GATEWAY_COMMAND: 'node local-openclaw-gateway.js --port 8790',
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

test('OpenClaw missing attempts approved autostart for gateway, chat, and dashboard without task execution', async () => {
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
    fetchFn: async () => {
      fetchCount += 1;
      return fetchCount <= 2
        ? Promise.reject(new Error('missing'))
        : response({ service: 'OpenClaw Gateway', status: 'ready', ok: true });
    },
    waitMs: 0,
    log: () => {},
  });

  assert.equal(result.state, 'openclaw-autostart-identity-verified');
  assert.deepEqual(spawned.map((entry) => entry.commandArgs[0]), ['local-openclaw-gateway.js', 'local-openclaw-chat.js', 'local-openclaw-dashboard.js']);
  assert.equal(result.guardrails.openClawTaskExecutionAllowed, false);
  assert.equal(result.guardrails.mutationAllowed, false);
});

test('OpenClaw already running is reused and no duplicate start is attempted', async () => {
  const spawned = [];
  const result = await evaluateOpenClawRuntimeAutostartWithDeps({
    platform: 'win32',
    env: approvedEnv,
    captureStep: noWindowsDiscovery,
    spawnFn: (...args) => spawned.push(args),
    fetchFn: async () => response({ service: 'OpenClaw Gateway', status: 'ready', ok: true }),
    waitMs: 0,
    log: () => {},
  });

  assert.equal(result.state, 'openclaw-reused-existing-runtime');
  assert.equal(result.duplicateStartAvoided, true);
  assert.equal(spawned.length, 0);
});

test('identity verified allows ignition to continue after autostart', async () => {
  let fetchCount = 0;
  const result = await evaluateOpenClawRuntimeAutostartWithDeps({
    platform: 'win32',
    env: { STEPHANOS_OPENCLAW_GATEWAY_COMMAND: 'node gateway.js' },
    captureStep: noWindowsDiscovery,
    spawnFn: () => ({ pid: 42, unref() {} }),
    fetchFn: async () => (++fetchCount === 1 ? Promise.reject(new Error('down')) : response({ name: 'openclaw-local-runtime', health: 'healthy' })),
    waitMs: 0,
    log: () => {},
  });

  assert.equal(result.healthy, true);
});

test('identity unverified blocks with clear operator action', async () => {
  await assert.rejects(() => evaluateOpenClawRuntimeAutostartWithDeps({
    platform: 'win32',
    env: { STEPHANOS_OPENCLAW_GATEWAY_COMMAND: 'node gateway.js' },
    captureStep: noWindowsDiscovery,
    spawnFn: () => ({ pid: 42, unref() {} }),
    fetchFn: async () => response({ service: 'unknown-local-service', status: 'ready' }),
    waitMs: 0,
    log: () => {},
  }), /endpoint identity could not be verified/);
});

test('guardrails reject OpenClaw task execution and mutation launch commands', () => {
  const targets = resolveApprovedOpenClawAutostartTargets({
    env: { STEPHANOS_OPENCLAW_GATEWAY_COMMAND: 'openclaw task execute mutate-files' },
  });

  assert.equal(targets[0].blocked, true);
  assert.equal(targets[0].reason, 'approved-launch-command-violates-guardrails');
});
