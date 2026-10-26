import { CANONICAL_MAILBOX_ISSUE, RETIRED_CANONICAL_MAILBOX_ISSUES } from '../shared/agents/canonicalMailboxAuthorityV1.mjs';
import { evaluateCanonicalMailboxSuccessorCandidate } from '../shared/agents/canonicalMailboxRolloverConsumerV1.mjs';
import { MAILBOX_ROTATION_SCHEMA, auditMailboxRotationComments, projectMailboxRotation,
  validateMailboxRotationCommandShape, validateMailboxRotationRecord, verifyMailboxRotationProbes } from '../shared/agents/canonicalMailboxRotationV1.mjs';

export function readMailboxAuthorityLiteral(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 64000) throw new Error('MAILBOX_ROTATION_SOURCE_INVALID');
  const active = source.match(/^export const CANONICAL_MAILBOX_ISSUE = ([1-9][0-9]*);$/m);
  const retired = source.match(/^export const RETIRED_CANONICAL_MAILBOX_ISSUES = Object.freeze\(\[([0-9, ]*)\]\);$/m);
  if (!active || !retired) throw new Error('MAILBOX_ROTATION_SOURCE_INVALID');
  return { active: Number(active[1]), retired: retired[1].split(',').map(s => Number(s.trim())).filter(Boolean) };
}

export function verifyMailboxRotationActivationPull(pull, record, authority, { merged = false, mainHead = '' } = {}) {
  return pull?.number === record.cutoverPrNumber && pull.head?.sha === record.cutoverHead
    && pull.head?.repo?.full_name === 'Cheekyfellastef/stephan-os' && pull.base?.ref === 'main'
    && (merged ? pull.merged === true && pull.merge_commit_sha === mainHead : pull.state === 'open' && pull.merged !== true)
    && authority.active === record.successorIssue && authority.retired.includes(record.predecessorIssue);
}

