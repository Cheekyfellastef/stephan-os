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
export const WORKER_WATCHDOG_RUN_BUDGET_MS = 110_000;
export const WORKER_WATCHDOG_INITIAL_PROBE_TIMEOUT_MS = 5_000;
export const WORKER_WATCHDOG_START_TIMEOUT_MS = 95_000;

const BOUNDED_MISSION_WORKER_RESTART_BLOCKERS = new Set([
  'MISSION_WORKER_RESTART_DEADLINE_EXHAUSTED',
  'MISSION_WORKER_INVOCATION_RECORD_TOO_LARGE',
  'MISSION_WORKER_RESTART_REQUEST_INVALID',
  'MISSION_WORKER_RESTART_REQUEST_ALREADY_PRESENT',
  'MISSION_WORKER_RESTART_REQUEST_CHANGED_BEFORE_RECLAIM',
  'MISSION_WORKER_RESTART_REQUEST_RECLAIM_FAILED',
  'MISSION_WORKER_RESTART_REQUEST_CLEANUP_IDENTITY_CHANGED',
  'MISSION_WORKER_RESTART_REQUEST_CLEANUP_FAILED',
  'MISSION_WORKER_CLEANUP_TASK_NOT_ALLOWLISTED',
  'MISSION_WORKER_CLEANUP_INVOCATION_ID_INVALID',
  'MISSION_WORKER_CLEANUP_INVOCATION_CLAIM_NOT_PROVEN',
  'MISSION_WORKER_CLEANUP_LAUNCH_RECEIPT_NOT_PROVEN',
  'MISSION_WORKER_CLEANUP_LAUNCH_RECEIPT_MISMATCH',
  'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_NOT_PROVEN',
  'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_CHANGED',
  'MISSION_WORKER_CLEANUP_PROCESS_DID_NOT_STOP',
  'MISSION_WORKER_CLEANUP_TASK_MISSING',
  'MISSION_WORKER_CLEANUP_TASK_DID_NOT_STOP',
  'MISSION_WORKER_RESTART_DEADLINE_REQUIRED',
  'MISSION_WORKER_RESTART_DEADLINE_INVALID',
  'MISSION_WORKER_TASK_DID_NOT_STOP',
  'MISSION_WORKER_EXISTING_PROCESS_IDENTITY_CHANGED',
  'MISSION_WORKER_EXISTING_PROCESS_CAPABILITY_CHANGED',
  'MISSION_WORKER_VERIFIED_PROCESS_DID_NOT_STOP',
  'MISSION_WORKER_CANONICAL_PROCESS_QUERY_FAILED',
  'MISSION_WORKER_CANONICAL_PROCESS_IDENTITY_AMBIGUOUS',
  'MISSION_WORKER_ORPHAN_PROCESS_IDENTITY_CHANGED',
  'MISSION_WORKER_ORPHAN_PROCESS_CAPABILITY_CHANGED',
  'MISSION_WORKER_ORPHAN_PROCESS_DID_NOT_STOP',
  'MISSION_WORKER_INVOCATION_ID_GENERATION_FAILED',
  'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT',
  'MISSION_WORKER_FRESH_INSTANCE_NOT_PROVEN',
  'MISSION_WORKER_INVOCATION_IDENTITY_NOT_PROVEN',
  'MISSION_WORKER_TASK_NOT_RUNNING_AFTER_START',
  'MISSION_WORKER_POST_START_PROOF_FAILED',
  'MISSION_WORKER_POST_START_CLEANUP_FAILED',
  'MISSION_WORKER_DEADLINE_SELF_CLEANUP_NOT_PROVEN',
]);

