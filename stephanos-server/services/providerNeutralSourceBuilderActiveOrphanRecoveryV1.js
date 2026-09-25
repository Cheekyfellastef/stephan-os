import { isAbsolute, resolve } from 'node:path';

export const PROVIDER_NEUTRAL_ACTIVE_ORPHAN_RECOVERY_SCHEMA =
  'stephanos.provider-neutral-active-orphan-recovery.v1';

const SHA40 = /^[0-9a-f]{40}$/i;
const ADAPTERS = new Set(['foundry-forge', 'chatgpt-github']);
const ACTIVE_RECEIPT_STATES = new Set(['started', 'progress']);

function text(value) {
  return String(value ?? '').trim();
}

function exactHead(value) {
  const normalized = text(value).toLowerCase();
  return SHA40.test(normalized) ? normalized : '';
}

function normalizedLines(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, '/'))
    .filter(Boolean);
}

function fixedGit(run, worktreePath, args, label) {
  const result = run('git.exe', ['-C', worktreePath, ...args], { cwd: worktreePath });
  if (result?.error || result?.status !== 0) {
    return Object.freeze({
      ok: false,
      reason: `PROVIDER_NEUTRAL_ACTIVE_ORPHAN_GIT_PROBE_FAILED:${label}`,
      detail: text(result?.stderr || result?.stdout || result?.error?.message),
    });
  }
  return Object.freeze({ ok: true, stdout: String(result?.stdout || '') });
}

function exactClaimHead(item = {}) {
  const bindingHead = exactHead(item?.executionBinding?.headSha || item?.executionBinding?.sourceRevision);
  const grantHead = exactHead(item?.actionGrant?.headSha || item?.actionGrant?.sourceRevision);
  const action = item?.payload || {};
  const actionHeadRaw = text(action?.expectedHeadSha || action?.claims?.expectedHeadSha);
  const actionHead = actionHeadRaw ? exactHead(actionHeadRaw) : '';
  if (!bindingHead || !grantHead || bindingHead !== grantHead) return '';
  if (actionHeadRaw && (!actionHead || actionHead !== bindingHead)) return '';
  return bindingHead;
}

export function inspectProviderNeutralActiveOrphanRecovery(input = {}, options = {}) {
  const item = input.item || input.claim?.item || {};
  const action = item?.payload || {};
  const adapter = text(input.adapter || item?.adapter || action?.adapter).toLowerCase();
  const receiptState = text(input.latestReceipt?.state || input.receiptState).toLowerCase();
  if (!ADAPTERS.has(adapter) || action?.actionKind !== 'agent-handoff') {
    return Object.freeze({
      schemaVersion: PROVIDER_NEUTRAL_ACTIVE_ORPHAN_RECOVERY_SCHEMA,
      allowed: false,
      reason: 'PROVIDER_NEUTRAL_ACTIVE_ORPHAN_TASK_UNSUPPORTED',
    });
  }
  if (!ACTIVE_RECEIPT_STATES.has(receiptState)) {
    return Object.freeze({
      schemaVersion: PROVIDER_NEUTRAL_ACTIVE_ORPHAN_RECOVERY_SCHEMA,
      allowed: false,
      reason: 'PROVIDER_NEUTRAL_ACTIVE_ORPHAN_RECEIPT_STATE_UNSUPPORTED',
    });
  }

  const expectedHead = exactClaimHead(item);
  if (!expectedHead) {
    return Object.freeze({
      schemaVersion: PROVIDER_NEUTRAL_ACTIVE_ORPHAN_RECOVERY_SCHEMA,
      allowed: false,
      reason: 'PROVIDER_NEUTRAL_ACTIVE_ORPHAN_HEAD_BINDING_INVALID',
    });
  }

  const worktreePath = text(action?.worktreePath);
  if (!worktreePath || !isAbsolute(worktreePath)) {
    return Object.freeze({
      schemaVersion: PROVIDER_NEUTRAL_ACTIVE_ORPHAN_RECOVERY_SCHEMA,
      allowed: false,
      reason: 'PROVIDER_NEUTRAL_ACTIVE_ORPHAN_WORKTREE_REQUIRED',
    });
  }
  const run = options.runCommand;
  if (typeof run !== 'function') {
    return Object.freeze({
      schemaVersion: PROVIDER_NEUTRAL_ACTIVE_ORPHAN_RECOVERY_SCHEMA,
      allowed: false,
      reason: 'PROVIDER_NEUTRAL_ACTIVE_ORPHAN_RUNNER_REQUIRED',
    });
  }

  const resolvedWorktree = resolve(worktreePath);
  const head = fixedGit(run, resolvedWorktree, ['rev-parse', 'HEAD'], 'HEAD');
  if (!head.ok) return Object.freeze({ schemaVersion: PROVIDER_NEUTRAL_ACTIVE_ORPHAN_RECOVERY_SCHEMA, allowed: false, ...head });
  const observedHead = exactHead(head.stdout);
  if (!observedHead || observedHead !== expectedHead) {
    return Object.freeze({
      schemaVersion: PROVIDER_NEUTRAL_ACTIVE_ORPHAN_RECOVERY_SCHEMA,
      allowed: false,
      reason: 'PROVIDER_NEUTRAL_ACTIVE_ORPHAN_HEAD_DRIFT',
      expectedHead,
      observedHead,
    });
  }

  const tracked = fixedGit(run, resolvedWorktree, ['diff', '--name-only', 'HEAD', '--'], 'TRACKED');
  if (!tracked.ok) return Object.freeze({ schemaVersion: PROVIDER_NEUTRAL_ACTIVE_ORPHAN_RECOVERY_SCHEMA, allowed: false, ...tracked });
  const untracked = fixedGit(run, resolvedWorktree, ['ls-files', '--others', '--exclude-standard'], 'UNTRACKED');
  if (!untracked.ok) return Object.freeze({ schemaVersion: PROVIDER_NEUTRAL_ACTIVE_ORPHAN_RECOVERY_SCHEMA, allowed: false, ...untracked });
  const changedFiles = [...new Set([...normalizedLines(tracked.stdout), ...normalizedLines(untracked.stdout)])].sort();
  if (changedFiles.length) {
    return Object.freeze({
      schemaVersion: PROVIDER_NEUTRAL_ACTIVE_ORPHAN_RECOVERY_SCHEMA,
      allowed: false,
      reason: 'PROVIDER_NEUTRAL_ACTIVE_ORPHAN_WORKTREE_NOT_CLEAN',
      expectedHead,
      changedFiles: Object.freeze(changedFiles),
    });
  }

  return Object.freeze({
    schemaVersion: PROVIDER_NEUTRAL_ACTIVE_ORPHAN_RECOVERY_SCHEMA,
    allowed: true,
    reason: 'PROVIDER_NEUTRAL_ACTIVE_ORPHAN_CLEAN_EXACT_HEAD',
    adapter,
    receiptState,
    expectedHead,
    worktreePath: resolvedWorktree,
    sourceMutationObserved: false,
    providerReplayMayOccur: true,
    sourceMutationReplayAllowed: false,
  });
}
