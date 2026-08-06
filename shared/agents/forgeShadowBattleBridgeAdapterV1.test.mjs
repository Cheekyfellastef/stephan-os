import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  FORGE_SHADOW_BATTLE_BRIDGE_BOUNDARY,
  FORGE_SHADOW_BATTLE_BRIDGE_OPERATION,
  FORGE_SHADOW_BATTLE_BRIDGE_VERSION,
  executeForgeShadowM2OnBattleBridge,
  forgeShadowBattleBridgeFields,
  validateForgeShadowBattleBridgeCommand,
} from './forgeShadowBattleBridgeAdapterV1.mjs';

const HEAD = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'forge-m2-test-request',
    operation: FORGE_SHADOW_BATTLE_BRIDGE_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    forgejoVersion: FORGE_SHADOW_BATTLE_BRIDGE_VERSION,
    forgejoImageDigest: DIGEST,
    runtimeBoundary: FORGE_SHADOW_BATTLE_BRIDGE_BOUNDARY,
    m2Only: true,
    expiresAt: '2026-08-07T01:00:00.000Z',
    ...overrides,
  };
}

function readyReceipt(overrides = {}) {
  return {
    schemaVersion: 'stephanos.forge-shadow-podman-install-receipt.v1',
    ok: true,
    status: 'FORGE_SHADOW_M2_READY',
    repository: 'Cheekyfellastef/stephan-os',
    expectedHead: HEAD,
    imageDigest: DIGEST,
    forgejoVersion: '15.0.6',
    listener: '127.0.0.1:3340',
    mirrorHead: HEAD,
    mirrorTree: 'c'.repeat(40),
    exactObjectParity: true,
    exactTreeParity: true,
    readOnlySealed: true,
    rootFilesystemReadOnly: true,
    allCapabilitiesDropped: true,
    noNewPrivileges: true,
    persistentWritableSurface: '/var/lib/gitea',
    boundedEphemeralWritableSurfaces: ['/run', '/tmp', '/var/tmp'],
    automaticMirrorUpdatesEnabled: false,
    githubCredentialUsed: false,
    bootstrapTokenRevoked: true,
    credentialPersisted: false,
    credentialLogged: false,
    backupDigest: 'd'.repeat(64),
    backupVolume: 'stephanos-forge-shadow-backup-deadbeefdeadbeef',
    restoreDrillPassed: true,
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    publicExposure: false,
    tailscaleExposure: false,
    runnerRegistration: false,
    actionsExecution: false,
    mergeAuthority: false,
    readyForM3: true,
    ...overrides,
  };
}

test('adapter exposes only four operation-specific command fields', () => {
  assert.deepEqual(forgeShadowBattleBridgeFields(), [
    'forgejoVersion',
    'forgejoImageDigest',
    'runtimeBoundary',
    'm2Only',
  ]);
});

test('exact bounded Forge M2 command validates', () => {
  const result = validateForgeShadowBattleBridgeCommand(command());
  assert.equal(result.ok, true);
  assert.equal(result.command.forgejoVersion, '15.0.6');
  assert.equal(result.command.forgejoImageDigest, DIGEST);
  assert.equal(result.command.runtimeBoundary, 'podman-wsl-rootless');
  assert.equal(result.command.m2Only, true);
});

test('wrong repository, head, version, digest, boundary or M2 posture fail closed', () => {
  for (const candidate of [
    command({ repository: 'other/repo' }),
    command({ expectedHead: 'short' }),
    command({ forgejoVersion: '15.0.5' }),
    command({ forgejoImageDigest: 'forgejo:latest' }),
    command({ runtimeBoundary: 'docker-rootful' }),
    command({ m2Only: false }),
  ]) {
    assert.equal(validateForgeShadowBattleBridgeCommand(candidate).ok, false);
  }
});

test('generic execution, path, network and credential fields are rejected', () => {
  for (const field of [
    'command', 'executable', 'args', 'shell', 'powershell', 'script', 'path', 'url',
    'environment', 'token', 'credential', 'cookie', 'session', 'privateKey', 'javascript',
  ]) {
    const result = validateForgeShadowBattleBridgeCommand(command({ [field]: 'unsafe' }));
    assert.equal(result.ok, false, field);
    assert.equal(result.blocker, 'FORGE_SHADOW_COMMAND_UNSAFE_FIELD_PRESENT');
  }
});

