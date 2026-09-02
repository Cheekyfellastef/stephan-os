import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CANONICAL_WINDOWS_POWERSHELL,
  WORKER_WATCHDOG_INITIAL_PROBE_TIMEOUT_MS,
  createFixedWorkerProbeAdapter,
  runBattleBridgeWorkerWatchdog,
} from './battle-bridge-worker-watchdog.mjs';
import { APPROVED_WORKER_TASK } from './battle-bridge-worker-watchdog-policy.mjs';

function canonicalPaths(root) {
  const repoRoot = path.join(root, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.join(root, 'Documents', 'Stephanos-openclaw-workspace');
  return {
    repoRoot,
    workspaceRoot,
    probeScriptPath: path.join(repoRoot, 'scripts', 'windows', 'probe-mission-orchestrator-worker-watchdog.ps1'),
    currentStatusPath: path.join(workspaceRoot, 'status', 'battle-bridge-worker-watchdog-current.json'),
  };
}

function workerObservation({
  paths,
  healthy = true,
  timestampUtc = new Date(Date.now() - 1_000).toISOString(),
  repositoryHead = 'a'.repeat(40),
  heartbeatHead = repositoryHead,
} = {}) {
  const launchIdentityId = '1'.repeat(64);
  const heartbeatMs = Date.parse(timestampUtc);
  const workerStartedAtUtc = new Date((Number.isFinite(heartbeatMs) ? heartbeatMs : Date.now()) - 60_000).toISOString();
  return {
    scheduledTask: {
      taskName: APPROVED_WORKER_TASK,
      status: healthy ? 'Running' : 'Ready',
      actionMatchesCanonicalWorker: true,
    },
    repository: {
      repositoryRoot: paths.repoRoot,
      branch: 'main',
      headSha: repositoryHead,
      remoteMainHeadSha: repositoryHead,
      trackedClean: true,
    },
    process: {
      running: healthy,
      taskName: healthy ? APPROVED_WORKER_TASK : '',
      pid: healthy ? 1291 : 0,
      commandLineMatchesCanonicalWorker: healthy,
      startedAtUtc: workerStartedAtUtc,
      launchIdentityId,
      launchIdentityVerified: healthy,
    },
    heartbeat: {
      timestampUtc,
      repositoryRoot: paths.repoRoot,
      branch: 'main',
      headSha: heartbeatHead,
      taskName: APPROVED_WORKER_TASK,
      pid: healthy ? 1291 : 0,
      launchIdentityId,
      workerStartedAtUtc,
    },
  };
}

async function withFixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worker-watchdog-'));
  const paths = canonicalPaths(root);
  await mkdir(paths.repoRoot, { recursive: true });
  try { await run({ root, paths }); } finally { await rm(root, { recursive: true, force: true }); }
}

async function readCurrentStatus(paths) {
  return JSON.parse(await readFile(paths.currentStatusPath, 'utf8'));
}

function assertOrdinaryWatchdogDidNotClaimCanaryKill(status) {
  assert.equal(status.workerKilledObserved, false);
}

function exactHeadRestartProof(headSha, deadlineUtc, terminatedVerifiedOwnedProcess = false) {
  return {
    started: true,
    restarted: true,
    taskName: APPROVED_WORKER_TASK,
    sourceHead: headSha,
    remoteMainHead: headSha,
    exactHeadProofOk: true,
    postStartSourceProofOk: true,
    sourceTrackedClean: true,
    proofFresh: true,
    startedWorkerPid: 1291,
    workerStartedAtUtc: '2026-08-12T20:00:01.000Z',
    invocationId: '1'.repeat(64),
    deadlineUtc,
    invocationBound: true,
    canonicalWorkerCommandVerified: true,
    cleanupAttempted: false,
    cleanupCompleted: false,
    terminatedVerifiedOwnedProcess,
    restartVerdict: 'APPROVED_RUNTIME_RESTART_PASS',
  };
}

