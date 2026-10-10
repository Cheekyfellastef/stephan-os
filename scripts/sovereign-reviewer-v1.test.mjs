import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from './sovereign-reviewer-v1.mjs';

test('runner publishes only a candidate proof, with no GitHub, merge or deployment authority', async () => {
  let published = false;
  const result = await main({ STEPHANOS_REVIEW_PR: '3005' }, {
    snapshot: () => ({
      repository: 'Cheekyfellastef/stephan-os', issueNumber: 1574, prNumber: 3005,
      branch: 'goal/1574-sovereign-reviewer-local-v1',
      sourceHead: 'a'.repeat(40), baseSha: 'b'.repeat(40),
      changedFiles: ['src/test.js'],
      diff: 'diff --git a/src/test.js b/src/test.js\n-old\n+new\n',
      implementerProvider: 'github-builder', implementerSessionId: 'builder-1',
      reviewerSessionId: 'reviewer-2', modelClass: 'qwen-14b',
      timestampUtc: '2026-10-10T14:00:00.000Z',
    }),
    invokeModel: async () => JSON.stringify({ verdict: 'clean', reviewedPaths: ['src/test.js'], findings: [] }),
    persist: result => {
      assert.equal(result.qualification, 'PENDING_INDEPENDENT_ATTESTATION');
      assert.equal(result.mergeAuthority, false);
      published = true;
    },
  });
  assert.equal(result.status, 'LOCAL_REVIEW_EVIDENCE_READY');
  assert.equal(published, true);
});
test('offline local model is held and still published as a blocked status, never clean', async () => {
  let published;
  const result = await main({ STEPHANOS_REVIEW_PR: '3005' }, {
    snapshot: () => { throw new Error('REVIEW_WORKTREE_NOT_CLEAN'); },
    persist: data => { published = data; },
  });
  assert.equal(result.status, 'SOVEREIGN_REVIEW_HELD');
  assert.equal(published.reason, 'REVIEW_WORKTREE_NOT_CLEAN');
  assert.equal(result.mergeAuthority, false);
});
