import {
  WORKER_WATCHDOG_INITIAL_PROBE_TIMEOUT_MS,
  WORKER_WATCHDOG_START_TIMEOUT_MS,
  createFixedWorkerProbeAdapter,
  resolveCanonicalWorkerWatchdogPaths,
  validateCanonicalWorkerWatchdogPaths,
} from './battle-bridge-worker-watchdog.mjs';

export const MISSION_WORKER_DIAGNOSTIC_LINK_SCHEMA = 'stephanos.mission-worker-diagnostic-link.v1';
export const MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION = 'RUN_MISSION_WORKER_DIAGNOSTIC_LINK';
export const MISSION_WORKER_DIAGNOSTIC_LINK_TERMINAL_PUBLICATION_RESERVE_MS = 10_000;
export const MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS = WORKER_WATCHDOG_START_TIMEOUT_MS;
export const MISSION_WORKER_DIAGNOSTIC_LINK_DEADLINE_MS =
  MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS + MISSION_WORKER_DIAGNOSTIC_LINK_TERMINAL_PUBLICATION_RESERVE_MS;

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const INVOCATION_ID_PATTERN = /^[0-9a-f]{64}$/i;
const BOUNDED_APPROVED_RUNTIME_START_BLOCKERS = new Set([
  'USERPROFILE_REQUIRED',
  'NON_CANONICAL_REPOSITORY_PATH',
  'CANONICAL_GIT_MISSING',
  'CANONICAL_GIT_IDENTITY_INVALID',
  'CANONICAL_GIT_PATH_MISMATCH',
  'CANONICAL_NODE_MISSING',
  'CANONICAL_NODE_IDENTITY_INVALID',
  'CANONICAL_NODE_PATH_MISMATCH',
  'CANONICAL_MAIN_REQUIRED',
  'CANONICAL_TRACKED_SOURCE_DIRTY',
  'CANONICAL_PUBLIC_MAIN_READ_FAILED',
  'CANONICAL_PUBLIC_MAIN_RESPONSE_INVALID',
  'CANONICAL_EXACT_MAIN_NOT_PROVEN',
  'EXPECTED_HEAD_MISMATCH',
  'EXPECTED_HEAD_NOT_PUBLIC_MAIN',
  'APPROVED_TASK_MISSING',
  'APPROVED_TASK_DISABLED',
  'APPROVED_TASK_ACTION_COUNT_INVALID',
  'APPROVED_TASK_EXECUTABLE_MISMATCH',
  'APPROVED_TASK_ARGUMENTS_MISMATCH',
  'APPROVED_TASK_ACTION_INVALID',
  'APPROVED_RUNTIME_RESTART_ADAPTER_MISSING',
  'APPROVED_RUNTIME_RESTART_ADAPTER_FAILED',
  'APPROVED_RUNTIME_RESTART_RECEIPT_INVALID',
  'MISSION_WORKER_RESTART_DEADLINE_INVALID',
]);

const BOUNDED_APPROVED_RUNTIME_START_PHRASES = new Map([
  ['USERPROFILE is required to resolve canonical worker watchdog paths.', 'USERPROFILE_REQUIRED'],
  ['Canonical repository branch/head proof is invalid.', 'CANONICAL_MAIN_REQUIRED'],
  ['Canonical repository tracked source is dirty.', 'CANONICAL_TRACKED_SOURCE_DIRTY'],
  ['The public main reference did not resolve to exactly one commit.', 'CANONICAL_PUBLIC_MAIN_RESPONSE_INVALID'],
  ['The public main reference response is malformed.', 'CANONICAL_PUBLIC_MAIN_RESPONSE_INVALID'],
  ['The worker restart deadline is missing or malformed.', 'MISSION_WORKER_RESTART_DEADLINE_INVALID'],
  ['The worker restart deadline is outside the bounded watchdog window.', 'MISSION_WORKER_RESTART_DEADLINE_INVALID'],
  ['The fixed Mission Orchestrator worker task is not installed.', 'APPROVED_TASK_MISSING'],
  ['The fixed Mission Orchestrator worker task action is not canonical.', 'APPROVED_TASK_ACTION_INVALID'],
  ['The canonical repository head is not proven as exact current public main for fixed worker restart.', 'CANONICAL_EXACT_MAIN_NOT_PROVEN'],
  ['The approved runtime restart adapter is missing.', 'APPROVED_RUNTIME_RESTART_ADAPTER_MISSING'],
  ['The approved runtime restart adapter failed.', 'APPROVED_RUNTIME_RESTART_ADAPTER_FAILED'],
  ['The approved runtime restart receipt is invalid.', 'APPROVED_RUNTIME_RESTART_RECEIPT_INVALID'],
]);

