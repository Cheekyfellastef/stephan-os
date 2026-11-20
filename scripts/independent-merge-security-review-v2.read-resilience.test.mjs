import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Script } from 'node:vm';
import { TextDecoder } from 'node:util';
import * as resilience from '../shared/agents/githubReadResilienceV1.mjs';

const reviewerUrl = new URL('./independent-merge-security-review-v2.mjs', import.meta.url);

async function source() {
  return readFile(reviewerUrl, 'utf8');
}

test('reviewer retries only bounded GitHub reads and rejects redirects', async () => {
  const text = await source();
  assert.match(text, /GITHUB_READ_MAX_ATTEMPTS/);
  assert.match(text, /normalizedMethod === 'GET' && retryReads/);
  assert.match(text, /redirect: 'error'/);
  assert.match(text, /classifyGitHubReadFailure\(\{[\s\S]*networkError: true/s);
  assert.match(text, /rateLimitRemaining: response\.headers\.get\('x-ratelimit-remaining'\)/);
  assert.match(text, /rateLimitResetEpochSeconds: response\.headers\.get\('x-ratelimit-reset'\)/);
  assert.match(text, /classification\.retryImmediately !== false/);
  assert.match(text, /retryAtUtc: classification\.retryAtUtc/);
  assert.match(text, /githubReadRetryDelayMs\(attempt\)/);
  assert.doesNotMatch(text, /normalizedMethod === 'POST' && retryReads/);
});

// Execute the actual production request function without executing the CLI's
// review/credential entry point. Only transport, delay and identity observations
// are injected; the request's retry, decode and refusal logic is unchanged.
async function requestHarness(fetchImpl, identityCheck = async () => {}) {
  const text = await source();
  const start = text.indexOf('async function githubRequest(');
  const end = text.indexOf('\nasync function githubPages(', start);
  assert.ok(start >= 0 && end > start);
  const observations = { requests: [], identityChecks: 0, delays: [] };
  const context = {
    ...resilience, Buffer, TextDecoder,
    API_VERSION: '2022-11-28', USER_AGENT: 'source-test',
    process: { env: { GH_TOKEN: 'synthetic-test-token' } },
    text: value => String(value ?? '').trim(),
    fetch: async (url, options) => {
      observations.requests.push({ url, options });
      return fetchImpl(url, options, observations.requests.length);
    },
    verifyRetryIdentity: async () => {
      observations.identityChecks += 1;
      await identityCheck();
    },
    sleep: async ms => { observations.delays.push(ms); },
  };
  const request = new Script(`(${text.slice(start, end)})`).runInNewContext(context);
  return { request, observations };
}

function failedBody(responseOptions = {}) {
  return new Response(new ReadableStream({
    pull(controller) { controller.error(new TypeError('synthetic body disconnect')); },
  }, { highWaterMark: 0 }), responseOptions);
}

for (const status of [429, 403]) {
  test(`interrupted HTTP ${status} body retains observed rate limit without immediate retry`, async () => {
    const h = await requestHarness(() => failedBody({ status, headers: {
      'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790449200',
    } }));
    let failure;
    await assert.rejects(h.request('/repos/x/y/pulls/1/reviews'), error => {
      failure = error;
      return error instanceof resilience.GitHubReadInfrastructureError
        && error.code === 'GITHUB_READ_RATE_LIMIT' && error.status === status
        && error.attempts === 1 && error.retryAtUtc === '2026-09-26T19:00:00.000Z';
    });
    assert.equal(h.observations.requests.length, 1);
    assert.equal(h.observations.identityChecks, 0);
    assert.deepEqual(h.observations.delays, []);
    const identity = {
      repository: 'x/y', prNumber: 1, branch: 'original', sourceHead: 'a'.repeat(40),
      baseSha: 'b'.repeat(40), workflowRunId: 1, workflowRunAttempt: 1,
    };
    const artifact = resilience.buildIndependentReviewInfrastructureBlockedArtifact({ ...identity, failure });
    assert.equal(resilience.validateIndependentReviewInfrastructureBlockedArtifact(artifact, identity).valid, true);
    assert.equal(artifact.blocker.providerCode, 'GITHUB_READ_RATE_LIMIT');
    assert.equal(artifact.blocker.status, status);
    assert.equal(artifact.blocker.retryAtUtc, '2026-09-26T19:00:00.000Z');
  });
}

test('GET retries an interrupted body only after exact identity recheck', async () => {
  const h = await requestHarness((url, options, attempt) => attempt === 1
    ? failedBody() : new Response('{"ok":true}'));
  const result = await h.request('/repos/x/y/pulls/1/reviews');
  assert.equal(result.ok, true);
  assert.equal(h.observations.requests.length, 2);
  assert.equal(h.observations.identityChecks, 1);
  assert.deepEqual(h.observations.delays, [250]);
  assert.ok(h.observations.requests.every(x => x.options.redirect === 'error'));
});

test('exhausted body failure produces a valid bounded infrastructure artifact', async () => {
  const h = await requestHarness(() => failedBody());
  let failure;
  await assert.rejects(h.request('/repos/x/y/pulls/1/reviews'), error => {
    failure = error;
    return error instanceof resilience.GitHubReadInfrastructureError
      && error.code === 'GITHUB_READ_NETWORK' && error.status === null && error.attempts === 3;
  });
  assert.equal(h.observations.requests.length, 3);
  assert.equal(h.observations.identityChecks, 2);
  assert.deepEqual(h.observations.delays, [250, 750]);
  const identity = {
    repository: 'x/y', prNumber: 1, branch: 'original', sourceHead: 'a'.repeat(40),
    baseSha: 'b'.repeat(40), workflowRunId: 1, workflowRunAttempt: 1,
  };
  const artifact = resilience.buildIndependentReviewInfrastructureBlockedArtifact({ ...identity, failure });
  assert.equal(resilience.validateIndependentReviewInfrastructureBlockedArtifact(artifact, identity).valid, true);
  assert.equal(artifact.reviewMode, 'infrastructure-blocked');
});

test('body retry stops immediately if source identity moves', async () => {
  const h = await requestHarness(() => failedBody(), async () => { throw new Error('source moved'); });
  await assert.rejects(h.request('/repos/x/y/pulls/1/reviews'), /source moved/);
  assert.equal(h.observations.requests.length, 1);
  assert.equal(h.observations.identityChecks, 1);
  assert.deepEqual(h.observations.delays, []);
});

test('non-GET and explicitly disabled read retries never replay interrupted bodies', async () => {
  for (const options of [{ method: 'POST', body: { body: 'fixture' } }, { retryReads: false }]) {
    const h = await requestHarness(() => failedBody());
    await assert.rejects(h.request('/repos/x/y/issues/1/comments', options));
    assert.equal(h.observations.requests.length, 1);
    assert.equal(h.observations.identityChecks, 0);
  }
});

test('invalid UTF-8 and malformed JSON are permanent decode failures', async () => {
  for (const body of ['{broken', new Uint8Array([0xff])]) {
    const h = await requestHarness(() => new Response(body));
    await assert.rejects(h.request('/repos/x/y/pulls/1/reviews'));
    assert.equal(h.observations.requests.length, 1);
    assert.equal(h.observations.identityChecks, 0);
  }
});

test('response cap cancels before draining the stream and never retries', async () => {
  let pulls = 0;
  let cancelled = false;
  const h = await requestHarness(() => new Response(new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls <= 3) controller.enqueue(new Uint8Array([1, 2, 3]));
      else controller.close();
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 })));
  await assert.rejects(h.request('/repos/x/y/pulls/1', { maxResponseBytes: 4 }), /response bound/);
  assert.equal(pulls, 2);
  assert.equal(cancelled, true);
  assert.equal(h.observations.requests.length, 1);
  assert.equal(h.observations.identityChecks, 0);
});

