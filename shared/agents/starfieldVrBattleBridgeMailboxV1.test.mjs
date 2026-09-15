import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STARFIELD_VR_DELIVERY_STATUS_OPERATION,
  STARFIELD_VR_SHORTCUT_INSTALL_OPERATION,
  executeStarfieldVrBattleBridgeCommand,
  projectStarfieldVrBattleBridgeCommand,
  validateStarfieldVrBattleBridgeCommandShape,
} from './starfieldVrBattleBridgeMailboxV1.mjs';

const HEAD = 'a'.repeat(40);
const ENV = { USERPROFILE: 'C:\\Users\\Stephan', SystemRoot: 'C:\\Windows' };
const NODE = 'C:\\Program Files\\nodejs\\node.exe';

function command(operation = STARFIELD_VR_DELIVERY_STATUS_OPERATION, overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'starfield-vr-status-20260915',
    operation,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-09-15T22:00:00.000Z',
    ...overrides,
  };
}

function observation(overrides = {}) {
  return {
    schemaVersion: 'stephanos.starfield-vr-local-delivery-observation.v1',
    observedAtUtc: '2026-09-15T20:00:00.000Z',
    desktopIconPresent: false,
    splashWrapperPresent: true,
    shortcutTargetPath: '',
    shortcutArguments: '',
    shortcutRoutesThroughSplash: false,
    installerReceiptPresent: false,
    installerReceiptVerdict: '',
    installedSourceHead: HEAD,
    ...overrides,
  };
}

function success(stdout) {
  return { status: 0, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '', error: null };
}

test('Starfield VR commands require exact-head closed-world envelope and forbid caller paths', () => {
  assert.equal(validateStarfieldVrBattleBridgeCommandShape(command()).ok, true);
  const missingHead = validateStarfieldVrBattleBridgeCommandShape(command(undefined, { expectedHead: '' }));
  assert.equal(missingHead.ok, false);
  assert.equal(missingHead.blocker, 'STARFIELD_VR_EXPECTED_HEAD_REQUIRED');
  for (const field of ['path', 'script', 'command', 'executable', 'args', 'profilePath', 'pid']) {
    const verdict = validateStarfieldVrBattleBridgeCommandShape(command(undefined, { [field]: 'unsafe' }));
    assert.equal(verdict.ok, false, field);
    assert.equal(verdict.blocker, 'STARFIELD_VR_FIELD_NOT_ALLOWED', field);
    assert.equal(verdict.field, field);
  }
});

test('projection preserves only the ordinary canonical command envelope', () => {
  const projected = projectStarfieldVrBattleBridgeCommand(command());
  assert.equal(projected.ok, true);
  assert.deepEqual(Object.keys(projected.command).sort(), [
    'branch', 'expectedHead', 'expiresAt', 'issueNumber', 'operation', 'operatorApproval',
    'repository', 'requestId', 'schemaVersion',
  ]);
  assert.equal(projected.command.expectedHead, HEAD);
});

test('read operation observes physical shortcut truth without mutation', async () => {
  const calls = [];
  const result = await executeStarfieldVrBattleBridgeCommand(command(), {
    platform: 'win32',
    env: ENV,
    nodeExecutable: NODE,
    existsSyncFn: () => true,
    spawnSyncFn: (executable, args, options) => {
      calls.push({ executable, args, options });
      if (executable === 'git') return success(`${HEAD}\n`);
      if (executable === NODE) return success(observation());
      throw new Error(`unexpected executable ${executable}`);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'STARFIELD_VR_DELIVERY_STATUS_READ');
  assert.equal(result.installed, false);
  assert.equal(result.observation.desktopIconPresent, false);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ['rev-parse', 'HEAD']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[1].executable, NODE);
  assert.equal(calls[1].args.length, 1);
  assert.match(calls[1].args[0], /starfield-vr-delivery-truth-probe\.mjs$/i);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.arbitraryPowerShellAllowed, false);
  assert.equal(result.arbitraryPathAllowed, false);
  assert.equal(result.profileOverrideAllowed, false);
  assert.equal(result.launchAllowed, false);
});

