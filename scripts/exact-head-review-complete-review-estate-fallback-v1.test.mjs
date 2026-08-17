import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fallbackUrl = new URL('./exact-head-review-complete-review-estate-fallback-v1.mjs', import.meta.url);

async function source() {
  return readFile(fallbackUrl, 'utf8');
}

test('coordinator fallback is restricted to trusted non-PR coordinator jobs', async () => {
  const text = await source();
  assert.match(text, /ALLOWED_EVENTS = new Set\(\['issue_comment', 'workflow_run', 'schedule', 'workflow_dispatch'\]\)/);
  assert.match(text, /ALLOWED_JOBS = new Set\(\['plan', 'coordinate'\]\)/);
  assert.match(text, /process\.env\.GITHUB_ACTIONS !== 'true'/);
  assert.doesNotMatch(text, /ALLOWED_EVENTS[^\n]*pull_request/);
});

test('only exact paginated pull-request review GETs can be intercepted', async () => {
  const text = await source();
  assert.match(text, /method !== 'GET'/);
  assert.match(text, /\/pulls\/\(\[1-9\]\[0-9\]\*\)\/reviews/);
  assert.match(text, /key === 'page' \|\| key === 'per_page'/);
  assert.match(text, /perPage === PULL_REQUEST_REVIEW_ESTATE_PAGE_SIZE/);
  assert.match(text, /page <= PULL_REQUEST_REVIEW_ESTATE_MAX_PAGES/);
});

test('REST global-ID 404 falls back only to a complete exact-bound GraphQL estate', async () => {
  const text = await source();
  assert.match(text, /isExactPullRequestReviewsGlobalId404/);
  assert.match(text, /request\.page !== 1/);
  assert.match(text, /assertExactReviewFallbackIdentity/);
  assert.match(text, /validateGraphqlReviewEstatePage/);
  assert.match(text, /finalizeCompleteGraphqlReviewEstate/);
  assert.match(text, /await revalidateExactIdentity\(expected\);[\s\S]*await loadCompleteReviewEstate\(expected\);[\s\S]*await revalidateExactIdentity\(expected\);/s);
  assert.doesNotMatch(text, /catch\s*\([^)]*\)\s*\{\s*return\s*syntheticPage/s);
});

test('coordinator fallback preserves trusted actor identity instead of login-only substitution', async () => {
  const text = await source();
  assert.match(text, /const MAX_DISTINCT_REVIEW_ACTORS = 100/);
  assert.match(text, /restJson\(`\/users\/\$\{encoded\}`/);
  assert.match(text, /\['User', 'Bot'\]\.includes\(type\)/);
  assert.match(text, /user: actors\.get/);
});

test('fallback has no repository, merge, deployment or host mutation authority', async () => {
  const text = await source();
  assert.doesNotMatch(text, /git\s+(?:push|reset|clean|rebase)|gh\s+pr\s+merge|Restart-Computer|Stop-Process|shutdown\.exe|taskkill|Invoke-Expression|\beval\s*\(/i);
  assert.doesNotMatch(text, /method:\s*['"](?:PUT|PATCH|DELETE)['"]/i);
  assert.match(text, /method: 'POST',[\s\S]*GRAPHQL_QUERY/s);
});