test('healthy worker is a no-op and publishes Shared Workspace proof', async () => {
  await withFixture(async ({ paths }) => {
    const now = new Date();
    const heartbeatTimestamp = new Date(now.getTime() - 1_000).toISOString();
    const probeAdapter = { run: (mode) => ({ ok: true, data: mode === 'Inspect' ? workerObservation({ paths, timestampUtc: heartbeatTimestamp }) : null }) };
    const result = await runBattleBridgeWorkerWatchdog({
      paths,
      expectedPaths: paths,
      probeAdapter,
      now,
      sleep: async () => {},
    });
    assert.equal(result.ok, true);
    assert.equal(result.classification, 'WORKER_WATCHDOG_HEALTHY');
    assert.equal(result.publication.proofWrittenToSharedWorkspace, true);
    const status = await readCurrentStatus(paths);
    assertOrdinaryWatchdogDidNotClaimCanaryKill(status);
    assert.equal(status.supervisorRestartedWorker, false);
    assert.equal(status.workerFromMain, true);
    assert.equal(status.visiblePowerShellRequired, false);
  });
});

test('initial assessment samples time after the probe so a concurrently refreshed heartbeat is not falsely stale', async () => {
  await withFixture(async ({ paths }) => {
    const startedAt = new Date('2026-07-28T18:54:23.000Z');
    const heartbeatTimestamp = new Date(startedAt.getTime() + 500).toISOString();
    let starts = 0;
    const probeAdapter = {
      run(mode) {
        if (mode === 'StartApprovedWorkerTask') starts += 1;
        return { ok: true, data: workerObservation({ paths, timestampUtc: heartbeatTimestamp }) };
      },
    };
    const result = await runBattleBridgeWorkerWatchdog({
      paths,
      expectedPaths: paths,
      probeAdapter,
      now: startedAt,
      clock: () => startedAt.getTime() + 1_000,
      sleep: async () => {},
    });
    assert.equal(result.ok, true);
    assert.equal(result.classification, 'WORKER_WATCHDOG_HEALTHY');
    assert.equal(result.decision.assessment.heartbeatAgeMs, 500);
    assert.equal(starts, 0);
  });
});

test('old-head live worker is restarted once and recovery requires a current-head heartbeat', async () => {
  await withFixture(async ({ paths }) => {
    let starts = 0;
    let inspections = 0;
    const currentHead = 'a'.repeat(40);
    const oldHead = 'b'.repeat(40);
    const probeAdapter = {
      run(mode, options = {}) {
        if (mode === 'StartApprovedWorkerTask') {
          starts += 1;
          return { ok: true, data: exactHeadRestartProof(currentHead, options.deadlineUtc, true) };
        }
        inspections += 1;
        return {
          ok: true,
          data: workerObservation({
            paths,
            repositoryHead: currentHead,
            heartbeatHead: inspections > 1 ? currentHead : oldHead,
          }),
        };
      },
    };
    const result = await runBattleBridgeWorkerWatchdog({
      paths,
      expectedPaths: paths,
      probeAdapter,
      now: new Date(),
      sleep: async () => {},
    });
    assert.equal(result.ok, true);
    assert.equal(result.classification, 'WORKER_WATCHDOG_RECOVERED');
    assert.equal(result.initialAssessment.heartbeatMatchesCanonicalRepositoryHead, false);
    assert.ok(result.initialAssessment.blockers.includes('worker-heartbeat-head-mismatch'));
    assert.equal(result.finalAssessment.heartbeatMatchesCanonicalRepositoryHead, true);
    assert.equal(result.finalAssessment.sourceHead, currentHead);
    assert.equal(starts, 1);
    const status = await readCurrentStatus(paths);
    assert.equal(status.verifiedOwnedWorkerTerminationObserved, true);
    assert.equal(status.restartExactHeadProofOk, true);
    assert.equal(status.restartProofFresh, true);
    assert.equal(status.restartSourceHead, currentHead);
    assert.equal(status.restartVerdict, 'APPROVED_RUNTIME_RESTART_PASS');
    assertOrdinaryWatchdogDidNotClaimCanaryKill(status);
  });
});

