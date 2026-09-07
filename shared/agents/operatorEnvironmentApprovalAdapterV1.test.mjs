import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPERATOR_ENVIRONMENT_APPROVAL_AUTHORITY,
  executeOperatorEnvironmentApprovalV1,
  validateOperatorEnvironmentApprovalV1,
} from './operatorEnvironmentApprovalAdapterV1.mjs';

const HEAD = '043b62c3f9e6075caa9a098f2f46b03c0e16b483';
const BASE = '88946c2805a8000c0f2e2239a80ffedd8d1591fe';
const RUN_ID = 33623741250;
const ENVIRONMENT_ID = 18561352377;

function exactInput(overrides = {}) {
  const base = {
    authorization: {
      repository: 'Cheekyfellastef/stephan-os',
      prNumber: 2091,
      branch: 'agent/source-artifact-escrow-failover-v1',
      headSha: HEAD,
      baseSha: BASE,
      workflowRunId: RUN_ID,
      environmentName: 'operator-merge-approval',
      operator: 'Cheekyfellastef',
      decision: 'approved',
    },
    observed: {
      authenticatedActor: 'Cheekyfellastef',
      currentMainSha: BASE,
      pullRequest: {
        number: 2091,
        state: 'open',
        merged: false,
        branch: 'agent/source-artifact-escrow-failover-v1',
        headSha: HEAD,
        baseRef: 'main',
        baseSha: BASE,
      },
      workflowRun: {
        id: RUN_ID,
        status: 'waiting',
        conclusion: null,
        event: 'workflow_dispatch',
        headSha: BASE,
        displayTitle: `Protected operator merge ${HEAD}`,
      },
      pendingDeployments: [{
        environment: { id: ENVIRONMENT_ID, name: 'operator-merge-approval' },
        wait_timer: 0,
        current_user_can_approve: true,
        reviewers: [{ type: 'User', reviewer: { login: 'Cheekyfellastef' } }],
      }],
    },
  };
  return {
    ...base,
    ...overrides,
    authorization: { ...base.authorization, ...(overrides.authorization || {}) },
    observed: { ...base.observed, ...(overrides.observed || {}) },
  };
}

test('builds exactly one canonical pending-deployment approval request', () => {
  const result = validateOperatorEnvironmentApprovalV1(exactInput());
  assert.equal(result.valid, true);
  assert.equal(result.mutationAuthority, true);
  assert.equal(result.authority, OPERATOR_ENVIRONMENT_APPROVAL_AUTHORITY);
  assert.equal(result.request.method, 'POST');
  assert.equal(
    result.request.path,
    `/repos/Cheekyfellastef/stephan-os/actions/runs/${RUN_ID}/pending_deployments`,
  );
  assert.deepEqual(result.request.body.environment_ids, [ENVIRONMENT_ID]);
  assert.equal(result.request.body.state, 'approved');
  assert.match(result.request.body.comment, /PR #2091/);
  assert.match(result.request.body.comment, new RegExp(HEAD));
});

test('fails closed when authenticated actor is not the exact operator', () => {
  const result = validateOperatorEnvironmentApprovalV1(exactInput({
    observed: { authenticatedActor: 'github-actions[bot]' },
  }));
  assert.equal(result.valid, false);
  assert.equal(result.mutationAuthority, false);
  assert.ok(result.blockers.includes('authenticated-actor-not-operator'));
});

test('fails closed on protected main, head, branch or base drift', () => {
  for (const input of [
    exactInput({ observed: { currentMainSha: '1'.repeat(40) } }),
    exactInput({ observed: { pullRequest: { ...exactInput().observed.pullRequest, headSha: '2'.repeat(40) } } }),
    exactInput({ observed: { pullRequest: { ...exactInput().observed.pullRequest, branch: 'other' } } }),
    exactInput({ observed: { pullRequest: { ...exactInput().observed.pullRequest, baseSha: '3'.repeat(40) } } }),
  ]) {
    const result = validateOperatorEnvironmentApprovalV1(input);
    assert.equal(result.valid, false);
    assert.equal(result.mutationAuthority, false);
  }
});

test('fails closed unless run is exact waiting workflow-dispatch execution', () => {
  const completed = validateOperatorEnvironmentApprovalV1(exactInput({
    observed: { workflowRun: { ...exactInput().observed.workflowRun, status: 'completed', conclusion: 'failure' } },
  }));
  assert.equal(completed.valid, false);
  assert.ok(completed.blockers.includes('workflow-run-not-waiting'));
  assert.ok(completed.blockers.includes('workflow-run-already-concluded'));

  const wrongTitle = validateOperatorEnvironmentApprovalV1(exactInput({
    observed: { workflowRun: { ...exactInput().observed.workflowRun, displayTitle: 'other' } },
  }));
  assert.equal(wrongTitle.valid, false);
  assert.ok(wrongTitle.blockers.includes('workflow-run-title-mismatch'));
});

test('requires exactly one pending deployment owned by exact operator', () => {
  const none = validateOperatorEnvironmentApprovalV1(exactInput({
    observed: { pendingDeployments: [] },
  }));
  assert.equal(none.valid, false);
  assert.ok(none.blockers.includes('pending-deployment-estate-not-exact'));

  const wrongReviewer = validateOperatorEnvironmentApprovalV1(exactInput({
    observed: {
      pendingDeployments: [{
        environment: { id: ENVIRONMENT_ID, name: 'operator-merge-approval' },
        wait_timer: 0,
        current_user_can_approve: true,
        reviewers: [{ type: 'User', reviewer: { login: 'someone-else' } }],
      }],
    },
  }));
  assert.equal(wrongReviewer.valid, false);
  assert.ok(wrongReviewer.blockers.includes('environment-reviewer-not-exact-operator'));
});

test('never falls back to a caller-selected endpoint, environment or decision', () => {
  const result = validateOperatorEnvironmentApprovalV1(exactInput({
    authorization: {
      environmentName: 'production',
      decision: 'rejected',
      endpoint: 'https://example.invalid/button',
    },
  }));
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('environment-not-canonical'));
  assert.ok(result.blockers.includes('decision-not-approved'));
  assert.equal(result.request, null);
});

test('executes only through supplied authenticated request surface and accepts 204 only', async () => {
  const seen = [];
  const accepted = await executeOperatorEnvironmentApprovalV1({
    ...exactInput(),
    request: async (request) => {
      seen.push(request);
      return { status: 204 };
    },
  });
  assert.equal(accepted.finalVerdict, 'OPERATOR_ENVIRONMENT_APPROVAL_ACCEPTED');
  assert.equal(accepted.responseStatus, 204);
  assert.equal(accepted.mutationAuthority, false);
  assert.equal(seen.length, 1);

  const rejected = await executeOperatorEnvironmentApprovalV1({
    ...exactInput(),
    request: async () => ({ status: 403 }),
  });
  assert.equal(rejected.valid, false);
  assert.equal(rejected.finalVerdict, 'OPERATOR_ENVIRONMENT_APPROVAL_FAILED');
  assert.ok(rejected.blockers.includes('github-environment-approval-not-accepted'));
});

test('cannot execute without an authenticated request function', async () => {
  const result = await executeOperatorEnvironmentApprovalV1(exactInput());
  assert.equal(result.valid, false);
  assert.equal(result.mutationAuthority, false);
  assert.ok(result.blockers.includes('authenticated-request-function-required'));
});
