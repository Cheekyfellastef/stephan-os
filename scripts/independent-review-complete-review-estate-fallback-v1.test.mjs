import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fallbackUrl = new URL('./independent-review-complete-review-estate-fallback-v1.mjs', import.meta.url);

async function source() {
  return readFile(fallbackUrl, 'utf8');
}

test('fallback is restricted to the trusted independent review job', async () => {
  const text = await source();
  assert.match(text, /process\.env\.GITHUB_ACTIONS !== 'true'/);
  assert.match(text, /process\.env\.GITHUB_EVENT_NAME !== 'pull_request_target'/);
  assert.match(text, /process\.env\.GITHUB_JOB !== 'independent-security-review'/);
});

test('fallback intercepts only the exact current pull-request review GET', async () => {
  const text = await source();
  assert.match(text, /method !== 'GET'/);
  assert.match(text, /parseExactPullRequestReviewsRequest/);
  assert.match(text, /if \(!request\.eligible\) return ORIGINAL_FETCH/);
  assert.match(text, /if \(request\.page !== 1\) return response/);
});

test('global-id 404 fallback stays complete, bounded and exact-identity bound', async () => {
  const text = await source();
  assert.match(text, /isExactPullRequestReviewsGlobalId404/);
  assert.match(text, /PULL_REQUEST_REVIEW_ESTATE_MAX_PAGES/);
  assert.match(text, /PULL_REQUEST_REVIEW_ESTATE_MAX_BYTES/);
  assert.match(text, /validateGraphqlReviewEstatePage/);
  assert.match(text, /finalizeCompleteGraphqlReviewEstate/);
  assert.match(text, /await revalidateExactIdentity\(\);[\s\S]*await loadCompleteReviewEstate\(\);[\s\S]*await revalidateExactIdentity\(\);/s);
});

test('fallback never converts a failed GraphQL read into an empty review estate', async () => {
  const text = await source();
  assert.match(text, /INDEPENDENT_REVIEW_COMPLETE_ESTATE_FALLBACK_BLOCKED_SHA256/);
  assert.match(text, /return response;/);
  assert.doesNotMatch(text, /catch\s*\([^)]*\)\s*\{[\s\S]*syntheticRestReviewPage\(\[\]/s);
});

test('fallback has no merge, source-write, deployment or host mutation authority', async () => {
  const text = await source();
  assert.doesNotMatch(text, /git\s+(?:push|reset|clean|rebase)|gh\s+pr\s+merge|Restart-Computer|Stop-Process|shutdown\.exe|taskkill|Invoke-Expression|\beval\s*\(/i);
  assert.doesNotMatch(text, /method:\s*['"](?:PUT|PATCH|DELETE)['"]/i);
  assert.match(text, /method: 'POST',[\s\S]*GRAPHQL_QUERY/s);
});
