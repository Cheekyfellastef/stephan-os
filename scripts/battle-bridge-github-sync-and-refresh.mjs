#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolveBattleBridgeGitExecution, battleBridgeCanonicalRepositoryArgs }
  from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { IGNITION_SETTLED_REFRESH_SCHEMA_V1, projectIgnitionSettledRefreshEvidenceV1, projectIgnitionInertEvidenceV1, projectIgnitionOwnerResultV1 }
  from '../shared/agents/postSyncRuntimeRefreshCoordinator.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { projectSovereignCaretakerExecutionEvidence, reconcileBattleBridgeControlPlane } from '../shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs';
import { createSharedWorkspaceStatusRecord } from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import { collectPostSyncRefreshDebt, inspectPendingPostSyncRefreshDebt, inspectPostSyncRefreshCompletion, resolvePostSyncRefreshDebt } from './battle-bridge-github-sync-policy.mjs';

export const BATTLE_BRIDGE_SYNC_AND_REFRESH_SCHEMA = 'stephanos.battle-bridge-sync-and-refresh.v1';
export const BATTLE_BRIDGE_SYNC_AND_REFRESH_RESULT_MARKER = 'BATTLE_BRIDGE_SYNC_AND_REFRESH_RESULT=';
export const MAX_SYNC_REFRESH_CYCLES = 3;
// Execution task remains five minutes. Leave 120 seconds for fixed host cleanup,
// in-process checks and the final durable status write; never let child waits
// consume the whole Windows Scheduled Task window.
export const SYNC_AND_REFRESH_CHILD_BUDGET_MS = 180_000;
export const SYNC_AND_REFRESH_MIN_REMAINING_MS = 5_000;
export const SYNC_AND_REFRESH_CHILD_TIMEOUTS_MS = Object.freeze({ sync: 60_000, refresh: 150_000, mailbox: 30_000 });
export const SYNC_CONTENTION_WAIT_MS = 30_000;
export const SYNC_CONTENTION_POLL_MS = 1_000;
const MAX_SYNC_CONTENTION_POLLS = SYNC_CONTENTION_WAIT_MS / SYNC_CONTENTION_POLL_MS;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SAFE_SYNC_FAILURE_REASONS = new Set(['SYNC_ALREADY_RUNNING', 'LOCK_ACQUISITION_FAILED',
  'NON_CANONICAL_REPOSITORY_PATH', 'NON_CANONICAL_WORKSPACE_PATH', 'REPOSITORY_WORKSPACE_OVERLAP']);

function text(value) {
  return String(value ?? '').trim();
}

function safeHead(value) {
  const normalized = text(value).toLowerCase();
  return SHA_PATTERN.test(normalized) ? normalized : '';
}

