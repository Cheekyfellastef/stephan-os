import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_BRIDGE_GITHUB_SYNC_AUTHORITY,
  FIXED_SYNC_GIT_COMMANDS,
  createFixedGitAdapter,
  getFixedSyncGitCommand,
} from './battle-bridge-github-sync-executor.mjs';

test('production Git registry contains only fixed read, fetch and ff-only commands', () => {
  const commands = Object.values(FIXED_SYNC_GIT_COMMANDS);
  assert.deepEqual(commands.map((item) => item.id).sort(), [
    'git-current-branch',
    'git-fetch-origin-main',
    'git-local-head',
    'git-merge-base-origin-main',
    'git-merge-ff-only-origin-main',
    'git-origin-main-head',
    'git-origin-url',
    'git-status-porcelain',
  ].sort());
  assert.deepEqual(getFixedSyncGitCommand('git-merge-ff-only-origin-main').argv, ['merge', '--ff-only', 'origin/main']);
  assert.throws(() => getFixedSyncGitCommand('git-reset-hard'), /Unsupported/);
  const argv = commands.flatMap((command) => command.argv);
  for (const forbidden of ['reset', 'clean', 'stash', 'rebase', 'checkout', 'switch', 'push', 'branch']) {
    assert.equal(argv.includes(forbidden), false, `forbidden Git verb present: ${forbidden}`);
  }
});

test('production adapter always executes git with shell disabled', () => {
  const calls = [];
  const adapter = createFixedGitAdapter({
    spawnSyncFn: (executable, argv, options) => {
      calls.push({ executable, argv, options });
      return { status: 0, stdout: 'main\n', stderr: '' };
    },
  });
  const result = adapter.run('git-current-branch', '/canonical/repo');
  assert.equal(result.ok, true);
  assert.equal(calls[0].executable, 'git');
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
});

test('authority forbids runtime refresh and live OpenClaw update', () => {
  assert.equal(BATTLE_BRIDGE_GITHUB_SYNC_AUTHORITY.arbitraryShellAllowed, false);
  assert.equal(BATTLE_BRIDGE_GITHUB_SYNC_AUTHORITY.runtimeRefreshAllowed, false);
  assert.equal(BATTLE_BRIDGE_GITHUB_SYNC_AUTHORITY.liveOpenClawUpdateAllowed, false);
  assert.equal(BATTLE_BRIDGE_GITHUB_SYNC_AUTHORITY.mergeToGitHubAllowed, false);
});
