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
} from './forgeShadowBattleBridgeAdapterV1.mjs';

const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const INSTALLER_BLOB = 'c'.repeat(40);
const INSTALLER_SHA256 = 'c094059880f033656092f5fb4306457e42aa068ee32137162299817c5f79396f';
const WINDOWS_HOST_ADAPTER = 'podman-desktop-windows10-wsl2-v1';
const PREREQUISITE_PATH = 'scripts/windows/install-forge-shadow-podman-prerequisite-v1.ps1';

function command() {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'forge-prerequisite-blocker-test',
    operation: FORGE_SHADOW_BATTLE_BRIDGE_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    forgejoVersion: FORGE_SHADOW_BATTLE_BRIDGE_VERSION,
    forgejoImageDigest: '',
    runtimeBoundary: FORGE_SHADOW_BATTLE_BRIDGE_BOUNDARY,
    m2Only: true,
    expiresAt: '2026-08-24T01:00:00.000Z',
  };
}

function blockedReceipt(blocker, extras = {}) {
  return {
    schemaVersion: 'stephanos.forge-shadow-podman-prerequisite-receipt.v1',
    ok: false,
    status: 'BLOCKED',
    blocker,
    repository: 'Cheekyfellastef/stephan-os',
    expectedHead: HEAD,
    podmanVersion: '6.0.2',
    windowsHostAdapter: WINDOWS_HOST_ADAPTER,
    minimumWindowsBuild: 19043,
    observedWindowsBuild: 19045,
    observedWindowsProductName: 'Windows 10 Pro',
    observedWindowsInstallationType: 'Client',
    compatibilityAuthority: 'podman-desktop-v1.29.1-win32-x64-podman-v6.0.2',
    podmanDesktopVersion: '1.29.1',
    podmanDesktopSourceCommit: 'a969ee0e0b07285122dd4988a58edb0a1a25d5fc',
    podmanDesktopPodmanManifestBlob: '5acfedd1c3171414aa218a1d5d95ea7529687809',
    installerSha256: INSTALLER_SHA256,
    userScope: true,
    adminRequired: false,
    sourceMutation: false,
    forgeRuntimeMutation: false,
    machineMutation: false,
    containerMutation: false,
    imagePull: false,
    githubCredentialUsed: false,
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    callerSelectedUrlAllowed: false,
    callerSelectedPathAllowed: false,
    callerSelectedExecutableAllowed: false,
    ...extras,
  };
}

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'forge-prerequisite-blocker-'));
  mkdirSync(join(root, 'scripts', 'windows'), { recursive: true });
  writeFileSync(join(root, PREREQUISITE_PATH), '# fixed prerequisite fixture\n');
  return root;
}

function executeWithInstallerResult(installerResult) {
  const repositoryRoot = fixtureRoot();
  return executeForgeShadowM2OnBattleBridge(command(), {
    platform: 'win32',
    repositoryRoot,
    runCommand(_executable, args) {
      if (args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === `${HEAD}^{tree}`) return { status: 0, stdout: `${TREE}\n`, stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === `${HEAD}:${PREREQUISITE_PATH}`) {
        return { status: 0, stdout: `${INSTALLER_BLOB}\n`, stderr: '' };
      }
      if (args[0] === 'hash-object') return { status: 0, stdout: `${INSTALLER_BLOB}\n`, stderr: '' };
      if (args.includes('-File')) return installerResult;
      return { status: 1, stdout: '', stderr: 'unexpected test invocation' };
    },
  });
}

test('known structured prerequisite blocker is surfaced without raw detail leakage', async () => {
  const result = await executeWithInstallerResult({
    status: 2,
    stdout: JSON.stringify(blockedReceipt('WSL2_NOT_AVAILABLE', {
      errorType: 'Sensitive.Path.Should.Not.Propagate',
      observedVersion: 'secret-value',
    })),
    stderr: 'host-only stderr should not propagate',
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'WSL2_NOT_AVAILABLE');
  assert.deepEqual(result.details, {
    stage: 'FORGE_SHADOW_PODMAN_PREREQUISITE',
    exitCode: 2,
  });
  assert.doesNotMatch(JSON.stringify(result), /Sensitive|secret-value|host-only stderr/i);
});

test('Windows Server product identity blocker is structured and bounded', async () => {
  const result = await executeWithInstallerResult({
    status: 2,
    stdout: JSON.stringify(blockedReceipt('WINDOWS_10_CLIENT_REQUIRED', {
      observedWindowsProductName: 'Windows Server 2022 Standard',
      observedWindowsInstallationType: 'Server',
    })),
    stderr: '',
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'WINDOWS_10_CLIENT_REQUIRED');
  assert.deepEqual(result.details, {
    stage: 'FORGE_SHADOW_PODMAN_PREREQUISITE',
    exitCode: 2,
  });
});

test('unknown structured prerequisite blocker stays behind the generic fail-closed boundary', async () => {
  const result = await executeWithInstallerResult({
    status: 2,
    stdout: JSON.stringify(blockedReceipt('ATTACKER_SELECTED_BLOCKER', {
      token: 'must-not-propagate',
    })),
    stderr: '',
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'FORGE_SHADOW_PODMAN_PREREQUISITE_FAILED');
  assert.equal(result.details.exitCode, 2);
  assert.doesNotMatch(JSON.stringify(result), /ATTACKER_SELECTED_BLOCKER|must-not-propagate/);
});

test('non-contract failure exit cannot impersonate a structured prerequisite blocker', async () => {
  const result = await executeWithInstallerResult({
    status: 1,
    stdout: JSON.stringify(blockedReceipt('WSL2_NOT_AVAILABLE')),
    stderr: '',
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'FORGE_SHADOW_PODMAN_PREREQUISITE_FAILED');
  assert.equal(result.details.exitCode, 1);
});
