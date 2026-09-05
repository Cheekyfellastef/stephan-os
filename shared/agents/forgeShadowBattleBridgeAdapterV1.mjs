import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';
import * as core from './forgeShadowBattleBridgeAdapterV1Core.mjs';

export * from './forgeShadowBattleBridgeAdapterV1Core.mjs';

export const FORGE_WSL2_AUTHORIZED_REQUEST_IDS_V1 = Object.freeze([
  'forge-wsl2-enable-authorized-20260905-v1',
  'forge-wsl2-postreboot-authorized-20260905-v1',
]);

const AUTHORIZED_REQUEST_IDS = new Set(FORGE_WSL2_AUTHORIZED_REQUEST_IDS_V1);
const WSL2_SCRIPT_RELATIVE_PATH = 'scripts/windows/enable-forge-wsl2-prerequisite-v1.ps1';
const SHA40 = /^[0-9a-f]{40}$/;
const WSL2_BLOCKERS = new Set([
  'CANONICAL_REPOSITORY_ROOT_MISSING',
  'FIXED_GIT_EXECUTABLE_MISSING',
  'CANONICAL_REPOSITORY_NOT_MAIN',
  'CANONICAL_REPOSITORY_HEAD_MISMATCH',
  'WSL2_PREREQUISITE_SCRIPT_IDENTITY_MISMATCH',
  'WINDOWS_PRODUCT_IDENTITY_UNAVAILABLE',
  'WINDOWS_10_X64_CLIENT_REQUIRED',
  'WINDOWS_10_BUILD_NOT_ADMITTED',
  'FIXED_POWERSHELL_EXECUTABLE_MISSING',
  'FIXED_DISM_EXECUTABLE_MISSING',
  'WSL_EXECUTABLE_MISSING',
  'EXACT_WSL2_OPERATOR_APPROVAL_REQUIRED',
  'WSL2_ELEVATION_CANCELLED_OR_FAILED',
  'WSL2_ELEVATED_RECEIPT_MISSING',
  'WSL2_ELEVATED_RECEIPT_INVALID',
  'WSL2_ELEVATION_NOT_EFFECTIVE',
  'WSL2_MUTATION_NOT_CONFIRMED',
  'WSL2_WINDOWS_FEATURE_ENABLE_FAILED',
  'FORGE_WSL2_REBOOT_REQUIRED',
  'WSL2_UPDATE_FAILED',
  'WSL2_DEFAULT_VERSION_2_FAILED',
  'WSL2_PROOF_NOT_READY_AFTER_CONFIGURATION',
]);

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, blocker, details: Object.freeze(details) });
}
function defaultRun(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 20 * 60 * 1000,
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
function parseJson(value) {
  try { return JSON.parse(String(value || '')); }
  catch { return null; }
}
function readWsl2ScriptIdentity(runCommand, repositoryRoot, expectedHead, scriptPath) {
  const branch = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['branch', '--show-current'], { cwd: repositoryRoot, timeout: 120000 });
  const head = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['rev-parse', 'HEAD'], { cwd: repositoryRoot, timeout: 120000 });
  const tree = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['rev-parse', `${expectedHead}^{tree}`], { cwd: repositoryRoot, timeout: 120000 });
  const committed = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['rev-parse', `${expectedHead}:${WSL2_SCRIPT_RELATIVE_PATH}`], { cwd: repositoryRoot, timeout: 120000 });
  const working = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, [
    'hash-object', `--path=${WSL2_SCRIPT_RELATIVE_PATH}`, scriptPath,
  ], { cwd: repositoryRoot, timeout: 120000 });
  return Object.freeze({
    ok: branch.ok && head.ok && tree.ok && committed.ok && working.ok,
    branch: branch.stdout.trim(),
    head: head.stdout.trim().toLowerCase(),
    tree: tree.stdout.trim().toLowerCase(),
    committedBlob: committed.stdout.trim().toLowerCase(),
    workingBlob: working.stdout.trim().toLowerCase(),
  });
}
function validWsl2ScriptIdentity(identity, expectedHead) {
  return Boolean(identity?.ok
    && identity.branch === 'main'
    && identity.head === expectedHead
    && SHA40.test(identity.tree)
    && SHA40.test(identity.committedBlob)
    && identity.workingBlob === identity.committedBlob);
}
function validWsl2Receipt(receipt, command) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
  if (receipt.schemaVersion !== 'stephanos.forge-wsl2-prerequisite-receipt.v1') return false;
  if (receipt.repository !== core.FORGE_SHADOW_BATTLE_BRIDGE_REPOSITORY) return false;
  if (String(receipt.expectedHead || '').toLowerCase() !== command.expectedHead) return false;
  if (!Number.isSafeInteger(receipt.observedWindowsBuild) || receipt.observedWindowsBuild < 19043 || receipt.observedWindowsBuild >= 22000) return false;
  if (!/^Windows 10(?:\s|$)/.test(String(receipt.observedWindowsProductName || ''))) return false;
  if (receipt.observedWindowsInstallationType !== 'Client' || receipt.observedWindowsArchitecture !== 'X64') return false;
  if (receipt.elevationAllowed !== true || receipt.podmanMutation !== false || receipt.forgeRuntimeMutation !== false || receipt.sourceMutation !== false) return false;
  if (receipt.arbitraryShellAllowed !== false || receipt.arbitraryPowerShellAllowed !== false) return false;
  if (receipt.callerSelectedPathAllowed !== false || receipt.callerSelectedExecutableAllowed !== false || receipt.callerSelectedArgumentAllowed !== false) return false;
  if (receipt.githubCredentialUsed !== false || receipt.rebootPerformed !== false) return false;
  if (!Array.isArray(receipt.windowsFeaturesAllowed)
    || receipt.windowsFeaturesAllowed.length !== 2
    || receipt.windowsFeaturesAllowed[0] !== 'Microsoft-Windows-Subsystem-Linux'
    || receipt.windowsFeaturesAllowed[1] !== 'VirtualMachinePlatform') return false;
  if (receipt.ok === true) {
    return receipt.status === 'FORGE_WSL2_PREREQUISITE_READY'
      && typeof receipt.wsl2Evidence === 'string'
      && receipt.wsl2Evidence.length > 0
      && receipt.rebootRequired === false;
  }
  return receipt.status === 'BLOCKED' && WSL2_BLOCKERS.has(String(receipt.blocker || ''));
}

