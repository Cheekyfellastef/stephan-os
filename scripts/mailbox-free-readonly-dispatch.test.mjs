import test from 'node:test';
import assert from 'node:assert/strict';
import { readMailboxFreeGoalV1 } from './mailbox-free-readonly-dispatch.mjs';
import { validateMailboxFreeWorkflowDispatchV1 } from '../shared/agents/mailboxFreeWorkflowDispatchV1.mjs';

const head = 'a'.repeat(40);
const env = {
  GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_JOB: 'inspect-goal',
  GITHUB_REPOSITORY: 'Cheekyfellastef/stephan-os', GITHUB_REPOSITORY_OWNER: 'Cheekyfellastef',
  GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR: 'Cheekyfellastef',
  GITHUB_ACTOR_ID: '267490109', GITHUB_SHA: head,
  GITHUB_RUN_ID: '40559361643', GITHUB_RUN_ATTEMPT: '1',
};
const event = {
  ref: 'refs/heads/main',
  repository: { full_name: 'Cheekyfellastef/stephan-os', id: 1179385578,
    owner: { login: 'Cheekyfellastef' } },
  sender: { login: 'Cheekyfellastef', id: 267490109, type: 'User' },
  inputs: { goal_issue: '2961' },
};
const admission = validateMailboxFreeWorkflowDispatchV1(event, env);

test('observer reads current main before and after goal without mutation', async () => {
  const calls = [];
  const read = async (path, token) => {
    calls.push([path, token]);
    if (path.includes('git/ref')) return { object: { sha: head } };
    return { number: 2961, state: 'open', comments: 252 };
  };
  const result = await readMailboxFreeGoalV1(admission, 'temporary-test-token', read);
  assert.equal(result.verdict, 'READ_ONLY_OBSERVED');
  assert.deepEqual(calls.map(x => x[0]), ['/git/ref/heads/main', '/issues/2961', '/git/ref/heads/main']);
  assert.deepEqual(calls.map(x => x[1]), Array(3).fill('temporary-test-token'));
  assert.equal(JSON.stringify(result).includes('temporary-test-token'), false);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.nativePickupProven, false);
  assert.equal(result.executionAuthorized, false);
});
test('main moving during the GET sequence fails closed', async () => {
  let n = 0;
  const read = async path => path.includes('git/ref')
    ? { object: { sha: ++n === 2 ? 'b'.repeat(40) : head } }
    : { number: 2961, state: 'open' };
  const result = await readMailboxFreeGoalV1(admission, 'fake', read);
  assert.equal(result.verdict, 'BLOCKED');
  assert.equal(result.blocker, 'EXACT_MAIN_CHANGED');
});
test('network failure, PR target and untrusted admission do not yield progress receipts', async () => {
  const offline = await readMailboxFreeGoalV1(admission, 'fake', async () => { throw new Error('secret'); });
  assert.equal(offline.verdict, 'BLOCKED');
  assert.equal(JSON.stringify(offline).includes('secret'), false);
  const read = async path => path.includes('git/ref')
    ? { object: { sha: head } }
    : { number: 2961, state: 'open', pull_request: {} };
  const pr = await readMailboxFreeGoalV1(admission, 'fake', read);
  assert.equal(pr.verdict, 'BLOCKED');
  assert.equal(pr.blocker, 'ORIGINAL_GOAL_READBACK_INVALID');
  const invalid = await readMailboxFreeGoalV1({ ok: false, blocker: 'deny' }, 'fake', read);
  assert.equal(invalid.verdict, 'BLOCKED');
  assert.equal(invalid.blocker, 'INGRESS_NOT_ADMITTED');
});
