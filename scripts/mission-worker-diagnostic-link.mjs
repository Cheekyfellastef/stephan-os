import {
  WORKER_WATCHDOG_START_TIMEOUT_MS,
  createFixedWorkerProbeAdapter,
  resolveCanonicalWorkerWatchdogPaths,
  validateCanonicalWorkerWatchdogPaths,
} from './battle-bridge-worker-watchdog.mjs';

export const MISSION_WORKER_DIAGNOSTIC_LINK_SCHEMA = 'stephanos.mission-worker-diagnostic-link.v1';
export const MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION = 'RUN_MISSION_WORKER_DIAGNOSTIC_LINK';
export const MISSION_WORKER_DIAGNOSTIC_LINK_DEADLINE_MS = 80_000;

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const INVOCATION_ID_PATTERN = /^[0-9a-f]{64}$/i;

function blocked(blocker, details = {}) {
  return Object.freeze({
    schemaVersion: MISSION_WORKER_DIAGNOSTIC_LINK_SCHEMA,
    ok: false,
    blocker,
    finalVerdict: 'MISSION_WORKER_DIAGNOSTIC_LINK_BLOCKED',
    bypassedWatchdogDecision: true,
    normalWatchdogPolicyModified: false,
    persistentBypassInstalled: false,
    arbitraryTaskNameAllowed: false,
    arbitraryExecutableAllowed: false,
    arbitraryPathAllowed: false,
    arbitraryArgumentsAllowed: false,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    pcRestartAllowed: false,
    sourceMutationAllowed: false,
    liveOpenClawUpdateAllowed: false,
    ...details,
  });
}

function successProofValid(data, expectedHead) {
  const pid = Number(data?.startedWorkerPid || 0);
  const workerStartedAtMs = Date.parse(String(data?.workerStartedAtUtc || ''));
  const deadlineMs = Date.parse(String(data?.deadlineUtc || ''));
  return data?.mode === 'StartApprovedWorkerTask'
    && data?.started === true
    && data?.restarted === true
    && String(data?.sourceHead || '').toLowerCase() === expectedHead
    && String(data?.remoteMainHead || '').toLowerCase() === expectedHead
    && data?.exactHeadProofOk === true
    && data?.sourceTrackedClean === true
    && data?.proofFresh === true
    && Number.isSafeInteger(pid)
    && pid > 0
    && Number.isFinite(workerStartedAtMs)
    && INVOCATION_ID_PATTERN.test(String(data?.invocationId || ''))
    && Number.isFinite(deadlineMs)
    && data?.invocationBound === true
    && data?.canonicalWorkerCommandVerified === true
    && data?.postStartSourceProofOk === true
    && data?.cleanupAttempted === false
    && data?.cleanupCompleted === false
    && data?.verifiedOwnedProcessTerminationOnly === true
    && String(data?.restartVerdict || '') === 'APPROVED_RUNTIME_RESTART_PASS'
    && data?.arbitraryTaskNameAllowed === false
    && data?.arbitraryProcessKillAllowed === false
    && data?.arbitraryPowerShellAllowed === false
    && data?.visiblePowerShellRequired === false;
}