function extractBoundedMissionWorkerRestartBlocker(...values) {
  const candidates = new Set();
  for (const value of values) {
    const body = String(value ?? '').slice(0, 16 * 1024);
    for (const match of body.matchAll(/\bMISSION_WORKER_[A-Z0-9_]+\b/g)) {
      if (BOUNDED_MISSION_WORKER_RESTART_BLOCKERS.has(match[0])) candidates.add(match[0]);
    }
  }
  return candidates.size === 1 ? [...candidates][0] : '';
}
export const WORKER_WATCHDOG_RECOVERY_PROBE_TIMEOUT_MS = 5_000;
export const WORKER_WATCHDOG_PUBLICATION_RESERVE_MS = 5_000;
export const WORKER_WATCHDOG_CHILD_EXIT_RESERVE_MS = 10_000;
export const CANONICAL_WINDOWS_POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
export const WORKER_WATCHDOG_AUTHORITY = Object.freeze({
  approvedWorkerTask: APPROVED_WORKER_TASK,
  arbitraryShellAllowed: false,
  arbitraryPowerShellAllowed: false,
  arbitraryTaskNameAllowed: false,
  processKillAllowed: false,
  pcRestartAllowed: false,
  sourceMutationAllowed: false,
  verifiedOwnedWorkerTerminationAllowed: true,
  visiblePowerShellRequired: false,
  maximumStartsPerRun: 1,
});

