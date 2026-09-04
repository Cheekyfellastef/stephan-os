import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  APPROVED_WATCHDOG_TASK,
  WORKER_WATCHDOG_TASK_IDLE_ATTEMPTS,
  runBattleBridgeWorkerWatchdogAcceptance,
} from './battle-bridge-worker-watchdog-acceptance-core-v1.mjs';

const EXPECTED_HEAD = '1234567890abcdef1234567890abcdef12345678';
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

function baseOptions(overrides = {}) {
  return {
    expectedHead: EXPECTED_HEAD,
    platform: 'win32',
    paths: PATHS,
    expectedPaths: PATHS,
    readSourceIdentity: () => ({ ok: true, sourceHead: EXPECTED_HEAD, branch: 'main' }),
    installWatchdog: () => ({
      ok: true,
      data: { installed: true, taskName: APPROVED_WATCHDOG_TASK, startedNow: false },
    }),
    sleep: async () => {},
    ...overrides,
  };
}

test('acceptance lets an already-running canonical watchdog finish its two-minute bounded task lifetime', async () => {
  let installationReads = 0;
  let workerProbeReads = 0;
  const result = await runBattleBridgeWorkerWatchdogAcceptance(baseOptions({
    inspectWatchdogInstallation: () => {
      installationReads += 1;
      return {
        ok: true,
        data: {
          installed: true,
          taskState: installationReads <= 120 ? 'Running' : 'Ready',
        },
      };
    },
    inspectWorker: () => {
      workerProbeReads += 1;
      return { ok: false };
    },
  }));

  assert.equal(WORKER_WATCHDOG_TASK_IDLE_ATTEMPTS, 135);
  assert.equal(installationReads, 121);
  assert.equal(workerProbeReads, 1);
  assert.equal(result.blocker, 'INITIAL_WORKER_PROBE_FAILED');
});

test('acceptance remains fail-closed when the watchdog is still running at the 135-second reconciliation ceiling', async () => {
  let installationReads = 0;
  let workerProbeReads = 0;
  const result = await runBattleBridgeWorkerWatchdogAcceptance(baseOptions({
    inspectWatchdogInstallation: () => {
      installationReads += 1;
      return {
        ok: true,
        data: { installed: true, taskState: 'Running' },
      };
    },
    inspectWorker: () => {
      workerProbeReads += 1;
      return { ok: false };
    },
  }));

  assert.equal(installationReads, 135);
  assert.equal(workerProbeReads, 0);
  assert.equal(result.blocker, 'WATCHDOG_TASK_RECONCILIATION_FAILED');
  assert.equal(result.taskState, 'Running');
});

test('degraded adapter shares the canonical idle bound and the installed task remains bounded to two minutes', async () => {
  const [adapterSource, installerSource] = await Promise.all([
    readFile(new URL('./battle-bridge-worker-watchdog-acceptance.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./windows/install-battle-bridge-worker-watchdog.ps1', import.meta.url), 'utf8'),
  ]);

  assert.match(adapterSource, /const TASK_IDLE_ATTEMPTS = core\.WORKER_WATCHDOG_TASK_IDLE_ATTEMPTS;/);
  assert.doesNotMatch(adapterSource, /const TASK_IDLE_ATTEMPTS = 30;/);
  assert.match(installerSource, /-ExecutionTimeLimit \(New-TimeSpan -Minutes 2\)/);
  assert.equal(WORKER_WATCHDOG_TASK_IDLE_ATTEMPTS, 135);
  assert.ok(WORKER_WATCHDOG_TASK_IDLE_ATTEMPTS > 120);
  assert.ok(WORKER_WATCHDOG_TASK_IDLE_ATTEMPTS <= 135);
});
