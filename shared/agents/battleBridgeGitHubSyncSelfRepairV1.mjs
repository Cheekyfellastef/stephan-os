import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';

import { classifyDirt } from '../../scripts/battle-bridge-github-sync-policy.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';

export const BATTLE_BRIDGE_GITHUB_SYNC_SELF_REPAIR_SCHEMA = 'stephanos.battle-bridge-github-sync-self-repair.v1';
export const BATTLE_BRIDGE_GITHUB_SYNC_TASK = 'Stephanos Battle Bridge GitHub Sync';
export const BATTLE_BRIDGE_GITHUB_SYNC_STATUS_SCRIPT = 'scripts/windows/status-battle-bridge-github-sync.ps1';
export const BATTLE_BRIDGE_GITHUB_SYNC_INSTALLER = 'scripts/windows/install-battle-bridge-github-sync.ps1';
export const BATTLE_BRIDGE_GITHUB_SYNC_HEALTHY = 'BATTLE_BRIDGE_GITHUB_SYNC_TASK_HEALTHY';
export const BATTLE_BRIDGE_GITHUB_SYNC_REPAIRED = 'BATTLE_BRIDGE_GITHUB_SYNC_TASK_REPAIRED';
export const BATTLE_BRIDGE_GITHUB_SYNC_MAX_LAST_RUN_AGE_MS = 30 * 60 * 1000;

const SHA = /^[0-9a-f]{40}$/;
const MAX_OUTPUT_BYTES = 128 * 1024;

function text(value) {
  return String(value ?? '').trim();
}

function splitLines(value) {
  return String(value ?? '').split(/\r?\n/).filter((line) => line.trim());
}

function blocked(blocker, details = {}) {
  return Object.freeze({
    ok: false,
    schemaVersion: BATTLE_BRIDGE_GITHUB_SYNC_SELF_REPAIR_SCHEMA,
    blocker,
    taskName: BATTLE_BRIDGE_GITHUB_SYNC_TASK,
    branch: '',
    sourceHead: '',
    sourceDirtSafe: false,
    inspected: false,
    taskHealthy: false,
    repairAttempted: false,
    mutationPerformed: false,
    sourceMutationAllowed: false,
    gitMutationAllowed: false,
    arbitraryTaskNameAllowed: false,
    arbitraryExecutableAllowed: false,
    arbitraryShellAllowed: false,
    codexRequired: false,
    pcRestartAllowed: false,
    finalVerdict: 'BATTLE_BRIDGE_GITHUB_SYNC_SELF_REPAIR_BLOCKED',
    ...details,
  });
}

