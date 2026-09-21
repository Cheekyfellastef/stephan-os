import assert from 'node:assert/strict';
import test from 'node:test';

import { CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS } from './canonicalMailboxAuthorityV1.mjs';
import {
  CANONICAL_MAILBOX_REPOSITORY,
  CANONICAL_MAILBOX_ROLLOVER_PLAN_SCHEMA,
  CANONICAL_MAILBOX_SUCCESSOR_PROVISIONING_SCHEMA,
  planCanonicalMailboxRollover,
} from './canonicalMailboxRolloverPlannerV1.mjs';

const provisioningEvidence = (issueNumber = 3000, overrides = {}) => ({
  schemaVersion: CANONICAL_MAILBOX_SUCCESSOR_PROVISIONING_SCHEMA,
  source: 'github-issue-read',
  repository: CANONICAL_MAILBOX_REPOSITORY,
  issueNumber,
  exists: true,
  state: 'open',
  purpose: 'canonical-mailbox-successor',
  ...overrides,
});

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

test('valid successor number still requires issue-bound provisioning evidence', () => {
  const plan = planCanonicalMailboxRollover({
    issueNumber: 2158,
    commentCount: CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS,
    candidateSuccessorIssue: 999999999,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.state, 'ROTATION_REQUIRED');
  assert.equal(plan.action, 'VERIFY_SUCCESSOR_PROVISIONING');
  assert.equal(plan.successorProvisioningRequired, true);
  assert.equal(plan.migrationTarget, undefined);
});

test('mismatched or unprovisioned successor evidence fails closed', () => {
  for (const evidence of [
    provisioningEvidence(3001),
    provisioningEvidence(3000, { exists: false }),
    provisioningEvidence(3000, { state: 'closed' }),
    provisioningEvidence(3000, { repository: 'other/repo' }),
    provisioningEvidence(3000, { source: 'caller-assertion' }),
    provisioningEvidence(3000, { purpose: 'ordinary-issue' }),
  ]) {
    const plan = planCanonicalMailboxRollover({
      issueNumber: 2158,
      commentCount: CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS,
      candidateSuccessorIssue: 3000,
      successorProvisioningEvidence: evidence,
    });
    assert.equal(plan.ok, false);
    assert.equal(plan.blocker, 'CANONICAL_MAILBOX_SUCCESSOR_PROVISIONING_EVIDENCE_INVALID');
  }
});

test('proven successor yields one atomic migration target and retires the predecessor', () => {
  const plan = planCanonicalMailboxRollover({
    issueNumber: 2158,
    commentCount: CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS + 17,
    candidateSuccessorIssue: 3000,
    successorProvisioningEvidence: provisioningEvidence(3000),
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.state, 'SUCCESSOR_READY_FOR_ATOMIC_CUTOVER');
  assert.equal(plan.action, 'PREPARE_CANONICAL_AUTHORITY_MIGRATION');
  assert.deepEqual(plan.migrationTarget, {
    activeIssue: 3000,
    retiredIssues: [1507, 2158],
    preservesSingleCanonicalAuthority: true,
  });
  assert.deepEqual(plan.successorProvisioningEvidence, provisioningEvidence(3000));
  assert.equal(plan.successorProvisioningRequired, false);
  assert.equal(plan.mutationAllowed, false);
  assert.equal(plan.runtimeMutationAuthority, false);
  assert.equal(plan.mergeAuthority, false);
});

test('retired, foreign and invalid current mailbox identities fail closed with exact observed identity', () => {
  const retired = planCanonicalMailboxRollover({ issueNumber: 1507, commentCount: 1 });
  assert.equal(retired.ok, false);
  assert.equal(retired.blocker, 'CANONICAL_MAILBOX_ISSUE_RETIRED');
  assert.equal(retired.currentIssue, 1507);

  const foreign = planCanonicalMailboxRollover({ issueNumber: 9999, commentCount: 1 });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.blocker, 'CANONICAL_MAILBOX_ISSUE_MISMATCH');
  assert.equal(foreign.currentIssue, 9999);

  const invalid = planCanonicalMailboxRollover({ issueNumber: 0, commentCount: 1 });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.blocker, 'CANONICAL_MAILBOX_ISSUE_MISMATCH');
  assert.equal(invalid.currentIssue, 0);
});

test('invalid comment counts fail closed without proposing a successor', () => {
  const plan = planCanonicalMailboxRollover({ issueNumber: 2158, commentCount: -1, candidateSuccessorIssue: 3000 });
  assert.equal(plan.ok, false);
  assert.equal(plan.blocker, 'CANONICAL_MAILBOX_COMMENT_COUNT_INVALID');
  assert.equal(plan.action, 'NONE');
  assert.equal(plan.mutationAllowed, false);
});
