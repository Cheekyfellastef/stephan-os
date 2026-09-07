import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS,
  MISSION_WORKER_DIAGNOSTIC_LINK_DEADLINE_MS,
  MISSION_WORKER_DIAGNOSTIC_LINK_TERMINAL_PUBLICATION_RESERVE_MS,
  runMissionWorkerDiagnosticLink,
} from './mission-worker-diagnostic-link.mjs';
import {
  WORKER_WATCHDOG_INITIAL_PROBE_TIMEOUT_MS,
  resolveCanonicalWorkerWatchdogPaths,
} from './battle-bridge-worker-watchdog.mjs';

const HEAD = 'f7a71effd7acb5fc4dd05a5a6891e050a6448d02';
const NOW = new Date('2026-09-01T18:00:00.000Z');

function identity(overrides = {}) {
  return {
    ok: true,
    sourceHead: HEAD,
    expectedHead: HEAD,
    expectedHeadMatch: true,
    branch: 'main',
    ...overrides,
  };
}

function inspectData(overrides = {}) {
  return {
    mode: 'Inspect',
    repository: {
      branch: 'main',
      headSha: HEAD,
      remoteMainHeadSha: HEAD,
      trackedClean: true,
      headMatchesRemoteMain: true,
      headProven: true,
      ...overrides,
    },
  };
}

function successData(overrides = {}) {
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
    deadlineUtc: new Date(NOW.getTime() + MISSION_WORKER_DIAGNOSTIC_LINK_DEADLINE_MS).toISOString(),
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
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  const canonicalPaths = resolveCanonicalWorkerWatchdogPaths();
  return {
    readSourceIdentity: async () => identity(),
    resolvePaths: () => canonicalPaths,
    validatePaths: () => ({ ok: true }),
    now: () => new Date(NOW),
    createProbeAdapter: ({ probeScriptPath }) => ({
      run: (mode, options) => ({
        ok: true,
        mode,
        data: successData({ deadlineUtc: options.deadlineUtc }),
        probeScriptPath,
      }),
    }),
    ...overrides,
  };
}

test('diagnostic child timeout stays strictly inside authority with terminal publication reserve', () => {
  assert.ok(MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS > 0);
  assert.ok(MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS < MISSION_WORKER_DIAGNOSTIC_LINK_DEADLINE_MS);
  assert.equal(
    MISSION_WORKER_DIAGNOSTIC_LINK_DEADLINE_MS - MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS,
    MISSION_WORKER_DIAGNOSTIC_LINK_TERMINAL_PUBLICATION_RESERVE_MS,
  );
  assert.equal(MISSION_WORKER_DIAGNOSTIC_LINK_TERMINAL_PUBLICATION_RESERVE_MS, 10_000);
});

