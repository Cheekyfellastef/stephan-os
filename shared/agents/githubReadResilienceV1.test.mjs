import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

const FAILURE_IDENTITY = Object.freeze({
  code: 'GITHUB_READ_NETWORK', method: 'GET',
  path: '/repos/Cheekyfellastef/stephan-os/pulls/1838/reviews',
  status: null, attempts: 3,
});

const FAILURE_MISMATCHES = [
  { code: 'GITHUB_READ_NETWORK', status: 200 },
  { code: 'GITHUB_READ_TRANSIENT_HTTP', status: 200 },
  { code: 'GITHUB_READ_TRANSIENT_HTTP', status: 403 },
  { code: 'GITHUB_READ_PR_GLOBAL_ID_404', status: 503 },
  { code: 'GITHUB_READ_RATE_LIMIT', status: 404 },
  { attempts: 4 }, { attempts: '3' }, { attempts: 0 }, { attempts: 1.5 },
];

function canonicalJsonForFixture(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonForFixture).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJsonForFixture(value[key])}`).join(',')}}`;
}

function resignFixture(artifact) {
  const { payloadSha256: ignored, ...core } = artifact;
  return { ...core, payloadSha256: createHash('sha256').update(canonicalJsonForFixture(core)).digest('hex') };
}

for (const mismatch of FAILURE_MISMATCHES) {
  test(`failure constructor rejects inconsistent or unbounded evidence ${JSON.stringify(mismatch)}`, () => {
    assert.throws(() => new GitHubReadInfrastructureError({ ...FAILURE_IDENTITY, ...mismatch }), /identity is invalid/);
  });

  test(`valid digest cannot bless inconsistent failure evidence ${JSON.stringify(mismatch)}`, () => {
    const failure = new GitHubReadInfrastructureError(FAILURE_IDENTITY);
    const good = buildIndependentReviewInfrastructureBlockedArtifact({ ...IDENTITY, failure });
    const changed = { ...good.blocker, ...mismatch };
    if (mismatch.code) {
      changed.providerCode = mismatch.code;
      changed.code = 'REVIEW_INFRASTRUCTURE_BLOCKED';
    }
    const artifact = resignFixture({ ...good, blocker: changed });
    const result = validateIndependentReviewInfrastructureBlockedArtifact(artifact, IDENTITY);
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('blocker-invalid'));
    assert.ok(!result.blockers.includes('payload-digest-mismatch'));
  });
}

test('all legitimate status/code pairs retain valid infrastructure receipts', () => {
  for (const [code, statuses] of [
    ['GITHUB_READ_NETWORK', [null]],
    ['GITHUB_READ_TRANSIENT_HTTP', [502, 503, 504]],
    ['GITHUB_READ_PR_GLOBAL_ID_404', [404]],
    ['GITHUB_READ_RATE_LIMIT', [403, 429]],
  ]) {
    for (const status of statuses) {
      const failure = new GitHubReadInfrastructureError({ ...FAILURE_IDENTITY, code, status });
      const artifact = buildIndependentReviewInfrastructureBlockedArtifact({ ...IDENTITY, failure });
      assert.equal(validateIndependentReviewInfrastructureBlockedArtifact(artifact, IDENTITY).valid, true);
    }
  }
});

test('artifact construction revalidates a mutated error instance', () => {
  const failure = new GitHubReadInfrastructureError(FAILURE_IDENTITY);
  failure.status = 200;
  assert.throws(() => buildIndependentReviewInfrastructureBlockedArtifact({ ...IDENTITY, failure }), /identity is invalid/);
});

test('null and malformed artifact inputs return typed refusal', () => {
  for (const artifact of [null, undefined, [], 'broken', false]) {
    const result = validateIndependentReviewInfrastructureBlockedArtifact(artifact, IDENTITY);
    assert.equal(result.valid, false);
    assert.equal(result.finalVerdict, 'INDEPENDENT_REVIEW_INFRASTRUCTURE_ARTIFACT_BLOCKED');
  }
});