export async function runMissionWorkerDiagnosticLink({ expectedHead } = {}, {
  readSourceIdentity,
  createProbeAdapter = createFixedWorkerProbeAdapter,
  resolvePaths = resolveCanonicalWorkerWatchdogPaths,
  validatePaths = validateCanonicalWorkerWatchdogPaths,
  now = () => new Date(),
} = {}) {
  const canonicalExpectedHead = String(expectedHead || '').trim().toLowerCase();
  if (!SHA_PATTERN.test(canonicalExpectedHead)) {
    return blocked('MISSION_WORKER_DIAGNOSTIC_LINK_EXPECTED_HEAD_REQUIRED');
  }
  if (typeof readSourceIdentity !== 'function') {
    return blocked('MISSION_WORKER_DIAGNOSTIC_LINK_SOURCE_IDENTITY_READER_REQUIRED', {
      expectedHead: canonicalExpectedHead,
    });
  }

  const identity = await readSourceIdentity({ expectedHead: canonicalExpectedHead });
  if (!identity?.ok) {
    return blocked(String(identity?.blocker || 'MISSION_WORKER_DIAGNOSTIC_LINK_SOURCE_IDENTITY_NOT_PROVEN'), {
      expectedHead: canonicalExpectedHead,
      sourceHead: String(identity?.sourceHead || '').toLowerCase(),
      branch: String(identity?.branch || ''),
    });
  }
  const sourceHead = String(identity?.sourceHead || '').toLowerCase();
  if (sourceHead !== canonicalExpectedHead || identity?.branch !== 'main' || identity?.expectedHeadMatch !== true) {
    return blocked('MISSION_WORKER_DIAGNOSTIC_LINK_SOURCE_IDENTITY_NOT_PROVEN', {
      expectedHead: canonicalExpectedHead,
      sourceHead,
      branch: String(identity?.branch || ''),
    });
  }

  const paths = resolvePaths();
  const expectedPaths = resolveCanonicalWorkerWatchdogPaths();
  const pathValidation = validatePaths({ paths, expectedPaths });
  if (!pathValidation?.ok) {
    return blocked('MISSION_WORKER_DIAGNOSTIC_LINK_CANONICAL_PATH_NOT_PROVEN', {
      expectedHead: canonicalExpectedHead,
      sourceHead,
    });
  }

  const startedAt = now();
  if (!(startedAt instanceof Date) || !Number.isFinite(startedAt.getTime())) {
    return blocked('MISSION_WORKER_DIAGNOSTIC_LINK_CLOCK_INVALID', {
      expectedHead: canonicalExpectedHead,
      sourceHead,
    });
  }
  const deadlineUtc = new Date(startedAt.getTime() + MISSION_WORKER_DIAGNOSTIC_LINK_DEADLINE_MS).toISOString();
  const adapter = createProbeAdapter({ probeScriptPath: paths.probeScriptPath });
  if (!adapter || typeof adapter.run !== 'function') {
    return blocked('MISSION_WORKER_DIAGNOSTIC_LINK_ADAPTER_NOT_AVAILABLE', {
      expectedHead: canonicalExpectedHead,
      sourceHead,
    });
  }

  const start = adapter.run('StartApprovedWorkerTask', {
    timeoutMs: WORKER_WATCHDOG_START_TIMEOUT_MS,
    deadlineUtc,
  });
  if (!start?.ok) {
    return blocked(String(start?.restartBlocker || 'MISSION_WORKER_DIAGNOSTIC_LINK_START_FAILED'), {
      expectedHead: canonicalExpectedHead,
      sourceHead,
      downstreamSectionReached: 'APPROVED_WORKER_START',
      typedRestartBlocker: String(start?.restartBlocker || ''),
    });
  }
  if (!successProofValid(start.data, canonicalExpectedHead)) {
    return blocked('MISSION_WORKER_DIAGNOSTIC_LINK_SUCCESS_PROOF_INVALID', {
      expectedHead: canonicalExpectedHead,
      sourceHead,
      downstreamSectionReached: 'APPROVED_WORKER_START',
    });
  }

  return Object.freeze({
    schemaVersion: MISSION_WORKER_DIAGNOSTIC_LINK_SCHEMA,
    ok: true,
    blocker: '',
    finalVerdict: 'MISSION_WORKER_DIAGNOSTIC_LINK_PASS',
    expectedHead: canonicalExpectedHead,
    sourceHead,
    branch: 'main',
    expectedHeadMatch: true,
    downstreamSectionReached: 'FRESH_EXACT_HEAD_WORKER_PROOF',
    startedWorkerPid: Number(start.data.startedWorkerPid),
    workerStartedAtUtc: String(start.data.workerStartedAtUtc),
    invocationId: String(start.data.invocationId),
    deadlineUtc: String(start.data.deadlineUtc),
    restartVerdict: String(start.data.restartVerdict),
    exactHeadProofOk: true,
    sourceTrackedClean: true,
    proofFresh: true,
    invocationBound: true,
    canonicalWorkerCommandVerified: true,
    postStartSourceProofOk: true,
    bypassedWatchdogDecision: true,
    normalWatchdogPolicyModified: false,
    persistentBypassInstalled: false,
    arbitraryTaskNameAllowed: false,
    arbitraryExecutableAllowed: false,
    arbitraryPathAllowed: false,
    arbitraryArgumentsAllowed: false,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    pcRestartAllowed: false,
    sourceMutationAllowed: false,
    liveOpenClawUpdateAllowed: false,
  });
}
