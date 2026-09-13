import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  createReadOnlyPullRequestGitProbe,
  parseGitWorktreeListPorcelainZ,
  reproveReadOnlyPullRequestWorktree,
  resolveReadOnlyPullRequestWorktree,
} from './readOnlyPullRequestWorktreeV1.mjs';

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);
const CANONICAL = resolve('C:\\repo');
const ALLOWED = resolve('C:\\allowed');
const FIRST = resolve(ALLOWED, 'first');
const SECOND = resolve(ALLOWED, 'second');
const COMMON = resolve('C:\\repo\\.git');

function record(path, head, extras = []) {
  return [`worktree ${path}`, `HEAD ${head}`, 'branch refs/heads/example', ...extras, ''].join('\0');
}

function probe({ candidates = [FIRST], dirty = new Set(), ignored = new Set(), foreign = new Set(), moved = new Set() } = {}) {
  const calls = [];
  const fn = (root, args) => {
    const repositoryRoot = resolve(root);
    const command = args.join(' ');
    calls.push({ repositoryRoot, command });
    if (repositoryRoot === CANONICAL && command === 'worktree list --porcelain -z') {
      return { ok: true, status: 0, stdout: [record(CANONICAL, OTHER_HEAD), ...candidates.map((path) => record(path, HEAD))].join('\0'), stderr: '' };
    }
    if (command === 'rev-parse --path-format=absolute --git-common-dir') {
      return { ok: true, status: 0, stdout: foreign.has(repositoryRoot) ? resolve('C:\\foreign\\.git') : COMMON, stderr: '' };
    }
    if (command === 'rev-parse --is-inside-work-tree') return { ok: true, status: 0, stdout: 'true', stderr: '' };
    if (command === 'rev-parse HEAD') return { ok: true, status: 0, stdout: moved.has(repositoryRoot) ? OTHER_HEAD : HEAD, stderr: '' };
    if (command === 'status --porcelain=v2 --untracked-files=all') return { ok: true, status: 0, stdout: dirty.has(repositoryRoot) ? '1 .M file.mjs' : '', stderr: '' };
    if (command === 'ls-files --others --ignored --exclude-standard') return { ok: true, status: 0, stdout: ignored.has(repositoryRoot) ? 'node_modules/hostile.md' : '', stderr: '' };
    return { ok: false, status: 1, stdout: '', stderr: 'unexpected probe' };
  };
  fn.calls = calls;
  return fn;
}

const filesystem = {
  realpath: (path) => resolve(path),
  lstat: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
};

function resolveCandidate(overrides = {}) {
  return resolveReadOnlyPullRequestWorktree({
    canonicalRepositoryRoot: CANONICAL,
    expectedHead: HEAD,
    proofTarget: 'PULL_REQUEST_HEAD_BASE_BOUND',
    allowedRoots: [ALLOWED],
    filesystem,
    ...overrides,
  });
}

test('parses bounded NUL-delimited linked worktree records', () => {
  assert.deepEqual(parseGitWorktreeListPorcelainZ(record(FIRST, HEAD)), [{
    worktree: FIRST,
    head: HEAD,
    branch: 'refs/heads/example',
    bare: false,
    prunable: false,
  }]);
  assert.deepEqual(parseGitWorktreeListPorcelainZ(''), []);
  assert.deepEqual(parseGitWorktreeListPorcelainZ('x'.repeat(300_000)), []);
});

test('fixed Git probes discard ambient repository, object-store, replacement, and configuration authority', () => {
  const calls = [];
  const gitProbe = createReadOnlyPullRequestGitProbe({
    platform: 'win32',
    environment: {
      SYSTEMROOT: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\Operator',
      GIT_DIR: 'C:\\hostile.git',
      Git_Work_Tree: 'C:\\hostile-worktree',
      GIT_OBJECT_DIRECTORY: 'C:\\hostile-objects',
      GIT_REPLACE_REF_BASE: 'refs/hostile',
      GIT_CONFIG_GLOBAL: 'C:\\hostile.gitconfig',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'alias.status',
      GIT_CONFIG_VALUE_0: '!hostile',
    },
    spawnSyncFn(executable, args, options) {
      calls.push({ executable, args, options });
      return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
    },
  });
  assert.equal(gitProbe(CANONICAL, ['rev-parse', 'HEAD']).stdout, HEAD);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, 'C:\\Program Files\\Git\\cmd\\git.exe');
  assert.ok(calls[0].args.includes('-C'));
  assert.deepEqual(calls[0].args.slice(-2), ['rev-parse', 'HEAD']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.env.GIT_DIR, undefined);
  assert.equal(calls[0].options.env.Git_Work_Tree, undefined);
  assert.equal(calls[0].options.env.GIT_OBJECT_DIRECTORY, undefined);
  assert.equal(calls[0].options.env.GIT_REPLACE_REF_BASE, undefined);
  assert.equal(calls[0].options.env.GIT_NO_REPLACE_OBJECTS, '1');
  assert.equal(calls[0].options.env.GIT_CONFIG_NOSYSTEM, '1');
  assert.notEqual(calls[0].options.env.GIT_CONFIG_VALUE_0, '!hostile');
});

