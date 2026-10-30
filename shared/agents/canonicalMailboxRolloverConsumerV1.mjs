import {
  CANONICAL_MAILBOX_ISSUE,
  RETIRED_CANONICAL_MAILBOX_ISSUES,
  validateCanonicalMailboxSuccessor,
} from './canonicalMailboxAuthorityV1.mjs';
import { planCanonicalMailboxRollover } from './canonicalMailboxRolloverPlannerV1.mjs';

// Run only in the existing serialized receipt-mirror job on protected main.
// This consumer can provision inert capacity. It cannot switch source authority,
// copy commands, approve/merge source, stop producers, or mutate the host.
export const CANONICAL_MAILBOX_ROLLOVER_CONSUMER_SCHEMA = 'stephanos.canonical-mailbox-rollover-consumer.v1';
export const CANONICAL_MAILBOX_ROLLOVER_OWNER_GOAL = 2315;
export const CANONICAL_MAILBOX_SUCCESSOR_MARKER = 'stephanos:canonical-mailbox-successor:v1';
export const CANONICAL_MAILBOX_ROLLOVER_STATE_MARKER = 'stephanos:2315-mailbox-capacity-state:v1';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const OWNER = 'Cheekyfellastef';
const HEAD = /^[a-f0-9]{40}$/;
const integer = value => Number.isSafeInteger(value) && value > 0;
const identities = new Set([OWNER, 'github-actions[bot]']);
const requiredGates = Object.freeze([
  'ORIGINAL_OWNER_EXCLUSIVE_SOURCE_LEASE',
  'ALL_PRODUCER_FREEZE_ACKNOWLEDGEMENTS',
  'FROZEN_PREDECESSOR_FULL_COMMAND_AND_RECEIPT_READBACK',
  'ACCEPTED_ACTION_AND_RECEIPT_OUTBOX_DRAIN',
  'CROSS_EPOCH_DEDUPLICATION_AND_RECEIPT_ONLY_DUAL_READ',
  'EXACT_HEAD_BASE_TREE_CI_AND_INDEPENDENT_SPECIALIST_REVIEW',
  'EXACT_OPERATOR_PROTECTED_APPROVAL',
  'ATOMIC_SOURCE_AUTHORITY_CHANGE_AND_HOST_CONVERGENCE',
  'ALL_PRODUCER_AND_CONSUMER_EPOCH_READBACK',
  'TWO_DISTINCT_SUCCESSOR_ACCEPTED_TO_TERMINAL_PROBES',
  'PREDECESSOR_NEW_COMMAND_DENIAL_AND_PROVENANCE_RETENTION',
]);

function result(state, blocker, additions = {}) {
  return Object.freeze({
    schemaVersion: CANONICAL_MAILBOX_ROLLOVER_CONSUMER_SCHEMA,
    ok: !blocker, state, blocker, repository: REPOSITORY,
    ownerGoal: CANONICAL_MAILBOX_ROLLOVER_OWNER_GOAL,
    currentIssue: CANONICAL_MAILBOX_ISSUE,
    successorIssue: 0, successorCreated: false,
    commandAuthorityChanged: false, cutoverReady: false,
    sourceMutationAuthority: false, runtimeMutationAuthority: false,
    mergeAuthority: false, requiredGates,
    ...additions,
  });
}

function validIssue(issue, number) {
  return issue?.number === number
    && issue.repository_url === `https://api.github.com/repos/${REPOSITORY}`
    && issue.html_url === `https://github.com/${REPOSITORY}/issues/${number}`
    && !issue.pull_request && issue.state === 'open'
    && issue.locked === false && identities.has(issue.user?.login);
}

