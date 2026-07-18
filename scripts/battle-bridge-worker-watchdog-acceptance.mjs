#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const WORKER_WATCHDOG_ACCEPTANCE_SCHEMA = 'stephanos.battle-bridge-worker-watchdog-acceptance.v1';
export const WORKER_WATCHDOG_ACCEPTANCE_OPERATION = 'RUN_WORKER_WATCHDOG_ACCEPTANCE';
export const APPROVED_WORKER_TASK = 'Stephanos Mission Orchestrator Worker';
export const APPROVED_WATCHDOG_TASK = 'Stephanos Mission Orchestrator Worker Watchdog';

const SHA_40 = /^[0-9a-f]{40}$/i;
const DOWN_PROBE_ATTEMPTS = 10;
const DOWN_PROBE_INTERVAL_MS = 500;
const RECOVERY_STATUS_ATTEMPTS = 30;
const RECOVERY_STATUS_INTERVAL_MS = 1_000;
const FINAL_WORKER_PROBE_ATTEMPTS = 10;
const FINAL_WORKER_PROBE_INTERVAL_MS = 1_000;
const HEARTBEAT_MAX_AGE_MS = 120_000;

export const WORKER_WATCHDOG_ACCEPTANCE_AUTHORITY = Object.freeze({
  operation: WORKER_WATCHDOG_ACCEPTANCE_OPERATION,
  approvedWorkerTask: APPROVED_WORKER_TASK,
  approvedWatchdogTask: APPROVED_WATCHDOG_TASK,
  processKillAllowed: true,
  processKillScope: 'verified-canonical-worker-only',
  arbitraryPidAllowed: false,
  arbitraryTaskNameAllowed: false,
  arbitraryShellAllowed: false,
  arbitraryPowerShellAllowed: false,
  pcRestartAllowed: false,
  destructiveGitAllowed: false,
  sourceMutationAllowed: false,
  liveOpenClawUpdateAllowed: false,
  visiblePowerShellRequired: false,
  maximumWorkerKillsPerRun: 1,
});

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizePath(value) {
  return text(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isoStamp(value) {
  return value.toISOString().replace(/[:.]/g, '-');
}

function blocked(blocker, details = {}) {
  return Object.freeze({
    ok: false,
    finalVerdict: 'WORKER_WATCHDOG_ACCEPTANCE_BLOCKED',
    blocker,
    ...details,
    authority: WORKER_WATCHDOG_ACCEPTANCE_AUTHORITY,
  });
}

function spawnFixed(executable, args, { cwd, spawnSyncFn = spawnSync, timeout = 120_000 } = {}) {
  return spawnSyncFn(executable, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runFixedJson(executable, args, options = {}) {
  const result = spawnFixed(executable, args, options);
  if (result.error || result.status !== 0) {
    return Object.freeze({ ok: false, status: result.status ?? null });
  }
  try {
    return Object.freeze({ ok: true, data: JSON.parse(String(result.stdout || 'null')) });
  } catch {
    return Object.freeze({ ok: false, status: result.status ?? null });
  }
}

function runFixedText(executable, args, options = {}) {
  const result = spawnFixed(executable, args, options);
  if (result.error || result.status !== 0) return '';
  return text(result.stdout);
}

export function resolveCanonicalWorkerWatchdogAcceptancePaths({ env = process.env, home = os.homedir() } = {}) {
  const userHome = path.resolve(env.USERPROFILE || env.HOME || home);
  const repoRoot = path.resolve(userHome, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.resolve(userHome, 'Documents', 'Stephanos-openclaw-workspace');
  return Object.freeze({
    repoRoot,
    workspaceRoot,
    installerPath: path.resolve(repoRoot, 'scripts', 'windows', 'install-battle-bridge-worker-watchdog.ps1'),
    probePath: path.resolve(repoRoot, 'scripts', 'windows', 'probe-mission-orchestrator-worker-watchdog.ps1'),
    watchdogStatusPath: path.resolve(workspaceRoot, 'status', 'battle-bridge-worker-watchdog-current.json'),
  });
}

export function validateCanonicalWorkerWatchdogAcceptancePaths({ paths, expectedPaths }) {
  for (const key of ['repoRoot', 'workspaceRoot', 'installerPath', 'probePath', 'watchdogStatusPath']) {
    if (path.resolve(paths?.[key] || '') !== path.resolve(expectedPaths?.[key] || '')) {
      return Object.freeze({ ok: false, blocker: `NON_CANONICAL_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}` });
    }
  }
  return Object.freeze({ ok: true });
}

export function assessCanonicalWorkerObservation(observation = {}, {
  expectedHead = '',
  requireExactHead = true,
  nowMs = Date.now(),
  expectedRepoRoot = '',
} = {}) {
  const processPid = Number.parseInt(observation?.process?.pid, 10);
  const heartbeatPid = Number.parseInt(observation?.heartbeat?.pid, 10);
  const heartbeatTimeMs = Date.parse(text(observation?.heartbeat?.timestampUtc));
  const heartbeatAgeMs = Number.isFinite(heartbeatTimeMs) ? nowMs - heartbeatTimeMs : null;
  const taskStatus = text(observation?.scheduledTask?.status).toLowerCase();
  const observedRepoRoot = normalizePath(observation?.heartbeat?.repositoryRoot);
  const canonicalRepoRoot = normalizePath(expectedRepoRoot);
  const observedHead = text(observation?.heartbeat?.headSha).toLowerCase();
  const normalizedExpectedHead = text(expectedHead).toLowerCase();
  const blockers = [];

  if (text(observation?.scheduledTask?.taskName) !== APPROVED_WORKER_TASK) blockers.push('WORKER_TASK_IDENTITY_NOT_APPROVED');
  if (observation?.scheduledTask?.actionMatchesCanonicalWorker !== true) blockers.push('WORKER_TASK_ACTION_NOT_CANONICAL');
  if (!['ready', 'running'].includes(taskStatus)) blockers.push('WORKER_TASK_STATE_NOT_HEALTHY');
  if (observation?.process?.running !== true) blockers.push('WORKER_PROCESS_NOT_RUNNING');
  if (text(observation?.process?.taskName) !== APPROVED_WORKER_TASK) blockers.push('WORKER_PROCESS_TASK_IDENTITY_NOT_APPROVED');
  if (!Number.isInteger(processPid) || processPid <= 0) blockers.push('WORKER_PROCESS_PID_INVALID');
  if (observation?.process?.commandLineMatchesCanonicalWorker !== true) blockers.push('WORKER_PROCESS_COMMAND_NOT_CANONICAL');
  if (text(observation?.heartbeat?.taskName) !== APPROVED_WORKER_TASK) blockers.push('WORKER_HEARTBEAT_TASK_IDENTITY_NOT_APPROVED');
  if (!Number.isInteger(heartbeatPid) || heartbeatPid !== processPid) blockers.push('WORKER_HEARTBEAT_PID_MISMATCH');
  if (text(observation?.heartbeat?.branch).toLowerCase() !== 'main') blockers.push('WORKER_HEARTBEAT_BRANCH_NOT_MAIN');
  if (!SHA_40.test(observedHead)) blockers.push('WORKER_HEARTBEAT_HEAD_INVALID');
  else if (requireExactHead && observedHead !== normalizedExpectedHead) blockers.push('WORKER_HEARTBEAT_HEAD_MISMATCH');
  if (!canonicalRepoRoot || observedRepoRoot !== canonicalRepoRoot) blockers.push('WORKER_HEARTBEAT_REPOSITORY_NOT_CANONICAL');
  if (heartbeatAgeMs === null || heartbeatAgeMs < 0 || heartbeatAgeMs > HEARTBEAT_MAX_AGE_MS) blockers.push('WORKER_HEARTBEAT_NOT_FRESH');

  return Object.freeze({
    ok: blockers.length === 0,
    pid: Number.isInteger(processPid) && processPid > 0 ? processPid : 0,
    headSha: SHA_40.test(observedHead) ? observedHead : '',
    exactHeadMatch: SHA_40.test(observedHead) && observedHead === normalizedExpectedHead,
    heartbeatAgeMs,
    blockers: Object.freeze(blockers),
  });
}

export function createCanonicalSourceIdentityReader({ repoRoot, spawnSyncFn = spawnSync } = {}) {
  return () => {
    const sourceHead = runFixedText('git.exe', ['rev-parse', 'HEAD'], { cwd: repoRoot, spawnSyncFn }).toLowerCase();
    const branch = runFixedText('git.exe', ['branch', '--show-current'], { cwd: repoRoot, spawnSyncFn });
    return Object.freeze({
      ok: SHA_40.test(sourceHead) && branch === 'main',
      sourceHead,
      branch,
    });
  };
}

export function createFixedWatchdogInstaller({ paths, startNow = false, spawnSyncFn = spawnSync } = {}) {
  return () => {
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      paths.installerPath,
    ];
    if (startNow) args.push('-StartNow');
    return runFixedJson('powershell.exe', args, { cwd: paths.repoRoot, spawnSyncFn });
  };
}

export function createFixedWorkerInspector({ paths, spawnSyncFn = spawnSync } = {}) {
  return () => runFixedJson('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    paths.probePath,
    '-Mode',
    'Inspect',
  ], { cwd: paths.repoRoot, spawnSyncFn });
}

export function createVerifiedWorkerKiller({ killFn = process.kill } = {}) {
  return (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return Object.freeze({ ok: false, blocker: 'VERIFIED_WORKER_PID_REQUIRED' });
    try {
      killFn(pid, 'SIGTERM');
      return Object.freeze({ ok: true, pid, signal: 'SIGTERM' });
    } catch {
      return Object.freeze({ ok: false, blocker: 'VERIFIED_WORKER_KILL_FAILED' });
    }
  };
}

export function createFixedWatchdogStatusReader({ paths } = {}) {
  return async () => {
    try {
      return JSON.parse(await readFile(paths.watchdogStatusPath, 'utf8'));
    } catch {
      return null;
    }
  };
}

function statusTimestampMs(status) {
  const parsed = Date.parse(text(status?.timestampUtc));
  return Number.isFinite(parsed) ? parsed : null;
}

function publishedWatchdogRecoveryEvidence(status, { killedAtMs, baselineStatusTimestampMs }) {
  const timestampMs = statusTimestampMs(status);
  const newerThanBaseline = baselineStatusTimestampMs === null || (timestampMs !== null && timestampMs > baselineStatusTimestampMs);
  const proven = timestampMs !== null
    && timestampMs >= killedAtMs
    && newerThanBaseline
    && status?.classification === 'WORKER_WATCHDOG_RECOVERED'
    && status?.supervisorDetectedWorkerDown === true
    && status?.supervisorRestartedWorker === true
    && status?.workerRecovered === true
    && status?.workerFromMain === true;
  return proven ? Object.freeze({ ok: true, route: 'installed-scheduled-task', timestampMs }) : null;
}

async function proveInstalledWatchdogRecovery({
  readWatchdogStatus,
  killedAtMs,
  baselineStatusTimestampMs,
  sleep,
}) {
  for (let attempt = 1; attempt <= RECOVERY_STATUS_ATTEMPTS; attempt += 1) {
    await sleep(RECOVERY_STATUS_INTERVAL_MS);
    const status = await readWatchdogStatus();
    const evidence = publishedWatchdogRecoveryEvidence(status, { killedAtMs, baselineStatusTimestampMs });
    if (evidence) return Object.freeze({ ...evidence, status, attempt });
  }
  return Object.freeze({ ok: false });
}

export async function publishAcceptanceProofTransaction({ paths, now, evidence, store } = {}) {
  const workspaceStore = store || await import('../shared/agents/sharedAgentWorkspaceStore.mjs');
  const {
    appendWorkspaceJsonl,
    createSharedWorkspaceEventRecord,
    createSharedWorkspaceProofRecord,
    createSharedWorkspaceStatusRecord,
    writeAtomicJson,
  } = workspaceStore;
  const timestampUtc = now.toISOString();
  const stamp = isoStamp(now);
  const filename = `${stamp}-worker-watchdog-acceptance-evidence.json`;
  const proofRef = path.posix.join('receipts', 'battle-bridge-worker-watchdog-acceptance', filename);
  const eventRef = path.posix.join('events', 'battle-bridge-worker-watchdog-acceptance.jsonl');
  const statusRef = path.posix.join('status', 'battle-bridge-worker-watchdog-acceptance-current.json');
  const proofRefs = [proofRef, eventRef, statusRef];
  const stagedSummary = 'Worker watchdog acceptance evidence is staged; acceptance is not committed until the final current-status write succeeds.';
  const passSummary = 'The installed Mission Orchestrator Worker watchdog Scheduled Task detected, restarted and recovered the verified worker on canonical main.';

  const stagedProof = Object.freeze({
    ...createSharedWorkspaceProofRecord({
      proofId: `battle-bridge-worker-watchdog-acceptance-${stamp}`,
      timestampUtc,
      status: 'WORKER_WATCHDOG_ACCEPTANCE_EVIDENCE_READY',
      summary: stagedSummary,
      refs: proofRefs,
    }),
    correlationId: 'issue-1291-worker-watchdog-acceptance',
    relatedIssue: '#1291',
    proofRefs,
    receiptType: 'battle-bridge-worker-watchdog-acceptance-evidence',
    publicationState: 'STAGED',
    acceptancePass: false,
    ...evidence,
  });
  const proofWrite = await writeAtomicJson(
    paths.workspaceRoot,
    ['receipts', 'battle-bridge-worker-watchdog-acceptance', filename],
    stagedProof,
    { repoRoot: paths.repoRoot, nowMs: now.getTime() },
  );
  if (!proofWrite.ok) throw new Error('ACCEPTANCE_EVIDENCE_WRITE_FAILED');

  const stagedEvent = Object.freeze({
    ...createSharedWorkspaceEventRecord({
      eventId: `battle-bridge-worker-watchdog-acceptance-${stamp}`,
      timestampUtc,
      eventKind: 'battle-bridge-worker-watchdog-acceptance-evidence-ready',
      summary: stagedSummary,
    }),
    proofRefs,
    publicationState: 'STAGED',
    acceptancePass: false,
    ...evidence,
  });
  const eventWrite = await appendWorkspaceJsonl(
    paths.workspaceRoot,
    ['events', 'battle-bridge-worker-watchdog-acceptance.jsonl'],
    stagedEvent,
    { repoRoot: paths.repoRoot, nowMs: now.getTime() },
  );
  if (!eventWrite.ok) throw new Error('ACCEPTANCE_EVIDENCE_EVENT_WRITE_FAILED');

  const committedStatus = Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: 'battle-bridge-worker-watchdog-acceptance-current',
      timestampUtc,
      status: 'WORKER_WATCHDOG_ACCEPTANCE_PASS',
      summary: passSummary,
      proofRefs,
    }),
    publicationState: 'COMMITTED',
    acceptancePass: true,
    stagedProofRef: proofRef,
    stagedEventRef: eventRef,
    ...evidence,
  });
  const statusWrite = await writeAtomicJson(
    paths.workspaceRoot,
    ['status', 'battle-bridge-worker-watchdog-acceptance-current.json'],
    committedStatus,
    { repoRoot: paths.repoRoot, nowMs: now.getTime() },
  );
  if (!statusWrite.ok) throw new Error('ACCEPTANCE_COMMIT_STATUS_WRITE_FAILED');

  return Object.freeze({
    ok: true,
    proofRefs,
    proofWrittenToSharedWorkspace: true,
    publicationState: 'COMMITTED',
  });
}

