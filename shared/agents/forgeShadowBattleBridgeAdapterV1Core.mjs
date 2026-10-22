import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';
import { resolveForgeShadowM2DigestOnBattleBridge } from './forgeShadowM2DigestResolverV1.mjs';

export const FORGE_SHADOW_BATTLE_BRIDGE_OPERATION = 'INSTALL_FORGE_SHADOW_M2';
export const FORGE_SHADOW_BATTLE_BRIDGE_VERSION = '15.0.6';
export const FORGE_SHADOW_BATTLE_BRIDGE_BOUNDARY = 'podman-wsl-rootless';
export const FORGE_SHADOW_BATTLE_BRIDGE_REPOSITORY = 'Cheekyfellastef/stephan-os';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const OCI_DIGEST = /^sha256:[0-9a-f]{64}$/;
const SAFE_BACKUP_VOLUME = /^stephanos-forge-shadow-backup-[0-9a-f]{16}$/;
const INSTALLER_RELATIVE_PATH = 'scripts/windows/install-forge-shadow-podman-v1.ps1';
const PREREQUISITE_INSTALLER_RELATIVE_PATH = 'scripts/windows/install-forge-shadow-podman-prerequisite-v1.ps1';
const PODMAN_INSTALLER_SHA256 = 'c094059880f033656092f5fb4306457e42aa068ee32137162299817c5f79396f';
const WINDOWS_HOST_ADAPTER = 'podman-desktop-windows10-wsl2-v1';
const MINIMUM_WINDOWS_BUILD = 19043;
const PODMAN_DESKTOP_VERSION = '1.29.1';
const PODMAN_DESKTOP_SOURCE_COMMIT = 'a969ee0e0b07285122dd4988a58edb0a1a25d5fc';
const PODMAN_DESKTOP_PODMAN_MANIFEST_BLOB = '5acfedd1c3171414aa218a1d5d95ea7529687809';
const PODMAN_DESKTOP_COMPATIBILITY_AUTHORITY = 'podman-desktop-v1.29.1-win32-x64-podman-v6.0.2';
const MACHINE_NAME = 'stephanos-forge-shadow';
const CONTAINER_NAME = 'stephanos-forge-shadow';
const PREREQUISITE_BLOCKERS = new Set([
  'CANONICAL_REPOSITORY_ROOT_MISSING',
  'FIXED_GIT_EXECUTABLE_MISSING',
  'WSL_EXECUTABLE_MISSING',
  'MSIEXEC_EXECUTABLE_MISSING',
  'WINDOWS_PRODUCT_IDENTITY_UNAVAILABLE',
  'WINDOWS_10_CLIENT_REQUIRED',
  'WINDOWS_10_BUILD_19043_OR_NEWER_REQUIRED',
  'CANONICAL_REPOSITORY_NOT_MAIN',
  'CANONICAL_REPOSITORY_HEAD_MISMATCH',
  'CANONICAL_REPOSITORY_TREE_INVALID',
  'WSL2_NOT_AVAILABLE',
  'EXACT_RUNTIME_OPERATOR_APPROVAL_REQUIRED',
  'PODMAN_USER_VERSION_MISMATCH',
  'RUNTIME_MUTATION_NOT_CONFIRMED',
  'PODMAN_INSTALLER_DIGEST_MISMATCH',
  'PODMAN_INSTALLER_SIGNATURE_INVALID',
  'PODMAN_USER_INSTALL_FAILED',
  'PODMAN_USER_EXECUTABLE_MISSING_AFTER_INSTALL',
  'PODMAN_USER_VERSION_NOT_PROVEN',
  'CANONICAL_REPOSITORY_CHANGED_DURING_PREREQUISITE_INSTALL',
  'PODMAN_PREREQUISITE_INSTALLER_EXCEPTION',
]);
const FORBIDDEN_FIELDS = Object.freeze([
  'command', 'commands', 'executable', 'args', 'arguments', 'shell', 'powershell',
  'script', 'path', 'url', 'uri', 'environment', 'env', 'token', 'credential',
  'cookie', 'session', 'privateKey', 'publicKey', 'selector', 'javascript',
]);
const COMMAND_FIELDS = Object.freeze([
  'forgejoVersion',
  'forgejoImageDigest',
  'runtimeBoundary',
  'm2Only',
]);

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, blocker, details: Object.freeze(details) });
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function parseJson(output) {
  try { return JSON.parse(String(output || '')); }
  catch { return null; }
}

