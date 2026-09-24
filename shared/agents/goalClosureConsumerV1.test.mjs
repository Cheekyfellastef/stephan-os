import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_GOAL_REPOSITORY,
  executeCanonicalGoalClosure,
  planCanonicalGoalClosure,
} from './goalClosureConsumerV1.mjs';

const NOW = '2026-09-24T15:30:00.000Z';
const FRESH = '2026-09-24T15:29:00.000Z';

function goal(overrides = {}) {
  return {
    issue: 4242,
    title: 'Goal: Completed test goal',
    state: 'COMPLETE',
    prerequisites: [],
    priority: 1,
    criticalPathWeight: 1,
    reversibility: 'HIGH',
    route: 'CHATGPT_GITHUB',
    evidenceAt: FRESH,
    resultProofRefs: ['proof:result'],
    reusableCapabilityId: 'CAPABILITY_GOAL_CLOSE_V1',
    sharedLessonId: 'LESSON_GOAL_CLOSE_V1',
    ...overrides,
  };
}

function schedulerInput(overrides = {}) {
  return {
    now: NOW,
    goals: [goal()],
    ...overrides,
  };
}

function openGoalIssue(overrides = {}) {
  return {
    number: 4242,
    state: 'open',
    labels: [{ name: 'goal' }, { name: 'stephanos' }],
    ...overrides,
  };
}

test('canonical CLOSE_READY goal produces one issue-state-only close request', () => {
  const result = planCanonicalGoalClosure({
    repository: CANONICAL_GOAL_REPOSITORY,
    schedulerInput: schedulerInput(),
  });
  assert.equal(result.state, 'READY');
  assert.equal(result.request.operation, 'CLOSE_GITHUB_GOAL');
  assert.equal(result.request.issueNumber, 4242);
  assert.equal(result.request.requestedState, 'closed');
  assert.equal(result.request.requestedStateReason, 'completed');
  assert.equal(result.request.mutationScope, 'ISSUE_STATE_ONLY');
  assert.equal(result.request.issueStateMutationAllowed, true);
  assert.equal(result.request.mergeAuthority, false);
  assert.equal(result.request.deploymentAuthority, false);
  assert.equal(result.request.runtimeMutationAuthority, false);
  assert.equal(result.request.arbitraryCommandAuthority, false);
  assert.deepEqual(result.request.resultProofRefs, ['proof:result']);
});

test('CLOSE_READY goal can retire while an unrelated build lane remains active', () => {
  const result = planCanonicalGoalClosure({
    repository: CANONICAL_GOAL_REPOSITORY,
    schedulerInput: schedulerInput({
      goals: [
        goal(),
        goal({
          issue: 4243,
          title: 'Goal: unrelated active build',
          state: 'ACTIVE',
          branch: 'agent/unrelated-active-build',
          resourceIds: ['repo:Cheekyfellastef/stephan-os:path:unrelated'],
          resultProofRefs: [],
          reusableCapabilityId: '',
          sharedLessonId: '',
        }),
      ],
    }),
  });
  assert.equal(result.state, 'READY');
  assert.equal(result.request.issueNumber, 4242);
  assert.equal(result.request.schedulerDecisionStatus, 'ACTIVE_LANE');
  assert.deepEqual(result.request.concurrentActiveIssues, [4243]);
});

test('a specific CLOSE_READY issue can be selected without depending on top-level scheduler selection', () => {
  const result = planCanonicalGoalClosure({
    repository: CANONICAL_GOAL_REPOSITORY,
    issueNumber: 4244,
    schedulerInput: schedulerInput({
      goals: [
        goal(),
        goal({ issue: 4244, title: 'Goal: second completed goal' }),
      ],
    }),
  });
  assert.equal(result.state, 'READY');
  assert.equal(result.request.issueNumber, 4244);
});

test('missing flywheel outputs never reaches CLOSE_READY closure', () => {
  for (const patch of [
    { resultProofRefs: [] },
    { reusableCapabilityId: '' },
    { sharedLessonId: '' },
  ]) {
    const result = planCanonicalGoalClosure({
      repository: CANONICAL_GOAL_REPOSITORY,
      schedulerInput: schedulerInput({ goals: [goal(patch)] }),
    });
    assert.equal(result.state, 'BLOCKED');
    assert.equal(result.issueStateMutationAllowed, false);
  }
});

test('approval-gated complete goal cannot be retired', () => {
  const result = planCanonicalGoalClosure({
    repository: CANONICAL_GOAL_REPOSITORY,
    schedulerInput: schedulerInput({ goals: [goal({ approvalRequired: true })] }),
  });
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.issueStateMutationAllowed, false);
});

test('fail-closed scheduler evidence cannot produce closure authority', () => {
  const result = planCanonicalGoalClosure({
    repository: CANONICAL_GOAL_REPOSITORY,
    schedulerInput: { now: NOW, goals: [goal(), { issue: null }] },
  });
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.reason, 'SCHEDULER_FAIL_CLOSED');
});