export async function runBattleBridgeWorkerWatchdogAcceptance({
  expectedHead = '',
  env = process.env,
  platform = process.platform,
  now = new Date(),
  paths = resolveCanonicalWorkerWatchdogAcceptancePaths({ env }),
  expectedPaths = resolveCanonicalWorkerWatchdogAcceptancePaths({ env }),
  readSourceIdentity = createCanonicalSourceIdentityReader({ repoRoot: paths.repoRoot }),
  installWatchdog = createFixedWatchdogInstaller({ paths, startNow: false }),
  startWatchdog = createFixedWatchdogInstaller({ paths, startNow: true }),
  inspectWorker = createFixedWorkerInspector({ paths }),
  killWorker = createVerifiedWorkerKiller(),
  readWatchdogStatus = createFixedWatchdogStatusReader({ paths }),
  publishProof = publishAcceptanceProofTransaction,
  sleep = (delayMs) => new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs)),
  clock = () => Date.now(),
} = {}) {
  if (platform !== 'win32') return blocked('WINDOWS_REQUIRED');
  if (!SHA_40.test(text(expectedHead))) return blocked('EXPECTED_HEAD_REQUIRED');
  const pathValidation = validateCanonicalWorkerWatchdogAcceptancePaths({ paths, expectedPaths });
  if (!pathValidation.ok) return blocked(pathValidation.blocker);

  const source = readSourceIdentity();
  if (!source?.ok || source.branch !== 'main') return blocked('CANONICAL_MAIN_SOURCE_REQUIRED');
  if (text(source.sourceHead).toLowerCase() !== text(expectedHead).toLowerCase()) {
    return blocked('EXPECTED_HEAD_MISMATCH', { sourceHead: text(source.sourceHead).toLowerCase(), expectedHeadMatch: false });
  }

  const install = installWatchdog();
  if (!install?.ok || install.data?.installed !== true || install.data?.taskName !== APPROVED_WATCHDOG_TASK || install.data?.startedNow !== false) {
    return blocked('WATCHDOG_INSTALLATION_NOT_PROVEN', { sourceHead: source.sourceHead, expectedHeadMatch: true });
  }

  const initialProbe = inspectWorker();
  if (!initialProbe?.ok) return blocked('INITIAL_WORKER_PROBE_FAILED', { sourceHead: source.sourceHead, expectedHeadMatch: true });
  const initial = assessCanonicalWorkerObservation(initialProbe.data, {
    expectedHead,
    requireExactHead: false,
    nowMs: now.getTime(),
    expectedRepoRoot: paths.repoRoot,
  });
  if (!initial.ok) return blocked('INITIAL_WORKER_NOT_CANONICAL_AND_HEALTHY', { sourceHead: source.sourceHead, expectedHeadMatch: true });

  const baselineStatus = await readWatchdogStatus();
  const baselineStatusTimestampMs = statusTimestampMs(baselineStatus);
  const initialPid = initial.pid;
  const killed = killWorker(initialPid);
  if (!killed?.ok || killed.pid !== initialPid) {
    return blocked('VERIFIED_WORKER_KILL_FAILED', { sourceHead: source.sourceHead, expectedHeadMatch: true, initialPid });
  }
  const killedAtMs = clock();

  let workerKilledObserved = false;
  for (let attempt = 1; attempt <= DOWN_PROBE_ATTEMPTS; attempt += 1) {
    await sleep(DOWN_PROBE_INTERVAL_MS);
    const downProbe = inspectWorker();
    if (!downProbe?.ok) continue;
    const observedPid = Number.parseInt(downProbe.data?.process?.pid, 10);
    if (downProbe.data?.process?.running !== true || observedPid !== initialPid) {
      workerKilledObserved = true;
      break;
    }
  }
  if (!workerKilledObserved) {
    return blocked('WORKER_TERMINATION_NOT_OBSERVED', { sourceHead: source.sourceHead, expectedHeadMatch: true, initialPid });
  }

  const start = startWatchdog();
  if (!start?.ok
    || start.data?.installed !== true
    || start.data?.taskName !== APPROVED_WATCHDOG_TASK
    || start.data?.startedNow !== true) {
    return blocked('INSTALLED_WATCHDOG_START_NOT_PROVEN', {
      sourceHead: source.sourceHead,
      expectedHeadMatch: true,
      initialPid,
      workerKilledObserved,
    });
  }

  const watchdogRecovery = await proveInstalledWatchdogRecovery({
    readWatchdogStatus,
    killedAtMs,
    baselineStatusTimestampMs,
    sleep,
  });
  if (!watchdogRecovery.ok) {
    return blocked('INSTALLED_WATCHDOG_RECOVERY_NOT_PROVEN', {
      sourceHead: source.sourceHead,
      expectedHeadMatch: true,
      initialPid,
      workerKilledObserved,
    });
  }

  let final = null;
  for (let attempt = 1; attempt <= FINAL_WORKER_PROBE_ATTEMPTS; attempt += 1) {
    const finalProbe = inspectWorker();
    if (finalProbe?.ok) {
      final = assessCanonicalWorkerObservation(finalProbe.data, {
        expectedHead,
        requireExactHead: true,
        nowMs: clock(),
        expectedRepoRoot: paths.repoRoot,
      });
      if (final.ok && final.pid !== initialPid) break;
    }
    await sleep(FINAL_WORKER_PROBE_INTERVAL_MS);
  }
  const recoveredPid = final?.pid || 0;
  if (!final?.ok || recoveredPid === initialPid) {
    return blocked('RECOVERED_WORKER_IDENTITY_NOT_PROVEN', {
      sourceHead: source.sourceHead,
      expectedHeadMatch: true,
      initialPid,
      recoveredPid,
      workerKilledObserved,
    });
  }

  const evidence = Object.freeze({
    schemaVersion: WORKER_WATCHDOG_ACCEPTANCE_SCHEMA,
    finalVerdict: 'WORKER_WATCHDOG_ACCEPTANCE_PASS',
    sourceHead: source.sourceHead,
    branch: 'main',
    expectedHeadMatch: true,
    watchdogInstalled: true,
    watchdogStartedThroughScheduledTask: true,
    watchdogRecoveryRoute: watchdogRecovery.route,
    initialHead: initial.headSha,
    recoveredHead: final.headSha,
    initialPid,
    recoveredPid,
    workerKilled: true,
    workerKilledObserved: true,
    supervisorDetectedWorkerDown: true,
    supervisorRestartedWorker: true,
    workerRecovered: true,
    workerFromMain: true,
    visiblePowerShellRequired: false,
    authority: WORKER_WATCHDOG_ACCEPTANCE_AUTHORITY,
  });
  let publication;
  try {
    publication = await publishProof({ paths, now: new Date(clock()), evidence });
  } catch {
    return blocked('SHARED_WORKSPACE_ACCEPTANCE_PUBLICATION_FAILED', evidence);
  }
  if (!publication?.ok
    || publication.proofWrittenToSharedWorkspace !== true
    || publication.publicationState !== 'COMMITTED') {
    return blocked('SHARED_WORKSPACE_ACCEPTANCE_PUBLICATION_FAILED', evidence);
  }

  return Object.freeze({
    ok: true,
    ...evidence,
    proofWrittenToSharedWorkspace: true,
    publicationState: 'COMMITTED',
    proofRefs: Object.freeze([...(publication.proofRefs || [])]),
  });
}

export function isDirectCliEntrypoint({ metaUrl = import.meta.url, argv1 = process.argv[1] } = {}) {
  return Boolean(argv1) && path.resolve(fileURLToPath(metaUrl)) === path.resolve(argv1);
}

if (isDirectCliEntrypoint()) {
  const expectedHead = text(process.argv[2]);
  const result = await runBattleBridgeWorkerWatchdogAcceptance({ expectedHead });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