test('resolves one exact clean linked worktree without caller-selected path authority', () => {
  const gitProbe = probe();
  const result = resolveCandidate({ gitProbe });
  assert.equal(result.ok, true);
  assert.equal(result.worktree.repositoryRoot, FIRST);
  assert.equal(result.worktree.sourceHead, HEAD);
  assert.equal(result.worktree.sourceMutationAllowed, false);
  assert.equal(result.worktree.cleanTrackedAndUntracked, true);
  assert.equal(result.worktree.ignoredFilesAbsent, true);
  assert.ok(gitProbe.calls.some((call) => call.command === 'worktree list --porcelain -z'));
});

test('fails closed on ambiguity, dirt, ignored files, foreign Git identity, or no exact head', () => {
  const cases = [
    [probe({ candidates: [FIRST, SECOND] }), 'READ_ONLY_PR_WORKTREE_CANDIDATE_AMBIGUOUS'],
    [probe({ dirty: new Set([FIRST]) }), 'READ_ONLY_PR_WORKTREE_EXACT_CLEAN_CANDIDATE_NOT_FOUND'],
    [probe({ ignored: new Set([FIRST]) }), 'READ_ONLY_PR_WORKTREE_EXACT_CLEAN_CANDIDATE_NOT_FOUND'],
    [probe({ foreign: new Set([FIRST]) }), 'READ_ONLY_PR_WORKTREE_EXACT_CLEAN_CANDIDATE_NOT_FOUND'],
    [probe({ candidates: [] }), 'READ_ONLY_PR_WORKTREE_EXACT_CLEAN_CANDIDATE_NOT_FOUND'],
  ];
  for (const [gitProbe, blocker] of cases) {
    const result = resolveCandidate({ gitProbe });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, blocker);
  }
});

test('rejects non-PR targets, unsafe roots, symlinks, and paths outside the bounded roots', () => {
  assert.equal(resolveCandidate({ proofTarget: 'MERGED_MAIN', gitProbe: probe() }).blocker, 'READ_ONLY_PR_WORKTREE_TARGET_INVALID');
  assert.equal(resolveCandidate({ allowedRoots: [], gitProbe: probe() }).blocker, 'READ_ONLY_PR_WORKTREE_ALLOWED_ROOTS_INVALID');
  assert.equal(resolveCandidate({
    gitProbe: probe(),
    filesystem: { ...filesystem, lstat: () => ({ isDirectory: () => true, isSymbolicLink: () => true }) },
  }).blocker, 'READ_ONLY_PR_WORKTREE_EXACT_CLEAN_CANDIDATE_NOT_FOUND');
  assert.equal(resolveCandidate({ allowedRoots: [resolve('C:\\elsewhere')], gitProbe: probe() }).blocker, 'READ_ONLY_PR_WORKTREE_EXACT_CLEAN_CANDIDATE_NOT_FOUND');
});

test('reproves shared Git identity, exact head, and complete cleanliness immediately before dispatch', () => {
  const initial = resolveCandidate({ gitProbe: probe() });
  assert.equal(initial.ok, true);
  assert.equal(reproveReadOnlyPullRequestWorktree(initial.worktree, {
    canonicalRepositoryRoot: CANONICAL,
    gitProbe: probe(),
  }).ok, true);
  assert.equal(reproveReadOnlyPullRequestWorktree(initial.worktree, {
    canonicalRepositoryRoot: CANONICAL,
    gitProbe: probe({ moved: new Set([FIRST]) }),
  }).blocker, 'READ_ONLY_PR_WORKTREE_HEAD_CHANGED');
  assert.equal(reproveReadOnlyPullRequestWorktree(initial.worktree, {
    canonicalRepositoryRoot: CANONICAL,
    gitProbe: probe({ dirty: new Set([FIRST]) }),
  }).blocker, 'READ_ONLY_PR_WORKTREE_CLEANLINESS_CHANGED');
  assert.equal(reproveReadOnlyPullRequestWorktree(initial.worktree, {
    canonicalRepositoryRoot: CANONICAL,
    gitProbe: probe({ foreign: new Set([FIRST]) }),
  }).blocker, 'READ_ONLY_PR_WORKTREE_IDENTITY_CHANGED');
});
