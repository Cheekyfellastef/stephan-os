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
const repoRoot = '/canonical/Documents/GitHub/stephan-os';
const paths = Object.freeze({
  repoRoot,
  workspaceRoot: '/canonical/Documents/Stephanos-openclaw-workspace',
  installerPath: `${repoRoot}/scripts/windows/install-battle-bridge-worker-watchdog.ps1`,
  probePath: `${repoRoot}/scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1`,
});

function healthyObservation(pid, timestampUtc = new Date().toISOString()) {
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

function downObservation() {
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
      timestampUtc: new Date().toISOString(),
      repositoryRoot: repoRoot,
      branch: 'main',
      headSha: expectedHead,
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
    sleep: async () => {},
    ...overrides,
  };
}

test('canonical worker observation binds task, command, heartbeat, repository and exact head', () => {
  const result = assessCanonicalWorkerObservation(healthyObservation(101), {
    expectedHead,
    expectedRepoRoot: repoRoot,
    nowMs: Date.now(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.pid, 101);

  const wrongHead = assessCanonicalWorkerObservation({
    ...healthyObservation(101),
    heartbeat: { ...healthyObservation(101).heartbeat, headSha: '0'.repeat(40) },
  }, {
    expectedHead,
    expectedRepoRoot: repoRoot,
    nowMs: Date.now(),
  });
  assert.equal(wrongHead.ok, false);
  assert.ok(wrongHead.blockers.includes('WORKER_HEARTBEAT_HEAD_MISMATCH'));
});

test('runs one verified kill and proves watchdog detect, restart, recovery and Shared Workspace publication', async () => {
  const observations = [healthyObservation(101), downObservation(), healthyObservation(202)];
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

test('does not claim acceptance when the ordinary watchdog did not prove the recovery transition', async () => {
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
  assert.doesNotMatch(source, /Invoke-Expression|cmd\.exe|Restart-Computer|shutdown\.exe|git\.exe', \['(?:reset|clean|checkout|push|rebase)/i);
});
