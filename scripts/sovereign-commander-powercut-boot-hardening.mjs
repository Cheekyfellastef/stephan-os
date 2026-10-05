#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const SOVEREIGN_COMMANDER_POWERCUT_BOOT_HARDENING_SCHEMA =
  'stephanos.sovereign-commander-powercut-boot-hardening.v1';
export const SOVEREIGN_COMMANDER_POWERCUT_BOOT_HARDENING_MARKER =
  'SOVEREIGN_COMMANDER_POWERCUT_BOOT_HARDENING_RESULT=';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = 'C:\\Program Files\\Git\\cmd\\git.exe';
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const bootstrap = resolve(repoRoot, 'scripts', 'windows', 'install-sovereign-boot-daemon-tasks-elevated.ps1');
const SHA = /^[0-9a-f]{40}$/;
const SAFE_BLOCKER = /^[A-Z0-9][A-Z0-9._:-]{0,159}$/;

function text(value) {
  return String(value ?? '').trim();
}

function run(executable, args, timeoutMs = 20_000) {
  const result = spawnSync(executable, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 256 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return Object.freeze({
    ok: !result?.error && Number(result?.status) === 0,
    status: Number.isInteger(result?.status) ? result.status : null,
    stdout: String(result?.stdout || ''),
    errorCode: text(result?.error?.code || result?.error?.message),
  });
}

function safeBlocker(value, fallback) {
  const candidate = text(value);
  return SAFE_BLOCKER.test(candidate) ? candidate : fallback;
}

function parseBootstrapReceipt(stdout) {
  const raw = text(stdout);
  if (!raw) return null;
  const candidates = [raw, ...raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse()];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

function resultPayload({
  ok,
  blocker = '',
  sourceHead = '',
  bootstrapExitCode = null,
  bootstrapVerdict = '',
  tasks = [],
} = {}) {
  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_POWERCUT_BOOT_HARDENING_SCHEMA,
    ok: ok === true,
    blocker: ok === true ? '' : safeBlocker(blocker, 'POWERCUT_BOOT_HARDENING_BLOCKED'),
    sourceHead: SHA.test(sourceHead) ? sourceHead : '',
    bootstrapExitCode: Number.isInteger(bootstrapExitCode) ? bootstrapExitCode : null,
    bootstrapVerdict: text(bootstrapVerdict).slice(0, 120),
    bootSafeTaskCount: tasks.filter((task) => task?.bootSafe === true).length,
    expectedBootSafeTaskCount: 3,
    taskNames: Object.freeze(tasks.map((task) => text(task?.taskName)).filter(Boolean).slice(0, 3)),
    operatorApprovalBound: true,
    exactHeadBound: true,
    oneTimeElevationOnly: true,
    arbitraryShellAllowed: false,
    arbitraryTaskNameAllowed: false,
    arbitraryExecutableAllowed: false,
    callerSelectedPathAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    pcRestartAuthority: false,
    finalVerdict: ok === true
      ? 'SOVEREIGN_COMMANDER_POWERCUT_BOOT_HARDENING_PROVEN'
      : 'SOVEREIGN_COMMANDER_POWERCUT_BOOT_HARDENING_BLOCKED',
  });
}

export function runSovereignCommanderPowercutBootHardening({
  runFixed = run,
  fileExists = existsSync,
} = {}) {
  if (!fileExists(git) || !fileExists(powershell) || !fileExists(bootstrap)) {
    return resultPayload({ ok: false, blocker: 'POWERCUT_BOOT_HARDENING_FIXED_DEPENDENCY_MISSING' });
  }

  const branch = runFixed(git, ['-C', repoRoot, 'branch', '--show-current'], 10_000);
  if (!branch.ok || text(branch.stdout) !== 'main') {
    return resultPayload({ ok: false, blocker: 'POWERCUT_BOOT_HARDENING_CANONICAL_MAIN_REQUIRED' });
  }

  const headResult = runFixed(git, ['-C', repoRoot, 'rev-parse', 'HEAD'], 10_000);
  const sourceHead = text(headResult.stdout).toLowerCase();
  if (!headResult.ok || !SHA.test(sourceHead)) {
    return resultPayload({ ok: false, blocker: 'POWERCUT_BOOT_HARDENING_SOURCE_HEAD_INVALID' });
  }

  const hardened = runFixed(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', bootstrap,
    '-ExpectedHead', sourceHead,
    '-OperatorApproved',
  ], 250_000);
  const receipt = parseBootstrapReceipt(hardened.stdout);
  if (!receipt) {
    return resultPayload({
      ok: false,
      blocker: hardened.errorCode
        ? 'POWERCUT_BOOT_HARDENING_BOOTSTRAP_EXECUTION_FAILED'
        : 'POWERCUT_BOOT_HARDENING_BOOTSTRAP_RECEIPT_INVALID',
      sourceHead,
      bootstrapExitCode: hardened.status,
    });
  }

  const receiptHead = text(receipt.expectedHead).toLowerCase();
  const tasks = Array.isArray(receipt.tasks) ? receipt.tasks : [];
  const expectedTaskNames = new Set([
    'Stephanos Sovereign Commander',
    'Stephanos Battle Bridge Recovery Mesh',
    'Stephanos Battle Bridge Recovery Mesh Guardian',
  ]);
  const taskNames = new Set(tasks.map((task) => text(task?.taskName)));
  const taskProofOk = tasks.length === 3
    && tasks.every((task) => task?.bootSafe === true)
    && [...expectedTaskNames].every((name) => taskNames.has(name));

  const ok = hardened.ok
    && receipt.ok === true
    && receipt.schemaVersion === 'stephanos.sovereign-boot-daemon-bootstrap.v1'
    && receipt.finalVerdict === 'SOVEREIGN_BOOT_DAEMON_TASKS_INSTALLED_AND_PROVEN'
    && receiptHead === sourceHead
    && receipt.oneTimeElevationOnly === true
    && receipt.standingElevatedTaskCreated === false
    && receipt.pcRestartAuthority === false
    && receipt.sourceMutationAllowed === false
    && taskProofOk;

  return resultPayload({
    ok,
    blocker: ok ? '' : safeBlocker(receipt.blocker, 'POWERCUT_BOOT_HARDENING_BOOTSTRAP_UNPROVEN'),
    sourceHead,
    bootstrapExitCode: hardened.status,
    bootstrapVerdict: receipt.finalVerdict,
    tasks,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runSovereignCommanderPowercutBootHardening();
  process.stdout.write(SOVEREIGN_COMMANDER_POWERCUT_BOOT_HARDENING_MARKER + JSON.stringify(result) + '\n');
  process.exitCode = result.ok ? 0 : 2;
}
