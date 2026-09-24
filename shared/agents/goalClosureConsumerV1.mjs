import { buildMissionScheduler } from '../runtime/missionScheduler.mjs';

export const GOAL_CLOSURE_CONSUMER_SCHEMA = 'stephanos.goal-closure-consumer.v1';
export const GOAL_CLOSURE_REQUEST_SCHEMA = 'stephanos.goal-closure-request.v1';
export const GOAL_CLOSURE_RECEIPT_SCHEMA = 'stephanos.goal-closure-receipt.v1';
export const CANONICAL_GOAL_REPOSITORY = 'Cheekyfellastef/stephan-os';

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveInt(value) {
  const number = typeof value === 'string' && /^[1-9]\\d*$/.test(value.trim())
    ? Number(value.trim())
    : value;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function labelsOf(issue) {
  if (!Array.isArray(issue?.labels)) return [];
  return issue.labels
    .map((label) => typeof label === 'string' ? label : text(label?.name))
    .filter(Boolean)
    .map((label) => label.toLowerCase());
}

function issueNumberOf(issue) {
  return positiveInt(issue?.issueNumber ?? issue?.issue_number ?? issue?.number);
}

function blocked(reason, details = {}) {
  return freeze({
    schemaVersion: GOAL_CLOSURE_CONSUMER_SCHEMA,
    state: 'BLOCKED',
    reason,
    ...details,
    issueStateMutationAllowed: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryCommandAuthority: false,
  });
}

function completeFlywheelOutputs(goal) {
  return Boolean(
    Array.isArray(goal?.resultProofRefs)
    && goal.resultProofRefs.length > 0
    && goal.resultProofRefs.every((entry) => text(entry))
    && text(goal?.reusableCapabilityId)
    && text(goal?.sharedLessonId)
  );
}

export function planCanonicalGoalClosure(input = {}) {
  const repository = text(input.repository);
  if (repository !== CANONICAL_GOAL_REPOSITORY) {
    return blocked('CANONICAL_REPOSITORY_REQUIRED');
  }

  const schedulerInput = input.schedulerInput;
  const scheduler = buildMissionScheduler(schedulerInput);
  if (scheduler.failClosed === true) {
    return blocked('SCHEDULER_FAIL_CLOSED', {
      contradictionsTotal: scheduler.contradictionsTotal ?? null,
    });
  }

  if (
    scheduler.decisionReceipt?.failClosed !== false
    || !Array.isArray(scheduler.decisionReceipt?.contradictionCodes)
    || scheduler.decisionReceipt.contradictionCodes.length !== 0
  ) {
    return blocked('CANONICAL_SCHEDULER_DECISION_RECEIPT_REQUIRED');
  }

  const closeReadyRows = Array.isArray(scheduler.portfolio)
    ? scheduler.portfolio
      .filter((row) => row?.lifecycle === 'CLOSE_READY' && positiveInt(row?.issue))
      .sort((left, right) => positiveInt(left.issue) - positiveInt(right.issue))
    : [];
  const requestedIssueNumber = positiveInt(input.issueNumber);
  const selectedRow = requestedIssueNumber
    ? closeReadyRows.find((row) => positiveInt(row.issue) === requestedIssueNumber)
    : closeReadyRows[0];
  const issueNumber = positiveInt(selectedRow?.issue);
  if (!issueNumber) {
    return blocked('CANONICAL_CLOSE_READY_PORTFOLIO_GOAL_REQUIRED', {
      programmeStatus: text(scheduler.programmeStatus),
      schedulerDecisionStatus: text(scheduler.decisionReceipt?.status),
      requestedIssueNumber,
    });
  }

  const portfolioRows = scheduler.portfolio.filter((row) => positiveInt(row?.issue) === issueNumber);
  if (portfolioRows.length !== 1 || portfolioRows[0] !== selectedRow) {
    return blocked('CLOSE_READY_PORTFOLIO_BINDING_REQUIRED', { issueNumber });
  }

  const goal = selectedRow;
  if (text(goal?.state)?.toUpperCase() !== 'COMPLETE') {
    return blocked('COMPLETE_GOAL_RECORD_REQUIRED', { issueNumber });
  }
  if (!completeFlywheelOutputs(goal)) {
    return blocked('FLYWHEEL_OUTPUTS_REQUIRED', { issueNumber });
  }
  if (goal.approvalRequired === true || text(goal.route) === 'OPERATOR_APPROVAL') {
    return blocked('OPERATOR_APPROVAL_GATE_ACTIVE', { issueNumber });
  }

  const proofRefs = [...goal.resultProofRefs.map((entry) => text(entry))];
  const request = freeze({
    schemaVersion: GOAL_CLOSURE_REQUEST_SCHEMA,
    operation: 'CLOSE_GITHUB_GOAL',
    repository,
    issueNumber,
    expectedIssueState: 'open',
    requestedState: 'closed',
    requestedStateReason: 'completed',
    schedulerDecisionStatus: scheduler.decisionReceipt.status,
    concurrentActiveIssues: Array.isArray(scheduler.decisionReceipt.activeIssues) ? [...scheduler.decisionReceipt.activeIssues] : [],
    reusableCapabilityId: text(goal.reusableCapabilityId),
    sharedLessonId: text(goal.sharedLessonId),
    resultProofRefs: proofRefs,
    mutationScope: 'ISSUE_STATE_ONLY',
    issueStateMutationAllowed: true,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryCommandAuthority: false,
  });

  return freeze({
    schemaVersion: GOAL_CLOSURE_CONSUMER_SCHEMA,
    state: 'READY',
    reason: 'CANONICAL_CLOSE_READY_GOAL_VERIFIED',
    request,
    issueStateMutationAllowed: true,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryCommandAuthority: false,
  });
}

function validPlannedRequest(request = {}) {
  return Boolean(
    request?.schemaVersion === GOAL_CLOSURE_REQUEST_SCHEMA
    && request?.operation === 'CLOSE_GITHUB_GOAL'
    && request?.repository === CANONICAL_GOAL_REPOSITORY
    && positiveInt(request?.issueNumber)
    && request?.expectedIssueState === 'open'
    && request?.requestedState === 'closed'
    && request?.requestedStateReason === 'completed'
    && request?.mutationScope === 'ISSUE_STATE_ONLY'
    && request?.issueStateMutationAllowed === true
    && request?.mergeAuthority === false
    && request?.deploymentAuthority === false
    && request?.runtimeMutationAuthority === false
    && request?.arbitraryCommandAuthority === false
    && Array.isArray(request?.resultProofRefs)
    && request.resultProofRefs.length > 0
    && request.resultProofRefs.every((entry) => text(entry))
    && text(request?.reusableCapabilityId)
    && text(request?.sharedLessonId)
  );
}

export async function executePlannedGoalClosure(request = {}, adapters = {}) {
  if (!validPlannedRequest(request)) {
    return blocked('CANONICAL_GOAL_CLOSURE_REQUEST_REQUIRED');
  }
  if (typeof adapters.readIssue !== 'function' || typeof adapters.closeIssue !== 'function') {
    return blocked('GOAL_CLOSURE_ADAPTERS_REQUIRED', {
      issueNumber: request.issueNumber,
    });
  }

  let observed;
  try {
    observed = await adapters.readIssue({
      repository: request.repository,
      issueNumber: request.issueNumber,
    });
  } catch (error) {
    return blocked('GOAL_ISSUE_READ_FAILED', {
      issueNumber: request.issueNumber,
      detail: text(error?.message),
    });
  }

  if (issueNumberOf(observed) !== request.issueNumber) {
    return blocked('GOAL_ISSUE_IDENTITY_MISMATCH', {
      issueNumber: request.issueNumber,
    });
  }
  if (observed?.pull_request || observed?.isPullRequest === true) {
    return blocked('PULL_REQUEST_CANNOT_BE_GOAL_CLOSURE_TARGET', {
      issueNumber: request.issueNumber,
    });
  }
  if (!labelsOf(observed).includes('goal')) {
    return blocked('GOAL_LABEL_REQUIRED', {
      issueNumber: request.issueNumber,
    });
  }

  const observedState = text(observed?.state)?.toLowerCase();
  if (observedState === 'closed') {
    if (text(observed?.stateReason ?? observed?.state_reason)?.toLowerCase() !== 'completed') {
      return blocked('ALREADY_CLOSED_GOAL_NOT_COMPLETED', {
        issueNumber: request.issueNumber,
      });
    }
    return freeze({
      schemaVersion: GOAL_CLOSURE_RECEIPT_SCHEMA,
      state: 'ALREADY_CLOSED',
      stateReason: 'completed',
      repository: request.repository,
      issueNumber: request.issueNumber,
      resultProofRefs: request.resultProofRefs,
      reusableCapabilityId: request.reusableCapabilityId,
      sharedLessonId: request.sharedLessonId,
      issueStateMutationAllowed: false,
      mergeAuthority: false,
      deploymentAuthority: false,
      runtimeMutationAuthority: false,
      arbitraryCommandAuthority: false,
    });
  }
  if (observedState !== 'open') {
    return blocked('GOAL_ISSUE_MUST_BE_OPEN', {
      issueNumber: request.issueNumber,
      observedState,
    });
  }

  let closed;
  try {
    closed = await adapters.closeIssue({
      repository: request.repository,
      issueNumber: request.issueNumber,
      state: 'closed',
      stateReason: 'completed',
    });
  } catch (error) {
    return blocked('GOAL_ISSUE_CLOSE_FAILED', {
      issueNumber: request.issueNumber,
      detail: text(error?.message),
    });
  }

  if (
    issueNumberOf(closed) !== request.issueNumber
    || text(closed?.state)?.toLowerCase() !== 'closed'
    || text(closed?.stateReason ?? closed?.state_reason)?.toLowerCase() !== 'completed'
  ) {
    return blocked('GOAL_ISSUE_CLOSE_NOT_CONFIRMED', {
      issueNumber: request.issueNumber,
    });
  }

  return freeze({
    schemaVersion: GOAL_CLOSURE_RECEIPT_SCHEMA,
    state: 'CLOSED_COMPLETED',
    repository: request.repository,
    issueNumber: request.issueNumber,
    stateReason: 'completed',
    resultProofRefs: request.resultProofRefs,
    reusableCapabilityId: request.reusableCapabilityId,
    sharedLessonId: request.sharedLessonId,
    mutationScope: 'ISSUE_STATE_ONLY',
    issueStateMutationAllowed: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryCommandAuthority: false,
  });
}

export async function executeCanonicalGoalClosure(input = {}, adapters = {}) {
  const planned = planCanonicalGoalClosure(input);
  if (planned.state !== 'READY') return planned;
  return executePlannedGoalClosure(planned.request, adapters);
}
