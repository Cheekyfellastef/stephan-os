import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  BATTLE_BRIDGE_SYNC_HOUSEKEEPER_COMMAND,
  FIXED_SYNC_GIT_COMMANDS,
  SYNC_LOCK_STALE_AFTER_MS,
  runBattleBridgeGitHubSync,
  runBoundedSyncHousekeeper,
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

function fakeGit({
  branch = 'main',
  origin = 'https://github.com/Cheekyfellastef/stephan-os.git',
  status = '',
  statusAfterHousekeep = status,
  localBefore = A,
  remote = A,
  mergeBase = A,
  fetchOk = true,
  mergeOk = true,
} = {}) {
  const calls = [];
  let statusReads = 0;
  let mergeApplied = false;
  const outputs = {
    [FIXED_SYNC_GIT_COMMANDS.currentBranch.id]: () => ({ ok: true, stdout: `${branch}\n` }),
    [FIXED_SYNC_GIT_COMMANDS.originUrl.id]: () => ({ ok: true, stdout: `${origin}\n` }),
    [FIXED_SYNC_GIT_COMMANDS.statusPorcelain.id]: () => ({ ok: true, stdout: statusReads++ === 0 ? status : statusAfterHousekeep }),
    [FIXED_SYNC_GIT_COMMANDS.localHead.id]: () => ({ ok: true, stdout: `${mergeApplied ? remote : localBefore}\n` }),
    [FIXED_SYNC_GIT_COMMANDS.fetchOriginMain.id]: () => ({ ok: fetchOk, stdout: '', stderr: fetchOk ? '' : 'fetch failed' }),
    [FIXED_SYNC_GIT_COMMANDS.remoteHead.id]: () => ({ ok: true, stdout: `${remote}\n` }),
    [FIXED_SYNC_GIT_COMMANDS.mergeBase.id]: () => ({ ok: true, stdout: `${mergeBase}\n` }),
    [FIXED_SYNC_GIT_COMMANDS.mergeFfOnlyOriginMain.id]: () => {
      if (mergeOk) mergeApplied = true;
      return { ok: mergeOk, stdout: '', stderr: mergeOk ? '' : 'ff failed' };
    },
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

function housekeeperObservation({ state = 'READY', sourceDirtCount = 0, hardBlockCount = 0 } = {}) {
  return Object.freeze({
    schemaVersion: 'stephanos.battle-bridge-sync-housekeeper-observation.v1',
    attempted: true,
    state,
    reason: state === 'READY' ? 'HOUSEKEEPER_ALLOWLISTS_CONVERGED' : 'HOUSEKEEPER_PRESERVED_BLOCKING_DIRT',
    exitCode: state === 'READY' ? 0 : 1,
    readyToEnterCommandDeck: state === 'READY',
    sourceDirtCount,
    hardBlockCount,
    dependencyWarningCount: 0,
    autoCleanedCount: 0,
    runtimeCleanedCount: 0,
    openClawWorkspaceMovedCount: 0,
    sourceOwnedMutationAllowed: false,
    rawPathValuesPublished: false,
    arbitraryShellAllowed: false,
    commandIdentity: BATTLE_BRIDGE_SYNC_HOUSEKEEPER_COMMAND.id,
  });
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
    assert.equal(status.authority.delegatedHousekeeperAllowlistedCleanupAllowed, true);
    assert.equal(status.authority.delegatedHousekeeperExactHeadBound, true);
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

test('dirty untracked source invokes the existing Housekeeper once at the exact local head, rechecks, and remains blocked when source dirt survives', async () => {
  const fx = await fixture();
  try {
    const git = fakeGit({ status: '?? scripts/local-work.mjs\n' });
    let housekeeperCalls = 0;
    const result = await runBattleBridgeGitHubSync({
      paths: fx.paths,
      expectedPaths: fx.expectedPaths,
      git,
      housekeeperFn: ({ expectedHead }) => {
        housekeeperCalls += 1;
        assert.equal(expectedHead, A);
        return housekeeperObservation({ state: 'BLOCKED', sourceDirtCount: 1 });
      },
    });
    assert.equal(housekeeperCalls, 1);
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.BLOCKED_DIRTY_SOURCE);
    assert.equal(result.housekeeperObservation.state, 'BLOCKED');
    assert.equal(result.housekeeperObservation.rawPathValuesPublished, false);
    assert.ok(!git.calls.includes('git-fetch-origin-main'));
    assert.ok(!git.calls.includes('git-merge-ff-only-origin-main'));
    const status = await readStatus(fx.workspaceRoot);
    assert.equal(status.housekeeperObservation.state, 'BLOCKED');
    assert.equal(status.housekeeperObservation.sourceDirtCount, 1);
    assert.equal(status.housekeeperObservation.rawPathValuesPublished, false);
    assert.equal('ignitionHardBlockPaths' in status.housekeeperObservation, false);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('Housekeeper-cleared untracked dirt is re-proved before fetch and can return to ordinary no-change sync', async () => {
  const fx = await fixture();
  try {
    const git = fakeGit({ status: '?? AGENTS.md\n', statusAfterHousekeep: '' });
    let housekeeperCalls = 0;
    const result = await runBattleBridgeGitHubSync({
      paths: fx.paths,
      expectedPaths: fx.expectedPaths,
      git,
      housekeeperFn: ({ expectedHead }) => {
        housekeeperCalls += 1;
        assert.equal(expectedHead, A);
        return housekeeperObservation({ state: 'READY' });
      },
    });
    assert.equal(housekeeperCalls, 1);
    assert.equal(result.ok, true);
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE);
    assert.ok(git.calls.includes('git-fetch-origin-main'));
    assert.ok(!git.calls.includes('git-merge-ff-only-origin-main'));
    const status = await readStatus(fx.workspaceRoot);
    assert.equal(status.housekeeperObservation.state, 'READY');
    assert.equal(status.housekeeperObservation.rawPathValuesPublished, false);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('tracked source dirt skips Housekeeper execution, blocks before fetch, and preserves all local work', async () => {
  const fx = await fixture();
  try {
    const git = fakeGit({ status: ' M scripts/local-work.mjs\n' });
    let housekeeperCalls = 0;
    const result = await runBattleBridgeGitHubSync({
      paths: fx.paths,
      expectedPaths: fx.expectedPaths,
      git,
      housekeeperFn: () => {
        housekeeperCalls += 1;
        return housekeeperObservation();
      },
    });
    assert.equal(housekeeperCalls, 0);
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.BLOCKED_DIRTY_SOURCE);
    assert.equal(result.housekeeperObservation.state, 'SKIPPED_FAIL_CLOSED');
    assert.equal(result.housekeeperObservation.reason, 'HOUSEKEEPER_TRACKED_SOURCE_DIRT_PRESENT');
    assert.ok(!git.calls.includes('git-fetch-origin-main'));
    assert.ok(!git.calls.includes('git-merge-ff-only-origin-main'));
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('bounded Housekeeper subprocess uses the exact-head runner, minimal Git environment, and publishes counts rather than paths', () => {
  const calls = [];
  const observation = runBoundedSyncHousekeeper({
    repoRoot: '/canonical/repo',
    expectedHead: A,
    platform: 'linux',
    environment: { PATH: '/attacker', NODE_OPTIONS: '--require=/attacker/inject.cjs', HOME: '/home/test' },
    spawnSyncFn: (command, argv, options) => {
      calls.push({ command, argv, options });
      return {
        status: 1,
        stdout: `[HOUSEKEEP] status=${JSON.stringify({
          ignitionReadyToEnterCommandDeck: false,
          ignitionSourceDirtCount: 2,
          ignitionHardBlockCount: 1,
          ignitionDependencyWarningCount: 3,
          ignitionAutoCleaned: 4,
          ignitionRuntimeCleaned: 5,
          ignitionOpenClawWorkspaceMoved: 0,
          ignitionHardBlockPaths: ['secret-shaped-path'],
        })}\n`,
        stderr: 'local detail that must not be published',
      };
    },
  });
  assert.equal(BATTLE_BRIDGE_SYNC_HOUSEKEEPER_COMMAND.exactHeadBound, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].argv, ['/canonical/repo/scripts/battle-bridge-sync-housekeeper-runner.mjs']);
  assert.equal(calls[0].options.cwd, '/canonical/repo');
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.env.PATH, '/usr/bin:/bin');
  assert.equal(calls[0].options.env.NODE_OPTIONS, undefined);
  assert.equal(calls[0].options.env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(calls[0].options.env.STEPHANOS_EXPECTED_HEAD, A);
  assert.equal(observation.state, 'BLOCKED');
  assert.equal(observation.sourceDirtCount, 2);
  assert.equal(observation.hardBlockCount, 1);
  assert.equal(observation.autoCleanedCount, 4);
  assert.equal(observation.runtimeCleanedCount, 5);
  assert.equal(observation.rawPathValuesPublished, false);
  assert.equal('ignitionHardBlockPaths' in observation, false);
  assert.equal(JSON.stringify(observation).includes('secret-shaped-path'), false);
  assert.equal(JSON.stringify(observation).includes('local detail'), false);
});

test('bounded Housekeeper refuses to spawn without a concrete exact local head', () => {
  let spawnCalls = 0;
  const observation = runBoundedSyncHousekeeper({
    repoRoot: '/canonical/repo',
    expectedHead: 'not-a-sha',
    platform: 'linux',
    spawnSyncFn: () => {
      spawnCalls += 1;
      throw new Error('must not spawn');
    },
  });
  assert.equal(spawnCalls, 0);
  assert.equal(observation.attempted, false);
  assert.equal(observation.state, 'UNPROVEN');
  assert.equal(observation.reason, 'HOUSEKEEPER_EXPECTED_HEAD_INVALID');
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