export function canonicalMailboxSuccessorBody({ currentIssue = CANONICAL_MAILBOX_ISSUE } = {}) {
  if (currentIssue !== CANONICAL_MAILBOX_ISSUE) throw new Error('CANONICAL_MAILBOX_CURRENT_ISSUE_MISMATCH');
  return `Status: INACTIVE — NO COMMAND AUTHORITY.\n\nSingle nominated transport successor to #${currentIssue}, owned by Goal #${CANONICAL_MAILBOX_ROLLOVER_OWNER_GOAL}. This issue is transport capacity, not a queue, worker, controller, goal or command authority.\n\nDo not post or copy executable commands here. Protected source admission, producer freeze and drain, receipt-only dual-read, cross-epoch deduplication, exact independent specialist review and operator approval, host convergence, producer/consumer readback and two distinct authenticated read-only ACCEPTED→terminal probes are required before activation. Preserve every original command/receipt, all five hourly controllers, retired R7 audit, gaming guards and dirty files.\n\n<!-- ${CANONICAL_MAILBOX_SUCCESSOR_MARKER} predecessor=${currentIssue} state=INACTIVE -->\n`;
}

export function evaluateCanonicalMailboxSuccessorCandidate(issue) {
  const number = issue?.number;
  const successor = validateCanonicalMailboxSuccessor({ nextIssue: number });
  if (!integer(number) || !successor.ok || number <= CANONICAL_MAILBOX_ISSUE
    || RETIRED_CANONICAL_MAILBOX_ISSUES.includes(number) || !validIssue(issue, number)) {
    return result('BLOCKED', 'CANONICAL_MAILBOX_SUCCESSOR_IDENTITY_UNVERIFIED');
  }
  const body = issue.body;
  const marker = new RegExp(`^<!-- ${CANONICAL_MAILBOX_SUCCESSOR_MARKER} predecessor=${CANONICAL_MAILBOX_ISSUE}(?: successor=${number})? state=INACTIVE -->$`, 'm');
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 64000
    || !marker.test(body) || !body.includes('NO COMMAND AUTHORITY')
    || /```stephanos-(?:battle-bridge-command|protected-workflow-dispatch)/i.test(body)) {
    return result('BLOCKED', 'CANONICAL_MAILBOX_SUCCESSOR_MARKER_UNVERIFIED');
  }
  return result('SUCCESSOR_PROVISIONED_INACTIVE', '', { successorIssue: number });
}

// Adapter contract: authenticated GitHub reads; complete REST enumeration of all
// issues newer than the current mailbox; fixed mirror concurrency; read after
// create. A failed/ambiguous create is never retried in this invocation. A later
// invocation must enumerate REST truth again before making another request.
export async function observeCanonicalMailboxRollover({ sourceHead, adapter } = {}) {
  if (!HEAD.test(sourceHead || '') || !adapter
    || !['getIssue', 'listNewerIssues', 'readProvisioningIntent', 'beginProvisioning', 'createInactiveSuccessor', 'publishState']
      .every(key => typeof adapter[key] === 'function')) {
    return result('BLOCKED', 'CANONICAL_MAILBOX_ROLLOVER_CONTEXT_UNVERIFIED');
  }
  let phase = 'OBSERVATION';
  try {
    const current = await adapter.getIssue(CANONICAL_MAILBOX_ISSUE);
    if (!validIssue(current, CANONICAL_MAILBOX_ISSUE)) {
      return result('BLOCKED', 'CANONICAL_MAILBOX_CURRENT_IDENTITY_UNVERIFIED');
    }
    const plan = planCanonicalMailboxRollover({ issueNumber: current.number, commentCount: current.comments });
    if (!plan.ok) return result('BLOCKED', plan.blocker);
    if (plan.state === 'HEALTHY') return result('HEALTHY', '', { sourceHead, commentCount: current.comments });
    const listed = await adapter.listNewerIssues(CANONICAL_MAILBOX_ISSUE);
    if (listed?.complete !== true || !Array.isArray(listed.issues)
      || listed.issues.some(issue => !integer(issue?.number) || issue.number <= CANONICAL_MAILBOX_ISSUE)) {
      return result('BLOCKED', 'CANONICAL_MAILBOX_SUCCESSOR_ENUMERATION_INCOMPLETE');
    }
    // Even a closed, malformed, or untrusted nomination blocks creation. Do not
    // silently manufacture a competing successor when ownership needs review.
    const nomination = new RegExp(`${CANONICAL_MAILBOX_SUCCESSOR_MARKER} predecessor=${CANONICAL_MAILBOX_ISSUE}(?:\\s|$)`);
    const candidates = listed.issues.filter(issue => nomination.test(String(issue.body || '')));
    if (candidates.length > 1) return result('BLOCKED', 'CANONICAL_MAILBOX_MULTIPLE_SUCCESSORS');
    let candidate = candidates[0];
    let created = false;
    if (!candidate) {
      if (await adapter.readProvisioningIntent()) {
        return result('BLOCKED', 'CANONICAL_MAILBOX_SUCCESSOR_CREATE_OUTCOME_UNKNOWN');
      }
      phase = 'PROVISIONING';
      // Persist intent BEFORE GitHub creates an issue. If the create response is
      // lost, absence from a subsequent read is never permission to create twice.
      await adapter.beginProvisioning({ sourceHead, currentIssue: CANONICAL_MAILBOX_ISSUE });
      const supplied = await adapter.createInactiveSuccessor({
        title: `INACTIVE canonical mailbox successor to #${CANONICAL_MAILBOX_ISSUE} — Goal #${CANONICAL_MAILBOX_ROLLOVER_OWNER_GOAL}`,
        body: canonicalMailboxSuccessorBody(),
      });
      if (!integer(supplied?.number) || supplied.number <= CANONICAL_MAILBOX_ISSUE) {
        return result('BLOCKED', 'CANONICAL_MAILBOX_SUCCESSOR_CREATE_OUTCOME_UNKNOWN');
      }
      candidate = await adapter.getIssue(supplied.number);
      created = true;
    } else {
      candidate = await adapter.getIssue(candidate.number);
    }
    const validation = evaluateCanonicalMailboxSuccessorCandidate(candidate);
    if (!validation.ok) return validation;
    const status = result('SUCCESSOR_PROVISIONED_INACTIVE', '', {
      sourceHead, commentCount: current.comments,
      successorIssue: candidate.number, successorCreated: created,
      executionBlocker: 'CANONICAL_MAILBOX_PROTECTED_CUTOVER_NOT_COMMISSIONED',
    });
    phase = 'STATE_PUBLICATION';
    await adapter.publishState(status);
    return status;
  } catch {
    return result('BLOCKED', phase === 'PROVISIONING'
      ? 'CANONICAL_MAILBOX_SUCCESSOR_CREATE_OUTCOME_UNKNOWN'
      : phase === 'STATE_PUBLICATION'
        ? 'CANONICAL_MAILBOX_CAPACITY_STATE_PUBLICATION_FAILED'
        : 'CANONICAL_MAILBOX_CAPACITY_OBSERVATION_FAILED');
  }
}

export function buildCanonicalMailboxCapacityStateBody(state) {
  if (state?.schemaVersion !== CANONICAL_MAILBOX_ROLLOVER_CONSUMER_SCHEMA
    || state.state !== 'SUCCESSOR_PROVISIONED_INACTIVE' || !HEAD.test(state.sourceHead || '')
    || !integer(state.successorIssue) || !Number.isSafeInteger(state.commentCount)) {
    throw new Error('CANONICAL_MAILBOX_CAPACITY_STATE_INVALID');
  }
  return `<!-- ${CANONICAL_MAILBOX_ROLLOVER_STATE_MARKER} predecessor=${CANONICAL_MAILBOX_ISSUE} -->\nMAILBOX_ROTATION_REQUIRED\n\nProtected source: \`${state.sourceHead}\`. Canonical mailbox #${CANONICAL_MAILBOX_ISSUE}: ${state.commentCount} comments. One nominated successor: #${state.successorIssue}, INACTIVE / NO COMMAND AUTHORITY.\n\nExecution hold: \`${state.executionBlocker}\`. Automatic preparation does not authorize cutover.\n\nRequired gates:\n${requiredGates.map(gate => `- ${gate}`).join('\n')}\n`;
}
