#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { updateStephanosFromChat } from '../shared/agents/stephanosChatUpdate.mjs';
import { runBattleBridgeDiagnostics } from '../shared/agents/codexDispatchHostOps.mjs';
import { createSanitizedSharedWorkspaceProjection } from '../shared/agents/chatGptParticipantBridgeV1.mjs';
import {
  DEFAULT_STALE_AFTER_MS,
  validateSharedWorkspaceRecord,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  buildStephanosCapabilityRegistrySummary,
  validateStephanosCapabilityRegistry,
} from '../shared/agents/stephanosCapabilityRegistry.mjs';
import { runBattleBridgeWorkerWatchdogAcceptance } from './battle-bridge-worker-watchdog-acceptance.mjs';
import { runBattleBridgeMonitorMultiplexerCanary } from './battle-bridge-monitor-multiplexer-canary.mjs';
import {
  BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
  BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
  buildBattleBridgeGitHubCommandReceipt,
  executeBattleBridgeGitHubCommand,
  selectNextBattleBridgeGitHubCommand,
} from '../shared/agents/battleBridgeGitHubCommandMailbox.mjs';
import { dispatchExactHeadWindowsBrowserProof } from '../shared/agents/exactHeadWindowsBrowserProofDispatch.mjs';
import {
  createWindowsSafeMailboxReceiptFilename,
  getReadableMailboxReceiptFilenames,
} from '../shared/agents/windowsSafeMailboxReceiptFilename.mjs';

export { createWindowsSafeMailboxReceiptFilename } from '../shared/agents/windowsSafeMailboxReceiptFilename.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const expectedRepoRoot = resolve(process.env.USERPROFILE || homedir(), 'Documents', 'GitHub', 'stephan-os');
const mailboxWorkspaceRoot = resolve(process.env.STEPHANOS_SHARED_WORKSPACE_ROOT || join(homedir(), 'Documents', 'Stephanos', 'shared-agent-workspace'));
const sharedWorkspaceRoot = resolve(process.env.STEPHANOS_SHARED_AGENT_WORKSPACE || join(homedir(), 'Documents', 'Stephanos-openclaw-workspace'));
const mailboxStateRoot = join(mailboxWorkspaceRoot, 'github-command-mailbox');
const canonicalReceiptRoot = join(sharedWorkspaceRoot, 'receipts', 'github-command-mailbox');
const criticalBacklogStatusPath = join(sharedWorkspaceRoot, 'status', 'critical-backlog-conveyor-current.json');
const statePath = join(mailboxStateRoot, 'state.json');
const MAX_GITHUB_JSON_BYTES = 2 * 1024 * 1024;
const MAX_GITHUB_RECEIPT_JSON_BYTES = 9 * 1024;
const MAX_LOCAL_RECEIPT_BYTES = 256 * 1024;
const MAX_CRITICAL_BACKLOG_STATUS_BYTES = 64 * 1024;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const SAFE_PROOF_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const SAFE_CONVEYOR_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const EXACT_GIT_HEAD_PATTERN = /^[0-9a-f]{40}$/i;
const UNSAFE_TELEMETRY_PATTERN = /(?:secret|token|session|password|credential|private[_-]?key|api[_-]?key|cookie|authorization\s*[:=]|bearer\s+|\.env\b|BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY|(?:^|[\s=:(\[])(?:~?\/|[A-Za-z]:[\\/]|\\\\)|(?:^|[\s=:(\[])\.\.(?:[\\/]|$)|\b(?:sk(?:-proj)?|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,})/i;
const SAFE_CONVEYOR_DECISIONS = new Set([
  'CREATE_NEXT_MISSION',
  'WAIT_ACTIVE_MISSION',
  'WAIT_EXTERNAL_ACTIVE_MISSION',
  'BLOCKED_BY_TERMINAL_MISSION',
  'BLOCKED_BY_MULTIPLE_ACTIVE_MISSIONS',
  'BLOCKED_BY_INVALID_BACKLOG',
  'BACKLOG_COMPLETE',
]);

function bounded(value, limit = 12000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 900000,
    maxBuffer: options.maxBuffer || MAX_GITHUB_JSON_BYTES,
  });
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  return {
    ok: !result.error && result.status === 0,
    status: result.status ?? null,
    stdout: options.preserveStdout ? stdout : bounded(stdout),
    stderr: bounded(stderr),
    error: result.error?.message || '',
  };
}

export function parseBoundedGitHubJson(stdout, maxBytes = MAX_GITHUB_JSON_BYTES) {
  const text = String(stdout || '');
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > maxBytes) {
    throw new Error(`GITHUB_RESPONSE_TOO_LARGE:${byteLength}:${maxBytes}`);
  }
  try {
    return JSON.parse(text || 'null');
  } catch (error) {
    throw new Error(`GITHUB_RESPONSE_JSON_INVALID:${error?.message || String(error)}`);
  }
}

function safeProofRefs(value) {
  return Array.isArray(value)
    ? value.map(String).filter((ref) => SAFE_PROOF_REF_PATTERN.test(ref) && !ref.includes('..')).slice(0, 20)
    : [];
}

function safeConveyorId(value) {
  const normalized = String(value || '').trim();
  return SAFE_CONVEYOR_ID_PATTERN.test(normalized) ? normalized : '';
}

function safeConveyorIds(value) {
  return Array.isArray(value) ? [...new Set(value.map(safeConveyorId).filter(Boolean))].slice(0, 20) : [];
}

function safeConveyorDecision(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return SAFE_CONVEYOR_DECISIONS.has(normalized) ? normalized : '';
}

function safeConveyorAction(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 500 || /[\\/]|[A-Za-z]:|\.\./.test(normalized)) return '';
  return normalized;
}

