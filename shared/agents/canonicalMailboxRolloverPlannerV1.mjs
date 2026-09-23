import {
  CANONICAL_MAILBOX_ISSUE,
  evaluateCanonicalMailboxCapacity,
  validateCanonicalMailboxSuccessor,
} from './canonicalMailboxAuthorityV1.mjs';

export const CANONICAL_MAILBOX_ROLLOVER_PLAN_SCHEMA = 'stephanos.canonical-mailbox-rollover-plan.v1';

const positiveInteger = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
};

function blocked(capacity, blocker, candidateSuccessorIssue = 0) {
  const observedIssue = capacity && Object.prototype.hasOwnProperty.call(capacity, 'issueNumber')
    ? capacity.issueNumber
    : CANONICAL_MAILBOX_ISSUE;
  return Object.freeze({
    schemaVersion: CANONICAL_MAILBOX_ROLLOVER_PLAN_SCHEMA,
    ok: false,
    state: 'BLOCKED',
    action: 'NONE',
    blocker,
    currentIssue: observedIssue,
    candidateSuccessorIssue,
    cutoverReady: false,
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
      cutoverReady: false,
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
      trustedGitHubVerificationRequired: true,
      cutoverReady: false,
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

  return Object.freeze({
    schemaVersion: CANONICAL_MAILBOX_ROLLOVER_PLAN_SCHEMA,
    ok: true,
    state: 'SUCCESSOR_NOMINATED_AWAITING_TRUSTED_VERIFICATION',
    action: 'VERIFY_SUCCESSOR_WITH_CANONICAL_GITHUB_ADAPTER',
    blocker: '',
    currentIssue: capacity.issueNumber,
    commentCount: capacity.commentCount,
    rotationThresholdComments: capacity.rotationThresholdComments,
    candidateSuccessorIssue: successor.nextIssue,
    successorProvisioningRequired: true,
    trustedGitHubVerificationRequired: true,
    cutoverReady: false,
    mutationAllowed: false,
    runtimeMutationAuthority: false,
    mergeAuthority: false,
  });
}