export function resolveCanonicalSyncAndRefreshPaths({ env = process.env, home = os.homedir() } = {}) {
  const userHome = path.resolve(env.USERPROFILE || env.HOME || home);
  const repoRoot = path.resolve(userHome, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.resolve(userHome, 'Documents', 'Stephanos-openclaw-workspace');
  return Object.freeze({
    repoRoot,
    workspaceRoot,
    syncExecutor: path.resolve(repoRoot, 'scripts', 'battle-bridge-github-sync-executor.mjs'),
    refreshCoordinator: path.resolve(repoRoot, 'scripts', 'battle-bridge-post-sync-refresh.mjs'),
    mailboxRunner: path.resolve(repoRoot, 'scripts', 'battle-bridge-github-command-mailbox-outbox-guard-v1.mjs'),
    syncStatusPath: path.resolve(workspaceRoot, 'status', 'battle-bridge-github-sync-current.json'),
    syncAndRefreshStatusPath: path.resolve(workspaceRoot, 'status', 'battle-bridge-sync-and-refresh-current.json'),
  });
}

function boundedChildTimeoutMs(requested, ceiling) {
  return Number.isSafeInteger(requested) && requested > 0
    ? Math.min(requested, ceiling) : 0;
}

function fixedNodeRun(scriptPath, args, {
  cwd,
  spawnSyncFn = spawnSync,
  timeout = 600_000,
  env = process.env,
} = {}) {
  const result = spawnSyncFn(process.execPath, [scriptPath, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  return Object.freeze({
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    stdout: String(result?.stdout ?? ''),
    stderr: String(result?.stderr ?? '').slice(0, 1000),
    errorCode: result?.error?.code || '',
  });
}

function boundedText(value, limit = 160) {
  const normalized = String(value ?? '').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function boundedStatusCode(value, limit = 180) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized && normalized.length <= limit && /^[A-Z0-9_:-]+$/.test(normalized) ? normalized : '';
}

function syncFailureReason(result) {
  const reason = result?.evaluation?.exactNextAction;
  return SAFE_SYNC_FAILURE_REASONS.has(reason) ? reason : '';
}

function isNonOwnerSyncContention(result) {
  // This is the executor's refusal before source inspection or mutation. An
  // unknown/partial execution is never retried, and the original lock owner
  // remains authoritative. Every retry must acquire admission in the executor.
  return result?.ok === false
    && Object.keys(result).every(key => ['ok', 'evaluation', 'lock', 'publication'].includes(key))
    && result.publication === null
    && result.evaluation?.classification === 'BLOCKED_INSTALL_OR_PERMISSION_REQUIRED'
    && result.evaluation.exactNextAction === 'SYNC_ALREADY_RUNNING'
    && result.evaluation.performsGitMutation === false
    && result.evaluation.performsShellExecution === false
    && result.lock?.ok === false
    && result.lock.reason === 'SYNC_ALREADY_RUNNING';
}

export function projectSyncAndRefreshStatus(result = {}, { observedAtUtc = new Date().toISOString() } = {}) {
  const mailboxPulse = result?.mailboxPulse && typeof result.mailboxPulse === 'object'
    ? result.mailboxPulse
    : null;
  const ok = result?.ok === true;
  const blocker = boundedText(result?.blocker);
  const finalVerdict = boundedText(result?.finalVerdict, 120);
  const refreshResult = Array.isArray(result?.refreshes) ? result.refreshes.at(-1)?.result : null;
  const sovereignCaretakerExecution = safeHead(result?.sourceHead) ? projectSovereignCaretakerExecutionEvidence(
    result?.controlPlaneRepair?.repair?.sovereignCaretakerExecution || refreshResult?.sovereignCaretakerExecution,
    safeHead(result?.sourceHead),
  ) : null;
  return Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: 'battle-bridge-sync-and-refresh-current',
      participantId: 'battle-bridge-sync-and-refresh',
      timestampUtc: observedAtUtc,
      status: ok ? 'READY' : 'BLOCKED',
      summary: ok
        ? 'Battle Bridge sync and refresh is ready.'
        : `Battle Bridge sync and refresh is blocked: ${blocker || finalVerdict || 'UNKNOWN'}.`,
      proofRefs: [],
    }),
    schema: 'stephanos.battle-bridge-sync-and-refresh-status.v1',
    observedAtUtc,
    sourceHead: safeHead(result?.sourceHead),
    syncBlockerReason: SAFE_SYNC_FAILURE_REASONS.has(result?.syncBlockerReason) ? result.syncBlockerReason : '',
    ok,
    blocker,
    finalVerdict,
    capacityObservationObserved: result?.capacityObservationObserved === true,
    capacityObservation: result?.capacityObservation ? Object.freeze({
      ok: result.capacityObservation.ok === true,
      sourceHead: safeHead(result.capacityObservation.sourceHead),
      blocker: boundedStatusCode(result.capacityObservation.blocker),
      workerObservationProven: result.capacityObservation.workerObservationProven === true,
      capacityObservationProven: result.capacityObservation.capacityObservationProven === true,
      capacityAvailable: result.capacityObservation.lifeboatCapacity?.available === true,
      reportedWorkerVerdict: boundedStatusCode(result.capacityObservation.reportedWorkerVerdict),
      executionMetadataState: result.capacityObservation.executionMetadataState === 'REPORTED' ? 'REPORTED' : 'UNREPORTED',
      idleProven: false, physicalExclusionGranted: false, workAuthorized: false,
      admissionAttempted: false, sourceBuildAttempted: false,
    }) : null,
    mailboxPulseObserved: result?.mailboxPulseObserved === true,
    mailboxPulse: mailboxPulse ? Object.freeze({
      ok: mailboxPulse?.ok === true,
      classification: boundedText(mailboxPulse?.classification, 120),
      blocker: boundedText(mailboxPulse?.blocker, 180),
      detailCode: boundedStatusCode(mailboxPulse?.detailCode),
      finalVerdict: boundedText(mailboxPulse?.finalVerdict, 120),
      pulseAttempted: mailboxPulse?.pulseAttempted === true,
    }) : null,
    controlPlaneRepair: Object.freeze({
      ok: result?.controlPlaneRepair?.ok === true,
      classification: boundedText(result?.controlPlaneRepair?.classification, 120),
      blocker: boundedText(result?.controlPlaneRepair?.blocker, 180),
      repairAttempted: result?.controlPlaneRepair?.repairAttempted === true,
      sovereignCaretakerExecution,
    }),
    lastSovereignCaretakerFailure: safeHead(result?.sourceHead) ? projectSovereignCaretakerExecutionEvidence(
      refreshResult?.lastSovereignCaretakerFailure, safeHead(result?.sourceHead),
    ) : null,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    destructiveGitAllowed: false,
  });
}