export async function executeMailboxRotationOnHost(command, {
  state, selectedCommentId, sourceHead, readIssue, readPull, readAuthoritySource,
  readComments, persist, publishFence, readActions, now = () => new Date().toISOString(),
} = {}) {
  const shape = validateMailboxRotationCommandShape(command);
  if (!shape.ok || !shape.requested) return shape;
  const held = blocker => ({ ok: false, blocker, finalVerdict: 'MAILBOX_ROTATION_HELD',
    mailboxRotation: projectMailboxRotation(state?.mailboxRotation, state?.mailboxRotationInventory), mergeAuthority: false });
  if (!state || sourceHead !== command.expectedHead || !Number.isSafeInteger(selectedCommentId)
    || selectedCommentId <= 0 || ![readIssue, readPull, readAuthoritySource, readComments, persist, publishFence, readActions].every(f => typeof f === 'function')) return held('MAILBOX_ROTATION_HOST_CONTEXT_UNPROVEN');
  const existing = state.mailboxRotation;
  if (existing) validateMailboxRotationRecord(existing);
  if (command.rotationAction === 'FREEZE') {
    if (existing && !['CANCELLED', 'VERIFIED'].includes(existing.phase)) return held('MAILBOX_ROTATION_ALREADY_ACTIVE');
    const successor = await readIssue(command.successorIssue);
    const validation = evaluateCanonicalMailboxSuccessorCandidate(successor);
    if (!validation.ok) return held(validation.blocker);
    const record = { schemaVersion: MAILBOX_ROTATION_SCHEMA, transitionId: command.transitionId,
      predecessorIssue: CANONICAL_MAILBOX_ISSUE, successorIssue: command.successorIssue,
      cutoverPrNumber: command.cutoverPrNumber, cutoverHead: command.cutoverHead,
      preparationHead: sourceHead, barrierCommentId: selectedCommentId, freezeCommentId: selectedCommentId,
      freezeRequestId: command.requestId, phase: 'DRAINING', requestedAt: now(), drained: false };
    const pull = await readPull(record.cutoverPrNumber);
    const authority = readMailboxAuthorityLiteral(await readAuthoritySource(record.cutoverHead));
    if (!verifyMailboxRotationActivationPull(pull, record, authority)) return held('MAILBOX_ROTATION_ACTIVATION_PULL_UNVERIFIED');
    state.mailboxRotation = record;
  } else {
    if (!existing || existing.transitionId !== command.transitionId) return held('MAILBOX_ROTATION_TRANSITION_MISMATCH');
    if (command.rotationAction === 'CANCEL') {
      if (CANONICAL_MAILBOX_ISSUE !== existing.predecessorIssue) return held('MAILBOX_ROTATION_PROTECTED_ROLLBACK_REQUIRED');
      state.mailboxRotation = { ...existing, phase: 'CANCELLED', cancelledAt: now() };
    } else if (command.rotationAction === 'DRAIN') {
      if (CANONICAL_MAILBOX_ISSUE !== existing.predecessorIssue || ['VERIFIED', 'CANCELLED'].includes(existing.phase)) return held('MAILBOX_ROTATION_DRAIN_EPOCH_MISMATCH');
      state.mailboxRotation = { ...existing, phase: 'DRAINING', barrierCommentId: selectedCommentId, drained: false };
    } else if (command.rotationAction === 'VERIFY') {
      if (CANONICAL_MAILBOX_ISSUE !== existing.successorIssue || existing.phase !== 'FROZEN' || existing.drained !== true) return held('MAILBOX_ROTATION_DRAIN_NOT_PROVEN');
      const actions = await readActions();
      if (actions?.complete !== true || actions.pendingRuns?.length !== 0) return held('MAILBOX_ROTATION_ACTIONS_PENDING');
      const predecessor = auditMailboxRotationComments(await readComments(existing.predecessorIssue), {
        issueNumber: existing.predecessorIssue, barrierCommentId: existing.barrierCommentId,
      });
      if (predecessor.pendingBeforeBarrier.length || predecessor.pendingAfterBarrier.length || predecessor.acceptedIds.length) return held('MAILBOX_ROTATION_PREDECESSOR_ACTION_PENDING');
      if (!verifyMailboxRotationProbes(await readComments(existing.successorIssue), existing, {
        sourceHead, requestIds: command.probeRequestIds,
      })) return held('MAILBOX_ROTATION_SUCCESSOR_PROBES_UNPROVEN');
      const pull = await readPull(existing.cutoverPrNumber);
      const authority = readMailboxAuthorityLiteral(await readAuthoritySource(sourceHead));
      if (!verifyMailboxRotationActivationPull(pull, existing, authority, { merged: true, mainHead: sourceHead })) return held('MAILBOX_ROTATION_ACTIVATION_MERGE_UNVERIFIED');
      if (!RETIRED_CANONICAL_MAILBOX_ISSUES.includes(existing.predecessorIssue)) return held('MAILBOX_ROTATION_PREDECESSOR_NOT_RETIRED');
      state.mailboxRotation = { ...existing, phase: 'VERIFIED', verifiedAt: now(), sourceHead,
        probeRequestIds: [...command.probeRequestIds], predecessorInventoryDigest: predecessor.inventoryDigest };
    }
  }
  const record = state.mailboxRotation;
  state.mailboxRotation = { ...record, controlCommentId: selectedCommentId };
  // Persist the local hold before the network operation. A failed/ambiguous
  // fence publication keeps DRAINING and can never certify a completed freeze.
  persist(state);
  if (!record.globalFencePublished || command.rotationAction === 'DRAIN') {
    await publishFence({ ...state.mailboxRotation, phase: 'DRAINING', drained: false }, { commandCommentId: selectedCommentId });
    state.mailboxRotation.globalFencePublished = true;
    persist(state);
  }
  if (!['CANCELLED', 'VERIFIED'].includes(record.phase)) {
    state.mailboxRotationActions = await readActions();
    if (state.mailboxRotationActions?.complete !== true || state.mailboxRotationActions.pendingRuns?.length !== 0) {
      state.mailboxRotation = { ...state.mailboxRotation, phase: 'DRAINING', drained: false };
    }
    state.mailboxRotationInventory = auditMailboxRotationComments(await readComments(record.predecessorIssue), {
      issueNumber: record.predecessorIssue, barrierCommentId: record.barrierCommentId,
    });
    const inventory = state.mailboxRotationInventory;
    if (inventory.pendingBeforeBarrier.length || inventory.pendingAfterBarrier.length || inventory.acceptedIds.length) {
      state.mailboxRotation = { ...state.mailboxRotation, phase: 'DRAINING', drained: false };
    }
  }
  persist(state);
  return { ok: true, finalVerdict: `MAILBOX_ROTATION_${state.mailboxRotation.phase}`,
    sourceHead, expectedHeadMatch: true, mailboxRotation: projectMailboxRotation(state.mailboxRotation, state.mailboxRotationInventory),
    mergeAuthority: false, sourceMutationAuthority: false, controllerConfigurationChanged: false };
}
