import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runBattleBridgeGitHubCommandMailboxWithReceiptIndex } from './battle-bridge-github-command-mailbox-with-receipt-index.mjs';

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'mailbox-index-sidecar-'));
  const repoRoot = join(root, 'canonical-repo');
  const workspaceRoot = join(root, 'shared-workspace');
  try { return await fn({ repoRoot, workspaceRoot }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('sidecar fails closed outside Windows and outside the canonical checkout', async () => fixture(async ({ repoRoot, workspaceRoot }) => {
  const nonWindows = await runBattleBridgeGitHubCommandMailboxWithReceiptIndex({
    platform: 'linux',
    sourceRepoRoot: repoRoot,
    canonicalRepoRoot: repoRoot,
    env: { STEPHANOS_SHARED_AGENT_WORKSPACE: workspaceRoot },
  });
  assert.equal(nonWindows.ok, false);
  assert.equal(nonWindows.blocker, 'WINDOWS_REQUIRED');

  const nonCanonical = await runBattleBridgeGitHubCommandMailboxWithReceiptIndex({
    platform: 'win32',
    sourceRepoRoot: `${repoRoot}-other`,
    canonicalRepoRoot: repoRoot,
    env: { STEPHANOS_SHARED_AGENT_WORKSPACE: workspaceRoot },
  });
  assert.equal(nonCanonical.ok, false);
  assert.equal(nonCanonical.blocker, 'CANONICAL_CHECKOUT_REQUIRED');
}));

test('sidecar refreshes the authoritative Shared Workspace index before and after one mailbox poll', async () => fixture(async ({ repoRoot, workspaceRoot }) => {
  const calls = [];
  const times = [
    new Date('2026-07-17T20:10:00.000Z'),
    new Date('2026-07-17T20:10:01.000Z'),
  ];
  const result = await runBattleBridgeGitHubCommandMailboxWithReceiptIndex({
    platform: 'win32',
    sourceRepoRoot: repoRoot,
    canonicalRepoRoot: repoRoot,
    env: { STEPHANOS_SHARED_AGENT_WORKSPACE: workspaceRoot },
    now: () => times.shift() || new Date('2026-07-17T20:10:02.000Z'),
    refreshIndex: async (input) => {
      calls.push(`index:${input.timestampUtc}:${input.root}`);
      return {
        ok: true,
        finalVerdict: 'MAILBOX_RECEIPT_INDEX_READY',
        projection: { activeReceipt: null, recentReceipts: [{ requestId: 'receipt-1' }] },
      };
    },
    runMailbox: async () => {
      calls.push('mailbox');
      return { ok: true, verdict: 'NO_COMMAND_READY' };
    },
  });
  assert.deepEqual(calls, [
    `index:2026-07-17T20:10:00.000Z:${workspaceRoot}`,
    'mailbox',
    `index:2026-07-17T20:10:01.000Z:${workspaceRoot}`,
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'MAILBOX_WITH_RECEIPT_INDEX_READY');
  assert.equal(result.mailboxVerdict, 'NO_COMMAND_READY');
  assert.equal(result.indexBeforeVerdict, 'MAILBOX_RECEIPT_INDEX_READY');
  assert.equal(result.indexAfterVerdict, 'MAILBOX_RECEIPT_INDEX_READY');
  assert.equal(result.recentReceiptCount, 1);
  assert.equal(result.arbitraryFilesystemAccess, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.destructiveGitAllowed, false);
  assert.equal(result.sourceMutationAccess, false);
}));

test('sidecar still refreshes the index after a mailbox exception and returns a bounded blocker', async () => fixture(async ({ repoRoot, workspaceRoot }) => {
  let refreshCount = 0;
  const result = await runBattleBridgeGitHubCommandMailboxWithReceiptIndex({
    platform: 'win32',
    sourceRepoRoot: repoRoot,
    canonicalRepoRoot: repoRoot,
    env: { STEPHANOS_SHARED_AGENT_WORKSPACE: workspaceRoot },
    refreshIndex: async () => {
      refreshCount += 1;
      return { ok: true, finalVerdict: 'MAILBOX_RECEIPT_INDEX_READY', projection: { recentReceipts: [] } };
    },
    runMailbox: async () => { throw new Error('fixture failure'); },
  });
  assert.equal(refreshCount, 2);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MAILBOX_RUNNER_FAILED');
  assert.equal(result.finalVerdict, 'MAILBOX_WITH_RECEIPT_INDEX_BLOCKED');
}));

test('Scheduled Task installer points only to the fixed sidecar and retains bounded authority', async () => {
  const installer = await readFile(new URL('./windows/install-battle-bridge-github-command-mailbox.ps1', import.meta.url), 'utf8');
  assert.match(installer, /battle-bridge-github-command-mailbox-with-receipt-index\.mjs/);
  assert.match(installer, /receiptIndexEnabled = \$true/);
  assert.match(installer, /-MultipleInstances IgnoreNew/);
  assert.match(installer, /-RunLevel Limited/);
  assert.doesNotMatch(installer, /Invoke-Expression|Start-Process|cmd\.exe|git\s+(?:reset|clean|checkout|push|rebase)/i);
});