function extractBoundedApprovedRuntimeStartBlocker(...values) {
  const candidates = new Set();
  for (const value of values) {
    const body = String(value ?? '').slice(0, 16 * 1024);
    for (const match of body.matchAll(/\b[A-Z][A-Z0-9_]{2,119}\b/g)) {
      if (BOUNDED_APPROVED_RUNTIME_START_BLOCKERS.has(match[0])) candidates.add(match[0]);
    }
    for (const line of body.split(/\r?\n/)) {
      const mapped = BOUNDED_APPROVED_RUNTIME_START_PHRASES.get(line.trim());
      if (mapped && BOUNDED_APPROVED_RUNTIME_START_BLOCKERS.has(mapped)) candidates.add(mapped);
    }
  }
  return candidates.size === 1 ? [...candidates][0] : '';
}

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

function sourceIdentityFromInspect(inspect, expectedHead) {
  if (!inspect?.ok) {
    return Object.freeze({ ok: false, blocker: 'MISSION_WORKER_DIAGNOSTIC_LINK_SOURCE_INSPECT_FAILED' });
  }
  const repository = inspect?.data?.repository || {};
  const sourceHead = String(repository?.headSha || '').trim().toLowerCase();
  const remoteMainHead = String(repository?.remoteMainHeadSha || '').trim().toLowerCase();
  const branch = String(repository?.branch || '');
  const exact = branch === 'main'
    && sourceHead === expectedHead
    && remoteMainHead === expectedHead
    && repository?.trackedClean === true
    && repository?.headMatchesRemoteMain === true
    && repository?.headProven === true;
  return Object.freeze({
    ok: exact,
    blocker: exact ? '' : 'MISSION_WORKER_DIAGNOSTIC_LINK_SOURCE_IDENTITY_NOT_PROVEN',
    sourceHead,
    remoteMainHead,
    branch,
    expectedHeadMatch: exact,
    sourceTrackedClean: repository?.trackedClean === true,
    headMatchesRemoteMain: repository?.headMatchesRemoteMain === true,
  });
}

