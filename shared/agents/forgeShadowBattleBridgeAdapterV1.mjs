import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';

export const FORGE_SHADOW_BATTLE_BRIDGE_OPERATION = 'INSTALL_FORGE_SHADOW_M2';
export const FORGE_SHADOW_BATTLE_BRIDGE_VERSION = '15.0.6';
export const FORGE_SHADOW_BATTLE_BRIDGE_BOUNDARY = 'podman-wsl-rootless';
export const FORGE_SHADOW_BATTLE_BRIDGE_REPOSITORY = 'Cheekyfellastef/stephan-os';

const SHA40 = /^[0-9a-f]{40}$/;
const OCI_DIGEST = /^sha256:[0-9a-f]{64}$/;
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

  if (command.repository !== FORGE_SHADOW_BATTLE_BRIDGE_REPOSITORY) {
    return fail('FORGE_SHADOW_COMMAND_REPOSITORY_MISMATCH');
  }
  if (!SHA40.test(expectedHead)) return fail('FORGE_SHADOW_COMMAND_EXPECTED_HEAD_INVALID');
  if (forgejoVersion !== FORGE_SHADOW_BATTLE_BRIDGE_VERSION) {
    return fail('FORGE_SHADOW_COMMAND_VERSION_MISMATCH');
  }
  if (!OCI_DIGEST.test(forgejoImageDigest)) {
    return fail('FORGE_SHADOW_COMMAND_IMAGE_DIGEST_INVALID');
  }
  if (runtimeBoundary !== FORGE_SHADOW_BATTLE_BRIDGE_BOUNDARY) {
    return fail('FORGE_SHADOW_COMMAND_RUNTIME_BOUNDARY_INVALID');
  }
  if (command.m2Only !== true) return fail('FORGE_SHADOW_COMMAND_M2_ONLY_REQUIRED');

  return Object.freeze({
    ok: true,
    command: Object.freeze({
      forgejoVersion: FORGE_SHADOW_BATTLE_BRIDGE_VERSION,
      forgejoImageDigest,
      runtimeBoundary: FORGE_SHADOW_BATTLE_BRIDGE_BOUNDARY,
      m2Only: true,
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

function validInstallerReceipt(receipt, command) {
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
    && /^[0-9a-f]{64}$/.test(String(receipt.backupDigest || ''))
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
  const installerPath = resolve(repositoryRoot, 'scripts', 'windows', 'install-forge-shadow-podman-v1.ps1');
  if (!existsSync(repositoryRoot) || !existsSync(installerPath)) {
    return fail('FORGE_SHADOW_LOCAL_SOURCE_MISSING');
  }

  const branch = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['branch', '--show-current'], { cwd: repositoryRoot, timeout: 120000 });
  const head = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['rev-parse', 'HEAD'], { cwd: repositoryRoot, timeout: 120000 });
  const observedBranch = branch.stdout.trim();
  const observedHead = head.stdout.trim().toLowerCase();
  if (!branch.ok || !head.ok || observedBranch !== 'main' || observedHead !== normalized.expectedHead) {
    return fail('FORGE_SHADOW_SOURCE_IDENTITY_CHANGED', { observedBranch, observedHead });
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
  if (!validInstallerReceipt(receipt, normalized)) {
    return fail('FORGE_SHADOW_INSTALLER_RECEIPT_INVALID');
  }

  const branchAfter = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['branch', '--show-current'], { cwd: repositoryRoot, timeout: 120000 });
  const headAfter = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['rev-parse', 'HEAD'], { cwd: repositoryRoot, timeout: 120000 });
  if (!branchAfter.ok || !headAfter.ok || branchAfter.stdout.trim() !== 'main' || headAfter.stdout.trim().toLowerCase() !== normalized.expectedHead) {
    return fail('FORGE_SHADOW_POST_INSTALL_SOURCE_IDENTITY_CHANGED');
  }

  return Object.freeze({
    ok: true,
    blocker: '',
    finalVerdict: 'FORGE_SHADOW_M2_READY',
    repository: FORGE_SHADOW_BATTLE_BRIDGE_REPOSITORY,
    sourceHead: normalized.expectedHead,
    forgejoVersion: FORGE_SHADOW_BATTLE_BRIDGE_VERSION,
    forgejoImageDigest: normalized.forgejoImageDigest,
    runtimeBoundary: FORGE_SHADOW_BATTLE_BRIDGE_BOUNDARY,
    listener: String(receipt.listener || ''),
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