function safeTimestamp(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function safeNonNegativeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function safeTelemetryText(value, limit = 500) {
  const normalized = String(value ?? '').trim();
  if (UNSAFE_TELEMETRY_PATTERN.test(normalized)) return '';
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function safeTelemetryId(value) {
  const normalized = safeTelemetryText(value, 160);
  return /^[A-Za-z0-9][A-Za-z0-9._:#-]{1,159}$/.test(normalized) ? normalized : '';
}

function safeTelemetrySha(value) {
  const normalized = safeTelemetryText(value, 40).toLowerCase();
  return EXACT_GIT_HEAD_PATTERN.test(normalized) ? normalized : '';
}

function safeTelemetryBranch(value) {
  const normalized = safeTelemetryText(value, 240);
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/.test(normalized) && !normalized.includes('..')
    ? normalized
    : '';
}

function telemetryPosture(value = {}) {
  return Object.freeze({
    state: safeTelemetryText(value?.state || value?.status || 'UNKNOWN', 80).toUpperCase(),
    allGreen: value?.allGreen === true,
    mergeable: typeof value?.mergeable === 'boolean' ? value.mergeable : null,
    summary: safeTelemetryText(value?.summary, 300),
    proofRefs: safeProofRefs(value?.proofRefs),
  });
}

function telemetryReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.freeze({
    repository: safeTelemetryText(value.repository, 160),
    issueNumber: safeNonNegativeNumber(value.issueNumber),
    prNumber: safeNonNegativeNumber(value.prNumber),
    branch: safeTelemetryBranch(value.branch),
    sourceHead: safeTelemetrySha(value.sourceHead),
    workerId: safeTelemetryId(value.workerId),
    workerType: safeTelemetryId(value.workerType),
    executionId: safeTelemetryId(value.executionId),
    leaseKey: safeTelemetryId(value.leaseKey),
    state: safeTelemetryText(value.state, 80).toUpperCase(),
    phase: safeTelemetryText(value.phase, 120).toUpperCase(),
    sequence: safeNonNegativeNumber(value.sequence),
    timestampUtc: safeTimestamp(value.timestampUtc),
    heartbeatExpiresAtUtc: safeTimestamp(value.heartbeatExpiresAtUtc),
    blocker: safeTelemetryText(value.blocker, 200),
    operatorActionRequired: value.operatorActionRequired === true,
    expectedNextAction: safeTelemetryText(value.expectedNextAction, 500),
    proofRefs: safeProofRefs(value.proofRefs),
  });
}

function projectWorkerTelemetry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const worker = value.worker || {};
  const task = value.task || {};
  const heartbeat = value.heartbeat || {};
  const lease = value.lease || {};
  const posture = value.testsChecksReview || {};
  return Object.freeze({
    schemaVersion: safeTelemetryText(value.schemaVersion, 120),
    ok: value.ok === true,
    workerActive: value.workerActive === true,
    workerAlive: typeof value.workerAlive === 'boolean' ? value.workerAlive : null,
    workerStatus: safeTelemetryText(value.workerStatus, 80).toUpperCase(),
    worker: Object.freeze({
      pid: safeNonNegativeNumber(worker.pid),
      observedPid: safeNonNegativeNumber(worker.observedPid),
      commandIdentity: safeTelemetryText(worker.commandIdentity, 240),
      commandLineVerified: worker.commandLineVerified === true,
      taskName: safeTelemetryText(worker.taskName, 160),
      scheduledTaskState: safeTelemetryText(worker.scheduledTaskState, 80).toUpperCase(),
    }),
    task: Object.freeze({
      taskId: safeTelemetryId(task.taskId),
      goalId: safeTelemetryText(task.goalId, 160),
      issueNumber: safeNonNegativeNumber(task.issueNumber),
      prNumber: safeNonNegativeNumber(task.prNumber),
      branch: safeTelemetryBranch(task.branch),
      headSha: safeTelemetrySha(task.headSha),
      phase: safeTelemetryText(task.phase, 120).toUpperCase(),
      boundedAction: safeTelemetryText(task.boundedAction, 500),
    }),
    heartbeat: Object.freeze({
      timestampUtc: safeTimestamp(heartbeat.timestampUtc),
      ageMs: heartbeat.ageMs === null ? null : safeNonNegativeNumber(heartbeat.ageMs),
      fresh: heartbeat.fresh === true,
      headSha: safeTelemetrySha(heartbeat.headSha),
      branch: safeTelemetryBranch(heartbeat.branch),
      tickVerdict: safeTelemetryText(heartbeat.tickVerdict, 120),
      errors: Array.isArray(heartbeat.errors)
        ? heartbeat.errors.map((item) => safeTelemetryText(item, 160)).filter(Boolean).slice(0, 20)
        : [],
    }),
    lease: Object.freeze({
      observed: lease.observed === true,
      valid: lease.valid === true,
      active: lease.active === true,
      leaseId: safeTelemetryId(lease.leaseId),
      laneId: safeTelemetryId(lease.laneId),
      ownerId: safeTelemetryId(lease.ownerId),
      repository: safeTelemetryText(lease.repository, 160),
      issueNumber: safeNonNegativeNumber(lease.issueNumber),
      prNumber: safeNonNegativeNumber(lease.prNumber),
      branch: safeTelemetryBranch(lease.branch),
      headSha: safeTelemetrySha(lease.headSha),
      acquiredAtUtc: safeTimestamp(lease.acquiredAtUtc),
      renewedAtUtc: safeTimestamp(lease.renewedAtUtc),
      expiresAtUtc: safeTimestamp(lease.expiresAtUtc),
      errors: Array.isArray(lease.errors)
        ? lease.errors.map((item) => safeTelemetryText(item, 160)).filter(Boolean).slice(0, 20)
        : [],
    }),
    latestExecutionReceipt: telemetryReceipt(value.latestExecutionReceipt),
    testsChecksReview: Object.freeze({
      tests: telemetryPosture(posture.tests),
      checks: telemetryPosture(posture.checks),
      review: telemetryPosture(posture.review),
    }),
    blockers: Array.isArray(value.blockers)
      ? value.blockers.map((item) => safeTelemetryText(item, 200)).filter(Boolean).slice(0, 30)
      : [],
    operatorActionRequired: value.operatorActionRequired === true,
    nextAction: safeTelemetryText(value.nextAction, 600),
    evidenceRefs: Object.freeze([
      'status/mission-orchestrator-worker-heartbeat.json',
      'status/source-mutation-lease-current.json',
      'status/battle-bridge-mailbox-receipt-index.json',
    ]),
    finalVerdict: safeTelemetryText(value.finalVerdict, 120).toUpperCase(),
  });
}

function isExactWindowsProofOperation(receipt = {}, operationResult = {}) {
  return receipt?.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF'
    || operationResult?.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF';
}

function projectedExpectedHeadMatch(receipt = {}, operationResult = {}) {
  const expectedHead = String(receipt?.expectedHead || operationResult?.expectedHead || '').trim().toLowerCase();
  if (isExactWindowsProofOperation(receipt, operationResult)) {
    const pullRequestHead = String(operationResult?.pullRequestHead || '').trim().toLowerCase();
    const localHead = String(operationResult?.localHead || '').trim().toLowerCase();
    const proofTarget = String(receipt?.proofTarget || operationResult?.proofTarget || 'PULL_REQUEST_HEAD');
    const mergeCommitHead = String(operationResult?.mergeCommitHead || '').trim().toLowerCase();
    if (proofTarget === 'MERGED_MAIN') {
      return EXACT_GIT_HEAD_PATTERN.test(expectedHead)
        && EXACT_GIT_HEAD_PATTERN.test(pullRequestHead)
        && EXACT_GIT_HEAD_PATTERN.test(mergeCommitHead)
        && EXACT_GIT_HEAD_PATTERN.test(localHead)
        && expectedHead === mergeCommitHead
        && expectedHead === localHead;
    }
    return EXACT_GIT_HEAD_PATTERN.test(expectedHead)
      && EXACT_GIT_HEAD_PATTERN.test(pullRequestHead)
      && EXACT_GIT_HEAD_PATTERN.test(localHead)
      && expectedHead === pullRequestHead
      && expectedHead === localHead;
  }
  if (typeof operationResult?.expectedHeadMatch === 'boolean') {
    return operationResult.expectedHeadMatch;
  }
  const sourceHead = String(operationResult?.sourceHead || '').trim().toLowerCase();
  return EXACT_GIT_HEAD_PATTERN.test(expectedHead)
    && EXACT_GIT_HEAD_PATTERN.test(sourceHead)
    && expectedHead === sourceHead;
}

function conveyorProjection(operationResult = {}) {
  return Object.freeze({
    decision: safeConveyorDecision(operationResult?.decision),
    selectedItemId: safeConveyorId(operationResult?.selectedItemId),
    activeMissionId: safeConveyorId(operationResult?.activeMissionId),
    activePhase: safeConveyorId(operationResult?.activePhase),
    completedItemIds: safeConveyorIds(operationResult?.completedItemIds),
    remainingItemIds: safeConveyorIds(operationResult?.remainingItemIds),
    exactNextAction: safeConveyorAction(operationResult?.exactNextAction),
    statusTimestampUtc: safeTimestamp(operationResult?.statusTimestampUtc),
    statusAgeMs: safeNonNegativeNumber(operationResult?.statusAgeMs),
    staleAfterMs: safeNonNegativeNumber(operationResult?.staleAfterMs),
    oneActiveMissionEnforced: operationResult?.oneActiveMissionEnforced === true,
    duplicateCodexDispatchAllowed: operationResult?.duplicateCodexDispatchAllowed === true,
    mergeAuthority: operationResult?.mergeAuthority === true,
    exactHeadApprovalRequired: operationResult?.exactHeadApprovalRequired === true,
  });
}

export function createSanitizedMailboxReceiptProjection(receipt = {}) {
  const execution = receipt?.result || {};
  const operationResult = execution?.result || {};
  const workerTelemetry = projectWorkerTelemetry(operationResult?.workerTelemetry);
  return Object.freeze({
    schemaVersion: safeTelemetryText(receipt?.schemaVersion, 120),
    requestId: safeTelemetryText(receipt?.requestId, 160),
    operation: safeTelemetryText(receipt?.operation, 120),
    state: safeTelemetryText(receipt?.state, 80).toUpperCase(),
    acceptedAt: safeTelemetryText(receipt?.acceptedAt, 80),
    heartbeatAt: safeTelemetryText(receipt?.heartbeatAt, 80),
    completedAt: safeTelemetryText(receipt?.completedAt, 80),
    expectedHead: safeTelemetrySha(receipt?.expectedHead || operationResult?.expectedHead),
    prNumber: safeNonNegativeNumber(receipt?.prNumber || operationResult?.prNumber),
    proofScenario: safeTelemetryText(receipt?.proofScenario || operationResult?.proofScenario, 160),
    proofTarget: safeTelemetryText(receipt?.proofTarget || operationResult?.proofTarget, 80),
    taskId: safeTelemetryId(receipt?.taskId || operationResult?.taskId),
    pullRequestHead: safeTelemetrySha(operationResult?.pullRequestHead),
    mergeCommitHead: safeTelemetrySha(operationResult?.mergeCommitHead),
    localHead: safeTelemetrySha(operationResult?.localHead),
    blocker: safeTelemetryText(receipt?.blocker || operationResult?.blocker, 240),
    proofRefs: safeProofRefs(receipt?.proofRefs),
    execution: Object.freeze({
      ok: execution?.ok !== false,
      verdict: safeTelemetryText(execution?.verdict, 120).toUpperCase(),
      operation: safeTelemetryText(execution?.operation || receipt?.operation, 120),
      requestId: safeTelemetryText(execution?.requestId || receipt?.requestId, 160),
    }),
    workerTelemetry,
    operationResult: Object.freeze({
      ok: operationResult?.ok !== false,
      blocker: safeTelemetryText(operationResult?.blocker, 240),
      finalVerdict: safeTelemetryText(operationResult?.finalVerdict, 160).toUpperCase(),
      expectedHead: safeTelemetrySha(receipt?.expectedHead || operationResult?.expectedHead),
      prNumber: safeNonNegativeNumber(receipt?.prNumber || operationResult?.prNumber),
      proofScenario: safeTelemetryText(receipt?.proofScenario || operationResult?.proofScenario, 160),
      proofTarget: safeTelemetryText(receipt?.proofTarget || operationResult?.proofTarget, 80),
      taskId: safeTelemetryId(receipt?.taskId || operationResult?.taskId),
      pullRequestHead: safeTelemetrySha(operationResult?.pullRequestHead),
      mergeCommitHead: safeTelemetrySha(operationResult?.mergeCommitHead),
      localHead: safeTelemetrySha(operationResult?.localHead),
      sourceHead: safeTelemetrySha(operationResult?.sourceHead),
      branch: safeTelemetryBranch(operationResult?.branch),
      expectedHeadMatch: projectedExpectedHeadMatch(receipt, operationResult),
      monitorCount: Number(operationResult?.monitorCount || 0),
      executedCount: Number(operationResult?.executedCount || 0),
      unaffectedMonitorCount: Number(operationResult?.unaffectedMonitorCount || 0),
      expectedFailureCount: Number(operationResult?.expectedFailureCount || 0),
      notificationBatchCount: Number(operationResult?.notificationBatchCount || 0),
      notificationCount: Number(operationResult?.notificationCount || 0),
      notificationSurface: safeTelemetryText(operationResult?.notificationSurface, 120),
      externalTaskSlotsRequired: Number(operationResult?.externalTaskSlotsRequired || 0),
      maxConcurrencyObserved: Number(operationResult?.maxConcurrencyObserved || 0),
      receiptCount: Number(operationResult?.receiptCount || 0),
      watchdogStartedThroughScheduledTask: operationResult?.watchdogStartedThroughScheduledTask === true,
      watchdogRecoveryRoute: safeTelemetryText(operationResult?.watchdogRecoveryRoute, 160),
      initialHead: safeTelemetrySha(operationResult?.initialHead),
      recoveredHead: safeTelemetrySha(operationResult?.recoveredHead),
      initialPid: Number(operationResult?.initialPid || 0),
      recoveredPid: Number(operationResult?.recoveredPid || 0),
      workerKilled: operationResult?.workerKilled === true,
      workerKilledObserved: operationResult?.workerKilledObserved === true,
      supervisorDetectedWorkerDown: operationResult?.supervisorDetectedWorkerDown === true,
      supervisorRestartedWorker: operationResult?.supervisorRestartedWorker === true,
      workerRecovered: operationResult?.workerRecovered === true,
      workerFromMain: operationResult?.workerFromMain === true,
      proofWrittenToSharedWorkspace: operationResult?.proofWrittenToSharedWorkspace === true,
      publicationState: safeTelemetryText(operationResult?.publicationState, 120),
      visiblePowerShellRequired: operationResult?.visiblePowerShellRequired === true,
      proofRefs: safeProofRefs(operationResult?.proofRefs),
      workerTelemetry,
      ...conveyorProjection(operationResult),
    }),
    arbitraryFilesystemAccess: false,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    sourceMutationAllowed: false,
  });
}

export function serializeBoundedReceiptJson(receipt, maxBytes = MAX_GITHUB_RECEIPT_JSON_BYTES) {
  const fullJson = JSON.stringify(receipt, null, 2);
  const fullBytes = Buffer.byteLength(fullJson, 'utf8');

  const execution = receipt?.result || {};
  const operationResult = execution?.result || {};
  const compactReceipt = {
    schemaVersion: safeTelemetryText(receipt?.schemaVersion, 120),
    requestId: safeTelemetryText(receipt?.requestId, 160),
    operation: safeTelemetryText(receipt?.operation, 120),
    repository: safeTelemetryText(receipt?.repository, 180),
    issueNumber: Number(receipt?.issueNumber || 0),
    branch: safeTelemetryBranch(receipt?.branch),
    state: safeTelemetryText(receipt?.state, 80).toUpperCase(),
    acceptedAt: safeTelemetryText(receipt?.acceptedAt, 80),
    heartbeatAt: safeTelemetryText(receipt?.heartbeatAt, 80),
    completedAt: safeTelemetryText(receipt?.completedAt, 80),
    expectedHead: safeTelemetrySha(receipt?.expectedHead || operationResult?.expectedHead),
    prNumber: safeNonNegativeNumber(receipt?.prNumber || operationResult?.prNumber),
    proofScenario: safeTelemetryText(receipt?.proofScenario || operationResult?.proofScenario, 160),
    proofTarget: safeTelemetryText(receipt?.proofTarget || operationResult?.proofTarget, 80),
    taskId: safeTelemetryId(receipt?.taskId || operationResult?.taskId),
    pullRequestHead: safeTelemetrySha(operationResult?.pullRequestHead),
    mergeCommitHead: safeTelemetrySha(operationResult?.mergeCommitHead),
    localHead: safeTelemetrySha(operationResult?.localHead),
    blocker: safeTelemetryText(receipt?.blocker || operationResult?.blocker, 240),
    proofRefs: safeProofRefs(receipt?.proofRefs),
    result: {
      ok: execution?.ok !== false,
      verdict: safeTelemetryText(execution?.verdict, 120).toUpperCase(),
      operation: safeTelemetryText(execution?.operation || receipt?.operation, 120),
      requestId: safeTelemetryText(execution?.requestId || receipt?.requestId, 160),
      result: {
        ok: operationResult?.ok !== false,
        blocker: safeTelemetryText(operationResult?.blocker, 240),
        finalVerdict: safeTelemetryText(operationResult?.finalVerdict, 160).toUpperCase(),
        expectedHead: safeTelemetrySha(receipt?.expectedHead || operationResult?.expectedHead),
        prNumber: safeNonNegativeNumber(receipt?.prNumber || operationResult?.prNumber),
        proofScenario: safeTelemetryText(receipt?.proofScenario || operationResult?.proofScenario, 160),
        proofTarget: safeTelemetryText(receipt?.proofTarget || operationResult?.proofTarget, 80),
        taskId: safeTelemetryId(receipt?.taskId || operationResult?.taskId),
        pullRequestHead: safeTelemetrySha(operationResult?.pullRequestHead),
        mergeCommitHead: safeTelemetrySha(operationResult?.mergeCommitHead),
        localHead: safeTelemetrySha(operationResult?.localHead),
        sourceHead: safeTelemetrySha(operationResult?.sourceHead),
        branch: safeTelemetryBranch(operationResult?.branch),
        expectedHeadMatch: projectedExpectedHeadMatch(receipt, operationResult),
        monitorCount: Number(operationResult?.monitorCount || 0),
        executedCount: Number(operationResult?.executedCount || 0),
        unaffectedMonitorCount: Number(operationResult?.unaffectedMonitorCount || 0),
        expectedFailureCount: Number(operationResult?.expectedFailureCount || 0),
        notificationBatchCount: Number(operationResult?.notificationBatchCount || 0),
        notificationCount: Number(operationResult?.notificationCount || 0),
        notificationSurface: safeTelemetryText(operationResult?.notificationSurface, 120),
        externalTaskSlotsRequired: Number(operationResult?.externalTaskSlotsRequired || 0),
        maxConcurrencyObserved: Number(operationResult?.maxConcurrencyObserved || 0),
        receiptCount: Number(operationResult?.receiptCount || 0),
        targetRequestId: safeTelemetryId(operationResult?.targetRequestId),
        receipt: operationResult?.receipt ? createSanitizedMailboxReceiptProjection(operationResult.receipt) : null,
        initialPid: Number(operationResult?.initialPid || 0),
        recoveredPid: Number(operationResult?.recoveredPid || 0),
        workerKilledObserved: operationResult?.workerKilledObserved === true,
        supervisorDetectedWorkerDown: operationResult?.supervisorDetectedWorkerDown === true,
        supervisorRestartedWorker: operationResult?.supervisorRestartedWorker === true,
        workerRecovered: operationResult?.workerRecovered === true,
        workerFromMain: operationResult?.workerFromMain === true,
        proofWrittenToSharedWorkspace: operationResult?.proofWrittenToSharedWorkspace === true,
        visiblePowerShellRequired: operationResult?.visiblePowerShellRequired === true,
        proofRefs: safeProofRefs(operationResult?.proofRefs),
        workerTelemetry: projectWorkerTelemetry(operationResult?.workerTelemetry),
        ...conveyorProjection(operationResult),
        githubProjectionTruncated: fullBytes > maxBytes,
        originalBytes: fullBytes,
      },
    },
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    liveOpenClawUpdateAllowed: false,
    githubProjectionTruncated: fullBytes > maxBytes,
  };
  const compactJson = JSON.stringify(compactReceipt, null, 2);
  if (Buffer.byteLength(compactJson, 'utf8') > maxBytes) {
    throw new Error(`GITHUB_RECEIPT_PROJECTION_TOO_LARGE:${fullBytes}:${maxBytes}`);
  }
  return compactJson;
}

function loadState() {
  try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return { consumedRequestIds: [] }; }
}