test('unhealthy fixed worker is started once and bounded probes can prove recovery without claiming canary kill evidence', async () => {
  await withFixture(async ({ paths }) => {
    let starts = 0;
    let inspections = 0;
    const probeAdapter = {
      run(mode, options = {}) {
        if (mode === 'StartApprovedWorkerTask') {
          starts += 1;
          return { ok: true, data: exactHeadRestartProof('a'.repeat(40), options.deadlineUtc) };
        }
        inspections += 1;
        return { ok: true, data: workerObservation({ paths, healthy: inspections > 1 }) };
      },
    };
    const result = await runBattleBridgeWorkerWatchdog({ paths, expectedPaths: paths, probeAdapter, now: new Date(), sleep: async () => {} });
    assert.equal(result.ok, true);
    assert.equal(result.classification, 'WORKER_WATCHDOG_RECOVERED');
    assert.equal(starts, 1);
    assert.equal(result.recoveryProbeCount, 1);
    assert.equal(result.publication.proofWrittenToSharedWorkspace, true);
    const status = await readCurrentStatus(paths);
    assertOrdinaryWatchdogDidNotClaimCanaryKill(status);
    assert.equal(status.supervisorDetectedWorkerDown, true);
    assert.equal(status.supervisorRestartedWorker, true);
    assert.equal(status.workerRecovered, true);
  });
});

test('recovery starts at most once and fails after exactly three probes without claiming canary kill evidence', async () => {
  await withFixture(async ({ paths }) => {
    let starts = 0;
    let inspections = 0;
    const probeAdapter = {
      run(mode, options = {}) {
        if (mode === 'StartApprovedWorkerTask') {
          starts += 1;
          return { ok: true, data: exactHeadRestartProof('a'.repeat(40), options.deadlineUtc) };
        }
        inspections += 1;
        return { ok: true, data: workerObservation({ paths, healthy: false }) };
      },
    };
    const result = await runBattleBridgeWorkerWatchdog({ paths, expectedPaths: paths, probeAdapter, now: new Date(), sleep: async () => {} });
    assert.equal(result.ok, false);
    assert.equal(result.classification, 'WORKER_WATCHDOG_RECOVERY_FAILED');
    assert.equal(starts, 1);
    assert.equal(inspections, 4);
    assert.equal(result.recoveryProbeCount, 3);
    const status = await readCurrentStatus(paths);
    assertOrdinaryWatchdogDidNotClaimCanaryKill(status);
    assert.equal(status.supervisorDetectedWorkerDown, true);
    assert.equal(status.supervisorRestartedWorker, true);
    assert.equal(status.workerRecovered, false);
  });
});

test('one global run budget stops recovery probes in time to publish bounded failure', async () => {
  await withFixture(async ({ paths }) => {
    const startedAt = new Date('2026-08-12T20:00:00.000Z');
    let elapsedMs = 0;
    let inspections = 0;
    const observedTimeouts = [];
    const probeAdapter = {
      run(mode, options = {}) {
        observedTimeouts.push({ mode, timeoutMs: options.timeoutMs, deadlineUtc: options.deadlineUtc });
        if (mode === 'StartApprovedWorkerTask') {
          elapsedMs = 106_000;
          return { ok: true, data: exactHeadRestartProof('a'.repeat(40), options.deadlineUtc) };
        }
        inspections += 1;
        return { ok: true, data: workerObservation({ paths, healthy: false }) };
      },
    };
    const result = await runBattleBridgeWorkerWatchdog({
      paths,
      expectedPaths: paths,
      probeAdapter,
      now: startedAt,
      clock: () => startedAt.getTime() + elapsedMs,
      sleep: async () => {},
    });
    assert.equal(result.classification, 'WORKER_WATCHDOG_RECOVERY_FAILED');
    assert.equal(result.recoveryProbeCount, 0);
    assert.equal(inspections, 1);
    assert.deepEqual(observedTimeouts.map((item) => item.mode), ['Inspect', 'StartApprovedWorkerTask']);
    assert.equal(observedTimeouts[0].timeoutMs, WORKER_WATCHDOG_INITIAL_PROBE_TIMEOUT_MS);
    assert.ok(observedTimeouts[1].timeoutMs > 0 && observedTimeouts[1].timeoutMs <= 95_000);
    assert.equal(observedTimeouts[0].deadlineUtc, undefined);
    assert.equal(observedTimeouts[1].deadlineUtc, '2026-08-12T20:01:25.000Z');
    const status = await readCurrentStatus(paths);
    assert.equal(status.workerRecovered, false);
    assert.match(status.probeError, /run budget exhausted/);
  });
});

