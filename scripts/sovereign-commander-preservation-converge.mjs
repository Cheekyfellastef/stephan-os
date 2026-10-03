#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { writeAtomicJson } from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import { resolveCriticalBacklogRuntimePaths } from '../stephanos-server/services/criticalBacklogConveyorServiceCore.js';

export const SOVEREIGN_PRESERVATION_CONVERGENCE_SCHEMA =
  'stephanos.sovereign-preservation-convergence.v1';
export const SOVEREIGN_PRESERVATION_CONVERGENCE_MARKER =
  'SOVEREIGN_PRESERVATION_CONVERGENCE_RESULT=';

const SHA40 = /^[0-9a-f]{40}$/i;
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/;
const WINDOWS_GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';

function text(value) {
  return String(value ?? '').trim();
}

function frozen(value) {
  return Object.freeze(value);
}

function proofHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function fail(blocker, details = {}) {
  return frozen({
    ok: false,
    schemaVersion: SOVEREIGN_PRESERVATION_CONVERGENCE_SCHEMA,
    blocker,
    ...details,
    mergeAuthority: false,
    directMainWriteAllowed: false,
    forcePushAllowed: false,
    rebaseAllowed: false,
    resetAllowed: false,
    leaseSeizureAllowed: false,
    finalVerdict: 'SOVEREIGN_PRESERVATION_CONVERGENCE_BLOCKED',
  });
}

export function validatePreservationConvergenceRequest({
  prNumber,
  branch,
  expectedHead,
  expectedMain,
} = {}) {
  const normalizedBranch = text(branch);
  const normalizedHead = text(expectedHead).toLowerCase();
  const normalizedMain = text(expectedMain).toLowerCase();
  const normalizedPr = Number(prNumber);
  const blockers = [];

  if (!Number.isSafeInteger(normalizedPr) || normalizedPr < 1 || normalizedPr > 999999999) {
    blockers.push('pr-number-invalid');
  }
  if (!SAFE_BRANCH.test(normalizedBranch)
    || normalizedBranch.includes('..')
    || normalizedBranch.includes('//')
    || normalizedBranch.endsWith('/')
    || normalizedBranch.startsWith('refs/')
    || ['main', 'master'].includes(normalizedBranch.toLowerCase())) {
    blockers.push('target-branch-invalid-or-protected');
  }
  if (!SHA40.test(normalizedHead)) blockers.push('expected-head-invalid');
  if (!SHA40.test(normalizedMain)) blockers.push('expected-main-invalid');
  if (normalizedHead && normalizedMain && normalizedHead === normalizedMain) {
    blockers.push('feature-head-must-not-equal-main');
  }

  return frozen({
    ok: blockers.length === 0,
    prNumber: normalizedPr,
    branch: normalizedBranch,
    expectedHead: normalizedHead,
    expectedMain: normalizedMain,
    blockers: frozen(blockers),
  });
}

function runGit(spawnSyncFn, gitExecutable, cwd, args, timeout = 120000) {
  const result = spawnSyncFn(gitExecutable, ['-C', cwd, ...args], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout,
    maxBuffer: 1024 * 1024,
  });
  return frozen({
    ok: !result?.error && Number(result?.status) === 0,
    status: Number.isInteger(result?.status) ? result.status : null,
    stdout: String(result?.stdout || '').trim(),
    stderr: String(result?.stderr || '').trim(),
  });
}

async function defaultPublishReceipt(receipt, {
  env = process.env,
  now = new Date(),
} = {}) {
  const paths = resolveCriticalBacklogRuntimePaths({ env });
  return writeAtomicJson(
    paths.workspaceRoot,
    ['status', 'sovereign-preservation-convergence-current.json'],
    receipt,
    { repoRoot: paths.repoRoot, nowMs: now.getTime() },
  );
}

