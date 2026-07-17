import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  APPROVED_WATCHDOG_TASK,
  APPROVED_WORKER_TASK,
  WORKER_WATCHDOG_ACCEPTANCE_AUTHORITY,
  assessCanonicalWorkerObservation,
  runBattleBridgeWorkerWatchdogAcceptance,
} from './battle-bridge-worker-watchdog-acceptance.mjs';

const sourcePath = new URL('./battle-bridge-worker-watchdog-acceptance.mjs', import.meta.url);
const expectedHead = 'ffc7f5b5f6f0ac826c3f5b390b8eb60f414e3743';
const previousHead = '704f64a1662de33bfd3ac2ff6531ad296bf5e846';
const repoRoot = '/canonical/Documents/GitHub/stephan-os';
const workspaceRoot = '/canonical/Documents/Stephanos-openclaw-workspace';
const paths = Object.freeze({
  repoRoot,
  workspaceRoot,
  installerPath: `${repoRoot}/scripts/windows/install-battle-bridge-worker-watchdog.ps1`,
  probePath: `${repoRoot}/scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1`,
  watchdogStatusPath: `${workspaceRoot}/status/battle-bridge-worker-watchdog-current.json`,
});

function healthyObservation(pid, timestampUtc = new Date().toISOString(), headSha = expectedHead) {
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
      headSha,
      taskName: APPROVED_WORKER_TASK,
      pid,
    },
  };
}

function downObservation(timestampUtc = new Date().toISOString()) {
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
      repositoryRoot: repoRoot,
      branch: 'main',
      headSha: previousHead,
      taskName: APPROVED_WORKER_TASK,
      pid: 101,
    },
  };
}

function common(overrides = {}) {
  return {
    expectedHead,
    platform: 'win32',
    paths,
    expectedPaths: paths,
    readSourceIdentity: () => ({ ok: true, sourceHead: expectedHead, branch: 'main' }),
    installWatchdog: () => ({ ok: true, data: { installed: true, taskName: APPROVED_WATCHDOG_TASK } }),
    readWatchdogStatus: async () => null,
    sleep: async () => {},
    ...overrides,
  };
}

