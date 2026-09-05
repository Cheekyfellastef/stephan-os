import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_BRIDGE_PREFLIGHT_PROOF_COMMAND,
  OPENCLAW_GATEWAY_VERDICTS,
  PLUGIN_VERIFIER_VERDICTS,
  WORKER_VERIFIER_VERDICTS,
  runBattleBridgePreflightVerifier,
  runVerificationHarness,
  runVerifier,
  validateVerifierResult,
} from './verificationHarness.mjs';

test('runner aggregates PASS checks into workspace proof emission', () => {
  const aggregate = runVerificationHarness({
    aggregateId: 'source-slice-proof',
    timestampUtc: '2026-07-01T00:00:00Z',
    verifiers: ['GitVerifier', 'BuildVerifier', 'BackendVerifier', 'FrontendVerifier', 'WorkerVerifier'],
    packets: {
      GitVerifier: { repoExists: true, branch: 'feature/verification-harness-v1', head: 'abc123', originMain: 'def456', repoClean: true, ahead: 1, behind: 0 },
      BuildVerifier: { buildPassed: true, script: 'npm run stephanos:build', artifactScope: 'source-only' },
      BackendVerifier: { backendHealthy: true, httpStatus: 200, endpoint: 'http://127.0.0.1:8787/api/health' },
      FrontendVerifier: { frontendHealthy: true, uiReality: 'present', browserProof: 'provided' },
      WorkerVerifier: { workerRunning: true, workerMode: 'read-only', taskState: 'ready' },
    },
  });

  assert.equal(aggregate.status, 'PASS');
  assert.equal(aggregate.overall, 'VERIFIED');
  assert.equal(aggregate.operatorNeeded, false);
  assert.equal(aggregate.workspaceMessage.eventKind, 'verification-result');
  assert.equal(aggregate.workspaceMessage.status, 'VERIFIED');
  assert.equal(aggregate.finalVerdict, 'VERIFICATION_HARNESS_PASS');
});

test('runner fails closed for unknown verifier names', () => {
  const result = runVerifier('ArbitraryShellVerifier', {}, { timestampUtc: '2026-07-01T00:00:00Z' });

  assert.equal(result.status, 'FAIL');
  assert.equal(result.reason, 'verifier name is not allowlisted');
  assert.equal(result.finalVerdict, 'UNKNOWN_VERIFIER_BLOCKED');
  assert.equal(validateVerifierResult(result).valid, true);
});

test('no success claim is valid without verifier evidence', () => {
  const result = runVerifier('BuildVerifier', { buildPassed: true }, { timestampUtc: '2026-07-01T00:00:00Z' });

  assert.equal(result.status, 'PASS');
  assert.notDeepEqual(result.evidence, []);
  assert.equal(validateVerifierResult({ ...result, evidence: [] }).errors.includes('missing-success-evidence'), true);
});

test('OpenClaw gateway verifier rejects readonly adapter even with HTTP 200', () => {
  const result = runVerifier('OpenClawGatewayVerifier', {
    endpoint: 'http://127.0.0.1:8790/health',
    httpStatus: 200,
    endpointIdentity: 'openclaw-readonly-adapter-stub',
    mode: 'readonly_status_only',
    executionAllowed: false,
    canExecute: false,
    safeRestartTarget: 'none',
  });

  assert.equal(result.status, 'FAIL');
  assert.equal(result.finalVerdict, OPENCLAW_GATEWAY_VERDICTS.READONLY_ADAPTER_ONLY);
});

test('OpenClaw gateway verifier accepts executable gateway fixture', () => {
  const result = runVerifier('OpenClawGatewayVerifier', {
    endpoint: 'http://127.0.0.1:18789/health',
    httpStatus: 200,
    endpointIdentity: 'openclaw-executable-gateway',
    canExecute: true,
    ownerProcess: 'node.exe',
    command: 'node.exe npm/node_modules/openclaw/dist/index.js gateway --port 18789',
    safeRestartTarget: 'OpenClaw Gateway',
    safeRestartTargetVerified: true,
  });

  assert.equal(result.status, 'PASS');
  assert.equal(result.finalVerdict, OPENCLAW_GATEWAY_VERDICTS.VERIFIED);
});

