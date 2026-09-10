#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { refreshMailboxReceiptIndex } from '../shared/agents/mailboxReceiptIndex.mjs';
import { resolveSharedWorkspaceRuntimeConfig } from '../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import {
  checkpointTerminalMailboxReceipt,
  runBattleBridgeGitHubCommandMailbox,
  serializeBoundedReceiptJson,
} from './battle-bridge-github-command-mailbox.mjs';
import { verifyMailboxOutboxGuardLease } from './battle-bridge-github-command-mailbox-outbox-guard-v1.mjs';
import {
  createWindowsSafeMailboxReceiptFilename,
  getReadableMailboxReceiptFilenames,
} from '../shared/agents/windowsSafeMailboxReceiptFilename.mjs';

const defaultRepoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_INDEX_HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_LOCAL_RECEIPT_BYTES = 256 * 1024;
const RECOVERY_SERIALIZATION_RESERVE_BYTES = 512;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;

// The installed mailbox Scheduled Task has a 15-minute execution ceiling. Give a
// running instance a fixed five-minute reclamation margin, then fail closed rather
// than preserving ACCEPTED ownership forever after an executor disappears.
export const MAILBOX_ACCEPTED_LEASE_MS = 20 * 60 * 1000;
export const MAILBOX_ACCEPTED_LEASE_EXPIRED_BLOCKER = 'MAILBOX_ACCEPTED_LEASE_EXPIRED';

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

function blockedGuardLease(lease) {
  return Object.freeze({
    ok: false,
    blocker: String(lease?.blocker || 'MAILBOX_OUTBOX_GUARD_LEASE_UNPROVEN'),
    finalVerdict: 'MAILBOX_WITH_RECEIPT_INDEX_BLOCKED',
    arbitraryFilesystemAccess: false,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    sourceMutationAccess: false,
  });
}

function mailboxStatePaths({ env = process.env, workspaceRoot = '' } = {}) {
  const mailboxWorkspaceRoot = resolve(
    env.STEPHANOS_SHARED_WORKSPACE_ROOT
      || join(env.USERPROFILE || homedir(), 'Documents', 'Stephanos', 'shared-agent-workspace'),
  );
  return Object.freeze({
    mailboxWorkspaceRoot,
    mailboxStateRoot: join(mailboxWorkspaceRoot, 'github-command-mailbox'),
    statePath: join(mailboxWorkspaceRoot, 'github-command-mailbox', 'state.json'),
    canonicalReceiptRoot: join(resolve(workspaceRoot), 'receipts', 'github-command-mailbox'),
  });
}

