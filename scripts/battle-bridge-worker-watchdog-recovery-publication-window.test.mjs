import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APPROVED_WATCHDOG_TASK,
  APPROVED_WORKER_TASK,
  WORKER_WATCHDOG_STATUS_PUBLICATION_ATTEMPTS,
  runBattleBridgeWorkerWatchdogAcceptance,
} from './battle-bridge-worker-watchdog-acceptance-core-v1.mjs';

const EXPECTED_HEAD = '1234567890abcdef1234567890abcdef12345678';
const PREVIOUS_HEAD = 'abcdef1234567890abcdef1234567890abcdef12';
const REPO_ROOT = '/canonical/Documents/GitHub/stephan-os';
const WORKSPACE_ROOT = '/canonical/Documents/Stephanos-openclaw-workspace';
const PATHS = Object.freeze({
  repoRoot: REPO_ROOT,
  workspaceRoot: WORKSPACE_ROOT,
  installerPath: `${REPO_ROOT}/scripts/windows/install-battle-bridge-worker-watchdog.ps1`,
  statusScriptPath: `${REPO_ROOT}/scripts/windows/status-battle-bridge-worker-watchdog.ps1`,
  probePath: `${REPO_ROOT}/scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1`,
  watchdogStatusPath: `${WORKSPACE_ROOT}/status/battle-bridge-worker-watchdog-current.json`,
  watchdogLaunchStatusPath: `${WORKSPACE_ROOT}/status/battle-bridge-worker-watchdog-launch-current.json`,
});

function healthyObservation(pid, timestampUtc, headSha = EXPECTED_HEAD) {
  return {
    scheduledTask: {
      taskName: APPROVED_WORKER_TASK,
      status: 'Running',
      actionMatchesCanonicalWorker: true,
    },
    process: {
      running: true,
      taskName: APPROVED_WORKER_TASK,
      pid,
      commandLineMatchesCanonicalWorker: true,
    },
    heartbeat: {
      timestampUtc,
      repositoryRoot: REPO_ROOT,
      branch: 'main',
      headSha,
      taskName: APPROVED_WORKER_TASK,
      pid,
    },
  };
}

function downObservation(timestampUtc) {
  return {
    scheduledTask: {
      taskName: APPROVED_WORKER_TASK,
      status: 'Ready',
      actionMatchesCanonicalWorker: true,
    },
    process: {
      running: false,
      taskName: '',
      pid: 0,
      commandLineMatchesCanonicalWorker: false,
    },
    heartbeat: {
      timestampUtc,
      repositoryRoot: REPO_ROOT,
      branch: 'main',
      headSha: PREVIOUS_HEAD,
      taskName: APPROVED_WORKER_TASK,
      pid: 101,
    },
  };
}

function healthyStatus(timestampUtc) {
  return {
    timestampUtc,
    classification: 'WORKER_WATCHDOG_HEALTHY',
    supervisorDetectedWorkerDown: false,
    supervisorRestartedWorker: false,
    workerRecovered: true,
    workerFromMain: true,
  };
}

function recoveredStatus(timestampUtc) {
  return {
    timestampUtc,
    classification: 'WORKER_WATCHDOG_RECOVERED',
    supervisorDetectedWorkerDown: true,
    supervisorRestartedWorker: true,
    workerRecovered: true,
    workerFromMain: true,
  };
}

function completedLaunchStatus(timestampUtc) {
  return {
    timestampUtc,
    classification: 'WATCHDOG_RUNNER_COMPLETED',
    hiddenWrapperStarted: true,
    runnerStarted: true,
    runnerCompleted: true,
    runnerExitCode: 0,
    runnerResultParsed: true,
  };
}

function baseOptions(nowMs, overrides = {}) {
  let installationReads = 0;
  return {
    expectedHead: EXPECTED_HEAD,
    platform: 'win32',
    now: new Date(nowMs),
    clock: () => nowMs,
    paths: PATHS,
    expectedPaths: PATHS,
    readSourceIdentity: () => ({ ok: true, sourceHead: EXPECTED_HEAD, branch: 'main' }),
    installWatchdog: () => ({
      ok: true,
      data: { installed: true, taskName: APPROVED_WATCHDOG_TASK, startedNow: false },
    }),
    inspectWatchdogInstallation: () => ({
      ok: true,
      data: {
        installed: true,
        taskState: 'Ready',
        lastRunTimeUtc: new Date(nowMs + (installationReads++ * 1_000)).toISOString(),
        lastTaskResult: 0,
      },
    }),
    readWatchdogLaunchStatus: async () => completedLaunchStatus(new Date(nowMs + 1_000).toISOString()),
    sleep: async () => {},
    ...overrides,
  };
}

