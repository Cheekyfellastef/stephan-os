import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBattleBridgeGitHubCommand } from './battleBridgeGitHubCommandMailbox.mjs';

import {
  CANONICAL_MAILBOX_ISSUE,
  CANONICAL_MAILBOX_RECEIPT_PREDECESSOR,
  CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS,
  RETIRED_CANONICAL_MAILBOX_ISSUES,
  evaluateCanonicalMailboxCapacity,
  isCanonicalMailboxIssue,
  isRetiredCanonicalMailboxIssue,
  validateCanonicalMailboxSuccessor,
} from './canonicalMailboxAuthorityV1.mjs';

test('one source-selected mailbox is active and every predecessor remains retired', () => {
  assert.equal(Number.isSafeInteger(CANONICAL_MAILBOX_ISSUE), true);
  assert.ok(CANONICAL_MAILBOX_ISSUE > CANONICAL_MAILBOX_RECEIPT_PREDECESSOR);
  assert.equal(new Set(RETIRED_CANONICAL_MAILBOX_ISSUES).size, RETIRED_CANONICAL_MAILBOX_ISSUES.length);
  assert.deepEqual(RETIRED_CANONICAL_MAILBOX_ISSUES.slice(0, 5), [1507, 2158, 2590, 2808, 3149]);
  assert.equal(CANONICAL_MAILBOX_RECEIPT_PREDECESSOR, RETIRED_CANONICAL_MAILBOX_ISSUES.at(-1));
  assert.equal(isCanonicalMailboxIssue(CANONICAL_MAILBOX_ISSUE), true);
  assert.equal(isCanonicalMailboxIssue(3149), false);
  assert.equal(isCanonicalMailboxIssue(2808), false);
  assert.equal(isCanonicalMailboxIssue(2590), false);
  assert.equal(isCanonicalMailboxIssue(2158), false);
  assert.equal(isCanonicalMailboxIssue(1507), false);
  assert.equal(isRetiredCanonicalMailboxIssue(1507), true);
  assert.equal(isRetiredCanonicalMailboxIssue(2158), true);
  assert.equal(isRetiredCanonicalMailboxIssue(2590), true);
  assert.equal(isRetiredCanonicalMailboxIssue(2808), true);
  for (const issue of RETIRED_CANONICAL_MAILBOX_ISSUES) {
    assert.equal(isCanonicalMailboxIssue(issue), false);
    assert.equal(isRetiredCanonicalMailboxIssue(issue), true);
  }
  assert.equal(isRetiredCanonicalMailboxIssue(CANONICAL_MAILBOX_ISSUE), false);
});

test('capacity doctrine rotates before the observed exhausted-thread boundary', () => {
  assert.ok(CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS < 2500);
  assert.equal(evaluateCanonicalMailboxCapacity({ issueNumber: CANONICAL_MAILBOX_ISSUE, commentCount: CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS - 1 }).rotationRequired, false);
  assert.equal(evaluateCanonicalMailboxCapacity({ issueNumber: CANONICAL_MAILBOX_ISSUE, commentCount: CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS }).rotationRequired, true);
  assert.equal(evaluateCanonicalMailboxCapacity({ issueNumber: 2808, commentCount: 2500 }).blocker, 'CANONICAL_MAILBOX_ISSUE_RETIRED');
  assert.equal(evaluateCanonicalMailboxCapacity({ issueNumber: 2590, commentCount: 2500 }).blocker, 'CANONICAL_MAILBOX_ISSUE_RETIRED');
  assert.equal(evaluateCanonicalMailboxCapacity({ issueNumber: 2158, commentCount: 2498 }).blocker, 'CANONICAL_MAILBOX_ISSUE_RETIRED');
  assert.equal(evaluateCanonicalMailboxCapacity({ issueNumber: 1507, commentCount: 1 }).blocker, 'CANONICAL_MAILBOX_ISSUE_RETIRED');
});

test('the complete command validator admits the selected epoch and denies every retired transport', () => {
  const command = { schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'mailbox-retired-admission-test-001', operation: 'READ_DEPLOYMENT_STATUS',
    repository: 'Cheekyfellastef/stephan-os', issueNumber: CANONICAL_MAILBOX_ISSUE,
    branch: 'main', operatorApproval: 'operator-approved', expectedHead: 'a'.repeat(40),
    expiresAt: '2026-10-26T13:10:00.000Z' };
  const options = { authorLogin: 'Cheekyfellastef', now: new Date('2026-10-26T13:00:00.000Z') };
  assert.equal(validateBattleBridgeGitHubCommand(command, options).ok, true);
  for (const issueNumber of RETIRED_CANONICAL_MAILBOX_ISSUES) {
    assert.equal(validateBattleBridgeGitHubCommand({ ...command, issueNumber }, options).ok, false);
  }
});

test('future rollover preserves exactly one new, non-retired authority issue', () => {
  assert.equal(validateCanonicalMailboxSuccessor({ nextIssue: CANONICAL_MAILBOX_ISSUE }).blocker, 'CANONICAL_MAILBOX_SUCCESSOR_SAME_AS_CURRENT');
  assert.equal(validateCanonicalMailboxSuccessor({ nextIssue: 3149 }).blocker, 'CANONICAL_MAILBOX_SUCCESSOR_RETIRED');
  assert.equal(validateCanonicalMailboxSuccessor({ nextIssue: 2808 }).blocker, 'CANONICAL_MAILBOX_SUCCESSOR_RETIRED');
  assert.equal(validateCanonicalMailboxSuccessor({ nextIssue: 2590 }).blocker, 'CANONICAL_MAILBOX_SUCCESSOR_RETIRED');
  assert.equal(validateCanonicalMailboxSuccessor({ nextIssue: 2158 }).blocker, 'CANONICAL_MAILBOX_SUCCESSOR_RETIRED');
  assert.equal(validateCanonicalMailboxSuccessor({ nextIssue: 1507 }).blocker, 'CANONICAL_MAILBOX_SUCCESSOR_RETIRED');
  assert.deepEqual(validateCanonicalMailboxSuccessor({ nextIssue: CANONICAL_MAILBOX_ISSUE + 1000 }), {
    ok: true,
    blocker: '',
    currentIssue: CANONICAL_MAILBOX_ISSUE,
    nextIssue: CANONICAL_MAILBOX_ISSUE + 1000,
    preservesSingleCanonicalAuthority: true,
  });
});