function readBoundedJsonFile(path) {
  try {
    const payload = readFileSync(path, 'utf8');
    if (Buffer.byteLength(payload, 'utf8') > MAX_LOCAL_RECEIPT_BYTES) return null;
    const value = JSON.parse(payload);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function receiptEvidenceMs(receipt = {}) {
  const value = Date.parse(String(receipt?.completedAt || receipt?.heartbeatAt || receipt?.acceptedAt || ''));
  return Number.isFinite(value) ? value : 0;
}

function findLocalMailboxReceipts(requestId, paths) {
  const receipts = [];
  const seenPaths = new Set();
  for (const root of [paths.canonicalReceiptRoot, paths.mailboxStateRoot]) {
    for (const filename of getReadableMailboxReceiptFilenames(requestId)) {
      const receiptPath = join(root, filename);
      if (seenPaths.has(receiptPath)) continue;
      seenPaths.add(receiptPath);
      const receipt = readBoundedJsonFile(receiptPath);
      if (String(receipt?.requestId || '') === requestId) receipts.push(receipt);
    }
  }
  return receipts;
}

function selectTerminalReceipt(receipts = []) {
  return receipts
    .filter((receipt) => ['DONE', 'BLOCKED'].includes(String(receipt?.state || '').toUpperCase()))
    .sort((a, b) => receiptEvidenceMs(b) - receiptEvidenceMs(a))[0] || null;
}

function selectFreshestAcceptedReceipt(receipts = []) {
  return receipts
    .filter((receipt) => String(receipt?.state || '').toUpperCase() === 'ACCEPTED')
    .sort((a, b) => receiptEvidenceMs(b) - receiptEvidenceMs(a))[0] || null;
}

function compactAcceptedRecoveryReceipt(receipt) {
  const reserveBound = Math.max(1024, MAX_LOCAL_RECEIPT_BYTES - RECOVERY_SERIALIZATION_RESERVE_BYTES);
  const compact = JSON.parse(serializeBoundedReceiptJson(receipt, reserveBound));
  const sourceOperationResult = receipt?.result?.result;
  const compactOperationResult = compact?.result?.result;
  if (sourceOperationResult && compactOperationResult) {
    if (typeof sourceOperationResult.replayPerformed === 'boolean') {
      compactOperationResult.replayPerformed = sourceOperationResult.replayPerformed;
    }
    if (typeof sourceOperationResult.duplicateMutationAllowed === 'boolean') {
      compactOperationResult.duplicateMutationAllowed = sourceOperationResult.duplicateMutationAllowed;
    }
  }
  const payload = JSON.stringify(compact, null, 2);
  if (Buffer.byteLength(payload, 'utf8') > MAX_LOCAL_RECEIPT_BYTES) {
    throw new Error('MAILBOX_ACCEPTED_RECOVERY_RECEIPT_TOO_LARGE');
  }
  return compact;
}

function serializeAcceptedRecoveryReceipt(receipt) {
  return JSON.stringify(compactAcceptedRecoveryReceipt(receipt), null, 2);
}

function createExpiredAcceptedReceipt(acceptedReceipt, requestId, timestampUtc) {
  const operation = String(acceptedReceipt?.operation || 'UNKNOWN');
  const expectedHead = String(acceptedReceipt?.expectedHead || '');
  const acceptedAt = String(acceptedReceipt?.acceptedAt || '');
  return Object.freeze({
    ...(acceptedReceipt && typeof acceptedReceipt === 'object' ? acceptedReceipt : {}),
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId,
    operation,
    state: 'BLOCKED',
    acceptedAt,
    heartbeatAt: timestampUtc,
    completedAt: timestampUtc,
    blocker: MAILBOX_ACCEPTED_LEASE_EXPIRED_BLOCKER,
    proofRefs: Array.isArray(acceptedReceipt?.proofRefs) ? acceptedReceipt.proofRefs.slice(0, 20) : [],
    result: Object.freeze({
      ok: false,
      verdict: 'COMMAND_EXECUTION_BLOCKED',
      operation,
      requestId,
      result: Object.freeze({
        ok: false,
        blocker: MAILBOX_ACCEPTED_LEASE_EXPIRED_BLOCKER,
        finalVerdict: 'MAILBOX_ACCEPTED_OWNERSHIP_RECLAIMED',
        expectedHead,
        replayPerformed: false,
        duplicateMutationAllowed: false,
      }),
    }),
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    liveOpenClawUpdateAllowed: false,
  });
}

function writeTerminalReceiptCopies(paths, requestId, receipt) {
  mkdirSync(paths.mailboxStateRoot, { recursive: true });
  mkdirSync(paths.canonicalReceiptRoot, { recursive: true });
  const filename = createWindowsSafeMailboxReceiptFilename(requestId);
  const payload = `${serializeAcceptedRecoveryReceipt(receipt)}\n`;
  writeFileSync(join(paths.mailboxStateRoot, filename), payload, 'utf8');
  writeFileSync(join(paths.canonicalReceiptRoot, filename), payload, 'utf8');
}

function queueTerminalReceiptPublication(state, receipt) {
  const compactReceipt = compactAcceptedRecoveryReceipt(receipt);
  const publicationId = [receipt.requestId, receipt.state, receipt.completedAt || receipt.acceptedAt || 'unknown'].join(':');
  const retained = (Array.isArray(state.pendingReceiptPublications) ? state.pendingReceiptPublications : [])
    .filter((entry) => entry?.publicationId !== publicationId)
    .filter((entry) => !(entry?.receipt?.requestId === receipt.requestId && entry?.receipt?.state === 'ACCEPTED'));
  retained.push(Object.freeze({ publicationId, receipt: compactReceipt }));
  state.pendingReceiptPublications = retained;
}

export function reconcileStaleAcceptedMailboxReceipts({
  env = process.env,
  workspaceRoot = '',
  now = () => new Date(),
  leaseMs = MAILBOX_ACCEPTED_LEASE_MS,
} = {}) {
  const paths = mailboxStatePaths({ env, workspaceRoot });
  if (!existsSync(paths.statePath)) {
    return Object.freeze({
      ok: true,
      blocker: '',
      finalVerdict: 'MAILBOX_ACCEPTED_RECONCILIATION_READY',
      reconciledCount: 0,
      expiredCount: 0,
      freshCount: 0,
      replayPerformed: false,
    });
  }

  const state = readBoundedJsonFile(paths.statePath);
  if (!state) {
    return Object.freeze({
      ok: false,
      blocker: 'MAILBOX_STATE_INVALID',
      finalVerdict: 'MAILBOX_ACCEPTED_RECONCILIATION_BLOCKED',
      reconciledCount: 0,
      expiredCount: 0,
      freshCount: 0,
      replayPerformed: false,
    });
  }

  const timestamp = now();
  const nowMs = timestamp instanceof Date ? timestamp.getTime() : Date.parse(String(timestamp));
  if (!Number.isFinite(nowMs) || !Number.isSafeInteger(leaseMs) || leaseMs < MAILBOX_ACCEPTED_LEASE_MS) {
    return Object.freeze({
      ok: false,
      blocker: 'MAILBOX_ACCEPTED_LEASE_CONFIG_INVALID',
      finalVerdict: 'MAILBOX_ACCEPTED_RECONCILIATION_BLOCKED',
      reconciledCount: 0,
      expiredCount: 0,
      freshCount: 0,
      replayPerformed: false,
    });
  }
  const timestampUtc = new Date(nowMs).toISOString();
  const acceptedIds = [...new Set(Array.isArray(state.acceptedRequestIds) ? state.acceptedRequestIds.map(String) : [])]
    .filter((requestId) => SAFE_REQUEST_ID_PATTERN.test(requestId));
  let reconciledCount = 0;
  let expiredCount = 0;
  let freshCount = 0;

  const persist = (nextState) => {
    mkdirSync(paths.mailboxStateRoot, { recursive: true });
    writeFileSync(paths.statePath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
  };

  for (const requestId of acceptedIds) {
    const receipts = findLocalMailboxReceipts(requestId, paths);
    if (String(state.lastAcceptedReceipt?.requestId || '') === requestId) receipts.push(state.lastAcceptedReceipt);

    const terminalReceipt = selectTerminalReceipt(receipts);
    if (terminalReceipt) {
      writeTerminalReceiptCopies(paths, requestId, terminalReceipt);
      checkpointTerminalMailboxReceipt(state, terminalReceipt, { persist });
      queueTerminalReceiptPublication(state, terminalReceipt);
      if (String(state.lastAcceptedReceipt?.requestId || '') === requestId) delete state.lastAcceptedReceipt;
      persist(state);
      reconciledCount += 1;
      continue;
    }

    const localReceipt = selectFreshestAcceptedReceipt(receipts);
    const heartbeatMs = Date.parse(String(localReceipt?.heartbeatAt || localReceipt?.acceptedAt || ''));
    if (Number.isFinite(heartbeatMs) && nowMs - heartbeatMs <= leaseMs) {
      freshCount += 1;
      continue;
    }

    const expiredReceipt = createExpiredAcceptedReceipt(localReceipt, requestId, timestampUtc);
    writeTerminalReceiptCopies(paths, requestId, expiredReceipt);
    checkpointTerminalMailboxReceipt(state, expiredReceipt, { persist });
    if (String(state.lastAcceptedReceipt?.requestId || '') === requestId) delete state.lastAcceptedReceipt;
    queueTerminalReceiptPublication(state, expiredReceipt);
    persist(state);
    reconciledCount += 1;
    expiredCount += 1;
  }

  return Object.freeze({
    ok: true,
    blocker: '',
    finalVerdict: expiredCount > 0
      ? 'MAILBOX_STALE_ACCEPTED_OWNERSHIP_RECLAIMED'
      : 'MAILBOX_ACCEPTED_RECONCILIATION_READY',
    reconciledCount,
    expiredCount,
    freshCount,
    replayPerformed: false,
    duplicateMutationAllowed: false,
    acceptedLeaseMs: MAILBOX_ACCEPTED_LEASE_MS,
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
  reconcileAccepted = reconcileStaleAcceptedMailboxReceipts,
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

  const verifyGuardLease = () => verifyMailboxOutboxGuardLease({ env });
  const initialLease = verifyGuardLease();
  if (!initialLease.ok) return blockedGuardLease(initialLease);

  const acceptedRecovery = reconcileAccepted({
    env,
    workspaceRoot: workspace.root,
    now,
  });
  if (!acceptedRecovery?.ok) {
    return Object.freeze({
      ok: false,
      blocker: String(acceptedRecovery?.blocker || 'MAILBOX_ACCEPTED_RECONCILIATION_BLOCKED'),
      finalVerdict: 'MAILBOX_WITH_RECEIPT_INDEX_BLOCKED',
      acceptedRecovery,
      duplicateMailboxAllowed: false,
      arbitraryFilesystemAccess: false,
      arbitraryShellAllowed: false,
      destructiveGitAllowed: false,
      sourceMutationAccess: false,
    });
  }

  const refresh = async (timestampUtc) => {
    const leaseBefore = verifyGuardLease();
    if (!leaseBefore.ok) return blockedGuardLease(leaseBefore);
    try {
      const result = await refreshIndex({
        root: workspace.root,
        repoRoot: actualRepoRoot,
        timestampUtc,
      });
      const leaseAfter = verifyGuardLease();
      if (!leaseAfter.ok) return blockedGuardLease(leaseAfter);
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
    const leaseBeforeMailbox = verifyGuardLease();
    mailbox = leaseBeforeMailbox.ok
      ? await runMailbox({ now })
      : blockedGuardLease(leaseBeforeMailbox);
    const leaseAfterMailbox = verifyGuardLease();
    if (!leaseAfterMailbox.ok) mailbox = blockedGuardLease(leaseAfterMailbox);
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
    mailboxSelectedCount: Number(mailbox?.selectedCount || 0),
    mailboxReadyCount: Number(mailbox?.readyCount || 0),
    mailboxDeferredCount: Number(mailbox?.deferredCount || 0),
    mailboxControlCount: Number(mailbox?.controlCount || 0),
    mailboxObservationCount: Number(mailbox?.observationCount || 0),
    mailboxBlockedCount: Number(mailbox?.blockedCount || 0),
    mailboxMaxConcurrencyObserved: Number(mailbox?.maxConcurrencyObserved || 0),
    mailboxControlSerialized: mailbox?.controlSerialized === true,
    duplicateMailboxAllowed: false,
    acceptedRecovery,
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
