import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_BRIDGE_PREFLIGHT_PROOF_COMMAND,
  VERIFICATION_STATUS,
  aggregateVerificationResults,
  runBattleBridgePreflightVerifier,
  runOpenClawGatewayVerifier,
  runProofPacketVerifier,
  runVerificationHarness,
  validateVerifierResult,
} from './verificationHarness.mjs';

test('proof packet verifiers pass with deterministic evidence', () => {
  const result = runProofPacketVerifier('GitVerifier', {
    repoClean: true,
    headMatchesOrigin: true,
    branch: 'main',
    head: 'abc123',
  });

  assert.equal(result.status, VERIFICATION_STATUS.PASS);
  assert.equal(validateVerifierResult(result).valid, true);
  assert.equal(result.evidence.includes('repoClean=true'), true);
});

test('unknown verifier names fail closed', () => {
  const result = runProofPacketVerifier('UnknownVerifier', { pass: true });

  assert.equal(result.status, VERIFICATION_STATUS.FAIL);
  assert.equal(result.reason, 'unknown verifier name failed closed');
});

test('generic pass bit does not override verifier-specific failure proof', () => {
  const gitResult = runProofPacketVerifier('GitVerifier', {
    pass: true,
    repoClean: false,
    headMatchesOrigin: true,
  });
  const backendResult = runProofPacketVerifier('BackendVerifier', {
    pass: true,
    backendHealth: 'fail',
    httpStatus: 503,
  });

  assert.equal(gitResult.status, VERIFICATION_STATUS.FAIL);
  assert.equal(backendResult.status, VERIFICATION_STATUS.FAIL);
});

test('OpenClaw gateway rejects readonly adapter fixture', () => {
  const result = runOpenClawGatewayVerifier({
    endpoint: 'http://127.0.0.1:8790/health',
    httpStatus: 200,
    endpointIdentity: 'openclaw-readonly-adapter-stub',
    mode: 'readonly_status_only',
    executionAllowed: false,
    canExecute: false,
  });

  assert.equal(result.status, VERIFICATION_STATUS.FAIL);
  assert.equal(result.reason, 'OPENCLAW_READONLY_ADAPTER_ONLY');
});

test('OpenClaw gateway accepts executable gateway fixture', () => {
  const result = runOpenClawGatewayVerifier({
    endpoint: 'http://127.0.0.1:18789/health',
    httpStatus: 200,
    endpointIdentity: 'openclaw-executable-gateway',
    executionAllowed: true,
    canExecute: true,
    portOwnerVerified: true,
    processIdentityVerified: true,
  });

  assert.equal(result.status, VERIFICATION_STATUS.PASS);
  assert.equal(result.evidence.includes('finalVerdict=OPENCLAW_GATEWAY_VERIFIED'), true);
});

test('OpenClaw gateway requires explicit owner proof before pass', () => {
  const result = runOpenClawGatewayVerifier({
    endpoint: 'http://127.0.0.1:18789/health',
    httpStatus: 200,
    endpointIdentity: 'openclaw-executable-gateway',
    executionAllowed: true,
    canExecute: true,
  });

  assert.equal(result.status, VERIFICATION_STATUS.FAIL);
  assert.equal(result.reason, 'OPENCLAW_GATEWAY_UNVERIFIED_OWNER');
  assert.equal(result.evidence.includes('portOwnerVerified=unknown'), true);
  assert.equal(result.evidence.includes('processIdentityVerified=unknown'), true);
});

test('PluginVerifier requires explicit target plugin source evidence', () => {
  const result = runProofPacketVerifier('PluginVerifier', { pass: true });

  assert.equal(result.status, VERIFICATION_STATUS.FAIL);
  assert.equal(result.reason, 'PluginVerifier proof packet blocked');
  assert.equal(result.evidence.includes('targetPluginSourcePresent=unknown'), true);
});

test('Battle Bridge preflight blocks on missing proof', () => {
  const result = runBattleBridgePreflightVerifier({
    repoClean: true,
    headMatchesOrigin: true,
    sourcePresent: false,
    backendHealth: 'fail',
    missionWorker: 'stopped',
    safeToBuild: false,
    safeToInstall: false,
    safeToRepair: false,
  });

  assert.equal(result.status, VERIFICATION_STATUS.FAIL);
  assert.equal(result.evidence.some((line) => line.includes('BATTLE_BRIDGE_PREFLIGHT_BLOCKED')), true);
});

test('Battle Bridge preflight passes with all required read-only proof', () => {
  const result = runBattleBridgePreflightVerifier({
    repoClean: true,
    headMatchesOrigin: true,
    sourcePresent: true,
    targetPluginSourcePresent: true,
    backendHealth: 'pass',
    missionWorker: 'running',
    stephanosBackendTask: 'ready',
    safeToBuild: true,
    safeToInstall: true,
    safeToRepair: true,
    openClawGateway: {
      httpStatus: 200,
      endpointIdentity: 'openclaw-executable-gateway',
      executionAllowed: true,
      canExecute: true,
      portOwnerVerified: true,
      processIdentityVerified: true,
    },
  });

  assert.equal(result.status, VERIFICATION_STATUS.PASS);
  assert.equal(result.evidence.some((line) => line.includes('BATTLE_BRIDGE_PREFLIGHT_PASS')), true);
});

test('aggregate emits Shared Agent Workspace proof/status projection', () => {
  const aggregate = aggregateVerificationResults({
    aggregateId: 'verification-proof',
    checks: [runProofPacketVerifier('BuildVerifier', { buildPassed: true, sourceOnly: true })],
  });

  assert.equal(aggregate.status, VERIFICATION_STATUS.PASS);
  assert.equal(aggregate.overall, 'VERIFIED');
  assert.equal(aggregate.workspaceMessage.eventKind, 'verification-result');
  assert.equal(aggregate.workspaceMessage.status, 'verified');
});

test('harness blocks success without verifier evidence', () => {
  const aggregate = aggregateVerificationResults({
    aggregateId: 'empty-pass',
    checks: [{ checkId: 'empty', verifierType: 'BuildVerifier', status: 'PASS', evidence: [] }],
  });

  assert.equal(aggregate.status, VERIFICATION_STATUS.FAIL);
  assert.equal(aggregate.blockers.includes('empty: PASS'), true);
});

test('runVerificationHarness executes only allowlisted proof packet verifiers', () => {
  const aggregate = runVerificationHarness({
    aggregateId: 'safe-source-slice',
    verifiers: ['BuildVerifier', 'BackendVerifier'],
    packets: {
      BuildVerifier: { buildPassed: true, sourceOnly: true },
      BackendVerifier: { backendHealth: 'pass', httpStatus: 200 },
    },
  });

  assert.equal(aggregate.status, VERIFICATION_STATUS.PASS);
  assert.equal(BATTLE_BRIDGE_PREFLIGHT_PROOF_COMMAND, 'node --test shared/agents/verificationHarness*.test.mjs shared/agents/*Verifier*.test.mjs');
});