function successProofValid(data, expectedHead, expectedDeadlineUtc) {
  const pid = Number(data?.startedWorkerPid || 0);
  const workerStartedAtMs = Date.parse(String(data?.workerStartedAtUtc || ''));
  const deadlineUtc = String(data?.deadlineUtc || '');
  const deadlineMs = Date.parse(deadlineUtc);
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
    && deadlineUtc === expectedDeadlineUtc
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

  if (!(MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS > 0
    && MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS < MISSION_WORKER_DIAGNOSTIC_LINK_DEADLINE_MS)) {
    return blocked('MISSION_WORKER_DIAGNOSTIC_LINK_TIMEOUT_BUDGET_INVALID', {
      expectedHead: canonicalExpectedHead,
    });
  }

  const paths = resolvePaths();
  const expectedPaths = resolveCanonicalWorkerWatchdogPaths();
  const pathValidation = validatePaths({ paths, expectedPaths });
  if (!pathValidation?.ok) {
    return blocked('MISSION_WORKER_DIAGNOSTIC_LINK_CANONICAL_PATH_NOT_PROVEN', {
      expectedHead: canonicalExpectedHead,
    });
  }
  const adapter = createProbeAdapter({ probeScriptPath: paths.probeScriptPath });
  if (!adapter || typeof adapter.run !== 'function') {
    return blocked('MISSION_WORKER_DIAGNOSTIC_LINK_ADAPTER_NOT_AVAILABLE', {
      expectedHead: canonicalExpectedHead,
    });
  }

  const identity = typeof readSourceIdentity === 'function'
    ? await readSourceIdentity({ expectedHead: canonicalExpectedHead })
    : sourceIdentityFromInspect(
      adapter.run('Inspect', { timeoutMs: WORKER_WATCHDOG_INITIAL_PROBE_TIMEOUT_MS }),
      canonicalExpectedHead,
    );
  if (!identity?.ok) {
    return blocked(String(identity?.blocker || 'MISSION_WORKER_DIAGNOSTIC_LINK_SOURCE_IDENTITY_NOT_PROVEN'), {
      expectedHead: canonicalExpectedHead,
      sourceHead: String(identity?.sourceHead || '').toLowerCase(),
      remoteMainHead: String(identity?.remoteMainHead || '').toLowerCase(),
      branch: String(identity?.branch || ''),
    });
  }
  const sourceHead = String(identity?.sourceHead || '').toLowerCase();
  const identityExact = sourceHead === canonicalExpectedHead
    && identity?.branch === 'main'
    && identity?.expectedHeadMatch === true;
  if (!identityExact) {
    return blocked('MISSION_WORKER_DIAGNOSTIC_LINK_SOURCE_IDENTITY_NOT_PROVEN', {
      expectedHead: canonicalExpectedHead,
      sourceHead,
      remoteMainHead: String(identity?.remoteMainHead || '').toLowerCase(),
      branch: String(identity?.branch || ''),
    });
  }

  const startedAt = now();
  if (!(startedAt instanceof Date) || !Number.isFinite(startedAt.getTime())) {
    return blocked('MISSION_WORKER_DIAGNOSTIC_LINK_CLOCK_INVALID', {
      expectedHead: canonicalExpectedHead,
      sourceHead,
    });
  }
  const childDeadlineUtc = new Date(
    startedAt.getTime() + MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS,
  ).toISOString();
  const diagnosticDeadlineUtc = new Date(
    startedAt.getTime() + MISSION_WORKER_DIAGNOSTIC_LINK_DEADLINE_MS,
  ).toISOString();
  const start = adapter.run('StartApprovedWorkerTask', {
    timeoutMs: MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS,
    deadlineUtc: childDeadlineUtc,
  });
  if (!start?.ok) {
    const typedRestartBlocker = String(start?.restartBlocker || extractBoundedApprovedRuntimeStartBlocker(
      start?.error,
      start?.stderr,
      start?.stdout,
    ));
    return blocked(typedRestartBlocker || 'MISSION_WORKER_DIAGNOSTIC_LINK_START_FAILED', {
      expectedHead: canonicalExpectedHead,
      sourceHead,
      downstreamSectionReached: 'APPROVED_WORKER_START',
      typedRestartBlocker,
      childDeadlineUtc,
      diagnosticDeadlineUtc,
      diagnosticDeadlineMs: MISSION_WORKER_DIAGNOSTIC_LINK_DEADLINE_MS,
      childTimeoutMs: MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS,
      terminalPublicationReserveMs: MISSION_WORKER_DIAGNOSTIC_LINK_TERMINAL_PUBLICATION_RESERVE_MS,
    });
  }
  if (!successProofValid(start.data, canonicalExpectedHead, childDeadlineUtc)) {
    return blocked('MISSION_WORKER_DIAGNOSTIC_LINK_SUCCESS_PROOF_INVALID', {
      expectedHead: canonicalExpectedHead,
      sourceHead,
      downstreamSectionReached: 'APPROVED_WORKER_START',
      childDeadlineUtc,
      diagnosticDeadlineUtc,
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
    childDeadlineUtc,
    diagnosticDeadlineUtc,
    restartVerdict: String(start.data.restartVerdict),
    diagnosticDeadlineMs: MISSION_WORKER_DIAGNOSTIC_LINK_DEADLINE_MS,
    childTimeoutMs: MISSION_WORKER_DIAGNOSTIC_LINK_CHILD_TIMEOUT_MS,
    terminalPublicationReserveMs: MISSION_WORKER_DIAGNOSTIC_LINK_TERMINAL_PUBLICATION_RESERVE_MS,
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