export function forgeShadowBattleBridgeFields() {
  return [...COMMAND_FIELDS];
}

export function validateForgeShadowBattleBridgeCommand(command = {}) {
  const unsafeField = FORBIDDEN_FIELDS.find((field) => hasValue(command[field]));
  if (unsafeField) return fail('FORGE_SHADOW_COMMAND_UNSAFE_FIELD_PRESENT', { field: unsafeField });

  const expectedHead = String(command.expectedHead || '').trim().toLowerCase();
  const forgejoVersion = String(command.forgejoVersion || '').trim();
  const forgejoImageDigest = String(command.forgejoImageDigest || '').trim().toLowerCase();
  const runtimeBoundary = String(command.runtimeBoundary || '').trim();
  const prerequisiteOnly = forgejoImageDigest === '';

  if (command.repository !== FORGE_SHADOW_BATTLE_BRIDGE_REPOSITORY) {
    return fail('FORGE_SHADOW_COMMAND_REPOSITORY_MISMATCH');
  }
  if (!SHA40.test(expectedHead)) return fail('FORGE_SHADOW_COMMAND_EXPECTED_HEAD_INVALID');
  if (forgejoVersion !== FORGE_SHADOW_BATTLE_BRIDGE_VERSION) {
    return fail('FORGE_SHADOW_COMMAND_VERSION_MISMATCH');
  }
  if (runtimeBoundary !== FORGE_SHADOW_BATTLE_BRIDGE_BOUNDARY) {
    return fail('FORGE_SHADOW_COMMAND_RUNTIME_BOUNDARY_INVALID');
  }
  if (command.m2Only !== true) return fail('FORGE_SHADOW_COMMAND_M2_ONLY_REQUIRED');
  if (!prerequisiteOnly && !OCI_DIGEST.test(forgejoImageDigest)) {
    return fail('FORGE_SHADOW_COMMAND_IMAGE_DIGEST_INVALID');
  }

  return Object.freeze({
    ok: true,
    command: Object.freeze({
      forgejoVersion: FORGE_SHADOW_BATTLE_BRIDGE_VERSION,
      forgejoImageDigest,
      runtimeBoundary: FORGE_SHADOW_BATTLE_BRIDGE_BOUNDARY,
      m2Only: true,
      prerequisiteOnly,
    }),
  });
}

function defaultRun(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 30 * 60 * 1000,
    maxBuffer: options.maxBuffer || 128 * 1024,
  });
}

function runExact(runCommand, executable, args, options = {}) {
  const result = runCommand(executable, args, options);
  return Object.freeze({
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    stdout: String(result?.stdout || ''),
    stderr: String(result?.stderr || ''),
    error: result?.error?.message || '',
  });
}

