import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_MAILBOX_ISSUE,
  CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS,
  RETIRED_CANONICAL_MAILBOX_ISSUES,
  evaluateCanonicalMailboxCapacity,
  isCanonicalMailboxIssue,
  isRetiredCanonicalMailboxIssue,
  validateCanonicalMailboxSuccessor,
} from './canonicalMailboxAuthorityV1.mjs';

test('issue #2590 is the sole active canonical mailbox authority and predecessors are retired', () => {
  assert.equal(CANONICAL_MAILBOX_ISSUE, 2590);
  assert.deepEqual(RETIRED_CANONICAL_MAILBOX_ISSUES, [1507, 2158]);
  assert.equal(isCanonicalMailboxIssue(2590), true);
  assert.equal(isCanonicalMailboxIssue(2158), false);
  assert.equal(isCanonicalMailboxIssue(1507), false);
  assert.equal(isRetiredCanonicalMailboxIssue(1507), true);
  assert.equal(isRetiredCanonicalMailboxIssue(2158), true);
  assert.equal(isRetiredCanonicalMailboxIssue(2590), false);
});

test('capacity doctrine rotates before the observed exhausted-thread boundary', () => {
  assert.ok(CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS < 2500);
  assert.equal(evaluateCanonicalMailboxCapacity({ issueNumber: 2590, commentCount: CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS - 1 }).rotationRequired, false);
  assert.equal(evaluateCanonicalMailboxCapacity({ issueNumber: 2590, commentCount: CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS }).rotationRequired, true);
  assert.equal(evaluateCanonicalMailboxCapacity({ issueNumber: 2158, commentCount: 2498 }).blocker, 'CANONICAL_MAILBOX_ISSUE_RETIRED');
  assert.equal(evaluateCanonicalMailboxCapacity({ issueNumber: 1507, commentCount: 1 }).blocker, 'CANONICAL_MAILBOX_ISSUE_RETIRED');
});

test('future rollover preserves exactly one new, non-retired authority issue', () => {
  assert.equal(validateCanonicalMailboxSuccessor({ nextIssue: 2590 }).blocker, 'CANONICAL_MAILBOX_SUCCESSOR_SAME_AS_CURRENT');
  assert.equal(validateCanonicalMailboxSuccessor({ nextIssue: 2158 }).blocker, 'CANONICAL_MAILBOX_SUCCESSOR_RETIRED');
  assert.equal(validateCanonicalMailboxSuccessor({ nextIssue: 1507 }).blocker, 'CANONICAL_MAILBOX_SUCCESSOR_RETIRED');
  assert.deepEqual(validateCanonicalMailboxSuccessor({ nextIssue: 3000 }), {
    ok: true,
    blocker: '',
    currentIssue: 2590,
    nextIssue: 3000,
    preservesSingleCanonicalAuthority: true,
  });
});
