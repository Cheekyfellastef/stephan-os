#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  appendWorkspaceJsonl,
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceStatusRecord,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  APPROVED_WORKER_TASK,
  assessMissionOrchestratorWorker,
  buildWorkerWatchdogRecoveryDecision,
} from './battle-bridge-worker-watchdog-policy.mjs';

export const BATTLE_BRIDGE_WORKER_WATCHDOG_SCHEMA = 'stephanos.battle-bridge-worker-watchdog-runner.v1';
export const BATTLE_BRIDGE_WORKER_WATCHDOG_TASK_NAME = 'Stephanos Mission Orchestrator Worker Watchdog';
export const WORKER_WATCHDOG_LOCK_STALE_AFTER_MS = 2 * 60 * 1000;
export const WORKER_WATCHDOG_RESTART_COOLDOWN_MS = 5 * 60 * 1000;
export const WORKER_WATCHDOG_AUTHORITY = Object.freeze({
  approvedWorkerTask: APPROVED_WORKER_TASK,
  arbitraryShellAllowed: false,
  arbitraryPowerShellAllowed: false,
  arbitraryTaskNameAllowed: false,
  processKillAllowed: false,
  pcRestartAllowed: false,
  sourceMutationAllowed: false,
  visiblePowerShellRequired: false,
  maximumStartsPerRun: 1,
});

