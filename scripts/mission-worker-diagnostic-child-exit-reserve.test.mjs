import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS,
  MISSION_WORKER_DIAGNOSTIC_LINK_DEADLINE_MS,
  MISSION_WORKER_DIAGNOSTIC_LINK_RESTART_AUTHORITY_MS,
  MISSION_WORKER_DIAGNOSTIC_LINK_TERMINAL_PUBLICATION_RESERVE_MS,
  runMissionWorkerDiagnosticLink,
} from './mission-worker-diagnostic-link.mjs';
import {
  WORKER_WATCHDOG_CHILD_EXIT_RESERVE_MS,
  WORKER_WATCHDOG_START_TIMEOUT_MS,
  resolveCanonicalWorkerWatchdogPaths,
} from './battle-bridge-worker-watchdog.mjs';

const HEAD = 'f7a71effd7acb5fc4dd05a5a6891e050a6448d02';
const NOW = new Date('2026-09-01T18:00:00.000Z');

function identity() {
  return {
    ok: true,
    sourceHead: HEAD,
    expectedHead: HEAD,
    expectedHeadMatch: true,
    branch: 'main',
  };
}

function successData(deadlineUtc) {
  return {
    mode: 'StartApprovedWorkerTask',
    taskName: 'Stephanos Mission Orchestrator Worker',
    taskActionMatchesCanonicalWorker: true,
    started: true,
    restarted: true,
    sourceHead: HEAD,
    remoteMainHead: HEAD,
    exactHeadProofOk: true,
    sourceTrackedClean: true,
    proofFresh: true,
    startedWorkerPid: 4242,
    workerStartedAtUtc: '2026-09-01T18:00:01.000Z',
    invocationId: 'a'.repeat(64),
    deadlineUtc,
    invocationBound: true,
    canonicalWorkerCommandVerified: true,
    postStartSourceProofOk: true,
    cleanupAttempted: false,
    cleanupCompleted: false,
    terminatedVerifiedOwnedProcess: false,
    verifiedOwnedProcessTerminationOnly: true,
    restartVerdict: 'APPROVED_RUNTIME_RESTART_PASS',
    arbitraryTaskNameAllowed: false,
    arbitraryProcessKillAllowed: false,
    arbitraryPowerShellAllowed: false,
    visiblePowerShellRequired: false,
  };
}

function dependencies(createProbeAdapter) {
  const canonicalPaths = resolveCanonicalWorkerWatchdogPaths();
  return {
    readSourceIdentity: async () => identity(),
    resolvePaths: () => canonicalPaths,
    validatePaths: () => ({ ok: true }),
    now: () => new Date(NOW),
    createProbeAdapter,
  };
}

test('diagnostic reuses watchdog child-exit reserve without widening restart authority', () => {
  assert.equal(MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS, WORKER_WATCHDOG_START_TIMEOUT_MS);
  assert.equal(
    MISSION_WORKER_DIAGNOSTIC_LINK_RESTART_AUTHORITY_MS,
    WORKER_WATCHDOG_START_TIMEOUT_MS - WORKER_WATCHDOG_CHILD_EXIT_RESERVE_MS,
  );
  assert.equal(WORKER_WATCHDOG_START_TIMEOUT_MS, 95_000);
  assert.equal(WORKER_WATCHDOG_CHILD_EXIT_RESERVE_MS, 10_000);
  assert.equal(MISSION_WORKER_DIAGNOSTIC_LINK_RESTART_AUTHORITY_MS, 85_000);
  assert.equal(MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS, 95_000);
  assert.equal(MISSION_WORKER_DIAGNOSTIC_LINK_TERMINAL_PUBLICATION_RESERVE_MS, 10_000);
  assert.equal(MISSION_WORKER_DIAGNOSTIC_LINK_DEADLINE_MS, 105_000);
});

test('StartApprovedWorkerTask gets 85-second authority inside a 95-second child process budget', async () => {
  let observed = null;
  const result = await runMissionWorkerDiagnosticLink({ expectedHead: HEAD }, dependencies(() => ({
    run: (mode, options) => {
      observed = { mode, options };
      return { ok: true, mode, data: successData(options.deadlineUtc) };
    },
  })));

  assert.equal(result.ok, true);
  assert.equal(observed.mode, 'StartApprovedWorkerTask');
  assert.equal(observed.options.timeoutMs, 95_000);
  assert.equal(observed.options.deadlineUtc, '2026-09-01T18:01:25.000Z');
  assert.equal(result.deadlineUtc, '2026-09-01T18:01:25.000Z');
  assert.equal(result.childDeadlineUtc, '2026-09-01T18:01:25.000Z');
  assert.equal(result.restartAuthorityMs, 85_000);
  assert.equal(result.childTimeoutMs, 95_000);
  assert.equal(result.diagnosticDeadlineUtc, '2026-09-01T18:01:45.000Z');
});

test('typed terminal blocker can be returned during the child-exit reserve', async () => {
  let observed = null;
  const result = await runMissionWorkerDiagnosticLink({ expectedHead: HEAD }, dependencies(() => ({
    run: (mode, options) => {
      observed = { mode, options };
      return {
        ok: false,
        restartBlocker: 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT',
        error: 'raw child stderr must not escape',
      };
    },
  })));

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT');
  assert.equal(result.typedRestartBlocker, 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT');
  assert.equal(observed.options.deadlineUtc, '2026-09-01T18:01:25.000Z');
  assert.equal(observed.options.timeoutMs, 95_000);
  assert.equal(result.restartAuthorityMs, 85_000);
  assert.equal(result.childTimeoutMs, 95_000);
  assert.equal(result.diagnosticDeadlineUtc, '2026-09-01T18:01:45.000Z');
  assert.equal(result.error, undefined);
});
