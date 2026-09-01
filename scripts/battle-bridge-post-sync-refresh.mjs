#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  BATTLE_BRIDGE_CONTROL_PLANE_TASKS,
  reconcileBattleBridgeControlPlane,
} from '../shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs';
import {
  buildPostSyncRefreshProjection,
  classifyPostSyncRefresh,
  executePostSyncRefreshPlan,
  parseGitChangedPathStatus,
} from '../shared/agents/postSyncRuntimeRefreshCoordinator.mjs';
import {
  appendWorkspaceJsonl,
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceStatusRecord,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import { refreshStephanosUi4173 } from './refresh-stephanos-ui-4173.mjs';

export const POST_SYNC_REFRESH_RUNTIME_SCHEMA = 'stephanos.post-sync-runtime-refresh-runtime.v1';
export const POST_SYNC_REFRESH_RESULT_MARKER = 'POST_SYNC_REFRESH_RESULT=';
export const POST_SYNC_REFRESH_LOCK_STALE_AFTER_MS = 15 * 60 * 1000;
export const MISSION_WORKER_POST_SYNC_RESTART_BUDGET_MS = 90_000;
export const MISSION_WORKER_POST_SYNC_CHILD_EXIT_RESERVE_MS = 10_000;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const MAX_CHANGED_PATHS = 4000;
const CONTROL_PLANE_TASK_IDS = new Set(BATTLE_BRIDGE_CONTROL_PLANE_TASKS.map((task) => task.id));

function text(value) {
  return String(value ?? '').trim();
}

function splitLines(value) {
  return String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function isSafeHead(value) {
  return SHA_PATTERN.test(text(value));
}

export function projectControlPlaneFailureBlocker(reconcile = {}) {
  const blocker = text(reconcile?.blocker);
  if (!blocker) return '';
  const failedTaskId = text(reconcile?.failedTaskId);
  return CONTROL_PLANE_TASK_IDS.has(failedTaskId) ? `${blocker}:${failedTaskId}` : blocker;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function resolveCanonicalPostSyncRefreshPaths({ env = process.env, home = os.homedir() } = {}) {
  const userHome = path.resolve(env.USERPROFILE || env.HOME || home);
  const repoRoot = path.resolve(userHome, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.resolve(userHome, 'Documents', 'Stephanos-openclaw-workspace');
  return Object.freeze({
    repoRoot,
    workspaceRoot,
    restartScript: path.resolve(repoRoot, 'scripts', 'windows', 'restart-approved-stephanos-runtime.ps1'),
    receiptRelative: '',
  });
}

function fixedRun(command, args, { cwd, timeout = 180_000, spawnSyncFn = spawnSync } = {}) {
  const result = spawnSyncFn(command, [...args], {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  });
  return Object.freeze({
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    stdout: String(result?.stdout ?? ''),
    stderr: String(result?.stderr ?? '').slice(0, 1000),
    errorCode: result?.error?.code || '',
  });
}

function parseJsonOutput(stdout) {
  const lines = splitLines(stdout);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {}
  }
  return null;
}

export function createFixedPostSyncRuntimeAdapter({ spawnSyncFn = spawnSync, refreshUiFn = refreshStephanosUi4173 } = {}) {
  const gitCommand = process.platform === 'win32' ? 'git.exe' : 'git';
  return Object.freeze({
    inspectHeads({ beforeHead, afterHead, repoRoot }) {
      if (!isSafeHead(beforeHead) || !isSafeHead(afterHead)) return { ok: false, blocker: 'POST_SYNC_HEADS_INVALID' };
      const branch = fixedRun(gitCommand, ['branch', '--show-current'], { cwd: repoRoot, spawnSyncFn });
      const current = fixedRun(gitCommand, ['rev-parse', 'HEAD'], { cwd: repoRoot, spawnSyncFn });
      const ancestor = fixedRun(gitCommand, ['merge-base', '--is-ancestor', beforeHead, afterHead], { cwd: repoRoot, spawnSyncFn });
      const sourceHead = text(current.stdout).toLowerCase();
      if (!branch.ok || text(branch.stdout) !== 'main') return { ok: false, blocker: 'POST_SYNC_BRANCH_NOT_MAIN' };
      if (!current.ok || sourceHead !== text(afterHead).toLowerCase()) return { ok: false, blocker: 'POST_SYNC_AFTER_HEAD_NOT_CURRENT', sourceHead };
      if (!ancestor.ok) return { ok: false, blocker: 'POST_SYNC_BEFORE_NOT_ANCESTOR' };
      return { ok: true, sourceHead, branch: 'main', exactHeadProofOk: true };
    },
    changedPaths({ beforeHead, afterHead, repoRoot }) {
      if (!isSafeHead(beforeHead) || !isSafeHead(afterHead)) return { ok: false, blocker: 'POST_SYNC_HEADS_INVALID', paths: [] };
      const diff = fixedRun(gitCommand, ['diff', '--name-status', '--find-renames', '--diff-filter=ACDMRT', beforeHead, afterHead, '--'], { cwd: repoRoot, spawnSyncFn });
      if (!diff.ok) return { ok: false, blocker: 'POST_SYNC_CHANGED_PATHS_READ_FAILED', paths: [] };
      const parsed = parseGitChangedPathStatus(diff.stdout);
      if (!parsed.ok) return parsed;
      if (parsed.paths.length > MAX_CHANGED_PATHS) return { ok: false, blocker: 'POST_SYNC_CHANGED_PATHS_LIMIT_EXCEEDED', paths: [] };
      return { ok: true, paths: parsed.paths };
    },
    async refreshUi({ afterHead }) {
      const result = await refreshUiFn({ expectedHead: afterHead });
      const sourceHead = text(result?.currentHead).toLowerCase();
      const exactHeadProofOk = sourceHead === text(afterHead).toLowerCase() && result?.exactHeadProof?.ready === true;
      return {
        ok: result?.refreshed === true && exactHeadProofOk,
        blocker: exactHeadProofOk ? '' : 'UI_4173_EXACT_HEAD_PROOF_FAILED',
        sourceHead,
        exactHeadProofOk,
      };
    },
    restartApprovedTarget({ target, afterHead, paths }) {
      if (!['backend', 'mission-worker'].includes(target)) return { ok: false, blocker: 'RUNTIME_TARGET_NOT_ALLOWLISTED', exactHeadProofOk: false, sourceHead: '' };
      const restartArguments = [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', paths.restartScript,
        '-Target', target,
        '-ExpectedHead', afterHead,
      ];
      let runtimeTimeoutMs = 240_000;
      if (target === 'mission-worker') {
        const restartDeadlineMs = Date.now() + MISSION_WORKER_POST_SYNC_RESTART_BUDGET_MS;
        restartArguments.push('-DeadlineUtc', new Date(restartDeadlineMs).toISOString());
        runtimeTimeoutMs = Math.max(
          1,
          restartDeadlineMs - Date.now() + MISSION_WORKER_POST_SYNC_CHILD_EXIT_RESERVE_MS,
        );
      }
      const result = fixedRun('powershell.exe', restartArguments, { cwd: paths.repoRoot, spawnSyncFn, timeout: runtimeTimeoutMs });
      const payload = parseJsonOutput(result.stdout);
      if (!payload) return { ok: false, blocker: 'APPROVED_RUNTIME_RESTART_RESPONSE_INVALID', exactHeadProofOk: false, sourceHead: '' };
      return {
        ok: result.ok && payload.ok === true,
        blocker: text(payload.blocker),
        sourceHead: text(payload.sourceHead).toLowerCase(),
        exactHeadProofOk: payload.exactHeadProofOk === true,
        proofKind: text(payload.proofKind),
        canonicalActionVerified: payload.canonicalActionVerified === true,
        unrelatedTasksChanged: payload.unrelatedTasksChanged === true,
      };
    },
    reconcileControlPlane({ afterHead, paths }) {
      return reconcileBattleBridgeControlPlane({
        repoRoot: paths.repoRoot,
        expectedHead: afterHead,
        platform: process.platform,
        spawnSyncFn,
      });
    },
    confirmNaturalReload({ afterHead, repoRoot }) {
      const current = fixedRun(gitCommand, ['rev-parse', 'HEAD'], { cwd: repoRoot, spawnSyncFn });
      const sourceHead = text(current.stdout).toLowerCase();
      return {
        ok: current.ok && sourceHead === text(afterHead).toLowerCase(),
        blocker: current.ok ? '' : 'NATURAL_RELOAD_HEAD_READ_FAILED',
        sourceHead,
        exactHeadProofOk: current.ok && sourceHead === text(afterHead).toLowerCase(),
        freshProcessLoaded: true,
      };
    },
  });
}

async function acquireLock(workspaceRoot, now, { aliveFn = processIsAlive } = {}) {
  const lockPath = path.resolve(workspaceRoot, 'locks', 'post-sync-runtime-refresh.lock');
  await mkdir(path.dirname(lockPath), { recursive: true });
  const attempt = async () => {
    const handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAtUtc: now.toISOString() })}\n`);
    await handle.close();
    return { ok: true, lockPath };
  };
  try {
    return await attempt();
  } catch (error) {
    if (error?.code !== 'EEXIST') return { ok: false, blocker: 'POST_SYNC_REFRESH_LOCK_FAILED' };
    let parsed = null;
    let ageMs = NaN;
    try {
      parsed = JSON.parse(await readFile(lockPath, 'utf8'));
      ageMs = now.getTime() - Date.parse(parsed.acquiredAtUtc);
    } catch {
      try { ageMs = now.getTime() - (await stat(lockPath)).mtimeMs; } catch {}
    }
    if (Number.isFinite(ageMs) && ageMs > POST_SYNC_REFRESH_LOCK_STALE_AFTER_MS && !aliveFn(Number(parsed?.pid))) {
      await rm(lockPath, { force: true });
      try { return { ...(await attempt()), recoveredStaleLock: true }; } catch {}
    }
    return { ok: false, blocker: 'POST_SYNC_REFRESH_ALREADY_RUNNING' };
  }
}

async function loadResumeResults(workspaceRoot, afterHead) {
  const statusPath = path.resolve(workspaceRoot, 'status', 'post-sync-runtime-refresh-current.json');
  try {
    const status = JSON.parse(await readFile(statusPath, 'utf8'));
    if (text(status?.afterHead).toLowerCase() !== text(afterHead).toLowerCase()) return [];
    return Array.isArray(status?.resultTargets)
      ? status.resultTargets.filter((entry) => entry?.ok === true && entry?.exactHeadProofOk === true && text(entry?.sourceHead).toLowerCase() === text(afterHead).toLowerCase())
      : [];
  } catch {
    return [];
  }
}

async function publishProjection({ workspaceRoot, repoRoot, projection, afterHead, phase, now }) {
  const receiptFile = `${afterHead}-${phase}.json`;
  const receiptRelative = path.posix.join('receipts', 'post-sync-runtime-refresh', receiptFile);
  const proofRefs = [receiptRelative];
  const summary = `Post-sync runtime refresh ${projection.classification}`;
  const proof = Object.freeze({
    ...projection,
    ...createSharedWorkspaceProofRecord({
      proofId: `post-sync-refresh-${afterHead.slice(0, 16)}-${phase}`,
      timestampUtc: now.toISOString(),
      status: projection.classification,
      summary,
      refs: proofRefs,
      proofRefs,
      correlationId: `post-sync-${afterHead.slice(0, 16)}`,
      relatedIssue: '#1507',
    }),
    correlationId: `post-sync-${afterHead.slice(0, 16)}`,
    relatedIssue: '#1507',
    proofRefs,
    receiptType: 'post-sync-runtime-refresh',
    phase,
  });
  const receiptWrite = await writeAtomicJson(workspaceRoot, ['receipts', 'post-sync-runtime-refresh', receiptFile], proof, { repoRoot });
  if (!receiptWrite.ok) return { ok: false, blocker: 'POST_SYNC_REFRESH_RECEIPT_WRITE_FAILED' };

  const status = Object.freeze({
    ...projection,
    ...createSharedWorkspaceStatusRecord({
      statusId: 'post-sync-runtime-refresh-current',
      participantId: 'mission-orchestrator',
      timestampUtc: now.toISOString(),
      status: projection.classification,
      summary,
      proofRefs,
    }),
    phase,
  });
  const statusWrite = await writeAtomicJson(workspaceRoot, ['status', 'post-sync-runtime-refresh-current.json'], status, { repoRoot });
  if (!statusWrite.ok) return { ok: false, blocker: 'POST_SYNC_REFRESH_STATUS_WRITE_FAILED' };

  const event = Object.freeze({
    ...createSharedWorkspaceEventRecord({
      eventId: `post-sync-refresh-${afterHead.slice(0, 16)}-${phase}`,
      participantId: 'mission-orchestrator',
      timestampUtc: now.toISOString(),
      eventKind: `post-sync-runtime-refresh-${phase}`,
      summary,
    }),
    classification: projection.classification,
    proofRefs,
  });
  const eventWrite = await appendWorkspaceJsonl(workspaceRoot, ['events', 'post-sync-runtime-refresh.jsonl'], event, { repoRoot });
  if (!eventWrite.ok) return { ok: false, blocker: 'POST_SYNC_REFRESH_EVENT_WRITE_FAILED' };
  return { ok: true, proofRefs };
}

export async function runBattleBridgePostSyncRefresh({
  beforeHead,
  afterHead,
  env = process.env,
  now = new Date(),
  paths = resolveCanonicalPostSyncRefreshPaths({ env }),
  expectedPaths = resolveCanonicalPostSyncRefreshPaths({ env }),
  adapter = createFixedPostSyncRuntimeAdapter(),
} = {}) {
  const normalizedBefore = text(beforeHead).toLowerCase();
  const normalizedAfter = text(afterHead).toLowerCase();
  if (!isSafeHead(normalizedBefore) || !isSafeHead(normalizedAfter) || normalizedBefore === normalizedAfter) {
    return Object.freeze({ ok: false, blocker: 'POST_SYNC_HEADS_INVALID', exactHeadProofOk: false, finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_BLOCKED' });
  }
  if (path.resolve(paths.repoRoot) !== path.resolve(expectedPaths.repoRoot) || path.resolve(paths.workspaceRoot) !== path.resolve(expectedPaths.workspaceRoot)) {
    return Object.freeze({ ok: false, blocker: 'POST_SYNC_REFRESH_NON_CANONICAL_PATH', exactHeadProofOk: false, finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_BLOCKED' });
  }
  await mkdir(paths.workspaceRoot, { recursive: true });
  const lock = await acquireLock(paths.workspaceRoot, now);
  if (!lock.ok) return Object.freeze({ ok: false, blocker: lock.blocker, exactHeadProofOk: false, finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_BLOCKED' });
  try {
    const inspection = adapter.inspectHeads({ beforeHead: normalizedBefore, afterHead: normalizedAfter, repoRoot: paths.repoRoot });
    if (!inspection.ok) return Object.freeze({ ok: false, blocker: inspection.blocker, exactHeadProofOk: false, finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_BLOCKED' });
    const changed = adapter.changedPaths({ beforeHead: normalizedBefore, afterHead: normalizedAfter, repoRoot: paths.repoRoot });
    if (!changed.ok) return Object.freeze({ ok: false, blocker: changed.blocker, exactHeadProofOk: false, finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_BLOCKED' });

    const plan = classifyPostSyncRefresh(changed.paths);
    const completedResults = await loadResumeResults(paths.workspaceRoot, normalizedAfter);
    const planProjection = buildPostSyncRefreshProjection({ ok: false, classification: plan.classification, plan, results: completedResults }, { beforeHead: normalizedBefore, afterHead: normalizedAfter });
    const planPublication = await publishProjection({ workspaceRoot: paths.workspaceRoot, repoRoot: paths.repoRoot, projection: planProjection, afterHead: normalizedAfter, phase: 'plan', now });
    if (!planPublication.ok) return Object.freeze({ ok: false, blocker: planPublication.blocker, exactHeadProofOk: false, finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_BLOCKED' });

    const execution = await executePostSyncRefreshPlan({
      beforeHead: normalizedBefore,
      afterHead: normalizedAfter,
      changedPaths: changed.paths,
      completedResults,
      adapters: {
        refreshUi: ({ afterHead: head }) => adapter.refreshUi({ afterHead: head }),
        restartBackend: ({ afterHead: head }) => adapter.restartApprovedTarget({ target: 'backend', afterHead: head, paths }),
        restartMissionWorker: ({ afterHead: head }) => adapter.restartApprovedTarget({ target: 'mission-worker', afterHead: head, paths }),
        confirmNaturalReload: ({ afterHead: head }) => adapter.confirmNaturalReload({ afterHead: head, repoRoot: paths.repoRoot }),
      },
      onTargetComplete: async (results) => {
        const checkpoint = buildPostSyncRefreshProjection({
          ok: false,
          classification: 'REFRESH_READY',
          blocker: '',
          plan,
          results,
          exactHeadProofOk: false,
        }, { beforeHead: normalizedBefore, afterHead: normalizedAfter });
        const checkpointPublication = await publishProjection({
          workspaceRoot: paths.workspaceRoot,
          repoRoot: paths.repoRoot,
          projection: checkpoint,
          afterHead: normalizedAfter,
          phase: `checkpoint-${results.length}`,
          now: new Date(),
        });
        if (!checkpointPublication.ok) throw new Error(checkpointPublication.blocker);
      },
    });

    const controlPlaneReconcile = execution.ok === true
      ? adapter.reconcileControlPlane({ afterHead: normalizedAfter, paths })
      : Object.freeze({ ok: false, skipped: true, blocker: '', sourceHead: '', exactHeadProofOk: false });
    const effectiveExecution = execution.ok === true && controlPlaneReconcile.ok !== true
      ? Object.freeze({ ...execution, ok: false, blocker: projectControlPlaneFailureBlocker(controlPlaneReconcile) || 'CONTROL_PLANE_RECONCILE_BLOCKED', exactHeadProofOk: false })
      : execution;

    const projection = buildPostSyncRefreshProjection(effectiveExecution, { beforeHead: normalizedBefore, afterHead: normalizedAfter });
    const publication = await publishProjection({ workspaceRoot: paths.workspaceRoot, repoRoot: paths.repoRoot, projection, afterHead: normalizedAfter, phase: effectiveExecution.ok ? 'complete' : 'blocked', now: new Date() });
    if (!publication.ok) return Object.freeze({ ok: false, blocker: publication.blocker, exactHeadProofOk: false, finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_BLOCKED' });
    return Object.freeze({
      ...projection,
      ok: effectiveExecution.ok === true,
      proofRefs: publication.proofRefs,
      sourceHead: normalizedAfter,
      exactHeadProofOk: effectiveExecution.exactHeadProofOk === true && controlPlaneReconcile.ok === true,
      controlPlaneReconcile,
      blocker: effectiveExecution.blocker || '',
      finalVerdict: effectiveExecution.ok === true ? 'POST_SYNC_RUNTIME_REFRESH_PASS' : 'POST_SYNC_RUNTIME_REFRESH_BLOCKED',
    });
  } finally {
    await rm(lock.lockPath, { force: true }).catch(() => {});
  }
}

export function parsePostSyncRefreshCliArgs(argv = process.argv.slice(2)) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index]);
    if (token === '--before' || token === '--after') {
      values[token.slice(2)] = String(argv[index + 1] || '');
      index += 1;
    } else if (token.startsWith('--before=')) values.before = token.slice('--before='.length);
    else if (token.startsWith('--after=')) values.after = token.slice('--after='.length);
    else throw new Error('POST_SYNC_REFRESH_ARGUMENT_NOT_ALLOWED');
  }
  if (!isSafeHead(values.before) || !isSafeHead(values.after)) throw new Error('POST_SYNC_HEADS_INVALID');
  return Object.freeze({ beforeHead: values.before.toLowerCase(), afterHead: values.after.toLowerCase() });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const input = parsePostSyncRefreshCliArgs();
    const result = await runBattleBridgePostSyncRefresh(input);
    process.stdout.write(`${POST_SYNC_REFRESH_RESULT_MARKER}${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 2;
  } catch (error) {
    const blocker = /^[A-Z0-9_:-]+$/.test(text(error?.message)) ? text(error.message) : 'POST_SYNC_RUNTIME_REFRESH_FAILED';
    const result = { ok: false, blocker, exactHeadProofOk: false, finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_BLOCKED' };
    process.stdout.write(`${POST_SYNC_REFRESH_RESULT_MARKER}${JSON.stringify(result)}\n`);
    process.exitCode = 2;
  }
}