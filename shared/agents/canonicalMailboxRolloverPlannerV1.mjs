import {
  CANONICAL_MAILBOX_ISSUE,
  RETIRED_CANONICAL_MAILBOX_ISSUES,
  evaluateCanonicalMailboxCapacity,
  validateCanonicalMailboxSuccessor,
} from './canonicalMailboxAuthorityV1.mjs';

export const CANONICAL_MAILBOX_ROLLOVER_PLAN_SCHEMA = 'stephanos.canonical-mailbox-rollover-plan.v1';

const positiveInteger = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
};

const freezeArray = (values) => Object.freeze([...values]);

function blocked(capacity, blocker, candidateSuccessorIssue = 0) {
  return Object.freeze({
    schemaVersion: CANONICAL_MAILBOX_ROLLOVER_PLAN_SCHEMA,
    ok: false,
    state: 'BLOCKED',
    action: 'NONE',
    blocker,
    currentIssue: capacity?.issueNumber || CANONICAL_MAILBOX_ISSUE,
    candidateSuccessorIssue,
    mutationAllowed: false,
    runtimeMutationAuthority: false,
    mergeAuthority: false,
  });
}

export function planCanonicalMailboxRollover({
  issueNumber = CANONICAL_MAILBOX_ISSUE,
  commentCount = 0,
  candidateSuccessorIssue,
} = {}) {
  const capacity = evaluateCanonicalMailboxCapacity({ issueNumber, commentCount });
  const candidate = positiveInteger(candidateSuccessorIssue);

  if (!capacity.ok) return blocked(capacity, capacity.blocker, candidate);

  if (!capacity.rotationRequired) {
    return Object.freeze({
      schemaVersion: CANONICAL_MAILBOX_ROLLOVER_PLAN_SCHEMA,
      ok: true,
      state: 'HEALTHY',
      action: 'NONE',
      blocker: '',
      currentIssue: capacity.issueNumber,
      commentCount: capacity.commentCount,
      rotationThresholdComments: capacity.rotationThresholdComments,
      candidateSuccessorIssue: candidate,
      mutationAllowed: false,
      runtimeMutationAuthority: false,
      mergeAuthority: false,
    });
  }

  if (!candidate) {
    return Object.freeze({
      schemaVersion: CANONICAL_MAILBOX_ROLLOVER_PLAN_SCHEMA,
      ok: true,
      state: 'ROTATION_REQUIRED',
      action: 'CREATE_OR_NOMINATE_SUCCESSOR',
      blocker: '',
      currentIssue: capacity.issueNumber,
      commentCount: capacity.commentCount,
      rotationThresholdComments: capacity.rotationThresholdComments,
      candidateSuccessorIssue: 0,
      successorProvisioningRequired: true,
      mutationAllowed: false,
      runtimeMutationAuthority: false,
      mergeAuthority: false,
    });
  }

  const successor = validateCanonicalMailboxSuccessor({
    currentIssue: capacity.issueNumber,
    nextIssue: candidate,
  });
  if (!successor.ok) return blocked(capacity, successor.blocker, candidate);

  const retiredIssuesAfterCutover = freezeArray([
    ...new Set([...RETIRED_CANONICAL_MAILBOX_ISSUES, capacity.issueNumber]),
  ].sort((a, b) => a - b));

  return Object.freeze({
    schemaVersion: CANONICAL_MAILBOX_ROLLOVER_PLAN_SCHEMA,
    ok: true,
    state: 'SUCCESSOR_READY_FOR_ATOMIC_CUTOVER',
    action: 'PREPARE_CANONICAL_AUTHORITY_MIGRATION',
    blocker: '',
    currentIssue: capacity.issueNumber,
    commentCount: capacity.commentCount,
    rotationThresholdComments: capacity.rotationThresholdComments,
    candidateSuccessorIssue: successor.nextIssue,
    successorProvisioningRequired: false,
    migrationTarget: Object.freeze({
      activeIssue: successor.nextIssue,
      retiredIssues: retiredIssuesAfterCutover,
      preservesSingleCanonicalAuthority: true,
    }),
    mutationAllowed: false,
    runtimeMutationAuthority: false,
    mergeAuthority: false,
  });
}
