import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSourceMutationLeaseReleaseRecord,
  validateSourceMutationLease,
  validateSourceMutationLeaseReleaseRecord,
} from './programmeAuthorityV1.mjs';
import {
  DEFAULT_MISSION_WORKER_HEARTBEAT_MAX_AGE_MS,
  projectMissionWorkerHeartbeat,
} from '../../scripts/mission-orchestrator-worker-heartbeat.mjs';
import { resolveForgeShadowM2DigestOnBattleBridge } from './forgeShadowM2DigestResolverV1.mjs';
import {
  BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE,
  preserveBattleBridgeDirtyData,
} from './battleBridgeDirtyDataPreservationV1.mjs';
import { classifyDirt } from '../../scripts/battle-bridge-github-sync-policy.mjs';

export const DEFAULT_CODEX_DISPATCH_REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const DEFAULT_BATTLE_BRIDGE_ENDPOINTS = Object.freeze([
  'http://127.0.0.1:4173/__stephanos/health',
  'http://127.0.0.1:8787/api/health',
  'http://127.0.0.1:18789/health',
]);
export const BATTLE_BRIDGE_WORKER_TELEMETRY_SCHEMA = 'stephanos.battle-bridge.worker-telemetry.v1';
export const CODEX_DISPATCH_TEST_ARGS = Object.freeze([
  '--test',
  '--test-reporter=tap',
  'shared/agents/localCodexExecIntegration.test.mjs',
  'shared/agents/codexDispatchMcp.test.mjs',
  'shared/agents/codexDispatchHostOps.test.mjs',
  'shared/agents/battleBridgeDirtyDataPreservationV1.test.mjs',
  'shared/agents/forgeShadowM2DigestResolverV1.test.mjs',
  'shared/agents/stephanosChatUpdate.test.mjs',
  'shared/agents/remoteCodexTaskVisibility.test.mjs',
  'scripts/remote-codex-task-visibility-observer.test.mjs',
  'scripts/remote-codex-github-mirror-publisher.test.mjs',
  'scripts/battle-bridge-worker-watchdog-runner.test.mjs',
]);

const EXACT_GIT_HEAD = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,120}$/;
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const MAX_TELEMETRY_JSON_BYTES = 256 * 1024;
const ACTIVE_TASK_STATUSES = new Set(['DISPATCHED', 'CLAIMED', 'RUNNING', 'WAITING_PROOF']);
const CANONICAL_ORIGIN = /^(?:https:\/\/github\.com\/Cheekyfellastef\/stephan-os(?:\.git)?\/?|git@github\.com:Cheekyfellastef\/stephan-os(?:\.git)?|ssh:\/\/git@github\.com\/Cheekyfellastef\/stephan-os(?:\.git)?\/?)$/i;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function safeSha(value) {
  const normalized = text(value).toLowerCase();
  return EXACT_GIT_HEAD.test(normalized) ? normalized : '';
}

function safeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) ? normalized : '';
}

function safeTimestamp(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function safeCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function safeProofRefs(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(String).filter((ref) => (
      /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/.test(ref) && !ref.includes('..')
    )))].slice(0, 20)
    : [];
}

function readBoundedJson(filePath, {
  readFile = readFileSync,
  lstat = lstatSync,
  maxBytes = MAX_TELEMETRY_JSON_BYTES,
} = {}) {
  try {
    const info = lstat(filePath);
    if (info.isSymbolicLink() || !info.isFile()) {
      return Object.freeze({ state: 'unverifiable', value: null, blocker: 'TELEMETRY_RECORD_NOT_REGULAR' });
    }
    if (info.size > maxBytes) {
      return Object.freeze({ state: 'unverifiable', value: null, blocker: 'TELEMETRY_RECORD_TOO_LARGE' });
    }
    const payload = readFile(filePath, 'utf8');
    if (Buffer.byteLength(payload, 'utf8') > maxBytes) {
      return Object.freeze({ state: 'unverifiable', value: null, blocker: 'TELEMETRY_RECORD_TOO_LARGE' });
    }
    return Object.freeze({ state: 'present', value: JSON.parse(payload), blocker: '' });
  } catch (error) {
    return error?.code === 'ENOENT'
      ? Object.freeze({ state: 'absent', value: null, blocker: '' })
      : Object.freeze({ state: 'unverifiable', value: null, blocker: 'TELEMETRY_RECORD_READ_FAILED' });
  }
}

