import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveBattleBridgeGitExecution } from './battleBridgeExecutionBoundaryV1.mjs';

export const READ_ONLY_PULL_REQUEST_WORKTREE_SCHEMA = 'stephanos.read-only-pull-request-worktree.v1';

const SHA40 = /^[0-9a-f]{40}$/i;
const MAX_WORKTREE_LIST_BYTES = 256 * 1024;
const MAX_WORKTREES = 256;

function blocked(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function pathIdentity(value) {
  const normalized = resolve(String(value || ''));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isWithin(candidate, root) {
  const child = pathIdentity(candidate);
  const parent = pathIdentity(root);
  const delta = relative(parent, child);
  return delta === '' || (!delta.startsWith('..') && !isAbsolute(delta));
}

function defaultAllowedRoots() {
  const home = homedir();
  return Object.freeze([
    resolve(home, '.codex', 'visualizations'),
    resolve(home, 'Documents', 'GitHub', 'stephan-os-worktrees'),
  ]);
}

export function createReadOnlyPullRequestGitProbe({
  environment = process.env,
  platform = process.platform,
  spawnSyncFn = spawnSync,
} = {}) {
  const execution = resolveBattleBridgeGitExecution({ platform, environment });
  return function probe(repositoryRoot, args) {
    const result = spawnSyncFn(execution.executable, [...execution.fixedConfigArgs, '-C', repositoryRoot, ...args], {
      encoding: 'utf8',
      env: execution.environment,
      windowsHide: true,
      shell: false,
      timeout: 20_000,
      maxBuffer: MAX_WORKTREE_LIST_BYTES,
    });
    return Object.freeze({
      ok: result.status === 0 && !result.error,
      status: Number.isInteger(result.status) ? result.status : -1,
      stdout: String(result.stdout || '').trim(),
      stderr: String(result.stderr || '').trim().slice(0, 400),
    });
  };
}

export function parseGitWorktreeListPorcelainZ(payload) {
  const bytes = Buffer.byteLength(String(payload || ''), 'utf8');
  if (bytes === 0 || bytes > MAX_WORKTREE_LIST_BYTES) return [];
  const records = [];
  let current = null;
  for (const token of String(payload).split('\0')) {
    if (!token) {
      if (current) records.push(Object.freeze(current));
      current = null;
      continue;
    }
    const separator = token.indexOf(' ');
    const key = separator === -1 ? token : token.slice(0, separator);
    const value = separator === -1 ? true : token.slice(separator + 1);
    if (key === 'worktree') {
      if (current) records.push(Object.freeze(current));
      current = { worktree: String(value), head: '', branch: '', bare: false, prunable: false };
    } else if (current && key === 'HEAD') current.head = String(value).toLowerCase();
    else if (current && key === 'branch') current.branch = String(value);
    else if (current && key === 'bare') current.bare = true;
    else if (current && key === 'prunable') current.prunable = true;
  }
  if (current) records.push(Object.freeze(current));
  return records.slice(0, MAX_WORKTREES);
}

function physicalDirectory(path, allowedRoots, filesystem = {}) {
  const realpath = filesystem.realpath || realpathSync.native;
  const lstat = filesystem.lstat || lstatSync;
  try {
    const requested = resolve(path);
    const physical = realpath(requested);
    const stats = lstat(physical);
    if (!stats.isDirectory() || stats.isSymbolicLink()) return null;
    if (pathIdentity(requested) !== pathIdentity(physical)) return null;
    if (!allowedRoots.some((root) => isWithin(physical, root))) return null;
    return physical;
  } catch {
    return null;
  }
}

function exactGitIdentity(repositoryRoot, gitProbe) {
  const common = gitProbe(repositoryRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return common.ok && common.stdout ? pathIdentity(common.stdout) : '';
}

function inspectCandidate({
  candidate,
  expectedHead,
  canonicalCommonDirectory,
  allowedRoots,
  gitProbe,
  filesystem,
}) {
  if (candidate.bare || candidate.prunable || candidate.head !== expectedHead) return null;
  const repositoryRoot = physicalDirectory(candidate.worktree, allowedRoots, filesystem);
  if (!repositoryRoot) return null;
  const inside = gitProbe(repositoryRoot, ['rev-parse', '--is-inside-work-tree']);
  const head = gitProbe(repositoryRoot, ['rev-parse', 'HEAD']);
  const commonDirectory = exactGitIdentity(repositoryRoot, gitProbe);
  const status = gitProbe(repositoryRoot, ['status', '--porcelain=v2', '--untracked-files=all']);
  const ignored = gitProbe(repositoryRoot, ['ls-files', '--others', '--ignored', '--exclude-standard']);
  if (!inside.ok || inside.stdout !== 'true'
      || !head.ok || head.stdout.toLowerCase() !== expectedHead
      || !commonDirectory || commonDirectory !== canonicalCommonDirectory
      || !status.ok || status.stdout
      || !ignored.ok || ignored.stdout) return null;
  return Object.freeze({
    schemaVersion: READ_ONLY_PULL_REQUEST_WORKTREE_SCHEMA,
    repositoryRoot,
    sourceHead: expectedHead,
    commonDirectory,
    cleanTrackedAndUntracked: true,
    ignoredFilesAbsent: true,
    sourceMutationAllowed: false,
  });
}

export function resolveReadOnlyPullRequestWorktree({
  canonicalRepositoryRoot,
  expectedHead,
  proofTarget,
  allowedRoots = defaultAllowedRoots(),
  gitProbe = createReadOnlyPullRequestGitProbe(),
  filesystem = {},
} = {}) {
  const canonicalRoot = resolve(String(canonicalRepositoryRoot || ''));
  const head = String(expectedHead || '').toLowerCase();
  if (!['PULL_REQUEST_HEAD', 'PULL_REQUEST_HEAD_BASE_BOUND'].includes(proofTarget)) {
    return blocked('READ_ONLY_PR_WORKTREE_TARGET_INVALID');
  }
  if (!SHA40.test(head)) return blocked('READ_ONLY_PR_WORKTREE_HEAD_INVALID');
  if (!Array.isArray(allowedRoots) || allowedRoots.length < 1 || allowedRoots.length > 8) {
    return blocked('READ_ONLY_PR_WORKTREE_ALLOWED_ROOTS_INVALID');
  }
  const physicalRoots = allowedRoots.map((root) => resolve(String(root || ''))).filter(Boolean);
  const canonicalCommonDirectory = exactGitIdentity(canonicalRoot, gitProbe);
  if (!canonicalCommonDirectory) return blocked('READ_ONLY_PR_WORKTREE_CANONICAL_IDENTITY_UNPROVEN');
  const listed = gitProbe(canonicalRoot, ['worktree', 'list', '--porcelain', '-z']);
  if (!listed.ok) return blocked('READ_ONLY_PR_WORKTREE_LIST_UNAVAILABLE');
  const candidates = parseGitWorktreeListPorcelainZ(listed.stdout)
    .filter((candidate) => pathIdentity(candidate.worktree) !== pathIdentity(canonicalRoot))
    .map((candidate) => inspectCandidate({
      candidate,
      expectedHead: head,
      canonicalCommonDirectory,
      allowedRoots: physicalRoots,
      gitProbe,
      filesystem,
    }))
    .filter(Boolean);
  if (candidates.length === 0) return blocked('READ_ONLY_PR_WORKTREE_EXACT_CLEAN_CANDIDATE_NOT_FOUND');
  if (candidates.length !== 1) return blocked('READ_ONLY_PR_WORKTREE_CANDIDATE_AMBIGUOUS', { candidateCount: candidates.length });
  return Object.freeze({ ok: true, verdict: 'READ_ONLY_PR_WORKTREE_RESOLVED', worktree: candidates[0] });
}

export function reproveReadOnlyPullRequestWorktree(worktree, {
  canonicalRepositoryRoot,
  gitProbe = createReadOnlyPullRequestGitProbe(),
} = {}) {
  if (worktree?.schemaVersion !== READ_ONLY_PULL_REQUEST_WORKTREE_SCHEMA
      || worktree?.sourceMutationAllowed !== false
      || worktree?.cleanTrackedAndUntracked !== true
      || worktree?.ignoredFilesAbsent !== true
      || !SHA40.test(String(worktree?.sourceHead || ''))) {
    return blocked('READ_ONLY_PR_WORKTREE_RECEIPT_INVALID');
  }
  const expectedHead = String(worktree.sourceHead).toLowerCase();
  const repositoryRoot = resolve(String(worktree.repositoryRoot || ''));
  const canonicalCommonDirectory = exactGitIdentity(resolve(String(canonicalRepositoryRoot || '')), gitProbe);
  const candidateCommonDirectory = exactGitIdentity(repositoryRoot, gitProbe);
  const head = gitProbe(repositoryRoot, ['rev-parse', 'HEAD']);
  const status = gitProbe(repositoryRoot, ['status', '--porcelain=v2', '--untracked-files=all']);
  const ignored = gitProbe(repositoryRoot, ['ls-files', '--others', '--ignored', '--exclude-standard']);
  if (!canonicalCommonDirectory || candidateCommonDirectory !== canonicalCommonDirectory) {
    return blocked('READ_ONLY_PR_WORKTREE_IDENTITY_CHANGED');
  }
  if (!head.ok || head.stdout.toLowerCase() !== expectedHead) return blocked('READ_ONLY_PR_WORKTREE_HEAD_CHANGED');
  if (!status.ok || status.stdout || !ignored.ok || ignored.stdout) return blocked('READ_ONLY_PR_WORKTREE_CLEANLINESS_CHANGED');
  return Object.freeze({ ok: true, verdict: 'READ_ONLY_PR_WORKTREE_REPROVEN', worktree });
}
