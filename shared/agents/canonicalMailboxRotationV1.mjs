import { createHash } from 'node:crypto';
import { CANONICAL_MAILBOX_ISSUE, RETIRED_CANONICAL_MAILBOX_ISSUES } from './canonicalMailboxAuthorityV1.mjs';

export const MAILBOX_ROTATION_OPERATION = 'MANAGE_CANONICAL_MAILBOX_ROTATION';
export const MAILBOX_ROTATION_SCHEMA = 'stephanos.canonical-mailbox-rotation.v1';
export const MAILBOX_ROTATION_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
export const MAILBOX_ROTATION_SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const OWNER = 'Cheekyfellastef';
const fields = new Set(['schemaVersion', 'requestId', 'operation', 'repository', 'issueNumber',
  'branch', 'operatorApproval', 'expectedHead', 'expiresAt', 'rotationAction',
  'transitionId', 'successorIssue', 'cutoverPrNumber', 'cutoverHead', 'probeRequestIds']);
const positive = n => Number.isSafeInteger(n) && n > 0;
const fail = blocker => Object.freeze({ ok: false, requested: true, verdict: 'BLOCKED', blocker });

export function validateMailboxRotationCommandShape(command = {}) {
  if (command.operation !== MAILBOX_ROTATION_OPERATION) return { ok: true, requested: false };
  if (Object.keys(command).some(key => !fields.has(key))) return fail('MAILBOX_ROTATION_FIELD_NOT_ALLOWED');
  if (command.schemaVersion !== 'stephanos.battle-bridge-github-command.v1'
    || command.repository !== REPOSITORY || command.issueNumber !== CANONICAL_MAILBOX_ISSUE
    || command.branch !== 'main' || command.operatorApproval !== 'operator-approved'
    || !MAILBOX_ROTATION_SHA.test(command.expectedHead || '')
    || !MAILBOX_ROTATION_REQUEST_ID.test(command.requestId || '')
    || !MAILBOX_ROTATION_REQUEST_ID.test(command.transitionId || '')) return fail('MAILBOX_ROTATION_EXACT_ENVELOPE_REQUIRED');
  if (!['FREEZE', 'DRAIN', 'STATUS', 'CANCEL', 'VERIFY'].includes(command.rotationAction)) return fail('MAILBOX_ROTATION_ACTION_INVALID');
  if (command.rotationAction === 'FREEZE') {
    if (!positive(command.successorIssue) || command.successorIssue <= CANONICAL_MAILBOX_ISSUE
      || RETIRED_CANONICAL_MAILBOX_ISSUES.includes(command.successorIssue)
      || !positive(command.cutoverPrNumber) || !MAILBOX_ROTATION_SHA.test(command.cutoverHead || '')) return fail('MAILBOX_ROTATION_CUTOVER_BINDING_REQUIRED');
  } else if (['successorIssue', 'cutoverPrNumber', 'cutoverHead'].some(key => Object.hasOwn(command, key))) return fail('MAILBOX_ROTATION_FIELD_NOT_ALLOWED');
  if (command.rotationAction === 'VERIFY') {
    if (!Array.isArray(command.probeRequestIds) || command.probeRequestIds.length !== 2
      || new Set(command.probeRequestIds).size !== 2
      || !command.probeRequestIds.every(id => MAILBOX_ROTATION_REQUEST_ID.test(id))) return fail('MAILBOX_ROTATION_TWO_DISTINCT_PROBES_REQUIRED');
  } else if (Object.hasOwn(command, 'probeRequestIds')) return fail('MAILBOX_ROTATION_FIELD_NOT_ALLOWED');
  return { ok: true, requested: true, command: Object.freeze({ ...command }) };
}
export function isTerminalizableMailboxRotationBlocker(value) {
  return ['MAILBOX_ROTATION_FIELD_NOT_ALLOWED', 'MAILBOX_ROTATION_EXACT_ENVELOPE_REQUIRED',
    'MAILBOX_ROTATION_ACTION_INVALID', 'MAILBOX_ROTATION_CUTOVER_BINDING_REQUIRED',
    'MAILBOX_ROTATION_TWO_DISTINCT_PROBES_REQUIRED'].includes(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const mailboxRotationDigest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

// Observation parsing only. Executable admission still uses the original full
// owner/head/expiry validators. A retired command can only become provenance.
export function parseMailboxRotationComment(comment, issueNumber) {
  if (!positive(issueNumber) || comment?.user?.login !== OWNER || !positive(comment.id)
    || comment.html_url !== `https://github.com/${REPOSITORY}/issues/${issueNumber}#issuecomment-${comment.id}`
    || typeof comment.body !== 'string' || Buffer.byteLength(comment.body, 'utf8') > 64000) return null;
  const commandMatch = comment.body.match(/```stephanos-battle-bridge-command\s*([\s\S]*?)```/i);
  const receiptMatch = comment.body.includes('<!-- stephanos-battle-bridge-command-receipt -->')
    && comment.body.match(/```json\s*([\s\S]*?)```/i);
  const type = commandMatch ? 'command' : receiptMatch ? 'receipt' : '';
  if (!type) return null;
  let value;
  try { value = JSON.parse((commandMatch || receiptMatch)[1]); } catch { return null; }
  if (value?.schemaVersion !== `stephanos.battle-bridge-github-command${type === 'receipt' ? '-receipt' : ''}.v1`
    || value.repository !== REPOSITORY || value.issueNumber !== issueNumber || value.branch !== 'main'
    || !MAILBOX_ROTATION_REQUEST_ID.test(value.requestId || '') || typeof value.operation !== 'string') return null;
  return { type, value, commentId: comment.id, commentUrl: comment.html_url };
}

export function auditMailboxRotationComments(comments, { issueNumber, barrierCommentId = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Array.isArray(comments) || !positive(issueNumber) || !positive(barrierCommentId)) throw new Error('MAILBOX_ROTATION_INVENTORY_INVALID');
  const commands = new Map(), terminal = new Map(), accepted = new Map();
  const observations = [];
  for (const comment of comments) {
    const parsed = parseMailboxRotationComment(comment, issueNumber);
    if (!parsed) continue;
    observations.push(parsed);
    if (parsed.type === 'command') {
      const entries = commands.get(parsed.value.requestId) || [];
      entries.push(parsed); commands.set(parsed.value.requestId, entries);
    } else if (['DONE', 'BLOCKED'].includes(parsed.value.state)) {
      const entries = terminal.get(parsed.value.requestId) || [];
      entries.push(parsed); terminal.set(parsed.value.requestId, entries);
    } else if (parsed.value.state === 'ACCEPTED') accepted.set(parsed.value.requestId, parsed);
  }
  const terminalIds = [], pendingBeforeBarrier = [], pendingAfterBarrier = [];
  for (const [id, entries] of commands) {
    const completed = (terminal.get(id) || []).some(receipt => entries.some(command =>
      receipt.value.operation === command.value.operation
      && (receipt.value.expectedHead || '') === (command.value.expectedHead || '')));
    if (completed) terminalIds.push(id);
    else if (entries.every(entry => entry.value.operation === MAILBOX_ROTATION_OPERATION)) continue;
    else (entries.some(entry => entry.commentId <= barrierCommentId) ? pendingBeforeBarrier : pendingAfterBarrier).push(id);
  }
  // The private guarded transport can leave genuine native receipts without a
  // public command comment. Preserve those identities and pair their ACCEPTED
  // checkpoint with the matching terminal instead of inventing an in-flight hold.
  for (const [id, receipts] of terminal) {
    const checkpoint = accepted.get(id);
    if (!commands.has(id) && (!checkpoint || receipts.some(receipt => receipt.value.operation === checkpoint.value.operation
      && (receipt.value.expectedHead || '') === (checkpoint.value.expectedHead || '')))) terminalIds.push(id);
  }
  const acceptedIds = [...accepted.keys()].filter(id => !terminalIds.includes(id)
    && !(commands.has(id) && commands.get(id).every(entry => entry.value.operation === MAILBOX_ROTATION_OPERATION)));
  return Object.freeze({ issueNumber, commandCount: [...commands.values()].reduce((n,v) => n+v.length, 0),
    requestIds: [...new Set([...commands.keys(), ...terminal.keys(), ...accepted.keys()])], terminalIds, acceptedIds, pendingBeforeBarrier, pendingAfterBarrier,
    highestCommandCommentId: Math.max(0, ...[...commands.values()].flat().map(c => c.commentId)),
    inventoryDigest: mailboxRotationDigest(observations.sort((a,b) => a.commentId-b.commentId)),
  });
}

export function validateMailboxRotationRecord(record) {
  if (!record || typeof record !== 'object' || record.schemaVersion !== MAILBOX_ROTATION_SCHEMA
    || !MAILBOX_ROTATION_REQUEST_ID.test(record.transitionId || '')
    || !['DRAINING', 'FROZEN', 'VERIFIED', 'CANCELLED'].includes(record.phase)
    || !positive(record.predecessorIssue) || !positive(record.successorIssue)
    || record.successorIssue <= record.predecessorIssue || !positive(record.barrierCommentId)
    || !positive(record.cutoverPrNumber) || !MAILBOX_ROTATION_SHA.test(record.cutoverHead || '')
    || !MAILBOX_ROTATION_SHA.test(record.preparationHead || '')
    || !MAILBOX_ROTATION_REQUEST_ID.test(record.freezeRequestId || '')
    || !Number.isFinite(Date.parse(record.requestedAt || ''))) throw new Error('MAILBOX_ROTATION_RECORD_INVALID');
  return record;
}

export function mailboxRotationCommandAllowed(command, commentId, record, { approvedUpdateHead = '' } = {}) {
  if (!record) return true;
  validateMailboxRotationRecord(record);
  if (['VERIFIED', 'CANCELLED'].includes(record.phase)) return true;
  if (command?.operation === MAILBOX_ROTATION_OPERATION) return command.transitionId === record.transitionId;
  if (CANONICAL_MAILBOX_ISSUE === record.predecessorIssue && record.phase === 'DRAINING'
    && positive(commentId) && commentId < record.barrierCommentId) return true;
  if (command?.operation === 'APPROVE_PROTECTED_MERGE_ENVIRONMENT') return command.prNumber === record.cutoverPrNumber
    && command.expectedPullRequestHead === record.cutoverHead;
  if (command?.operation === 'UPDATE_STEPHANOS_FROM_CHAT') return MAILBOX_ROTATION_SHA.test(approvedUpdateHead)
    && command.expectedHead === approvedUpdateHead;
  // Only two fixed read-only classes can produce successor commissioning proof.
  if (CANONICAL_MAILBOX_ISSUE === record.successorIssue) return ['READ_DEPLOYMENT_STATUS', 'READ_CAPABILITY_REGISTRY'].includes(command?.operation);
  return false;
}

// Called only by the existing outer guard AFTER the child and its segmented
// receipt outbox have settled. A child can never self-attest an empty outbox.
export function settleMailboxRotationDrain(state, { outboxPendingCount, now = new Date().toISOString() } = {}) {
  const record = state?.mailboxRotation;
  if (!record) return state;
  validateMailboxRotationRecord(record);
  if (['VERIFIED', 'CANCELLED'].includes(record.phase)) return state;
  if (!Number.isSafeInteger(outboxPendingCount) || outboxPendingCount < 0) throw new Error('MAILBOX_ROTATION_OUTBOX_UNPROVEN');
  const inventory = state.mailboxRotationInventory;
  const drained = outboxPendingCount === 0 && Array.isArray(state.acceptedRequestIds) && !state.acceptedRequestIds.length
    && record.globalFencePublished === true
    && state.mailboxRotationActions?.complete === true
    && Array.isArray(state.mailboxRotationActions.pendingRuns) && !state.mailboxRotationActions.pendingRuns.length
    && Date.parse(now) - Date.parse(state.mailboxRotationActions.observedAt) >= 0
    && Date.parse(now) - Date.parse(state.mailboxRotationActions.observedAt) <= 120000
    && Array.isArray(state.pendingReceiptPublications) && !state.pendingReceiptPublications.length
    && inventory?.issueNumber === record.predecessorIssue
    && /^[a-f0-9]{64}$/.test(inventory.inventoryDigest || '')
    && Array.isArray(inventory.pendingBeforeBarrier) && !inventory.pendingBeforeBarrier.length
    && Array.isArray(inventory.pendingAfterBarrier) && !inventory.pendingAfterBarrier.length
    && Array.isArray(inventory.acceptedIds) && !inventory.acceptedIds.length;
  return { ...state, mailboxRotation: { ...record, phase: drained ? 'FROZEN' : 'DRAINING',
    outboxPendingCount, drained, settledAt: now,
    inventoryDigest: inventory?.inventoryDigest || '',
    pendingBeforeBarrierCount: inventory?.pendingBeforeBarrier?.length ?? -1,
    pendingAfterBarrierCount: inventory?.pendingAfterBarrier?.length ?? -1,
  } };
}

export function verifyMailboxRotationProbes(comments, record, { sourceHead, requestIds } = {}) {
  validateMailboxRotationRecord(record);
  if (CANONICAL_MAILBOX_ISSUE !== record.successorIssue || !MAILBOX_ROTATION_SHA.test(sourceHead || '')
    || !Array.isArray(requestIds) || requestIds.length !== 2 || new Set(requestIds).size !== 2) return false;
  return requestIds.every(id => {
    const parsed = comments.map(c => parseMailboxRotationComment(c, record.successorIssue)).filter(Boolean);
    const command = parsed.find(p => p.type === 'command' && p.value.requestId === id
      && p.value.expectedHead === sourceHead && ['READ_DEPLOYMENT_STATUS', 'READ_CAPABILITY_REGISTRY'].includes(p.value.operation));
    if (!command) return false;
    return parsed.some(p => p.type === 'receipt' && p.value.requestId === id && p.value.state === 'ACCEPTED'
      && p.value.expectedHead === sourceHead && p.value.processSourceHead === sourceHead)
      && parsed.some(p => p.type === 'receipt' && p.value.requestId === id && p.value.state === 'DONE'
        && p.value.operation === command.value.operation && p.value.expectedHead === sourceHead
        && p.value.processSourceHead === sourceHead && Date.parse(p.value.acceptedAt) >= Date.parse(record.requestedAt));
  });
}

export function projectMailboxRotation(record, inventory) {
  if (!record) return { phase: 'NONE', commandAuthorityChanged: false };
  validateMailboxRotationRecord(record);
  return { transitionId: record.transitionId, phase: record.phase, predecessorIssue: record.predecessorIssue,
    successorIssue: record.successorIssue, cutoverPrNumber: record.cutoverPrNumber, cutoverHead: record.cutoverHead,
    preparationHead: record.preparationHead, drained: record.drained === true,
    inventoryDigest: /^[a-f0-9]{64}$/.test(inventory?.inventoryDigest || record.inventoryDigest || '') ? (inventory?.inventoryDigest || record.inventoryDigest) : '',
    pendingBeforeBarrierCount: inventory?.pendingBeforeBarrier?.length ?? -1,
    pendingAfterBarrierCount: inventory?.pendingAfterBarrier?.length ?? -1,
    mergeAuthority: false, sourceMutationAuthority: false,
  };
}

export function projectMailboxRotationReceipt(value, operation) {
  if (operation !== MAILBOX_ROTATION_OPERATION) return {};
  const record = value?.mailboxRotation || {};
  if (!['NONE', 'DRAINING', 'FROZEN', 'VERIFIED', 'CANCELLED'].includes(record.phase)) return { mailboxRotation: { phase: 'UNKNOWN' } };
  const safe = { phase: record.phase, drained: record.drained === true, mergeAuthority: false, sourceMutationAuthority: false };
  if (MAILBOX_ROTATION_REQUEST_ID.test(record.transitionId || '')) safe.transitionId = record.transitionId;
  for (const key of ['predecessorIssue', 'successorIssue', 'cutoverPrNumber']) if (positive(record[key])) safe[key] = record[key];
  for (const key of ['cutoverHead', 'preparationHead']) if (MAILBOX_ROTATION_SHA.test(record[key] || '')) safe[key] = record[key];
  if (/^[a-f0-9]{64}$/.test(record.inventoryDigest || '')) safe.inventoryDigest = record.inventoryDigest;
  for (const key of ['pendingBeforeBarrierCount', 'pendingAfterBarrierCount']) if (Number.isSafeInteger(record[key]) && record[key] >= -1) safe[key] = record[key];
  return { mailboxRotation: safe };
}
