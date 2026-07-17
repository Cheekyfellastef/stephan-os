import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  FIXED_SYNC_GIT_COMMANDS,
  SYNC_LOCK_STALE_AFTER_MS,
  runBattleBridgeGitHubSync,
  validateCanonicalSyncPaths,
} from './battle-bridge-github-sync-executor.mjs';
import { SYNC_CLASSIFICATIONS } from './battle-bridge-github-sync-policy.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bb-sync-'));
  const home = path.join(root, 'home');
  const repoRoot = path.join(home, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.join(home, 'Documents', 'Stephanos-openclaw-workspace');
  await mkdir(repoRoot, { recursive: true });
  return { root, home, repoRoot, workspaceRoot, paths: { repoRoot, workspaceRoot }, expectedPaths: { repoRoot, workspaceRoot } };
}

function fakeGit({ branch = 'main', origin = 'https://github.com/Cheekyfellastef/stephan-os.git', status = '', localBefore = A, remote = A, mergeBase = A, fetchOk = true, mergeOk = true } = {}) {
  const calls = [];
  let localReads = 0;
  const outputs = {
    [FIXED_SYNC_GIT_COMMANDS.currentBranch.id]: () => ({ ok: true, stdout: `${branch}\n` }),
    [FIXED_SYNC_GIT_COMMANDS.originUrl.id]: () => ({ ok: true, stdout: `${origin}\n` }),
    [FIXED_SYNC_GIT_COMMANDS.statusPorcelain.id]: () => ({ ok: true, stdout: status }),
    [FIXED_SYNC_GIT_COMMANDS.localHead.id]: () => ({ ok: true, stdout: `${localReads++ === 0 ? localBefore : remote}\n` }),
    [FIXED_SYNC_GIT_COMMANDS.fetchOriginMain.id]: () => ({ ok: fetchOk, stdout: '', stderr: fetchOk ? '' : 'fetch failed' }),
    [FIXED_SYNC_GIT_COMMANDS.remoteHead.id]: () => ({ ok: true, stdout: `${remote}\n` }),
    [FIXED_SYNC_GIT_COMMANDS.mergeBase.id]: () => ({ ok: true, stdout: `${mergeBase}\n` }),
    [FIXED_SYNC_GIT_COMMANDS.mergeFfOnlyOriginMain.id]: () => ({ ok: mergeOk, stdout: '', stderr: mergeOk ? '' : 'ff failed' }),
  };
  return {
    calls,
    run(id) {
      calls.push(id);
      const result = outputs[id]?.();
      if (!result) throw new Error(`unexpected command ${id}`);
      return { status: result.ok ? 0 : 1, mutation: id === FIXED_SYNC_GIT_COMMANDS.mergeFfOnlyOriginMain.id, commandId: id, performsShellExecution: false, error: '', ...result };
    },
  };
}

async function readStatus(workspaceRoot) {
  return JSON.parse(await readFile(path.join(workspaceRoot, 'status', 'battle-bridge-github-sync-current.json'), 'utf8'));
}

test('canonical path validator rejects arbitrary repository and overlapping workspace', () => {
  const expectedPaths = { repoRoot: '/home/u/Documents/GitHub/stephan-os', workspaceRoot: '/home/u/Documents/Stephanos-openclaw-workspace' };
  assert.equal(validateCanonicalSyncPaths({ repoRoot: '/tmp/other', workspaceRoot: expectedPaths.workspaceRoot, expectedPaths }).ok, false);
  assert.equal(validateCanonicalSyncPaths({ repoRoot: expectedPaths.repoRoot, workspaceRoot: '/home/u/Documents/GitHub/stephan-os/runtime', expectedPaths: { repoRoot: expectedPaths.repoRoot, workspaceRoot: '/home/u/Documents/GitHub/stephan-os/runtime' } }).ok, false);
});