test('exact cap, diff, empty and allowed-not-found response behavior is preserved', async () => {
  for (const [response, options, expected] of [
    [new Response('null'), { maxResponseBytes: 4 }, null],
    [new Response('diff'), { accept: 'application/vnd.github.v3.diff', maxResponseBytes: 4 }, 'diff'],
    [new Response(null, { status: 204 }), {}, null],
    [new Response('Not Found', { status: 404 }), { allowNotFound: true }, null],
  ]) {
    const h = await requestHarness(() => response);
    assert.equal(await h.request('/repos/x/y/pulls/1', options), expected);
    assert.equal(h.observations.requests.length, 1);
    assert.equal(h.observations.identityChecks, 0);
  }
});

test('every retry is guarded by exact PR and canonical-main identity re-read', async () => {
  const text = await source();
  assert.match(text, /async function verifyRetryIdentity\(\)/);
  assert.match(text, /\/pulls\/\$\{prNumber\}/);
  assert.match(text, /\/git\/ref\/heads\/main/);
  assert.match(text, /retryReads: false/);
  assert.match(text, /verifyIdentityBetweenRetries: false/);
  assert.match(text, /Pull-request identity changed while retrying a GitHub read/);
  assert.match(text, /requireExactBase\(pullRequest, mainRef, baseSha, 'retry'\)/);
  assert.match(text, /if \(verifyIdentityBetweenRetries\) await verifyRetryIdentity\(\);/);
});

test('review enumeration retains complete pagination and never converts failed reads into no reviews', async () => {
  const text = await source();
  assert.match(text, /githubPages\(`\/repos\/\$\{owner\}\/\$\{repo\}\/pulls\/\$\{prNumber\}\/reviews`\)/);
  assert.match(text, /for \(let page = 1; page <= MAX_PAGES; page \+= 1\)/);
  assert.match(text, /if \(!Array\.isArray\(pageItems\)\) throw new Error/);
  assert.doesNotMatch(text, /reviews\s*=\s*\[\]\s*;/);
  assert.doesNotMatch(text, /catch\s*\([^)]*\)\s*\{\s*return\s*\[\]/s);
});

test('exhausted transient reads write a fail-closed immutable infrastructure artifact', async () => {
  const text = await source();
  assert.match(text, /GitHubReadInfrastructureError/);
  assert.match(text, /buildIndependentReviewInfrastructureBlockedArtifact/);
  assert.match(text, /INDEPENDENT_SECURITY_REVIEW=REVIEW_INFRASTRUCTURE_BLOCKED/);
  assert.match(text, /fs\.existsSync\(resolve\(requestedPath\)\)/);
  assert.match(text, /flag: 'wx'/);
  assert.match(text, /process\.exitCode = 1/);
  assert.doesNotMatch(text, /REVIEW_INFRASTRUCTURE_BLOCKED[^\n]*clean/i);
});
