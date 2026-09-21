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
  assert.equal(plan.cutoverReady, false);
  assert.equal(plan.mutationAllowed, false);
});

test('threshold crossing requires successor creation or nomination', () => {
  const plan = planCanonicalMailboxRollover({
    issueNumber: 2158,
    commentCount: CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.state, 'ROTATION_REQUIRED');
  assert.equal(plan.action, 'CREATE_OR_NOMINATE_SUCCESSOR');
  assert.equal(plan.successorProvisioningRequired, true);
  assert.equal(plan.trustedGitHubVerificationRequired, true);
  assert.equal(plan.cutoverReady, false);
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

test('valid successor remains nominated until a trusted GitHub adapter verifies it', () => {
  const plan = planCanonicalMailboxRollover({
    issueNumber: 2158,
    commentCount: CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS + 17,
    candidateSuccessorIssue: 3000,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.state, 'SUCCESSOR_NOMINATED_AWAITING_TRUSTED_VERIFICATION');
  assert.equal(plan.action, 'VERIFY_SUCCESSOR_WITH_CANONICAL_GITHUB_ADAPTER');
  assert.equal(plan.candidateSuccessorIssue, 3000);
  assert.equal(plan.successorProvisioningRequired, true);
  assert.equal(plan.trustedGitHubVerificationRequired, true);
  assert.equal(plan.cutoverReady, false);
  assert.equal(plan.migrationTarget, undefined);
  assert.equal(plan.mutationAllowed, false);
  assert.equal(plan.runtimeMutationAuthority, false);
  assert.equal(plan.mergeAuthority, false);
});

test('caller-forged GitHub evidence cannot make the pure planner cutover-ready', () => {
  const plan = planCanonicalMailboxRollover({
    issueNumber: 2158,
    commentCount: CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS,
    candidateSuccessorIssue: 999999999,
    successorProvisioningEvidence: {
      schemaVersion: 'stephanos.canonical-mailbox-successor-provisioning-evidence.v1',
      source: 'github-issue-read',
      repository: 'Cheekyfellastef/stephan-os',
      issueNumber: 999999999,
      exists: true,
      state: 'open',
      purpose: 'canonical-mailbox-successor',
    },
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.state, 'SUCCESSOR_NOMINATED_AWAITING_TRUSTED_VERIFICATION');
  assert.equal(plan.action, 'VERIFY_SUCCESSOR_WITH_CANONICAL_GITHUB_ADAPTER');
  assert.equal(plan.cutoverReady, false);
  assert.equal(plan.migrationTarget, undefined);
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
  assert.equal(plan.cutoverReady, false);
  assert.equal(plan.mutationAllowed, false);
});