function readSourceIdentity(runCommand, repositoryRoot, expectedHead, installerPath, installerRelativePath) {
  const branch = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['branch', '--show-current'], { cwd: repositoryRoot, timeout: 120000 });
  const head = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['rev-parse', 'HEAD'], { cwd: repositoryRoot, timeout: 120000 });
  const tree = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['rev-parse', `${expectedHead}^{tree}`], { cwd: repositoryRoot, timeout: 120000 });
  const installerBlob = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['rev-parse', `${expectedHead}:${installerRelativePath}`], { cwd: repositoryRoot, timeout: 120000 });
  const workingInstallerBlob = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, [
    'hash-object', `--path=${installerRelativePath}`, installerPath,
  ], { cwd: repositoryRoot, timeout: 120000 });
  return Object.freeze({
    ok: branch.ok && head.ok && tree.ok && installerBlob.ok && workingInstallerBlob.ok,
    branch: branch.stdout.trim(),
    head: head.stdout.trim().toLowerCase(),
    tree: tree.stdout.trim().toLowerCase(),
    installerBlob: installerBlob.stdout.trim().toLowerCase(),
    workingInstallerBlob: workingInstallerBlob.stdout.trim().toLowerCase(),
  });
}

function sourceIdentityMatches(identity, expectedHead) {
  return Boolean(
    identity?.ok
    && identity.branch === 'main'
    && identity.head === expectedHead
    && SHA40.test(identity.tree)
    && SHA40.test(identity.installerBlob)
    && identity.workingInstallerBlob === identity.installerBlob
  );
}

function validBlockedPrerequisiteReceipt(receipt, command) {
  return Boolean(
    receipt
    && typeof receipt === 'object'
    && !Array.isArray(receipt)
    && receipt.schemaVersion === 'stephanos.forge-shadow-podman-prerequisite-receipt.v1'
    && receipt.ok === false
    && receipt.status === 'BLOCKED'
    && PREREQUISITE_BLOCKERS.has(String(receipt.blocker || ''))
    && receipt.repository === FORGE_SHADOW_BATTLE_BRIDGE_REPOSITORY
    && String(receipt.expectedHead || '').toLowerCase() === command.expectedHead
    && String(receipt.podmanVersion || '') === '6.0.2'
    && receipt.windowsHostAdapter === WINDOWS_HOST_ADAPTER
    && Number.isSafeInteger(receipt.minimumWindowsBuild)
    && receipt.minimumWindowsBuild === MINIMUM_WINDOWS_BUILD
    && Number.isSafeInteger(receipt.observedWindowsBuild)
    && receipt.observedWindowsBuild > 0
    && typeof receipt.observedWindowsProductName === 'string'
    && typeof receipt.observedWindowsInstallationType === 'string'
    && receipt.compatibilityAuthority === PODMAN_DESKTOP_COMPATIBILITY_AUTHORITY
    && receipt.podmanDesktopVersion === PODMAN_DESKTOP_VERSION
    && receipt.podmanDesktopSourceCommit === PODMAN_DESKTOP_SOURCE_COMMIT
    && receipt.podmanDesktopPodmanManifestBlob === PODMAN_DESKTOP_PODMAN_MANIFEST_BLOB
    && String(receipt.installerSha256 || '').toLowerCase() === PODMAN_INSTALLER_SHA256
    && receipt.userScope === true
    && receipt.adminRequired === false
    && receipt.sourceMutation === false
    && receipt.forgeRuntimeMutation === false
    && receipt.machineMutation === false
    && receipt.containerMutation === false
    && receipt.imagePull === false
    && receipt.githubCredentialUsed === false
    && receipt.arbitraryShellAllowed === false
    && receipt.arbitraryPowerShellAllowed === false
    && receipt.callerSelectedUrlAllowed === false
    && receipt.callerSelectedPathAllowed === false
    && receipt.callerSelectedExecutableAllowed === false
  );
}

