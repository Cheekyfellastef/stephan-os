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
const INSTALLER_BLOB = '1'.repeat(40);
const PROBE_BLOB = '2'.repeat(40);
const ENV = { USERPROFILE: 'C:\\Users\\Stephan', SystemRoot: 'C:\\Windows' };
const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const SPLASH = 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os\\scripts\\windows\\launch-starfield-vr-with-splash.ps1';
const PROFILE = 'C:\\Users\\Stephan\\Documents\\Stephanos-openclaw-workspace\\vr\\starfield-vr-launch-profile.json';
const EXPECTED_ARGUMENTS = `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${SPLASH}" -ProfilePath "${PROFILE}"`;

function command(operation = STARFIELD_VR_DELIVERY_STATUS_OPERATION, overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'starfield-vr-status-20260916',
    operation,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2158,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-09-16T04:00:00.000Z',
    ...overrides,
  };
}

function observation(overrides = {}) {
  return {
    schemaVersion: 'stephanos.starfield-vr-local-delivery-observation.v1',
    observedAtUtc: '2026-09-16T00:30:00.000Z',
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

function shortcutInspection(overrides = {}) {
  return {
    present: true,
    shortcutPath: 'C:\\Users\\Stephan\\Desktop\\Starfield VR.lnk',
    targetPath: POWERSHELL,
    arguments: EXPECTED_ARGUMENTS,
    ...overrides,
  };
}

function success(stdout) {
  return { status: 0, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '', error: null };
}

function gitResult(args, overrides = {}) {
  if (args[0] === 'rev-parse' && args[1] === 'HEAD') return success(`${HEAD}\n`);
  if (args[0] === 'rev-parse' && /install-starfield-vr-desktop-shortcut\.ps1$/.test(args[1])) {
    return success(`${overrides.installerCommittedBlob || INSTALLER_BLOB}\n`);
  }
  if (args[0] === 'rev-parse' && /starfield-vr-delivery-truth-probe\.mjs$/.test(args[1])) {
    return success(`${overrides.probeCommittedBlob || PROBE_BLOB}\n`);
  }
  if (args[0] === 'hash-object' && /install-starfield-vr-desktop-shortcut\.ps1$/i.test(args.at(-1))) {
    return success(`${overrides.installerWorkingBlob || INSTALLER_BLOB}\n`);
  }
  if (args[0] === 'hash-object' && /starfield-vr-delivery-truth-probe\.mjs$/i.test(args.at(-1))) {
    return success(`${overrides.probeWorkingBlob || PROBE_BLOB}\n`);
  }
  throw new Error(`unexpected git args ${JSON.stringify(args)}`);
}

function spawnHarness({ installed = false, shortcut = shortcutInspection(), gitOverrides = {} } = {}) {
  const calls = [];
  const probeObservation = observation(installed ? {
    desktopIconPresent: true,
    splashWrapperPresent: true,
    shortcutRoutesThroughSplash: true,
    installerReceiptPresent: true,
    installerReceiptVerdict: 'STARFIELD_VR_SHORTCUT_INSTALLED',
  } : {});
  return {
    calls,
    spawnSyncFn(executable, args, options) {
      calls.push({ executable, args, options });
      if (executable === 'git') return gitResult(args, gitOverrides);
      if (executable === NODE) return success(probeObservation);
      if (/powershell\.exe$/i.test(executable) && args.includes('-File')) {
        return success({
          schemaVersion: 'stephanos.starfield-vr-shortcut-install.v1',
          shortcutName: 'Starfield VR',
          created: true,
          finalVerdict: 'STARFIELD_VR_SHORTCUT_INSTALLED',
        });
      }
      if (/powershell\.exe$/i.test(executable) && args.includes('-Command')) return success(shortcut);
      throw new Error(`unexpected executable ${executable}`);
    },
  };
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

test('read operation verifies committed probe bytes and inspects actual shortcut without mutation', async () => {
  const harness = spawnHarness();
  const result = await executeStarfieldVrBattleBridgeCommand(command(), {
    platform: 'win32', env: ENV, nodeExecutable: NODE, existsSyncFn: () => true, spawnSyncFn: harness.spawnSyncFn,
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'STARFIELD_VR_DELIVERY_STATUS_READ');
  assert.equal(result.installed, false);
  assert.equal(result.observation.desktopIconPresent, false);
  assert.equal(harness.calls.length, 5);
  assert.deepEqual(harness.calls[0].args, ['rev-parse', 'HEAD']);
  assert.deepEqual(harness.calls[1].args, ['rev-parse', `${HEAD}:scripts/starfield-vr-delivery-truth-probe.mjs`]);
  assert.deepEqual(harness.calls[2].args.slice(0, 3), ['hash-object', '--no-filters', '--']);
  assert.equal(harness.calls[3].executable, NODE);
  assert.equal(harness.calls[4].executable, POWERSHELL);
  assert.equal(harness.calls[4].args.includes('-Command'), true);
  assert.equal(harness.calls[4].options.shell, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.arbitraryPowerShellAllowed, false);
  assert.equal(result.arbitraryPathAllowed, false);
  assert.equal(result.profileOverrideAllowed, false);
  assert.equal(result.launchAllowed, false);
});

test('install operation verifies both scripts before mutation and requires actual shortcut route proof', async () => {
  const harness = spawnHarness({ installed: true });
  const result = await executeStarfieldVrBattleBridgeCommand(command(STARFIELD_VR_SHORTCUT_INSTALL_OPERATION), {
    platform: 'win32', env: ENV, nodeExecutable: NODE, existsSyncFn: () => true, spawnSyncFn: harness.spawnSyncFn,
  });
  assert.equal(result.ok, true);
  assert.equal(result.installed, true);
  assert.equal(result.finalVerdict, 'STARFIELD_VR_SHORTCUT_INSTALL_PROVEN');
  assert.equal(harness.calls.length, 8);
  const firstPowerShellIndex = harness.calls.findIndex((call) => /powershell\.exe$/i.test(call.executable));
  assert.equal(firstPowerShellIndex, 5);
  assert.equal(harness.calls.slice(0, firstPowerShellIndex).every((call) => call.executable === 'git'), true);
  const installerCall = harness.calls[firstPowerShellIndex];
  assert.deepEqual(installerCall.args.slice(0, 5), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
  ]);
  assert.equal(installerCall.args.length, 6);
  assert.match(installerCall.args[5], /install-starfield-vr-desktop-shortcut\.ps1$/i);
  assert.equal(result.observation.shortcutTargetPath, POWERSHELL);
  assert.equal(result.observation.shortcutArguments, EXPECTED_ARGUMENTS);
  assert.equal(result.observation.shortcutRoutesThroughSplash, true);
  assert.equal(result.providerMutationAllowed, false);
  assert.equal(result.sourceMutationAllowed, false);
});

test('exact-head mismatch blocks before script identity checks or Windows mutation', async () => {
  const otherHead = 'b'.repeat(40);
  const calls = [];
  const result = await executeStarfieldVrBattleBridgeCommand(command(STARFIELD_VR_SHORTCUT_INSTALL_OPERATION), {
    platform: 'win32', env: ENV, nodeExecutable: NODE, existsSyncFn: () => true,
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

test('dirty installer blocks before any PowerShell, probe or delivery proof execution', async () => {
  const harness = spawnHarness({ gitOverrides: { installerWorkingBlob: '3'.repeat(40) }, installed: true });
  const result = await executeStarfieldVrBattleBridgeCommand(command(STARFIELD_VR_SHORTCUT_INSTALL_OPERATION), {
    platform: 'win32', env: ENV, nodeExecutable: NODE, existsSyncFn: () => true, spawnSyncFn: harness.spawnSyncFn,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'STARFIELD_VR_EXECUTED_SCRIPT_DIRTY');
  assert.equal(result.script, 'scripts/windows/install-starfield-vr-desktop-shortcut.ps1');
  assert.equal(harness.calls.some((call) => /powershell\.exe$/i.test(call.executable)), false);
  assert.equal(harness.calls.some((call) => call.executable === NODE), false);
});

test('dirty probe blocks install before mutation so modified proof bytes cannot fabricate success', async () => {
  const harness = spawnHarness({ gitOverrides: { probeWorkingBlob: '4'.repeat(40) }, installed: true });
  const result = await executeStarfieldVrBattleBridgeCommand(command(STARFIELD_VR_SHORTCUT_INSTALL_OPERATION), {
    platform: 'win32', env: ENV, nodeExecutable: NODE, existsSyncFn: () => true, spawnSyncFn: harness.spawnSyncFn,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'STARFIELD_VR_EXECUTED_SCRIPT_DIRTY');
  assert.equal(result.script, 'scripts/starfield-vr-delivery-truth-probe.mjs');
  assert.equal(harness.calls.some((call) => /powershell\.exe$/i.test(call.executable)), false);
  assert.equal(harness.calls.some((call) => call.executable === NODE), false);
});

test('stale receipt and replaced shortcut cannot prove the splash route', async () => {
  const harness = spawnHarness({
    installed: true,
    shortcut: shortcutInspection({ targetPath: 'C:\\Windows\\System32\\notepad.exe', arguments: '' }),
  });
  const result = await executeStarfieldVrBattleBridgeCommand(command(STARFIELD_VR_SHORTCUT_INSTALL_OPERATION), {
    platform: 'win32', env: ENV, nodeExecutable: NODE, existsSyncFn: () => true, spawnSyncFn: harness.spawnSyncFn,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'STARFIELD_VR_SHORTCUT_INSTALL_NOT_PROVEN');
  assert.equal(result.observation.shortcutTargetPath, 'C:\\Windows\\System32\\notepad.exe');
  assert.equal(result.observation.shortcutRoutesThroughSplash, false);
});

test('installer receipt alone cannot claim delivery when filesystem probe is not ready', async () => {
  const harness = spawnHarness({ installed: false });
  const result = await executeStarfieldVrBattleBridgeCommand(command(STARFIELD_VR_SHORTCUT_INSTALL_OPERATION), {
    platform: 'win32', env: ENV, nodeExecutable: NODE, existsSyncFn: () => true,
    spawnSyncFn(executable, args, options) {
      if (executable === NODE) return success(observation({
        installerReceiptPresent: true,
        installerReceiptVerdict: 'STARFIELD_VR_SHORTCUT_INSTALLED',
      }));
      return harness.spawnSyncFn(executable, args, options);
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'STARFIELD_VR_SHORTCUT_INSTALL_NOT_PROVEN');
});