test('missing or malformed expected identities cannot validate an artifact', () => {
  const failure = new GitHubReadInfrastructureError(FAILURE_IDENTITY);
  const artifact = buildIndependentReviewInfrastructureBlockedArtifact({ ...IDENTITY, failure });
  for (const options of [null, undefined, [], 'broken', false, {}]) {
    const result = validateIndependentReviewInfrastructureBlockedArtifact(artifact, options);
    assert.equal(result.valid, false);
    assert.equal(result.finalVerdict, 'INDEPENDENT_REVIEW_INFRASTRUCTURE_ARTIFACT_BLOCKED');
  }
});

test('only bounded read-only transient conditions are retryable', () => {
  assert.equal(GITHUB_READ_MAX_ATTEMPTS, 3);
  for (const status of [502, 503, 504]) {
    const result = classifyGitHubReadFailure({ method: 'GET', status });
    assert.equal(result.retryable, true);
    assert.equal(result.code, 'GITHUB_READ_TRANSIENT_HTTP');
  }
  for (const [status, body, reset] of [
    [429, 'API rate limit exceeded', 1790449200],
    [429, 'secondary rate limit', null],
  ]) {
    const limited = classifyGitHubReadFailure({ method: 'GET', status, body,
      rateLimitRemaining: '0', rateLimitResetEpochSeconds: reset });
    assert.equal(limited.retryable, true);
    assert.equal(limited.retryImmediately, false);
    assert.equal(limited.code, 'GITHUB_READ_RATE_LIMIT');
  }
  for (const [status, expectedCode] of [[200, 'GITHUB_READ_PERMANENT'],
    [403, 'GITHUB_READ_RATE_LIMIT'], [429, 'GITHUB_READ_RATE_LIMIT']]) {
    const response = classifyGitHubReadFailure({ method: 'GET', status,
      body: 'API rate limit exceeded', rateLimitRemaining: '0',
      rateLimitResetEpochSeconds: '1e30' });
    assert.equal(response.code, expectedCode);
    assert.equal(response.retryAtUtc ?? null, null);
  }
  assert.equal(classifyGitHubReadFailure({ method: 'POST', status: 429 }).retryable, false);
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
  const primaryLimit = classifyGitHubReadFailure({
    method: 'GET',
    status: 403,
    body: 'API rate limit exceeded for user ID 267490109.',
    rateLimitRemaining: '0',
    rateLimitResetEpochSeconds: 1790449200,
  });
  assert.equal(primaryLimit.retryable, true);
  assert.equal(primaryLimit.retryImmediately, false);
  assert.equal(primaryLimit.code, 'GITHUB_READ_RATE_LIMIT');
  assert.equal(primaryLimit.retryAtUtc, '2026-09-26T19:00:00.000Z');

  const secondaryLimit = classifyGitHubReadFailure({
    method: 'GET',
    status: 403,
    body: 'You have exceeded a secondary rate limit.',
  });
  assert.equal(secondaryLimit.retryable, true);
  assert.equal(secondaryLimit.retryImmediately, false);
  assert.equal(secondaryLimit.code, 'GITHUB_READ_RATE_LIMIT');

  assert.equal(classifyGitHubReadFailure({ method: 'POST', status: 503 }).retryable, false);
  assert.equal(classifyGitHubReadFailure({ method: 'GET', status: 404, body: 'Not Found' }).retryable, false);
  assert.equal(classifyGitHubReadFailure({ method: 'GET', status: 403, body: 'Resource not accessible by integration' }).retryable, false);
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
  assert.equal(error.retryAtUtc, null);
  assert.match(error.message, /^REVIEW_INFRASTRUCTURE_BLOCKED:/);

  const rateLimit = new GitHubReadInfrastructureError({
    code: 'GITHUB_READ_RATE_LIMIT',
    method: 'GET',
    path: '/repos/Cheekyfellastef/stephan-os/pulls/1830',
    status: 403,
    attempts: 1,
    retryAtUtc: '2026-09-26T19:00:00.000Z',
  });
  assert.equal(rateLimit.retryAtUtc, '2026-09-26T19:00:00.000Z');
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
