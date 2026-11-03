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
const TREE = 'c'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;
const INSTALLER_BLOB = 'e'.repeat(40);
const BACKUP_DIGEST = `deadbeefdeadbeef${'d'.repeat(48)}`;
const INSTALLER_PATH = 'scripts/windows/install-forge-shadow-podman-v1.ps1';

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
    canonicalTree: TREE,
    imageDigest: DIGEST,
    forgejoVersion: '15.0.6',
    podmanVersion: '6.0.2',
    windowsHostAdapter: 'podman-desktop-windows10-wsl2-v1',
    minimumWindowsBuild: 19043,
    observedWindowsBuild: 19045,
    observedWindowsProductName: 'Windows 10 Pro',
    observedWindowsInstallationType: 'Client',
    compatibilityAuthority: 'podman-desktop-v1.29.1-win32-x64-podman-v6.0.2',
    podmanDesktopVersion: '1.29.1',
    podmanDesktopSourceCommit: 'a969ee0e0b07285122dd4988a58edb0a1a25d5fc',
    podmanDesktopPodmanManifestBlob: '5acfedd1c3171414aa218a1d5d95ea7529687809',
    machine: 'stephanos-forge-shadow',
    podmanConnection: 'stephanos-forge-shadow',
    container: 'stephanos-forge-shadow',
    listener: '127.0.0.1:3340',
    mirrorHead: HEAD,
    mirrorTree: TREE,
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
    backupDigest: BACKUP_DIGEST,
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

function createFixtureRoot(prefix = 'forge-shadow-adapter-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'scripts', 'windows'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'windows', 'install-forge-shadow-podman-v1.ps1'), '# test fixture\n');
  return root;
}

function fixedSourceRead(args, { head = HEAD, tree = TREE, workingBlob = INSTALLER_BLOB } = {}) {
  if (args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' };
  if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { status: 0, stdout: `${head}\n`, stderr: '' };
  if (args[0] === 'rev-parse' && args[1] === `${HEAD}^{tree}`) return { status: 0, stdout: `${tree}\n`, stderr: '' };
  if (args[0] === 'rev-parse' && args[1] === `${HEAD}:${INSTALLER_PATH}`) {
    return { status: 0, stdout: `${INSTALLER_BLOB}\n`, stderr: '' };
  }
  if (args[0] === 'hash-object') return { status: 0, stdout: `${workingBlob}\n`, stderr: '' };
  return null;
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

test('executor rebinds exact main head, tree and installer blob before and after execution', async () => {
  const root = createFixtureRoot();
  const calls = [];
  let headReads = 0;
  let treeReads = 0;
  let blobReads = 0;
  const result = await executeForgeShadowM2OnBattleBridge(command(), {
    platform: 'win32',
    repositoryRoot: root,
    runCommand(executable, args) {
      calls.push({ executable, args: [...args] });
      const fixed = fixedSourceRead(args);
      if (fixed) {
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') headReads += 1;
        if (args[0] === 'rev-parse' && args[1] === `${HEAD}^{tree}`) treeReads += 1;
        if (args[0] === 'hash-object') blobReads += 1;
        return fixed;
      }
      if (args.includes('-File')) return { status: 0, stdout: JSON.stringify(readyReceipt()), stderr: '' };
      return { status: 1, stdout: '', stderr: 'unexpected' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'FORGE_SHADOW_M2_READY');
  assert.equal(result.windowsHostAdapter, 'podman-desktop-windows10-wsl2-v1');
  assert.equal(result.observedWindowsBuild, 19045);
  assert.equal(result.observedWindowsProductName, 'Windows 10 Pro');
  assert.equal(result.observedWindowsInstallationType, 'Client');
  assert.equal(result.readyForM3, true);
  assert.equal(result.canonicalTree, TREE);
  assert.equal(result.installerBlob, INSTALLER_BLOB);
  assert.equal(headReads, 2);
  assert.equal(treeReads, 2);
  assert.equal(blobReads, 2);
  const hashCall = calls.find((call) => call.args[0] === 'hash-object');
  assert.ok(hashCall.args.includes(`--path=${INSTALLER_PATH}`));
  const powershellCall = calls.find((call) => call.args.includes('-File'));
  assert.ok(powershellCall);
  assert.deepEqual(powershellCall.args.slice(0, 4), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass']);
  assert.ok(powershellCall.args.includes('-ExpectedHead'));
  assert.ok(powershellCall.args.includes(HEAD));
  assert.ok(powershellCall.args.includes('-ForgejoImageDigest'));
  assert.ok(powershellCall.args.includes(DIGEST));
  assert.ok(powershellCall.args.includes('-OperatorApproved'));
});

test('pre-install source head movement blocks before PowerShell is called', async () => {
  const root = createFixtureRoot('forge-shadow-adapter-head-');
  let powershellCalled = false;
  const result = await executeForgeShadowM2OnBattleBridge(command(), {
    platform: 'win32',
    repositoryRoot: root,
    runCommand(_executable, args) {
      if (args.includes('-File')) powershellCalled = true;
      const fixed = fixedSourceRead(args, { head: 'f'.repeat(40) });
      return fixed || { status: 1, stdout: '', stderr: '' };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'FORGE_SHADOW_SOURCE_IDENTITY_CHANGED');
  assert.equal(powershellCalled, false);
});

test('dirty or replaced installer blocks even when branch and HEAD remain exact', async () => {
  const root = createFixtureRoot('forge-shadow-adapter-dirty-');
  let powershellCalled = false;
  const result = await executeForgeShadowM2OnBattleBridge(command(), {
    platform: 'win32',
    repositoryRoot: root,
    runCommand(_executable, args) {
      if (args.includes('-File')) powershellCalled = true;
      const fixed = fixedSourceRead(args, { workingBlob: 'f'.repeat(40) });
      return fixed || { status: 1, stdout: '', stderr: '' };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'FORGE_SHADOW_SOURCE_IDENTITY_CHANGED');
  assert.equal(powershellCalled, false);
});

test('installer failure or malformed runtime identity is not promoted to M2 ready', async () => {
  const root = createFixtureRoot('forge-shadow-adapter-fail-');
  for (const installerResult of [
    { status: 1, stdout: '', stderr: 'failed' },
    { status: 0, stdout: '{bad', stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ restoreDrillPassed: false })), stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ rootFilesystemReadOnly: false })), stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ githubCredentialUsed: true })), stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ podmanVersion: '6.0.1' })), stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ listener: '0.0.0.0:3340' })), stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ machine: 'default' })), stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ podmanConnection: 'default' })), stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ container: 'other' })), stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ mirrorHead: 'f'.repeat(40) })), stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ canonicalTree: 'f'.repeat(40) })), stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ mirrorTree: 'f'.repeat(40) })), stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ backupDigest: 'f'.repeat(64) })), stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ backupVolume: '../unsafe' })), stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ observedWindowsProductName: 'Windows Server 2022 Standard' })), stderr: '' },
    { status: 0, stdout: JSON.stringify(readyReceipt({ observedWindowsInstallationType: 'Server' })), stderr: '' },
  ]) {
    const result = await executeForgeShadowM2OnBattleBridge(command(), {
      platform: 'win32',
      repositoryRoot: root,
      runCommand(_executable, args) {
        const fixed = fixedSourceRead(args);
        if (fixed) return fixed;
        if (args.includes('-File')) return installerResult;
        return { status: 1, stdout: '', stderr: '' };
      },
    });
    assert.equal(result.ok, false);
  }
});