test('no-change run fetches safely and publishes auditable external receipt', async () => {
  const fx = await fixture();
  try {
    const git = fakeGit();
    const result = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.expectedPaths, git, now: new Date('2026-07-14T20:00:00Z') });
    assert.equal(result.ok, true);
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE);
    assert.ok(git.calls.includes('git-fetch-origin-main'));
    assert.ok(!git.calls.includes('git-merge-ff-only-origin-main'));
    const status = await readStatus(fx.workspaceRoot);
    assert.equal(status.schemaVersion, 'shared-agent-workspace-record.v1');
    assert.equal(status.kind, 'stephanos.shared_workspace.status');
    assert.equal(status.classification, SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE);
    assert.equal(status.authority.liveOpenClawUpdateAllowed, false);
    assert.equal(status.proofRefs.length, 1);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('runtime-only dist dirt is counted without publishing forbidden generated paths', async () => {
  const fx = await fixture();
  try {
    const git = fakeGit({ status: ' M apps/stephanos/dist/index.html\n?? apps/stephanos/dist/assets/generated.js\n' });
    const result = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.expectedPaths, git, now: new Date('2026-07-14T20:00:30Z') });
    assert.equal(result.ok, true);
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE);
    assert.deepEqual(result.evaluation.dirt.runtimeOnly, [
      'apps/stephanos/dist/index.html',
      'apps/stephanos/dist/assets/generated.js',
    ]);
    const status = await readStatus(fx.workspaceRoot);
    assert.equal(status.dirtClassification.runtimeOnlyCount, 2);
    assert.equal(status.dirtClassification.blocksSync, false);
    assert.equal(status.dirtClassification.pathValuesPublished, false);
    assert.doesNotMatch(JSON.stringify(status), /apps\/stephanos\/dist/);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('clean fast-forward applies only ff-only source update then stops for refresh proof', async () => {
  const fx = await fixture();
  try {
    const git = fakeGit({ remote: B, mergeBase: A });
    const result = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.expectedPaths, git, now: new Date('2026-07-14T20:01:00Z') });
    assert.equal(result.sourceUpdated, true);
    assert.equal(result.runtimeRefreshPerformed, false);
    assert.equal(result.liveOpenClawUpdatePerformed, false);
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.BLOCKED_POST_SYNC_REFRESH_REQUIRED);
    assert.equal(result.facts.localHeadAfter, B);
    assert.deepEqual(git.calls.filter((id) => id === 'git-merge-ff-only-origin-main'), ['git-merge-ff-only-origin-main']);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('dirty source blocks before fetch and preserves all local work', async () => {
  const fx = await fixture();
  try {
    const git = fakeGit({ status: ' M scripts/local-work.mjs\n' });
    const result = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.expectedPaths, git });
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.BLOCKED_DIRTY_SOURCE);
    assert.ok(!git.calls.includes('git-fetch-origin-main'));
    assert.ok(!git.calls.includes('git-merge-ff-only-origin-main'));
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('wrong remote and non-main branch block before fetch', async () => {
  for (const options of [{ origin: 'https://evil.example/Cheekyfellastef/stephan-os.git' }, { branch: 'feature' }]) {
    const fx = await fixture();
    try {
      const git = fakeGit(options);
      const result = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.expectedPaths, git });
      assert.ok([SYNC_CLASSIFICATIONS.BLOCKED_REMOTE_MISMATCH, SYNC_CLASSIFICATIONS.BLOCKED_NON_MAIN_BRANCH].includes(result.evaluation.classification));
      assert.ok(!git.calls.includes('git-fetch-origin-main'));
    } finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});

test('fetch, divergence and ff-only failures fail closed', async () => {
  const cases = [
    [{ fetchOk: false }, SYNC_CLASSIFICATIONS.BLOCKED_FETCH_FAILED],
    [{ remote: B, mergeBase: 'c'.repeat(40) }, SYNC_CLASSIFICATIONS.BLOCKED_DIVERGED_HISTORY],
    [{ remote: B, mergeBase: A, mergeOk: false }, SYNC_CLASSIFICATIONS.BLOCKED_FAST_FORWARD_FAILED],
  ];
  for (const [options, expected] of cases) {
    const fx = await fixture();
    try {
      const result = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.expectedPaths, git: fakeGit(options) });
      assert.equal(result.evaluation.classification, expected);
    } finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});

test('stale dead-process lock is recovered once and does not permanently stall the watcher', async () => {
  const fx = await fixture();
  try {
    const now = new Date('2026-07-14T20:30:00Z');
    const lockPath = path.join(fx.workspaceRoot, 'locks', 'battle-bridge-github-sync.lock');
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({ pid: 123, acquiredAtUtc: new Date(now.getTime() - SYNC_LOCK_STALE_AFTER_MS - 1).toISOString() })}\n`);
    const result = await runBattleBridgeGitHubSync({
      paths: fx.paths,
      expectedPaths: fx.expectedPaths,
      git: fakeGit(),
      now,
      processIsAliveFn: () => false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('malformed stale lock is recovered from bounded file age', async () => {
  const fx = await fixture();
  try {
    const now = new Date('2026-07-14T20:30:00Z');
    const lockPath = path.join(fx.workspaceRoot, 'locks', 'battle-bridge-github-sync.lock');
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, '');
    const old = new Date(now.getTime() - SYNC_LOCK_STALE_AFTER_MS - 1);
    await utimes(lockPath, old, old);
    const result = await runBattleBridgeGitHubSync({
      paths: fx.paths,
      expectedPaths: fx.expectedPaths,
      git: fakeGit(),
      now,
      processIsAliveFn: () => false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('single-instance lock fails closed and remains auditable', async () => {
  const fx = await fixture();
  try {
    const lockPath = path.join(fx.workspaceRoot, 'locks', 'battle-bridge-github-sync.lock');
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({ pid: 123, acquiredAtUtc: new Date().toISOString() })}\n`);
    const result = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.expectedPaths, git: fakeGit(), processIsAliveFn: () => true });
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.BLOCKED_INSTALL_OR_PERMISSION_REQUIRED);
    assert.equal(result.lock.reason, 'SYNC_ALREADY_RUNNING');
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('missing canonical repository fails before any Git command', async () => {
  const fx = await fixture();
  try {
    await rm(fx.repoRoot, { recursive: true, force: true });
    const git = fakeGit();
    const result = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.expectedPaths, git });
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.BLOCKED_INSTALL_OR_PERMISSION_REQUIRED);
    assert.deepEqual(git.calls, []);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});
