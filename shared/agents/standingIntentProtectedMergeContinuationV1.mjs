import {
  BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
  BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
  BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
} from './battleBridgeGitHubCommandMailboxBaseV1.mjs';
import {
  PROTECTED_OPENCLAW_MERGE_OPERATION,
  PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE,
  validateProtectedOpenClawMergeCommand,
} from './protectedOpenClawMergeMailboxAdapter.mjs';

export const STANDING_INTENT_PROTECTED_MERGE_CONTINUATION_SCHEMA =
  'stephanos.standing-intent-protected-merge-continuation.v1';

const SHA40 = /^[a-f0-9]{40}$/;

function text(value) {
  return String(value ?? '').trim();
}

function integer(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

export function missionGoalIssueNumberV1(mission = {}) {
  const match = text(mission?.missionId).toLowerCase().match(/^(?:critical|goal)-([1-9][0-9]*)(?:$|[-_.])/);
  const value = Number(match?.[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function allMissionChecksGreen(mission = {}) {
  const checks = Array.isArray(mission?.pullRequest?.checks) ? mission.pullRequest.checks : [];
  const required = checks.filter((check) => check?.required !== false);
  return required.length > 0 && required.every((check) => (
    ['success', 'neutral', 'skipped'].includes(text(check?.status).toLowerCase())
  ));
}

export function buildStandingIntentProtectedMergeContinuationV1(input = {}, options = {}) {
  const mission = input.mission || {};
  const intentEvidence = input.intentEvidence || {};
  const reviewEvidence = input.reviewEvidence || {};
  const blockers = [];
  const issueNumber = missionGoalIssueNumberV1(mission);
  const prNumber = integer(mission?.pullRequest?.number);
  const expectedHead = text(mission?.pullRequest?.headSha).toLowerCase();
  const expectedBase = text(reviewEvidence?.expectedBase).toLowerCase();
  const authority = intentEvidence?.authority || {};
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());

  if (text(mission?.repository) !== BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY) blockers.push('standing-intent-mission-repository-mismatch');
  if (text(mission?.currentPhase) !== 'AWAITING_OPERATOR_APPROVAL') blockers.push('standing-intent-mission-not-awaiting-approval');
  if (!issueNumber) blockers.push('standing-intent-mission-goal-unresolved');
  if (!prNumber) blockers.push('standing-intent-pr-invalid');
  if (!SHA40.test(expectedHead)) blockers.push('standing-intent-head-invalid');
  if (mission?.pullRequest?.mergeable !== true) blockers.push('standing-intent-pr-not-mergeable');
  if (!allMissionChecksGreen(mission)) blockers.push('standing-intent-mission-checks-not-green');
  if (intentEvidence?.valid !== true
    || authority?.protectedContinuationAuthenticated !== true
    || authority?.protectedMergeEnvironmentApprovalEligible !== true
    || authority?.protectedExactHeadMergeEligible !== true) {
    blockers.push('standing-intent-authenticated-protected-authority-missing');
  }
  if (text(authority?.goalId) !== `goal-${issueNumber}`) blockers.push('standing-intent-goal-mismatch');
  if (reviewEvidence?.ok !== true) blockers.push('standing-intent-clean-independent-review-missing');
  if (integer(reviewEvidence?.prNumber) !== prNumber) blockers.push('standing-intent-review-pr-mismatch');
  if (text(reviewEvidence?.expectedHead).toLowerCase() !== expectedHead) blockers.push('standing-intent-review-head-mismatch');
  if (!SHA40.test(expectedBase)) blockers.push('standing-intent-review-base-invalid');
  if (text(reviewEvidence?.reviewMode) !== PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE) blockers.push('standing-intent-review-mode-invalid');

  if (blockers.length) {
    return Object.freeze({
      schemaVersion: STANDING_INTENT_PROTECTED_MERGE_CONTINUATION_SCHEMA,
      ok: false,
      blocker: blockers[0],
      blockers: Object.freeze(blockers),
      issueNumber,
      prNumber,
      expectedHead,
      expectedBase,
      mergeAuthority: false,
      directMergePerformed: false,
      finalVerdict: 'STANDING_INTENT_PROTECTED_MERGE_CONTINUATION_BLOCKED',
    });
  }

  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  const requestId = `standing-merge-${prNumber}-${expectedHead.slice(0, 16)}`;
  const command = Object.freeze({
    schemaVersion: BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
    requestId,
    operation: PROTECTED_OPENCLAW_MERGE_OPERATION,
    repository: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
    issueNumber: BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead,
    expectedBase,
    prNumber,
    reviewRunId: integer(reviewEvidence.reviewRunId),
    reviewRunAttempt: integer(reviewEvidence.reviewRunAttempt),
    reviewJobId: integer(reviewEvidence.reviewJobId),
    reviewArtifactId: integer(reviewEvidence.reviewArtifactId),
    reviewArtifactDigest: text(reviewEvidence.reviewArtifactDigest).toLowerCase(),
    reviewPayloadSha256: text(reviewEvidence.reviewPayloadSha256).toLowerCase(),
    reviewMode: PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE,
    reviewFindingCode: '',
    mergeMethod: 'squash',
    mergeApprovalToken: `APPROVE_PROTECTED_WORKFLOW_SQUASH_MERGE:${prNumber}:${expectedHead}`,
    expiresAt,
  });
  const validation = validateProtectedOpenClawMergeCommand(command, { now });
  if (!validation.ok) {
    return Object.freeze({
      schemaVersion: STANDING_INTENT_PROTECTED_MERGE_CONTINUATION_SCHEMA,
      ok: false,
      blocker: validation.blocker,
      blockers: Object.freeze([validation.blocker]),
      issueNumber,
      prNumber,
      expectedHead,
      expectedBase,
      mergeAuthority: false,
      directMergePerformed: false,
      finalVerdict: 'STANDING_INTENT_PROTECTED_MERGE_CONTINUATION_BLOCKED',
    });
  }

  return Object.freeze({
    schemaVersion: STANDING_INTENT_PROTECTED_MERGE_CONTINUATION_SCHEMA,
    ok: true,
    blocker: '',
    blockers: Object.freeze([]),
    issueNumber,
    prNumber,
    expectedHead,
    expectedBase,
    requestId,
    intentEvidenceRef: text(intentEvidence?.authenticatedProvenance?.evidenceRef),
    approvalEvent: Object.freeze({
      eventType: 'OPERATOR_APPROVAL_RECORDED',
      approvalToken: text(mission?.approval?.requiredToken),
      approvalRoute: 'protected-workflow',
      directOperatorIntentAuthority: intentEvidence.receipt,
      authenticatedOperatorIntentProvenance: intentEvidence.authenticatedProvenance,
    }),
    command,
    mergeAuthority: false,
    directMergePerformed: false,
    protectedWorkflowRequired: true,
    finalVerdict: 'STANDING_INTENT_PROTECTED_MERGE_CONTINUATION_READY',
  });
}