function validPrerequisiteReceipt(receipt, command, expectedTree) {
  return Boolean(
    receipt
    && typeof receipt === 'object'
    && !Array.isArray(receipt)
    && receipt.schemaVersion === 'stephanos.forge-shadow-podman-prerequisite-receipt.v1'
    && receipt.ok === true
    && receipt.status === 'FORGE_SHADOW_PODMAN_PREREQUISITE_READY'
    && receipt.repository === FORGE_SHADOW_BATTLE_BRIDGE_REPOSITORY
    && String(receipt.expectedHead || '').toLowerCase() === command.expectedHead
    && String(receipt.canonicalTree || '').toLowerCase() === expectedTree
    && String(receipt.podmanVersion || '') === '6.0.2'
    && receipt.windowsHostAdapter === WINDOWS_HOST_ADAPTER
    && receipt.minimumWindowsBuild === MINIMUM_WINDOWS_BUILD
    && Number.isSafeInteger(receipt.observedWindowsBuild)
    && receipt.observedWindowsBuild >= MINIMUM_WINDOWS_BUILD
    && /^Windows 10(?:\s|$)/.test(receipt.observedWindowsProductName)
    && receipt.observedWindowsInstallationType === 'Client'
    && receipt.compatibilityAuthority === PODMAN_DESKTOP_COMPATIBILITY_AUTHORITY
    && receipt.podmanDesktopVersion === PODMAN_DESKTOP_VERSION
    && receipt.podmanDesktopSourceCommit === PODMAN_DESKTOP_SOURCE_COMMIT
    && receipt.podmanDesktopPodmanManifestBlob === PODMAN_DESKTOP_PODMAN_MANIFEST_BLOB
    && receipt.podmanExecutableIdentity === 'fixed-user-podman'
    && String(receipt.installerSha256 || '').toLowerCase() === PODMAN_INSTALLER_SHA256
    && receipt.userScope === true
    && receipt.adminRequired === false
    && receipt.sourceMutation === false
    && receipt.forgeRuntimeMutation === false
    && receipt.machineMutation === false
    && receipt.containerMutation === false
    && receipt.imagePull === false
    && receipt.githubCredentialUsed === false
    && receipt.arbitraryShellAllowed === false
    && receipt.arbitraryPowerShellAllowed === false
    && receipt.callerSelectedUrlAllowed === false
    && receipt.callerSelectedPathAllowed === false
    && receipt.callerSelectedExecutableAllowed === false
  );
}

