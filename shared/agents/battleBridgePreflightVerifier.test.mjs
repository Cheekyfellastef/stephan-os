import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleBridgePreflightVerifier, VerificationRunner, runBattleBridgePreflightProduction } from './battleBridgePreflightVerifier.mjs';

function jsonFetch(routes) {
  return async (url) => {
    const route = routes[url];
    if (!route) throw new Error('unreachable');
    return { ok: route.status >= 200 && route.status < 300, status: route.status, async json() { return route.payload; } };
  };
}

function gitSpawn(statusText = '') {
  return (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    const table = {
      'git branch --show-current': { status: 0, stdout: 'feature/verification-harness\n' },
      'git rev-parse --short=12 HEAD': { status: 0, stdout: 'abc123def456\n' },
      'git status --porcelain': { status: 0, stdout: statusText },
      'git rev-list --left-right --count origin/main...HEAD': { status: 0, stdout: '0\t2\n' },
      'git rev-parse --is-inside-work-tree': { status: 0, stdout: 'true\n' },
      'openclaw plugins inspect stephanos-whatsapp-command --runtime --json': { status: 0, stdout: '{"id":"stephanos-whatsapp-command"}' },
    };
    return table[key] || { status: 1, stdout: '', stderr: 'not found' };
  };
}

test('VerificationRunner accepts reusable verifier interface and stamps deterministic metadata', async () => {
  const runner = new VerificationRunner({ timestampUtc: '2026-07-08T00:00:00.000Z' });
  const result = await runner.run({ verify: async (_packet, options) => ({ status: 'PASS', timestampUtc: options.timestampUtc, verifierVersion: options.verifierVersion }) });
  assert.equal(result.status, 'PASS');
  assert.equal(result.timestampUtc, '2026-07-08T00:00:00.000Z');
  assert.equal(result.verifierVersion, 'battle-bridge-preflight-verifier.v1');
});

test('BattleBridgePreflightVerifier collects production evidence and deterministically passes with approved targets', async () => {
  const verifier = new BattleBridgePreflightVerifier({
    repoRoot: process.cwd(),
    spawnSync: gitSpawn(),
    fetch: jsonFetch({
      'http://127.0.0.1:8787/api/health': { status: 200, payload: { service: 'stephanos-server' } },
      'http://127.0.0.1:8790/health': { status: 200, payload: { service: 'openclaw-executable-gateway', canExecute: true, command: 'openclaw gateway --host 127.0.0.1 --port 8790', safeRestartTarget: 'OpenClaw Gateway', safeRestartTargetVerified: true } },
    }),
    env: { STEPHANOS_MISSION_ORCHESTRATOR_DIR: process.cwd() },
  });
  const result = await verifier.verify({ worker: { workerRunning: true }, task: { taskReady: true }, plugin: { pluginRuntimePresent: true } }, { timestampUtc: '2026-07-08T00:00:00.000Z' });
  assert.equal(result.status, 'PASS');
  assert.equal(result.finalVerdict, 'BATTLE_BRIDGE_PREFLIGHT_PASS');
  assert.equal(result.collectedEvidence.backend.backendHealthy, true);
  assert.equal(result.collectedEvidence.openClawGateway.canExecute, true);
});

test('BattleBridgePreflightVerifier fails closed on dirty repo and readonly gateway evidence', async () => {
  const result = await runBattleBridgePreflightProduction({
    timestampUtc: '2026-07-08T00:00:00.000Z',
    repoRoot: process.cwd(),
    spawnSync: gitSpawn(' M shared/agents/verificationHarness.mjs\n'),
    fetch: jsonFetch({
      'http://127.0.0.1:8787/api/health': { status: 200, payload: { service: 'stephanos-server' } },
      'http://127.0.0.1:8790/health': { status: 200, payload: { service: 'openclaw-readonly-adapter-stub', canExecute: false } },
    }),
    env: {},
    packet: { plugin: { pluginRuntimePresent: true } },
  });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.safeToRepair, false);
  assert.equal(result.blockingReasons.some((reason) => reason.includes('git-proof')), true);
  assert.equal(result.blockingReasons.includes('OpenClaw readonly adapter cannot prove executable gateway readiness'), true);
});
