import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GITHUB_READ_MAX_ATTEMPTS,
  GitHubReadInfrastructureError,
  buildIndependentReviewInfrastructureBlockedArtifact,
  classifyGitHubReadFailure,
  githubReadRetryDelayMs,
  validateIndependentReviewInfrastructureBlockedArtifact,
} from './githubReadResilienceV1.mjs';

const IDENTITY = Object.freeze({
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 1830,
  branch: 'agent/github-continuity-mode-m2-execution-grants-v1',
  sourceHead: '03531a8ce6a13026d8ec1a896eaa20ffc0e250b6',
  baseSha: 'cf2d48fdf2c0aa29edc0cd01af678e9c92cfecc1',
  workflowRunId: 32036048136,
  workflowRunAttempt: 1,
});

test('only bounded read-only transient conditions are retryable', () => {
  assert.equal(GITHUB_READ_MAX_ATTEMPTS, 3);
  for (const status of [429, 502, 503, 504]) {
    const result = classifyGitHubReadFailure({ method: 'GET', status });
    assert.equal(result.retryable, true);
    assert.equal(result.code, 'GITHUB_READ_TRANSIENT_HTTP');
  }
  const network = classifyGitHubReadFailure({ method: 'GET', networkError: true });
  assert.equal(network.retryable, true);
  assert.equal(network.code, 'GITHUB_READ_NETWORK');
  for (const body of [
    '{"message":"Could not resolve to a node with the global id of PR_kwDORkv-6s7_DXmv"}',
    '{"message":"Not Found","errors":[{"message":"Could not resolve to a node with the global id of \'PR_kwDORkv-6s8AAAABACAwqA\'."}]}',
  ]) {
    const globalId = classifyGitHubReadFailure({ method: 'GET', status: 404, body });
    assert.equal(globalId.retryable, true);
    assert.equal(globalId.code, 'GITHUB_READ_PR_GLOBAL_ID_404');
  }
  assert.equal(classifyGitHubReadFailure({ method: 'POST', status: 503 }).retryable, false);
  assert.equal(classifyGitHubReadFailure({ method: 'GET', status: 404, body: 'Not Found' }).retryable, false);
  assert.equal(classifyGitHubReadFailure({ method: 'GET', status: 403 }).retryable, false);
});

test('retry delay budget is small and finite', () => {
  assert.equal(githubReadRetryDelayMs(1), 250);
  assert.equal(githubReadRetryDelayMs(2), 750);
  assert.equal(githubReadRetryDelayMs(3), 0);
  assert.equal(githubReadRetryDelayMs(99), 0);
});

test('infrastructure error carries only bounded read identity', () => {
  const error = new GitHubReadInfrastructureError({
    code: 'GITHUB_READ_PR_GLOBAL_ID_404',
    method: 'GET',
    path: '/repos/Cheekyfellastef/stephan-os/pulls/1830/reviews?per_page=100&page=1',
    status: 404,
    attempts: 3,
  });
  assert.equal(error.name, 'GitHubReadInfrastructureError');
  assert.equal(error.status, 404);
  assert.equal(error.attempts, 3);
  assert.match(error.message, /^REVIEW_INFRASTRUCTURE_BLOCKED:/);
  assert.throws(() => new GitHubReadInfrastructureError({
    code: 'GITHUB_READ_TRANSIENT_HTTP',
    method: 'POST',
    path: '/repos/x/y/issues/1/comments',
    status: 503,
    attempts: 1,
  }));
});

test('blocked artifact is exact-head, exact-base, run-bound and digest-protected', () => {
  const failure = new GitHubReadInfrastructureError({
    code: 'GITHUB_READ_PR_GLOBAL_ID_404',
    method: 'GET',
    path: '/repos/Cheekyfellastef/stephan-os/pulls/1830/reviews?per_page=100&page=1',
    status: 404,
    attempts: 3,
  });
  const artifact = buildIndependentReviewInfrastructureBlockedArtifact({
    ...IDENTITY,
    createdAtUtc: '2026-08-17T14:32:00.000Z',
    failure,
  });
  assert.equal(artifact.reviewMode, 'infrastructure-blocked');
  assert.equal(artifact.blocker.code, 'REVIEW_INFRASTRUCTURE_BLOCKED');
  assert.equal(artifact.blocker.providerCode, 'GITHUB_READ_PR_GLOBAL_ID_404');
  assert.equal(artifact.blocker.retryable, true);
  assert.match(artifact.blocker.messageSha256, /^[a-f0-9]{64}$/);
  assert.match(artifact.payloadSha256, /^[a-f0-9]{64}$/);
  const validation = validateIndependentReviewInfrastructureBlockedArtifact(artifact, IDENTITY);
  assert.equal(validation.valid, true);
  assert.equal(validation.finalVerdict, 'INDEPENDENT_REVIEW_INFRASTRUCTURE_ARTIFACT_VALID');

  const tampered = JSON.parse(JSON.stringify(artifact));
  tampered.sourceHead = 'a'.repeat(40);
  const rejected = validateIndependentReviewInfrastructureBlockedArtifact(tampered, IDENTITY);
  assert.equal(rejected.valid, false);
  assert.ok(rejected.blockers.includes('head-mismatch'));
  assert.ok(rejected.blockers.includes('payload-digest-mismatch'));
});
