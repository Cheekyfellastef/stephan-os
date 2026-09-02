const SHA_PATTERN = /^[a-f0-9]{40}$/;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const OPERATOR_ENVIRONMENT_APPROVAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const OPERATOR_ENVIRONMENT_APPROVAL_OPERATOR = 'Cheekyfellastef';
export const OPERATOR_ENVIRONMENT_APPROVAL_ENVIRONMENT = 'operator-merge-approval';
export const OPERATOR_ENVIRONMENT_APPROVAL_STATE = 'approved';
export const OPERATOR_ENVIRONMENT_APPROVAL_AUTHORITY = 'exact-user-authenticated-pending-deployment-approval-only';

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const raw = text(value);
  if (!/^[1-9][0-9]*$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function unique(values) {
  return [...new Set(values)];
}

function exactReviewerLogins(reviewers = []) {
  if (!Array.isArray(reviewers)) return [];
  return reviewers
    .filter((entry) => text(entry?.type) === 'User')
    .map((entry) => text(entry?.reviewer?.login))
    .filter(Boolean);
}

export function validateOperatorEnvironmentApprovalV1(input = {}) {
  const blockers = [];
  const authorization = input?.authorization && typeof input.authorization === 'object'
    ? input.authorization
    : {};
  const observed = input?.observed && typeof input.observed === 'object'
    ? input.observed
    : {};
  const pullRequest = observed?.pullRequest && typeof observed.pullRequest === 'object'
    ? observed.pullRequest
    : {};
  const workflowRun = observed?.workflowRun && typeof observed.workflowRun === 'object'
    ? observed.workflowRun
    : {};
  const pendingDeployments = Array.isArray(observed?.pendingDeployments)
    ? observed.pendingDeployments
    : [];

  const repository = text(authorization.repository);
  const prNumber = positiveInteger(authorization.prNumber);
  const branch = text(authorization.branch);
  const headSha = text(authorization.headSha).toLowerCase();
  const baseSha = text(authorization.baseSha).toLowerCase();
  const workflowRunId = positiveInteger(authorization.workflowRunId);
  const environmentName = text(authorization.environmentName);
  const operator = text(authorization.operator);
  const decision = text(authorization.decision).toLowerCase();
  const authenticatedActor = text(observed.authenticatedActor);
  const currentMainSha = text(observed.currentMainSha).toLowerCase();

  if (repository !== OPERATOR_ENVIRONMENT_APPROVAL_REPOSITORY
    || !REPOSITORY_PATTERN.test(repository)) blockers.push('repository-not-canonical');
  if (!prNumber) blockers.push('pr-number-invalid');
  if (!BRANCH_PATTERN.test(branch) || branch.includes('..')) blockers.push('branch-invalid');
  if (!SHA_PATTERN.test(headSha)) blockers.push('head-sha-invalid');
  if (!SHA_PATTERN.test(baseSha)) blockers.push('base-sha-invalid');
  if (!workflowRunId) blockers.push('workflow-run-id-invalid');
  if (environmentName !== OPERATOR_ENVIRONMENT_APPROVAL_ENVIRONMENT) blockers.push('environment-not-canonical');
  if (operator !== OPERATOR_ENVIRONMENT_APPROVAL_OPERATOR) blockers.push('operator-not-canonical');
  if (decision !== OPERATOR_ENVIRONMENT_APPROVAL_STATE) blockers.push('decision-not-approved');

  if (authenticatedActor !== operator) blockers.push('authenticated-actor-not-operator');
  if (currentMainSha !== baseSha) blockers.push('protected-main-drifted');
  if (positiveInteger(pullRequest.number) !== prNumber) blockers.push('pr-number-mismatch');
  if (text(pullRequest.state).toLowerCase() !== 'open') blockers.push('pr-not-open');
  if (pullRequest.merged === true) blockers.push('pr-already-merged');
  if (text(pullRequest.branch) !== branch) blockers.push('pr-branch-mismatch');
  if (text(pullRequest.headSha).toLowerCase() !== headSha) blockers.push('pr-head-mismatch');
  if (text(pullRequest.baseRef) !== 'main') blockers.push('pr-base-ref-mismatch');
  if (text(pullRequest.baseSha).toLowerCase() !== baseSha) blockers.push('pr-base-sha-mismatch');

  if (positiveInteger(workflowRun.id) !== workflowRunId) blockers.push('workflow-run-id-mismatch');
  if (text(workflowRun.status).toLowerCase() !== 'waiting') blockers.push('workflow-run-not-waiting');
  if (workflowRun.conclusion !== null && workflowRun.conclusion !== undefined && text(workflowRun.conclusion)) {
    blockers.push('workflow-run-already-concluded');
  }
  if (text(workflowRun.event) !== 'workflow_dispatch') blockers.push('workflow-run-event-mismatch');
  if (text(workflowRun.headSha).toLowerCase() !== baseSha) blockers.push('workflow-run-base-mismatch');
  if (text(workflowRun.displayTitle) !== `Protected operator merge ${headSha}`) {
    blockers.push('workflow-run-title-mismatch');
  }

  if (pendingDeployments.length !== 1) blockers.push('pending-deployment-estate-not-exact');
  const pending = pendingDeployments.length === 1 ? pendingDeployments[0] : {};
  const environmentId = positiveInteger(pending?.environment?.id);
  if (!environmentId) blockers.push('environment-id-invalid');
  if (text(pending?.environment?.name) !== environmentName) blockers.push('pending-environment-mismatch');
  if (pending?.current_user_can_approve !== true) blockers.push('operator-cannot-approve');
  if (Number(pending?.wait_timer ?? 0) !== 0) blockers.push('environment-wait-timer-active');
  const reviewerLogins = exactReviewerLogins(pending?.reviewers);
  if (reviewerLogins.length !== 1 || reviewerLogins[0] !== operator) {
    blockers.push('environment-reviewer-not-exact-operator');
  }

  const finalBlockers = unique(blockers);
  if (finalBlockers.length) {
    return Object.freeze({
      valid: false,
      blockers: Object.freeze(finalBlockers),
      request: null,
      mutationAuthority: false,
      finalVerdict: 'OPERATOR_ENVIRONMENT_APPROVAL_BLOCKED',
    });
  }

  const request = Object.freeze({
    method: 'POST',
    path: `/repos/${OPERATOR_ENVIRONMENT_APPROVAL_REPOSITORY}/actions/runs/${workflowRunId}/pending_deployments`,
    headers: Object.freeze({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: Object.freeze({
      environment_ids: Object.freeze([environmentId]),
      state: OPERATOR_ENVIRONMENT_APPROVAL_STATE,
      comment: `Stephanos exact operator authorization: PR #${prNumber} head ${headSha}`,
    }),
  });

  return Object.freeze({
    valid: true,
    blockers: Object.freeze([]),
    request,
    mutationAuthority: true,
    authority: OPERATOR_ENVIRONMENT_APPROVAL_AUTHORITY,
    receiptBinding: Object.freeze({
      repository,
      prNumber,
      branch,
      headSha,
      baseSha,
      workflowRunId,
      environmentId,
      environmentName,
      operator,
      authenticatedActor,
    }),
    finalVerdict: 'OPERATOR_ENVIRONMENT_APPROVAL_READY',
  });
}

export async function executeOperatorEnvironmentApprovalV1(input = {}) {
  const validation = validateOperatorEnvironmentApprovalV1(input);
  if (!validation.valid) return validation;
  if (typeof input.request !== 'function') {
    return Object.freeze({
      ...validation,
      valid: false,
      blockers: Object.freeze(['authenticated-request-function-required']),
      request: null,
      mutationAuthority: false,
      finalVerdict: 'OPERATOR_ENVIRONMENT_APPROVAL_BLOCKED',
    });
  }

  const response = await input.request(validation.request);
  const status = Number(response?.status);
  if (status !== 204) {
    return Object.freeze({
      ...validation,
      valid: false,
      blockers: Object.freeze(['github-environment-approval-not-accepted']),
      mutationAuthority: false,
      responseStatus: Number.isFinite(status) ? status : 0,
      finalVerdict: 'OPERATOR_ENVIRONMENT_APPROVAL_FAILED',
    });
  }

  return Object.freeze({
    ...validation,
    responseStatus: status,
    mutationAuthority: false,
    finalVerdict: 'OPERATOR_ENVIRONMENT_APPROVAL_ACCEPTED',
  });
}
