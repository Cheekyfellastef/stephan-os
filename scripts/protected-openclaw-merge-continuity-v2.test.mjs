import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  evaluateDistFreshnessAgainstOrigin,
} from './ignite-stephanos-local.mjs';
import {
  boundedMailboxCommentPages,
  latestMailboxCommentPage,
} from './battle-bridge-github-command-mailbox.mjs';

const exactHead = 'e41d7a90da563fe1e54cc6c799b0a9c275c30592';
const readSource = (url) => readFileSync(url, 'utf8').replaceAll('\r\n', '\n');

test('pre-serve freshness accepts one exact full SHA identity', () => {
  const result = evaluateDistFreshnessAgainstOrigin({
    distMetadata: {
      gitCommit: exactHead,
      sourceFingerprint: 'fingerprint',
      buildTimestamp: '2026-08-05T21:32:40.105Z',
    },
    currentCommit: exactHead,
    originMainCommit: exactHead,
  });

  assert.equal(result.ignitionStatus, 'READY');
  assert.equal(result.reason, 'dist-source-commit-current');
  assert.equal(result.servedCommit, exactHead);
  assert.equal(result.expectedSourceCommit, exactHead);
});

test('pre-serve call site requests full Git identities rather than abbreviated SHAs', () => {
  const source = readSource(new URL('./ignite-stephanos-local.mjs', import.meta.url));

  assert.match(
    source,
    /git-current-commit-pre-serve'[\s\S]{0,160}\['rev-parse', 'HEAD'\]/,
  );
  assert.match(
    source,
    /git-origin-main-commit-pre-serve'[\s\S]{0,160}\['rev-parse', 'origin\/main'\]/,
  );
  assert.doesNotMatch(
    source,
    /git-(?:current-commit|origin-main-commit)-pre-serve[\s\S]{0,180}--short/,
  );
});

test('mailbox comment page selection is bounded around the newest REST page', () => {
  assert.equal(latestMailboxCommentPage(0), 1);
  assert.equal(latestMailboxCommentPage(1), 1);
  assert.equal(latestMailboxCommentPage(100), 1);
  assert.equal(latestMailboxCommentPage(101), 2);
  assert.equal(latestMailboxCommentPage(12_345), 124);
  assert.throws(
    () => latestMailboxCommentPage(10, 101),
    /MAILBOX_COMMENT_PAGE_SIZE_INVALID/,
  );
  assert.deepEqual(boundedMailboxCommentPages(0), [1, 2]);
  assert.deepEqual(boundedMailboxCommentPages(536), [5, 6, 7]);
  assert.deepEqual(boundedMailboxCommentPages(12_345), [123, 124, 125]);
});

test('mailbox source no longer paginates the complete historical issue thread', () => {
  const source = readSource(new URL('./battle-bridge-github-command-mailbox.mjs', import.meta.url));
  const commandLoad = source.match(
    /export async function runBattleBridgeGitHubCommandMailbox[\s\S]*?const comments = loadBoundedMailboxComments\(\);/,
  )?.[0] || '';

  assert.match(commandLoad, /loadBoundedMailboxComments\(\)/);
  assert.doesNotMatch(commandLoad, /--paginate/);
});

test('review coordinator has exact PR-comment publication authority', () => {
  const workflow = readSource(new URL('../.github/workflows/exact-head-review-dispatch.yml', import.meta.url));
  const coordinate = workflow.match(/  coordinate:[\s\S]*$/)?.[0] || '';

  assert.match(coordinate, /permissions:[\s\S]*pull-requests: write/);
});

test('pull-request verification is isolated while mutations use one PR-scoped queue', () => {
  const workflow = readSource(new URL('../.github/workflows/exact-head-review-dispatch.yml', import.meta.url));
  const verify = workflow.match(/  verify:[\s\S]*?\n  plan:/)?.[0] || '';
  const coordinate = workflow.match(/  coordinate:[\s\S]*$/)?.[0] || '';

  assert.doesNotMatch(verify, /concurrency:/);
  assert.match(
    coordinate,
    /group: exact-head-review-dispatch-\$\{\{ github\.repository \}\}-pr-\$\{\{ matrix\.target\.prNumber \}\}/,
  );
  assert.match(coordinate, /cancel-in-progress: false/);
  assert.doesNotMatch(
    workflow,
    /group: exact-head-review-dispatch-\$\{\{ github\.repository \}\}\s*\n/,
  );
});

test('independent review retry scans one bounded exact-head page', () => {
  const source = readSource(new URL('./retry-independent-review.mjs', import.meta.url));
  const loader = source.match(
    /async function loadRecentReviewRuns[\s\S]*?\n}\n\nasync function main/,
  )?.[0] || '';

  assert.match(loader, /head_sha=\$\{encodedHead}/);
  assert.match(loader, /per_page=100&page=1/);
  assert.doesNotMatch(loader, /githubPages\(/);
  assert.match(
    source,
    /loadRecentReviewRuns\(owner, repo, workflow\.id, prNumber, expectedHead\)/,
  );
});
