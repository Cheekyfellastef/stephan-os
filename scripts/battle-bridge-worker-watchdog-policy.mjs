export const WORKER_WATCHDOG_SCHEMA_VERSION = 'battle-bridge-worker-watchdog.v1';
export const APPROVED_WORKER_TASK = 'Stephanos Mission Orchestrator Worker';
export const CANONICAL_REPOSITORY_SUFFIX = '/Documents/GitHub/stephan-os';
export const DEFAULT_HEARTBEAT_MAX_AGE_MS = 120_000;

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const EXACT_ISSUE_OR_PR = /^(?:issue|pr):#[1-9][0-9]*$/i;
const SHA_40 = /^[0-9a-f]{40}$/i;

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
  const heartbeatTaskName = text(input.heartbeat?.taskName);
  const processPid = positiveInteger(input.process?.pid);
  const heartbeatPid = positiveInteger(input.heartbeat?.pid);
  const repositoryFromCanonicalMain = repositoryRoot.endsWith(CANONICAL_REPOSITORY_SUFFIX)
    && text(input.heartbeat?.branch).toLowerCase() === 'main'
    && SHA_40.test(text(input.heartbeat?.headSha));
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
    && processCommandLineVerified;
  const heartbeatTaskApproved = heartbeatTaskName === APPROVED_WORKER_TASK;
  const heartbeatPidMatchesProcess = processPid !== null && heartbeatPid === processPid;
  const heartbeatFresh = heartbeatAgeMs !== null
    && heartbeatAgeMs >= 0
    && heartbeatAgeMs <= heartbeatMaxAgeMs;
  const heartbeatHealthy = heartbeatFresh
    && repositoryFromCanonicalMain
    && heartbeatTaskApproved
    && heartbeatPidMatchesProcess;
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
  if (!Number.isFinite(heartbeatTimestamp)) blockers.push('worker-heartbeat-malformed');
  else if (!heartbeatFresh) blockers.push('worker-heartbeat-stale');
  if (!repositoryFromCanonicalMain) blockers.push('worker-not-proven-from-canonical-main');
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
    heartbeatFresh,
    heartbeatTaskApproved,
    heartbeatPidMatchesProcess,
    repositoryFromCanonicalMain,
    heartbeatAgeMs,
    healthy,
    restartPermitted: !healthy && taskApproved && taskActionMatchesCanonicalWorker,
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