function validInstallerReceipt(receipt, command, expectedTree) {
  const canonicalTree = String(receipt?.canonicalTree || '').toLowerCase();
  const mirrorHead = String(receipt?.mirrorHead || '').toLowerCase();
  const mirrorTree = String(receipt?.mirrorTree || '').toLowerCase();
  const backupDigest = String(receipt?.backupDigest || '').toLowerCase();
  const backupVolume = String(receipt?.backupVolume || '');
  const expectedBackupVolume = SHA256.test(backupDigest)
    ? `stephanos-forge-shadow-backup-${backupDigest.slice(0, 16)}`
    : '';
  return Boolean(
    receipt
    && typeof receipt === 'object'
    && !Array.isArray(receipt)
    && receipt.schemaVersion === 'stephanos.forge-shadow-podman-install-receipt.v1'
    && receipt.ok === true
    && receipt.status === 'FORGE_SHADOW_M2_READY'
    && receipt.repository === FORGE_SHADOW_BATTLE_BRIDGE_REPOSITORY
    && String(receipt.expectedHead || '').toLowerCase() === command.expectedHead
    && String(receipt.imageDigest || '').toLowerCase() === command.forgejoImageDigest
    && String(receipt.forgejoVersion || '').startsWith(FORGE_SHADOW_BATTLE_BRIDGE_VERSION)
    && String(receipt.podmanVersion || '') === '6.0.2'
    && receipt.windowsHostAdapter === WINDOWS_HOST_ADAPTER
    && receipt.minimumWindowsBuild === MINIMUM_WINDOWS_BUILD
    && Number.isSafeInteger(receipt.observedWindowsBuild)
    && receipt.observedWindowsBuild >= MINIMUM_WINDOWS_BUILD
    && /^Windows 10(?:\s|$)/.test(receipt.observedWindowsProductName)
    && receipt.observedWindowsInstallationType === 'Client'
    && receipt.compatibilityAuthority === PODMAN_DESKTOP_COMPATIBILITY_AUTHORITY
    && receipt.podmanDesktopVersion === PODMAN_DESKTOP_VERSION
    && receipt.podmanDesktopSourceCommit === PODMAN_DESKTOP_SOURCE_COMMIT
    && receipt.podmanDesktopPodmanManifestBlob === PODMAN_DESKTOP_PODMAN_MANIFEST_BLOB
    && String(receipt.machine || '') === MACHINE_NAME
    && String(receipt.podmanConnection || '') === MACHINE_NAME
    && String(receipt.container || '') === CONTAINER_NAME
    && String(receipt.listener || '') === '127.0.0.1:3340'
    && mirrorHead === command.expectedHead
    && canonicalTree === expectedTree
    && mirrorTree === expectedTree
    && receipt.exactObjectParity === true
    && receipt.exactTreeParity === true
    && receipt.readOnlySealed === true
    && receipt.rootFilesystemReadOnly === true
    && receipt.allCapabilitiesDropped === true
    && receipt.noNewPrivileges === true
    && receipt.persistentWritableSurface === '/var/lib/gitea'
    && Array.isArray(receipt.boundedEphemeralWritableSurfaces)
    && receipt.boundedEphemeralWritableSurfaces.length === 3
    && receipt.boundedEphemeralWritableSurfaces[0] === '/run'
    && receipt.boundedEphemeralWritableSurfaces[1] === '/tmp'
    && receipt.boundedEphemeralWritableSurfaces[2] === '/var/tmp'
    && receipt.automaticMirrorUpdatesEnabled === false
    && receipt.githubCredentialUsed === false
    && receipt.bootstrapTokenRevoked === true
    && receipt.credentialPersisted === false
    && receipt.credentialLogged === false
    && SHA256.test(backupDigest)
    && SAFE_BACKUP_VOLUME.test(backupVolume)
    && backupVolume === expectedBackupVolume
    && receipt.restoreDrillPassed === true
    && receipt.arbitraryShellAllowed === false
    && receipt.arbitraryPowerShellAllowed === false
    && receipt.publicExposure === false
    && receipt.tailscaleExposure === false
    && receipt.runnerRegistration === false
    && receipt.actionsExecution === false
    && receipt.mergeAuthority === false
    && receipt.readyForM3 === true
  );
}