test('OpenClaw gateway verifier rejects non-approved executable port even with gateway command', () => {
  const result = runVerifier('OpenClawGatewayVerifier', {
    endpoint: 'http://127.0.0.1:8790/health',
    httpStatus: 200,
    endpointIdentity: 'openclaw-executable-gateway',
    canExecute: true,
    command: 'node.exe npm/node_modules/openclaw/dist/index.js gateway --port 8790',
    safeRestartTarget: 'OpenClaw Gateway',
    safeRestartTargetVerified: true,
  });

  assert.equal(result.status, 'FAIL');
  assert.equal(result.finalVerdict, OPENCLAW_GATEWAY_VERDICTS.UNVERIFIED_OWNER);
  assert.match(result.reason, /18789/);
});

test('Worker verifier distinguishes not configured configured stopped and running states', () => {
  assert.equal(runVerifier('WorkerVerifier', {}).finalVerdict, WORKER_VERIFIER_VERDICTS.NOT_CONFIGURED);
  assert.equal(runVerifier('WorkerVerifier', { workerConfigured: true, workerRunning: false, workerMode: 'queue' }).finalVerdict, WORKER_VERIFIER_VERDICTS.CONFIGURED_STOPPED);
  const running = runVerifier('WorkerVerifier', { workerConfigured: true, workerRunning: true, workerMode: 'queue', taskState: 'ready' });
  assert.equal(running.finalVerdict, WORKER_VERIFIER_VERDICTS.RUNNING);
  assert.equal(running.status, 'PASS');
});

test('Plugin verifier distinguishes runtime missing installed not loaded and loaded states', () => {
  assert.equal(runVerifier('PluginVerifier', {}).finalVerdict, PLUGIN_VERIFIER_VERDICTS.RUNTIME_MISSING);
  assert.equal(runVerifier('PluginVerifier', { pluginInstalled: true, pluginRuntimePresent: false }).finalVerdict, PLUGIN_VERIFIER_VERDICTS.INSTALLED_NOT_LOADED);
  const loaded = runVerifier('PluginVerifier', { pluginInstalled: true, pluginRuntimePresent: true, pluginLoaded: true });
  assert.equal(loaded.finalVerdict, PLUGIN_VERIFIER_VERDICTS.RUNTIME_LOADED);
  assert.equal(loaded.status, 'PASS');
});

test('Battle Bridge preflight blocks with deterministic reasons', () => {
  const preflight = runBattleBridgePreflightVerifier({
    git: { repoExists: true, branch: 'main', head: '4f0bbb24', originMain: '4f0bbb24', repoClean: true, ahead: 0, behind: 0, expectedHead: true },
    backend: { backendHealthy: true, httpStatus: 200, endpoint: 'http://127.0.0.1:8787/api/health' },
    openClawGateway: { endpoint: 'http://127.0.0.1:8790/health', httpStatus: 200, endpointIdentity: 'openclaw-readonly-adapter-stub', mode: 'readonly_status_only', canExecute: false, safeRestartTarget: 'none' },
    worker: { workerRunning: true, workerMode: 'read-only', taskState: 'ready' },
    files: { filesPresent: true, sourcePresent: true, targetPluginSourcePresent: true },
    plugin: { pluginRuntimePresent: true, targetPluginSourcePresent: true },
    task: { taskReady: true, stephanosBackendTask: 'ready' },
  }, { timestampUtc: '2026-07-01T00:00:00Z' });

  assert.equal(preflight.status, 'FAIL');
  assert.equal(preflight.finalVerdict, 'BATTLE_BRIDGE_PREFLIGHT_BLOCKED');
  assert.equal(preflight.safeToBuild, false);
  assert.equal(preflight.blockingReasons.includes('OpenClaw readonly adapter cannot prove executable gateway readiness'), true);
});