export function resolveBattleBridgeTelemetryPaths({
  env = process.env,
  home = os.homedir(),
  workspaceRoot = '',
} = {}) {
  const userHome = resolve(env.USERPROFILE || env.HOME || home);
  const workspace = resolve(
    workspaceRoot || env.STEPHANOS_SHARED_AGENT_WORKSPACE || join(userHome, 'Documents', 'Stephanos-openclaw-workspace'),
  );
  return Object.freeze({
    workspaceRoot: workspace,
    workerHeartbeatPath: join(workspace, 'status', 'mission-orchestrator-worker-heartbeat.json'),
    sourceMutationLeasePath: join(workspace, 'status', 'source-mutation-lease-current.json'),
    controllerHeartbeatPath: join(workspace, 'status', 'programme-controller-heartbeat.json'),
    mailboxReceiptIndexPath: join(workspace, 'status', 'battle-bridge-mailbox-receipt-index.json'),
    guardedGoalRunnerPath: join(workspace, 'status', 'guarded-goal-runner-current.json'),
    guardedGoalRunnerPrPath: join(workspace, 'status', 'guarded-goal-runner-pr-current.json'),
    codexCurrentPath: join(workspace, 'codex-dispatch', 'current.json'),
    codexTasksRoot: join(workspace, 'codex-dispatch', 'tasks'),
    executionReceiptsRoot: join(workspace, 'receipts'),
  });
}

function canonicalWorkerProbePath(repoRoot) {
  return resolve(repoRoot, 'scripts', 'windows', 'probe-mission-orchestrator-worker-watchdog.ps1');
}

export function readCanonicalBattleBridgeWorkerObservation({
  repoRoot = DEFAULT_CODEX_DISPATCH_REPO_ROOT,
  platform = process.platform,
  spawnSyncFn = spawnSync,
} = {}) {
  if (platform !== 'win32') {
    return Object.freeze({ ok: false, blocker: 'WINDOWS_REQUIRED', observation: null });
  }
  const command = capture(spawnSyncFn, 'powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    canonicalWorkerProbePath(repoRoot),
    '-Mode',
    'Inspect',
  ], { cwd: repoRoot, timeout: 120000 });
  if (!command.ok) {
    return Object.freeze({ ok: false, blocker: 'WORKER_OBSERVATION_COMMAND_FAILED', command, observation: null });
  }
  try {
    const observation = JSON.parse(command.stdout || 'null');
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
      return Object.freeze({ ok: false, blocker: 'WORKER_OBSERVATION_JSON_INVALID', command, observation: null });
    }
    return Object.freeze({ ok: true, blocker: '', command, observation });
  } catch {
    return Object.freeze({ ok: false, blocker: 'WORKER_OBSERVATION_JSON_INVALID', command, observation: null });
  }
}

function sanitizedExecutionReceipt(receipt = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  return Object.freeze({
    repository: SAFE_REPOSITORY.test(text(receipt.repository)) ? text(receipt.repository) : '',
    issueNumber: safeCount(receipt.issueNumber),
    prNumber: safeCount(receipt.prNumber),
    branch: SAFE_BRANCH.test(text(receipt.branch)) ? text(receipt.branch) : '',
    sourceHead: safeSha(receipt.sourceHead),
    workerId: safeId(receipt.workerId),
    workerType: safeId(receipt.workerType),
    executionId: safeId(receipt.executionId),
    leaseKey: safeId(receipt.leaseKey),
    state: text(receipt.state).toLowerCase(),
    phase: text(receipt.phase).toLowerCase(),
    sequence: safeCount(receipt.sequence),
    timestampUtc: safeTimestamp(receipt.timestampUtc),
    heartbeatExpiresAtUtc: safeTimestamp(receipt.heartbeatExpiresAtUtc),
    blocker: text(receipt.blocker),
    operatorActionRequired: receipt.operatorActionRequired === true,
    expectedNextAction: text(receipt.expectedNextAction),
    proofRefs: safeProofRefs(receipt.proofRefs),
  });
}

function compactPosture(record = {}) {
  const source = record?.prProof || record?.proof || record;
  if (!source || typeof source !== 'object') return Object.freeze({ state: 'UNKNOWN', summary: '' });
  return Object.freeze({
    state: text(source.state || source.status || source.publicationState, 'UNKNOWN').toUpperCase(),
    allGreen: source.allGreen === true || source.success === true || source.passed === true,
    mergeable: typeof source.mergeable === 'boolean' ? source.mergeable : null,
    summary: text(source.summary || source.detail || source.reason),
    proofRefs: safeProofRefs(source.proofRefs || source.refs),
  });
}

function resolveActiveTask(records = {}) {
  const candidates = [records.codexCurrent, records.guardedGoalRunnerPr, records.guardedGoalRunner]
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value));
  return candidates.find((value) => ACTIVE_TASK_STATUSES.has(text(value.status).toUpperCase())) || null;
}

function taskIdentity({ task, lease, heartbeat, fullHead }) {
  const source = task || lease || {};
  return Object.freeze({
    taskId: safeId(source.taskId || source.jobId || source.executionId),
    goalId: text(source.goalId || source.relatedGoal || (source.issueNumber ? `#${source.issueNumber}` : '')),
    issueNumber: safeCount(source.issueNumber || lease?.issueNumber),
    prNumber: safeCount(source.prNumber || source.pullRequestNumber || lease?.prNumber),
    branch: SAFE_BRANCH.test(text(source.branch || lease?.branch || '')) ? text(source.branch || lease?.branch) : '',
    headSha: safeSha(source.headSha || source.sourceHead || lease?.headSha || fullHead),
    phase: text(source.phase || source.currentPhase || source.status || heartbeat?.lastTickVerdict, 'UNKNOWN').toUpperCase(),
    boundedAction: text(source.expectedNextAction || source.nextAction || source.exactNextAction || source.action || 'Observe the canonical worker state.'),
  });
}

