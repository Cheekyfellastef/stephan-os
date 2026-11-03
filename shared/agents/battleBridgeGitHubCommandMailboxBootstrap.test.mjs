import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMailboxSelfBootstrapCommand,
  ensureBattleBridgeGitHubCommandMailbox,
} from './battleBridgeGitHubCommandMailboxBootstrap.mjs';

const canonicalRepoRoot = 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os';
const env = { USERPROFILE: 'C:\\Users\\Stephan' };

test('non-Windows hosts skip without mutation', async () => {
  let called = false;
  const result = await ensureBattleBridgeGitHubCommandMailbox({
    platform: 'linux',
    env: {},
    repoRoot: '/workspace/stephan-os',
    run: () => { called = true; },
  });
  assert.equal(result.status, 'MAILBOX_SELF_BOOTSTRAP_SKIPPED_NON_WINDOWS');
  assert.equal(result.ok, true);
  assert.equal(called, false);
});

test('Windows bootstrap is bound to the canonical checkout', async () => {
  const result = await ensureBattleBridgeGitHubCommandMailbox({
    platform: 'win32',
    env,
    repoRoot: 'C:\\temp\\stephan-os',
  });
  assert.equal(result.status, 'MAILBOX_SELF_BOOTSTRAP_BLOCKED_NON_CANONICAL_CHECKOUT');
  assert.equal(result.operatorNeeded, false);
});

test('installer command is fixed and contains no arbitrary shell', () => {
  const command = buildMailboxSelfBootstrapCommand({ repoRoot: canonicalRepoRoot });
  assert.equal(command.executable, 'powershell.exe');
  assert.deepEqual(command.args.slice(0, 5), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
  ]);
  assert.equal(command.args.at(-1), '-StartNow');
  assert.equal(command.arbitraryShellAllowed, false);
  assert.equal(command.liveOpenClawUpdateAllowed, false);
  assert.equal(command.args.some((arg) => /reset|clean|stash|rebase|force|checkout|openclaw/i.test(arg)), false);
});

test('canonical Windows startup installs and starts the mailbox task', async () => {
  const calls = [];
  const result = await ensureBattleBridgeGitHubCommandMailbox({
    platform: 'win32',
    env,
    repoRoot: canonicalRepoRoot,
    exists: () => true,
    run: (executable, args, options) => {
      calls.push({ executable, args, options });
      return { status: 0, stdout: '{"installed":true}', stderr: '' };
    },
  });
  assert.equal(result.status, 'MAILBOX_SELF_BOOTSTRAP_INSTALLED');
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
});

test('installation failure remains visible and fail-closed', async () => {
  const result = await ensureBattleBridgeGitHubCommandMailbox({
    platform: 'win32',
    env,
    repoRoot: canonicalRepoRoot,
    exists: () => true,
    run: () => ({ status: 1, stdout: '', stderr: 'access denied' }),
  });
  assert.equal(result.status, 'MAILBOX_SELF_BOOTSTRAP_BLOCKED_INSTALL_FAILED');
  assert.equal(result.ok, false);
  assert.equal(result.operatorNeeded, true);
  assert.match(result.stderr, /access denied/);
});
