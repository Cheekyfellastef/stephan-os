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

function selectedIssueFromGoal(value) {
  const match = /^#([1-9]\\d*)$/.exec(text(value) ?? '');
  return match ? positiveInt(match[1]) : null;
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

function rawGoalForIssue(schedulerInput, issueNumber) {
  if (!Array.isArray(schedulerInput?.goals)) return null;
  const matches = schedulerInput.goals.filter((goal) => positiveInt(goal?.issue) === issueNumber);
  return matches.length === 1 ? matches[0] : null;
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

  const issueNumber = selectedIssueFromGoal(scheduler.selectedGoal);
  if (
    scheduler.programmeStatus !== 'CLOSE_READY'
    || scheduler.selectedLifecycle !== 'CLOSE_READY'
    || scheduler.decisionReceipt?.status !== 'CLOSE_READY'
    || !issueNumber
    || positiveInt(scheduler.decisionReceipt?.selectedIssue) !== issueNumber
  ) {
    return blocked('CANONICAL_CLOSE_READY_DECISION_REQUIRED', {
      programmeStatus: text(scheduler.programmeStatus),
      selectedLifecycle: text(scheduler.selectedLifecycle),
    });
  }

  const portfolioRows = Array.isArray(scheduler.portfolio)
    ? scheduler.portfolio.filter((row) => positiveInt(row?.issue) === issueNumber)
    : [];
  if (portfolioRows.length !== 1 || portfolioRows[0]?.lifecycle !== 'CLOSE_READY') {
    return blocked('CLOSE_READY_PORTFOLIO_BINDING_REQUIRED', { issueNumber });
  }

  const goal = rawGoalForIssue(schedulerInput, issueNumber);
  if (!goal || text(goal.state)?.toUpperCase() !== 'COMPLETE') {
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

export async function executeCanonicalGoalClosure(input = {}, adapters = {}) {
  const planned = planCanonicalGoalClosure(input);
  if (planned.state !== 'READY') return planned;
  if (typeof adapters.readIssue !== 'function' || typeof adapters.closeIssue !== 'function') {
    return blocked('GOAL_CLOSURE_ADAPTERS_REQUIRED', {
      issueNumber: planned.request.issueNumber,
    });
  }

  let observed;
  try {
    observed = await adapters.readIssue({
      repository: planned.request.repository,
      issueNumber: planned.request.issueNumber,
    });
  } catch (error) {
    return blocked('GOAL_ISSUE_READ_FAILED', {
      issueNumber: planned.request.issueNumber,
      detail: text(error?.message),
    });
  }

  if (issueNumberOf(observed) !== planned.request.issueNumber) {
    return blocked('GOAL_ISSUE_IDENTITY_MISMATCH', {
      issueNumber: planned.request.issueNumber,
    });
  }
  if (observed?.pull_request || observed?.isPullRequest === true) {
    return blocked('PULL_REQUEST_CANNOT_BE_GOAL_CLOSURE_TARGET', {
      issueNumber: planned.request.issueNumber,
    });
  }
  if (!labelsOf(observed).includes('goal')) {
    return blocked('GOAL_LABEL_REQUIRED', {
      issueNumber: planned.request.issueNumber,
    });
  }

  const observedState = text(observed?.state)?.toLowerCase();
  if (observedState === 'closed') {
    return freeze({
      schemaVersion: GOAL_CLOSURE_RECEIPT_SCHEMA,
      state: 'ALREADY_CLOSED',
      repository: planned.request.repository,
      issueNumber: planned.request.issueNumber,
      resultProofRefs: planned.request.resultProofRefs,
      reusableCapabilityId: planned.request.reusableCapabilityId,
      sharedLessonId: planned.request.sharedLessonId,
      issueStateMutationAllowed: false,
      mergeAuthority: false,
      deploymentAuthority: false,
      runtimeMutationAuthority: false,
      arbitraryCommandAuthority: false,
    });
  }
  if (observedState !== 'open') {
    return blocked('GOAL_ISSUE_MUST_BE_OPEN', {
      issueNumber: planned.request.issueNumber,
      observedState,
    });
  }

  let closed;
  try {
    closed = await adapters.closeIssue({
      repository: planned.request.repository,
      issueNumber: planned.request.issueNumber,
      state: 'closed',
      stateReason: 'completed',
    });
  } catch (error) {
    return blocked('GOAL_ISSUE_CLOSE_FAILED', {
      issueNumber: planned.request.issueNumber,
      detail: text(error?.message),
    });
  }

  if (
    issueNumberOf(closed) !== planned.request.issueNumber
    || text(closed?.state)?.toLowerCase() !== 'closed'
  ) {
    return blocked('GOAL_ISSUE_CLOSE_NOT_CONFIRMED', {
      issueNumber: planned.request.issueNumber,
    });
  }

  return freeze({
    schemaVersion: GOAL_CLOSURE_RECEIPT_SCHEMA,
    state: 'CLOSED_COMPLETED',
    repository: planned.request.repository,
    issueNumber: planned.request.issueNumber,
    stateReason: text(closed?.stateReason ?? closed?.state_reason) ?? 'completed',
    resultProofRefs: planned.request.resultProofRefs,
    reusableCapabilityId: planned.request.reusableCapabilityId,
    sharedLessonId: planned.request.sharedLessonId,
    mutationScope: 'ISSUE_STATE_ONLY',
    issueStateMutationAllowed: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryCommandAuthority: false,
  });
}