export async function executeForgeShadowM2OnBattleBridge(command = {}, options = {}) {
  const validation = core.validateForgeShadowBattleBridgeCommand(command);
  if (!validation.ok) return validation;
  const normalized = Object.freeze({
    ...command,
    ...validation.command,
    expectedHead: String(command.expectedHead || '').toLowerCase(),
  });
  const initial = await core.executeForgeShadowM2OnBattleBridge(normalized, options);
  if (initial?.ok !== false || initial?.blocker !== 'WSL2_NOT_AVAILABLE') return initial;
  if (normalized.prerequisiteOnly !== true || !AUTHORIZED_REQUEST_IDS.has(String(normalized.requestId || ''))) return initial;

  const platform = options.platform || process.platform;
  if (platform !== 'win32') return fail('FORGE_SHADOW_WINDOWS_REQUIRED');
  const runCommand = options.runCommand || defaultRun;
  const userProfile = resolve(options.userProfile || process.env.USERPROFILE || homedir());
  const repositoryRoot = resolve(options.repositoryRoot || join(userProfile, 'Documents', 'GitHub', 'stephan-os'));
  const scriptPath = resolve(repositoryRoot, WSL2_SCRIPT_RELATIVE_PATH);
  if (!existsSync(repositoryRoot) || !existsSync(scriptPath)) return fail('FORGE_WSL2_PREREQUISITE_SOURCE_MISSING');
  const sourceBefore = readWsl2ScriptIdentity(runCommand, repositoryRoot, normalized.expectedHead, scriptPath);
  if (!validWsl2ScriptIdentity(sourceBefore, normalized.expectedHead)) {
    return fail('FORGE_WSL2_PREREQUISITE_SOURCE_IDENTITY_CHANGED', sourceBefore);
  }

  const invocation = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    '-ExpectedHead', normalized.expectedHead,
    '-OperatorApproved',
  ], { cwd: repositoryRoot, timeout: 20 * 60 * 1000, maxBuffer: 128 * 1024 });
  if (Buffer.byteLength(invocation.stdout, 'utf8') > 128 * 1024) return fail('FORGE_WSL2_PREREQUISITE_RECEIPT_TOO_LARGE');
  const receipt = parseJson(invocation.stdout.trim());
  if (!validWsl2Receipt(receipt, normalized)) return fail('FORGE_WSL2_PREREQUISITE_RECEIPT_INVALID', { exitCode: invocation.status });
  if (!invocation.ok) {
    return fail(String(receipt.blocker || 'FORGE_WSL2_PREREQUISITE_FAILED'), {
      stage: 'FORGE_WSL2_PREREQUISITE',
      exitCode: invocation.status,
      rebootRequired: receipt.rebootRequired === true,
    });
  }

  const sourceAfter = readWsl2ScriptIdentity(runCommand, repositoryRoot, normalized.expectedHead, scriptPath);
  if (!validWsl2ScriptIdentity(sourceAfter, normalized.expectedHead) || sourceAfter.tree !== sourceBefore.tree) {
    return fail('FORGE_WSL2_POST_PREREQUISITE_SOURCE_IDENTITY_CHANGED');
  }
  const retry = await core.executeForgeShadowM2OnBattleBridge(normalized, options);
  if (retry?.ok === false && retry?.blocker === 'WSL2_NOT_AVAILABLE') {
    return fail('WSL2_PROOF_NOT_READY_AFTER_CONFIGURATION', { stage: 'FORGE_WSL2_PREREQUISITE_RETRY' });
  }
  return retry;
}