function saveState(state) {
  mkdirSync(mailboxStateRoot, { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function writeReceipt(receipt) {
  mkdirSync(mailboxStateRoot, { recursive: true });
  mkdirSync(canonicalReceiptRoot, { recursive: true });
  const filename = createWindowsSafeMailboxReceiptFilename(receipt.requestId);
  const legacyPath = join(mailboxStateRoot, filename);
  const canonicalPath = join(canonicalReceiptRoot, filename);
  const payload = `${serializeBoundedReceiptJson(receipt, MAX_LOCAL_RECEIPT_BYTES)}\n`;
  writeFileSync(legacyPath, payload, 'utf8');
  writeFileSync(canonicalPath, payload, 'utf8');
  return {
    path: canonicalPath,
    legacyPath,
    ref: `receipts/github-command-mailbox/${filename}`,
  };
}

function ghJson(args) {
  const result = run('gh.exe', args, {
    timeout: 120000,
    preserveStdout: true,
    maxBuffer: MAX_GITHUB_JSON_BYTES,
  });
  if (!result.ok) throw new Error(result.error || result.stderr || 'gh command failed');
  return parseBoundedGitHubJson(result.stdout);
}

function postReceipt(receipt) {
  const body = [
    '<!-- stephanos-battle-bridge-command-receipt -->',
    '```json',
    serializeBoundedReceiptJson(receipt),
    '```',
  ].join('\n');
  return run('gh.exe', ['issue', 'comment', String(BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE), '--repo', BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY, '--body', body], { timeout: 120000 });
}

async function installUnattendedSync() {
  const installer = join(repoRoot, 'scripts', 'windows', 'install-battle-bridge-github-sync.ps1');
  if (!existsSync(installer)) return { ok: false, blocker: 'MERGED_SYNC_INSTALLER_MISSING', installer };
  const result = run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer, '-StartNow']);
  return { ...result, installer, fixedCommand: true, arbitraryShellAllowed: false };
}

function readCanonicalSourceIdentity(command = {}) {
  const source = run('git.exe', ['rev-parse', 'HEAD'], { timeout: 120000 });
  const branch = run('git.exe', ['branch', '--show-current'], { timeout: 120000 });
  const sourceHead = source.stdout.trim().toLowerCase();
  const branchName = branch.stdout.trim();
  if (!source.ok || !branch.ok || !/^[0-9a-f]{40}$/.test(sourceHead)) {
    return { ok: false, blocker: 'SOURCE_IDENTITY_READ_FAILED', sourceHead: '', branch: branchName || '' };
  }
  if (branchName !== 'main') {
    return { ok: false, blocker: 'SOURCE_BRANCH_NOT_MAIN', sourceHead, branch: branchName };
  }
  const expectedHead = String(command.expectedHead || '').trim().toLowerCase();
  if (expectedHead && expectedHead !== sourceHead) {
    return { ok: false, blocker: 'EXPECTED_HEAD_MISMATCH', sourceHead, expectedHead, branch: branchName };
  }
  return { ok: true, sourceHead, expectedHead, expectedHeadMatch: !expectedHead || expectedHead === sourceHead, branch: branchName };
}

async function readDeploymentStatus(command = {}) {
  const identity = readCanonicalSourceIdentity(command);
  const task = run('powershell.exe', ['-NoProfile', '-Command', "Get-ScheduledTask -TaskName 'Stephanos Battle Bridge GitHub Sync' -ErrorAction SilentlyContinue | Select-Object TaskName,State | ConvertTo-Json -Compress"], { timeout: 120000 });
  return { ...identity, task };
}

async function readCapabilityRegistry(command = {}) {
  const identity = readCanonicalSourceIdentity(command);
  if (!identity.ok) return identity;
  const registry = buildStephanosCapabilityRegistrySummary({
    sourceHead: identity.sourceHead,
    generatedAtUtc: new Date().toISOString(),
  });
  const validation = validateStephanosCapabilityRegistry();
  return {
    ok: validation.valid,
    blocker: validation.valid ? '' : 'CAPABILITY_REGISTRY_INVALID',
    finalVerdict: validation.finalVerdict,
    sourceHead: identity.sourceHead,
    branch: identity.branch,
    expectedHeadMatch: identity.expectedHeadMatch,
    registry,
  };
}

async function readSharedWorkspaceStatus(command = {}) {
  const identity = readCanonicalSourceIdentity(command);
  if (!identity.ok) return identity;
  const projection = await createSanitizedSharedWorkspaceProjection({
    workspaceRoot: sharedWorkspaceRoot,
    repoRoot,
    timestampUtc: new Date().toISOString(),
  });
  const ready = projection.aggregationOk === true
    && projection.aggregationVerdict === 'SHARED_WORKSPACE_LATEST_STATUS_READY'
    && projection.currentStatus !== null;
  return {
    ok: ready,
    blocker: ready ? '' : 'SHARED_WORKSPACE_STATUS_NOT_READY',
    finalVerdict: ready ? 'SHARED_WORKSPACE_STATUS_READY' : 'SHARED_WORKSPACE_STATUS_BLOCKED',
    workspaceVerdict: projection.aggregationVerdict,
    sourceHead: identity.sourceHead,
    branch: identity.branch,
    expectedHeadMatch: identity.expectedHeadMatch,
    projection,
    arbitraryFilesystemAccess: false,
    commandExecutionAccess: false,
    sourceMutationAccess: false,
  };
}

export function createSanitizedCriticalBacklogStatusProjection(record = {}, {
  nowMs = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  const statusTimestampUtc = safeTimestamp(record?.timestampUtc || record?.statusTimestampUtc);
  const recordMs = Date.parse(statusTimestampUtc);
  return Object.freeze({
    decision: safeConveyorDecision(record?.decision),
    selectedItemId: safeConveyorId(record?.selectedItemId),
    activeMissionId: safeConveyorId(record?.activeMissionId),
    activePhase: safeConveyorId(record?.activePhase),
    completedItemIds: safeConveyorIds(record?.completedItemIds),
    remainingItemIds: safeConveyorIds(record?.remainingItemIds),
    exactNextAction: safeConveyorAction(record?.exactNextAction),
    statusTimestampUtc,
    statusAgeMs: Number.isFinite(recordMs) ? Math.max(0, nowMs - recordMs) : 0,
    staleAfterMs: safeNonNegativeNumber(staleAfterMs),
    oneActiveMissionEnforced: record?.oneActiveMissionEnforced === true,
    duplicateCodexDispatchAllowed: record?.duplicateCodexDispatchAllowed === true,
    mergeAuthority: record?.mergeAuthority === true,
    exactHeadApprovalRequired: record?.exactHeadApprovalRequired === true,
  });
}

export function validateCriticalBacklogStatusRecord(record = {}, {
  nowMs = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  const validation = validateSharedWorkspaceRecord(record, { nowMs, staleAfterMs });
  const projection = createSanitizedCriticalBacklogStatusProjection(record, { nowMs, staleAfterMs });
  if (!validation.valid) {
    return Object.freeze({ ok: false, blocker: 'CRITICAL_BACKLOG_STATUS_RECORD_INVALID', validation, ...projection });
  }
  if (String(record?.statusId || '') !== 'critical-backlog-conveyor-current'
    || String(record?.participantId || '') !== 'critical-backlog-conveyor') {
    return Object.freeze({ ok: false, blocker: 'CRITICAL_BACKLOG_STATUS_IDENTITY_MISMATCH', validation, ...projection });
  }
  if (!projection.decision) {
    return Object.freeze({ ok: false, blocker: 'CRITICAL_BACKLOG_STATUS_DECISION_INVALID', validation, ...projection });
  }
  if (validation.stale) {
    return Object.freeze({ ok: false, blocker: 'CRITICAL_BACKLOG_STATUS_STALE', validation, ...projection });
  }
  return Object.freeze({ ok: true, blocker: '', validation, ...projection });
}

async function readCriticalBacklogStatus(command = {}) {
  const identity = readCanonicalSourceIdentity(command);
  if (!identity.ok) return identity;
  let payload;
  try {
    payload = readFileSync(criticalBacklogStatusPath, 'utf8');
  } catch {
    return { ...identity, ok: false, blocker: 'CRITICAL_BACKLOG_STATUS_NOT_FOUND' };
  }
  if (Buffer.byteLength(payload, 'utf8') > MAX_CRITICAL_BACKLOG_STATUS_BYTES) {
    return { ...identity, ok: false, blocker: 'CRITICAL_BACKLOG_STATUS_TOO_LARGE' };
  }
  let record;
  try {
    record = JSON.parse(payload);
  } catch {
    return { ...identity, ok: false, blocker: 'CRITICAL_BACKLOG_STATUS_JSON_INVALID' };
  }
  const status = validateCriticalBacklogStatusRecord(record);
  if (!status.ok) {
    return {
      ...identity,
      ...status,
      validation: undefined,
      arbitraryFilesystemAccess: false,
      commandExecutionAccess: false,
      sourceMutationAccess: false,
    };
  }
  return {
    ...identity,
    ...status,
    validation: undefined,
    ok: true,
    finalVerdict: 'CRITICAL_BACKLOG_STATUS_READY',
    arbitraryFilesystemAccess: false,
    commandExecutionAccess: false,
    sourceMutationAccess: false,
  };
}

export async function readMailboxReceipt(command = {}, {
  readSourceIdentity = readCanonicalSourceIdentity,
  receiptRoot = canonicalReceiptRoot,
} = {}) {
  const identity = await readSourceIdentity(command);
  if (!identity.ok) return identity;
  const targetRequestId = String(command.targetRequestId || '');
  if (!SAFE_REQUEST_ID_PATTERN.test(targetRequestId)) {
    return { ...identity, ok: false, blocker: 'MAILBOX_RECEIPT_TARGET_INVALID' };
  }
  for (const filename of getReadableMailboxReceiptFilenames(targetRequestId)) {
    const receiptPath = join(receiptRoot, filename);
    let info;
    try {
      info = lstatSync(receiptPath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      return { ...identity, ok: false, blocker: 'MAILBOX_RECEIPT_READ_FAILED', targetRequestId };
    }
    if (!info.isFile()) {
      return { ...identity, ok: false, blocker: 'MAILBOX_RECEIPT_NOT_REGULAR_FILE', targetRequestId };
    }
    let payload;
    try {
      payload = readFileSync(receiptPath, 'utf8');
    } catch {
      return { ...identity, ok: false, blocker: 'MAILBOX_RECEIPT_READ_FAILED', targetRequestId };
    }
    if (Buffer.byteLength(payload, 'utf8') > MAX_LOCAL_RECEIPT_BYTES) {
      return { ...identity, ok: false, blocker: 'MAILBOX_RECEIPT_TOO_LARGE', targetRequestId };
    }
    let receipt;
    try {
      receipt = JSON.parse(payload);
    } catch {
      return { ...identity, ok: false, blocker: 'MAILBOX_RECEIPT_JSON_INVALID', targetRequestId };
    }
    if (String(receipt?.requestId || '') !== targetRequestId) {
      return { ...identity, ok: false, blocker: 'MAILBOX_RECEIPT_ID_MISMATCH', targetRequestId };
    }
    return {
      ...identity,
      ok: true,
      finalVerdict: 'MAILBOX_RECEIPT_READ_READY',
      targetRequestId,
      receipt: createSanitizedMailboxReceiptProjection(receipt),
      arbitraryFilesystemAccess: false,
      commandExecutionAccess: false,
      sourceMutationAccess: false,
    };
  }
  return { ...identity, ok: false, blocker: 'MAILBOX_RECEIPT_NOT_FOUND', targetRequestId };
}

export async function runBattleBridgeGitHubCommandMailbox({ now = () => new Date() } = {}) {
  if (process.platform !== 'win32') return { ok: false, blocker: 'WINDOWS_REQUIRED' };
  if (repoRoot.toLowerCase() !== expectedRepoRoot.toLowerCase()) {
    return { ok: false, blocker: 'CANONICAL_CHECKOUT_REQUIRED', repoRoot, expectedRepoRoot };
  }
  const comments = ghJson(['api', `repos/${BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY}/issues/${BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE}/comments`, '--paginate']);
  const state = loadState();
  const selected = selectNextBattleBridgeGitHubCommand(comments, {
    consumedRequestIds: new Set(state.consumedRequestIds || []),
    now: now(),
  });
  if (selected.verdict === 'NO_COMMAND_READY') return selected;
  if (!selected.ok) return selected;

  const acceptedAt = now().toISOString();
  let receipt = buildBattleBridgeGitHubCommandReceipt({ command: selected.command, state: 'ACCEPTED', acceptedAt, heartbeatAt: acceptedAt, proofRefs: [selected.commentUrl] });
  const receiptLocation = writeReceipt(receipt);
  const receiptRef = receiptLocation.ref;
  postReceipt({ ...receipt, receiptRef });

  const execution = await executeBattleBridgeGitHubCommand(selected.command, {
    updateStephanos: (command) => updateStephanosFromChat({ operatorApproval: command.operatorApproval, expectedBranch: 'main' }),
    installUnattendedSync,
    runDiagnostics: () => runBattleBridgeDiagnostics(),
    readDeploymentStatus,
    readCapabilityRegistry,
    readSharedWorkspaceStatus,
    readCriticalBacklogStatus,
    readMailboxReceipt,
    runWorkerWatchdogAcceptance: (command) => runBattleBridgeWorkerWatchdogAcceptance({ expectedHead: command.expectedHead }),
    runMonitorMultiplexerAcceptance: (command) => runBattleBridgeMonitorMultiplexerCanary({ expectedHead: command.expectedHead, requestId: command.requestId }),
    runExactHeadWindowsBrowserProof: (command) => dispatchExactHeadWindowsBrowserProof(command),
  });

  const completedAt = now().toISOString();
  receipt = buildBattleBridgeGitHubCommandReceipt({
    command: selected.command,
    state: execution.ok ? 'DONE' : 'BLOCKED',
    acceptedAt,
    heartbeatAt: completedAt,
    completedAt,
    result: execution,
    blocker: execution.blocker || execution.result?.blocker || '',
    proofRefs: [selected.commentUrl, receiptRef],
  });
  writeReceipt(receipt);
  state.consumedRequestIds = [...new Set([...(state.consumedRequestIds || []), selected.command.requestId])].slice(-500);
  state.lastReceipt = JSON.parse(serializeBoundedReceiptJson(receipt, MAX_LOCAL_RECEIPT_BYTES));
  saveState(state);
  postReceipt({ ...receipt, receiptRef });
  return { ...receipt, receiptPath: receiptLocation.path, receiptRef };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBattleBridgeGitHubCommandMailbox()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result?.ok === false ? 1 : 0;
    })
    .catch((error) => {
      process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
      process.exitCode = 1;
    });
}
