import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonObject, resolveMailboxOutboxGuardLockPath } from './battle-bridge-github-command-mailbox-outbox-guard-v1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../shared/agents/battleBridgeWindowsHosts.mjs';
import { CANONICAL_MAILBOX_ISSUE } from '../shared/agents/canonicalMailboxAuthorityV1.mjs';
import { auditMailboxRotationComments, validateMailboxRotationRecord } from '../shared/agents/canonicalMailboxRotationV1.mjs';
import { readMailboxAuthorityLiteral, verifyMailboxRotationActivationPull } from './canonical-mailbox-rotation-host-v1.mjs';
import { findMailboxRotationFence, parseMailboxRotationFenceBody, validateMailboxRotationFenceProof,
  evaluateMailboxRotationActionInventory } from '../shared/agents/canonicalMailboxRotationFenceV1.mjs';

// The existing direct guarded sync route crosses the source-epoch boundary.
// It must not depend on posting a new command to a retired transport shard.
export function evaluateMailboxRotationSyncPreflight({ state, predecessorComments, pull, authoritySource, mainHead, outboxLedger, fence, actions } = {}) {
  if (!state?.mailboxRotation || ['VERIFIED', 'CANCELLED'].includes(state.mailboxRotation.phase)) return { ok: true, required: false };
  const record = validateMailboxRotationRecord(state.mailboxRotation);
  const authority = readMailboxAuthorityLiteral(authoritySource);
  if (authority.active === record.predecessorIssue) return { ok: true, required: false };
  const fail = blocker => ({ ok: false, required: true, blocker });
  if (!fence || fence.phase !== 'FROZEN' || fence.drained !== true || fence.transitionId !== record.transitionId
    || fence.predecessorIssue !== record.predecessorIssue || fence.successorIssue !== record.successorIssue
    || fence.cutoverHead !== record.cutoverHead || fence.cutoverPrNumber !== record.cutoverPrNumber) return fail('MAILBOX_ROTATION_SYNC_GLOBAL_FREEZE_UNPROVEN');
  if (actions?.complete !== true || actions.pendingRuns?.length !== 0) return fail('MAILBOX_ROTATION_SYNC_ACTIONS_PENDING');
  if (record.phase !== 'FROZEN' || record.drained !== true) return fail('MAILBOX_ROTATION_SYNC_REQUIRES_FROZEN_DRAIN');
  if (!Array.isArray(state.acceptedRequestIds) || state.acceptedRequestIds.length
    || !Array.isArray(state.pendingReceiptPublications) || state.pendingReceiptPublications.length) return fail('MAILBOX_ROTATION_SYNC_INFLIGHT_ACTIONS');
  if (outboxLedger?.schemaVersion !== 'stephanos.battle-bridge-mailbox-outbox-ledger.v3'
    || !/^[a-f0-9]{32}$/.test(outboxLedger.storeId || '')
    || !Number.isSafeInteger(outboxLedger.headSequence) || outboxLedger.headSequence < 0
    || outboxLedger.headSequence !== outboxLedger.nextSequence
    || outboxLedger.legacy !== null) return fail('MAILBOX_ROTATION_SYNC_OUTBOX_UNPROVEN');
  if (!verifyMailboxRotationActivationPull(pull, record, authority, { merged: true, mainHead })) return fail('MAILBOX_ROTATION_SYNC_MERGE_UNVERIFIED');
  const inventory = auditMailboxRotationComments(predecessorComments, { issueNumber: record.predecessorIssue, barrierCommentId: record.barrierCommentId });
  if (inventory.pendingBeforeBarrier.length || inventory.pendingAfterBarrier.length || inventory.acceptedIds.length) return fail('MAILBOX_ROTATION_SYNC_PREDECESSOR_PENDING');
  return { ok: true, required: true, inventoryDigest: inventory.inventoryDigest, transitionId: record.transitionId, sourceHead: mainHead };
}

