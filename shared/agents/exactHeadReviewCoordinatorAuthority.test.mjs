import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REVIEW_COORDINATOR_CREDENTIAL_SOURCE,
  selectReviewCoordinatorCredential,
  validateReviewCoordinatorCredential,
} from './exactHeadReviewCoordinatorAuthority.mjs';

test('trusted GitHub Actions token cannot be masked by an optional owner secret', () => {
  const credential = selectReviewCoordinatorCredential({
    GITHUB_ACTIONS: 'true',
    GITHUB_TOKEN: 'repository-token',
    STEPHANOS_REVIEW_DISPATCH_TOKEN: 'configured-but-unusable-owner-secret',
    GH_TOKEN: 'fallback-gh-token',
  });

  assert.deepEqual(credential, {
    token: 'repository-token',
    source: REVIEW_COORDINATOR_CREDENTIAL_SOURCE.GITHUB_ACTIONS,
  });
});

test('owner secret remains preferred outside the trusted GitHub Actions boundary', () => {
  const credential = selectReviewCoordinatorCredential({
    GITHUB_ACTIONS: 'false',
    GITHUB_TOKEN: 'repository-token',
    STEPHANOS_REVIEW_DISPATCH_TOKEN: 'owner-secret',
  });

  assert.deepEqual(credential, {
    token: 'owner-secret',
    source: REVIEW_COORDINATOR_CREDENTIAL_SOURCE.OWNER_SECRET,
  });
});

test('owner secret remains available when an Actions token is genuinely absent', () => {
  const credential = selectReviewCoordinatorCredential({
    GITHUB_ACTIONS: 'true',
    STEPHANOS_REVIEW_DISPATCH_TOKEN: 'owner-secret',
  });

  assert.deepEqual(credential, {
    token: 'owner-secret',
    source: REVIEW_COORDINATOR_CREDENTIAL_SOURCE.OWNER_SECRET,
  });
});

test('repository token remains the fallback when no owner secret exists', () => {
  const credential = selectReviewCoordinatorCredential({
    GITHUB_TOKEN: 'repository-token',
  });

  assert.deepEqual(credential, {
    token: 'repository-token',
    source: REVIEW_COORDINATOR_CREDENTIAL_SOURCE.GITHUB_ACTIONS,
  });
});

test('missing coordinator credentials fail closed', () => {
  const credential = selectReviewCoordinatorCredential({});

  assert.deepEqual(credential, {
    token: '',
    source: REVIEW_COORDINATOR_CREDENTIAL_SOURCE.NONE,
  });
});


function trustedWorkflowEnvironment(overrides = {}) {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_JOB: 'coordinate',
    GITHUB_WORKFLOW: 'Exact-Head Review Dispatch',
    GITHUB_REPOSITORY: 'Cheekyfellastef/stephan-os',
    GITHUB_WORKFLOW_REF: 'Cheekyfellastef/stephan-os/.github/workflows/exact-head-review-dispatch.yml@refs/heads/main',
    GITHUB_EVENT_NAME: 'schedule',
    ...overrides,
  };
}

function actionsCredential() {
  return {
    token: 'repository-token',
    source: REVIEW_COORDINATOR_CREDENTIAL_SOURCE.GITHUB_ACTIONS,
  };
}

test('read-only planning is bound to the exact plan job', () => {
  const verdict = validateReviewCoordinatorCredential({
    credential: actionsCredential(),
    laneAuthorityLogin: 'Cheekyfellastef',
    environment: trustedWorkflowEnvironment({
      GITHUB_JOB: 'plan',
      STEPHANOS_EXACT_HEAD_REVIEW_PLAN_ONLY: 'true',
    }),
  });
  assert.equal(verdict.valid, true);
  assert.equal(verdict.mode, 'github-actions-token');
});

test('plan and mutation roles cannot cross their trusted job boundary', () => {
  const planInMutationJob = validateReviewCoordinatorCredential({
    credential: actionsCredential(),
    laneAuthorityLogin: 'Cheekyfellastef',
    environment: trustedWorkflowEnvironment({
      STEPHANOS_EXACT_HEAD_REVIEW_PLAN_ONLY: 'true',
    }),
  });
  assert.equal(planInMutationJob.valid, false);
  assert.deepEqual(planInMutationJob.blockers, ['wrong-job']);

  const mutationInPlanJob = validateReviewCoordinatorCredential({
    credential: actionsCredential(),
    laneAuthorityLogin: 'Cheekyfellastef',
    environment: trustedWorkflowEnvironment({ GITHUB_JOB: 'plan' }),
  });
  assert.equal(mutationInPlanJob.valid, false);
  assert.deepEqual(mutationInPlanJob.blockers, ['wrong-job']);
});
