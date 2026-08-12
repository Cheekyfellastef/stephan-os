import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CANONICAL_WINDOWS_POWERSHELL,
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
    },
    process: {
      running: healthy,
      taskName: healthy ? APPROVED_WORKER_TASK : '',
      pid: healthy ? 1291 : 0,
      commandLineMatchesCanonicalWorker: healthy,
    },
    heartbeat: {
      timestampUtc,
      repositoryRoot: paths.repoRoot,
      branch: 'main',
      headSha: heartbeatHead,
      taskName: APPROVED_WORKER_TASK,
      pid: healthy ? 1291 : 0,
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

function exactHeadRestartProof(headSha, terminatedVerifiedOwnedProcess = false) {
  return {
    started: true,
    restarted: true,
    taskName: APPROVED_WORKER_TASK,
    sourceHead: headSha,
    exactHeadProofOk: true,
    proofFresh: true,
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
      run(mode) {
        if (mode === 'StartApprovedWorkerTask') {
          starts += 1;
          return { ok: true, data: exactHeadRestartProof(currentHead, true) };
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
      run(mode) {
        if (mode === 'StartApprovedWorkerTask') {
          starts += 1;
          return { ok: true, data: exactHeadRestartProof('a'.repeat(40)) };
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
      run(mode) {
        if (mode === 'StartApprovedWorkerTask') {
          starts += 1;
          return { ok: true, data: exactHeadRestartProof('a'.repeat(40)) };
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
      run(mode) {
        if (mode === 'StartApprovedWorkerTask') starts += 1;
        return { ok: true, data: mode === 'Inspect' ? workerObservation({ paths, healthy: false }) : exactHeadRestartProof('a'.repeat(40)) };
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
  assert.equal(adapter.run('StartApprovedWorkerTask').ok, true);
  assert.throws(() => adapter.run('ArbitraryMode'), /Unsupported/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].executable, CANONICAL_WINDOWS_POWERSHELL);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
  assert.deepEqual(calls.map((call) => call.args.at(-1)), ['Inspect', 'StartApprovedWorkerTask']);
});
