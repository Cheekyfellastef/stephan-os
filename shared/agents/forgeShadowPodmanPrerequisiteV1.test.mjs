import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
const BLOB = 'e'.repeat(40);
const IMAGE_DIGEST = `sha256:${'d'.repeat(64)}`;
const INSTALLER_SHA256 = 'c094059880f033656092f5fb4306457e42aa068ee32137162299817c5f79396f';
const WINDOWS_HOST_ADAPTER = 'podman-desktop-windows10-wsl2-v1';
const PODMAN_DESKTOP_SOURCE_COMMIT = 'a969ee0e0b07285122dd4988a58edb0a1a25d5fc';
const PODMAN_DESKTOP_PODMAN_MANIFEST_BLOB = '5acfedd1c3171414aa218a1d5d95ea7529687809';
const PREREQUISITE_PATH = 'scripts/windows/install-forge-shadow-podman-prerequisite-v1.ps1';

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'forge-m2-prereq-test',
    operation: FORGE_SHADOW_BATTLE_BRIDGE_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    forgejoVersion: FORGE_SHADOW_BATTLE_BRIDGE_VERSION,
    runtimeBoundary: FORGE_SHADOW_BATTLE_BRIDGE_BOUNDARY,
    m2Only: true,
    expiresAt: '2026-08-16T05:00:00.000Z',
    ...overrides,
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'forge-podman-prereq-'));
  mkdirSync(join(root, 'scripts', 'windows'), { recursive: true });
  writeFileSync(join(root, PREREQUISITE_PATH), '# fixture\n');
  const localAppData = join(root, 'local-app-data');
  const podman = join(localAppData, 'Programs', 'Podman', 'podman.exe');
  mkdirSync(join(localAppData, 'Programs', 'Podman'), { recursive: true });
  writeFileSync(podman, 'fixture');
  return { root, localAppData, podman };
}

function prerequisiteReceipt() {
  return {
    schemaVersion: 'stephanos.forge-shadow-podman-prerequisite-receipt.v1',
    ok: true,
    status: 'FORGE_SHADOW_PODMAN_PREREQUISITE_READY',
    repository: 'Cheekyfellastef/stephan-os',
    expectedHead: HEAD,
    canonicalTree: TREE,
    podmanVersion: '6.0.2',
    windowsHostAdapter: WINDOWS_HOST_ADAPTER,
    minimumWindowsBuild: 19043,
    maximumWindowsBuildExclusive: 22000,
    requiredWindowsArchitecture: 'X64',
    observedWindowsBuild: 19045,
    observedWindowsProductName: 'Windows 10 Pro',
    observedWindowsInstallationType: 'Client',
    observedWindowsArchitecture: 'X64',
    wsl2Evidence: 'default-version-2',
    compatibilityAuthority: 'podman-desktop-v1.29.1-win32-x64-podman-v6.0.2',
    podmanDesktopVersion: '1.29.1',
    podmanDesktopSourceCommit: PODMAN_DESKTOP_SOURCE_COMMIT,
    podmanDesktopPodmanManifestBlob: PODMAN_DESKTOP_PODMAN_MANIFEST_BLOB,
    podmanExecutableIdentity: 'fixed-user-podman',
    installerSha256: INSTALLER_SHA256,
    installerSignatureValid: true,
    installPerformed: true,
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
  };
}

test('Forge M2 command surface remains exactly the original four fields', () => {
  assert.deepEqual(forgeShadowBattleBridgeFields(), [
    'forgejoVersion',
    'forgejoImageDigest',
    'runtimeBoundary',
    'm2Only',
  ]);
});

test('missing image digest selects prerequisite-only mode while an exact digest preserves normal M2', () => {
  const prerequisite = validateForgeShadowBattleBridgeCommand(command());
  assert.equal(prerequisite.ok, true);
  assert.equal(prerequisite.command.prerequisiteOnly, true);
  assert.equal(prerequisite.command.forgejoImageDigest, '');

  const normal = validateForgeShadowBattleBridgeCommand(command({ forgejoImageDigest: IMAGE_DIGEST }));
  assert.equal(normal.ok, true);
  assert.equal(normal.command.prerequisiteOnly, false);
  assert.equal(normal.command.forgejoImageDigest, IMAGE_DIGEST);

  const unsafe = validateForgeShadowBattleBridgeCommand(command({ forgejoImageDigest: 'latest' }));
  assert.equal(unsafe.ok, false);
  assert.equal(unsafe.blocker, 'FORGE_SHADOW_COMMAND_IMAGE_DIGEST_INVALID');
});

