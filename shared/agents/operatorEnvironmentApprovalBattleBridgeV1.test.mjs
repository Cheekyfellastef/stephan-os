import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION,
  executeOperatorEnvironmentApprovalOnBattleBridge,
  validateOperatorEnvironmentApprovalBattleBridgeCommandShape,
} from './operatorEnvironmentApprovalBattleBridgeV1.mjs';

const MAIN = '7f88fe2aa31dd77b6d9ad743115d2c95eb4dc048';
const HEAD = '0d2bf004b0e5ff962579f599cb83e793bcb9b8e5';
const RUN_ID = 35526640020;
const ENVIRONMENT_ID = 18561352377;

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'approve-env-2306-0d2bf004',
    operation: OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2158,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: MAIN,
    prNumber: 2306,
    expectedPullRequestBranch: 'fix/mailbox-receipt-index-convergence-v1',
    expectedPullRequestHead: HEAD,
    workflowRunId: RUN_ID,
    expiresAt: '2026-09-20T23:59:00.000Z',
    ...overrides,
  };
}

function response(stdout = '', status = 0) {
  return { status, stdout, stderr: '', error: null };
}

function exactSpawnRecorder({ main = MAIN, pending = null, postStatus = 200 } = {}) {
  const calls = [];
  const pendingDeployments = pending ?? [{
    environment: { id: ENVIRONMENT_ID, name: 'operator-merge-approval' },
    wait_timer: 0,
    current_user_can_approve: true,
    reviewers: [{ type: 'User', reviewer: { login: 'Cheekyfellastef' } }],
  }];
  const spawnSyncFn = (executable, args, options = {}) => {
    calls.push({ executable, args: [...args], input: options.input });
    const endpoint = args[1];
    if (endpoint === 'user') return response('Cheekyfellastef\n');
    if (endpoint === 'repos/Cheekyfellastef/stephan-os/git/ref/heads/main') return response(`${main}\n`);
    if (endpoint === 'repos/Cheekyfellastef/stephan-os/pulls/2306') {
      return response(JSON.stringify({
        number: 2306,
        state: 'open',
        merged: false,
        head: { ref: 'fix/mailbox-receipt-index-convergence-v1', sha: HEAD },
        base: { ref: 'main', sha: MAIN },
      }));
    }
    if (endpoint === `repos/Cheekyfellastef/stephan-os/actions/runs/${RUN_ID}`) {
      return response(JSON.stringify({
        id: RUN_ID,
        status: 'waiting',
        conclusion: null,
        event: 'workflow_dispatch',
        head_sha: MAIN,
        display_title: `Protected operator merge ${HEAD}`,
      }));
    }
    if (endpoint === `repos/Cheekyfellastef/stephan-os/actions/runs/${RUN_ID}/pending_deployments`
      && !args.includes('--method')) {
      return response(JSON.stringify(pendingDeployments));
    }
    if (endpoint === `repos/Cheekyfellastef/stephan-os/actions/runs/${RUN_ID}/pending_deployments`
      && args.includes('--method')) {
      return postStatus === 200
        ? response('HTTP/2.0 200 OK\r\n\r\n')
        : response(`HTTP/2.0 ${postStatus} STATUS\r\n\r\n`);
    }
    return response('', 1);
  };
  return { calls, spawnSyncFn };
}

test('shape is closed-world and rejects caller-selected mutation surfaces', () => {
  assert.equal(validateOperatorEnvironmentApprovalBattleBridgeCommandShape(command()).ok, true);
  for (const [field, value] of [
    ['url', 'https://example.test'],
    ['endpoint', '/repos/other/repo'],
    ['environment', 'production'],
    ['decision', 'approved'],
    ['token', 'secret'],
    ['executable', 'powershell.exe'],
    ['args', ['anything']],
  ]) {
    const result = validateOperatorEnvironmentApprovalBattleBridgeCommandShape(command({ [field]: value }));
    assert.equal(result.ok, false, field);
    assert.equal(result.blocker, 'OPERATOR_ENVIRONMENT_APPROVAL_FIELD_NOT_ALLOWED', field);
  }
});

test('approves exactly one current protected environment deployment through fixed gh.exe API surface', async () => {
  const { calls, spawnSyncFn } = exactSpawnRecorder();
  const result = await executeOperatorEnvironmentApprovalOnBattleBridge(command(), { spawnSyncFn });

  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'COMMAND_EXECUTION_COMPLETE');
  assert.equal(result.responseStatus, 200);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.arbitraryGitHubMutationAllowed, false);

  const mutations = calls.filter((entry) => entry.args.includes('--method'));
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].executable, 'gh.exe');
  assert.deepEqual(mutations[0].args, [
    'api',
    `repos/Cheekyfellastef/stephan-os/actions/runs/${RUN_ID}/pending_deployments`,
    '--method',
    'POST',
    '--include',
    '--input',
    '-',
  ]);
  assert.deepEqual(JSON.parse(mutations[0].input), {
    environment_ids: [ENVIRONMENT_ID],
    state: 'approved',
    comment: `Stephanos exact operator authorization: PR #2306 head ${HEAD}`,
  });
});

test('current-main drift blocks before pending-deployment mutation', async () => {
  const { calls, spawnSyncFn } = exactSpawnRecorder({ main: 'a'.repeat(40) });
  const result = await executeOperatorEnvironmentApprovalOnBattleBridge(command(), { spawnSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'protected-main-drifted');
  assert.equal(calls.some((entry) => entry.args.includes('--method')), false);
});

test('non-operator or ambiguous pending deployment blocks before mutation', async () => {
  const { calls, spawnSyncFn } = exactSpawnRecorder({
    pending: [{
      environment: { id: ENVIRONMENT_ID, name: 'operator-merge-approval' },
      wait_timer: 0,
      current_user_can_approve: true,
      reviewers: [{ type: 'User', reviewer: { login: 'someone-else' } }],
    }],
  });
  const result = await executeOperatorEnvironmentApprovalOnBattleBridge(command(), { spawnSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'environment-reviewer-not-exact-operator');
  assert.equal(calls.some((entry) => entry.args.includes('--method')), false);
});

test('GitHub approval must return exact HTTP 200', async () => {
  const { spawnSyncFn } = exactSpawnRecorder({ postStatus: 204 });
  const result = await executeOperatorEnvironmentApprovalOnBattleBridge(command(), { spawnSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'github-environment-approval-not-accepted');
  assert.equal(result.responseStatus, 204);
});
