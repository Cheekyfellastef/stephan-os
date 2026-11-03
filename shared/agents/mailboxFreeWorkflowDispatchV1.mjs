// Goal #2315: mailbox-independent, zero-mutation GitHub Actions ingress pilot.
// This observer is not a second mailbox, scheduler, builder or execution authority.
export const MAILBOX_FREE_DISPATCH_SCHEMA = 'stephanos.mailbox-free-dispatch-readonly.v1';
export const MAILBOX_FREE_DISPATCH_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const MAILBOX_FREE_DISPATCH_OWNER = 'Cheekyfellastef';
export const MAILBOX_FREE_DISPATCH_REPOSITORY_ID = 1179385578;
export const MAILBOX_FREE_DISPATCH_OWNER_ID = 267490109;
const SHA40 = /^[0-9a-f]{40}$/;
const POSITIVE_INTEGER = /^[1-9][0-9]{0,15}$/;
const GOAL_NUMBER = /^[1-9][0-9]{0,6}$/;

function denied(blocker) {
  return Object.freeze({
    schemaVersion: MAILBOX_FREE_DISPATCH_SCHEMA,
    ok: false, blocker,
    readOnly: true, executionAuthorized: false, sourceMutationAllowed: false,
    protectedMergeAllowed: false, nativePickupProven: false,
  });
}
function exactFields(value, names) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === names.length
    && names.every((name) => Object.hasOwn(value, name));
}
function positiveNumber(value) {
  const raw = String(value ?? '');
  if (!POSITIVE_INTEGER.test(raw)) return 0;
  const number = Number(raw);
  return Number.isSafeInteger(number) ? number : 0;
}
export function validateMailboxFreeWorkflowDispatchV1(event, env = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)
    || env.GITHUB_ACTIONS !== 'true'
    || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_JOB !== 'inspect-goal') return denied('WORKFLOW_EXECUTION_CONTEXT_INVALID');
  if (env.GITHUB_REPOSITORY !== MAILBOX_FREE_DISPATCH_REPOSITORY
    || env.GITHUB_REPOSITORY_OWNER !== MAILBOX_FREE_DISPATCH_OWNER
    || env.GITHUB_REF !== 'refs/heads/main'
    || (event.ref !== 'refs/heads/main' && event.ref !== 'main')
    || event.repository?.full_name !== MAILBOX_FREE_DISPATCH_REPOSITORY
    || event.repository?.id !== MAILBOX_FREE_DISPATCH_REPOSITORY_ID
    || event.repository?.owner?.login !== MAILBOX_FREE_DISPATCH_OWNER) {
    return denied('CANONICAL_REPOSITORY_OR_MAIN_REF_INVALID');
  }
  if (env.GITHUB_ACTOR !== MAILBOX_FREE_DISPATCH_OWNER
    || positiveNumber(env.GITHUB_ACTOR_ID) !== MAILBOX_FREE_DISPATCH_OWNER_ID
    || event.sender?.login !== MAILBOX_FREE_DISPATCH_OWNER
    || event.sender?.id !== MAILBOX_FREE_DISPATCH_OWNER_ID
    || event.sender?.type !== 'User') return denied('AUTHENTICATED_OPERATOR_INVALID');
  if (!exactFields(event.inputs, ['goal_issue'])) return denied('EXACT_TYPED_INPUT_SCHEMA_INVALID');
  const goalText = event.inputs.goal_issue;
  if (typeof goalText !== 'string' || !GOAL_NUMBER.test(goalText)) {
    return denied('GOAL_ISSUE_INVALID');
  }
  const head = String(env.GITHUB_SHA ?? '').toLowerCase();
  const runId = positiveNumber(env.GITHUB_RUN_ID);
  const runAttempt = positiveNumber(env.GITHUB_RUN_ATTEMPT);
  if (!SHA40.test(head) || !runId || runAttempt !== 1) return denied('FRESH_ACTIONS_RUN_IDENTITY_INVALID');
  return Object.freeze({
    schemaVersion: MAILBOX_FREE_DISPATCH_SCHEMA,
    ok: true, blocker: '', readOnly: true, mode: 'READ_GOAL_STATUS',
    goalNumber: Number(goalText), requestId: 'actions-run-' + runId + '-1',
    runId, runAttempt, checkedOutHead: head,
    readOnlyGitHubRunUrl: 'https://github.com/' + MAILBOX_FREE_DISPATCH_REPOSITORY + '/actions/runs/' + runId,
    executionAuthorized: false, sourceMutationAllowed: false,
    protectedMergeAllowed: false, nativePickupProven: false,
  });
}
export function projectMailboxFreeGoalObservationV1(admission, issue, observedMainHead, observedAtUtc) {
  if (!admission?.ok || !SHA40.test(String(observedMainHead ?? '').toLowerCase())
    || observedMainHead.toLowerCase() !== admission.checkedOutHead) {
    return denied('EXACT_CURRENT_MAIN_READBACK_FAILED');
  }
  if (!issue || issue.number !== admission.goalNumber || issue.pull_request
    || !['open', 'closed'].includes(issue.state)) return denied('ORIGINAL_GOAL_READBACK_INVALID');
  return Object.freeze({
    schemaVersion: MAILBOX_FREE_DISPATCH_SCHEMA,
    verdict: 'READ_ONLY_OBSERVED', mode: 'READ_GOAL_STATUS',
    requestId: admission.requestId, runId: admission.runId, runAttempt: admission.runAttempt,
    goalNumber: admission.goalNumber, goalState: issue.state.toUpperCase(),
    goalCommentCount: Number.isSafeInteger(issue.comments) && issue.comments >= 0 ? issue.comments : null,
    sourceHead: admission.checkedOutHead, observedAtUtc,
    goalUrl: 'https://github.com/' + MAILBOX_FREE_DISPATCH_REPOSITORY + '/issues/' + admission.goalNumber,
    runUrl: admission.readOnlyGitHubRunUrl,
    independentVerificationPerformed: false, executionAuthorized: false,
    nativePickupProven: false, sourceMutationAllowed: false, protectedMergeAllowed: false,
    nextGate: 'EXISTING_GOAL_OWNER_ADMISSION_AND_INDEPENDENT_REVIEW',
  });
}
