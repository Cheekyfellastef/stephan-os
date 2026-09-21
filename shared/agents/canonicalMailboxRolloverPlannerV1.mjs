import {
  CANONICAL_MAILBOX_ISSUE,
  RETIRED_CANONICAL_MAILBOX_ISSUES,
  evaluateCanonicalMailboxCapacity,
  validateCanonicalMailboxSuccessor,
} from './canonicalMailboxAuthorityV1.mjs';

export const CANONICAL_MAILBOX_ROLLOVER_PLAN_SCHEMA = 'stephanos.canonical-mailbox-rollover-plan.v1';
export const CANONICAL_MAILBOX_SUCCESSOR_PROVISIONING_SCHEMA = 'stephanos.canonical-mailbox-successor-provisioning-evidence.v1';
export const CANONICAL_MAILBOX_REPOSITORY = 'Cheekyfellastef/stephan-os';

const positiveInteger = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
};

const freezeArray = (values) => Object.freeze([...values]);

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
    mutationAllowed: false,
    runtimeMutationAuthority: false,
    mergeAuthority: false,
  });
}

function validSuccessorProvisioningEvidence(evidence, candidateIssue) {
  return Boolean(
    evidence
    && typeof evidence === 'object'
    && !Array.isArray(evidence)
    && evidence.schemaVersion === CANONICAL_MAILBOX_SUCCESSOR_PROVISIONING_SCHEMA
    && evidence.source === 'github-issue-read'
    && evidence.repository === CANONICAL_MAILBOX_REPOSITORY
    && positiveInteger(evidence.issueNumber) === candidateIssue
    && evidence.exists === true
    && evidence.state === 'open'
    && evidence.purpose === 'canonical-mailbox-successor'
  );
}

export function planCanonicalMailboxRollover({
  issueNumber = CANONICAL_MAILBOX_ISSUE,
  commentCount = 0,
  candidateSuccessorIssue,
  successorProvisioningEvidence,
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

  if (!successorProvisioningEvidence) {
    return Object.freeze({
      schemaVersion: CANONICAL_MAILBOX_ROLLOVER_PLAN_SCHEMA,
      ok: true,
      state: 'ROTATION_REQUIRED',
      action: 'VERIFY_SUCCESSOR_PROVISIONING',
      blocker: '',
      currentIssue: capacity.issueNumber,
      commentCount: capacity.commentCount,
      rotationThresholdComments: capacity.rotationThresholdComments,
      candidateSuccessorIssue: successor.nextIssue,
      successorProvisioningRequired: true,
      mutationAllowed: false,
      runtimeMutationAuthority: false,
      mergeAuthority: false,
    });
  }

  if (!validSuccessorProvisioningEvidence(successorProvisioningEvidence, successor.nextIssue)) {
    return blocked(capacity, 'CANONICAL_MAILBOX_SUCCESSOR_PROVISIONING_EVIDENCE_INVALID', candidate);
  }

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
    successorProvisioningEvidence: Object.freeze({
      schemaVersion: CANONICAL_MAILBOX_SUCCESSOR_PROVISIONING_SCHEMA,
      source: 'github-issue-read',
      repository: CANONICAL_MAILBOX_REPOSITORY,
      issueNumber: successor.nextIssue,
      exists: true,
      state: 'open',
      purpose: 'canonical-mailbox-successor',
    }),
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
