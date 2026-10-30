import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAILBOX_FREE_DISPATCH_SCHEMA,
  validateMailboxFreeWorkflowDispatchV1,
  projectMailboxFreeGoalObservationV1,
} from './mailboxFreeWorkflowDispatchV1.mjs';

const HEAD = 'a'.repeat(40);
const makeEvent = () => ({
  ref: 'refs/heads/main',
  repository: {
    full_name: 'Cheekyfellastef/stephan-os', id: 1179385578,
    owner: { login: 'Cheekyfellastef' },
  },
  sender: { login: 'Cheekyfellastef', id: 267490109, type: 'User' },
  inputs: { goal_issue: '2961' },
});
const makeEnv = () => ({
  GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_JOB: 'inspect-goal',
  GITHUB_REPOSITORY: 'Cheekyfellastef/stephan-os', GITHUB_REPOSITORY_OWNER: 'Cheekyfellastef',
  GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR: 'Cheekyfellastef',
  GITHUB_ACTOR_ID: '267490109', GITHUB_SHA: HEAD,
  GITHUB_RUN_ID: '40559361643', GITHUB_RUN_ATTEMPT: '1',
});
function check(overrideEvent = {}, overrideEnv = {}) {
  return validateMailboxFreeWorkflowDispatchV1({ ...makeEvent(), ...overrideEvent }, { ...makeEnv(), ...overrideEnv });
}
function blocked(result, reason) {
  assert.equal(result.ok, false);
  assert.equal(result.blocker, reason);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.protectedMergeAllowed, false);
}
test('exact owner + main dispatch admits read-only discovery, never execution', () => {
  const result = check();
  assert.equal(result.schemaVersion, MAILBOX_FREE_DISPATCH_SCHEMA);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'READ_GOAL_STATUS');
  assert.equal(result.goalNumber, 2961);
  assert.equal(result.requestId, 'actions-run-40559361643-1');
  assert.equal(result.checkedOutHead, HEAD);
  assert.equal(result.readOnly, true);
  assert.deepEqual([result.executionAuthorized, result.sourceMutationAllowed,
    result.protectedMergeAllowed, result.nativePickupProven], [false, false, false, false]);
  assert.equal(Object.isFrozen(result), true);
});
test('rejects any other event, job or Actions context', () => {
  for (const override of [
    { GITHUB_ACTIONS: 'false' }, { GITHUB_EVENT_NAME: 'issue_comment' },
    { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_JOB: 'publisher' },
  ]) blocked(check({}, override), 'WORKFLOW_EXECUTION_CONTEXT_INVALID');
});
test('rejects other repository, PR ref, fork, changed repository identity and foreign owner', () => {
  for (const override of [
    { GITHUB_REPOSITORY: 'other/repo' }, { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_REPOSITORY_OWNER: 'attacker' },
  ]) blocked(check({}, override), 'CANONICAL_REPOSITORY_OR_MAIN_REF_INVALID');
  blocked(check({ ref: 'refs/heads/feature' }), 'CANONICAL_REPOSITORY_OR_MAIN_REF_INVALID');
  blocked(check({ repository: { ...makeEvent().repository, id: 13 } }), 'CANONICAL_REPOSITORY_OR_MAIN_REF_INVALID');
  blocked(check({ repository: { ...makeEvent().repository, owner: { login: 'other' } } }), 'CANONICAL_REPOSITORY_OR_MAIN_REF_INVALID');
});
test('rejects non-owner actor, ID mismatch and forged sender', () => {
  for (const override of [{ GITHUB_ACTOR: 'attacker' }, { GITHUB_ACTOR_ID: '1' }]) {
    blocked(check({}, override), 'AUTHENTICATED_OPERATOR_INVALID');
  }
  blocked(check({ sender: { ...makeEvent().sender, id: 1 } }), 'AUTHENTICATED_OPERATOR_INVALID');
  blocked(check({ sender: { ...makeEvent().sender, type: 'Bot' } }), 'AUTHENTICATED_OPERATOR_INVALID');
});
test('only exactly one numeric goal selector, never arbitrary shell, path or operation', () => {
  for (const inputs of [{ goal_issue: '2961', command: 'pwsh' }, { command: 'node' },
    { goal_issue: '2961', sourcePath: '../' }, [], null]) {
    blocked(check({ inputs }), 'EXACT_TYPED_INPUT_SCHEMA_INVALID');
  }
  for (const goal_issue of ['0', '#2961', '../1', '1;echo', '12\nnew', '0001', '99999999', 2961, '']) {
    blocked(check({ inputs: { goal_issue } }), 'GOAL_ISSUE_INVALID');
  }
});
test('missing source head, run identity or rerun attempt cannot be admitted', () => {
  for (const override of [{ GITHUB_SHA: 'x' }, { GITHUB_RUN_ID: '0' },
    { GITHUB_RUN_ID: '18446744073709551616' }, { GITHUB_RUN_ATTEMPT: '2' }]) {
    blocked(check({}, override), 'FRESH_ACTIONS_RUN_IDENTITY_INVALID');
  }
});
test('observation is not a native or independently accepted source proof', () => {
  const record = projectMailboxFreeGoalObservationV1(check(),
    { number: 2961, state: 'open', comments: 252 }, HEAD, '2026-10-27T18:45:00.000Z');
  assert.equal(record.verdict, 'READ_ONLY_OBSERVED');
  assert.equal(record.goalState, 'OPEN');
  assert.equal(record.goalCommentCount, 252);
  assert.equal(record.goalUrl, 'https://github.com/Cheekyfellastef/stephan-os/issues/2961');
  assert.equal(record.independentVerificationPerformed, false);
  assert.equal(record.nativePickupProven, false);
  assert.equal(record.executionAuthorized, false);
  assert.equal(Object.isFrozen(record), true);
});
test('head drift or a PR/other issue cannot produce a positive observation', () => {
  const admission = check();
  blocked(projectMailboxFreeGoalObservationV1(admission, { number: 2961, state: 'open' },
    'b'.repeat(40), new Date().toISOString()), 'EXACT_CURRENT_MAIN_READBACK_FAILED');
  blocked(projectMailboxFreeGoalObservationV1(admission, { number: 2961, state: 'open', pull_request: {} },
    HEAD, new Date().toISOString()), 'ORIGINAL_GOAL_READBACK_INVALID');
  blocked(projectMailboxFreeGoalObservationV1(admission, { number: 2315, state: 'open' },
    HEAD, new Date().toISOString()), 'ORIGINAL_GOAL_READBACK_INVALID');
});
test('untrusted admission cannot become a positive record', () => {
  blocked(projectMailboxFreeGoalObservationV1(check({}, { GITHUB_ACTOR: 'attacker' }),
    { number: 2961, state: 'open' }, HEAD, '2026-10-27T18:45:00.000Z'),
  'EXACT_CURRENT_MAIN_READBACK_FAILED');
});
