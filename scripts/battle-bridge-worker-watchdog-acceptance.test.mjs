import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  APPROVED_WATCHDOG_TASK,
  APPROVED_WORKER_TASK,
  INSTALLED_WATCHDOG_RECOVERY_CLASSIFICATIONS,
  WORKER_WATCHDOG_ACCEPTANCE_AUTHORITY,
  assessCanonicalWorkerObservation,
  classifyInstalledWatchdogRecoveryBoundary,
  publishAcceptanceProofTransaction,
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
  statusScriptPath: `${repoRoot}/scripts/windows/status-battle-bridge-worker-watchdog.ps1`,
  probePath: `${repoRoot}/scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1`,
  watchdogStatusPath: `${workspaceRoot}/status/battle-bridge-worker-watchdog-current.json`,
  watchdogLaunchStatusPath: `${workspaceRoot}/status/battle-bridge-worker-watchdog-launch-current.json`,
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

function common(overrides = {}) {
  const installationBaseMs = Date.now();
  let installationReads = 0;
  return {
    expectedHead,
    platform: 'win32',
    paths,
    expectedPaths: paths,
    readSourceIdentity: () => ({ ok: true, sourceHead: expectedHead, branch: 'main' }),
    installWatchdog: () => ({
      ok: true,
      data: { installed: true, taskName: APPROVED_WATCHDOG_TASK, startedNow: false },
    }),
    startWatchdog: () => ({
      ok: true,
      data: { installed: true, taskName: APPROVED_WATCHDOG_TASK, startedNow: true },
    }),
    inspectWatchdogInstallation: () => ({
      ok: true,
      data: {
        installed: true,
        taskState: 'Ready',
        lastRunTimeUtc: new Date(installationBaseMs + (installationReads++ * 1_000)).toISOString(),
        lastTaskResult: 0,
      },
    }),
    readWatchdogStatus: async () => healthyStatus(new Date().toISOString()),
    readWatchdogLaunchStatus: async () => completedLaunchStatus(new Date().toISOString()),
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

test('classifies a Scheduled Task launch failure before wrapper evidence exists', () => {
  const startedAtMs = Date.parse('2026-07-28T19:00:00.000Z');
  const result = classifyInstalledWatchdogRecoveryBoundary({
    startedAtMs,
    baselineTaskLastRunTimeMs: startedAtMs - 5_000,
    installation: { ok: true, data: { lastRunTimeUtc: new Date(startedAtMs - 5_000).toISOString() } },
  });
  assert.equal(result.classification, INSTALLED_WATCHDOG_RECOVERY_CLASSIFICATIONS.scheduledTaskLaunchFailure);
});

test('classifies a hidden-wrapper failure after the Scheduled Task advances without a wrapper receipt', () => {
  const startedAtMs = Date.parse('2026-07-28T19:00:00.000Z');
  const result = classifyInstalledWatchdogRecoveryBoundary({
    startedAtMs,
    baselineTaskLastRunTimeMs: startedAtMs - 5_000,
    installation: { ok: true, data: { lastRunTimeUtc: new Date(startedAtMs + 1_000).toISOString(), lastTaskResult: 2 } },
  });
  assert.equal(result.classification, INSTALLED_WATCHDOG_RECOVERY_CLASSIFICATIONS.hiddenWrapperFailure);
});

test('classifies a watchdog-runner startup failure from a fresh wrapper lifecycle receipt', () => {
  const startedAtMs = Date.parse('2026-07-28T19:00:00.000Z');
  const result = classifyInstalledWatchdogRecoveryBoundary({
    startedAtMs,
    baselineTaskLastRunTimeMs: startedAtMs - 5_000,
    installation: { ok: true, data: { lastRunTimeUtc: new Date(startedAtMs + 1_000).toISOString(), lastTaskResult: 2 } },
    launchStatus: {
      timestampUtc: new Date(startedAtMs + 500).toISOString(),
      classification: 'WATCHDOG_RUNNER_FAILED',
      runnerStarted: true,
      runnerCompleted: true,
    },
  });
  assert.equal(result.classification, INSTALLED_WATCHDOG_RECOVERY_CLASSIFICATIONS.runnerStartupFailure);
});

test('classifies an explicit worker restart failure such as the live cooldown receipt', () => {
  const startedAtMs = Date.parse('2026-07-28T19:00:00.000Z');
  const result = classifyInstalledWatchdogRecoveryBoundary({
    startedAtMs,
    baselineTaskLastRunTimeMs: startedAtMs - 5_000,
    installation: { ok: true, data: { lastRunTimeUtc: new Date(startedAtMs + 1_000).toISOString(), lastTaskResult: 2 } },
    launchStatus: completedLaunchStatus(new Date(startedAtMs + 500).toISOString()),
    watchdogStatus: {
      timestampUtc: new Date(startedAtMs + 750).toISOString(),
      classification: 'WORKER_WATCHDOG_RECOVERY_COOLDOWN',
    },
    workerAssessment: { ok: false },
  });
  assert.equal(result.classification, INSTALLED_WATCHDOG_RECOVERY_CLASSIFICATIONS.workerRestartFailure);
  assert.equal(result.watchdogClassification, 'WORKER_WATCHDOG_RECOVERY_COOLDOWN');
});

test('classifies recovery publication failure when the worker recovered but exact publication is absent', () => {
  const startedAtMs = Date.parse('2026-07-28T19:00:00.000Z');
  const result = classifyInstalledWatchdogRecoveryBoundary({
    startedAtMs,
    baselineTaskLastRunTimeMs: startedAtMs - 5_000,
    installation: { ok: true, data: { lastRunTimeUtc: new Date(startedAtMs + 1_000).toISOString(), lastTaskResult: 0 } },
    launchStatus: completedLaunchStatus(new Date(startedAtMs + 500).toISOString()),
    workerAssessment: { ok: true },
  });
  assert.equal(result.classification, INSTALLED_WATCHDOG_RECOVERY_CLASSIFICATIONS.recoveryPublicationFailure);
});

test('classifies successful recovery only from exact fresh publication plus positive worker proof', () => {
  const startedAtMs = Date.parse('2026-07-28T19:00:00.000Z');
  const result = classifyInstalledWatchdogRecoveryBoundary({
    startedAtMs,
    baselineTaskLastRunTimeMs: startedAtMs - 5_000,
    installation: { ok: true, data: { lastRunTimeUtc: new Date(startedAtMs + 1_000).toISOString(), lastTaskResult: 0 } },
    launchStatus: completedLaunchStatus(new Date(startedAtMs + 500).toISOString()),
    watchdogStatus: recoveredStatus(new Date(startedAtMs + 750).toISOString()),
    workerAssessment: { ok: true },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.classification, INSTALLED_WATCHDOG_RECOVERY_CLASSIFICATIONS.success);
});

test('kills once, starts the installed watchdog task and requires fresh task-published recovery before exact-head proof', async () => {
  const nowMs = Date.now();
  const timestampUtc = new Date(nowMs).toISOString();
  const observations = [
    healthyObservation(101, timestampUtc, previousHead),
    healthyObservation(101, timestampUtc, previousHead),
    downObservation(timestampUtc),
    healthyObservation(202, timestampUtc),
  ];
  const statuses = [
    healthyStatus(timestampUtc),
    recoveredStatus(new Date(nowMs + 1_000).toISOString()),
  ];
  const actions = [];
  const result = await runBattleBridgeWorkerWatchdogAcceptance(common({
    now: new Date(nowMs),
    clock: () => nowMs,
    inspectWorker: () => ({ ok: true, data: observations.shift() }),
    killWorker: (pid) => { actions.push(`kill:${pid}`); return { ok: true, pid }; },
    startWatchdog: () => {
      actions.push('start-installed-watchdog');
      return { ok: true, data: { installed: true, taskName: APPROVED_WATCHDOG_TASK, startedNow: true } };
    },
    readWatchdogStatus: async () => statuses.shift() || recoveredStatus(timestampUtc),
    publishProof: async ({ evidence }) => ({
      ok: evidence.watchdogStartedThroughScheduledTask === true,
      proofWrittenToSharedWorkspace: true,
      publicationState: 'COMMITTED',
      proofRefs: ['receipts/battle-bridge-worker-watchdog-acceptance/proof.json'],
    }),
  }));

  assert.deepEqual(actions, ['start-installed-watchdog', 'kill:101', 'start-installed-watchdog']);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.finalVerdict, 'WORKER_WATCHDOG_ACCEPTANCE_PASS');
  assert.equal(result.watchdogRecoveryRoute, 'installed-scheduled-task');
  assert.equal(result.recoveryClassification, INSTALLED_WATCHDOG_RECOVERY_CLASSIFICATIONS.success);
  assert.equal(result.watchdogStartedThroughScheduledTask, true);
  assert.equal(result.initialHead, previousHead);
  assert.equal(result.recoveredHead, expectedHead);
  assert.equal(result.initialPid, 101);
  assert.equal(result.recoveredPid, 202);
  assert.equal(result.workerKilledObserved, true);
  assert.equal(result.supervisorDetectedWorkerDown, true);
  assert.equal(result.supervisorRestartedWorker, true);
  assert.equal(result.workerRecovered, true);
  assert.equal(result.workerFromMain, true);
  assert.equal(result.proofWrittenToSharedWorkspace, true);
  assert.equal(result.publicationState, 'COMMITTED');
  assert.equal(result.visiblePowerShellRequired, false);
});

test('fails closed if the installed watchdog Scheduled Task start is not proven', async () => {
  const nowMs = Date.now();
  const timestampUtc = new Date(nowMs).toISOString();
  const observations = [
    healthyObservation(101, timestampUtc, previousHead),
    healthyObservation(101, timestampUtc, previousHead),
    downObservation(timestampUtc),
  ];
  let starts = 0;
  const result = await runBattleBridgeWorkerWatchdogAcceptance(common({
    now: new Date(nowMs),
    clock: () => nowMs,
    inspectWorker: () => ({ ok: true, data: observations.shift() || downObservation(timestampUtc) }),
    killWorker: (pid) => ({ ok: true, pid }),
    startWatchdog: () => {
      starts += 1;
      return {
        ok: true,
        data: { installed: true, taskName: APPROVED_WATCHDOG_TASK, startedNow: starts === 1 },
      };
    },
    readWatchdogStatus: async () => healthyStatus(timestampUtc),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, INSTALLED_WATCHDOG_RECOVERY_CLASSIFICATIONS.scheduledTaskLaunchFailure);
  assert.equal(result.recoveryClassification, INSTALLED_WATCHDOG_RECOVERY_CLASSIFICATIONS.scheduledTaskLaunchFailure);
  assert.equal(result.workerKilledObserved, true);
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

test('stops with HEAD_CHANGED when canonical source moves after priming but before the worker kill', async () => {
  const nowMs = Date.now();
  const timestampUtc = new Date(nowMs).toISOString();
  let sourceReads = 0;
  let killCalls = 0;
  const observations = [
    healthyObservation(101, timestampUtc),
    healthyObservation(101, timestampUtc),
  ];
  const result = await runBattleBridgeWorkerWatchdogAcceptance(common({
    now: new Date(nowMs),
    clock: () => nowMs,
    readSourceIdentity: () => {
      sourceReads += 1;
      return {
        ok: true,
        sourceHead: sourceReads === 1 ? expectedHead : '0'.repeat(40),
        branch: 'main',
      };
    },
    inspectWorker: () => ({ ok: true, data: observations.shift() || healthyObservation(101, timestampUtc) }),
    readWatchdogStatus: async () => healthyStatus(timestampUtc),
    killWorker: () => {
      killCalls += 1;
      return { ok: true, pid: 101 };
    },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'HEAD_CHANGED');
  assert.equal(result.workerKilled, false);
  assert.equal(killCalls, 0);
});

test('does not claim acceptance without fresh installed-task recovery status', async () => {
  const nowMs = Date.now();
  const timestampUtc = new Date(nowMs).toISOString();
  const observations = [
    healthyObservation(101, timestampUtc),
    healthyObservation(101, timestampUtc),
    downObservation(timestampUtc),
  ];
  let statusReads = 0;
  const result = await runBattleBridgeWorkerWatchdogAcceptance(common({
    now: new Date(nowMs),
    clock: () => nowMs,
    inspectWorker: () => ({ ok: true, data: observations.shift() || downObservation(timestampUtc) }),
    killWorker: (pid) => ({ ok: true, pid }),
    readWatchdogStatus: async () => {
      statusReads += 1;
      return healthyStatus(new Date(nowMs + statusReads).toISOString());
    },
    readWatchdogLaunchStatus: async () => completedLaunchStatus(new Date(nowMs + 2_000).toISOString()),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, INSTALLED_WATCHDOG_RECOVERY_CLASSIFICATIONS.workerRestartFailure);
  assert.equal(result.recoveryClassification, INSTALLED_WATCHDOG_RECOVERY_CLASSIFICATIONS.workerRestartFailure);
  assert.equal(result.workerKilledObserved, true);
});

test('publication stages non-PASS proof and event before atomically committing PASS through current status', async () => {
  const calls = [];
  const store = {
    createSharedWorkspaceProofRecord: (record) => ({ recordKind: 'proof', ...record }),
    createSharedWorkspaceEventRecord: (record) => ({ recordKind: 'event', ...record }),
    createSharedWorkspaceStatusRecord: (record) => ({ recordKind: 'status', ...record }),
    writeAtomicJson: async (_root, target, record) => {
      calls.push({ operation: 'write', target: target.join('/'), record });
      return { ok: true, path: target.join('/') };
    },
    appendWorkspaceJsonl: async (_root, target, record) => {
      calls.push({ operation: 'append', target: target.join('/'), record });
      return { ok: true, path: target.join('/') };
    },
  };
  const result = await publishAcceptanceProofTransaction({
    paths,
    now: new Date('2026-07-17T16:00:00.000Z'),
    evidence: { finalVerdict: 'WORKER_WATCHDOG_ACCEPTANCE_PASS', workerRecovered: true },
    store,
  });

  assert.equal(result.ok, true);
  assert.equal(result.publicationState, 'COMMITTED');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].record.status, 'WORKER_WATCHDOG_ACCEPTANCE_EVIDENCE_READY');
  assert.equal(calls[0].record.publicationState, 'STAGED');
  assert.equal(calls[0].record.acceptancePass, false);
  assert.equal(calls[1].record.eventKind, 'battle-bridge-worker-watchdog-acceptance-evidence-ready');
  assert.equal(calls[1].record.publicationState, 'STAGED');
  assert.equal(calls[1].record.acceptancePass, false);
  assert.equal(calls[2].record.status, 'WORKER_WATCHDOG_ACCEPTANCE_PASS');
  assert.equal(calls[2].record.publicationState, 'COMMITTED');
  assert.equal(calls[2].record.acceptancePass, true);
});

test('publication failure leaves no durable PASS record', async () => {
  const calls = [];
  const store = {
    createSharedWorkspaceProofRecord: (record) => ({ recordKind: 'proof', ...record }),
    createSharedWorkspaceEventRecord: (record) => ({ recordKind: 'event', ...record }),
    createSharedWorkspaceStatusRecord: (record) => ({ recordKind: 'status', ...record }),
    writeAtomicJson: async (_root, target, record) => {
      calls.push({ operation: 'write', target: target.join('/'), record });
      return { ok: true, path: target.join('/') };
    },
    appendWorkspaceJsonl: async (_root, target, record) => {
      calls.push({ operation: 'append', target: target.join('/'), record });
      return { ok: false, reason: 'TEST_FAILURE' };
    },
  };

  await assert.rejects(
    publishAcceptanceProofTransaction({
      paths,
      now: new Date('2026-07-17T16:00:00.000Z'),
      evidence: { finalVerdict: 'WORKER_WATCHDOG_ACCEPTANCE_PASS', workerRecovered: true },
      store,
    }),
    /ACCEPTANCE_EVIDENCE_EVENT_WRITE_FAILED/,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls.some((call) => call.record.acceptancePass === true), false);
  assert.equal(calls.some((call) => call.record.status === 'WORKER_WATCHDOG_ACCEPTANCE_PASS'), false);
});

test('authority is fixed to one verified canonical worker kill with no generic execution or direct watchdog bypass', async () => {
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
  assert.match(source, /args\.push\('-StartNow'\)/);
  assert.match(source, /killFn\(pid, 'SIGTERM'\)/);
  assert.doesNotMatch(source, /await import\('\.\/battle-bridge-worker-watchdog\.mjs'\)|Invoke-Expression|cmd\.exe|Restart-Computer|shutdown\.exe|git\.exe', \['(?:reset|clean|checkout|push|rebase)/i);
});