const FIXED_PROBE_MODES = new Set(['Inspect', 'StartApprovedWorkerTask']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function isoStamp(value) {
  return value.toISOString().replace(/[:.]/g, '-');
}

function within(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function pathIsDirectory(target) {
  try { return (await stat(target)).isDirectory(); } catch { return false; }
}

function defaultProcessIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function resolveCanonicalWorkerWatchdogPaths({ env = process.env, home = os.homedir() } = {}) {
  const userHome = path.resolve(env.USERPROFILE || env.HOME || home);
  const repoRoot = path.resolve(userHome, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.resolve(userHome, 'Documents', 'Stephanos-openclaw-workspace');
  return Object.freeze({
    repoRoot,
    workspaceRoot,
    probeScriptPath: path.resolve(repoRoot, 'scripts', 'windows', 'probe-mission-orchestrator-worker-watchdog.ps1'),
    currentStatusPath: path.resolve(workspaceRoot, 'status', 'battle-bridge-worker-watchdog-current.json'),
  });
}

export function validateCanonicalWorkerWatchdogPaths({ paths, expectedPaths }) {
  if (path.resolve(paths.repoRoot) !== path.resolve(expectedPaths.repoRoot)) return { ok: false, reason: 'NON_CANONICAL_REPOSITORY_PATH' };
  if (path.resolve(paths.workspaceRoot) !== path.resolve(expectedPaths.workspaceRoot)) return { ok: false, reason: 'NON_CANONICAL_WORKSPACE_PATH' };
  if (path.resolve(paths.probeScriptPath) !== path.resolve(expectedPaths.probeScriptPath)) return { ok: false, reason: 'NON_CANONICAL_PROBE_PATH' };
  if (within(paths.repoRoot, paths.workspaceRoot) || within(paths.workspaceRoot, paths.repoRoot)) return { ok: false, reason: 'REPOSITORY_WORKSPACE_OVERLAP' };
  return { ok: true, reason: 'CANONICAL_WORKER_WATCHDOG_PATHS_VERIFIED' };
}

export function createFixedWorkerProbeAdapter({
  probeScriptPath,
  spawnSyncFn = spawnSync,
  powerShellExecutable = 'powershell.exe',
} = {}) {
  const fixedProbePath = path.resolve(text(probeScriptPath));
  return Object.freeze({
    run(mode) {
      if (!FIXED_PROBE_MODES.has(mode)) throw new Error(`Unsupported worker watchdog probe mode: ${mode}`);
      const result = spawnSyncFn(powerShellExecutable, [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fixedProbePath,
        '-Mode',
        mode,
      ], {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (result.error || result.status !== 0) {
        return Object.freeze({
          ok: false,
          mode,
          status: result.status,
          error: result.error?.message || text(result.stderr) || text(result.stdout) || `Probe exited with ${result.status}.`,
          performsShellExecution: false,
          visiblePowerShellRequired: false,
        });
      }
      try {
        return Object.freeze({
          ok: true,
          mode,
          data: JSON.parse(result.stdout),
          performsShellExecution: false,
          visiblePowerShellRequired: false,
        });
      } catch {
        return Object.freeze({ ok: false, mode, error: 'Worker watchdog probe returned invalid JSON.', performsShellExecution: false, visiblePowerShellRequired: false });
      }
    },
  });
}

async function acquireSingleInstanceLock(workspaceRoot, now, {
  processIsAliveFn = defaultProcessIsAlive,
  staleAfterMs = WORKER_WATCHDOG_LOCK_STALE_AFTER_MS,
  allowRecovery = true,
} = {}) {
  const lockPath = path.resolve(workspaceRoot, 'locks', 'battle-bridge-worker-watchdog.lock');
  await mkdir(path.dirname(lockPath), { recursive: true });
  try {
    const handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAtUtc: now.toISOString() })}\n`);
    await handle.close();
    return { ok: true, lockPath };
  } catch (error) {
    if (error?.code !== 'EEXIST') return { ok: false, reason: 'LOCK_ACQUISITION_FAILED', lockPath, error: error?.message || String(error) };
    let parsed = null;
    let lockStat = null;
    try { parsed = JSON.parse(await readFile(lockPath, 'utf8')); } catch {}
    try { lockStat = await stat(lockPath); } catch {}
    const acquiredAtMs = Number.isFinite(Date.parse(text(parsed?.acquiredAtUtc)))
      ? Date.parse(text(parsed?.acquiredAtUtc))
      : lockStat?.mtimeMs;
    const ageMs = Number.isFinite(acquiredAtMs) ? now.getTime() - acquiredAtMs : NaN;
    const ownerAlive = processIsAliveFn(Number.parseInt(parsed?.pid, 10));
    if (allowRecovery && Number.isFinite(ageMs) && ageMs > staleAfterMs && !ownerAlive) {
      await rm(lockPath, { force: true });
      const recovered = await acquireSingleInstanceLock(workspaceRoot, now, { processIsAliveFn, staleAfterMs, allowRecovery: false });
      return { ...recovered, recoveredStaleLock: recovered.ok, staleLock: { ageMs, pid: parsed?.pid ?? null } };
    }
    return { ok: false, reason: 'WORKER_WATCHDOG_ALREADY_RUNNING', lockPath, ownerAlive, ageMs };
  }
}

async function readPreviousStatus(currentStatusPath) {
  try { return JSON.parse(await readFile(currentStatusPath, 'utf8')); } catch { return null; }
}

function restartCooldownActive(previousStatus, now, restartCooldownMs) {
  const previousRestartMs = Date.parse(text(previousStatus?.restartAttemptedAtUtc));
  return Number.isFinite(previousRestartMs) && now.getTime() - previousRestartMs >= 0 && now.getTime() - previousRestartMs < restartCooldownMs;
}

function summaryFor(classification) {
  const summaries = {
    WORKER_WATCHDOG_HEALTHY: 'Mission Orchestrator worker is healthy on canonical main; no action was taken.',
    WORKER_WATCHDOG_RECOVERED: 'The fixed Mission Orchestrator worker task was started once and the worker recovered within bounded probes.',
    WORKER_WATCHDOG_RECOVERY_FAILED: 'The fixed worker task was started once, but bounded recovery probes did not prove a healthy worker.',
    WORKER_WATCHDOG_RECOVERY_COOLDOWN: 'Worker recovery remains unhealthy, but another task start was blocked by the restart cooldown.',
    WORKER_WATCHDOG_BLOCKED: 'Worker recovery was blocked because the observed task or correlation did not satisfy the fixed policy.',
    WORKER_WATCHDOG_PROBE_FAILED: 'The fixed worker probe failed closed.',
    WORKER_WATCHDOG_START_FAILED: 'The fixed worker task start failed closed.',
    WORKER_WATCHDOG_LIVE_LOCK: 'Another watchdog instance owns the live lock; this run did not start the worker task.',
  };
  return summaries[classification] || `Worker watchdog completed with ${classification}.`;
}

async function publishWatchdogRecords({
  workspaceRoot,
  repoRoot,
  now,
  classification,
  initialAssessment = null,
  finalAssessment = null,
  restartAttempted = false,
  restartAttemptedAtUtc = '',
  recoveryProbeCount = 0,
  probeError = '',
}) {
  const timestampUtc = now.toISOString();
  const stamp = isoStamp(now);
  const receiptFile = `${stamp}-${classification.toLowerCase()}.json`;
  const receiptRelative = path.posix.join('receipts', 'battle-bridge-worker-watchdog', receiptFile);
  const proofRefs = [receiptRelative];
  const summary = summaryFor(classification);
  const common = {
    watchdogSchema: BATTLE_BRIDGE_WORKER_WATCHDOG_SCHEMA,
    watchdogTaskName: BATTLE_BRIDGE_WORKER_WATCHDOG_TASK_NAME,
    workerTaskName: APPROVED_WORKER_TASK,
    classification,
    initialAssessment,
    finalAssessment,
    restartAttempted,
    restartAttemptedAtUtc,
    recoveryProbeCount,
    probeError,
    workerKilledObserved: initialAssessment?.processHealthy === false,
    supervisorDetectedWorkerDown: initialAssessment?.healthy === false,
    supervisorRestartedWorker: restartAttempted,
    workerRecovered: finalAssessment?.healthy === true,
    workerFromMain: finalAssessment?.repositoryFromCanonicalMain === true,
    visiblePowerShellRequired: false,
    authority: WORKER_WATCHDOG_AUTHORITY,
  };
  const receiptRecord = Object.freeze({
    ...createSharedWorkspaceProofRecord({
      proofId: `battle-bridge-worker-watchdog-${stamp}`,
      timestampUtc,
      status: classification,
      summary,
      refs: proofRefs,
    }),
    correlationId: 'issue-1291-worker-watchdog',
    relatedIssue: '#1291',
    proofRefs,
    receiptType: 'battle-bridge-worker-watchdog-receipt',
    ...common,
  });
  const receiptWrite = await writeAtomicJson(
    workspaceRoot,
    ['receipts', 'battle-bridge-worker-watchdog', receiptFile],
    receiptRecord,
    { repoRoot, nowMs: now.getTime() },
  );
  if (!receiptWrite.ok) throw new Error(`Worker watchdog receipt write failed: ${receiptWrite.reason}`);
  const statusRecord = Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: 'battle-bridge-worker-watchdog-current',
      timestampUtc,
      status: classification,
      summary,
      proofRefs,
    }),
    ...common,
  });
  const statusWrite = await writeAtomicJson(
    workspaceRoot,
    ['status', 'battle-bridge-worker-watchdog-current.json'],
    statusRecord,
    { repoRoot, nowMs: now.getTime() },
  );
  if (!statusWrite.ok) throw new Error(`Worker watchdog status write failed: ${statusWrite.reason}`);
  const eventRecord = Object.freeze({
    ...createSharedWorkspaceEventRecord({
      eventId: `battle-bridge-worker-watchdog-${stamp}`,
      timestampUtc,
      eventKind: 'battle-bridge-worker-watchdog-run',
      summary,
    }),
    classification,
    proofRefs,
    supervisorDetectedWorkerDown: common.supervisorDetectedWorkerDown,
    supervisorRestartedWorker: common.supervisorRestartedWorker,
    workerRecovered: common.workerRecovered,
    workerFromMain: common.workerFromMain,
    visiblePowerShellRequired: false,
  });
  const eventWrite = await appendWorkspaceJsonl(
    workspaceRoot,
    ['events', 'battle-bridge-worker-watchdog.jsonl'],
    eventRecord,
    { repoRoot, nowMs: now.getTime() },
  );
  if (!eventWrite.ok) throw new Error(`Worker watchdog event write failed: ${eventWrite.reason}`);
  return Object.freeze({
    receiptPath: receiptWrite.path,
    statusPath: statusWrite.path,
    eventPath: eventWrite.path,
    proofRefs,
    proofWrittenToSharedWorkspace: true,
  });
}

export async function runBattleBridgeWorkerWatchdog({
  env = process.env,
  now = new Date(),
  paths = resolveCanonicalWorkerWatchdogPaths({ env }),
  expectedPaths = resolveCanonicalWorkerWatchdogPaths({ env }),
  probeAdapter = createFixedWorkerProbeAdapter({ probeScriptPath: paths.probeScriptPath }),
  processIsAliveFn = defaultProcessIsAlive,
  staleAfterMs = WORKER_WATCHDOG_LOCK_STALE_AFTER_MS,
  restartCooldownMs = WORKER_WATCHDOG_RESTART_COOLDOWN_MS,
  sleep = (delayMs) => new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs)),
} = {}) {
  const pathValidation = validateCanonicalWorkerWatchdogPaths({ paths, expectedPaths });
  if (!pathValidation.ok) return Object.freeze({ ok: false, classification: 'WORKER_WATCHDOG_BLOCKED', pathValidation });
  if (!(await pathIsDirectory(paths.repoRoot))) return Object.freeze({ ok: false, classification: 'WORKER_WATCHDOG_BLOCKED', reason: 'CANONICAL_REPOSITORY_MISSING' });
  await mkdir(paths.workspaceRoot, { recursive: true });
  const lock = await acquireSingleInstanceLock(paths.workspaceRoot, now, { processIsAliveFn, staleAfterMs });
  if (!lock.ok) {
    let publication = null;
    try {
      publication = await publishWatchdogRecords({
        workspaceRoot: paths.workspaceRoot,
        repoRoot: paths.repoRoot,
        now,
        classification: 'WORKER_WATCHDOG_LIVE_LOCK',
        probeError: lock.reason,
      });
    } catch {}
    return Object.freeze({ ok: false, classification: 'WORKER_WATCHDOG_LIVE_LOCK', lock, publication });
  }

  try {
    const initialProbe = probeAdapter.run('Inspect');
    if (!initialProbe.ok) {
      const publication = await publishWatchdogRecords({ workspaceRoot: paths.workspaceRoot, repoRoot: paths.repoRoot, now, classification: 'WORKER_WATCHDOG_PROBE_FAILED', probeError: initialProbe.error });
      return Object.freeze({ ok: false, classification: 'WORKER_WATCHDOG_PROBE_FAILED', initialProbe, publication });
    }
    const decision = buildWorkerWatchdogRecoveryDecision({ ...initialProbe.data, nowMs: now.getTime(), related: 'issue:#1291' });
    const initialAssessment = decision.assessment;
    if (decision.action === 'NO_OP') {
      const publication = await publishWatchdogRecords({ workspaceRoot: paths.workspaceRoot, repoRoot: paths.repoRoot, now, classification: 'WORKER_WATCHDOG_HEALTHY', initialAssessment, finalAssessment: initialAssessment });
      return Object.freeze({ ok: true, classification: 'WORKER_WATCHDOG_HEALTHY', decision, publication });
    }
    if (decision.action !== 'START_APPROVED_WORKER_TASK' || decision.restartTaskName !== APPROVED_WORKER_TASK) {
      const publication = await publishWatchdogRecords({ workspaceRoot: paths.workspaceRoot, repoRoot: paths.repoRoot, now, classification: 'WORKER_WATCHDOG_BLOCKED', initialAssessment, finalAssessment: initialAssessment });
      return Object.freeze({ ok: false, classification: 'WORKER_WATCHDOG_BLOCKED', decision, publication });
    }

    const previousStatus = await readPreviousStatus(paths.currentStatusPath);
    if (restartCooldownActive(previousStatus, now, restartCooldownMs)) {
      const publication = await publishWatchdogRecords({
        workspaceRoot: paths.workspaceRoot,
        repoRoot: paths.repoRoot,
        now,
        classification: 'WORKER_WATCHDOG_RECOVERY_COOLDOWN',
        initialAssessment,
        finalAssessment: initialAssessment,
        restartAttemptedAtUtc: text(previousStatus.restartAttemptedAtUtc),
      });
      return Object.freeze({ ok: false, classification: 'WORKER_WATCHDOG_RECOVERY_COOLDOWN', decision, publication });
    }

    const startResult = probeAdapter.run('StartApprovedWorkerTask');
    const restartAttemptedAtUtc = now.toISOString();
    if (!startResult.ok || startResult.data?.started !== true || startResult.data?.taskName !== APPROVED_WORKER_TASK) {
      const publication = await publishWatchdogRecords({
        workspaceRoot: paths.workspaceRoot,
        repoRoot: paths.repoRoot,
        now,
        classification: 'WORKER_WATCHDOG_START_FAILED',
        initialAssessment,
        finalAssessment: initialAssessment,
        restartAttempted: true,
        restartAttemptedAtUtc,
        probeError: startResult.error || 'Fixed worker task start was not proven.',
      });
      return Object.freeze({ ok: false, classification: 'WORKER_WATCHDOG_START_FAILED', decision, startResult, publication });
    }

    let finalAssessment = initialAssessment;
    let recoveryProbeCount = 0;
    let lastProbeError = '';
    for (let attempt = 1; attempt <= decision.boundedProbeAttempts; attempt += 1) {
      await sleep(decision.boundedProbeIntervalMs);
      recoveryProbeCount = attempt;
      const recoveryProbe = probeAdapter.run('Inspect');
      if (!recoveryProbe.ok) {
        lastProbeError = recoveryProbe.error;
        continue;
      }
      finalAssessment = assessMissionOrchestratorWorker({ ...recoveryProbe.data, nowMs: Date.now() });
      if (finalAssessment.healthy) break;
    }
    const recovered = finalAssessment.healthy === true;
    const classification = recovered ? 'WORKER_WATCHDOG_RECOVERED' : 'WORKER_WATCHDOG_RECOVERY_FAILED';
    const publication = await publishWatchdogRecords({
      workspaceRoot: paths.workspaceRoot,
      repoRoot: paths.repoRoot,
      now: new Date(),
      classification,
      initialAssessment,
      finalAssessment,
      restartAttempted: true,
      restartAttemptedAtUtc,
      recoveryProbeCount,
      probeError: lastProbeError,
    });
    return Object.freeze({ ok: recovered, classification, decision, startResult, initialAssessment, finalAssessment, recoveryProbeCount, publication });
  } catch (error) {
    let publication = null;
    try {
      publication = await publishWatchdogRecords({ workspaceRoot: paths.workspaceRoot, repoRoot: paths.repoRoot, now: new Date(), classification: 'WORKER_WATCHDOG_PROBE_FAILED', probeError: error?.message || String(error) });
    } catch {}
    return Object.freeze({ ok: false, classification: 'WORKER_WATCHDOG_PROBE_FAILED', error: error?.message || String(error), publication });
  } finally {
    await rm(lock.lockPath, { force: true }).catch(() => {});
  }
}

export function isDirectCliEntrypoint({ metaUrl = import.meta.url, argv1 = process.argv[1] } = {}) {
  if (!argv1) return false;
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(argv1);
}

if (isDirectCliEntrypoint()) {
  const result = await runBattleBridgeWorkerWatchdog();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