test('install operation invokes only the fixed installer then requires physical delivery proof', async () => {
  const calls = [];
  const installed = observation({
    desktopIconPresent: true,
    splashWrapperPresent: true,
    shortcutRoutesThroughSplash: true,
    installerReceiptPresent: true,
    installerReceiptVerdict: 'STARFIELD_VR_SHORTCUT_INSTALLED',
  });
  const result = await executeStarfieldVrBattleBridgeCommand(command(STARFIELD_VR_SHORTCUT_INSTALL_OPERATION), {
    platform: 'win32',
    env: ENV,
    nodeExecutable: NODE,
    existsSyncFn: () => true,
    spawnSyncFn: (executable, args, options) => {
      calls.push({ executable, args, options });
      if (executable === 'git') return success(`${HEAD}\n`);
      if (/powershell\.exe$/i.test(executable)) {
        return success({
          schemaVersion: 'stephanos.starfield-vr-shortcut-install.v1',
          shortcutName: 'Starfield VR',
          created: true,
          finalVerdict: 'STARFIELD_VR_SHORTCUT_INSTALLED',
        });
      }
      if (executable === NODE) return success(installed);
      throw new Error(`unexpected executable ${executable}`);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.installed, true);
  assert.equal(result.finalVerdict, 'STARFIELD_VR_SHORTCUT_INSTALL_PROVEN');
  assert.equal(calls.length, 3);
  const powerShellCall = calls[1];
  assert.match(powerShellCall.executable, /WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.deepEqual(powerShellCall.args.slice(0, 5), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
  ]);
  assert.equal(powerShellCall.args.length, 6);
  assert.match(powerShellCall.args[5], /install-starfield-vr-desktop-shortcut\.ps1$/i);
  assert.equal(powerShellCall.options.shell, false);
  assert.equal(powerShellCall.args.some((value) => /profilepath/i.test(value)), false);
  assert.equal(result.providerMutationAllowed, false);
  assert.equal(result.sourceMutationAllowed, false);
});

test('exact-head mismatch blocks before any Windows mutation', async () => {
  const otherHead = 'b'.repeat(40);
  const calls = [];
  const result = await executeStarfieldVrBattleBridgeCommand(command(STARFIELD_VR_SHORTCUT_INSTALL_OPERATION), {
    platform: 'win32',
    env: ENV,
    nodeExecutable: NODE,
    existsSyncFn: () => true,
    spawnSyncFn: (executable, args, options) => {
      calls.push({ executable, args, options });
      return success(`${otherHead}\n`);
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'STARFIELD_VR_LOCAL_HEAD_MISMATCH');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, 'git');
});

test('installer receipt alone cannot claim delivery when filesystem probe is not ready', async () => {
  const result = await executeStarfieldVrBattleBridgeCommand(command(STARFIELD_VR_SHORTCUT_INSTALL_OPERATION), {
    platform: 'win32',
    env: ENV,
    nodeExecutable: NODE,
    existsSyncFn: () => true,
    spawnSyncFn: (executable) => {
      if (executable === 'git') return success(`${HEAD}\n`);
      if (/powershell\.exe$/i.test(executable)) {
        return success({
          schemaVersion: 'stephanos.starfield-vr-shortcut-install.v1',
          shortcutName: 'Starfield VR',
          created: true,
          finalVerdict: 'STARFIELD_VR_SHORTCUT_INSTALLED',
        });
      }
      return success(observation({ installerReceiptPresent: true, installerReceiptVerdict: 'STARFIELD_VR_SHORTCUT_INSTALLED' }));
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'STARFIELD_VR_SHORTCUT_INSTALL_NOT_PROVEN');
});