test('post-install installer or exact tree drift invalidates an otherwise ready receipt', async () => {
  const root = createFixtureRoot('forge-shadow-adapter-post-drift-');
  let installerRan = false;
  const result = await executeForgeShadowM2OnBattleBridge(command(), {
    platform: 'win32',
    repositoryRoot: root,
    runCommand(_executable, args) {
      if (args.includes('-File')) {
        installerRan = true;
        return { status: 0, stdout: JSON.stringify(readyReceipt()), stderr: '' };
      }
      if (args[0] === 'rev-parse' && args[1] === `${HEAD}^{tree}`) {
        return { status: 0, stdout: `${installerRan ? 'f'.repeat(40) : TREE}\n`, stderr: '' };
      }
      const fixed = fixedSourceRead(args);
      return fixed || { status: 1, stdout: '', stderr: '' };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(installerRan, true);
  assert.equal(result.blocker, 'FORGE_SHADOW_POST_INSTALL_SOURCE_IDENTITY_CHANGED');
});

test('success result is sanitized and contains exact proof identity but no token or arbitrary authority', async () => {
  const root = createFixtureRoot('forge-shadow-adapter-safe-');
  const result = await executeForgeShadowM2OnBattleBridge(command(), {
    platform: 'win32',
    repositoryRoot: root,
    runCommand(_executable, args) {
      const fixed = fixedSourceRead(args);
      if (fixed) return fixed;
      return { status: 0, stdout: JSON.stringify(readyReceipt()), stderr: '' };
    },
  });
  const serialized = JSON.stringify(result);
  assert.equal(result.canonicalTree, TREE);
  assert.equal(result.machine, 'stephanos-forge-shadow');
  assert.equal(result.podmanConnection, 'stephanos-forge-shadow');
  assert.equal(result.container, 'stephanos-forge-shadow');
  assert.equal(result.backupDigest, BACKUP_DIGEST);
  assert.equal(result.backupVolume, 'stephanos-forge-shadow-backup-deadbeefdeadbeef');
  assert.equal(result.githubCredentialUsed, false);
  assert.equal(result.credentialPersisted, false);
  assert.equal(result.credentialLogged, false);
  assert.equal(result.runnerRegistration, false);
  assert.equal(result.mergeAuthority, false);
  assert.doesNotMatch(serialized, /token|password|cookie|session|authorization/i);
});