export function collectBattleBridgeWorkerTelemetry({
  repoRoot = DEFAULT_CODEX_DISPATCH_REPO_ROOT,
  fullHead = '',
  nowUtc = new Date().toISOString(),
  env = process.env,
  home = os.homedir(),
  workspaceRoot = '',
  workerInspection = null,
  readRecord = readBoundedJson,
  heartbeatMaxAgeMs = DEFAULT_MISSION_WORKER_HEARTBEAT_MAX_AGE_MS,
} = {}) {
  const paths = resolveBattleBridgeTelemetryPaths({ env, home, workspaceRoot });
  const records = {
    heartbeat: readRecord(paths.workerHeartbeatPath),
    lease: readRecord(paths.sourceMutationLeasePath),
    controller: readRecord(paths.controllerHeartbeatPath),
    mailboxIndex: readRecord(paths.mailboxReceiptIndexPath),
    guardedGoalRunner: readRecord(paths.guardedGoalRunnerPath),
    guardedGoalRunnerPr: readRecord(paths.guardedGoalRunnerPrPath),
    codexCurrent: readRecord(paths.codexCurrentPath),
  };
  const heartbeat = records.heartbeat.state === 'present' ? records.heartbeat.value : null;
  const heartbeatProjection = heartbeat
    ? projectMissionWorkerHeartbeat(heartbeat, {
      nowUtc,
      maxAgeMs: heartbeatMaxAgeMs,
      expectedRepositoryRoot: resolve(repoRoot),
      expectedHeadSha: safeSha(fullHead) || 'invalid',
    })
    : Object.freeze({ valid: false, fresh: false, ageMs: null, errors: Object.freeze([records.heartbeat.state === 'absent' ? 'worker-heartbeat-missing' : records.heartbeat.blocker || 'worker-heartbeat-unverifiable']), finalVerdict: 'MISSION_WORKER_HEARTBEAT_BLOCKED' });
  const inspectionWrapper = Boolean(
    workerInspection
    && typeof workerInspection === 'object'
    && ('ok' in workerInspection || 'observation' in workerInspection || 'blocker' in workerInspection),
  );
  const inspection = inspectionWrapper ? workerInspection.observation : workerInspection;
  const inspectionProven = inspectionWrapper ? workerInspection.ok === true && Boolean(workerInspection.observation) : Boolean(inspection);
  const scheduledTask = inspection?.scheduledTask || {};
  const processEvidence = inspection?.process || {};
  const processHealthy = processEvidence.running === true
    && processEvidence.commandLineMatchesCanonicalWorker === true
    && scheduledTask.actionMatchesCanonicalWorker === true
    && text(processEvidence.taskName) === 'Stephanos Mission Orchestrator Worker';
  const activeTask = resolveActiveTask({
    codexCurrent: records.codexCurrent.state === 'present' ? records.codexCurrent.value : null,
    guardedGoalRunner: records.guardedGoalRunner.state === 'present' ? records.guardedGoalRunner.value : null,
    guardedGoalRunnerPr: records.guardedGoalRunnerPr.state === 'present' ? records.guardedGoalRunnerPr.value : null,
  });
  const lease = records.lease.state === 'present' ? records.lease.value : null;
  const leaseValidation = lease
    ? validateSourceMutationLease(lease, { nowUtc })
    : Object.freeze({ valid: false, active: false, errors: Object.freeze(['source-mutation-lease-not-observed']), finalVerdict: 'SOURCE_MUTATION_LEASE_NOT_CLAIMED' });
  let releaseMarker = Object.freeze({ state: 'absent', value: null });
  if (lease) {
    try {
      const releaseRecord = createSourceMutationLeaseReleaseRecord(lease, { timestampUtc: nowUtc });
      releaseMarker = readRecord(join(paths.workspaceRoot, 'status', `${releaseRecord.statusId}.json`));
    } catch {
      releaseMarker = Object.freeze({ state: 'unverifiable', value: null, blocker: 'SOURCE_MUTATION_LEASE_RELEASE_RECORD_INVALID' });
    }
  }
  const releaseValidation = releaseMarker.state === 'present'
    ? validateSourceMutationLeaseReleaseRecord(releaseMarker.value, lease, { nowUtc })
    : Object.freeze({
      valid: false,
      errors: Object.freeze([releaseMarker.state === 'unverifiable'
        ? releaseMarker.blocker || 'SOURCE_MUTATION_LEASE_RELEASE_RECORD_INVALID'
        : 'source-mutation-lease-release-not-observed']),
      finalVerdict: 'SOURCE_MUTATION_LEASE_RELEASE_NOT_OBSERVED',
    });
  const releasedLeaseIsSafelyInactive = releaseMarker.state === 'present' && releaseValidation.valid;
  const leaseActive = Boolean(
    lease
    && leaseValidation.valid
    && leaseValidation.active
    && !releasedLeaseIsSafelyInactive,
  );
  const identity = taskIdentity({
    task: activeTask,
    lease: leaseActive ? lease : null,
    heartbeat,
    fullHead,
  });
  const taskId = identity.taskId;
  const taskResult = taskId && records.codexCurrent.state === 'present'
    ? readRecord(join(paths.codexTasksRoot, taskId, 'result.json'))
    : Object.freeze({ state: 'absent', value: null });
  const latestReceipt = sanitizedExecutionReceipt(
    taskResult.state === 'present'
      ? taskResult.value
      : (records.mailboxIndex.state === 'present'
        ? records.mailboxIndex.value?.activeReceipt || records.mailboxIndex.value?.recentReceipts?.[0]
        : null),
  );
  const blockers = [];
  if (!inspectionProven) blockers.push(workerInspection?.blocker || 'WORKER_OBSERVATION_NOT_PROVEN');
  if (!processHealthy) blockers.push('WORKER_PROCESS_NOT_PROVEN_CANONICAL');
  if (!heartbeatProjection.valid) blockers.push(...(heartbeatProjection.errors || ['WORKER_HEARTBEAT_INVALID']));
  else if (!heartbeatProjection.fresh) blockers.push('WORKER_HEARTBEAT_STALE');
  if (safeSha(fullHead) && heartbeatProjection.headSha && heartbeatProjection.headSha !== safeSha(fullHead)) blockers.push('WORKER_HEARTBEAT_HEAD_MISMATCH');
  if (activeTask && !leaseActive) blockers.push('SOURCE_MUTATION_LEASE_NOT_OBSERVED');
  if (activeTask && !taskId) blockers.push('ACTIVE_TASK_ID_NOT_OBSERVED');
  if (activeTask && !latestReceipt) blockers.push('ACTIVE_TASK_RECEIPT_NOT_OBSERVED');
  if (lease && !leaseValidation.valid) blockers.push('SOURCE_MUTATION_LEASE_INVALID');
  if (releaseMarker.state === 'unverifiable') blockers.push(releaseMarker.blocker || 'SOURCE_MUTATION_LEASE_RELEASE_RECORD_INVALID');
  if (releaseMarker.state === 'present' && !releaseValidation.valid) blockers.push('SOURCE_MUTATION_LEASE_RELEASE_RECORD_INVALID');
  const workerActive = inspectionProven && processHealthy && heartbeatProjection.valid && heartbeatProjection.fresh;
  const operatorActionRequired = activeTask?.operatorActionRequired === true
    || latestReceipt?.operatorActionRequired === true;
  const uniqueBlockers = [...new Set(blockers.filter(Boolean))];
  const ok = inspectionProven && workerActive && uniqueBlockers.length === 0;
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_WORKER_TELEMETRY_SCHEMA,
    ok,
    workerActive,
    workerAlive: inspectionProven ? processHealthy : null,
    workerStatus: ok ? (activeTask ? 'RUNNING' : 'IDLE') : 'NOT_PROVEN',
    worker: Object.freeze({
      pid: Number.parseInt(processEvidence.pid ?? heartbeat?.pid ?? 0, 10) || 0,
      observedPid: Number.parseInt(processEvidence.pid ?? heartbeat?.pid ?? 0, 10) || 0,
      commandIdentity: 'scripts/mission-orchestrator-worker-supervised.mjs',
      commandLineVerified: processEvidence.commandLineMatchesCanonicalWorker === true,
      taskName: text(processEvidence.taskName || scheduledTask.taskName),
      scheduledTaskState: text(scheduledTask.status, 'UNKNOWN').toUpperCase(),
    }),
    task: identity,
    heartbeat: Object.freeze({
      timestampUtc: heartbeatProjection.timestampUtc || safeTimestamp(heartbeat?.timestampUtc),
      ageMs: heartbeatProjection.ageMs,
      fresh: heartbeatProjection.fresh === true,
      headSha: safeSha(heartbeat?.headSha),
      branch: text(heartbeat?.branch),
      tickVerdict: text(heartbeat?.lastTickVerdict),
      errors: [...(heartbeatProjection.errors || [])],
    }),
    lease: lease ? Object.freeze({
      observed: true,
      valid: leaseValidation.valid === true,
      active: leaseActive,
      released: releasedLeaseIsSafelyInactive,
      releaseRecordValid: releaseValidation.valid === true,
      leaseId: safeId(lease.leaseId),
      laneId: safeId(lease.laneId),
      ownerId: safeId(lease.ownerId),
      repository: SAFE_REPOSITORY.test(text(lease.repository)) ? text(lease.repository) : '',
      issueNumber: safeCount(lease.issueNumber),
      prNumber: safeCount(lease.prNumber),
      branch: SAFE_BRANCH.test(text(lease.branch)) ? text(lease.branch) : '',
      headSha: safeSha(lease.headSha),
      acquiredAtUtc: safeTimestamp(lease.acquiredAtUtc),
      renewedAtUtc: safeTimestamp(lease.renewedAtUtc),
      expiresAtUtc: safeTimestamp(lease.expiresAtUtc),
      errors: [...(leaseValidation.errors || [])],
    }) : Object.freeze({ observed: false, valid: false, active: false, leaseId: '', errors: ['SOURCE_MUTATION_LEASE_NOT_CLAIMED'] }),
    latestExecutionReceipt: latestReceipt,
    testsChecksReview: Object.freeze({
      tests: compactPosture(activeTask?.tests || activeTask?.testsRun || (records.guardedGoalRunnerPr.state === 'present' ? records.guardedGoalRunnerPr.value : null)),
      checks: compactPosture(activeTask?.checks || activeTask?.checkStatus),
      review: compactPosture(activeTask?.review || activeTask?.reviewPosture),
    }),
    blockers: Object.freeze(uniqueBlockers),
    operatorActionRequired,
    nextAction: ok
      ? identity.boundedAction
      : (operatorActionRequired ? 'Review the typed operator blocker and preserve the active lane.' : 'Use the existing Battle Bridge watchdog/worker route to publish fresh canonical evidence; do not infer activity from silence.'),
    evidence: Object.freeze({
      workerObservation: inspection,
      sourceMutationLeasePath: paths.sourceMutationLeasePath,
      workerHeartbeatPath: paths.workerHeartbeatPath,
      mailboxReceiptIndexPath: paths.mailboxReceiptIndexPath,
    }),
    finalVerdict: ok ? 'WORKER_TELEMETRY_READY' : 'WORKER_TELEMETRY_BLOCKED',
  });
}

