import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../.github/workflows/independent-merge-security-review.yml', import.meta.url);

async function workflow() {
  return readFile(workflowUrl, 'utf8');
}

test('independent review remains a trusted-base pull_request_target workflow', async () => {
  const text = await workflow();
  assert.match(text, /pull_request_target:/);
  assert.match(text, /branches: \[main\]/);
  assert.match(text, /types: \[opened, synchronize, reopened, ready_for_review\]/);
  assert.match(text, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(text, /persist-credentials: false/);
  assert.match(text, /fetch-depth: 1/);
  assert.doesNotMatch(text, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.doesNotMatch(text, /refs\/pull\/.*\/merge/);
});

test('workflow grants only the existing bounded read and issue-report authority', async () => {
  const text = await workflow();
  assert.match(text, /^permissions: \{\}$/m);
  assert.match(text, /actions: read/);
  assert.match(text, /contents: read/);
  assert.match(text, /issues: write/);
  assert.match(text, /pull-requests: read/);
  assert.doesNotMatch(text, /contents: write|pull-requests: write|deployments: write|packages: write|id-token: write/);
});

test('workflow proves all three specialist layers before invoking the wrapper', async () => {
  const text = await workflow();
  const policyStep = text.indexOf('Prove bounded Windows authority specialist policy');
  const reviewStep = text.indexOf('Review the complete exact-head and exact-base diff without mutation authority');
  assert.ok(policyStep >= 0);
  assert.ok(reviewStep > policyStep);
  assert.match(text, /windowsAuthoritySpecialistReviewV1\.test\.mjs/);
  assert.match(text, /windowsAuthoritySpecialistBoundaryV1\.test\.mjs/);
  assert.match(text, /independent-merge-security-review-with-windows-specialist-v1\.test\.mjs/);
  assert.match(text, /node scripts\/independent-merge-security-review-with-windows-specialist-v1\.mjs/);
  assert.doesNotMatch(text, /run: node scripts\/independent-merge-security-review-v2\.mjs/);
});

test('immutable artifact remains exact-run, fail-closed and non-overwriting', async () => {
  const text = await workflow();
  assert.match(text, /STEPHANOS_INDEPENDENT_REVIEW_ARTIFACT_PATH: \$\{\{ runner\.temp \}\}\/independent-review-result\.json/);
  assert.match(text, /if: \$\{\{ always\(\) \}\}/);
  assert.match(text, /stephanos-independent-review-\$\{\{ github\.run_id \}\}-attempt-\$\{\{ github\.run_attempt \}\}/);
  assert.match(text, /if-no-files-found: error/);
  assert.match(text, /overwrite: false/);
  assert.match(text, /include-hidden-files: false/);
});