export function preflightCanonicalMailboxRotationSync({ repoRoot, expectedHead = '', env = process.env, guardToken = '' } = {}) {
  const workspace = resolve(env.STEPHANOS_SHARED_WORKSPACE_ROOT || join(env.USERPROFILE || homedir(), 'Documents', 'Stephanos', 'shared-agent-workspace'));
  const stateRoot = join(workspace, 'github-command-mailbox');
  const state = readJsonObject(join(stateRoot, 'state.json'), { allowMissing: true, missingValue: {} });
  if (state.mailboxRotation) validateMailboxRotationRecord(state.mailboxRotation);
  const get = endpoint => {
    const response = spawnSync(BATTLE_BRIDGE_WINDOWS_HOST.githubCli, ['api', `repos/Cheekyfellastef/stephan-os/${endpoint}`], {
      cwd: repoRoot, shell: false, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 2*1024*1024,
    });
    if (response.error || response.status !== 0) throw new Error('MAILBOX_ROTATION_SYNC_GITHUB_READ_FAILED');
    return JSON.parse(response.stdout);
  };
  const mainHead = get('commits/main').sha;
  if (!/^[a-f0-9]{40}$/.test(mainHead || '') || (expectedHead && mainHead !== expectedHead)) return { ok: false, blocker: 'MAILBOX_ROTATION_SYNC_MAIN_MOVED' };
  const source = get(`contents/shared/agents/canonicalMailboxAuthorityV1.mjs?ref=${mainHead}`);
  if (source.encoding !== 'base64' || source.size > 64000) throw new Error('MAILBOX_ROTATION_SYNC_SOURCE_UNPROVEN');
  const authoritySource = Buffer.from(source.content, 'base64').toString('utf8');
  // A same-epoch source refresh needs no transition admission, even if a freeze
  // record is present. Only changing the canonical issue invokes the hard gate.
  if (readMailboxAuthorityLiteral(authoritySource).active === CANONICAL_MAILBOX_ISSUE) return { ok: true, required: false };
  if (!state.mailboxRotation || ['VERIFIED', 'CANCELLED'].includes(state.mailboxRotation.phase)) return { ok: false, blocker: 'MAILBOX_ROTATION_SYNC_TRANSITION_REQUIRED' };
  const predecessorComments = [];
  let complete = false;
  for (let page = 1; page <= 30; page++) {
    const batch = get(`issues/${state.mailboxRotation.predecessorIssue}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('MAILBOX_ROTATION_SYNC_COMMENTS_INVALID');
    predecessorComments.push(...batch);
    if (batch.length < 100) { complete = true; break; }
  }
  if (!complete) throw new Error('MAILBOX_ROTATION_SYNC_HISTORY_INCOMPLETE');
  const lockPath = resolveMailboxOutboxGuardLockPath({ env });
  const guard = readJsonObject(lockPath, { allowMissing: true, missingValue: null });
  if (guard && (!guardToken || guard.token !== guardToken)) return { ok: false, blocker: 'MAILBOX_ROTATION_SYNC_GUARD_ACTIVE' };
  const outboxLedger = readJsonObject(join(stateRoot, 'receipt-publication-deferred-v1.json'));
  const goalComments = [];
  let goalComplete = false;
  for (let page=1; page<=30; page++) {
    const batch = get(`issues/2315/comments?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('MAILBOX_ROTATION_SYNC_FENCE_HISTORY_INVALID');
    goalComments.push(...batch);
    if (batch.length < 100) { goalComplete = true; break; }
  }
  if (!goalComplete) throw new Error('MAILBOX_ROTATION_SYNC_FENCE_HISTORY_INCOMPLETE');
  const fenceComment = findMailboxRotationFence(goalComments);
  const projected = fenceComment && parseMailboxRotationFenceBody(fenceComment);
  const fence = projected && validateMailboxRotationFenceProof(projected, {
    freeze: get(`issues/comments/${projected.freezeCommentId}`), command: get(`issues/comments/${projected.commandCommentId}`),
    receipt: get(`issues/comments/${projected.receiptCommentId}`),
  });
  const actions = evaluateMailboxRotationActionInventory(['queued','in_progress','waiting','requested','pending']
    .map(status => get(`actions/runs?status=${status}&per_page=100`)));
  if (get('commits/main').sha !== mainHead) return { ok: false, blocker: 'MAILBOX_ROTATION_SYNC_MAIN_MOVED' };
  return evaluateMailboxRotationSyncPreflight({ state, predecessorComments,
    pull: get(`pulls/${state.mailboxRotation.cutoverPrNumber}`), authoritySource, mainHead, outboxLedger, fence, actions });
}
