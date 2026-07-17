#!/usr/bin/env node
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { refreshMailboxReceiptIndex } from '../shared/agents/mailboxReceiptIndex.mjs';
import { resolveSharedWorkspaceRuntimeConfig } from '../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import { runBattleBridgeGitHubCommandMailbox } from './battle-bridge-github-command-mailbox.mjs';

const defaultRepoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_INDEX_HEARTBEAT_INTERVAL_MS = 15_000;

function blockedIndexRefresh() {
  return Object.freeze({
    ok: false,
    blocker: 'MAILBOX_RECEIPT_INDEX_REFRESH_FAILED',
    finalVerdict: 'MAILBOX_RECEIPT_INDEX_BLOCKED',
    projection: Object.freeze({ activeReceipt: null, recentReceipts: [] }),
    arbitraryFilesystemAccess: false,
    commandExecutionAccess: false,
    sourceMutationAccess: false,
  });
}

export async function runBattleBridgeGitHubCommandMailboxWithReceiptIndex({
  platform = process.platform,
  env = process.env,
  now = () => new Date(),
  sourceRepoRoot = defaultRepoRoot,
  canonicalRepoRoot = '',
  heartbeatIntervalMs = DEFAULT_INDEX_HEARTBEAT_INTERVAL_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  runMailbox = runBattleBridgeGitHubCommandMailbox,
  refreshIndex = refreshMailboxReceiptIndex,
} = {}) {
  if (platform !== 'win32') {
    return Object.freeze({
      ok: false,
      blocker: 'WINDOWS_REQUIRED',
      finalVerdict: 'MAILBOX_WITH_RECEIPT_INDEX_BLOCKED',
    });
  }
  const actualRepoRoot = resolve(sourceRepoRoot);
  const expectedRepoRoot = resolve(canonicalRepoRoot || resolve(env.USERPROFILE || homedir(), 'Documents', 'GitHub', 'stephan-os'));
  if (actualRepoRoot.toLowerCase() !== expectedRepoRoot.toLowerCase()) {
    return Object.freeze({
      ok: false,
      blocker: 'CANONICAL_CHECKOUT_REQUIRED',
      finalVerdict: 'MAILBOX_WITH_RECEIPT_INDEX_BLOCKED',
    });
  }
  const workspace = resolveSharedWorkspaceRuntimeConfig({ repoRoot: actualRepoRoot, env });
  if (!workspace.ok) {
    return Object.freeze({
      ok: false,
      blocker: workspace.reason,
      finalVerdict: 'MAILBOX_WITH_RECEIPT_INDEX_BLOCKED',
      arbitraryFilesystemAccess: false,
      commandExecutionAccess: false,
      sourceMutationAccess: false,
    });
  }

  const refresh = async (timestampUtc) => {
    try {
      const result = await refreshIndex({
        root: workspace.root,
        repoRoot: actualRepoRoot,
        timestampUtc,
      });
      return result && typeof result === 'object' ? result : blockedIndexRefresh();
    } catch {
      return blockedIndexRefresh();
    }
  };
  const before = await refresh(now().toISOString());

  let heartbeatRefreshCount = 0;
  let heartbeatInFlight = false;
  let heartbeatPromise = Promise.resolve(null);
  const refreshHeartbeat = () => {
    if (heartbeatInFlight) return heartbeatPromise;
    heartbeatInFlight = true;
    heartbeatPromise = refresh(now().toISOString())
      .then((result) => {
        heartbeatRefreshCount += 1;
        return result;
      })
      .finally(() => { heartbeatInFlight = false; });
    return heartbeatPromise;
  };
  const boundedHeartbeatIntervalMs = Math.max(5_000, Math.min(60_000, Number(heartbeatIntervalMs) || DEFAULT_INDEX_HEARTBEAT_INTERVAL_MS));
  const timer = setIntervalFn(() => { void refreshHeartbeat(); }, boundedHeartbeatIntervalMs);
  timer?.unref?.();

  let mailbox;
  try {
    mailbox = await runMailbox({ now });
  } catch {
    mailbox = {
      ok: false,
      blocker: 'MAILBOX_RUNNER_FAILED',
      finalVerdict: 'MAILBOX_COMMAND_POLL_BLOCKED',
    };
  } finally {
    clearIntervalFn(timer);
    await heartbeatPromise;
  }

  const after = await refresh(now().toISOString());
  const indexBlocker = !before.ok ? String(before.blocker || 'MAILBOX_RECEIPT_INDEX_BLOCKED')
    : (!after.ok ? String(after.blocker || 'MAILBOX_RECEIPT_INDEX_BLOCKED') : '');
  const mailboxBlocker = mailbox?.ok === false ? String(mailbox?.blocker || 'MAILBOX_COMMAND_POLL_BLOCKED') : '';
  const ok = before.ok !== false && mailbox?.ok !== false && after.ok !== false;
  return Object.freeze({
    ok,
    blocker: mailboxBlocker || indexBlocker,
    mailboxBlocker,
    indexBlocker,
    finalVerdict: ok ? 'MAILBOX_WITH_RECEIPT_INDEX_READY' : 'MAILBOX_WITH_RECEIPT_INDEX_BLOCKED',
    mailboxVerdict: String(mailbox?.finalVerdict || mailbox?.verdict || ''),
    indexBeforeVerdict: String(before?.finalVerdict || ''),
    indexAfterVerdict: String(after?.finalVerdict || ''),
    indexHeartbeatIntervalMs: boundedHeartbeatIntervalMs,
    indexHeartbeatRefreshCount: heartbeatRefreshCount,
    activeReceipt: after?.projection?.activeReceipt || null,
    recentReceiptCount: Array.isArray(after?.projection?.recentReceipts) ? after.projection.recentReceipts.length : 0,
    arbitraryFilesystemAccess: false,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    sourceMutationAccess: false,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBattleBridgeGitHubCommandMailboxWithReceiptIndex()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch((error) => {
      process.stderr.write(`${error?.message || String(error)}\n`);
      process.exitCode = 1;
    });
}