test('canonical worker observation binds task, command, heartbeat, repository and exact-head policy', () => {
  const result = assessCanonicalWorkerObservation(healthyObservation(101), {
    expectedHead,
    expectedRepoRoot: repoRoot,
    nowMs: Date.now(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.pid, 101);
  assert.equal(result.exactHeadMatch, true);

  const oldHeadObservation = healthyObservation(101, new Date().toISOString(), previousHead);
  const exactRequired = assessCanonicalWorkerObservation(oldHeadObservation, {
    expectedHead,
    expectedRepoRoot: repoRoot,
    nowMs: Date.now(),
  });
  assert.equal(exactRequired.ok, false);
  assert.ok(exactRequired.blockers.includes('WORKER_HEARTBEAT_HEAD_MISMATCH'));

  const canonicalPreMergeAllowed = assessCanonicalWorkerObservation(oldHeadObservation, {
    expectedHead,
    requireExactHead: false,
    expectedRepoRoot: repoRoot,
    nowMs: Date.now(),
  });
  assert.equal(canonicalPreMergeAllowed.ok, true);
  assert.equal(canonicalPreMergeAllowed.exactHeadMatch, false);
  assert.equal(canonicalPreMergeAllowed.headSha, previousHead);
});

test('runs one verified kill from a canonical pre-merge worker to exact-head recovery and Shared Workspace proof', async () => {
  const observations = [
    healthyObservation(101, new Date().toISOString(), previousHead),
    downObservation(),
    healthyObservation(202),
  ];
  const killed = [];
  const result = await runBattleBridgeWorkerWatchdogAcceptance(common({
    inspectWorker: () => ({ ok: true, data: observations.shift() }),
    killWorker: (pid) => { killed.push(pid); return { ok: true, pid }; },
    runWatchdog: async () => ({
      ok: true,
      classification: 'WORKER_WATCHDOG_RECOVERED',
      initialAssessment: { healthy: false },
      finalAssessment: { healthy: true },
      startResult: { data: { started: true, taskName: APPROVED_WORKER_TASK } },
    }),
    publishProof: async ({ evidence }) => ({
      ok: evidence.workerKilledObserved === true,
      proofWrittenToSharedWorkspace: true,
      proofRefs: ['receipts/battle-bridge-worker-watchdog-acceptance/proof.json'],
    }),
  }));

  assert.deepEqual(killed, [101]);
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'WORKER_WATCHDOG_ACCEPTANCE_PASS');
  assert.equal(result.watchdogRecoveryRoute, 'direct-watchdog-run');
  assert.equal(result.initialHead, previousHead);
  assert.equal(result.recoveredHead, expectedHead);
  assert.equal(result.initialPid, 101);
  assert.equal(result.recoveredPid, 202);
  assert.equal(result.workerKilled, true);
  assert.equal(result.workerKilledObserved, true);
  assert.equal(result.supervisorDetectedWorkerDown, true);
  assert.equal(result.supervisorRestartedWorker, true);
  assert.equal(result.workerRecovered, true);
  assert.equal(result.workerFromMain, true);
  assert.equal(result.proofWrittenToSharedWorkspace, true);
  assert.equal(result.visiblePowerShellRequired, false);
});

test('accepts fresh installed-watchdog status when the scheduled task wins the recovery race', async () => {
  const killedAtMs = Date.now();
  const timestampUtc = new Date(killedAtMs).toISOString();
  const observations = [
    healthyObservation(101, timestampUtc, previousHead),
    downObservation(timestampUtc),
    healthyObservation(202, timestampUtc),
  ];
  let directRunCalls = 0;
  const result = await runBattleBridgeWorkerWatchdogAcceptance(common({
    now: new Date(killedAtMs),
    inspectWorker: () => ({ ok: true, data: observations.shift() }),
    killWorker: (pid) => ({ ok: true, pid }),
    clock: () => killedAtMs,
    runWatchdog: async () => {
      directRunCalls += 1;
      return { ok: false, classification: 'WORKER_WATCHDOG_LIVE_LOCK' };
    },
    readWatchdogStatus: async () => ({
      timestampUtc,
      classification: 'WORKER_WATCHDOG_RECOVERED',
      supervisorDetectedWorkerDown: true,
      supervisorRestartedWorker: true,
      workerRecovered: true,
      workerFromMain: true,
    }),
    publishProof: async () => ({
      ok: true,
      proofWrittenToSharedWorkspace: true,
      proofRefs: ['receipts/battle-bridge-worker-watchdog-acceptance/proof.json'],
    }),
  }));

  assert.equal(result.ok, true);
  assert.equal(result.watchdogRecoveryRoute, 'installed-watchdog-status');
  assert.equal(result.initialPid, 101);
  assert.equal(result.recoveredPid, 202);
  assert.equal(directRunCalls, 0);
});

test('fails before kill when the observed worker is not canonical and healthy', async () => {
  let killCalls = 0;
  const observation = healthyObservation(101);
  observation.process.commandLineMatchesCanonicalWorker = false;
  const result = await runBattleBridgeWorkerWatchdogAcceptance(common({
    inspectWorker: () => ({ ok: true, data: observation }),
    killWorker: () => { killCalls += 1; return { ok: true, pid: 101 }; },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'INITIAL_WORKER_NOT_CANONICAL_AND_HEALTHY');
  assert.equal(killCalls, 0);
});

test('fails closed when exact source head does not match the expiring mailbox command', async () => {
  const result = await runBattleBridgeWorkerWatchdogAcceptance(common({
    readSourceIdentity: () => ({ ok: true, sourceHead: '0'.repeat(40), branch: 'main' }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'EXPECTED_HEAD_MISMATCH');
  assert.equal(result.expectedHeadMatch, false);
});

test('does not claim acceptance when neither direct nor published watchdog proof shows recovery', async () => {
  const observations = [healthyObservation(101), downObservation()];
  const result = await runBattleBridgeWorkerWatchdogAcceptance(common({
    inspectWorker: () => ({ ok: true, data: observations.shift() || downObservation() }),
    killWorker: (pid) => ({ ok: true, pid }),
    runWatchdog: async () => ({
      ok: true,
      classification: 'WORKER_WATCHDOG_HEALTHY',
      initialAssessment: { healthy: true },
      finalAssessment: { healthy: true },
    }),
    readWatchdogStatus: async () => ({
      timestampUtc: new Date().toISOString(),
      classification: 'WORKER_WATCHDOG_HEALTHY',
      supervisorDetectedWorkerDown: false,
      supervisorRestartedWorker: false,
      workerRecovered: true,
      workerFromMain: true,
    }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'WATCHDOG_RECOVERY_NOT_PROVEN');
  assert.equal(result.workerKilledObserved, true);
});

test('authority is fixed to one verified canonical worker kill with no generic execution', async () => {
  assert.equal(WORKER_WATCHDOG_ACCEPTANCE_AUTHORITY.maximumWorkerKillsPerRun, 1);
  assert.equal(WORKER_WATCHDOG_ACCEPTANCE_AUTHORITY.processKillAllowed, true);
  assert.equal(WORKER_WATCHDOG_ACCEPTANCE_AUTHORITY.processKillScope, 'verified-canonical-worker-only');
  assert.equal(WORKER_WATCHDOG_ACCEPTANCE_AUTHORITY.arbitraryPidAllowed, false);
  assert.equal(WORKER_WATCHDOG_ACCEPTANCE_AUTHORITY.arbitraryTaskNameAllowed, false);
  assert.equal(WORKER_WATCHDOG_ACCEPTANCE_AUTHORITY.arbitraryShellAllowed, false);
  assert.equal(WORKER_WATCHDOG_ACCEPTANCE_AUTHORITY.arbitraryPowerShellAllowed, false);
  assert.equal(WORKER_WATCHDOG_ACCEPTANCE_AUTHORITY.pcRestartAllowed, false);

  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /install-battle-bridge-worker-watchdog\.ps1/);
  assert.match(source, /probe-mission-orchestrator-worker-watchdog\.ps1/);
  assert.match(source, /killFn\(pid, 'SIGTERM'\)/);
  assert.match(source, /restartCooldownMs:\s*0/);
  assert.doesNotMatch(source, /Invoke-Expression|cmd\.exe|Restart-Computer|shutdown\.exe|git\.exe', \['(?:reset|clean|checkout|push|rebase)/i);
});