test('non-canonical repository is rejected before closure planning', () => {
  const result = planCanonicalGoalClosure({
    repository: 'other/repo',
    schedulerInput: schedulerInput(),
  });
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.reason, 'CANONICAL_REPOSITORY_REQUIRED');
});

test('live issue identity and goal label are re-read immediately before close', async () => {
  let closeCalls = 0;
  const missingLabel = await executeCanonicalGoalClosure({
    repository: CANONICAL_GOAL_REPOSITORY,
    schedulerInput: schedulerInput(),
  }, {
    readIssue: async () => openGoalIssue({ labels: [{ name: 'stephanos' }] }),
    closeIssue: async () => { closeCalls += 1; return { number: 4242, state: 'closed' }; },
  });
  assert.equal(missingLabel.state, 'BLOCKED');
  assert.equal(missingLabel.reason, 'GOAL_LABEL_REQUIRED');
  assert.equal(closeCalls, 0);

  const prShape = await executeCanonicalGoalClosure({
    repository: CANONICAL_GOAL_REPOSITORY,
    schedulerInput: schedulerInput(),
  }, {
    readIssue: async () => openGoalIssue({ pull_request: { url: 'https://example.test/pr/4242' } }),
    closeIssue: async () => { closeCalls += 1; return { number: 4242, state: 'closed' }; },
  });
  assert.equal(prShape.state, 'BLOCKED');
  assert.equal(prShape.reason, 'PULL_REQUEST_CANNOT_BE_GOAL_CLOSURE_TARGET');
  assert.equal(closeCalls, 0);
});

test('already-closed goal is idempotent and does not mutate again', async () => {
  let closeCalls = 0;
  const result = await executeCanonicalGoalClosure({
    repository: CANONICAL_GOAL_REPOSITORY,
    schedulerInput: schedulerInput(),
  }, {
    readIssue: async () => openGoalIssue({ state: 'closed', state_reason: 'completed' }),
    closeIssue: async () => { closeCalls += 1; return { number: 4242, state: 'closed' }; },
  });
  assert.equal(result.state, 'ALREADY_CLOSED');
  assert.equal(closeCalls, 0);
});

test('already-closed non-completed issue does not masquerade as completed goal retirement', async () => {
  let closeCalls = 0;
  const result = await executeCanonicalGoalClosure({
    repository: CANONICAL_GOAL_REPOSITORY,
    schedulerInput: schedulerInput(),
  }, {
    readIssue: async () => openGoalIssue({ state: 'closed', state_reason: 'not_planned' }),
    closeIssue: async () => { closeCalls += 1; return { number: 4242, state: 'closed', state_reason: 'completed' }; },
  });
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.reason, 'ALREADY_CLOSED_GOAL_NOT_COMPLETED');
  assert.equal(closeCalls, 0);
});

test('confirmed canonical open goal closes once and emits bounded receipt', async () => {
  let closeCalls = 0;
  let closeRequest = null;
  const result = await executeCanonicalGoalClosure({
    repository: CANONICAL_GOAL_REPOSITORY,
    schedulerInput: schedulerInput(),
  }, {
    readIssue: async () => openGoalIssue(),
    closeIssue: async (request) => {
      closeCalls += 1;
      closeRequest = request;
      return { number: 4242, state: 'closed', state_reason: 'completed' };
    },
  });
  assert.equal(closeCalls, 1);
  assert.deepEqual(closeRequest, {
    repository: CANONICAL_GOAL_REPOSITORY,
    issueNumber: 4242,
    state: 'closed',
    stateReason: 'completed',
  });
  assert.equal(result.state, 'CLOSED_COMPLETED');
  assert.equal(result.issueNumber, 4242);
  assert.equal(result.mutationScope, 'ISSUE_STATE_ONLY');
  assert.equal(result.issueStateMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
});

test('unconfirmed, wrong-issue, or wrong-reason close result fails closed', async () => {
  const result = await executeCanonicalGoalClosure({
    repository: CANONICAL_GOAL_REPOSITORY,
    schedulerInput: schedulerInput(),
  }, {
    readIssue: async () => openGoalIssue(),
    closeIssue: async () => ({ number: 9999, state: 'closed' }),
  });
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.reason, 'GOAL_ISSUE_CLOSE_NOT_CONFIRMED');

  const wrongReason = await executeCanonicalGoalClosure({
    repository: CANONICAL_GOAL_REPOSITORY,
    schedulerInput: schedulerInput(),
  }, {
    readIssue: async () => openGoalIssue(),
    closeIssue: async () => ({ number: 4242, state: 'closed', state_reason: 'not_planned' }),
  });
  assert.equal(wrongReason.state, 'BLOCKED');
  assert.equal(wrongReason.reason, 'GOAL_ISSUE_CLOSE_NOT_CONFIRMED');
});
