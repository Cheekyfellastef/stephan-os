export const WORKER_WATCHDOG_SCHEMA_VERSION = 'battle-bridge-worker-watchdog.v1';
export const APPROVED_WORKER_TASK = 'Stephanos Mission Orchestrator Worker';
export const CANONICAL_REPOSITORY_SUFFIX = '/Documents/GitHub/stephan-os';
export const DEFAULT_HEARTBEAT_MAX_AGE_MS = 120_000;

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const EXACT_ISSUE_OR_PR = /^(?:issue|pr):#[1-9][0-9]*$/i;
const SHA_40 = /^[0-9a-f]{40}$/i;
const ID_64 = /^[0-9a-f]{64}$/i;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const result = String(value).trim();
  return result || fallback;
}

function normalizePath(value) {
  return text(value).replace(/\\/g, '/').replace(/\/+$/, '');
}

function safeId(value, fallback) {
  const candidate = text(value, fallback);
  return SAFE_ID.test(candidate) ? candidate : fallback;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function isCanonicalIssueOrPrCorrelation(value) {
  return EXACT_ISSUE_OR_PR.test(text(value));
}

export function assessMissionOrchestratorWorker(input = {}) {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const heartbeatMaxAgeMs = Number.isFinite(input.heartbeatMaxAgeMs)
    ? input.heartbeatMaxAgeMs
    : DEFAULT_HEARTBEAT_MAX_AGE_MS;
  const observedTaskName = text(input.scheduledTask?.taskName);
  const observedTaskStatus = text(input.scheduledTask?.status, 'unknown').toLowerCase();
  const heartbeatTimestamp = Date.parse(text(input.heartbeat?.timestampUtc));
  const heartbeatAgeMs = Number.isFinite(heartbeatTimestamp) ? nowMs - heartbeatTimestamp : null;
  const repositoryRoot = normalizePath(input.heartbeat?.repositoryRoot);
  const heartbeatHead = text(input.heartbeat?.headSha).toLowerCase();
  const heartbeatLaunchIdentityId = text(input.heartbeat?.launchIdentityId).toLowerCase();
  const heartbeatWorkerStartedAtMs = Date.parse(text(input.heartbeat?.workerStartedAtUtc));
  const canonicalRepositoryRoot = normalizePath(input.repository?.repositoryRoot);
  const canonicalRepositoryBranch = text(input.repository?.branch).toLowerCase();
  const canonicalRepositoryHead = text(input.repository?.headSha).toLowerCase();
  const remoteMainHead = text(input.repository?.remoteMainHeadSha).toLowerCase();
  const canonicalRepositoryTrackedClean = input.repository?.trackedClean === true;
  const localRepositoryIdentityProven = canonicalRepositoryRoot.endsWith(CANONICAL_REPOSITORY_SUFFIX)
    && canonicalRepositoryBranch === 'main'
    && SHA_40.test(canonicalRepositoryHead)
    && canonicalRepositoryTrackedClean;
  const remoteMainHeadProven = SHA_40.test(remoteMainHead);
  const canonicalRepositoryHeadProven = localRepositoryIdentityProven
    && remoteMainHeadProven
    && canonicalRepositoryHead === remoteMainHead;
  const heartbeatTaskName = text(input.heartbeat?.taskName);
  const processPid = positiveInteger(input.process?.pid);
  const heartbeatPid = positiveInteger(input.heartbeat?.pid);
  const processStartedAtMs = Date.parse(text(input.process?.startedAtUtc));
  const processLaunchIdentityId = text(input.process?.launchIdentityId).toLowerCase();
  const processLaunchIdentityVerified = input.process?.launchIdentityVerified === true;
  const heartbeatLaunchIdentityValid = ID_64.test(heartbeatLaunchIdentityId);
  const processLaunchIdentityValid = ID_64.test(processLaunchIdentityId);
  const heartbeatLaunchIdentityMatchesProcess = heartbeatLaunchIdentityValid
    && processLaunchIdentityValid
    && heartbeatLaunchIdentityId === processLaunchIdentityId;
  const heartbeatProcessStartMatchesProcess = Number.isFinite(heartbeatWorkerStartedAtMs)
    && Number.isFinite(processStartedAtMs)
    && heartbeatWorkerStartedAtMs === processStartedAtMs;
  const heartbeatProcessStartPrecedesHeartbeat = Number.isFinite(heartbeatWorkerStartedAtMs)
    && Number.isFinite(heartbeatTimestamp)
    && heartbeatWorkerStartedAtMs < heartbeatTimestamp;
  const repositoryFromCanonicalMain = repositoryRoot.endsWith(CANONICAL_REPOSITORY_SUFFIX)
    && text(input.heartbeat?.branch).toLowerCase() === 'main'
    && SHA_40.test(heartbeatHead);
  const heartbeatMatchesCanonicalRepositoryHead = canonicalRepositoryHeadProven
    && repositoryFromCanonicalMain
    && heartbeatHead === canonicalRepositoryHead;
  const sourceHead = heartbeatMatchesCanonicalRepositoryHead ? canonicalRepositoryHead : '';
  const taskIdentityObserved = Boolean(observedTaskName);
  const taskApproved = taskIdentityObserved && observedTaskName === APPROVED_WORKER_TASK;
  const taskActionMatchesCanonicalWorker = input.scheduledTask?.actionMatchesCanonicalWorker === true;
  const taskStateHealthy = taskApproved
    && taskActionMatchesCanonicalWorker
    && ['ready', 'running'].includes(observedTaskStatus);
  const processCommandLineVerified = input.process?.commandLineMatchesCanonicalWorker === true;
  const processHealthy = input.process?.running === true
    && text(input.process?.taskName) === APPROVED_WORKER_TASK
    && processPid !== null
    && processCommandLineVerified
    && processLaunchIdentityVerified
    && processLaunchIdentityValid
    && Number.isFinite(processStartedAtMs);
  const heartbeatTaskApproved = heartbeatTaskName === APPROVED_WORKER_TASK;
  const heartbeatPidMatchesProcess = processPid !== null && heartbeatPid === processPid;
  const heartbeatFresh = heartbeatAgeMs !== null
    && heartbeatAgeMs >= 0
    && heartbeatAgeMs <= heartbeatMaxAgeMs;
  const heartbeatHealthy = heartbeatFresh
    && repositoryFromCanonicalMain
    && heartbeatMatchesCanonicalRepositoryHead
    && heartbeatTaskApproved
    && heartbeatPidMatchesProcess
    && heartbeatLaunchIdentityValid
    && heartbeatLaunchIdentityMatchesProcess
    && heartbeatProcessStartMatchesProcess
    && heartbeatProcessStartPrecedesHeartbeat
    && processLaunchIdentityVerified;
  const healthy = taskStateHealthy && processHealthy && heartbeatHealthy;
  const blockers = [];

  if (!taskIdentityObserved) blockers.push('scheduled-task-identity-missing');
  else if (!taskApproved) blockers.push('scheduled-task-not-allowlisted');
  if (taskApproved && !taskActionMatchesCanonicalWorker) blockers.push('scheduled-task-action-not-canonical');
  if (taskApproved && taskActionMatchesCanonicalWorker && !taskStateHealthy) {
    blockers.push('scheduled-task-not-ready-or-running');
  }
  if (!processHealthy) blockers.push('worker-process-proof-missing');
  if (input.process?.running === true && !processCommandLineVerified) blockers.push('worker-command-line-not-canonical');
  if (input.process?.running === true && !processLaunchIdentityVerified) blockers.push('worker-launch-identity-unproven');
  if (input.process?.running === true && !processLaunchIdentityValid) blockers.push('worker-process-launch-identity-invalid');
  if (input.process?.running === true && !Number.isFinite(processStartedAtMs)) blockers.push('worker-process-start-time-invalid');
  if (!Number.isFinite(heartbeatTimestamp)) blockers.push('worker-heartbeat-malformed');
  else if (!heartbeatFresh) blockers.push('worker-heartbeat-stale');
  if (!heartbeatLaunchIdentityValid) blockers.push('worker-heartbeat-launch-identity-invalid');
  if (!Number.isFinite(heartbeatWorkerStartedAtMs)) blockers.push('worker-heartbeat-process-start-time-invalid');
  else if (!heartbeatProcessStartPrecedesHeartbeat) blockers.push('worker-heartbeat-not-after-process-start');
  if (heartbeatLaunchIdentityValid && processLaunchIdentityValid && !heartbeatLaunchIdentityMatchesProcess) {
    blockers.push('worker-launch-identity-mismatch');
  }
  if (Number.isFinite(heartbeatWorkerStartedAtMs) && Number.isFinite(processStartedAtMs)
      && !heartbeatProcessStartMatchesProcess) {
    blockers.push('worker-process-start-mismatch');
  }
  if (!remoteMainHeadProven) blockers.push('remote-main-head-unproven');
  if (!canonicalRepositoryTrackedClean) blockers.push('canonical-repository-tracked-dirty');
  if (localRepositoryIdentityProven && remoteMainHeadProven && canonicalRepositoryHead !== remoteMainHead) {
    blockers.push('canonical-repository-head-stale');
  }
  if (!canonicalRepositoryHeadProven) blockers.push('canonical-repository-head-unproven');
  if (!repositoryFromCanonicalMain) blockers.push('worker-not-proven-from-canonical-main');
  else if (canonicalRepositoryHeadProven && !heartbeatMatchesCanonicalRepositoryHead) {
    blockers.push('worker-heartbeat-head-mismatch');
  }
  if (!heartbeatTaskApproved) blockers.push('worker-heartbeat-task-not-allowlisted');
  if (!heartbeatPidMatchesProcess) blockers.push('worker-heartbeat-pid-mismatch');

  return Object.freeze({
    schemaVersion: WORKER_WATCHDOG_SCHEMA_VERSION,
    kind: 'stephanos.battle_bridge.worker_watchdog.assessment',
    approvedTaskName: APPROVED_WORKER_TASK,
    observedTaskName,
    taskIdentityObserved,
    taskApproved,
    taskActionMatchesCanonicalWorker,
    taskStateHealthy,
    processHealthy,
    processCommandLineVerified,
    processLaunchIdentityVerified,
    processLaunchIdentityValid,
    processLaunchIdentityId: processLaunchIdentityValid ? processLaunchIdentityId : '',
    processStartedAtUtc: Number.isFinite(processStartedAtMs) ? new Date(processStartedAtMs).toISOString() : '',
    heartbeatFresh,
    heartbeatTaskApproved,
    heartbeatPidMatchesProcess,
    heartbeatLaunchIdentityValid,
    heartbeatLaunchIdentityMatchesProcess,
    heartbeatProcessStartMatchesProcess,
    heartbeatProcessStartPrecedesHeartbeat,
    heartbeatLaunchIdentityId: heartbeatLaunchIdentityValid ? heartbeatLaunchIdentityId : '',
    heartbeatWorkerStartedAtUtc: Number.isFinite(heartbeatWorkerStartedAtMs)
      ? new Date(heartbeatWorkerStartedAtMs).toISOString()
      : '',
    repositoryFromCanonicalMain,
    canonicalRepositoryHead,
    canonicalRepositoryTrackedClean,
    remoteMainHead,
    remoteMainHeadProven,
    canonicalRepositoryHeadProven,
    heartbeatMatchesCanonicalRepositoryHead,
    sourceHead,
    heartbeatAgeMs,
    healthy,
    restartPermitted: !healthy
      && taskApproved
      && taskActionMatchesCanonicalWorker
      && canonicalRepositoryHeadProven,
    blockers,
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    arbitraryTaskNameAllowed: false,
    processKillAllowed: false,
    pcRestartAllowed: false,
    sourceMutationAllowed: false,
    visiblePowerShellRequired: false,
    finalVerdict: healthy ? 'WORKER_WATCHDOG_HEALTHY' : 'WORKER_WATCHDOG_RECOVERY_REQUIRED',
  });
}

export function buildWorkerWatchdogRecoveryDecision(input = {}) {
  const assessment = assessMissionOrchestratorWorker(input);
  const correlationId = safeId(input.correlationId, 'worker-watchdog-1291');
  const related = text(input.related, 'issue:#1291');
  const relatedValid = isCanonicalIssueOrPrCorrelation(related);
  const restartAuthorized = assessment.restartPermitted && relatedValid;
  const blockers = [...assessment.blockers];
  if (!relatedValid) blockers.push('invalid-issue-or-pr-correlation');

  return Object.freeze({
    schemaVersion: WORKER_WATCHDOG_SCHEMA_VERSION,
    kind: 'stephanos.battle_bridge.worker_watchdog.recovery_decision',
    correlationId,
    related: relatedValid ? related.toLowerCase() : '',
    assessment,
    action: assessment.healthy
      ? 'NO_OP'
      : restartAuthorized
        ? 'START_APPROVED_WORKER_TASK'
        : 'BLOCKED',
    restartTaskName: restartAuthorized ? APPROVED_WORKER_TASK : '',
    boundedProbeAttempts: 3,
    boundedProbeIntervalMs: 5_000,
    blockers,
    finalVerdict: assessment.healthy
      ? 'WORKER_WATCHDOG_NO_OP'
      : restartAuthorized
        ? 'WORKER_WATCHDOG_RESTART_AUTHORIZED'
        : 'WORKER_WATCHDOG_BLOCKED',
  });
}