export async function executeSovereignPreservationConvergence({
  repoRoot,
  prNumber,
  branch,
  expectedHead,
  expectedMain,
  spawnSyncFn = spawnSync,
  gitExecutable = process.platform === 'win32' ? WINDOWS_GIT : 'git',
  publishReceipt = defaultPublishReceipt,
  env = process.env,
  now = new Date(),
} = {}) {
  const request = validatePreservationConvergenceRequest({
    prNumber,
    branch,
    expectedHead,
    expectedMain,
  });
  if (!request.ok) return fail('SOVEREIGN_PRESERVATION_CONVERGENCE_REQUEST_INVALID', { blockers: request.blockers });

  const canonicalRoot = resolve(text(repoRoot));
  const checkRef = runGit(spawnSyncFn, gitExecutable, canonicalRoot, ['check-ref-format', '--branch', request.branch], 15000);
  if (!checkRef.ok) return fail('SOVEREIGN_PRESERVATION_CONVERGENCE_BRANCH_REF_INVALID');

  const fetch = runGit(
    spawnSyncFn,
    gitExecutable,
    canonicalRoot,
    ['fetch', '--no-tags', 'origin', 'main', request.branch],
    120000,
  );
  if (!fetch.ok) return fail('SOVEREIGN_PRESERVATION_CONVERGENCE_FETCH_FAILED', { status: fetch.status });

  const observedMain = runGit(
    spawnSyncFn,
    gitExecutable,
    canonicalRoot,
    ['rev-parse', 'refs/remotes/origin/main'],
    15000,
  );
  const observedHead = runGit(
    spawnSyncFn,
    gitExecutable,
    canonicalRoot,
    ['rev-parse', `refs/remotes/origin/${request.branch}`],
    15000,
  );
  if (!observedMain.ok || !observedHead.ok) {
    return fail('SOVEREIGN_PRESERVATION_CONVERGENCE_SOURCE_IDENTITY_UNAVAILABLE');
  }
  if (observedMain.stdout.toLowerCase() !== request.expectedMain) {
    return fail('SOVEREIGN_PRESERVATION_CONVERGENCE_MAIN_MOVED', {
      observedMain: observedMain.stdout.toLowerCase(),
    });
  }
  if (observedHead.stdout.toLowerCase() !== request.expectedHead) {
    return fail('SOVEREIGN_PRESERVATION_CONVERGENCE_BRANCH_MOVED', {
      observedHead: observedHead.stdout.toLowerCase(),
    });
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'stephanos-sovereign-converge-'));
  const worktree = join(tempRoot, 'worktree');
  let added = false;
  try {
    const add = runGit(
      spawnSyncFn,
      gitExecutable,
      canonicalRoot,
      ['worktree', 'add', '--detach', worktree, request.expectedHead],
      30000,
    );
    if (!add.ok) return fail('SOVEREIGN_PRESERVATION_CONVERGENCE_WORKTREE_FAILED', { status: add.status });
    added = true;

    const merge = runGit(
      spawnSyncFn,
      gitExecutable,
      worktree,
      ['merge', '--no-edit', 'refs/remotes/origin/main'],
      120000,
    );
    if (!merge.ok) {
      runGit(spawnSyncFn, gitExecutable, worktree, ['merge', '--abort'], 15000);
      return fail('SOVEREIGN_PRESERVATION_CONVERGENCE_CONFLICT_OR_MERGE_FAILED', { status: merge.status });
    }

    const diffCheck = runGit(
      spawnSyncFn,
      gitExecutable,
      worktree,
      ['diff', '--check', 'refs/remotes/origin/main...HEAD'],
      30000,
    );
    if (!diffCheck.ok) return fail('SOVEREIGN_PRESERVATION_CONVERGENCE_DIFF_CHECK_FAILED', { status: diffCheck.status });

    const newHeadRead = runGit(spawnSyncFn, gitExecutable, worktree, ['rev-parse', 'HEAD'], 15000);
    if (!newHeadRead.ok || !SHA40.test(newHeadRead.stdout)) {
      return fail('SOVEREIGN_PRESERVATION_CONVERGENCE_NEW_HEAD_INVALID');
    }
    const newHead = newHeadRead.stdout.toLowerCase();

    const oldAncestor = runGit(
      spawnSyncFn,
      gitExecutable,
      worktree,
      ['merge-base', '--is-ancestor', request.expectedHead, newHead],
      15000,
    );
    const mainAncestor = runGit(
      spawnSyncFn,
      gitExecutable,
      worktree,
      ['merge-base', '--is-ancestor', request.expectedMain, newHead],
      15000,
    );
    if (!oldAncestor.ok || !mainAncestor.ok) {
      return fail('SOVEREIGN_PRESERVATION_CONVERGENCE_ANCESTRY_NOT_PRESERVED');
    }

    const refetch = runGit(
      spawnSyncFn,
      gitExecutable,
      canonicalRoot,
      ['fetch', '--no-tags', 'origin', request.branch],
      120000,
    );
    if (!refetch.ok) return fail('SOVEREIGN_PRESERVATION_CONVERGENCE_REFETCH_FAILED', { status: refetch.status });
    const remoteBeforePush = runGit(
      spawnSyncFn,
      gitExecutable,
      canonicalRoot,
      ['rev-parse', `refs/remotes/origin/${request.branch}`],
      15000,
    );
    if (!remoteBeforePush.ok || remoteBeforePush.stdout.toLowerCase() !== request.expectedHead) {
      return fail('SOVEREIGN_PRESERVATION_CONVERGENCE_WRITER_RACE_DETECTED', {
        observedHead: remoteBeforePush.stdout.toLowerCase(),
      });
    }

    let pushed = false;
    if (newHead !== request.expectedHead) {
      const push = runGit(
        spawnSyncFn,
        gitExecutable,
        worktree,
        ['push', 'origin', `HEAD:refs/heads/${request.branch}`],
        120000,
      );
      if (!push.ok) return fail('SOVEREIGN_PRESERVATION_CONVERGENCE_NON_FORCE_PUSH_REJECTED', { status: push.status });
      pushed = true;
    }

    const verifyFetch = runGit(
      spawnSyncFn,
      gitExecutable,
      canonicalRoot,
      ['fetch', '--no-tags', 'origin', request.branch],
      120000,
    );
    const verified = runGit(
      spawnSyncFn,
      gitExecutable,
      canonicalRoot,
      ['rev-parse', `refs/remotes/origin/${request.branch}`],
      15000,
    );
    if (!verifyFetch.ok || !verified.ok || verified.stdout.toLowerCase() !== newHead) {
      return fail('SOVEREIGN_PRESERVATION_CONVERGENCE_REMOTE_VERIFY_FAILED');
    }

    const receiptCore = frozen({
      schemaVersion: SOVEREIGN_PRESERVATION_CONVERGENCE_SCHEMA,
      timestampUtc: now.toISOString(),
      canonicalOwnerGoal: '#2573',
      relatedPr: request.prNumber,
      branch: request.branch,
      oldHead: request.expectedHead,
      protectedMainHead: request.expectedMain,
      newHead,
      changed: newHead !== request.expectedHead,
      pushed,
      diffCheckPassed: true,
      oldHeadAncestorPreserved: true,
      mainAncestorPreserved: true,
      exactHeadWriterGuard: true,
      nonForcePushOnly: true,
      mergeAuthority: false,
      directMainWriteAllowed: false,
      forcePushAllowed: false,
      rebaseAllowed: false,
      resetAllowed: false,
      leaseSeizureAllowed: false,
      finalVerdict: 'SOVEREIGN_PRESERVATION_CONVERGENCE_COMPLETE',
    });
    const receipt = frozen({ ...receiptCore, proofHash: proofHash(receiptCore) });
    const publication = await publishReceipt(receipt, { env, now });
    if (publication?.ok === false) {
      return fail('SOVEREIGN_PRESERVATION_CONVERGENCE_RECEIPT_PUBLICATION_FAILED', {
        newHead,
        pushed,
      });
    }
    return frozen({ ok: true, ...receipt, publication });
  } finally {
    if (added) runGit(spawnSyncFn, gitExecutable, canonicalRoot, ['worktree', 'remove', worktree], 30000);
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    runGit(spawnSyncFn, gitExecutable, canonicalRoot, ['worktree', 'prune'], 15000);
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = text(argv[index]).replace(/^--/, '');
    values[key] = text(argv[index + 1]);
  }
  return values;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs();
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = await executeSovereignPreservationConvergence({
    repoRoot,
    prNumber: Number(args.pr),
    branch: args.branch,
    expectedHead: args['expected-head'],
    expectedMain: args['expected-main'],
  });
  process.stdout.write(`${SOVEREIGN_PRESERVATION_CONVERGENCE_MARKER}${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
