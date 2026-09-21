import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STARFIELD_VR_READINESS_OPERATION,
  executeStarfieldVrBattleBridgeCommand,
  validateStarfieldVrBattleBridgeCommandShape,
} from './starfieldVrBattleBridgeMailboxV1.mjs';

const HEAD = 'a'.repeat(40);
const LAUNCHER_BLOB = '5'.repeat(40);
const DECISION_BLOB = '7'.repeat(40);
const POLICY_BLOB = '8'.repeat(40);
const ENV = { USERPROFILE: 'C:\\Users\\Stephan', SystemRoot: 'C:\\Windows' };
const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'starfield-vr-readiness-20260921',
    operation: STARFIELD_VR_READINESS_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2158,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-09-21T14:00:00.000Z',
    ...overrides,
  };
}

function success(stdout, status = 0) {
  return { status, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '', error: null };
}

function harness({ readiness, status = 0, workingBlob = LAUNCHER_BLOB, decisionWorkingBlob = DECISION_BLOB, policyWorkingBlob = POLICY_BLOB } = {}) {
  const calls = [];
  return {
    calls,
    spawnSyncFn(executable, args, options) {
      calls.push({ executable, args, options });
      if (executable === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return success(`${HEAD}\n`);
      if (executable === 'git' && args[0] === 'ls-remote') return success(`${HEAD}\trefs/heads/main\n`);
      if (executable === 'git' && args[0] === 'rev-parse' && /launch-starfield-vr\.ps1$/.test(args[1])) return success(`${LAUNCHER_BLOB}\n`);
      if (executable === 'git' && args[0] === 'rev-parse' && /starfield-vr-launch-decision\.mjs$/.test(args[1])) return success(`${DECISION_BLOB}\n`);
      if (executable === 'git' && args[0] === 'rev-parse' && /starfieldVrLaunchPolicy\.mjs$/.test(args[1])) return success(`${POLICY_BLOB}\n`);
      if (executable === 'git' && args[0] === 'hash-object' && /launch-starfield-vr\.ps1$/i.test(args.at(-1))) return success(`${workingBlob}\n`);
      if (executable === 'git' && args[0] === 'hash-object' && /starfield-vr-launch-decision\.mjs$/i.test(args.at(-1))) return success(`${decisionWorkingBlob}\n`);
      if (executable === 'git' && args[0] === 'hash-object' && /starfieldVrLaunchPolicy\.mjs$/i.test(args.at(-1))) return success(`${policyWorkingBlob}\n`);
      if (executable === POWERSHELL) return success(readiness, status);
      throw new Error(`unexpected invocation ${executable} ${JSON.stringify(args)}`);
    },
  };
}

test('fixed readiness operation admits only the canonical closed-world envelope', () => {
  assert.equal(validateStarfieldVrBattleBridgeCommandShape(command()).ok, true);
  const override = validateStarfieldVrBattleBridgeCommandShape(command({ profilePath: 'C:\\unsafe.json' }));
  assert.equal(override.ok, false);
  assert.equal(override.blocker, 'STARFIELD_VR_FIELD_NOT_ALLOWED');
});

test('fixed readiness operation proves ready without granting launch authority', async () => {
  const run = harness({ readiness: { verdict: 'STARFIELD_VR_LAUNCH_READY', decision: { ok: true, action: 'LAUNCH_MUTAR_OPENXR', selectedProvider: 'mutar-openxr', blockers: [], warnings: [] }, receiptPath: 'C:\\Users\\Stephan\\Documents\\Stephanos-openclaw-workspace\\vr\\starfield-vr-launch-receipts\\proof.json' } });
  const result = await executeStarfieldVrBattleBridgeCommand(command(), { platform: 'win32', env: ENV, nodeExecutable: NODE, existsSyncFn: () => true, spawnSyncFn: run.spawnSyncFn });
  assert.equal(result.ok, true);
  assert.equal(result.launchReady, true);
  assert.equal(result.finalVerdict, 'STARFIELD_VR_LAUNCH_READY');
  assert.equal(result.selectedProvider, 'mutar-openxr');
  assert.equal(result.launchAllowed, false);
  assert.equal(result.providerMutationAllowed, false);
  assert.equal(result.profileOverrideAllowed, false);
  const readinessCall = run.calls.at(-1);
  assert.equal(readinessCall.executable, POWERSHELL);
  assert.equal(readinessCall.options.shell, false);
});

test('blocked readiness is durable evidence, not an execution failure or flat-game fallback', async () => {
  const run = harness({ status: 2, readiness: { ok: false, action: 'BLOCKED', blockers: ['verified-launch-profile-missing'], warnings: [] } });
  const result = await executeStarfieldVrBattleBridgeCommand(command(), { platform: 'win32', env: ENV, nodeExecutable: NODE, existsSyncFn: () => true, spawnSyncFn: run.spawnSyncFn });
  assert.equal(result.ok, true);
  assert.equal(result.launchReady, false);
  assert.equal(result.finalVerdict, 'STARFIELD_VR_LAUNCH_BLOCKED');
  assert.deepEqual(result.blockers, ['verified-launch-profile-missing']);
  assert.equal(result.launchAllowed, false);
});

test('dirty readiness launcher bytes fail closed before PowerShell executes', async () => {
  const run = harness({ workingBlob: '6'.repeat(40), readiness: { verdict: 'STARFIELD_VR_LAUNCH_READY', decision: { ok: true } } });
  const result = await executeStarfieldVrBattleBridgeCommand(command(), { platform: 'win32', env: ENV, nodeExecutable: NODE, existsSyncFn: () => true, spawnSyncFn: run.spawnSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'STARFIELD_VR_EXECUTED_SCRIPT_DIRTY');
  assert.equal(run.calls.some((entry) => entry.executable === POWERSHELL), false);
});

test('dirty readiness decision dependency fails closed before PowerShell executes', async () => {
  const run = harness({ decisionWorkingBlob: '9'.repeat(40), readiness: { verdict: 'STARFIELD_VR_LAUNCH_READY', decision: { ok: true } } });
  const result = await executeStarfieldVrBattleBridgeCommand(command(), { platform: 'win32', env: ENV, nodeExecutable: NODE, existsSyncFn: () => true, spawnSyncFn: run.spawnSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'STARFIELD_VR_EXECUTED_SCRIPT_DIRTY');
  assert.equal(run.calls.some((entry) => entry.executable === POWERSHELL), false);
});

test('dirty readiness policy dependency fails closed before PowerShell executes', async () => {
  const run = harness({ policyWorkingBlob: '9'.repeat(40), readiness: { verdict: 'STARFIELD_VR_LAUNCH_READY', decision: { ok: true } } });
  const result = await executeStarfieldVrBattleBridgeCommand(command(), { platform: 'win32', env: ENV, nodeExecutable: NODE, existsSyncFn: () => true, spawnSyncFn: run.spawnSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'STARFIELD_VR_EXECUTED_SCRIPT_DIRTY');
  assert.equal(run.calls.some((entry) => entry.executable === POWERSHELL), false);
});