function capture(spawnSyncFn, executable, args, { cwd, timeout = 120_000 } = {}) {
  const result = spawnSyncFn(executable, [...args], {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  return Object.freeze({
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    stdout: String(result?.stdout ?? ''),
    stderr: String(result?.stderr ?? '').slice(0, 1000),
    errorCode: result?.error?.code || '',
  });
}

function parseJsonObject(value) {
  const payload = text(value).replace(/^\uFEFF/, '');
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function regularSourceFile(pathname, lstatFn) {
  try {
    const info = lstatFn(pathname);
    return info?.isFile?.() === true && info?.isSymbolicLink?.() !== true && Number(info?.nlink || 1) === 1;
  } catch {
    return false;
  }
}

function sourceIdentity({ repoRoot, expectedHead, spawnSyncFn }) {
  const normalizedExpectedHead = text(expectedHead).toLowerCase();
  if (!SHA.test(normalizedExpectedHead)) return blocked('GITHUB_SYNC_SELF_REPAIR_EXPECTED_HEAD_INVALID');
  const branch = capture(spawnSyncFn, BATTLE_BRIDGE_WINDOWS_HOST.git, ['-C', repoRoot, 'branch', '--show-current'], { cwd: repoRoot });
  if (!branch.ok || text(branch.stdout) !== 'main') return blocked('GITHUB_SYNC_SELF_REPAIR_SOURCE_BRANCH_NOT_MAIN');
  const head = capture(spawnSyncFn, BATTLE_BRIDGE_WINDOWS_HOST.git, ['-C', repoRoot, 'rev-parse', 'HEAD'], { cwd: repoRoot });
  const sourceHead = text(head.stdout).toLowerCase();
  if (!head.ok || sourceHead !== normalizedExpectedHead) {
    return blocked('GITHUB_SYNC_SELF_REPAIR_SOURCE_HEAD_MISMATCH', { branch: 'main', sourceHead });
  }
  const status = capture(spawnSyncFn, BATTLE_BRIDGE_WINDOWS_HOST.git, ['-C', repoRoot, 'status', '--porcelain=v1', '--untracked-files=all'], { cwd: repoRoot });
  if (!status.ok) return blocked('GITHUB_SYNC_SELF_REPAIR_SOURCE_STATUS_FAILED', { branch: 'main', sourceHead });
  const dirt = classifyDirt(splitLines(status.stdout));
  const dirtSummary = Object.freeze({
    trackedSourceCount: dirt.trackedSource.length,
    untrackedSourceCount: dirt.untrackedSource.length,
    runtimeOnlyCount: dirt.runtimeOnly.length,
    generatedSourceCount: dirt.generatedSource.length,
    unknownCount: dirt.unknown.length,
    blocksSync: dirt.blocksSync === true,
  });
  if (dirt.blocksSync) {
    return blocked('GITHUB_SYNC_SELF_REPAIR_SOURCE_DIRT_BLOCKED', {
      branch: 'main',
      sourceHead,
      dirtSummary,
    });
  }
  return Object.freeze({ ok: true, branch: 'main', sourceHead, sourceDirtSafe: true, dirtSummary });
}

function taskObservationHealthy(payload, nowMs) {
  if (!payload || payload.taskName !== BATTLE_BRIDGE_GITHUB_SYNC_TASK || payload.installed !== true) return false;
  const taskState = text(payload.taskState);
  if (taskState === 'Running') return true;
  if (taskState !== 'Ready' || Number(payload.lastTaskResult) !== 0) return false;
  const lastRunMs = Date.parse(String(payload.lastRunTime || ''));
  return Number.isFinite(lastRunMs) && nowMs >= lastRunMs && nowMs - lastRunMs <= BATTLE_BRIDGE_GITHUB_SYNC_MAX_LAST_RUN_AGE_MS;
}

function installerReceiptValid(payload) {
  return Boolean(
    payload
    && payload.taskName === BATTLE_BRIDGE_GITHUB_SYNC_TASK
    && payload.installed === true
    && payload.startedNow === true
    && Number(payload.intervalMinutes) === 15
    && payload.atLogon === true
    && payload.hidden === true
    && payload.runLevel === 'Limited'
    && payload.arbitraryShellAllowed === false
    && payload.liveOpenClawUpdateAllowed === false
    && payload.headlessLauncher === true
  );
}

export function reconcileBattleBridgeGitHubSyncTask({
  repoRoot = '',
  expectedHead = '',
  platform = process.platform,
  now = new Date(),
  spawnSyncFn = spawnSync,
  lstatFn = lstatSync,
} = {}) {
  if (platform !== 'win32') return blocked('WINDOWS_REQUIRED');
  const canonicalRoot = resolve(repoRoot);
  const identity = sourceIdentity({ repoRoot: canonicalRoot, expectedHead, spawnSyncFn });
  if (!identity.ok) return identity;

  const statusScript = resolve(canonicalRoot, BATTLE_BRIDGE_GITHUB_SYNC_STATUS_SCRIPT);
  const installerScript = resolve(canonicalRoot, BATTLE_BRIDGE_GITHUB_SYNC_INSTALLER);
  if (!regularSourceFile(statusScript, lstatFn) || !regularSourceFile(installerScript, lstatFn)) {
    return blocked('GITHUB_SYNC_SELF_REPAIR_FIXED_SCRIPT_UNSAFE', {
      branch: identity.branch,
      sourceHead: identity.sourceHead,
      sourceDirtSafe: true,
      dirtSummary: identity.dirtSummary,
    });
  }

  const inspection = capture(spawnSyncFn, BATTLE_BRIDGE_WINDOWS_HOST.powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', statusScript,
  ], { cwd: canonicalRoot });
  if (!inspection.ok) {
    return blocked('GITHUB_SYNC_SELF_REPAIR_STATUS_PROBE_FAILED', {
      branch: identity.branch,
      sourceHead: identity.sourceHead,
      sourceDirtSafe: true,
      dirtSummary: identity.dirtSummary,
    });
  }
  const observed = parseJsonObject(inspection.stdout);
  if (!observed) {
    return blocked('GITHUB_SYNC_SELF_REPAIR_STATUS_JSON_INVALID', {
      branch: identity.branch,
      sourceHead: identity.sourceHead,
      sourceDirtSafe: true,
      dirtSummary: identity.dirtSummary,
    });
  }

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return blocked('GITHUB_SYNC_SELF_REPAIR_TIME_INVALID');
  if (taskObservationHealthy(observed, nowMs)) {
    return Object.freeze({
      ok: true,
      schemaVersion: BATTLE_BRIDGE_GITHUB_SYNC_SELF_REPAIR_SCHEMA,
      blocker: '',
      taskName: BATTLE_BRIDGE_GITHUB_SYNC_TASK,
      branch: identity.branch,
      sourceHead: identity.sourceHead,
      sourceDirtSafe: true,
      dirtSummary: identity.dirtSummary,
      inspected: true,
      taskHealthy: true,
      taskState: text(observed.taskState),
      lastTaskResult: Number(observed.lastTaskResult),
      repairAttempted: false,
      mutationPerformed: false,
      sourceMutationAllowed: false,
      gitMutationAllowed: false,
      arbitraryTaskNameAllowed: false,
      arbitraryExecutableAllowed: false,
      arbitraryShellAllowed: false,
      codexRequired: false,
      pcRestartAllowed: false,
      finalVerdict: BATTLE_BRIDGE_GITHUB_SYNC_HEALTHY,
    });
  }

  const repair = capture(spawnSyncFn, BATTLE_BRIDGE_WINDOWS_HOST.powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', installerScript, '-StartNow',
  ], { cwd: canonicalRoot, timeout: 180_000 });
  if (!repair.ok) {
    return blocked('GITHUB_SYNC_SELF_REPAIR_FIXED_INSTALLER_FAILED', {
      branch: identity.branch,
      sourceHead: identity.sourceHead,
      sourceDirtSafe: true,
      dirtSummary: identity.dirtSummary,
      inspected: true,
      repairAttempted: true,
    });
  }
  const receipt = parseJsonObject(repair.stdout);
  if (!installerReceiptValid(receipt)) {
    return blocked('GITHUB_SYNC_SELF_REPAIR_INSTALLER_RECEIPT_INVALID', {
      branch: identity.branch,
      sourceHead: identity.sourceHead,
      sourceDirtSafe: true,
      dirtSummary: identity.dirtSummary,
      inspected: true,
      repairAttempted: true,
    });
  }

  return Object.freeze({
    ok: true,
    schemaVersion: BATTLE_BRIDGE_GITHUB_SYNC_SELF_REPAIR_SCHEMA,
    blocker: '',
    taskName: BATTLE_BRIDGE_GITHUB_SYNC_TASK,
    branch: identity.branch,
    sourceHead: identity.sourceHead,
    sourceDirtSafe: true,
    dirtSummary: identity.dirtSummary,
    inspected: true,
    taskHealthy: false,
    observedTaskState: text(observed.taskState || 'Missing'),
    observedLastTaskResult: observed.lastTaskResult === null || observed.lastTaskResult === undefined ? null : Number(observed.lastTaskResult),
    repairAttempted: true,
    mutationPerformed: true,
    mutationScope: 'canonical-scheduled-task-registration-and-start-only',
    sourceMutationAllowed: false,
    gitMutationAllowed: false,
    arbitraryTaskNameAllowed: false,
    arbitraryExecutableAllowed: false,
    arbitraryShellAllowed: false,
    codexRequired: false,
    pcRestartAllowed: false,
    finalVerdict: BATTLE_BRIDGE_GITHUB_SYNC_REPAIRED,
  });
}
