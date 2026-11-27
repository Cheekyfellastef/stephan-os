import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_BRIDGE_PREFLIGHT_PROOF_COMMAND,
  OPENCLAW_GATEWAY_VERDICTS,
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

function publicationGuardPacket(overrides = {}) {
  const sha = 'a'.repeat(40);
  return {
    prNumber: 1462,
    headBranch: 'codex/rebuild-prpublicationverifier-change-from-scratch',
    expectedCommit: sha,
    remotePrHeadSha: sha,
    fetchedOriginBranchSha: sha,
    localHeadSha: sha,
    testedHeadSha: sha,
    prCommits: [sha],
    ...overrides,
  };
}

const publicationGuardOptions = { timestampUtc: '2026-11-21T08:40:00Z' };

function expectPublicationBlocked(packet, reason, options = publicationGuardOptions) {
  const result = runVerifier('PRPublicationVerifier', packet, options);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.finalVerdict, 'PR_PUBLICATION_VERIFIER_BLOCKED');
  assert.equal(result.reason.includes(reason), true, result.reason);
  assert.equal(validateVerifierResult(result).valid, true);
  return result;
}

test('PR publication constraints preserve absent-field callers and accept explicit read-only intent', () => {
  const packet = publicationGuardPacket();
  const constraints = {
    publishAllowed: false, publish: false, createPr: false, merge: false,
    targetExistingPr: true, expectedPr: '1462', expectedBranch: packet.headBranch,
  };
  for (const candidate of [packet, { ...packet, ...constraints }]) {
    const result = runVerifier('PRPublicationVerifier', candidate, publicationGuardOptions);
    assert.equal(result.status, 'PASS');
    assert.equal(validateVerifierResult(result).valid, true);
  }
  const result = runVerifier('PRPublicationVerifier', { ...packet, ...constraints }, {
    ...publicationGuardOptions, expectedPr: 1462, expectedBranch: packet.headBranch,
  });
  assert.equal(result.status, 'PASS');
  for (const field of ['targetExistingPr', 'publicationDisabled', 'expectedPrMatches', 'expectedBranchMatches']) {
    assert.equal(result.evidence.includes(`${field}=true`), true, field);
  }
});

test('PR publication verifier refuses every enabled or malformed publication intent flag', () => {
  for (const field of ['publishAllowed', 'publish', 'createPr', 'merge']) {
    for (const value of [true, undefined, null, 'true', 'false', 0, 1, {}, [], Symbol('invalid')]) {
      expectPublicationBlocked(publicationGuardPacket({ [field]: value }), 'publication-disabled');
    }
  }
});

test('PR publication verifier requires a true existing-PR constraint when supplied', () => {
  for (const value of [false, undefined, null, 'true', 0, 1, {}, [], Symbol('invalid')]) {
    expectPublicationBlocked(publicationGuardPacket({ targetExistingPr: value }), 'target-existing-pr-required');
  }
});

test('PR publication verifier validates packet and options expected identities without coercion', () => {
  const noCoercion = { toString() { throw new Error('Expected identity must not be coerced'); } };
  const cases = [
    ['expectedPr', 'pr-number-mismatch', [undefined, null, false, true, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '', '01462', '1462junk', '1462.0', ' 1462 ', '0', '9999', {}, [], Symbol('invalid'), noCoercion]],
    ['expectedBranch', 'branch-mismatch', [undefined, null, false, true, 0, '', 'other-branch', {}, [], Symbol('invalid'), noCoercion]],
  ];
  for (const [field, reason, values] of cases) {
    for (const value of values) {
      expectPublicationBlocked(publicationGuardPacket({ [field]: value }), reason);
      expectPublicationBlocked(publicationGuardPacket(), reason, { ...publicationGuardOptions, [field]: value });
    }
  }
});

test('PR publication verifier rejects conflicting expected identities instead of selecting an override', () => {
  const packet = publicationGuardPacket({ expectedPr: 1462, expectedBranch: 'codex/rebuild-prpublicationverifier-change-from-scratch' });
  expectPublicationBlocked(packet, 'pr-number-mismatch', { ...publicationGuardOptions, expectedPr: 9999 });
  expectPublicationBlocked(packet, 'branch-mismatch', { ...publicationGuardOptions, expectedBranch: 'other-branch' });
  expectPublicationBlocked({ ...packet, expectedPr: null }, 'pr-number-mismatch', { ...publicationGuardOptions, expectedPr: 1462 });
  expectPublicationBlocked(packet, 'branch-mismatch', { ...publicationGuardOptions, expectedBranch: undefined });
});

test('PR publication optional constraints require own data fields and never execute accessors', () => {
  const fields = {
    publishAllowed: false, publish: false, createPr: false, merge: false,
    targetExistingPr: true, expectedPr: 1462,
    expectedBranch: publicationGuardPacket().headBranch,
  };
  let getterCalls = 0;
  for (const [field, value] of Object.entries(fields)) {
    const reason = field === 'expectedPr' ? 'pr-number-mismatch'
      : field === 'expectedBranch' ? 'branch-mismatch'
        : field === 'targetExistingPr' ? 'target-existing-pr-required' : 'publication-disabled';
    const packet = publicationGuardPacket();
    Object.defineProperty(packet, field, { get() { getterCalls += 1; return value; } });
    expectPublicationBlocked(packet, reason);
    const inherited = Object.assign(Object.create({ [field]: value }), publicationGuardPacket());
    expectPublicationBlocked(inherited, reason);
    if (field === 'expectedPr' || field === 'expectedBranch') {
      const options = { ...publicationGuardOptions };
      Object.defineProperty(options, field, { get() { getterCalls += 1; return value; } });
      expectPublicationBlocked(publicationGuardPacket(), reason, options);
    }
  }
  assert.equal(getterCalls, 0);
});

test('PR publication read-only constraints cannot bypass canonical head agreement', () => {
  const packet = publicationGuardPacket({
    publishAllowed: false, targetExistingPr: true,
    expectedPr: 1462, expectedBranch: 'codex/rebuild-prpublicationverifier-change-from-scratch',
  });
  for (const [field, reason] of [
    ['expectedCommit', 'pr-head-does-not-match-expected-commit'],
    ['remotePrHeadSha', 'pr-head-does-not-match-expected-commit'],
    ['fetchedOriginBranchSha', 'origin-branch-stale-or-missing'],
    ['localHeadSha', 'local-head-is-not-pr-head'],
    ['testedHeadSha', 'tested-code-is-not-pr-code'],
  ]) expectPublicationBlocked({ ...packet, [field]: 'b'.repeat(40) }, reason);

  const legacyOnly = {
    prNumber: 1462, branch: packet.headBranch, remoteHead: packet.remotePrHeadSha,
    expectedPr: 1462, expectedBranch: packet.headBranch,
    expectedRemoteHead: packet.remotePrHeadSha, targetExistingPr: true, publishAllowed: false,
  };
  expectPublicationBlocked(legacyOnly, 'pr-head-does-not-match-expected-commit');
});

test('PR publication guard failures remain blocked through the reusable harness aggregator', () => {
  const aggregate = runVerificationHarness({
    ...publicationGuardOptions,
    aggregateId: 'pr-publication-read-only',
    verifiers: ['PRPublicationVerifier'],
    packets: { PRPublicationVerifier: publicationGuardPacket({ merge: true }) },
  });
  assert.equal(aggregate.status, 'BLOCKED');
  assert.equal(aggregate.overall, 'BLOCKED');
  assert.equal(aggregate.checks[0].status, 'BLOCKED');
});