const FIXED_PROBE_MODES = new Set(['Inspect', 'StartApprovedWorkerTask']);
const EXPLICIT_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const INVOCATION_ID = /^[0-9a-f]{64}$/;

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
  powerShellExecutable = CANONICAL_WINDOWS_POWERSHELL,
} = {}) {
  const fixedProbePath = path.resolve(text(probeScriptPath));
  return Object.freeze({
    run(mode, { timeoutMs, deadlineUtc = '' } = {}) {
      if (!FIXED_PROBE_MODES.has(mode)) throw new Error(`Unsupported worker watchdog probe mode: ${mode}`);
      const boundedTimeoutMs = Number.isSafeInteger(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : (mode === 'StartApprovedWorkerTask'
          ? WORKER_WATCHDOG_START_TIMEOUT_MS
          : WORKER_WATCHDOG_INITIAL_PROBE_TIMEOUT_MS);
      const boundedDeadlineUtc = text(deadlineUtc);
      if (mode === 'StartApprovedWorkerTask' && !EXPLICIT_UTC.test(boundedDeadlineUtc)) {
        throw new Error('Worker watchdog restart deadline must be an explicit UTC timestamp.');
      }
      if (mode === 'Inspect' && boundedDeadlineUtc) {
        throw new Error('Worker watchdog inspect mode cannot receive restart authority.');
      }
      const argumentsList = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fixedProbePath,
        '-Mode',
        mode,
      ];
      if (mode === 'StartApprovedWorkerTask') argumentsList.push('-DeadlineUtc', boundedDeadlineUtc);
      const result = spawnSyncFn(powerShellExecutable, argumentsList, {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: boundedTimeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GIT_REDIRECT_STDERR: 'off' },
      });
      if (result.error || result.status !== 0) {
        const restartBlocker = mode === 'StartApprovedWorkerTask'
          ? extractBoundedMissionWorkerRestartBlocker(result.error?.message, result.stderr, result.stdout)
          : '';
        return Object.freeze({
          ok: false,
          mode,
          status: result.status,
          restartBlocker,
          error: restartBlocker || result.error?.message || text(result.stderr) || text(result.stdout) || `Probe exited with ${result.status}.`,
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
  restartProof = null,
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
    workerKilledObserved: false,
    verifiedOwnedWorkerTerminationObserved: restartProof?.terminatedVerifiedOwnedProcess === true,
    restartExactHeadProofOk: restartProof?.exactHeadProofOk === true,
    restartProofFresh: restartProof?.proofFresh === true,
    restartSourceHead: text(restartProof?.sourceHead),
    restartVerdict: text(restartProof?.restartVerdict),
    restartBlocker: text(restartProof?.restartBlocker),
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
  clock = () => Date.now(),
} = {}) {
  const runStartedAtMs = Number(clock()) || Date.now();
  const remainingRunBudgetMs = () => Math.max(
    0,
    WORKER_WATCHDOG_RUN_BUDGET_MS - ((Number(clock()) || Date.now()) - runStartedAtMs),
  );
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
    const initialProbe = probeAdapter.run('Inspect', { timeoutMs: WORKER_WATCHDOG_INITIAL_PROBE_TIMEOUT_MS });
    if (!initialProbe.ok) {
      const publication = await publishWatchdogRecords({ workspaceRoot: paths.workspaceRoot, repoRoot: paths.repoRoot, now, classification: 'WORKER_WATCHDOG_PROBE_FAILED', probeError: initialProbe.error });
      return Object.freeze({ ok: false, classification: 'WORKER_WATCHDOG_PROBE_FAILED', initialProbe, publication });
    }
    const initialObservedAtMs = Math.max(now.getTime(), Number(clock()) || 0);
    const decision = buildWorkerWatchdogRecoveryDecision({ ...initialProbe.data, nowMs: initialObservedAtMs, related: 'issue:#1291' });
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

    const startTimeoutMs = Math.min(
      WORKER_WATCHDOG_START_TIMEOUT_MS,
      Math.max(1, remainingRunBudgetMs() - WORKER_WATCHDOG_PUBLICATION_RESERVE_MS),
    );
    const restartDeadlineMs = (Number(clock()) || Date.now())
      + Math.max(1, startTimeoutMs - WORKER_WATCHDOG_CHILD_EXIT_RESERVE_MS);
    const restartDeadlineUtc = new Date(restartDeadlineMs).toISOString();
    const startResult = probeAdapter.run('StartApprovedWorkerTask', {
      timeoutMs: startTimeoutMs,
      deadlineUtc: restartDeadlineUtc,
    });
    const restartAttemptedAtUtc = now.toISOString();
    if (!startResult.ok
      || startResult.data?.started !== true
      || startResult.data?.restarted !== true
      || startResult.data?.taskName !== APPROVED_WORKER_TASK
      || startResult.data?.sourceHead !== initialAssessment.canonicalRepositoryHead
      || startResult.data?.remoteMainHead !== initialAssessment.canonicalRepositoryHead
      || startResult.data?.exactHeadProofOk !== true
      || startResult.data?.postStartSourceProofOk !== true
      || startResult.data?.sourceTrackedClean !== true
      || startResult.data?.proofFresh !== true
      || !Number.isSafeInteger(startResult.data?.startedWorkerPid)
      || startResult.data.startedWorkerPid <= 0
      || !Number.isFinite(Date.parse(text(startResult.data?.workerStartedAtUtc)))
      || !INVOCATION_ID.test(text(startResult.data?.invocationId))
      || startResult.data?.deadlineUtc !== restartDeadlineUtc
      || startResult.data?.invocationBound !== true
      || startResult.data?.canonicalWorkerCommandVerified !== true
      || startResult.data?.cleanupAttempted !== false
      || startResult.data?.cleanupCompleted !== false
      || startResult.data?.restartVerdict !== 'APPROVED_RUNTIME_RESTART_PASS') {
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
        restartProof: { ...(startResult.data || {}), restartBlocker: text(startResult.restartBlocker) },
      });
      return Object.freeze({ ok: false, classification: 'WORKER_WATCHDOG_START_FAILED', decision, startResult, publication });
    }

    let finalAssessment = initialAssessment;
    let recoveryProbeCount = 0;
    let lastProbeError = '';
    for (let attempt = 1; attempt <= decision.boundedProbeAttempts; attempt += 1) {
      const requiredBudgetMs = decision.boundedProbeIntervalMs
        + WORKER_WATCHDOG_RECOVERY_PROBE_TIMEOUT_MS
        + WORKER_WATCHDOG_PUBLICATION_RESERVE_MS;
      if (remainingRunBudgetMs() < requiredBudgetMs) {
        lastProbeError = 'Worker watchdog run budget exhausted before the next recovery probe.';
        break;
      }
      await sleep(decision.boundedProbeIntervalMs);
      recoveryProbeCount = attempt;
      const recoveryProbe = probeAdapter.run('Inspect', {
        timeoutMs: Math.min(
          WORKER_WATCHDOG_RECOVERY_PROBE_TIMEOUT_MS,
          Math.max(1, remainingRunBudgetMs() - WORKER_WATCHDOG_PUBLICATION_RESERVE_MS),
        ),
      });
      if (!recoveryProbe.ok) {
        lastProbeError = recoveryProbe.error;
        continue;
      }
      finalAssessment = assessMissionOrchestratorWorker({
        ...recoveryProbe.data,
        nowMs: Math.max(now.getTime(), Number(clock()) || 0),
      });
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
      restartProof: startResult.data,
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