function bounded(value = '', limit = 6000) {
  const text = String(value || '').trim();
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

function boundedGitStatus(value = '', limit = 6000) {
  const text = String(value || '').trimEnd();
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

export function parseTapTestSummary(value = '') {
  const output = String(value || '');
  const countKeys = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];
  const counts = Object.fromEntries(countKeys.map((key) => [key, null]));
  const observedCounts = new Set();
  for (const match of output.matchAll(/^\s*#\s+(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/gm)) {
    const count = Number.parseInt(match[2], 10);
    if (Number.isSafeInteger(count) && count >= 0) {
      counts[match[1]] = count;
      observedCounts.add(match[1]);
    }
  }
  const failingTests = [...output.matchAll(/^\s*not ok\s+\d+\s+-\s+(.+?)\s*$/gm)]
    .map((match) => String(match[1]).trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, 3);
  return Object.freeze({ summaryComplete: countKeys.every((key) => observedCounts.has(key)), ...counts, failingTests });
}

function capture(spawnSyncFn, command, args, {
  cwd,
  timeout = 120000,
  captureTapSummary = false,
  preserveGitStatusColumns = false,
} = {}) {
  const result = spawnSyncFn(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout,
  });
  const stdout = String(result?.stdout || '');
  return Object.freeze({
    command,
    args: [...args],
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    signal: result?.signal ?? null,
    stdout: preserveGitStatusColumns ? boundedGitStatus(stdout) : bounded(stdout),
    stderr: bounded(result?.stderr),
    error: result?.error?.message || '',
    ...(captureTapSummary ? { tapSummary: parseTapTestSummary(stdout) } : {}),
  });
}

function git(spawnSyncFn, repoRoot, args, timeout) {
  return capture(spawnSyncFn, 'git', args, {
    cwd: repoRoot,
    timeout,
    preserveGitStatusColumns: args[0] === 'status' && args.includes('--porcelain=v1'),
  });
}

function parseAheadBehind(output = '') {
  const [aheadText = '0', behindText = '0'] = String(output).trim().split(/\s+/);
  const ahead = Number.parseInt(aheadText, 10);
  const behind = Number.parseInt(behindText, 10);
  return {
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null,
  };
}

function changedFiles(output = '') {
  return String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function classifyCompletedSyncBlocker({ afterHead, approvedTargetHead, statusAfter, diffNames, tests } = {}) {
  if (!afterHead?.ok) return 'POST_SYNC_HEAD_READ_FAILED';
  if (afterHead.stdout !== approvedTargetHead) return 'POST_SYNC_HEAD_MISMATCH';
  if (!statusAfter?.ok) return 'POST_SYNC_STATUS_READ_FAILED';
  if (!diffNames?.ok) return 'POST_SYNC_CHANGED_FILES_READ_FAILED';
  if (!tests?.ok) return 'POST_SYNC_VERIFICATION_FAILED';
  return '';
}

export function syncCodexDispatchBridge({
  repoRoot = DEFAULT_CODEX_DISPATCH_REPO_ROOT,
  expectedBranch = 'main',
  operatorApproval = '',
  spawnSyncFn = spawnSync,
  nodeCommand = process.execPath,
  preservationProfile = '',
  preservationApproval = '',
  workspaceRoot = resolveBattleBridgeTelemetryPaths().workspaceRoot,
  expectedPreservationPaths = Object.freeze({
    repoRoot: DEFAULT_CODEX_DISPATCH_REPO_ROOT,
    workspaceRoot: resolveBattleBridgeTelemetryPaths().workspaceRoot,
  }),
  nowFn = () => new Date(),
} = {}) {
  if (operatorApproval !== 'operator-approved') {
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      verdict: 'FAIL',
      blocker: 'OPERATOR_APPROVAL_REQUIRED',
      nextOperatorAction: 'Ask the operator to explicitly approve updating to the latest canonical origin/main observed by this run.',
    });
  }

  const branch = git(spawnSyncFn, repoRoot, ['branch', '--show-current']);
  if (!branch.ok) return Object.freeze({ ok: false, status: 'FAILED', verdict: 'FAIL', blocker: 'BRANCH_READ_FAILED', branch });
  if (branch.stdout !== expectedBranch) {
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      verdict: 'FAIL',
      blocker: 'UNEXPECTED_BRANCH',
      expectedBranch,
      actualBranch: branch.stdout,
      nextOperatorAction: 'Return the canonical repository to main without discarding local work, then retry.',
    });
  }

  const beforeHead = git(spawnSyncFn, repoRoot, ['rev-parse', 'HEAD']);
  const statusBefore = git(spawnSyncFn, repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (!beforeHead.ok || !statusBefore.ok) {
    return Object.freeze({ ok: false, status: 'FAILED', verdict: 'FAIL', blocker: 'LOCAL_STATE_READ_FAILED', beforeHead, statusBefore });
  }

  let preservation = null;
  let statusBeforeSync = statusBefore;
  if (preservationProfile || preservationApproval) {
    if (preservationProfile !== BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE) {
      return Object.freeze({ ok: false, status: 'BLOCKED', verdict: 'FAIL', blocker: 'PRESERVATION_PROFILE_NOT_ALLOWED' });
    }
    const repositoryTopLevel = git(spawnSyncFn, repoRoot, ['rev-parse', '--show-toplevel']);
    const originUrl = git(spawnSyncFn, repoRoot, ['remote', 'get-url', 'origin']);
    if (!repositoryTopLevel.ok || resolve(repositoryTopLevel.stdout) !== resolve(repoRoot)) {
      return Object.freeze({ ok: false, status: 'BLOCKED', verdict: 'FAIL', blocker: 'NON_CANONICAL_REPOSITORY_PATH' });
    }
    if (!originUrl.ok || !CANONICAL_ORIGIN.test(originUrl.stdout)) {
      return Object.freeze({ ok: false, status: 'BLOCKED', verdict: 'FAIL', blocker: 'NON_CANONICAL_ORIGIN' });
    }
  }

  const fetchResult = git(spawnSyncFn, repoRoot, ['fetch', 'origin', expectedBranch], 120000);
  if (!fetchResult.ok) {
    return Object.freeze({
      ok: false,
      status: 'FAILED',
      verdict: 'FAIL',
      blocker: 'ORIGIN_FETCH_FAILED',
      beforeHead: beforeHead.stdout,
      statusBefore: statusBefore.stdout,
      fetchResult,
    });
  }

  const remoteRef = `origin/${expectedBranch}`;
  const remoteHead = git(spawnSyncFn, repoRoot, ['rev-parse', remoteRef]);
  const approvedTargetHead = remoteHead.stdout;
  const divergence = git(spawnSyncFn, repoRoot, ['rev-list', '--left-right', '--count', `HEAD...${approvedTargetHead}`]);
  if (!remoteHead.ok || !divergence.ok) {
    return Object.freeze({ ok: false, status: 'FAILED', verdict: 'FAIL', blocker: 'REMOTE_STATE_READ_FAILED', remoteHead, divergence });
  }

  const counts = parseAheadBehind(divergence.stdout);
  if (counts.ahead === null || counts.behind === null || counts.ahead > 0) {
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      verdict: 'FAIL',
      blocker: 'LOCAL_BRANCH_NOT_FAST_FORWARD_SAFE',
      beforeHead: beforeHead.stdout,
      remoteHead: remoteHead.stdout,
      ahead: counts.ahead,
      behind: counts.behind,
      statusBefore: statusBefore.stdout,
      nextOperatorAction: 'Review local commits or divergence. No reset, clean, checkout, stash, or force operation was attempted.',
    });
  }

  if (preservationProfile) {
    const preservationHead = git(spawnSyncFn, repoRoot, ['rev-parse', 'HEAD']);
    if (!preservationHead.ok) {
      return Object.freeze({
        ok: false,
        status: 'FAILED',
        verdict: 'FAIL',
        blocker: 'PRESERVATION_SOURCE_HEAD_READ_FAILED',
        beforeHead: beforeHead.stdout,
        preservationHead,
        statusBefore: statusBefore.stdout,
        fileMovePerformed: false,
        destructiveCleanupPerformed: false,
      });
    }
    if (preservationHead.stdout !== beforeHead.stdout) {
      return Object.freeze({
        ok: false,
        status: 'BLOCKED',
        verdict: 'FAIL',
        blocker: 'PRESERVATION_SOURCE_HEAD_CHANGED',
        beforeHead: beforeHead.stdout,
        preservationHead: preservationHead.stdout,
        statusBefore: statusBefore.stdout,
        fileMovePerformed: false,
        destructiveCleanupPerformed: false,
        nextOperatorAction: 'Retry only after the canonical checkout is stable; no runtime-data files were moved.',
      });
    }
    preservation = preserveBattleBridgeDirtyData({
      repoRoot,
      workspaceRoot,
      expectedRepoRoot: expectedPreservationPaths.repoRoot,
      expectedWorkspaceRoot: expectedPreservationPaths.workspaceRoot,
      profile: preservationProfile,
      operatorApproval: preservationApproval,
      statusLines: String(statusBefore.stdout).split(/\r?\n/).filter(Boolean),
      sourceHead: preservationHead.stdout,
      now: nowFn(),
    });
    if (!preservation.ok) return Object.freeze({ ...preservation, beforeHead: beforeHead.stdout, statusBefore: statusBefore.stdout });
    statusBeforeSync = git(spawnSyncFn, repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
    if (!statusBeforeSync.ok) {
      return Object.freeze({ ok: false, status: 'FAILED', verdict: 'FAIL', blocker: 'POST_PRESERVATION_STATUS_READ_FAILED', preservation });
    }
    const postPreservationDirt = classifyDirt(String(statusBeforeSync.stdout).split(/\r?\n/).filter(Boolean));
    if (postPreservationDirt.blocksSync || postPreservationDirt.generatedSource.length) {
      return Object.freeze({
        ok: false,
        status: 'BLOCKED',
        verdict: 'FAIL',
        blocker: 'POST_PRESERVATION_DIRT_BLOCKED',
        preservation,
        postPreservationDirt,
        statusBeforeSync: statusBeforeSync.stdout,
      });
    }
  }

  let fastForward = null;
  if (counts.behind > 0) {
    fastForward = git(spawnSyncFn, repoRoot, ['merge', '--ff-only', approvedTargetHead], 120000);
    if (!fastForward.ok) {
      return Object.freeze({
        ok: false,
        status: 'BLOCKED',
        verdict: 'FAIL',
        blocker: 'FAST_FORWARD_FAILED',
        beforeHead: beforeHead.stdout,
        remoteHead: remoteHead.stdout,
        ahead: counts.ahead,
        behind: counts.behind,
        statusBefore: statusBefore.stdout,
        fastForward,
        nextOperatorAction: 'Inspect the exact Git blocker. Existing work was not cleaned, stashed, reset, or discarded.',
      });
    }
  }

  const afterHead = git(spawnSyncFn, repoRoot, ['rev-parse', 'HEAD']);
  const statusAfter = git(spawnSyncFn, repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  const diffNames = beforeHead.stdout === afterHead.stdout
    ? Object.freeze({ ok: true, stdout: '', command: 'git', args: [] })
    : git(spawnSyncFn, repoRoot, ['diff', '--name-only', `${beforeHead.stdout}..${afterHead.stdout}`]);
  const filesChanged = diffNames.ok ? changedFiles(diffNames.stdout) : [];
  const tests = capture(spawnSyncFn, nodeCommand, CODEX_DISPATCH_TEST_ARGS, {
    cwd: repoRoot,
    timeout: 180000,
    captureTapSummary: true,
  });
  const restartRequired = filesChanged.some((path) => [
    'scripts/stephanos-codex-dispatch-mcp.mjs',
    'shared/agents/battleBridgeDirtyDataPreservationV1.mjs',
    'shared/agents/codexDispatchHostOps.mjs',
    'shared/agents/stephanosChatUpdate.mjs',
  ].includes(path));
  const passed = afterHead.ok
    && afterHead.stdout === approvedTargetHead
    && statusAfter.ok
    && diffNames.ok
    && tests.ok;
  const blocker = passed ? '' : classifyCompletedSyncBlocker({
    afterHead,
    approvedTargetHead,
    statusAfter,
    diffNames,
    tests,
  });

  return Object.freeze({
    ok: passed,
    status: passed ? 'DONE' : 'FAILED',
    verdict: passed ? 'PASS' : 'FAIL',
    blocker,
    repoRoot,
    branch: branch.stdout,
    approvalScope: 'latest-canonical-origin-main-observed-after-fetch',
    approvedTargetHead,
    beforeHead: beforeHead.stdout,
    remoteHead: remoteHead.stdout,
    afterHead: afterHead.stdout,
    aheadBeforeSync: counts.ahead,
    behindBeforeSync: counts.behind,
    updated: beforeHead.stdout !== afterHead.stdout,
    filesChanged,
    preExistingDirt: Boolean(statusBefore.stdout),
    statusBefore: statusBefore.stdout,
    statusBeforeSync: statusBeforeSync.stdout,
    statusAfter: statusAfter.stdout,
    fetchResult,
    fastForward,
    tests,
    preservation,
    restartRequired,
    publicExposureChanged: false,
    destructiveCleanupPerformed: false,
    nextOperatorAction: passed
      ? (restartRequired ? 'Restart the desktop app before expecting newly changed MCP tools or server behavior.' : 'Continue from chat. No PowerShell action is required.')
      : 'Inspect the returned bounded Git or test failure. Do not discard local work.',
  });
}

async function probeEndpoint(url, { fetchFn = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchFn(url, { method: 'GET', signal: controller.signal });
    const body = bounded(await response.text(), 2500);
    return Object.freeze({ url, ok: response.ok, status: response.status, body, error: '' });
  } catch (error) {
    return Object.freeze({ url, ok: false, status: null, body: '', error: error?.message || String(error) });
  } finally {
    clearTimeout(timer);
  }
}

export async function runBattleBridgeDiagnostics({
  repoRoot = DEFAULT_CODEX_DISPATCH_REPO_ROOT,
  endpoints = DEFAULT_BATTLE_BRIDGE_ENDPOINTS,
  spawnSyncFn = spawnSync,
  fetchFn = globalThis.fetch,
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  workspaceRoot = '',
  nowFn = () => new Date(),
  workerInspection = null,
  workerInspector = readCanonicalBattleBridgeWorkerObservation,
  readRecord = readBoundedJson,
} = {}) {
  const commands = Object.freeze({
    repositoryTopLevel: git(spawnSyncFn, repoRoot, ['rev-parse', '--show-toplevel']),
    currentBranch: git(spawnSyncFn, repoRoot, ['branch', '--show-current']),
    fullHead: git(spawnSyncFn, repoRoot, ['rev-parse', 'HEAD']),
    configuredUpstream: git(spawnSyncFn, repoRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
    completeGitStatus: git(spawnSyncFn, repoRoot, ['status', '--branch', '--untracked-files=all']),
  });
  const aheadBehind = commands.configuredUpstream.ok
    ? git(spawnSyncFn, repoRoot, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
    : Object.freeze({ ok: false, status: null, stdout: '', stderr: '', error: 'UPSTREAM_UNAVAILABLE' });
  const health = await Promise.all(endpoints.map((url) => probeEndpoint(url, { fetchFn })));
  const gitPassed = Object.values(commands).every((result) => result.ok) && aheadBehind.ok;
  const healthPassed = health.every((result) => result.ok);
  const counts = aheadBehind.ok ? parseAheadBehind(aheadBehind.stdout) : { ahead: null, behind: null };
  const inspection = workerInspection
    ? (workerInspection.observation
      ? workerInspection
      : Object.freeze({ ok: true, blocker: '', observation: workerInspection }))
    : workerInspector({ repoRoot, platform, spawnSyncFn });
  const workerTelemetry = collectBattleBridgeWorkerTelemetry({
    repoRoot,
    fullHead: commands.fullHead.stdout,
    nowUtc: nowFn().toISOString(),
    env,
    home,
    workspaceRoot,
    workerInspection: inspection,
    readRecord,
  });
  const forgeShadowM2DigestResolution = resolveForgeShadowM2DigestOnBattleBridge({
    repoRoot,
    platform,
    env,
    spawnSyncFn,
  });
  const passed = gitPassed && healthPassed && workerTelemetry.ok;
  const blocker = !gitPassed
    ? 'GIT_DIAGNOSTICS_FAILED'
    : !healthPassed
      ? 'BATTLE_BRIDGE_ENDPOINT_HEALTH_FAILED'
      : workerTelemetry.blockers[0] || 'WORKER_TELEMETRY_NOT_PROVEN';

  return Object.freeze({
    ok: passed,
    status: passed ? 'DONE' : (gitPassed && healthPassed ? 'BLOCKED' : 'FAILED'),
    verdict: passed ? 'PASS' : 'FAIL',
    blocker: passed ? '' : blocker,
    repoRoot,
    repositoryTopLevel: commands.repositoryTopLevel.stdout,
    currentBranch: commands.currentBranch.stdout,
    fullHead: commands.fullHead.stdout,
    configuredUpstream: commands.configuredUpstream.stdout,
    ahead: counts.ahead,
    behind: counts.behind,
    completeGitStatus: commands.completeGitStatus.stdout,
    commands,
    aheadBehind,
    health,
    workerTelemetry,
    worker: workerTelemetry.worker,
    task: workerTelemetry.task,
    lease: workerTelemetry.lease,
    latestExecutionReceipt: workerTelemetry.latestExecutionReceipt,
    testsChecksReview: workerTelemetry.testsChecksReview,
    operatorActionRequired: workerTelemetry.operatorActionRequired,
    forgeShadowM2DigestResolution,
    safety: {
      sourceMutationDetected: false,
      generatedRuntimeMutationDetected: false,
      mergePerformed: false,
      pushPerformed: false,
      processControlPerformed: false,
      publicExposureChanged: false,
    },
    execution: {
      directDeterministicHostProof: true,
      codexChildUsed: false,
      shellPolicyDependency: false,
    },
    nextOperatorAction: passed
      ? 'Use the verified worker, heartbeat, lease, receipt, Git, and endpoint facts directly. No repair or mutation was attempted.'
      : (gitPassed && healthPassed
        ? workerTelemetry.nextAction
        : 'Inspect the exact failed Git or endpoint result. No repair or mutation was attempted.'),
  });
}