export async function executeForgeShadowM2OnBattleBridge(command = {}, options = {}) {
  const validation = validateForgeShadowBattleBridgeCommand(command);
  if (!validation.ok) return validation;
  const normalized = Object.freeze({ ...command, ...validation.command, expectedHead: String(command.expectedHead).toLowerCase() });
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return fail('FORGE_SHADOW_WINDOWS_REQUIRED');

  const runCommand = options.runCommand || defaultRun;
  const userProfile = resolve(options.userProfile || process.env.USERPROFILE || homedir());
  const repositoryRoot = resolve(options.repositoryRoot || join(userProfile, 'Documents', 'GitHub', 'stephan-os'));
  const installerRelativePath = normalized.prerequisiteOnly
    ? PREREQUISITE_INSTALLER_RELATIVE_PATH
    : INSTALLER_RELATIVE_PATH;
  const installerPath = resolve(repositoryRoot, installerRelativePath);
  if (!existsSync(repositoryRoot) || !existsSync(installerPath)) {
    return fail('FORGE_SHADOW_LOCAL_SOURCE_MISSING');
  }

  const sourceBefore = readSourceIdentity(runCommand, repositoryRoot, normalized.expectedHead, installerPath, installerRelativePath);
  if (!sourceIdentityMatches(sourceBefore, normalized.expectedHead)) {
    return fail('FORGE_SHADOW_SOURCE_IDENTITY_CHANGED', {
      observedBranch: sourceBefore.branch,
      observedHead: sourceBefore.head,
      observedTree: sourceBefore.tree,
      expectedInstallerBlob: sourceBefore.installerBlob,
      observedInstallerBlob: sourceBefore.workingInstallerBlob,
    });
  }

  if (normalized.prerequisiteOnly) {
    const invocation = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.powershell, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', installerPath,
      '-ExpectedHead', normalized.expectedHead,
      '-OperatorApproved',
    ], { cwd: repositoryRoot, timeout: 15 * 60 * 1000, maxBuffer: 128 * 1024 });

    if (Buffer.byteLength(invocation.stdout, 'utf8') > 128 * 1024) {
      return fail('FORGE_SHADOW_PODMAN_PREREQUISITE_RECEIPT_TOO_LARGE');
    }
    const receipt = parseJson(invocation.stdout.trim());
    if (!invocation.ok) {
      if (invocation.status === 2 && validBlockedPrerequisiteReceipt(receipt, normalized)) {
        return fail(String(receipt.blocker), {
          stage: 'FORGE_SHADOW_PODMAN_PREREQUISITE',
          exitCode: invocation.status,
        });
      }
      return fail('FORGE_SHADOW_PODMAN_PREREQUISITE_FAILED', { exitCode: invocation.status });
    }
    if (!validPrerequisiteReceipt(receipt, normalized, sourceBefore.tree)) {
      return fail('FORGE_SHADOW_PODMAN_PREREQUISITE_RECEIPT_INVALID');
    }

    const sourceAfter = readSourceIdentity(runCommand, repositoryRoot, normalized.expectedHead, installerPath, installerRelativePath);
    if (!sourceIdentityMatches(sourceAfter, normalized.expectedHead) || sourceAfter.tree !== sourceBefore.tree) {
      return fail('FORGE_SHADOW_POST_PREREQUISITE_SOURCE_IDENTITY_CHANGED');
    }

    const digestResolution = resolveForgeShadowM2DigestOnBattleBridge({
      repoRoot: repositoryRoot,
      platform,
      env: options.env || process.env,
      spawnSyncFn: runCommand,
    });
    if (!digestResolution.ok) {
      return fail('FORGE_SHADOW_POST_PREREQUISITE_DIGEST_RESOLUTION_FAILED', {
        digestBlocker: digestResolution.blocker || '',
      });
    }

    return Object.freeze({
      ok: true,
      blocker: '',
      finalVerdict: 'FORGE_SHADOW_PODMAN_PREREQUISITE_READY',
      repository: FORGE_SHADOW_BATTLE_BRIDGE_REPOSITORY,
      sourceHead: normalized.expectedHead,
      canonicalTree: sourceAfter.tree,
      installerBlob: sourceAfter.installerBlob,
      forgejoVersion: FORGE_SHADOW_BATTLE_BRIDGE_VERSION,
      podmanVersion: '6.0.2',
      windowsHostAdapter: WINDOWS_HOST_ADAPTER,
      minimumWindowsBuild: MINIMUM_WINDOWS_BUILD,
      observedWindowsBuild: receipt.observedWindowsBuild,
      observedWindowsProductName: receipt.observedWindowsProductName,
      observedWindowsInstallationType: receipt.observedWindowsInstallationType,
      compatibilityAuthority: PODMAN_DESKTOP_COMPATIBILITY_AUTHORITY,
      podmanDesktopVersion: PODMAN_DESKTOP_VERSION,
      podmanDesktopSourceCommit: PODMAN_DESKTOP_SOURCE_COMMIT,
      podmanDesktopPodmanManifestBlob: PODMAN_DESKTOP_PODMAN_MANIFEST_BLOB,
      podmanExecutableIdentity: 'fixed-user-podman',
      installerSha256: PODMAN_INSTALLER_SHA256,
      runtimeBoundary: FORGE_SHADOW_BATTLE_BRIDGE_BOUNDARY,
      imageTag: digestResolution.imageTag,
      forgejoImageDigest: digestResolution.imageDigest,
      runtimePlatform: digestResolution.runtimePlatform,
      tlsVerified: digestResolution.tlsVerified === true,
      registryCredentialUsed: digestResolution.registryCredentialUsed === true,
      installPerformed: receipt.installPerformed === true,
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
      readyForM2: true,
    });
  }

  const invocation = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', installerPath,
    '-ExpectedHead', normalized.expectedHead,
    '-ForgejoImageDigest', normalized.forgejoImageDigest,
    '-OperatorApproved',
    '-Confirm:$false',
  ], { cwd: repositoryRoot, timeout: 30 * 60 * 1000, maxBuffer: 128 * 1024 });

  if (!invocation.ok) {
    return fail('FORGE_SHADOW_INSTALLER_FAILED', { exitCode: invocation.status });
  }
  if (Buffer.byteLength(invocation.stdout, 'utf8') > 128 * 1024) {
    return fail('FORGE_SHADOW_INSTALLER_RECEIPT_TOO_LARGE');
  }
  const receipt = parseJson(invocation.stdout.trim());
  if (!validInstallerReceipt(receipt, normalized, sourceBefore.tree)) {
    return fail('FORGE_SHADOW_INSTALLER_RECEIPT_INVALID');
  }

  const sourceAfter = readSourceIdentity(runCommand, repositoryRoot, normalized.expectedHead, installerPath, installerRelativePath);
  if (!sourceIdentityMatches(sourceAfter, normalized.expectedHead) || sourceAfter.tree !== sourceBefore.tree) {
    return fail('FORGE_SHADOW_POST_INSTALL_SOURCE_IDENTITY_CHANGED');
  }

  return Object.freeze({
    ok: true,
    blocker: '',
    finalVerdict: 'FORGE_SHADOW_M2_READY',
    repository: FORGE_SHADOW_BATTLE_BRIDGE_REPOSITORY,
    sourceHead: normalized.expectedHead,
    canonicalTree: sourceAfter.tree,
    installerBlob: sourceAfter.installerBlob,
    forgejoVersion: FORGE_SHADOW_BATTLE_BRIDGE_VERSION,
    podmanVersion: '6.0.2',
    windowsHostAdapter: WINDOWS_HOST_ADAPTER,
    minimumWindowsBuild: MINIMUM_WINDOWS_BUILD,
    observedWindowsBuild: receipt.observedWindowsBuild,
    observedWindowsProductName: receipt.observedWindowsProductName,
    observedWindowsInstallationType: receipt.observedWindowsInstallationType,
    compatibilityAuthority: PODMAN_DESKTOP_COMPATIBILITY_AUTHORITY,
    podmanDesktopVersion: PODMAN_DESKTOP_VERSION,
    podmanDesktopSourceCommit: PODMAN_DESKTOP_SOURCE_COMMIT,
    podmanDesktopPodmanManifestBlob: PODMAN_DESKTOP_PODMAN_MANIFEST_BLOB,
    forgejoImageDigest: normalized.forgejoImageDigest,
    runtimeBoundary: FORGE_SHADOW_BATTLE_BRIDGE_BOUNDARY,
    machine: MACHINE_NAME,
    podmanConnection: MACHINE_NAME,
    container: CONTAINER_NAME,
    listener: '127.0.0.1:3340',
    mirrorHead: String(receipt.mirrorHead || '').toLowerCase(),
    mirrorTree: String(receipt.mirrorTree || '').toLowerCase(),
    backupDigest: String(receipt.backupDigest || '').toLowerCase(),
    backupVolume: String(receipt.backupVolume || ''),
    restoreDrillPassed: true,
    rootFilesystemReadOnly: true,
    allCapabilitiesDropped: true,
    noNewPrivileges: true,
    githubCredentialUsed: false,
    credentialPersisted: false,
    credentialLogged: false,
    runnerRegistration: false,
    actionsExecution: false,
    mergeAuthority: false,
    readyForM3: true,
  });
}