test('executor is Windows-only and requires fixed local source', async () => {
  const linux = await executeForgeShadowM2OnBattleBridge(command(), { platform: 'linux' });
  assert.equal(linux.ok, false);
  assert.equal(linux.blocker, 'FORGE_SHADOW_WINDOWS_REQUIRED');

  const missing = await executeForgeShadowM2OnBattleBridge(command(), {
    platform: 'win32',
    repositoryRoot: join(tmpdir(), 'missing-forge-shadow-repo'),
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.blocker, 'FORGE_SHADOW_LOCAL_SOURCE_MISSING');
});

test('executor rebinds exact main head before and after fixed installer execution', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-shadow-adapter-'));
  mkdirSync(join(root, 'scripts', 'windows'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'windows', 'install-forge-shadow-podman-v1.ps1'), '# test fixture\n');
  const calls = [];
  let gitReadCount = 0;
  const result = await executeForgeShadowM2OnBattleBridge(command(), {
    platform: 'win32',
    repositoryRoot: root,
    runCommand(executable, args) {
      calls.push({ executable, args: [...args] });
      if (args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' };
      if (args[0] === 'rev-parse') {
        gitReadCount += 1;
        return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
      }
      if (args.includes('-File')) return { status: 0, stdout: JSON.stringify(readyReceipt()), stderr: '' };
      return { status: 1, stdout: '', stderr: 'unexpected' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'FORGE_SHADOW_M2_READY');
  assert.equal(result.readyForM3, true);
  assert.equal(gitReadCount, 2);
  const powershellCall = calls.find((call) => call.args.includes('-File'));
  assert.ok(powershellCall);
  assert.deepEqual(powershellCall.args.slice(0, 4), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass']);
  assert.ok(powershellCall.args.includes('-ExpectedHead'));
  assert.ok(powershellCall.args.includes(HEAD));
  assert.ok(powershellCall.args.includes('-ForgejoImageDigest'));
  assert.ok(powershellCall.args.includes(DIGEST));
  assert.ok(powershellCall.args.includes('-OperatorApproved'));
});

test('pre-install source movement blocks before PowerShell is called', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-shadow-adapter-head-'));
  mkdirSync(join(root, 'scripts', 'windows'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'windows', 'install-forge-shadow-podman-v1.ps1'), '# test fixture\n');
  let powershellCalled = false;
  const result = await executeForgeShadowM2OnBattleBridge(command(), {
    platform: 'win32',
    repositoryRoot: root,
    runCommand(_executable, args) {
      if (args.includes('-File')) powershellCalled = true;
      if (args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' };
      if (args[0] === 'rev-parse') return { status: 0, stdout: `${'c'.repeat(40)}\n`, stderr: '' };
      return { status: 1, stdout: '', stderr: '' };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'FORGE_SHADOW_SOURCE_IDENTITY_CHANGED');
  assert.equal(powershellCalled, false);
});

test('installer failure or malformed output is not promoted to M2 ready', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-shadow-adapter-fail-'));
  mkdirSync(join(root, 'scripts', 'windows'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'windows', 'install-forge-shadow-podman-v1.ps1'), '# test fixture\n');

  for (const installerResult of [
    { status: 1, stdout: '', stderr: 'failed' },
    { status: 0, stdout: '{bad', stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ restoreDrillPassed: false })), stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ rootFilesystemReadOnly: false })), stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ githubCredentialUsed: true })), stderr: '' },
  ]) {
    const result = await executeForgeShadowM2OnBattleBridge(command(), {
      platform: 'win32',
      repositoryRoot: root,
      runCommand(_executable, args) {
        if (args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' };
        if (args[0] === 'rev-parse') return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
        if (args.includes('-File')) return installerResult;
        return { status: 1, stdout: '', stderr: '' };
      },
    });
    assert.equal(result.ok, false);
  }
});

test('success result is sanitized and contains no token or arbitrary authority', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-shadow-adapter-safe-'));
  mkdirSync(join(root, 'scripts', 'windows'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'windows', 'install-forge-shadow-podman-v1.ps1'), '# test fixture\n');
  const result = await executeForgeShadowM2OnBattleBridge(command(), {
    platform: 'win32',
    repositoryRoot: root,
    runCommand(_executable, args) {
      if (args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' };
      if (args[0] === 'rev-parse') return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
      return { status: 0, stdout: JSON.stringify(readyReceipt()), stderr: '' };
    },
  });
  const serialized = JSON.stringify(result);
  assert.equal(result.githubCredentialUsed, false);
  assert.equal(result.credentialPersisted, false);
  assert.equal(result.credentialLogged, false);
  assert.equal(result.runnerRegistration, false);
  assert.equal(result.mergeAuthority, false);
  assert.doesNotMatch(serialized, /token|password|cookie|session|authorization/i);
});