test('acceptance observes exact recovery publication after the former 30-second ceiling', async () => {
  const nowMs = Date.parse('2026-09-05T08:00:00.000Z');
  const timestampUtc = new Date(nowMs).toISOString();
  const observations = [
    healthyObservation(101, timestampUtc, PREVIOUS_HEAD),
    healthyObservation(101, timestampUtc, PREVIOUS_HEAD),
    downObservation(timestampUtc),
    healthyObservation(202, timestampUtc, EXPECTED_HEAD),
  ];
  let starts = 0;
  let recoveryStatusReads = 0;

  const result = await runBattleBridgeWorkerWatchdogAcceptance(baseOptions(nowMs, {
    inspectWorker: () => ({ ok: true, data: observations.shift() || healthyObservation(202, timestampUtc, EXPECTED_HEAD) }),
    killWorker: (pid) => ({ ok: true, pid }),
    startWatchdog: () => {
      starts += 1;
      return { ok: true, data: { installed: true, taskName: APPROVED_WATCHDOG_TASK, startedNow: true } };
    },
    readWatchdogStatus: async () => {
      if (starts <= 1) return healthyStatus(timestampUtc);
      recoveryStatusReads += 1;
      if (recoveryStatusReads <= 120) {
        return healthyStatus(new Date(nowMs + (recoveryStatusReads * 1_000)).toISOString());
      }
      return recoveredStatus(new Date(nowMs + 121_000).toISOString());
    },
    publishProof: async () => ({
      ok: true,
      proofWrittenToSharedWorkspace: true,
      publicationState: 'COMMITTED',
      proofRefs: ['receipts/battle-bridge-worker-watchdog-acceptance/proof.json'],
      publicationRefs: ['receipts/battle-bridge-worker-watchdog-acceptance/proof.json'],
    }),
  }));

  assert.equal(WORKER_WATCHDOG_STATUS_PUBLICATION_ATTEMPTS, 135);
  assert.equal(recoveryStatusReads, 121);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.finalVerdict, 'WORKER_WATCHDOG_ACCEPTANCE_PASS');
  assert.equal(result.initialPid, 101);
  assert.equal(result.recoveredPid, 202);
});

test('recovery publication window remains bounded and fails closed at 135 observations', async () => {
  const nowMs = Date.parse('2026-09-05T08:00:00.000Z');
  const timestampUtc = new Date(nowMs).toISOString();
  const observations = [
    healthyObservation(101, timestampUtc, PREVIOUS_HEAD),
    healthyObservation(101, timestampUtc, PREVIOUS_HEAD),
    downObservation(timestampUtc),
    healthyObservation(202, timestampUtc, EXPECTED_HEAD),
  ];
  let starts = 0;
  let recoveryStatusReads = 0;

  const result = await runBattleBridgeWorkerWatchdogAcceptance(baseOptions(nowMs, {
    inspectWorker: () => ({ ok: true, data: observations.shift() || healthyObservation(202, timestampUtc, EXPECTED_HEAD) }),
    killWorker: (pid) => ({ ok: true, pid }),
    startWatchdog: () => {
      starts += 1;
      return { ok: true, data: { installed: true, taskName: APPROVED_WATCHDOG_TASK, startedNow: true } };
    },
    readWatchdogStatus: async () => {
      if (starts <= 1) return healthyStatus(timestampUtc);
      recoveryStatusReads += 1;
      return healthyStatus(new Date(nowMs + (recoveryStatusReads * 1_000)).toISOString());
    },
  }));

  assert.equal(WORKER_WATCHDOG_STATUS_PUBLICATION_ATTEMPTS, 135);
  assert.equal(recoveryStatusReads, 135);
  assert.equal(result.ok, false);
  assert.equal(result.finalVerdict, 'WORKER_WATCHDOG_ACCEPTANCE_BLOCKED');
});
