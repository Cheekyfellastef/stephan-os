import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approveProtectedOperatorEnvironmentOnBattleBridgeV1,
} from './operatorEnvironmentApprovalBattleBridgeV1.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const RUN_ID = 35154787395;
const ENVIRONMENT_ID = 91357;
const INPUT = Object.freeze({
  repositoryRoot: 'C:\\repo',
  prNumber: 2249,
  branch: 'fix/1622-material-progress-sweep-v1',
  headSha: HEAD,
  baseSha: BASE,
});

function workflowRun(status = 'waiting', conclusion = null) {
  return {
    id: RUN_ID,
    path: '.github/workflows/operator-merge-approval-gate.yml',
    event: 'workflow_dispatch',
    head_sha: BASE,
    status,
    conclusion,
    display_title: `Protected operator merge ${HEAD}`,
  };
}

function pendingDeployment() {
  return [{
    environment: { id: ENVIRONMENT_ID, name: 'operator-merge-approval' },
    current_user_can_approve: true,
    wait_timer: 0,
    reviewers: [{ type: 'User', reviewer: { login: 'Cheekyfellastef' } }],
  }];
}

function pull() {
  return {
    number: INPUT.prNumber,
    state: 'open',
    merged: false,
    head: { ref: INPUT.branch, sha: HEAD },
    base: { ref: 'main', sha: BASE },
  };
}

function mockRunner({ actor = 'Cheekyfellastef', runStates = ['waiting'] } = {}) {
  let runLookup = 0;
  let postCount = 0;
  const calls = [];
  const runCommand = (_executable, args) => {
    calls.push([...args]);
    const endpoint = String(args[1] || '');
    const isPost = args.includes('--method') && args[args.indexOf('--method') + 1] === 'POST';
    if (isPost) {
      assert.equal(endpoint, `repos/Cheekyfellastef/stephan-os/actions/runs/${RUN_ID}/pending_deployments`);
      assert.ok(args.includes(`environment_ids[]=${ENVIRONMENT_ID}`));
      assert.ok(args.includes('state=approved'));
      postCount += 1;
      return { status: 0, stdout: '', stderr: '' };
    }
    if (endpoint.includes('/actions/workflows/operator-merge-approval-gate.yml/runs?')) {
      const status = runStates[Math.min(runLookup, runStates.length - 1)];
      runLookup += 1;
      return { status: 0, stdout: JSON.stringify({ workflow_runs: [workflowRun(status, status === 'completed' ? 'failure' : null)] }), stderr: '' };
    }
    if (endpoint === 'user') return { status: 0, stdout: JSON.stringify({ login: actor }), stderr: '' };
    if (endpoint.endsWith(`/pulls/${INPUT.prNumber}`)) return { status: 0, stdout: JSON.stringify(pull()), stderr: '' };
    if (endpoint.endsWith('/branches/main')) return { status: 0, stdout: JSON.stringify({ commit: { sha: BASE } }), stderr: '' };
    if (endpoint.endsWith(`/actions/runs/${RUN_ID}`)) return { status: 0, stdout: JSON.stringify(workflowRun('waiting')), stderr: '' };
    if (endpoint.endsWith(`/actions/runs/${RUN_ID}/pending_deployments`)) {
      return { status: 0, stdout: JSON.stringify(pendingDeployment()), stderr: '' };
    }
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  return {
    runCommand,
    calls,
    postCount: () => postCount,
    runLookups: () => runLookup,
  };
}

test('approves only the exact waiting protected environment through authenticated Battle Bridge gh', async () => {
  const mock = mockRunner();
  const result = await approveProtectedOperatorEnvironmentOnBattleBridgeV1(INPUT, {
    runCommand: mock.runCommand,
    sleep: async () => {},
    maxPolls: 2,
    pollMs: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'PROTECTED_OPERATOR_ENVIRONMENT_APPROVED');
  assert.equal(result.workflowRunId, RUN_ID);
  assert.equal(result.environmentId, ENVIRONMENT_ID);
  assert.equal(result.authenticatedActor, 'Cheekyfellastef');
  assert.equal(result.responseStatus, 204);
  assert.equal(result.mergeAuthorityGranted, false);
  assert.equal(result.directMergePerformed, false);
  assert.equal(result.arbitraryGitHubRequestAllowed, false);
  assert.equal(mock.postCount(), 1);
});

test('fails closed when the local gh identity is not the canonical operator', async () => {
  const mock = mockRunner({ actor: 'github-actions[bot]' });
  const result = await approveProtectedOperatorEnvironmentOnBattleBridgeV1(INPUT, {
    runCommand: mock.runCommand,
    sleep: async () => {},
    maxPolls: 1,
    pollMs: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPERATOR_ENVIRONMENT_APPROVAL_BLOCKED');
  assert.ok(result.details.blockers.includes('authenticated-actor-not-operator'));
  assert.equal(mock.postCount(), 0);
});

test('bounded polling carries a just-dispatched run from queued to waiting before approval', async () => {
  const mock = mockRunner({ runStates: ['queued', 'waiting'] });
  let sleeps = 0;
  const result = await approveProtectedOperatorEnvironmentOnBattleBridgeV1(INPUT, {
    runCommand: mock.runCommand,
    sleep: async () => { sleeps += 1; },
    maxPolls: 3,
    pollMs: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'PROTECTED_OPERATOR_ENVIRONMENT_APPROVED');
  assert.equal(mock.runLookups(), 2);
  assert.equal(sleeps, 1);
  assert.equal(mock.postCount(), 1);
});

test('bounded polling can wait beyond twenty upstream evidence polls before protected environment wait', async () => {
  const mock = mockRunner({ runStates: [...Array(25).fill('in_progress'), 'waiting'] });
  let sleeps = 0;
  const result = await approveProtectedOperatorEnvironmentOnBattleBridgeV1(INPUT, {
    runCommand: mock.runCommand,
    sleep: async () => { sleeps += 1; },
    maxPolls: 30,
    pollMs: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'PROTECTED_OPERATOR_ENVIRONMENT_APPROVED');
  assert.equal(mock.runLookups(), 26);
  assert.equal(sleeps, 25);
  assert.equal(mock.postCount(), 1);
});

test('bounded polling reports retryable upstream work instead of terminal no-waiting when evidence is still active', async () => {
  const mock = mockRunner({ runStates: ['queued', 'in_progress', 'in_progress'] });
  const result = await approveProtectedOperatorEnvironmentOnBattleBridgeV1(INPUT, {
    runCommand: mock.runCommand,
    sleep: async () => {},
    maxPolls: 3,
    pollMs: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPERATOR_ENVIRONMENT_APPROVAL_UPSTREAM_STILL_RUNNING');
  assert.equal(result.details.retryable, true);
  assert.equal(result.details.maxPolls, 3);
  assert.equal(mock.postCount(), 0);
});

test('completed prior runs are not re-approved and do not manufacture mutation authority', async () => {
  const mock = mockRunner({ runStates: ['completed'] });
  const result = await approveProtectedOperatorEnvironmentOnBattleBridgeV1(INPUT, {
    runCommand: mock.runCommand,
    sleep: async () => {},
    maxPolls: 1,
    pollMs: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPERATOR_ENVIRONMENT_APPROVAL_NO_ACTIVE_RUN');
  assert.equal(mock.postCount(), 0);
});