export async function writeSyncAndRefreshStatus(result = {}, {
  paths = resolveCanonicalSyncAndRefreshPaths(),
  now = () => new Date(),
} = {}) {
  const statusPath = path.resolve(paths.syncAndRefreshStatusPath || path.resolve(paths.workspaceRoot, 'status', 'battle-bridge-sync-and-refresh-current.json'));
  const expectedRoot = path.resolve(paths.workspaceRoot, 'status');
  if (path.dirname(statusPath).toLowerCase() !== expectedRoot.toLowerCase()) {
    throw new Error('SYNC_AND_REFRESH_STATUS_PATH_INVALID');
  }
  await mkdir(path.dirname(statusPath), { recursive: true });
  const record = projectSyncAndRefreshStatus(result, { observedAtUtc: now().toISOString() });
  await writeFile(statusPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(text(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseMarkedJson(stdout, marker) {
  const lines = String(stdout ?? '').split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith(marker)) continue;
    return parseJsonObject(lines[index].slice(marker.length));
  }
  return null;
}

export function createFixedSyncAndRefreshAdapter({ spawnSyncFn = spawnSync } = {}) {
  // One execution/config/environment boundary serves HEAD and ancestry. The
  // validated wrapper binds the first repository; a different root cannot reuse
  // this adapter's observations or remaining ancestry allowance.
  const git = resolveBattleBridgeGitExecution({ platform: process.platform, environment: process.env });
  let repository = null;
  function repositoryArgs(repoRoot) {
    if (typeof repoRoot !== 'string' || !repoRoot || /[\0\r\n]/.test(repoRoot)) return null;
    const root = path.resolve(repoRoot);
    if (repository && repository.root !== root) return null;
    if (!repository) repository = Object.freeze({ root, args: battleBridgeCanonicalRepositoryArgs(root) });
    return repository.args;
  }
  let ancestryBudgetMs = 5_000;
  return Object.freeze({
    observeCurrentHead(repoRoot, { timeoutMs = 1000 } = {}) {
      const timeout = Number.isFinite(timeoutMs) ? Math.min(1000, Math.floor(timeoutMs)) : 0;
      if (timeout <= 0) return { ok: false, head: '' };
      const args = repositoryArgs(repoRoot);
      if (!args) return { ok: false, head: '' };
      const result = spawnSyncFn(git.executable, [...git.fixedConfigArgs, ...args,
        'rev-parse', '--verify', 'HEAD'], { cwd: repoRoot, shell: false, encoding: 'utf8', windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'], timeout, maxBuffer: 256, env: git.environment });
      const valid = result?.status === 0 && !result.error && !result.signal
        && typeof result.stdout === 'string' && /^[a-f0-9]{40}(?:\r?\n)?$/.test(result.stdout);
      return { ok: valid, head: valid ? result.stdout.trim() : '' };
    },
    isAncestor(beforeHead, afterHead, repoRoot, { timeoutMs = 1000 } = {}) {
      if (typeof beforeHead !== 'string' || typeof afterHead !== 'string' || !/^[0-9a-f]{40}$/.test(beforeHead)
        || !/^[0-9a-f]{40}$/.test(afterHead) || ancestryBudgetMs <= 0) return { ok: false, ancestor: false };
      const args = repositoryArgs(repoRoot);
      const timeout = Number.isFinite(timeoutMs) ? Math.min(1000, ancestryBudgetMs, Math.floor(timeoutMs)) : 0;
      if (!args || timeout <= 0) return { ok: false, ancestor: false };
      const started = Date.now();
      const result = spawnSyncFn(git.executable, [...git.fixedConfigArgs, ...args, 'merge-base', '--is-ancestor', beforeHead, afterHead], {
        cwd: repoRoot, encoding: 'utf8', shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout, maxBuffer: 64 * 1024, env: git.environment,
      });
      ancestryBudgetMs -= Math.max(1, Date.now() - started);
      return { ok: !result.error && !result.signal && [0, 1].includes(result.status), ancestor: result.status === 0 };
    },
    runSync(paths, { timeoutMs = SYNC_AND_REFRESH_CHILD_BUDGET_MS } = {}) {
      const timeout = boundedChildTimeoutMs(timeoutMs, SYNC_AND_REFRESH_CHILD_TIMEOUTS_MS.sync);
      if (!timeout) return { ok: false, blocker: 'SYNC_AND_REFRESH_CHILD_BUDGET_MISSING' };
      const execution = fixedNodeRun(paths.syncExecutor, [], { cwd: paths.repoRoot, spawnSyncFn, timeout });
      if (execution.errorCode === 'ETIMEDOUT') return { ok: false, blocker: 'SYNC_EXECUTOR_TIMEOUT', execution };
      const result = parseJsonObject(execution.stdout);
      if (!result) return { ok: false, blocker: 'SYNC_EXECUTOR_RESPONSE_INVALID', execution };
      return { ok: true, result, execution };
    },
    runMailboxPulse(paths, { timeoutMs = SYNC_AND_REFRESH_CHILD_BUDGET_MS } = {}) {
      const timeout = boundedChildTimeoutMs(timeoutMs, SYNC_AND_REFRESH_CHILD_TIMEOUTS_MS.mailbox);
      if (!timeout) return { ok: false, blocker: 'SYNC_AND_REFRESH_CHILD_BUDGET_MISSING' };
      const execution = fixedNodeRun(paths.mailboxRunner, [], { cwd: paths.repoRoot, spawnSyncFn, timeout });
      if (execution.errorCode === 'ETIMEDOUT') return { ok: false, blocker: 'MAILBOX_PULSE_TIMEOUT', execution };
      const result = parseJsonObject(execution.stdout);
      return Object.freeze({
        ok: execution.ok && result?.ok === true,
        blocker: result ? String(result.blocker || (execution.ok ? '' : 'MAILBOX_PULSE_FAILED')) : 'MAILBOX_PULSE_FAILED',
        result: result || null,
        execution,
      });
    },
    runRefresh({ beforeHead, afterHead, paths, timeoutMs = SYNC_AND_REFRESH_CHILD_BUDGET_MS }) {
      if (!safeHead(beforeHead) || !safeHead(afterHead) || beforeHead === afterHead) {
        return { ok: false, blocker: 'POST_SYNC_HEADS_INVALID' };
      }
      const timeout = boundedChildTimeoutMs(timeoutMs, SYNC_AND_REFRESH_CHILD_TIMEOUTS_MS.refresh);
      if (!timeout) return { ok: false, blocker: 'SYNC_AND_REFRESH_CHILD_BUDGET_MISSING' };
      const execution = fixedNodeRun(paths.refreshCoordinator, ['--before', beforeHead, '--after', afterHead], {
        cwd: paths.repoRoot,
        spawnSyncFn,
        timeout,
        env: { ...process.env, GIT_REDIRECT_STDERR: 'off' },
      });
      if (execution.errorCode === 'ETIMEDOUT') return { ok: false, blocker: 'POST_SYNC_REFRESH_TIMEOUT', execution };
      const result = parseMarkedJson(execution.stdout, 'POST_SYNC_REFRESH_RESULT=');
      if (!result) return { ok: false, blocker: 'POST_SYNC_REFRESH_RESPONSE_INVALID', execution };
      return { ok: true, result, execution };
    },
  });
}

export async function readPendingPostSyncRefresh(paths) {
  const records = {};
  for (const [key, filename] of [['syncRecord', 'battle-bridge-github-sync-current.json'], ['refreshRecord', 'post-sync-runtime-refresh-current.json']]) {
    try {
      const raw = await readFile(path.join(paths.workspaceRoot, 'status', filename), 'utf8');
      records[key] = raw.length <= 64 * 1024 ? JSON.parse(raw) : {};
    } catch (error) { records[key] = error?.code === 'ENOENT' ? null : {}; }
  }
  const inertRecords = projectIgnitionInertEvidenceV1(records);
  if (!inertRecords) return Object.freeze({ ok: false, blocker: 'PENDING_POST_SYNC_EVIDENCE_INVALID' });
  const evidence = collectPostSyncRefreshDebt(inertRecords);
  return evidence.ok && !evidence.spans.length && !evidence.completion ? null : Object.freeze({ ...evidence,
    ...(evidence.ok && evidence.completion ? { completionRecord: inertRecords.refreshRecord, syncStatusRecord: inertRecords.syncRecord } : {}),
  });
}

// Only actual published current-head records can establish settled adoption.
// Absence of refresh history is not a positive witness. The existing adapter's
// before/after HEAD barrier fences a concurrent main advance during re-read.
async function readSettledIgnitionRefreshEvidence({ paths, sourceHead, sync, pendingReader, adapter, remaining }) {
  try {
    const published = projectIgnitionInertEvidenceV1(sync, ['result', 'receipt', 'statusRecord']);
    if (!published || typeof adapter.observeCurrentHead !== 'function') return null;
    const before = adapter.observeCurrentHead(paths.repoRoot, { timeoutMs: remaining() });
    if (before?.ok !== true || before.head !== sourceHead) return null;
    const observed = projectIgnitionInertEvidenceV1(await pendingReader(paths));
    if (!observed || !observed.completionRecord || !observed.syncStatusRecord) return null;
    // Summaries from the reader are not authority. Re-derive from these exact
    // normalized canonical records before any debt/completion consumer runs.
    const evidence = collectPostSyncRefreshDebt({ syncRecord: observed.syncStatusRecord, refreshRecord: observed.completionRecord });
    if (!evidence.ok || !evidence.completion) return null;
    const syncKeys = ['schemaVersion', 'kind', 'statusId', 'classification', 'localHeadBefore', 'remoteHeadObserved', 'pendingRefresh'];
    if (syncKeys.some(key => published[key] !== observed.syncStatusRecord[key])) return null;
    const ancestry = [];
    const resolved = resolvePostSyncRefreshDebt({ ...evidence, currentHead: sourceHead, requireCurrentCoverage: true,
      isAncestor(beforeHead, afterHead) {
        const result = adapter.isAncestor?.(beforeHead, afterHead, paths.repoRoot, { timeoutMs: remaining() });
        if (result?.ok === true && typeof result.ancestor === 'boolean') ancestry.push({ beforeHead, afterHead, ancestor: result.ancestor });
        return result;
      } });
    if (!resolved.ok || resolved.debt !== null) return null;
    const after = adapter.observeCurrentHead(paths.repoRoot, { timeoutMs: remaining() });
    if (after?.ok !== true || after.head !== sourceHead) return null;
    return projectIgnitionSettledRefreshEvidenceV1({ schemaVersion: IGNITION_SETTLED_REFRESH_SCHEMA_V1, sourceHead,
      syncStatusRecord: observed.syncStatusRecord, refreshCompletionRecord: observed.completionRecord, ancestry }, sourceHead);
  } catch { return null; }
}

async function readInertPendingRefresh(paths, pendingReader) {
  const observed = await pendingReader(paths);
  if (observed === null) return null;
  return projectIgnitionInertEvidenceV1(observed)
    || Object.freeze({ ok: false, blocker: 'PENDING_POST_SYNC_EVIDENCE_INVALID' });
}

function inertOwnerChild(value, kind = 'sync') {
  return projectIgnitionOwnerResultV1(value, kind)
    || Object.freeze({ ok: false, blocker: 'SYNC_AND_REFRESH_OWNER_EVIDENCE_INVALID' });
}

function refreshHeadsFromSyncResult(result = {}) {
  const beforeHead = safeHead(result?.facts?.localHeadBefore || result?.facts?.localHead);
  const afterHead = safeHead(result?.facts?.localHeadAfter || result?.facts?.remoteHead);
  if (!beforeHead || !afterHead || beforeHead === afterHead) return null;
  const needsRefresh = result?.sourceUpdated === true
    || result?.evaluation?.classification === 'BLOCKED_POST_SYNC_REFRESH_REQUIRED';
  return needsRefresh ? Object.freeze({ beforeHead, afterHead }) : null;
}

function syncIsConverged(result = {}) {
  return result?.ok === true && result?.evaluation?.classification === 'SYNC_NO_CHANGE';
}

function syncHead(result = {}) {
  return safeHead(
    result?.facts?.localHeadAfter
    || result?.facts?.remoteHead
    || result?.facts?.localHead,
  );
}

async function runFreshGoalDiscoveryHeartbeat(sourceHead) {
  const heartbeatUrl = new URL('./battle-bridge-goal-discovery-heartbeat.mjs', import.meta.url);
  heartbeatUrl.searchParams.set('sourceHead', sourceHead);
  const heartbeatModule = await import(heartbeatUrl.href);
  if (typeof heartbeatModule.runBattleBridgeGoalDiscoveryHeartbeat !== 'function') {
    return Object.freeze({ ok: false, blocker: 'GOAL_DISCOVERY_HEARTBEAT_EXPORT_MISSING' });
  }
  return heartbeatModule.runBattleBridgeGoalDiscoveryHeartbeat();
}

async function runFreshCapacityObservation(sourceHead, options) {
  const heartbeatUrl = new URL('./battle-bridge-goal-discovery-heartbeat.mjs', import.meta.url);
  heartbeatUrl.searchParams.set('sourceHead', sourceHead);
  const heartbeatModule = await import(heartbeatUrl.href);
  if (typeof heartbeatModule.runBattleBridgeCapacityObservationHeartbeat !== 'function') {
    return Object.freeze({ ok: false, blocker: 'CAPACITY_OBSERVATION_EXPORT_MISSING', capacityObservationOnly: true });
  }
  return heartbeatModule.runBattleBridgeCapacityObservationHeartbeat(options);
}

function pulseConvergedMailbox({ paths, adapter, platform, timeoutMs }) {
  if (platform !== 'win32') {
    return Object.freeze({
      ok: true,
      classification: 'MAILBOX_PULSE_SKIPPED_NON_WINDOWS',
      pulseAttempted: false,
    });
  }
  if (typeof adapter?.runMailboxPulse !== 'function') {
    return Object.freeze({
      ok: true,
      classification: 'MAILBOX_PULSE_SKIPPED_ADAPTER_UNAVAILABLE',
      pulseAttempted: false,
    });
  }
  const pulse = adapter.runMailboxPulse(paths, { timeoutMs });
  if (pulse?.ok === true) {
    return Object.freeze({
      ok: true,
      classification: 'MAILBOX_PULSE_READY',
      pulseAttempted: true,
      blocker: '',
      finalVerdict: String(pulse?.result?.finalVerdict || ''),
    });
  }
  return Object.freeze({
    ok: false,
    classification: 'MAILBOX_PULSE_BLOCKED',
    pulseAttempted: true,
    blocker: String(pulse?.blocker || pulse?.result?.blocker || 'MAILBOX_PULSE_BLOCKED'),
    detailCode: boundedStatusCode(
      pulse?.result?.error
      || pulse?.result?.childBlocker
      || pulse?.result?.childMailboxBlocker
      || pulse?.result?.childIndexBlocker,
    ),
    finalVerdict: String(pulse?.result?.finalVerdict || ''),
  });
}

function reconcileConvergedControlPlane({ sourceHead, paths, controlPlaneReconciler, platform }) {
  if (platform !== 'win32') {
    return Object.freeze({
      ok: true,
      classification: 'CONTROL_PLANE_REPAIR_SKIPPED_NON_WINDOWS',
      repairAttempted: false,
      sourceHead,
    });
  }
  const repair = controlPlaneReconciler({
    repoRoot: paths.repoRoot,
    expectedHead: sourceHead,
    platform,
  });
  if (repair?.ok !== true) {
    return Object.freeze({
      ok: false,
      classification: 'CONTROL_PLANE_REPAIR_BLOCKED',
      repairAttempted: true,
      sourceHead,
      blocker: String(repair?.blocker || 'CONTROL_PLANE_REPAIR_BLOCKED'),
      repair: repair || null,
    });
  }
  return Object.freeze({
    ok: true,
    classification: 'CONTROL_PLANE_RECONCILED',
    repairAttempted: true,
    sourceHead,
    repair,
  });
}

export async function runBattleBridgeSyncAndRefresh({
  env = process.env,
  paths = resolveCanonicalSyncAndRefreshPaths({ env }),
  expectedPaths = resolveCanonicalSyncAndRefreshPaths({ env }),
  adapter = createFixedSyncAndRefreshAdapter(),
  pendingReader = readPendingPostSyncRefresh,
  controlPlaneReconciler = reconcileBattleBridgeControlPlane,
  goalDiscoveryHeartbeat = null,
  capacityObservationHeartbeat = null,
  platform = process.platform,
  maxCycles = MAX_SYNC_REFRESH_CYCLES,
  nowMs = () => performance.now(),
  sleepFn = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (path.resolve(paths.repoRoot) !== path.resolve(expectedPaths.repoRoot)
    || path.resolve(paths.workspaceRoot) !== path.resolve(expectedPaths.workspaceRoot)) {
    return Object.freeze({ ok: false, blocker: 'SYNC_AND_REFRESH_NON_CANONICAL_PATH', finalVerdict: 'SYNC_AND_REFRESH_BLOCKED' });
  }

  const refreshes = [];
  let capacityObservation = null;
  let capacityObservationAttempted = false;
  const capacityResult = () => ({ capacityObservation,
    capacityObservationObserved: capacityObservationAttempted });
  const start = nowMs();
  if (!Number.isFinite(start)) {
    return Object.freeze({ ok: false, blocker: 'SYNC_AND_REFRESH_CLOCK_INVALID', finalVerdict: 'SYNC_AND_REFRESH_BLOCKED' });
  }
  const deadline = start + SYNC_AND_REFRESH_CHILD_BUDGET_MS;
  const remaining = () => {
    const observed = nowMs();
    return Number.isFinite(observed)
      ? Math.max(0, Math.floor(deadline - observed)) : 0;
  };
  const budgetHeld = (phase, sourceHead = '') => Object.freeze({
    ...capacityResult(),
    ok: false,
    blocker: 'SYNC_AND_REFRESH_PARENT_BUDGET_EXHAUSTED',
    budgetPhase: phase,
    sourceHead: safeHead(sourceHead),
    refreshes: Object.freeze([...refreshes]),
    finalVerdict: 'SYNC_AND_REFRESH_BLOCKED',
  });
  const safeRemaining = () => remaining() - SYNC_AND_REFRESH_MIN_REMAINING_MS;
  const pending = await readInertPendingRefresh(paths, pendingReader);
  const pendingInvalid = pending?.ok === false ? pending : null;
  let pendingSpans = pending?.ok === true ? pending.spans || [{ beforeHead: pending.beforeHead, afterHead: pending.afterHead }] : [];
  let requiredTargetIds = pending?.requiredTargetIds || [];
  let sovereignRelayRefreshRequired = pending?.ok === true ? pending.sovereignRelayRefreshRequired : false;
  let governorRefreshRequired = pending?.ok === true && pending.governorRefreshRequired === true;
  let spatialAdoptionRequired = pending?.ok === true && pending.spatialAdoptionRequired === true;
  let completion = pending?.completion || null;
  let pendingRefreshObserved = pendingSpans.length > 0;
  let sourceForwardedBeforeRefresh = false;
  let refreshDebtCoalesced = false;
  let contentionStartedAt = null;
  let contentionPolls = 0;

  for (let cycle = 0; cycle < maxCycles; cycle += 1) {
    if (safeRemaining() <= 0) return budgetHeld('SYNC');
    let sync = inertOwnerChild(adapter.runSync(paths, { timeoutMs: safeRemaining() }));
    while (sync?.ok === true
      && (!sync.execution || (sync.execution.status === 2 && sync.execution.errorCode === ''))
      && isNonOwnerSyncContention(sync.result)) {
      const observedAt = nowMs();
      if (contentionStartedAt === null) contentionStartedAt = observedAt;
      const contentionRemaining = Number.isFinite(observedAt) && Number.isFinite(contentionStartedAt)
        ? SYNC_CONTENTION_WAIT_MS - Math.max(0, observedAt - contentionStartedAt) : 0;
      const waitMs = Math.min(SYNC_CONTENTION_POLL_MS, contentionRemaining, safeRemaining());
      if (waitMs <= 0 || contentionPolls >= MAX_SYNC_CONTENTION_POLLS) {
        return Object.freeze({ ...capacityResult(), ok: false, blocker: 'SYNC_ALREADY_RUNNING',
          syncBlockerReason: 'SYNC_ALREADY_RUNNING',
          syncClassification: sync.result.evaluation.classification,
          pendingRefreshObserved, refreshes: Object.freeze([...refreshes]),
          finalVerdict: 'SYNC_AND_REFRESH_BLOCKED' });
      }
      contentionPolls += 1;
      await sleepFn(waitMs);
      if (safeRemaining() <= 0) {
        return Object.freeze({ ...budgetHeld('SYNC_CONTENTION'), syncBlockerReason: 'SYNC_ALREADY_RUNNING' });
      }
      // Do not infer admission or success from another owner's status or from
      // a disappearing lock. Re-enter the fixed executor under its own lock.
      sync = inertOwnerChild(adapter.runSync(paths, { timeoutMs: safeRemaining() }));
    }
    if (!sync.ok) {
      return Object.freeze({ ok: false, blocker: sync.blocker, syncBlockerReason: '', refreshes: Object.freeze(refreshes), finalVerdict: 'SYNC_AND_REFRESH_BLOCKED' });
    }

    if (safeRemaining() <= 0) return budgetHeld('POST_SYNC', syncHead(sync.result));
    const converged = syncIsConverged(sync.result);
    const currentHeads = refreshHeadsFromSyncResult(sync.result);
    const currentSourceHead = syncHead(sync.result);
    // Model/resource observation cannot pay runtime debt or authorize work.
    // Only an authenticated converged source child reaches this closed stage;
    // its own exact-head/launch checks and the producer's governor still apply.
    if (converged && currentSourceHead && !capacityObservationAttempted) {
      if (safeRemaining() <= 0) return budgetHeld('CAPACITY_OBSERVATION', currentSourceHead);
      capacityObservationAttempted = true;
      const observationOptions = { expectedSourceHead: currentSourceHead,
        budgetMs: Math.min(30_000, safeRemaining()), paths };
      try {
        capacityObservation = typeof capacityObservationHeartbeat === 'function'
          ? await capacityObservationHeartbeat(observationOptions)
          : await runFreshCapacityObservation(currentSourceHead, observationOptions);
      } catch {
        capacityObservation = { ok: false, blocker: 'CAPACITY_OBSERVATION_EXCEPTION', capacityObservationOnly: true };
      }
      if (safeRemaining() <= 0) return budgetHeld('POST_CAPACITY_OBSERVATION', currentSourceHead);
    }
    // A different invocation may have advanced source after our initial read.
    // Include the debt actually retained by this sync child under its lock.
    const freshDebt = inspectPendingPostSyncRefreshDebt(sync.result?.facts?.pendingRefresh);
    if (freshDebt.ok) {
      pendingSpans = [...new Map([...pendingSpans, ...freshDebt.spans].map(span => [`${span.beforeHead}:${span.afterHead}`, span])).values()];
      requiredTargetIds = [...new Set([...requiredTargetIds, ...freshDebt.requiredTargetIds])];
      if (freshDebt.sovereignRelayRefreshRequired) sovereignRelayRefreshRequired = true;
      if (freshDebt.governorRefreshRequired) governorRefreshRequired = true;
      if (freshDebt.spatialAdoptionRequired) spatialAdoptionRequired = true;
      pendingRefreshObserved ||= freshDebt.spans.length > 0;
    }

    if (!converged && !currentHeads) {
      return Object.freeze({
        ok: false,
        blocker: sync.result?.evaluation?.classification || 'SYNC_NOT_CONVERGED',
        sourceHead: currentSourceHead,
        syncClassification: sync.result?.evaluation?.classification || '',
        syncBlockerReason: syncFailureReason(sync.result),
        refreshes: Object.freeze(refreshes),
        sourceForwardedBeforeRefresh,
        refreshDebtCoalesced,
        finalVerdict: 'SYNC_AND_REFRESH_BLOCKED',
      });
    }

    if (pendingInvalid || !freshDebt.ok) {
      sourceForwardedBeforeRefresh = sync.result?.sourceUpdated === true;
      return Object.freeze({
        ...capacityResult(),
        ok: false,
        blocker: pendingInvalid?.blocker || freshDebt.blocker,
        sourceHead: currentSourceHead,
        syncClassification: sync.result?.evaluation?.classification || '',
        refreshes: Object.freeze(refreshes),
        pendingRefreshObserved: true,
        sourceForwardedBeforeRefresh,
        refreshDebtCoalesced: false,
        finalVerdict: 'SYNC_AND_REFRESH_REFRESH_DEBT_BLOCKED',
      });
    }

    const pendingAfterHead = pendingSpans.at(-1)?.afterHead || '';
    const resolved = resolvePostSyncRefreshDebt({
      spans: pendingSpans, requestedSpans: currentHeads ? [currentHeads] : [], requiredTargetIds, completion, sovereignRelayRefreshRequired, governorRefreshRequired,
      spatialAdoptionRequired,
      currentHead: currentSourceHead,
      isAncestor: (beforeHead, afterHead) => adapter.isAncestor?.(beforeHead, afterHead, paths.repoRoot, { timeoutMs: safeRemaining() }),
    });
    if (!resolved.ok) return Object.freeze({
      ...capacityResult(),
      ok: false, blocker: resolved.blocker, sourceHead: currentSourceHead,
      syncClassification: sync.result?.evaluation?.classification || '', refreshes: Object.freeze(refreshes),
      pendingRefreshObserved, sourceForwardedBeforeRefresh: sync.result?.sourceUpdated === true,
      refreshDebtCoalesced, finalVerdict: 'SYNC_AND_REFRESH_REFRESH_DEBT_BLOCKED',
    });
    const refreshHeads = resolved.debt ? Object.freeze({ beforeHead: resolved.debt.beforeHead, afterHead: currentSourceHead }) : null;
    if (refreshHeads && pendingAfterHead) {
      refreshDebtCoalesced ||= pendingAfterHead !== currentSourceHead;
      sourceForwardedBeforeRefresh ||= sync.result?.sourceUpdated === true;
    }

    if (refreshHeads) {
      if (safeRemaining() <= 0) return budgetHeld('REFRESH', currentSourceHead);
      const refresh = inertOwnerChild(adapter.runRefresh({ ...refreshHeads, paths, timeoutMs: safeRemaining() }), 'refresh');
      refreshes.push(Object.freeze({
        ...refreshHeads,
        pendingAfterHead,
        debtCoalesced: Boolean(pendingAfterHead && pendingAfterHead !== refreshHeads.afterHead),
        result: refresh.result || null,
      }));
      if (!refresh.ok || refresh.result?.ok !== true) {
        const refreshBlocker = refresh.result?.blocker || refresh.blocker || 'POST_SYNC_RUNTIME_REFRESH_BLOCKED';
        // A concurrent generic completion/disappearance cannot pay an earlier
        // Spatial obligation. No Spatial verifier exists in this wrapper, so
        // keep the original debt instead of entering its legacy settlement path.
        if (refreshBlocker === 'POST_SYNC_REFRESH_ALREADY_RUNNING' && resolved.debt.spatialAdoptionRequired !== true) {
          let settled = false;
          while (safeRemaining() > 1_000) {
            await sleepFn(Math.min(1_000, safeRemaining()));
            const observedPending = await readInertPendingRefresh(paths, pendingReader);
            if (!observedPending) {
              settled = true;
              break;
            }
            if (observedPending?.ok === false) {
              return Object.freeze({
                ...capacityResult(),
                ok: false,
                blocker: observedPending.blocker || 'PENDING_POST_SYNC_REFRESH_INVALID',
                sourceHead: currentSourceHead,
                syncClassification: sync.result?.evaluation?.classification || '',
                refreshes: Object.freeze(refreshes),
                pendingRefreshObserved: true,
                sourceForwardedBeforeRefresh,
                refreshDebtCoalesced,
                finalVerdict: 'SYNC_AND_REFRESH_REFRESH_DEBT_BLOCKED',
              });
            }
            if (observedPending.spatialAdoptionRequired === true) {
              // Another invocation can first discover Spatial debt while this
              // one waits. Keep it monotonic; later disappearance is not proof.
              spatialAdoptionRequired = true;
              break;
            }
            const observedSpans = Array.isArray(observedPending?.spans)
              ? observedPending.spans
              : (observedPending?.beforeHead && observedPending?.afterHead
                ? [{ beforeHead: observedPending.beforeHead, afterHead: observedPending.afterHead }]
                : []);
            if (observedSpans.length === 0 && observedPending?.completion) {
              settled = true;
              break;
            }
          }
          if (settled) {
            pendingSpans = [];
            requiredTargetIds = [];
            sovereignRelayRefreshRequired = false;
            governorRefreshRequired = false;
            spatialAdoptionRequired = false;
            completion = null;
            continue;
          }
        }
        return Object.freeze({
          ...capacityResult(),
          ok: false,
          blocker: refreshBlocker,
          sourceHead: currentSourceHead,
          syncClassification: sync.result?.evaluation?.classification || '',
          refreshes: Object.freeze(refreshes),
          pendingRefreshObserved,
          sourceForwardedBeforeRefresh,
          refreshDebtCoalesced,
          finalVerdict: 'SYNC_AND_REFRESH_BLOCKED',
        });
      }
      const completed = inspectPostSyncRefreshCompletion(refresh.result);
      const covered = completed.ok ? resolvePostSyncRefreshDebt({
        spans: [resolved.debt], requiredTargetIds: resolved.debt.requiredTargetIds, completion: completed,
        sovereignRelayRefreshRequired: resolved.debt.sovereignRelayRefreshRequired,
        governorRefreshRequired: resolved.debt.governorRefreshRequired,
        spatialAdoptionRequired: resolved.debt.spatialAdoptionRequired,
        currentHead: currentSourceHead,
        isAncestor: (beforeHead, afterHead) => adapter.isAncestor?.(beforeHead, afterHead, paths.repoRoot, { timeoutMs: safeRemaining() }),
      }) : completed;
      if (!covered.ok || covered.debt) return Object.freeze({
        ...capacityResult(),
        ok: false, blocker: covered.blocker || 'PENDING_POST_SYNC_COMPLETION_COVERAGE_UNPROVEN',
        sourceHead: currentSourceHead, refreshes: Object.freeze(refreshes),
        finalVerdict: 'SYNC_AND_REFRESH_REFRESH_DEBT_BLOCKED',
      });
      if (safeRemaining() <= 0) return budgetHeld('POST_REFRESH', currentSourceHead);
      pendingSpans = [];
      requiredTargetIds = [];
      sovereignRelayRefreshRequired = false;
      governorRefreshRequired = false;
      spatialAdoptionRequired = false;
      completion = completed;
      continue;
    }
    if (!converged) continue;

    if (converged) {
      const sourceHead = currentSourceHead;
      if (!sourceHead) {
        return Object.freeze({ ok: false, blocker: 'SYNC_CONVERGED_HEAD_UNPROVEN', refreshes: Object.freeze(refreshes), finalVerdict: 'SYNC_AND_REFRESH_BLOCKED' });
      }

      // Source-building lanes are independently bounded and must get one work-conserving
      // tick before auxiliary control-plane repair. A degraded recovery subsystem must not
      // starve Forge/GitHub lifeboat capacity or canonical Mission Worker handoffs.
      if (safeRemaining() <= 0) return budgetHeld('GOAL_DISCOVERY', sourceHead);
      const goalDiscovery = typeof goalDiscoveryHeartbeat === 'function'
        ? await goalDiscoveryHeartbeat()
        : await runFreshGoalDiscoveryHeartbeat(sourceHead);
      if (safeRemaining() <= 0) return budgetHeld('POST_GOAL_DISCOVERY', sourceHead);
      const mailboxPulse = pulseConvergedMailbox({ paths, adapter, platform, timeoutMs: safeRemaining() });
      if (safeRemaining() <= 0) return budgetHeld('POST_MAILBOX_PULSE', sourceHead);
      const controlPlaneRepair = reconcileConvergedControlPlane({
        sourceHead,
        paths,
        controlPlaneReconciler,
        platform,
      });

      if (safeRemaining() <= 0) return budgetHeld('POST_CONTROL_PLANE', sourceHead);
      if (goalDiscovery?.ok !== true) {
        return Object.freeze({
          ...capacityResult(),
          ok: false,
          blocker: String(goalDiscovery?.blocker || goalDiscovery?.finalVerdict || 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED'),
          sourceHead,
          syncClassification: sync.result.evaluation.classification,
          refreshes: Object.freeze(refreshes),
          sourceForwardedBeforeRefresh,
          refreshDebtCoalesced,
          controlPlaneRepair,
          mailboxPulse,
          mailboxPulseObserved: true,
          goalDiscovery: goalDiscovery || null,
          goalDiscoveryObserved: true,
          finalVerdict: 'SYNC_AND_REFRESH_GOAL_DISCOVERY_BLOCKED',
        });
      }

      if (!controlPlaneRepair.ok) {
        const settledRefreshEvidence = await readSettledIgnitionRefreshEvidence({ paths, sourceHead, sync,
          pendingReader, adapter, remaining: safeRemaining });
        if (safeRemaining() <= 0) return budgetHeld('POST_SETTLED_REFRESH_EVIDENCE', sourceHead);
        return Object.freeze({
          settledRefreshEvidence,
          ...capacityResult(),
          ok: false,
          blocker: controlPlaneRepair.blocker,
          sourceHead,
          syncClassification: sync.result.evaluation.classification,
          refreshes: Object.freeze(refreshes),
          sourceForwardedBeforeRefresh,
          refreshDebtCoalesced,
          controlPlaneRepair,
          mailboxPulse,
          mailboxPulseObserved: true,
          goalDiscovery,
          goalDiscoveryObserved: true,
          workConservingGoalDiscoveryPreserved: true,
          workConservingMailboxPulsePreserved: true,
          finalVerdict: 'SYNC_AND_REFRESH_CONTROL_PLANE_REPAIR_BLOCKED',
        });
      }

      return Object.freeze({
        ...capacityResult(),
        schemaVersion: BATTLE_BRIDGE_SYNC_AND_REFRESH_SCHEMA,
        ok: true,
        sourceHead,
        syncClassification: sync.result.evaluation.classification,
        refreshes: Object.freeze(refreshes),
        freshCoordinatorProcessUsed: refreshes.length > 0,
        pendingRefreshObserved,
        sourceForwardedBeforeRefresh,
        refreshDebtCoalesced,
        controlPlaneRepair,
        controlPlaneRepairObserved: true,
        mailboxPulse,
        mailboxPulseObserved: true,
        goalDiscovery,
        goalDiscoveryObserved: true,
        workConservingGoalDiscoveryPreserved: true,
        workConservingMailboxPulsePreserved: true,
        arbitraryShellAllowed: false,
        destructiveGitAllowed: false,
        liveOpenClawUpdateAllowed: false,
        finalVerdict: 'SYNC_AND_REFRESH_PASS',
      });
    }
  }

  return Object.freeze({
    ...capacityResult(),
    ok: false,
    blocker: 'SYNC_AND_REFRESH_CYCLE_LIMIT_EXCEEDED',
    refreshes: Object.freeze(refreshes),
    sourceForwardedBeforeRefresh,
    refreshDebtCoalesced,
    finalVerdict: 'SYNC_AND_REFRESH_BLOCKED',
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = resolveCanonicalSyncAndRefreshPaths();
  const result = await runBattleBridgeSyncAndRefresh({ paths, expectedPaths: paths });
  await writeSyncAndRefreshStatus(result, { paths });
  process.stdout.write(`${BATTLE_BRIDGE_SYNC_AND_REFRESH_RESULT_MARKER}${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
