#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  open,
  readFile,
  rm,
  stat,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  appendWorkspaceJsonl,
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceStatusRecord,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  CANONICAL_SYNC_CONTRACT,
  FIXED_GIT_COMMANDS,
  SYNC_CLASSIFICATIONS,
  buildSharedWorkspaceBlocker,
  buildSharedWorkspaceHeartbeat,
  buildSharedWorkspacePlan,
  buildSharedWorkspaceReceipt,
  classifyDirt,
  evaluateSyncPolicy,
} from './battle-bridge-github-sync-policy.mjs';

export const BATTLE_BRIDGE_GITHUB_SYNC_EXECUTOR_SCHEMA = 'stephanos.battle-bridge-github-sync-executor.v1';
export const BATTLE_BRIDGE_GITHUB_SYNC_TASK_NAME = 'Stephanos Battle Bridge GitHub Sync';
export const BATTLE_BRIDGE_GITHUB_SYNC_AUTHORITY = Object.freeze({
  canonicalRepositoryOnly: true,
  fastForwardOnly: true,
  arbitraryShellAllowed: false,
  arbitraryPowerShellAllowed: false,
  branchSwitchAllowed: false,
  resetCleanStashRebaseAllowed: false,
  pushAllowed: false,
  runtimeRefreshAllowed: false,
  liveOpenClawUpdateAllowed: false,
  mergeToGitHubAllowed: false,
});

const READ_ONLY_GIT_COMMANDS = Object.freeze({
  currentBranch: Object.freeze({ id: 'git-current-branch', executable: 'git', argv: Object.freeze(['symbolic-ref', '--quiet', '--short', 'HEAD']), mutation: false }),
  originUrl: Object.freeze({ id: 'git-origin-url', executable: 'git', argv: Object.freeze(['remote', 'get-url', 'origin']), mutation: false }),
  statusPorcelain: Object.freeze({ id: 'git-status-porcelain', executable: 'git', argv: Object.freeze(['status', '--porcelain=v1', '--untracked-files=all']), mutation: false }),
  localHead: Object.freeze({ id: 'git-local-head', executable: 'git', argv: Object.freeze(['rev-parse', 'HEAD']), mutation: false }),
  remoteHead: Object.freeze({ id: 'git-origin-main-head', executable: 'git', argv: Object.freeze(['rev-parse', 'origin/main']), mutation: false }),
  mergeBase: Object.freeze({ id: 'git-merge-base-origin-main', executable: 'git', argv: Object.freeze(['merge-base', 'HEAD', 'origin/main']), mutation: false }),
});

export const FIXED_SYNC_GIT_COMMANDS = Object.freeze({
  ...READ_ONLY_GIT_COMMANDS,
  fetchOriginMain: Object.freeze({ ...FIXED_GIT_COMMANDS.fetchOriginMain, mutation: false }),
  mergeFfOnlyOriginMain: Object.freeze({ ...FIXED_GIT_COMMANDS.mergeFfOnlyOriginMain, mutation: true }),
});

const FIXED_COMMAND_IDS = new Map(Object.values(FIXED_SYNC_GIT_COMMANDS).map((command) => [command.id, command]));
const FORBIDDEN_ARG_PATTERN = /^(?:checkout|switch|reset|clean|stash|rebase|push|branch)$/i;
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
export const SYNC_LOCK_STALE_AFTER_MS = 10 * 60 * 1000;

function text(value) {
  return String(value ?? '').trim();
}

function isoStamp(value = new Date()) {
  return value.toISOString().replace(/[:.]/g, '-');
}

function splitLines(value) {
  return String(value ?? '').split(/\r?\n/).filter((line) => line.length > 0);
}