test('prerequisite executor proves exact source, installs only fixed Podman, then resolves the exact Forgejo digest', async () => {
  const { root, localAppData, podman } = fixture();
  const calls = [];
  const result = await executeForgeShadowM2OnBattleBridge(command(), {
    platform: 'win32',
    repositoryRoot: root,
    env: { LOCALAPPDATA: localAppData },
    runCommand(executable, args) {
      calls.push({ executable, args: [...args] });
      if (args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === `${HEAD}^{tree}`) return { status: 0, stdout: `${TREE}\n`, stderr: '' };
      if (args[0] === 'rev-parse' && args[1] === `${HEAD}:${PREREQUISITE_PATH}`) return { status: 0, stdout: `${BLOB}\n`, stderr: '' };
      if (args[0] === 'hash-object') return { status: 0, stdout: `${BLOB}\n`, stderr: '' };
      if (args.includes('-File')) return { status: 0, stdout: JSON.stringify(prerequisiteReceipt()), stderr: '' };
      if (executable === podman && args[0] === '--version') return { status: 0, stdout: 'podman version 6.0.2\n', stderr: '' };
      if (executable === podman && args[0] === 'manifest' && args[1] === 'inspect') {
        return {
          status: 0,
          stdout: JSON.stringify({ manifests: [{ digest: IMAGE_DIGEST, platform: { os: 'linux', architecture: 'amd64' } }] }),
          stderr: '',
        };
      }
      return { status: 1, stdout: '', stderr: 'unexpected command' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'FORGE_SHADOW_PODMAN_PREREQUISITE_READY');
  assert.equal(result.readyForM2, true);
  assert.equal(result.forgejoImageDigest, IMAGE_DIGEST);
  assert.equal(result.podmanVersion, '6.0.2');
  assert.equal(result.windowsHostAdapter, WINDOWS_HOST_ADAPTER);
  assert.equal(result.minimumWindowsBuild, 19043);
  assert.equal(result.observedWindowsBuild, 19045);
  assert.equal(result.observedWindowsProductName, 'Windows 10 Pro');
  assert.equal(result.observedWindowsInstallationType, 'Client');
  assert.equal(result.installPerformed, true);
  assert.equal(result.machineMutation, false);
  assert.equal(result.containerMutation, false);
  assert.equal(result.imagePull, false);
  const powershell = calls.find((call) => call.args.includes('-File'));
  assert.ok(powershell);
  assert.ok(powershell.args.includes('-OperatorApproved'));
  assert.equal(powershell.args.includes('-ForgejoImageDigest'), false);
  const manifest = calls.find((call) => call.executable === podman && call.args[0] === 'manifest');
  assert.ok(manifest);
  assert.deepEqual(manifest.args.slice(0, 3), ['manifest', 'inspect', '--tls-verify=true']);
});

test('fixed prerequisite admits only the exact Windows 10 x64 WSL2 compatibility contract without adding a second installer', () => {
  const source = readFileSync(new URL('../../scripts/windows/install-forge-shadow-podman-prerequisite-v1.ps1', import.meta.url), 'utf8');
  const parameterBlock = source.slice(0, source.indexOf('Set-StrictMode'));
  assert.match(source, /podman-installer-windows-amd64\.msi/);
  assert.match(source, /v6\.0\.2/);
  assert.match(source, new RegExp(INSTALLER_SHA256));
  assert.match(source, /MSIINSTALLPERUSER=1/);
  assert.match(source, /ALLUSERS=2/);
  assert.match(source, /Get-AuthenticodeSignature/);
  assert.match(source, /Get-FileHash/);
  assert.match(source, /PODMAN_USER_VERSION_NOT_PROVEN/);
  assert.match(source, /\$WindowsHostAdapter = 'podman-desktop-windows10-wsl2-v1'/);
  assert.match(source, /\$MinimumWindowsBuild = 19043/);
  assert.match(source, /\$MaximumWindowsBuildExclusive = 22000/);
  assert.match(source, /\$RequiredWindowsArchitecture = 'X64'/);
  assert.match(source, /\$PodmanDesktopVersion = '1\.29\.1'/);
  assert.match(source, new RegExp(PODMAN_DESKTOP_SOURCE_COMMIT));
  assert.match(source, new RegExp(PODMAN_DESKTOP_PODMAN_MANIFEST_BLOB));
  assert.match(source, /WINDOWS_10_BUILD_19043_OR_NEWER_REQUIRED/);
  assert.match(source, /WINDOWS_10_CLIENT_REQUIRED/);
  assert.match(source, /WINDOWS_PRODUCT_IDENTITY_UNAVAILABLE/);
  assert.match(source, /\$ObservedWindowsInstallationType -ne 'Client'/);
  assert.match(source, /\$ObservedWindowsProductName -notmatch '\^Windows 10/);
  assert.match(source, /RuntimeInformation\]::OSArchitecture\.ToString\(\)/);
  assert.match(source, /\$ObservedWindowsBuild -ge \$MaximumWindowsBuildExclusive/);
  assert.match(source, /function Get-Wsl2Evidence/);
  assert.match(source, /@\('--status'\)/);
  assert.match(source, /@\('--list', '--verbose'\)/);
  assert.match(source, /Default Version:\\s\*2/);
  assert.match(source, /distribution-version-2/);
  assert.match(source, /\$ObservedWsl2Evidence = Get-Wsl2Evidence/);
  assert.match(source, /if \(-not \$ObservedWsl2Evidence\) \{ Emit-Blocked 'WSL2_NOT_AVAILABLE' \}/);
  assert.doesNotMatch(source, /\$wslStatus = Invoke-Fixed/);
  assert.doesNotMatch(source, /WINDOWS_11_OR_NEWER_REQUIRED/);
  assert.doesNotMatch(source, /podman-desktop-1\.29\.1-setup-x64\.exe/);
  assert.doesNotMatch(parameterBlock, /\$(?:Url|Uri|Path|Executable|Command|Args|Token|Credential)\b/i);
  assert.doesNotMatch(source, /@\('machine',\s*'(?:init|start)'|@\('pull'/i);
});
