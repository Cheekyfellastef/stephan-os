import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APPROVED_WATCHDOG_TASK,
  APPROVED_WORKER_TASK,
  runBattleBridgeWorkerWatchdogAcceptance,
} from './battle-bridge-worker-watchdog-acceptance.mjs';

const expectedHead = 'a'.repeat(40);
const repoRoot = '/canonical/Documents/GitHub/stephan-os';
const workspaceRoot = '/canonical/Documents/Stephanos-openclaw-workspace';
const paths = Object.freeze({
  repoRoot,
  workspaceRoot,
  installerPath: `${repoRoot}/scripts/windows/install-battle-bridge-worker-watchdog.ps1`,
  statusScriptPath: `${repoRoot}/scripts/windows/status-battle-bridge-worker-watchdog.ps1`,
  probePath: `${repoRoot}/scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1`,
  watchdogStatusPath: `${workspaceRoot}/status/battle-bridge-worker-watchdog-current.json`,
  watchdogLaunchStatusPath: `${workspaceRoot}/status/battle-bridge-worker-watchdog-launch-current.json`,
});

function healthyObservation(pid, timestampUtc) {
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
      repositoryRoot: repoRoot,
      branch: 'main',
      headSha: expectedHead,
      taskName: APPROVED_WORKER_TASK,
      pid,
    },
  };
}

function installation(timestampUtc) {
  return {
    ok: true,
    data: {
      installed: true,
      taskState: 'Ready',
      lastRunTimeUtc: timestampUtc,
      lastTaskResult: 0,
    },
  };
}

function common(overrides = {}) {
  let clockMs = Date.parse('2026-08-28T03:50:00.000Z');
  const base = {
    expectedHead,
    platform: 'win32',
    paths,
    expectedPaths: paths,
    now: new Date(clockMs),
    clock: () => clockMs,
    sleep: async (delayMs) => { clockMs += delayMs; },
    readSourceIdentity: () => ({ ok: true, sourceHead: expectedHead, branch: 'main' }),
    installWatchdog: () => ({
      ok: true,
      data: { installed: true, taskName: APPROVED_WATCHDOG_TASK, startedNow: false },
    }),
    inspectWatchdogInstallation: () => installation(new Date(clockMs).toISOString()),
    readWatchdogLaunchStatus: async () => ({
      timestampUtc: new Date(clockMs).toISOString(),
      classification: 'WATCHDOG_RUNNER_COMPLETED',
      runnerStarted: true,
      runnerCompleted: true,
    }),
    killWorker: () => {
      throw new Error('DEGRADED_BOOTSTRAP_MUST_NOT_KILL');
    },
  };
  return { base, getClock: () => clockMs, ...overrides };
}

test('degraded baseline is repaired only through the fixed installed watchdog and never directly killed', async () => {
  const fixture = common();
  let workerReads = 0;
  let statusReads = 0;
  let starts = 0;
  let killCalls = 0;

  const result = await runBattleBridgeWorkerWatchdogAcceptance({
    ...fixture.base,
    inspectWorker: () => {
      workerReads += 1;
      if (workerReads === 1) return { ok: false, status: 2 };
      return { ok: true, data: healthyObservation(202, new Date(fixture.getClock()).toISOString()) };
    },
    readWatchdogStatus: async () => {
      statusReads += 1;
      if (statusReads === 1) {
        return {
          timestampUtc: new Date(fixture.getClock() - 5_000).toISOString(),
          classification: 'WORKER_WATCHDOG_BLOCKED',
        };
      }
      return {
        timestampUtc: new Date(fixture.getClock()).toISOString(),
        classification: 'WORKER_WATCHDOG_RECOVERED',
        supervisorDetectedWorkerDown: true,
        supervisorRestartedWorker: true,
        workerRecovered: true,
        workerFromMain: true,
      };
    },
    startWatchdog: () => {
      starts += 1;
      return {
        ok: true,
        data: { installed: true, taskName: APPROVED_WATCHDOG_TASK, startedNow: true },
      };
    },
    killWorker: () => {
      killCalls += 1;
      throw new Error('DEGRADED_BOOTSTRAP_MUST_NOT_KILL');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'WORKER_WATCHDOG_DEGRADED_BASELINE_RECOVERED');
  assert.equal(result.priorBlocker, 'INITIAL_WORKER_PROBE_FAILED');
  assert.equal(result.bootstrapRecoveryOnly, true);
  assert.equal(result.acceptancePass, false);
  assert.equal(result.workerKilled, false);
  assert.equal(result.workerKilledObserved, false);
  assert.equal(result.workerRecovered, true);
  assert.equal(result.workerFromMain, true);
  assert.equal(result.recoveredHead, expectedHead);
  assert.equal(result.recoveredPid, 202);
  assert.equal(result.watchdogRecoveryRoute, 'installed-scheduled-task');
  assert.equal(starts, 1);
  assert.equal(killCalls, 0);
});

test('degraded bootstrap fails closed before any process kill when the fixed watchdog cannot start', async () => {
  const fixture = common();
  let killCalls = 0;

  const result = await runBattleBridgeWorkerWatchdogAcceptance({
    ...fixture.base,
    inspectWorker: () => ({ ok: false, status: 2 }),
    readWatchdogStatus: async () => null,
    startWatchdog: () => ({
      ok: false,
      data: { installed: true, taskName: APPROVED_WATCHDOG_TASK, startedNow: false },
    }),
    killWorker: () => {
      killCalls += 1;
      return { ok: true, pid: 999 };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'WORKER_WATCHDOG_SCHEDULED_TASK_LAUNCH_FAILURE');
  assert.equal(result.workerKilled, false);
  assert.equal(killCalls, 0);
});

test('non-degraded blockers remain owned by the byte-preserved acceptance core', async () => {
  const fixture = common();
  const result = await runBattleBridgeWorkerWatchdogAcceptance({
    ...fixture.base,
    expectedHead: 'not-a-sha',
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'EXPECTED_HEAD_REQUIRED');
  assert.equal(result.bootstrapRecoveryOnly, undefined);
});