test('requires an exact 40-character expected head before any start route exists', async () => {
  let identityRead = false;
  const result = await runMissionWorkerDiagnosticLink({}, dependencies({
    readSourceIdentity: async () => {
      identityRead = true;
      return identity();
    },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MISSION_WORKER_DIAGNOSTIC_LINK_EXPECTED_HEAD_REQUIRED');
  assert.equal(identityRead, false);
});

test('default route physically inspects exact main before StartApprovedWorkerTask', async () => {
  const calls = [];
  const deps = dependencies({
    readSourceIdentity: undefined,
    createProbeAdapter: () => ({
      run: (mode, options) => {
        calls.push({ mode, options });
        if (mode === 'Inspect') return { ok: true, data: inspectData() };
        if (mode === 'StartApprovedWorkerTask') {
          return { ok: true, data: successData({ deadlineUtc: options.deadlineUtc }) };
        }
        throw new Error(`unexpected mode ${mode}`);
      },
    }),
  });
  const result = await runMissionWorkerDiagnosticLink({ expectedHead: HEAD }, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.mode), ['Inspect', 'StartApprovedWorkerTask']);
  assert.equal(calls[0].options.timeoutMs, WORKER_WATCHDOG_INITIAL_PROBE_TIMEOUT_MS);
  assert.equal(calls[1].options.timeoutMs, MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS);
  assert.equal(calls[1].options.deadlineUtc, '2026-09-01T18:01:20.000Z');
  assert.equal(result.childTimeoutMs, MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS);
  assert.equal(result.terminalPublicationReserveMs, MISSION_WORKER_DIAGNOSTIC_LINK_TERMINAL_PUBLICATION_RESERVE_MS);
});

test('default physical inspect mismatch prevents any worker start attempt', async () => {
  const calls = [];
  const deps = dependencies({
    readSourceIdentity: undefined,
    createProbeAdapter: () => ({
      run: (mode, options) => {
        calls.push({ mode, options });
        return {
          ok: true,
          data: inspectData({ remoteMainHeadSha: '1'.repeat(40), headMatchesRemoteMain: false }),
        };
      },
    }),
  });
  const result = await runMissionWorkerDiagnosticLink({ expectedHead: HEAD }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MISSION_WORKER_DIAGNOSTIC_LINK_SOURCE_IDENTITY_NOT_PROVEN');
  assert.deepEqual(calls.map((call) => call.mode), ['Inspect']);
});

test('fails closed when current source identity is not exact approved main', async () => {
  let probeCalled = false;
  const result = await runMissionWorkerDiagnosticLink({ expectedHead: HEAD }, dependencies({
    readSourceIdentity: async () => identity({ sourceHead: '1'.repeat(40), expectedHeadMatch: false }),
    createProbeAdapter: () => ({
      run: () => {
        probeCalled = true;
        return { ok: true, data: successData() };
      },
    }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MISSION_WORKER_DIAGNOSTIC_LINK_SOURCE_IDENTITY_NOT_PROVEN');
  assert.equal(probeCalled, false);
});

test('fails closed before worker start when canonical probe path proof fails', async () => {
  let probeCalled = false;
  const result = await runMissionWorkerDiagnosticLink({ expectedHead: HEAD }, dependencies({
    validatePaths: () => ({ ok: false, reason: 'NON_CANONICAL_PROBE_PATH' }),
    createProbeAdapter: () => ({
      run: () => {
        probeCalled = true;
        return { ok: true, data: successData() };
      },
    }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MISSION_WORKER_DIAGNOSTIC_LINK_CANONICAL_PATH_NOT_PROVEN');
  assert.equal(probeCalled, false);
});

test('uses only StartApprovedWorkerTask with a bounded child timeout and preserves typed restart blocker', async () => {
  let observed = null;
  const result = await runMissionWorkerDiagnosticLink({ expectedHead: HEAD }, dependencies({
    createProbeAdapter: ({ probeScriptPath }) => ({
      run: (mode, options) => {
        observed = { probeScriptPath, mode, options };
        return {
          ok: false,
          restartBlocker: 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT',
          error: 'raw text must not escape',
        };
      },
    }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT');
  assert.equal(result.typedRestartBlocker, 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT');
  assert.equal(result.error, undefined);
  assert.equal(observed.mode, 'StartApprovedWorkerTask');
  assert.equal(observed.options.timeoutMs, MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS);
  assert.equal(observed.options.deadlineUtc, '2026-09-01T18:01:20.000Z');
  assert.equal(result.childTimeoutMs, MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS);
  assert.equal(result.terminalPublicationReserveMs, MISSION_WORKER_DIAGNOSTIC_LINK_TERMINAL_PUBLICATION_RESERVE_MS);
  assert.match(observed.probeScriptPath, /probe-mission-orchestrator-worker-watchdog\.ps1$/i);
});

test('bounded child timeout or untyped execution failure returns a typed terminal blocker', async () => {
  const result = await runMissionWorkerDiagnosticLink({ expectedHead: HEAD }, dependencies({
    createProbeAdapter: () => ({
      run: (_mode, options) => {
        assert.equal(options.timeoutMs, MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS);
        return { ok: false, restartBlocker: '', error: 'ETIMEDOUT' };
      },
    }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.finalVerdict, 'MISSION_WORKER_DIAGNOSTIC_LINK_BLOCKED');
  assert.equal(result.blocker, 'MISSION_WORKER_DIAGNOSTIC_LINK_START_FAILED');
  assert.equal(result.typedRestartBlocker, '');
  assert.equal(result.error, undefined);
  assert.equal(result.childTimeoutMs, MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS);
  assert.equal(result.terminalPublicationReserveMs, MISSION_WORKER_DIAGNOSTIC_LINK_TERMINAL_PUBLICATION_RESERVE_MS);
});

test('cannot claim success without fresh exact-head canonical launch proof', async () => {
  const result = await runMissionWorkerDiagnosticLink({ expectedHead: HEAD }, dependencies({
    createProbeAdapter: () => ({
      run: () => ({ ok: true, data: successData({ proofFresh: false }) }),
    }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MISSION_WORKER_DIAGNOSTIC_LINK_SUCCESS_PROOF_INVALID');
});

test('successful link bridges only watchdog decision and leaves downstream safeguards proved', async () => {
  const result = await runMissionWorkerDiagnosticLink({ expectedHead: HEAD }, dependencies());
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'MISSION_WORKER_DIAGNOSTIC_LINK_PASS');
  assert.equal(result.bypassedWatchdogDecision, true);
  assert.equal(result.normalWatchdogPolicyModified, false);
  assert.equal(result.persistentBypassInstalled, false);
  assert.equal(result.exactHeadProofOk, true);
  assert.equal(result.proofFresh, true);
  assert.equal(result.canonicalWorkerCommandVerified, true);
  assert.equal(result.postStartSourceProofOk, true);
  assert.equal(result.arbitraryTaskNameAllowed, false);
  assert.equal(result.arbitraryExecutableAllowed, false);
  assert.equal(result.arbitraryPathAllowed, false);
  assert.equal(result.arbitraryArgumentsAllowed, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.destructiveGitAllowed, false);
  assert.equal(result.pcRestartAllowed, false);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.liveOpenClawUpdateAllowed, false);
});
