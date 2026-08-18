import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
  assert.match(text, /githubReadRetryDelayMs\(attempt\)/);
  assert.doesNotMatch(text, /normalizedMethod === 'POST' && retryReads/);
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
