import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { runBattleBridgeGitHubCommandMailboxWithReceiptIndex } from './battle-bridge-github-command-mailbox-with-receipt-index.mjs';
import {
  MAILBOX_OUTBOX_GUARD_LEASE_ENV,
  MAILBOX_OUTBOX_GUARD_LEASE_SCHEMA,
  resolveMailboxOutboxGuardLockPath,
} from './battle-bridge-github-command-mailbox-outbox-guard-v1.mjs';

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'mailbox-index-sidecar-'));
  const repoRoot = join(root, 'canonical-repo');
  const workspaceRoot = join(root, 'shared-workspace');
  const mailboxWorkspaceRoot = join(root, 'mailbox-workspace');
  const token = 'abcdefabcdefabcdefabcdefabcdefab';
  const baseEnv = {
    STEPHANOS_SHARED_AGENT_WORKSPACE: workspaceRoot,
    STEPHANOS_SHARED_WORKSPACE_ROOT: mailboxWorkspaceRoot,
  };
  const lockPath = resolveMailboxOutboxGuardLockPath({ env: baseEnv });
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(lockPath, `${JSON.stringify({
    schemaVersion: 'stephanos.battle-bridge-mailbox-outbox-lock.v1',
    token,
    pid: process.ppid,
    ownerBootId: 'test-parent-boot',
    ownerProcessStartId: 'test-parent-process',
    acquiredAtUtc: '2026-07-17T20:00:00.000Z',
  })}\n`, 'utf8');
  const env = {
    ...baseEnv,
    [MAILBOX_OUTBOX_GUARD_LEASE_ENV.schema]: MAILBOX_OUTBOX_GUARD_LEASE_SCHEMA,
    [MAILBOX_OUTBOX_GUARD_LEASE_ENV.lockPath]: lockPath,
    [MAILBOX_OUTBOX_GUARD_LEASE_ENV.token]: token,
    [MAILBOX_OUTBOX_GUARD_LEASE_ENV.guardPid]: String(process.ppid),
  };
  try { return await fn({ repoRoot, workspaceRoot, env }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('sidecar fails closed outside Windows and outside the canonical checkout', async () => fixture(async ({ repoRoot, env }) => {
  const nonWindows = await runBattleBridgeGitHubCommandMailboxWithReceiptIndex({
    platform: 'linux',
    sourceRepoRoot: repoRoot,
    canonicalRepoRoot: repoRoot,
    env,
  });
  assert.equal(nonWindows.ok, false);
  assert.equal(nonWindows.blocker, 'WINDOWS_REQUIRED');

  const nonCanonical = await runBattleBridgeGitHubCommandMailboxWithReceiptIndex({
    platform: 'win32',
    sourceRepoRoot: `${repoRoot}-other`,
    canonicalRepoRoot: repoRoot,
    env,
  });
  assert.equal(nonCanonical.ok, false);
  assert.equal(nonCanonical.blocker, 'CANONICAL_CHECKOUT_REQUIRED');
}));

test('standalone sidecar invocation without the parent-bound guard lease cannot mutate state', async () => fixture(async ({ repoRoot, env }) => {
  let indexCalled = false;
  let mailboxCalled = false;
  const result = await runBattleBridgeGitHubCommandMailboxWithReceiptIndex({
    platform: 'win32',
    sourceRepoRoot: repoRoot,
    canonicalRepoRoot: repoRoot,
    env: { ...env, [MAILBOX_OUTBOX_GUARD_LEASE_ENV.schema]: '' },
    refreshIndex: async () => { indexCalled = true; return { ok: true }; },
    runMailbox: async () => { mailboxCalled = true; return { ok: true }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MAILBOX_OUTBOX_GUARD_LEASE_REQUIRED');
  assert.equal(indexCalled, false);
  assert.equal(mailboxCalled, false);
}));

test('sidecar refreshes the authoritative Shared Workspace index before and after one mailbox poll', async () => fixture(async ({ repoRoot, workspaceRoot, env }) => {
  const calls = [];
  const times = [
    new Date('2026-07-17T20:10:00.000Z'),
    new Date('2026-07-17T20:10:01.000Z'),
  ];
  const result = await runBattleBridgeGitHubCommandMailboxWithReceiptIndex({
    platform: 'win32',
    sourceRepoRoot: repoRoot,
    canonicalRepoRoot: repoRoot,
    env,
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
  assert.equal(result.indexHeartbeatIntervalMs, 15_000);
  assert.equal(result.indexHeartbeatRefreshCount, 0);
  assert.equal(result.recentReceiptCount, 1);
  assert.equal(result.mailboxSelectedCount, 0);
  assert.equal(result.mailboxDeferredCount, 0);
  assert.equal(result.duplicateMailboxAllowed, false);
  assert.equal(result.arbitraryFilesystemAccess, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.destructiveGitAllowed, false);
  assert.equal(result.sourceMutationAccess, false);
}));

test('sidecar projects bounded batch throughput and backpressure telemetry', async () => fixture(async ({ repoRoot, env }) => {
  const result = await runBattleBridgeGitHubCommandMailboxWithReceiptIndex({
    platform: 'win32',
    sourceRepoRoot: repoRoot,
    canonicalRepoRoot: repoRoot,
    env,
    refreshIndex: async () => ({
      ok: true,
      finalVerdict: 'MAILBOX_RECEIPT_INDEX_READY',
      projection: { activeReceipt: null, recentReceipts: [] },
    }),
    runMailbox: async () => ({
      ok: true,
      finalVerdict: 'MAILBOX_BATCH_DRAINED_WITH_BLOCKERS',
      selectedCount: 4,
      readyCount: 7,
      deferredCount: 3,
      controlCount: 2,
      observationCount: 2,
      blockedCount: 1,
      maxConcurrencyObserved: 2,
      controlSerialized: true,
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.mailboxVerdict, 'MAILBOX_BATCH_DRAINED_WITH_BLOCKERS');
  assert.equal(result.mailboxSelectedCount, 4);
  assert.equal(result.mailboxReadyCount, 7);
  assert.equal(result.mailboxDeferredCount, 3);
  assert.equal(result.mailboxControlCount, 2);
  assert.equal(result.mailboxObservationCount, 2);
  assert.equal(result.mailboxBlockedCount, 1);
  assert.equal(result.mailboxMaxConcurrencyObserved, 2);
  assert.equal(result.mailboxControlSerialized, true);
  assert.equal(result.duplicateMailboxAllowed, false);
}));

test('sidecar refreshes an ACCEPTED receipt during a long mailbox poll on a bounded heartbeat', async () => fixture(async ({ repoRoot, env }) => {
  const calls = [];
  const times = [
    new Date('2026-07-17T20:20:00.000Z'),
    new Date('2026-07-17T20:20:15.000Z'),
    new Date('2026-07-17T20:20:16.000Z'),
  ];
  let heartbeatCallback = null;
  let cleared = false;
  const timer = { unrefCalled: false, unref() { this.unrefCalled = true; } };
  const result = await runBattleBridgeGitHubCommandMailboxWithReceiptIndex({
    platform: 'win32',
    sourceRepoRoot: repoRoot,
    canonicalRepoRoot: repoRoot,
    env,
    now: () => times.shift() || new Date('2026-07-17T20:20:17.000Z'),
    heartbeatIntervalMs: 15_000,
    setIntervalFn: (callback, intervalMs) => {
      assert.equal(intervalMs, 15_000);
      heartbeatCallback = callback;
      return timer;
    },
    clearIntervalFn: (value) => {
      assert.equal(value, timer);
      cleared = true;
    },
    refreshIndex: async (input) => {
      calls.push(`index:${input.timestampUtc}`);
      return {
        ok: true,
        finalVerdict: 'MAILBOX_RECEIPT_INDEX_READY',
        projection: {
          activeReceipt: input.timestampUtc === '2026-07-17T20:20:15.000Z' ? { requestId: 'active-request-1' } : null,
          recentReceipts: [],
        },
      };
    },
    runMailbox: async () => {
      calls.push('mailbox:start');
      heartbeatCallback();
      await Promise.resolve();
      calls.push('mailbox:end');
      return { ok: true, verdict: 'COMMAND_EXECUTION_COMPLETE' };
    },
  });
  assert.deepEqual(calls, [
    'index:2026-07-17T20:20:00.000Z',
    'mailbox:start',
    'index:2026-07-17T20:20:15.000Z',
    'mailbox:end',
    'index:2026-07-17T20:20:16.000Z',
  ]);
  assert.equal(timer.unrefCalled, true);
  assert.equal(cleared, true);
  assert.equal(result.ok, true);
  assert.equal(result.indexHeartbeatIntervalMs, 15_000);
  assert.equal(result.indexHeartbeatRefreshCount, 1);
}));

test('an index refresh exception cannot prevent the mailbox from polling', async () => fixture(async ({ repoRoot, env }) => {
  let refreshCount = 0;
  let mailboxCalls = 0;
  const result = await runBattleBridgeGitHubCommandMailboxWithReceiptIndex({
    platform: 'win32',
    sourceRepoRoot: repoRoot,
    canonicalRepoRoot: repoRoot,
    env,
    refreshIndex: async () => {
      refreshCount += 1;
      if (refreshCount === 1) throw new Error('disk unavailable');
      return { ok: true, finalVerdict: 'MAILBOX_RECEIPT_INDEX_READY', projection: { recentReceipts: [] } };
    },
    runMailbox: async () => {
      mailboxCalls += 1;
      return { ok: true, verdict: 'NO_COMMAND_READY' };
    },
  });
  assert.equal(refreshCount, 2);
  assert.equal(mailboxCalls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MAILBOX_RECEIPT_INDEX_REFRESH_FAILED');
  assert.equal(result.indexBlocker, 'MAILBOX_RECEIPT_INDEX_REFRESH_FAILED');
  assert.equal(result.mailboxBlocker, '');
  assert.equal(result.mailboxVerdict, 'NO_COMMAND_READY');
  assert.equal(result.finalVerdict, 'MAILBOX_WITH_RECEIPT_INDEX_BLOCKED');
}));

test('sidecar still refreshes the index after a mailbox exception and returns a bounded blocker', async () => fixture(async ({ repoRoot, env }) => {
  let refreshCount = 0;
  const result = await runBattleBridgeGitHubCommandMailboxWithReceiptIndex({
    platform: 'win32',
    sourceRepoRoot: repoRoot,
    canonicalRepoRoot: repoRoot,
    env,
    refreshIndex: async () => {
      refreshCount += 1;
      return { ok: true, finalVerdict: 'MAILBOX_RECEIPT_INDEX_READY', projection: { recentReceipts: [] } };
    },
    runMailbox: async () => { throw new Error('fixture failure'); },
  });
  assert.equal(refreshCount, 2);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MAILBOX_RUNNER_FAILED');
  assert.equal(result.mailboxBlocker, 'MAILBOX_RUNNER_FAILED');
  assert.equal(result.indexBlocker, '');
  assert.equal(result.finalVerdict, 'MAILBOX_WITH_RECEIPT_INDEX_BLOCKED');
}));

test('Scheduled Task installer reports the fixed guard and its child sidecar while retaining bounded authority', async () => {
  const installer = await readFile(new URL('./windows/install-battle-bridge-github-command-mailbox.ps1', import.meta.url), 'utf8');
  assert.match(installer, /runnerPath = \(Resolve-Path[\s\S]{0,180}battle-bridge-github-command-mailbox-outbox-guard-v1\.mjs/);
  assert.match(installer, /childRunnerPath = \(Resolve-Path[\s\S]{0,180}battle-bridge-github-command-mailbox-with-receipt-index\.mjs/);
  assert.match(installer, /battle-bridge-github-command-mailbox-with-receipt-index\.mjs/);
  assert.match(installer, /receiptIndexEnabled = \$true/);
  assert.match(installer, /-MultipleInstances IgnoreNew/);
  assert.match(installer, /-RunLevel Limited/);
  assert.doesNotMatch(installer, /Invoke-Expression|Start-Process|cmd\.exe|git\s+(?:reset|clean|checkout|push|rebase)/i);
});
