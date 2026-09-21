import assert from 'node:assert/strict';
import test from 'node:test';

import { CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS } from './canonicalMailboxAuthorityV1.mjs';
import {
  CANONICAL_MAILBOX_ROLLOVER_PLAN_SCHEMA,
  planCanonicalMailboxRollover,
} from './canonicalMailboxRolloverPlannerV1.mjs';

test('mailbox stays healthy below the rollover threshold', () => {
  const plan = planCanonicalMailboxRollover({
    issueNumber: 2158,
    commentCount: CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS - 1,
  });
  assert.equal(plan.schemaVersion, CANONICAL_MAILBOX_ROLLOVER_PLAN_SCHEMA);
  assert.equal(plan.ok, true);
  assert.equal(plan.state, 'HEALTHY');
  assert.equal(plan.action, 'NONE');
  assert.equal(plan.mutationAllowed, false);
});

test('threshold crossing becomes an actionable successor-provisioning state', () => {
  const plan = planCanonicalMailboxRollover({
    issueNumber: 2158,
    commentCount: CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.state, 'ROTATION_REQUIRED');
  assert.equal(plan.action, 'CREATE_OR_NOMINATE_SUCCESSOR');
  assert.equal(plan.successorProvisioningRequired, true);
  assert.equal(plan.candidateSuccessorIssue, 0);
});

test('same and retired successors fail closed', () => {
  const same = planCanonicalMailboxRollover({
    issueNumber: 2158,
    commentCount: CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS,
    candidateSuccessorIssue: 2158,
  });
  assert.equal(same.ok, false);
  assert.equal(same.blocker, 'CANONICAL_MAILBOX_SUCCESSOR_SAME_AS_CURRENT');

  const retired = planCanonicalMailboxRollover({
    issueNumber: 2158,
    commentCount: CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS,
    candidateSuccessorIssue: 1507,
  });
  assert.equal(retired.ok, false);
  assert.equal(retired.blocker, 'CANONICAL_MAILBOX_SUCCESSOR_RETIRED');
});

test('valid successor yields one atomic migration target and retires the predecessor', () => {
  const plan = planCanonicalMailboxRollover({
    issueNumber: 2158,
    commentCount: CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS + 17,
    candidateSuccessorIssue: 3000,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.state, 'SUCCESSOR_READY_FOR_ATOMIC_CUTOVER');
  assert.equal(plan.action, 'PREPARE_CANONICAL_AUTHORITY_MIGRATION');
  assert.deepEqual(plan.migrationTarget, {
    activeIssue: 3000,
    retiredIssues: [1507, 2158],
    preservesSingleCanonicalAuthority: true,
  });
  assert.equal(plan.successorProvisioningRequired, false);
  assert.equal(plan.mutationAllowed, false);
  assert.equal(plan.runtimeMutationAuthority, false);
  assert.equal(plan.mergeAuthority, false);
});

test('retired or foreign current mailbox identity fails closed', () => {
  const retired = planCanonicalMailboxRollover({ issueNumber: 1507, commentCount: 1 });
  assert.equal(retired.ok, false);
  assert.equal(retired.blocker, 'CANONICAL_MAILBOX_ISSUE_RETIRED');

  const foreign = planCanonicalMailboxRollover({ issueNumber: 9999, commentCount: 1 });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.blocker, 'CANONICAL_MAILBOX_ISSUE_MISMATCH');
});

test('invalid comment counts fail closed without proposing a successor', () => {
  const plan = planCanonicalMailboxRollover({ issueNumber: 2158, commentCount: -1, candidateSuccessorIssue: 3000 });
  assert.equal(plan.ok, false);
  assert.equal(plan.blocker, 'CANONICAL_MAILBOX_COMMENT_COUNT_INVALID');
  assert.equal(plan.action, 'NONE');
  assert.equal(plan.mutationAllowed, false);
});
