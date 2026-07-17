#!/usr/bin/env node
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { refreshMailboxReceiptIndex } from '../shared/agents/mailboxReceiptIndex.mjs';
import { resolveSharedWorkspaceRuntimeConfig } from '../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import { runBattleBridgeGitHubCommandMailbox } from './battle-bridge-github-command-mailbox.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const expectedRepoRoot = resolve(process.env.USERPROFILE || homedir(), 'Documents', 'GitHub', 'stephan-os');

export async function runBattleBridgeGitHubCommandMailboxWithReceiptIndex({
  platform = process.platform,
  env = process.env,
  now = () => new Date(),
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
  if (repoRoot.toLowerCase() !== expectedRepoRoot.toLowerCase()) {
    return Object.freeze({
      ok: false,
      blocker: 'CANONICAL_CHECKOUT_REQUIRED',
      finalVerdict: 'MAILBOX_WITH_RECEIPT_INDEX_BLOCKED',
    });
  }
  const workspace = resolveSharedWorkspaceRuntimeConfig({ repoRoot, env });
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

  const beforeTimestampUtc = now().toISOString();
  const before = await refreshIndex({
    root: workspace.root,
    repoRoot,
    timestampUtc: beforeTimestampUtc,
  });

  let mailbox;
  try {
    mailbox = await runMailbox({ now });
  } catch (error) {
    mailbox = {
      ok: false,
      blocker: 'MAILBOX_RUNNER_FAILED',
      finalVerdict: 'MAILBOX_COMMAND_POLL_BLOCKED',
      error: error?.message || String(error),
    };
  }

  const afterTimestampUtc = now().toISOString();
  const after = await refreshIndex({
    root: workspace.root,
    repoRoot,
    timestampUtc: afterTimestampUtc,
  });

  const ok = before.ok !== false && mailbox?.ok !== false && after.ok !== false;
  return Object.freeze({
    ok,
    blocker: !before.ok ? before.blocker : (!mailbox?.ok ? mailbox?.blocker : (!after.ok ? after.blocker : '')),
    finalVerdict: ok ? 'MAILBOX_WITH_RECEIPT_INDEX_READY' : 'MAILBOX_WITH_RECEIPT_INDEX_BLOCKED',
    mailboxVerdict: String(mailbox?.finalVerdict || mailbox?.verdict || ''),
    indexBeforeVerdict: String(before?.finalVerdict || ''),
    indexAfterVerdict: String(after?.finalVerdict || ''),
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