test('Battle Bridge preflight passes only when all required evidence passes', () => {
  const preflight = runBattleBridgePreflightVerifier({
    git: { repoExists: true, branch: 'main', head: '4f0bbb24', originMain: '4f0bbb24', repoClean: true, ahead: 0, behind: 0, expectedHead: true },
    backend: { backendHealthy: true, httpStatus: 200, endpoint: 'http://127.0.0.1:8787/api/health' },
    openClawGateway: { endpoint: 'http://127.0.0.1:18789/health', httpStatus: 200, endpointIdentity: 'openclaw-executable-gateway', canExecute: true, command: 'node.exe npm/node_modules/openclaw/dist/index.js gateway --port 18789', safeRestartTarget: 'OpenClaw Gateway', safeRestartTargetVerified: true },
    worker: { workerRunning: true, workerMode: 'read-only', taskState: 'ready' },
    files: { filesPresent: true, sourcePresent: true, targetPluginSourcePresent: true },
    plugin: { pluginRuntimePresent: true, targetPluginSourcePresent: true },
    task: { taskReady: true, stephanosBackendTask: 'ready' },
  });

  assert.equal(preflight.status, 'PASS');
  assert.equal(preflight.finalVerdict, 'BATTLE_BRIDGE_PREFLIGHT_PASS');
  assert.equal(preflight.safeToInstall, true);
  assert.equal(BATTLE_BRIDGE_PREFLIGHT_PROOF_COMMAND, 'node --test shared/agents/verificationHarness*.test.mjs shared/agents/*Verifier*.test.mjs');
});

test('PR publication verifier passes only when GitHub PR, origin branch, local HEAD, and tested code agree', () => {
  const sha = '5d3412b26393fcfc4627bb0b1a1e942e3dac9651';
  const result = runVerifier('PRPublicationVerifier', {
    prNumber: 1444,
    headBranch: 'feature/battle-bridge-proof',
    expectedCommit: sha,
    remotePrHeadSha: sha,
    fetchedOriginBranchSha: sha,
    localHeadSha: sha,
    testedHeadSha: sha,
    prCommits: [sha],
  }, { timestampUtc: '2026-07-08T00:00:00Z' });

  assert.equal(result.status, 'PASS');
  assert.equal(result.finalVerdict, 'PR_PUBLICATION_VERIFIER_PASS');
  assert.equal(result.reason, '');
  assert.equal(result.evidence.includes('prNumber=1444'), true);
  assert.equal(result.evidence.includes(`remotePrHeadSha=${sha}`), true);
  assert.equal(result.evidence.includes('expectedCommitPresent=true'), true);
  assert.equal(validateVerifierResult(result).valid, true);
});

test('PR publication verifier fails closed for stale local or tested code', () => {
  const prSha = '5d3412b26393fcfc4627bb0b1a1e942e3dac9651';
  const staleSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const result = runVerifier('PRPublicationVerifier', {
    prNumber: 1444,
    headBranch: 'feature/battle-bridge-proof',
    expectedCommit: prSha,
    remotePrHeadSha: prSha,
    fetchedOriginBranchSha: prSha,
    localHeadSha: staleSha,
    testedHeadSha: staleSha,
    prCommits: [prSha],
  }, { timestampUtc: '2026-07-08T00:00:00Z' });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.finalVerdict, 'PR_PUBLICATION_VERIFIER_BLOCKED');
  assert.equal(result.reason.includes('local-head-is-not-pr-head'), true);
  assert.equal(result.reason.includes('tested-code-is-not-pr-code'), true);
  assert.equal(validateVerifierResult(result).valid, true);
});

test('PR publication verifier blocks missing expected commit or stale origin branch', () => {
  const expected = '5d3412b26393fcfc4627bb0b1a1e942e3dac9651';
  const githubHead = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const result = runVerifier('PRPublicationVerifier', {
    prNumber: 1444,
    headBranch: 'feature/battle-bridge-proof',
    expectedCommit: expected,
    remotePrHeadSha: githubHead,
    fetchedOriginBranchSha: 'cccccccccccccccccccccccccccccccccccccccc',
    localHeadSha: githubHead,
    testedHeadSha: githubHead,
    prCommits: [githubHead],
  }, { timestampUtc: '2026-07-08T00:00:00Z' });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reason.includes('expected-commit-missing-from-pr'), true);
  assert.equal(result.reason.includes('pr-head-does-not-match-expected-commit'), true);
  assert.equal(result.reason.includes('origin-branch-stale-or-missing'), true);
});
