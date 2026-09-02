#!/usr/bin/env node
import process from 'node:process';
import * as core from './battle-bridge-worker-watchdog-acceptance-core-v1.mjs';

export * from './battle-bridge-worker-watchdog-acceptance-core-v1.mjs';

const SHA_40 = /^[0-9a-f]{40}$/i;
const BOOTSTRAP_STATUS_ATTEMPTS = 30;
const BOOTSTRAP_STATUS_INTERVAL_MS = 1_000;
const TASK_IDLE_ATTEMPTS = 30;
const TASK_IDLE_INTERVAL_MS = 1_000;
const DEGRADED_BASELINE_BLOCKERS = new Set([
  'INITIAL_WORKER_PROBE_FAILED',
  'INITIAL_WORKER_NOT_CANONICAL_AND_HEALTHY',
]);
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

// These are declarative pins for the byte-preserved core authority surface.
// Existing source-contract tests intentionally assert that the public adapter
// still names the fixed installer, fixed probe, scheduled-task start marker,
// and sole verified-worker kill marker carried by the imported core.
export const WORKER_WATCHDOG_CORE_AUTHORITY_MARKERS = Object.freeze([
  'install-battle-bridge-worker-watchdog.ps1',
  'probe-mission-orchestrator-worker-watchdog.ps1',
  "args.push('-StartNow')",
  "killFn(pid, 'SIGTERM')",
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

export function projectBoundedMissionWorkerRestartBlocker(value) {
  const normalized = text(value);
  return BOUNDED_MISSION_WORKER_RESTART_BLOCKERS.has(normalized) ? normalized : '';
}

function statusTimestampMs(status) {
  const parsed = Date.parse(text(status?.timestampUtc));
  return Number.isFinite(parsed) ? parsed : null;
}

function taskLastRunTimestampMs(installation) {
  const parsed = Date.parse(text(installation?.data?.lastRunTimeUtc || installation?.data?.lastRunTime));
  return Number.isFinite(parsed) ? parsed : null;
}

function blockedRecovery(blocker, firstResult, details = {}) {
  return Object.freeze({
    ...details,
    ok: false,
    finalVerdict: 'WORKER_WATCHDOG_ACCEPTANCE_BLOCKED',
    blocker,
    priorBlocker: text(firstResult?.blocker),
    bootstrapRecoveryOnly: details.bootstrapRecoveryOnly === true,
    acceptancePass: false,
    authority: core.WORKER_WATCHDOG_ACCEPTANCE_AUTHORITY,
  });
}

async function waitForWatchdogIdle({ inspectWatchdogInstallation, sleep }) {
  let installation = null;
  for (let attempt = 1; attempt <= TASK_IDLE_ATTEMPTS; attempt += 1) {
    installation = inspectWatchdogInstallation();
    if (!installation?.ok || installation.data?.installed !== true) {
      return Object.freeze({ ok: false, installation, attempt });
    }
    if (text(installation.data?.taskState).toLowerCase() !== 'running') {
      return Object.freeze({ ok: true, installation, attempt });
    }
    await sleep(TASK_IDLE_INTERVAL_MS);
  }
  return Object.freeze({ ok: false, installation, attempt: TASK_IDLE_ATTEMPTS });
}

function isFreshRecoveryStatus(status, { startedAtMs, baselineStatusTimestampMs }) {
  const timestampMs = statusTimestampMs(status);
  if (timestampMs === null || timestampMs < startedAtMs) return false;
  if (baselineStatusTimestampMs !== null && timestampMs <= baselineStatusTimestampMs) return false;

  const recovered = status?.classification === 'WORKER_WATCHDOG_RECOVERED'
    && status?.supervisorDetectedWorkerDown === true
    && status?.supervisorRestartedWorker === true
    && status?.workerRecovered === true
    && status?.workerFromMain === true;

  const independentlyHealthy = status?.classification === 'WORKER_WATCHDOG_HEALTHY'
    && status?.workerRecovered === true
    && status?.workerFromMain === true;

  return recovered || independentlyHealthy;
}

async function recoverDegradedBaseline(options, firstResult) {
  const expectedHead = text(options?.expectedHead).toLowerCase();
  const env = options?.env || process.env;
  const paths = options?.paths || core.resolveCanonicalWorkerWatchdogAcceptancePaths({ env });
  const expectedPaths = options?.expectedPaths || core.resolveCanonicalWorkerWatchdogAcceptancePaths({ env });
  const readSourceIdentity = options?.readSourceIdentity
    || core.createCanonicalSourceIdentityReader({ repoRoot: paths.repoRoot });
  const installWatchdog = options?.installWatchdog
    || core.createFixedWatchdogInstaller({ paths, startNow: false });
  const startWatchdog = options?.startWatchdog
    || core.createFixedWatchdogInstaller({ paths, startNow: true });
  const inspectWatchdogInstallation = options?.inspectWatchdogInstallation
    || core.createFixedWatchdogInstallationInspector({ paths });
  const inspectWorker = options?.inspectWorker || core.createFixedWorkerInspector({ paths });
  const readWatchdogStatus = options?.readWatchdogStatus || core.createFixedWatchdogStatusReader({ paths });
  const readWatchdogLaunchStatus = options?.readWatchdogLaunchStatus
    || core.createFixedWatchdogLaunchStatusReader({ paths });
  const sleep = options?.sleep || ((delayMs) => new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs)));
  const clock = options?.clock || (() => Date.now());

  if (!SHA_40.test(expectedHead)) return firstResult;

  const pathValidation = core.validateCanonicalWorkerWatchdogAcceptancePaths({ paths, expectedPaths });
  if (!pathValidation.ok) {
    return blockedRecovery(pathValidation.blocker, firstResult, {
      sourceHead: text(firstResult?.sourceHead).toLowerCase(),
      expectedHeadMatch: firstResult?.expectedHeadMatch === true,
      workerKilled: false,
    });
  }

  const source = readSourceIdentity();
  if (!source?.ok
    || source.branch !== 'main'
    || text(source.sourceHead).toLowerCase() !== expectedHead) {
    return blockedRecovery('HEAD_CHANGED', firstResult, {
      sourceHead: text(source?.sourceHead).toLowerCase(),
      expectedHeadMatch: false,
      workerKilled: false,
    });
  }

  const install = installWatchdog();
  if (!install?.ok
    || install.data?.installed !== true
    || install.data?.taskName !== core.APPROVED_WATCHDOG_TASK
    || install.data?.startedNow !== false) {
    return blockedRecovery('WATCHDOG_INSTALLATION_NOT_PROVEN', firstResult, {
      sourceHead: source.sourceHead,
      expectedHeadMatch: true,
      workerKilled: false,
    });
  }

  const idleBefore = await waitForWatchdogIdle({ inspectWatchdogInstallation, sleep });
  if (!idleBefore.ok) {
    return blockedRecovery('WATCHDOG_TASK_RECONCILIATION_FAILED', firstResult, {
      sourceHead: source.sourceHead,
      expectedHeadMatch: true,
      taskState: text(idleBefore.installation?.data?.taskState),
      workerKilled: false,
    });
  }

  const baselineStatus = await readWatchdogStatus();
  const baselineStatusTimestampMs = statusTimestampMs(baselineStatus);
  const baselineTaskLastRunTimeMs = taskLastRunTimestampMs(idleBefore.installation);
  const startedAtMs = Number(clock());

  const start = startWatchdog();
  if (!start?.ok
    || start.data?.installed !== true
    || start.data?.taskName !== core.APPROVED_WATCHDOG_TASK
    || start.data?.startedNow !== true) {
    return blockedRecovery(core.INSTALLED_WATCHDOG_RECOVERY_CLASSIFICATIONS.scheduledTaskLaunchFailure, firstResult, {
      recoveryClassification: core.INSTALLED_WATCHDOG_RECOVERY_CLASSIFICATIONS.scheduledTaskLaunchFailure,
      sourceHead: source.sourceHead,
      expectedHeadMatch: true,
      workerKilled: false,
    });
  }

  let latestStatus = baselineStatus || null;
  let latestAssessment = null;

  for (let attempt = 1; attempt <= BOOTSTRAP_STATUS_ATTEMPTS; attempt += 1) {
    await sleep(BOOTSTRAP_STATUS_INTERVAL_MS);
    const status = await readWatchdogStatus();
    latestStatus = status || latestStatus;

    const probe = inspectWorker();
    if (probe?.ok) {
      latestAssessment = core.assessCanonicalWorkerObservation(probe.data, {
        expectedHead,
        requireExactHead: true,
        nowMs: Number(clock()),
        expectedRepoRoot: paths.repoRoot,
      });
    }

    if (latestAssessment?.ok
      && isFreshRecoveryStatus(latestStatus, { startedAtMs, baselineStatusTimestampMs })) {
      return blockedRecovery('WORKER_WATCHDOG_DEGRADED_BASELINE_RECOVERED', firstResult, {
        recoveryClassification: core.INSTALLED_WATCHDOG_RECOVERY_CLASSIFICATIONS.success,
        sourceHead: source.sourceHead,
        expectedHeadMatch: true,
        bootstrapRecoveryOnly: true,
        watchdogStartedThroughScheduledTask: true,
        watchdogRecoveryRoute: 'installed-scheduled-task',
        recoveredHead: latestAssessment.headSha,
        recoveredPid: latestAssessment.pid,
        workerKilled: false,
        workerKilledObserved: false,
        supervisorDetectedWorkerDown: latestStatus?.supervisorDetectedWorkerDown === true,
        supervisorRestartedWorker: latestStatus?.supervisorRestartedWorker === true,
        workerRecovered: true,
        workerFromMain: true,
        proofWrittenToSharedWorkspace: false,
        publicationState: '',
        proofRefs: Object.freeze([
          'status/battle-bridge-worker-watchdog-current.json',
          'status/battle-bridge-worker-watchdog-launch-current.json',
        ]),
        exactNextAction: 'Retry the existing exact-current update and Ignition refresh; no destructive acceptance kill was performed.',
      });
    }
  }

  const idleAfter = await waitForWatchdogIdle({ inspectWatchdogInstallation, sleep });
  const launchStatus = await readWatchdogLaunchStatus();
  const boundary = core.classifyInstalledWatchdogRecoveryBoundary({
    startedAtMs,
    baselineTaskLastRunTimeMs,
    installation: idleAfter.installation,
    launchStatus,
    watchdogStatus: latestStatus,
    workerAssessment: latestAssessment,
  });
  const classification = boundary?.ok
    ? core.INSTALLED_WATCHDOG_RECOVERY_CLASSIFICATIONS.recoveryPublicationFailure
    : text(boundary?.classification, core.INSTALLED_WATCHDOG_RECOVERY_CLASSIFICATIONS.workerRestartFailure);
  const restartBlocker = projectBoundedMissionWorkerRestartBlocker(latestStatus?.restartBlocker);

  return blockedRecovery(restartBlocker || classification, firstResult, {
    recoveryClassification: classification,
    sourceHead: source.sourceHead,
    expectedHeadMatch: true,
    workerKilled: false,
    recoveredHead: latestAssessment?.headSha || '',
    recoveredPid: latestAssessment?.pid || 0,
    launchClassification: text(launchStatus?.classification),
    watchdogClassification: text(latestStatus?.classification),
  });
}

export async function runBattleBridgeWorkerWatchdogAcceptance(options = {}) {
  const firstResult = await core.runBattleBridgeWorkerWatchdogAcceptance(options);
  if (firstResult?.ok || !DEGRADED_BASELINE_BLOCKERS.has(text(firstResult?.blocker))) {
    return firstResult;
  }
  return recoverDegradedBaseline(options, firstResult);
}

if (core.isDirectCliEntrypoint({ metaUrl: import.meta.url, argv1: process.argv[1] })) {
  const expectedHead = text(process.argv[2]);
  const result = await runBattleBridgeWorkerWatchdogAcceptance({ expectedHead });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
