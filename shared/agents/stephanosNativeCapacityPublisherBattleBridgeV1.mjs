import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { classifyDirt } from '../../scripts/battle-bridge-github-sync-policy.mjs';

export const STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION = 'INSTALL_STEPHANOS_NATIVE_CAPACITY_PUBLISHER';

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const ALLOWED_FIELDS = new Set([
  'schemaVersion',
  'requestId',
  'operation',
  'repository',
  'issueNumber',
  'branch',
  'operatorApproval',
  'expectedHead',
  'expiresAt',
]);
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const TIMEOUT_MS = 60_000;

function text(value) {
  return String(value ?? '').trim();
}

function splitLines(value) {
  return String(value ?? '').split(/\r?\n/).filter((line) => line.trim());
}

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function fixedRepositoryRoot(env = process.env) {
  const profile = text(env.USERPROFILE);
  return profile ? resolve(profile, 'Documents', 'GitHub', 'stephan-os') : '';
}

export function validateStephanosNativeCapacityPublisherInstallCommandShape(command = {}) {
  if (text(command?.operation) !== STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION) {
    return Object.freeze({ ok: true, requested: false });
  }
  const unexpectedField = Object.keys(command).find((field) => !ALLOWED_FIELDS.has(field));
  if (unexpectedField) {
    return fail('STEPHANOS_NATIVE_PUBLISHER_FIELD_NOT_ALLOWED', {
      requested: true,
      field: unexpectedField,
    });
  }
  const expectedHead = text(command?.expectedHead).toLowerCase();
  if (!SHA_PATTERN.test(expectedHead)) {
    return fail('STEPHANOS_NATIVE_PUBLISHER_EXPECTED_HEAD_REQUIRED', { requested: true });
  }
  return Object.freeze({
    ok: true,
    requested: true,
    expectedHead,
    command: Object.freeze({ ...command, expectedHead }),
  });
}

export function isTerminalizableStephanosNativeCapacityPublisherBlocker(value) {
  return new Set([
    'STEPHANOS_NATIVE_PUBLISHER_FIELD_NOT_ALLOWED',
    'STEPHANOS_NATIVE_PUBLISHER_EXPECTED_HEAD_REQUIRED',
  ]).has(text(value));
}

function run(spawnSyncFn, executable, args, options = {}) {
  const result = spawnSyncFn(executable, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: TIMEOUT_MS,
    maxBuffer: 256 * 1024,
    ...options,
  });
  return Object.freeze({
    ok: !result?.error && Number(result?.status) === 0,
    status: Number.isInteger(result?.status) ? result.status : null,
    stdout: String(result?.stdout || ''),
    stderr: String(result?.stderr || ''),
  });
}

function lastJsonObject(stdout = '') {
  const lines = String(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

export async function executeStephanosNativeCapacityPublisherInstallOnBattleBridge(command = {}, options = {}) {
  const shape = validateStephanosNativeCapacityPublisherInstallCommandShape(command);
  if (!shape.ok || !shape.requested) return shape;

  const env = options?.env || process.env;
  const repositoryRoot = fixedRepositoryRoot(env);
  if (!repositoryRoot) return fail('STEPHANOS_NATIVE_PUBLISHER_USERPROFILE_REQUIRED');
  const spawnSyncFn = typeof options?.spawnSyncFn === 'function' ? options.spawnSyncFn : spawnSync;

  const branch = run(spawnSyncFn, GIT, ['-C', repositoryRoot, 'branch', '--show-current']);
  const head = run(spawnSyncFn, GIT, ['-C', repositoryRoot, 'rev-parse', 'HEAD']);
  const dirt = run(spawnSyncFn, GIT, ['-C', repositoryRoot, 'status', '--porcelain=v1', '--untracked-files=all']);
  const observedBranch = text(branch.stdout);
  const observedHead = text(head.stdout).toLowerCase();
  if (!branch.ok || !head.ok || !dirt.ok) return fail('STEPHANOS_NATIVE_PUBLISHER_SOURCE_IDENTITY_UNAVAILABLE');
  if (observedBranch !== 'main') return fail('STEPHANOS_NATIVE_PUBLISHER_CANONICAL_BRANCH_REQUIRED', { observedBranch });
  if (observedHead !== shape.expectedHead) {
    return fail('STEPHANOS_NATIVE_PUBLISHER_HEAD_MISMATCH', { expectedHead: shape.expectedHead, observedHead });
  }
  const dirtClassification = classifyDirt(splitLines(dirt.stdout));
  const dirtSummary = Object.freeze({
    trackedSourceCount: dirtClassification.trackedSource.length,
    untrackedSourceCount: dirtClassification.untrackedSource.length,
    runtimeOnlyCount: dirtClassification.runtimeOnly.length,
    generatedSourceCount: dirtClassification.generatedSource.length,
    unknownCount: dirtClassification.unknown.length,
    blocksSync: dirtClassification.blocksSync === true,
  });
  if (dirtClassification.blocksSync) {
    return fail('STEPHANOS_NATIVE_PUBLISHER_SOURCE_DIRT_BLOCKED', { dirtSummary });
  }

  const installer = resolve(repositoryRoot, 'scripts', 'windows', 'install-stephanos-native-capacity-publisher.ps1');
  const install = run(spawnSyncFn, POWERSHELL, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', installer,
    '-StephanosRepositoryRoot', repositoryRoot,
    '-StartNow',
  ]);
  if (!install.ok) {
    return fail('STEPHANOS_NATIVE_PUBLISHER_INSTALL_FAILED', {
      status: install.status,
      stderr: text(install.stderr).slice(0, 500),
    });
  }
  const receipt = lastJsonObject(install.stdout);
  if (
    !receipt
    || receipt.finalVerdict !== 'STEPHANOS_NATIVE_CAPACITY_PUBLISHER_TASK_INSTALLED'
    || text(receipt.sourceHead).toLowerCase() !== shape.expectedHead
    || receipt.startRequested !== true
    || receipt.arbitraryCommandAllowed !== false
    || receipt.mergeAuthority !== false
    || receipt.leaseSeizureAllowed !== false
  ) {
    return fail('STEPHANOS_NATIVE_PUBLISHER_INSTALL_RECEIPT_INVALID');
  }

  return Object.freeze({
    ok: true,
    verdict: 'COMMAND_EXECUTION_COMPLETE',
    operation: STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION,
    requestId: text(command.requestId),
    finalVerdict: 'STEPHANOS_NATIVE_CAPACITY_PUBLISHER_TASK_INSTALLED_AND_STARTED',
    sourceHead: shape.expectedHead,
    expectedHead: shape.expectedHead,
    expectedHeadMatch: true,
    taskName: text(receipt.taskName),
    startRequested: true,
    dirtSummary,
    arbitraryCommandAllowed: false,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    destructiveGitAllowed: false,
  });
}