function within(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveCanonicalSyncPaths({ env = process.env, home = os.homedir() } = {}) {
  const userHome = path.resolve(env.USERPROFILE || env.HOME || home);
  return Object.freeze({
    repoRoot: path.resolve(userHome, 'Documents', 'GitHub', 'stephan-os'),
    workspaceRoot: path.resolve(userHome, 'Documents', 'Stephanos-openclaw-workspace'),
  });
}

export function getFixedSyncGitCommand(id) {
  const command = FIXED_COMMAND_IDS.get(text(id));
  if (!command) throw new Error(`Unsupported Git command identity: ${id}`);
  if (command.executable !== 'git' || command.argv.some((arg) => FORBIDDEN_ARG_PATTERN.test(arg))) {
    throw new Error(`Unsafe Git command identity rejected: ${id}`);
  }
  return command;
}

export function createFixedGitAdapter({ spawnSyncFn = spawnSync } = {}) {
  return Object.freeze({
    run(id, cwd) {
      const command = getFixedSyncGitCommand(id);
      const result = spawnSyncFn(command.executable, [...command.argv], {
        cwd,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return Object.freeze({
        ok: !result.error && result.status === 0,
        status: result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        error: result.error?.message || '',
        commandId: command.id,
        mutation: command.mutation === true,
        performsShellExecution: false,
      });
    },
  });
}

function blockedEvaluation(classification, exactNextAction, statusLines = []) {
  return Object.freeze({
    classification,
    dirt: classifyDirt(statusLines),
    operatorNeeded: true,
    exactNextAction,
    performsGitMutation: false,
    performsShellExecution: false,
  });
}

async function pathIsDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

export function validateCanonicalSyncPaths({ repoRoot, workspaceRoot, expectedPaths }) {
  const expected = expectedPaths || resolveCanonicalSyncPaths();
  if (path.resolve(repoRoot) !== path.resolve(expected.repoRoot)) return { ok: false, reason: 'NON_CANONICAL_REPOSITORY_PATH' };
  if (path.resolve(workspaceRoot) !== path.resolve(expected.workspaceRoot)) return { ok: false, reason: 'NON_CANONICAL_WORKSPACE_PATH' };
  if (within(repoRoot, workspaceRoot) || within(workspaceRoot, repoRoot)) return { ok: false, reason: 'REPOSITORY_WORKSPACE_OVERLAP' };
  return { ok: true, reason: 'CANONICAL_SYNC_PATHS_VERIFIED' };
}

function requireGitResult(result, fallback = '') {
  return result?.ok ? text(result.stdout) : fallback;
}

async function publishSyncRecord({ workspaceRoot, repoRoot, evaluation, facts, now, kind }) {
  const timestampUtc = now.toISOString();
  const stamp = isoStamp(now);
  const receiptFile = `${stamp}-${kind}.json`;
  const receiptRelative = path.posix.join('receipts', 'battle-bridge-github-sync', receiptFile);
  const proofRefs = [receiptRelative];
  const heads = {
    localHeadBefore: facts.localHeadBefore || facts.localHead || null,
    remoteHeadObserved: facts.remoteHead || null,
    localHeadAfter: facts.localHeadAfter || null,
  };
  const bounded = kind === 'heartbeat'
    ? buildSharedWorkspaceHeartbeat(evaluation, heads, proofRefs)
    : kind === 'plan'
      ? buildSharedWorkspacePlan(evaluation, heads, proofRefs)
      : kind === 'blocker'
        ? buildSharedWorkspaceBlocker(evaluation, heads, proofRefs)
        : buildSharedWorkspaceReceipt(evaluation, heads, proofRefs);
  const { kind: syncRecordKind, ...boundedFields } = bounded;
  const summary = `Battle Bridge GitHub sync ${evaluation.classification}: ${evaluation.exactNextAction}`;
  const common = {
    repositoryIdentity: CANONICAL_SYNC_CONTRACT.repositoryIdentity,
    branch: CANONICAL_SYNC_CONTRACT.branch,
    remote: CANONICAL_SYNC_CONTRACT.remote,
    taskName: BATTLE_BRIDGE_GITHUB_SYNC_TASK_NAME,
    syncRecordKind,
    ...boundedFields,
    authority: BATTLE_BRIDGE_GITHUB_SYNC_AUTHORITY,
  };
  const receiptRecord = Object.freeze({
    ...createSharedWorkspaceProofRecord({
      proofId: `battle-bridge-github-sync-${stamp}-${kind}`,
      timestampUtc,
      status: evaluation.classification,
      summary,
      refs: [],
    }),
    receiptType: 'battle-bridge-github-sync-receipt',
    ...common,
  });
  const receiptWrite = await writeAtomicJson(
    workspaceRoot,
    ['receipts', 'battle-bridge-github-sync', receiptFile],
    receiptRecord,
    { repoRoot },
  );
  if (!receiptWrite.ok) throw new Error(`Shared Workspace receipt write failed: ${receiptWrite.reason}`);
  const statusRecord = Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: 'battle-bridge-github-sync-current',
      timestampUtc,
      status: evaluation.classification,
      summary,
      proofRefs,
    }),
    ...common,
  });
  const statusWrite = await writeAtomicJson(
    workspaceRoot,
    ['status', 'battle-bridge-github-sync-current.json'],
    statusRecord,
    { repoRoot },
  );
  if (!statusWrite.ok) throw new Error(`Shared Workspace status write failed: ${statusWrite.reason}`);
  const eventRecord = Object.freeze({
    ...createSharedWorkspaceEventRecord({
      eventId: `battle-bridge-github-sync-${stamp}-${kind}`,
      timestampUtc,
      eventKind: `battle-bridge-github-sync-${kind}`,
      summary,
    }),
    classification: evaluation.classification,
    proofRefs,
  });
  const eventWrite = await appendWorkspaceJsonl(
    workspaceRoot,
    ['events', 'battle-bridge-github-sync.jsonl'],
    eventRecord,
    { repoRoot },
  );
  if (!eventWrite.ok) throw new Error(`Shared Workspace event write failed: ${eventWrite.reason}`);
  return Object.freeze({
    record: receiptRecord,
    statusRecord,
    eventRecord,
    receiptPath: receiptWrite.path,
    statusPath: statusWrite.path,
    eventPath: eventWrite.path,
    proofRefs,
  });
}

function defaultProcessIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function acquireSingleInstanceLock(workspaceRoot, now, {
  processIsAliveFn = defaultProcessIsAlive,
  staleAfterMs = SYNC_LOCK_STALE_AFTER_MS,
  allowRecovery = true,
} = {}) {
  const lockPath = path.resolve(workspaceRoot, 'locks', 'battle-bridge-github-sync.lock');
  await mkdir(path.dirname(lockPath), { recursive: true });
  try {
    const handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAtUtc: now.toISOString() })}\n`);
    await handle.close();
    return { ok: true, lockPath };
  } catch (error) {
    if (error?.code === 'EEXIST') {
      let existing = '';
      let parsed = null;
      try {
        existing = await readFile(lockPath, 'utf8');
        parsed = JSON.parse(existing);
      } catch {}
      let lockStat = null;
      try { lockStat = await stat(lockPath); } catch {}
      const parsedAcquiredAtMs = Date.parse(text(parsed?.acquiredAtUtc));
      const acquiredAtMs = Number.isFinite(parsedAcquiredAtMs) ? parsedAcquiredAtMs : lockStat?.mtimeMs;
      const ageMs = Number.isFinite(acquiredAtMs) ? now.getTime() - acquiredAtMs : NaN;
      const ownerAlive = processIsAliveFn(Number.parseInt(parsed?.pid, 10));
      if (allowRecovery && Number.isFinite(ageMs) && ageMs > staleAfterMs && !ownerAlive) {
        await rm(lockPath, { force: true });
        const recovered = await acquireSingleInstanceLock(workspaceRoot, now, {
          processIsAliveFn,
          staleAfterMs,
          allowRecovery: false,
        });
        return { ...recovered, recoveredStaleLock: recovered.ok, staleLock: { ageMs, pid: parsed?.pid ?? null } };
      }
      return { ok: false, reason: 'SYNC_ALREADY_RUNNING', lockPath, existing: existing.slice(0, 500), ownerAlive, ageMs };
    }
    return { ok: false, reason: 'LOCK_ACQUISITION_FAILED', lockPath, error: error?.message || String(error) };
  }
}

async function collectPreFetchFacts({ git, repoRoot }) {
  const branch = git.run(FIXED_SYNC_GIT_COMMANDS.currentBranch.id, repoRoot);
  const origin = git.run(FIXED_SYNC_GIT_COMMANDS.originUrl.id, repoRoot);
  const status = git.run(FIXED_SYNC_GIT_COMMANDS.statusPorcelain.id, repoRoot);
  const local = git.run(FIXED_SYNC_GIT_COMMANDS.localHead.id, repoRoot);
  return {
    currentBranch: requireGitResult(branch),
    originUrl: requireGitResult(origin),
    statusLines: status.ok ? splitLines(status.stdout) : ['!! git-status-observation-failed'],
    localHead: requireGitResult(local),
    commandEvidence: { branch, origin, status, local },
  };
}

function preFetchBlocker(facts) {
  if (facts.currentBranch !== CANONICAL_SYNC_CONTRACT.branch) {
    return blockedEvaluation(SYNC_CLASSIFICATIONS.BLOCKED_NON_MAIN_BRANCH, 'Return canonical checkout to main before unattended sync.', facts.statusLines);
  }
  const remoteEvaluation = evaluateSyncPolicy({ ...facts, remoteHead: facts.localHead, mergeBase: facts.localHead, fetchOk: true });
  if ([SYNC_CLASSIFICATIONS.BLOCKED_REMOTE_MISMATCH, SYNC_CLASSIFICATIONS.BLOCKED_DIRTY_SOURCE, SYNC_CLASSIFICATIONS.BLOCKED_HEAD_PROOF_MISSING].includes(remoteEvaluation.classification)) {
    return remoteEvaluation;
  }
  return null;
}

export async function runBattleBridgeGitHubSync({
  env = process.env,
  now = new Date(),
  git = createFixedGitAdapter(),
  paths = resolveCanonicalSyncPaths({ env }),
  expectedPaths = resolveCanonicalSyncPaths({ env }),
  processIsAliveFn = defaultProcessIsAlive,
  staleAfterMs = SYNC_LOCK_STALE_AFTER_MS,
} = {}) {
  const { repoRoot, workspaceRoot } = paths;
  const pathValidation = validateCanonicalSyncPaths({ repoRoot, workspaceRoot, expectedPaths });
  if (!pathValidation.ok) {
    return Object.freeze({ ok: false, evaluation: blockedEvaluation(SYNC_CLASSIFICATIONS.BLOCKED_INSTALL_OR_PERMISSION_REQUIRED, pathValidation.reason), pathValidation });
  }
  if (!(await pathIsDirectory(repoRoot))) {
    return Object.freeze({ ok: false, evaluation: blockedEvaluation(SYNC_CLASSIFICATIONS.BLOCKED_INSTALL_OR_PERMISSION_REQUIRED, `Canonical repository is missing: ${repoRoot}`) });
  }
  try {
    await mkdir(workspaceRoot, { recursive: true });
  } catch (error) {
    return Object.freeze({ ok: false, evaluation: blockedEvaluation(SYNC_CLASSIFICATIONS.BLOCKED_INSTALL_OR_PERMISSION_REQUIRED, `Shared Workspace is unavailable: ${error?.message || error}`) });
  }
  const lock = await acquireSingleInstanceLock(workspaceRoot, now, { processIsAliveFn, staleAfterMs });
  if (!lock.ok) {
    const evaluation = blockedEvaluation(SYNC_CLASSIFICATIONS.BLOCKED_INSTALL_OR_PERMISSION_REQUIRED, lock.reason);
    let publication = null;
    try { publication = await publishSyncRecord({ workspaceRoot, repoRoot, evaluation, facts: {}, now, kind: 'blocker' }); } catch {}
    return Object.freeze({ ok: false, evaluation, lock, publication });
  }

  try {
    const before = await collectPreFetchFacts({ git, repoRoot });
    const earlyBlocker = preFetchBlocker(before);
    if (earlyBlocker) {
      const heartbeat = await publishSyncRecord({ workspaceRoot, repoRoot, evaluation: earlyBlocker, facts: before, now, kind: 'heartbeat' });
      const publication = await publishSyncRecord({ workspaceRoot, repoRoot, evaluation: earlyBlocker, facts: before, now, kind: 'blocker' });
      return Object.freeze({ ok: false, evaluation: earlyBlocker, facts: before, heartbeat, publication });
    }

    const fetchResult = git.run(FIXED_SYNC_GIT_COMMANDS.fetchOriginMain.id, repoRoot);
    if (!fetchResult.ok) {
      const facts = { ...before, fetchOk: false, remoteHead: before.localHead, mergeBase: before.localHead };
      const evaluation = evaluateSyncPolicy(facts);
      const heartbeat = await publishSyncRecord({ workspaceRoot, repoRoot, evaluation, facts, now, kind: 'heartbeat' });
      const publication = await publishSyncRecord({ workspaceRoot, repoRoot, evaluation, facts, now, kind: 'blocker' });
      return Object.freeze({ ok: false, evaluation, facts, fetchResult, heartbeat, publication });
    }

    const remoteResult = git.run(FIXED_SYNC_GIT_COMMANDS.remoteHead.id, repoRoot);
    const mergeBaseResult = git.run(FIXED_SYNC_GIT_COMMANDS.mergeBase.id, repoRoot);
    const facts = {
      ...before,
      fetchOk: true,
      remoteHead: requireGitResult(remoteResult),
      mergeBase: requireGitResult(mergeBaseResult),
      commandEvidence: { ...before.commandEvidence, fetch: fetchResult, remote: remoteResult, mergeBase: mergeBaseResult },
    };
    let evaluation = evaluateSyncPolicy(facts);
    const heartbeat = await publishSyncRecord({ workspaceRoot, repoRoot, evaluation, facts, now, kind: 'heartbeat' });
    const plan = await publishSyncRecord({ workspaceRoot, repoRoot, evaluation, facts, now, kind: 'plan' });

    if (evaluation.classification !== SYNC_CLASSIFICATIONS.SYNC_FAST_FORWARD_READY) {
      const receipt = await publishSyncRecord({ workspaceRoot, repoRoot, evaluation, facts, now, kind: evaluation.operatorNeeded ? 'blocker' : 'receipt' });
      return Object.freeze({ ok: evaluation.classification === SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE, evaluation, facts, heartbeat, plan, receipt });
    }

    const mergeResult = git.run(FIXED_SYNC_GIT_COMMANDS.mergeFfOnlyOriginMain.id, repoRoot);
    if (!mergeResult.ok) {
      const failedFacts = { ...facts, mergeAttempted: true, mergeOk: false };
      evaluation = evaluateSyncPolicy(failedFacts);
      const publication = await publishSyncRecord({ workspaceRoot, repoRoot, evaluation, facts: failedFacts, now, kind: 'blocker' });
      return Object.freeze({ ok: false, evaluation, facts: failedFacts, mergeResult, heartbeat, plan, publication });
    }

    const afterResult = git.run(FIXED_SYNC_GIT_COMMANDS.localHead.id, repoRoot);
    const localHeadAfter = requireGitResult(afterResult);
    const appliedFacts = {
      ...facts,
      localHeadBefore: facts.localHead,
      localHeadAfter,
      applied: true,
      mergeAttempted: true,
      mergeOk: true,
      exactHeadProofOk: SHA_PATTERN.test(localHeadAfter) && localHeadAfter === facts.remoteHead,
      postSyncRefreshRequired: true,
      postSyncRefreshOk: false,
      commandEvidence: { ...facts.commandEvidence, merge: mergeResult, localAfter: afterResult },
    };
    evaluation = evaluateSyncPolicy(appliedFacts);
    const receipt = await publishSyncRecord({ workspaceRoot, repoRoot, evaluation, facts: appliedFacts, now, kind: evaluation.operatorNeeded ? 'blocker' : 'receipt' });
    return Object.freeze({
      ok: false,
      sourceUpdated: true,
      runtimeRefreshPerformed: false,
      liveOpenClawUpdatePerformed: false,
      evaluation,
      facts: appliedFacts,
      heartbeat,
      plan,
      receipt,
    });
  } catch (error) {
    const evaluation = blockedEvaluation(SYNC_CLASSIFICATIONS.BLOCKED_INSTALL_OR_PERMISSION_REQUIRED, `Sync executor failed closed: ${error?.message || error}`);
    let publication = null;
    try { publication = await publishSyncRecord({ workspaceRoot, repoRoot, evaluation, facts: {}, now, kind: 'blocker' }); } catch {}
    return Object.freeze({ ok: false, evaluation, error: error?.message || String(error), publication });
  } finally {
    await rm(lock.lockPath, { force: true }).catch(() => {});
  }
}

export function isDirectCliEntrypoint({ metaUrl = import.meta.url, argv1 = process.argv[1] } = {}) {
  if (!argv1) return false;
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(argv1);
}

if (isDirectCliEntrypoint()) {
  const result = await runBattleBridgeGitHubSync();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
