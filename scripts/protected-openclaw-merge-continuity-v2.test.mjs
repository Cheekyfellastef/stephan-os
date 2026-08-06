import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  evaluateDistFreshnessAgainstOrigin,
} from './ignite-stephanos-local.mjs';
import {
  latestMailboxCommentPage,
} from './battle-bridge-github-command-mailbox.mjs';

const exactHead = 'e41d7a90da563fe1e54cc6c799b0a9c275c30592';

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
  const source = readFileSync(new URL('./ignite-stephanos-local.mjs', import.meta.url), 'utf8');

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

test('mailbox comment page selection is bounded to the newest REST page', () => {
  assert.equal(latestMailboxCommentPage(0), 1);
  assert.equal(latestMailboxCommentPage(1), 1);
  assert.equal(latestMailboxCommentPage(100), 1);
  assert.equal(latestMailboxCommentPage(101), 2);
  assert.equal(latestMailboxCommentPage(12_345), 124);
  assert.throws(
    () => latestMailboxCommentPage(10, 101),
    /MAILBOX_COMMENT_PAGE_SIZE_INVALID/,
  );
});

test('mailbox source no longer paginates the complete historical issue thread', () => {
  const source = readFileSync(
    new URL('./battle-bridge-github-command-mailbox.mjs', import.meta.url),
    'utf8',
  );
  const commandLoad = source.match(
    /export async function runBattleBridgeGitHubCommandMailbox[\s\S]*?const state = loadState\(\);/,
  )?.[0] || '';

  assert.match(commandLoad, /loadBoundedMailboxComments\(\)/);
  assert.doesNotMatch(commandLoad, /--paginate/);
});

test('review coordinator has exact PR-comment publication authority', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/exact-head-review-dispatch.yml', import.meta.url),
    'utf8',
  );
  const coordinate = workflow.match(/  coordinate:[\s\S]*$/)?.[0] || '';

  assert.match(coordinate, /permissions:[\s\S]*pull-requests: write/);
});

test('independent review retry scans one bounded exact-head page', () => {
  const source = readFileSync(new URL('./retry-independent-review.mjs', import.meta.url), 'utf8');
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