test('live lock blocks a second watchdog without starting the worker', async () => {
  await withFixture(async ({ paths }) => {
    const lockPath = path.join(paths.workspaceRoot, 'locks', 'battle-bridge-worker-watchdog.lock');
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({ pid: 4444, acquiredAtUtc: new Date().toISOString() })}\n`);
    let calls = 0;
    const result = await runBattleBridgeWorkerWatchdog({
      paths,
      expectedPaths: paths,
      probeAdapter: { run() { calls += 1; return { ok: false }; } },
      processIsAliveFn: () => true,
      now: new Date(),
    });
    assert.equal(result.classification, 'WORKER_WATCHDOG_LIVE_LOCK');
    assert.equal(calls, 0);
    const status = await readCurrentStatus(paths);
    assertOrdinaryWatchdogDidNotClaimCanaryKill(status);
  });
});

test('restart cooldown prevents repeated starts without claiming canary kill evidence', async () => {
  await withFixture(async ({ paths }) => {
    const now = new Date();
    await mkdir(path.dirname(paths.currentStatusPath), { recursive: true });
    await writeFile(paths.currentStatusPath, `${JSON.stringify({ restartAttemptedAtUtc: new Date(now.getTime() - 1_000).toISOString() })}\n`);
    let starts = 0;
    const probeAdapter = {
      run(mode, options = {}) {
        if (mode === 'StartApprovedWorkerTask') starts += 1;
        return { ok: true, data: mode === 'Inspect' ? workerObservation({ paths, healthy: false }) : exactHeadRestartProof('a'.repeat(40), options.deadlineUtc) };
      },
    };
    const result = await runBattleBridgeWorkerWatchdog({ paths, expectedPaths: paths, probeAdapter, now, sleep: async () => {} });
    assert.equal(result.classification, 'WORKER_WATCHDOG_RECOVERY_COOLDOWN');
    assert.equal(starts, 0);
    const status = await readCurrentStatus(paths);
    assertOrdinaryWatchdogDidNotClaimCanaryKill(status);
    assert.equal(status.supervisorDetectedWorkerDown, true);
    assert.equal(status.supervisorRestartedWorker, false);
  });
});

test('restart without a fresh exact-head adapter receipt fails closed', async () => {
  await withFixture(async ({ paths }) => {
    const probeAdapter = {
      run(mode) {
        if (mode === 'Inspect') return { ok: true, data: workerObservation({ paths, healthy: false }) };
        return { ok: true, data: { started: true, taskName: APPROVED_WORKER_TASK } };
      },
    };
    const result = await runBattleBridgeWorkerWatchdog({
      paths,
      expectedPaths: paths,
      probeAdapter,
      now: new Date(),
      sleep: async () => {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.classification, 'WORKER_WATCHDOG_START_FAILED');
    const status = await readCurrentStatus(paths);
    assert.equal(status.restartExactHeadProofOk, false);
    assert.equal(status.restartProofFresh, false);
    assert.equal(status.restartSourceHead, '');
  });
});

test('restart proof cannot claim success without post-start source and cleanup truth', async () => {
  const mutations = [
    (proof) => { proof.remoteMainHead = 'b'.repeat(40); },
    (proof) => { proof.postStartSourceProofOk = false; },
    (proof) => { proof.startedWorkerPid = 0; },
    (proof) => { proof.workerStartedAtUtc = 'not-a-timestamp'; },
    (proof) => { proof.cleanupAttempted = true; },
    (proof) => { proof.cleanupCompleted = true; },
    (proof) => { proof.invocationId = 'not-an-invocation'; },
    (proof) => { proof.deadlineUtc = '2026-08-12T20:00:00.000Z'; },
    (proof) => { proof.invocationBound = false; },
    (proof) => { proof.canonicalWorkerCommandVerified = false; },
  ];
  for (const mutate of mutations) {
    await withFixture(async ({ paths }) => {
      const probeAdapter = {
        run(mode, options = {}) {
          if (mode === 'Inspect') return { ok: true, data: workerObservation({ paths, healthy: false }) };
          const proof = exactHeadRestartProof('a'.repeat(40), options.deadlineUtc);
          mutate(proof);
          return { ok: true, data: proof };
        },
      };
      const result = await runBattleBridgeWorkerWatchdog({
        paths,
        expectedPaths: paths,
        probeAdapter,
        now: new Date('2026-08-12T20:00:00.000Z'),
        sleep: async () => {},
      });
      assert.equal(result.ok, false);
      assert.equal(result.classification, 'WORKER_WATCHDOG_START_FAILED');
    });
  }
});

test('fixed probe adapter preserves exactly one allowlisted typed Mission Worker restart blocker', () => {
  const adapter = createFixedWorkerProbeAdapter({
    probeScriptPath: 'C:\\canonical\\probe.ps1',
    spawnSyncFn() {
      return {
        status: 1,
        stdout: '',
        stderr: 'At probe.ps1:1 MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT',
      };
    },
  });
  const blocked = adapter.run('StartApprovedWorkerTask', {
    deadlineUtc: '2026-08-12T20:01:00.000Z',
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.restartBlocker, 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT');
  assert.equal(blocked.error, 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT');
});

test('fixed probe adapter refuses ambiguous or unallowlisted restart blocker promotion', () => {
  const results = [
    'MISSION_WORKER_NOT_ALLOWLISTED',
    'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT MISSION_WORKER_TASK_NOT_RUNNING_AFTER_START',
  ];
  for (const stderr of results) {
    const adapter = createFixedWorkerProbeAdapter({
      probeScriptPath: 'C:\\canonical\\probe.ps1',
      spawnSyncFn: () => ({ status: 1, stdout: '', stderr }),
    });
    const blocked = adapter.run('StartApprovedWorkerTask', {
      deadlineUtc: '2026-08-12T20:01:00.000Z',
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.restartBlocker, '');
    assert.equal(blocked.error, stderr);
  }
});

test('watchdog Shared Workspace status preserves a typed restart blocker without widening restart authority', async () => {
  await withFixture(async ({ paths }) => {
    const probeAdapter = {
      run(mode) {
        if (mode === 'Inspect') return { ok: true, data: workerObservation({ paths, healthy: false }) };
        return {
          ok: false,
          restartBlocker: 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT',
          error: 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT',
        };
      },
    };
    const result = await runBattleBridgeWorkerWatchdog({
      paths,
      expectedPaths: paths,
      probeAdapter,
      now: new Date(),
      sleep: async () => {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.classification, 'WORKER_WATCHDOG_START_FAILED');
    const status = await readCurrentStatus(paths);
    assert.equal(status.restartBlocker, 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT');
    assert.equal(status.probeError, 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT');
    assert.equal(status.supervisorRestartedWorker, true);
    assert.equal(status.workerRecovered, false);
    assertOrdinaryWatchdogDidNotClaimCanaryKill(status);
  });
});

test('fixed probe adapter uses one script, two modes, no shell and hidden PowerShell', () => {
  const calls = [];
  const adapter = createFixedWorkerProbeAdapter({
    probeScriptPath: 'C:\\canonical\\probe.ps1',
    spawnSyncFn(executable, args, options) {
      calls.push({ executable, args, options });
      return { status: 0, stdout: '{"scheduledTask":{}}', stderr: '' };
    },
  });
  assert.equal(adapter.run('Inspect').ok, true);
  assert.equal(adapter.run('StartApprovedWorkerTask', { deadlineUtc: '2026-08-12T20:01:00.000Z' }).ok, true);
  assert.throws(() => adapter.run('ArbitraryMode'), /Unsupported/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].executable, CANONICAL_WINDOWS_POWERSHELL);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.timeout, WORKER_WATCHDOG_INITIAL_PROBE_TIMEOUT_MS);
  assert.deepEqual(calls[0].args.slice(-2), ['-Mode', 'Inspect']);
  assert.deepEqual(calls[1].args.slice(-4), ['-Mode', 'StartApprovedWorkerTask', '-DeadlineUtc', '2026-08-12T20:01:00.000Z']);
  assert.throws(() => adapter.run('StartApprovedWorkerTask'), /deadline/);
  assert.throws(() => adapter.run('Inspect', { deadlineUtc: '2026-08-12T20:01:00.000Z' }), /cannot receive/);
});
