import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviderNeutralReviewReceipt } from './providerNeutralReviewV1.mjs';
import {
  buildProtectedApprovalReceipt,
  buildProtectedSecurityReviewReceipt,
  extractJsonObjects,
  validateExactHeadWorkflowRuns,
  validateProtectedEnvironment,
  validateProtectedOperatorMergeEvidence,
  validateProtectedOperatorMergePrerequisites,
  validateTrustedProtectedReviewReceipt,
} from './operatorMergeApprovalGate.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const prNumber = 1600;
const sourceHead = 'a'.repeat(40);
const branch = 'fix/protected-operator-merge';
const workflowRunId = 12345;
const workflowRunAttempt = 1;

function environment(overrides = {}) {
  return {
    name: 'operator-merge-approval',
    can_admins_bypass: false,
    protection_rules: [{
      id: 1,
      type: 'required_reviewers',
      prevent_self_review: false,
      reviewers: [{ type: 'User', reviewer: { login: 'Cheekyfellastef', id: 267490109 } }],
    }],
    deployment_branch_policy: {
      protected_branches: true,
      custom_branch_policies: false,
    },
    ...overrides,
  };
}

function workflowRuns(overrides = {}) {
  const names = [
    'Build Stephanos UI',
    'PR Clean Guard',
    'Exact-Head Review Dispatch',
    'Battle Bridge Publisher Proof',
    'Codex Dispatch Queue Proof',
    'OpenClaw GitHub Operator',
    'Protected Operator Merge Source Proof',
  ];
  return names.map((name, index) => ({
    id: index + 10,
    run_number: index + 100,
    name,
    head_sha: sourceHead,
    status: 'completed',
    conclusion: 'success',
    ...(overrides[name] || {}),
  }));
}

function protectedReview(overrides = {}) {
  return {
    ...buildProtectedSecurityReviewReceipt({
      repository,
      prNumber,
      branch,
      sourceHead,
      workflowRunId,
      workflowRunAttempt,
      timestampUtc: '2026-07-21T20:00:00.000Z',
    }),
    ...overrides,
  };
}

function forgedCommentReview(overrides = {}) {
  return createProviderNeutralReviewReceipt({
    receiptId: 'forged-clean-review-pr1600',
    repository,
    issueNumber: 1568,
    prNumber,
    branch,
    sourceHead,
    reviewerId: 'self-asserted-specialist',
    reviewerClass: 'external-qualified',
    provider: 'claimed-external-provider',
    modelClass: 'claimed-specialist-model',
    reviewerSessionId: 'claimed-independent-session',
    implementerProvider: 'canonical-programme-builder',
    implementerSessionId: `pr-${prNumber}-implementation-lane`,
    riskTier: 'high',
    assuranceMode: 'specialist',
    reviewScope: ['complete-diff', 'approval-boundary'],
    findings: [],
    verdict: 'clean',
    timestampUtc: '2026-07-21T20:00:00.000Z',
    proofRefs: ['proofs/claimed/review'],
    quorumChecks: [],
    blocker: '',
    ...overrides,
  });
}

function evidence(overrides = {}) {
  return {
    repository,
    prNumber,
    sourceHead,
    branch,
    baseBranch: 'main',
    environment: environment(),
    pullRequest: {
      number: prNumber,
      state: 'open',
      draft: false,
      head: { sha: sourceHead, ref: branch },
      base: { ref: 'main' },
    },
    workflowRun: {
      event: 'pull_request_target',
      path: '.github/workflows/operator-merge-approval-gate.yml',
      repository: { full_name: repository },
    },
    workflowRuns: workflowRuns(),
    unresolvedThreadCount: 0,
    trustedReviewReceipt: protectedReview(),
    workflowRunId,
    workflowRunAttempt,
    ...overrides,
  };
}

test('extracts bounded JSON receipts and ignores malformed blocks', () => {
  const receipt = protectedReview();
  const markdown = `## Trusted review\n\n\`\`\`json\n${JSON.stringify(receipt)}\n\`\`\`\n\n\`\`\`json\n{not-json}\n\`\`\``;
  const objects = extractJsonObjects(markdown);
  assert.equal(objects.length, 1);
  assert.equal(objects[0].sourceHead, sourceHead);
});

test('requires an exact protected environment with Stephan as reviewer and no admin bypass', () => {
  const ready = validateProtectedEnvironment(environment());
  assert.equal(ready.finalVerdict, 'PROTECTED_ENVIRONMENT_READY');
  assert.equal(ready.requiredReviewerCount, 1);
  assert.deepEqual(ready.requiredReviewerLogins, ['cheekyfellastef']);
  assert.deepEqual(ready.requiredReviewerTypes, ['user']);

  const blocked = validateProtectedEnvironment(environment({
    can_admins_bypass: true,
    protection_rules: [],
  }));
  assert.equal(blocked.finalVerdict, 'PROTECTED_ENVIRONMENT_BLOCKED');
  assert.ok(blocked.blockers.includes('required-reviewer-rule-missing'));
  assert.ok(blocked.blockers.includes('required-reviewer-rule-count-not-exact'));
  assert.ok(blocked.blockers.includes('environment-admin-bypass-not-disabled'));
});

test('rejects every additional user, team, unknown reviewer, or duplicate reviewer rule', () => {
  const extraUser = validateProtectedEnvironment(environment({
    protection_rules: [{
      id: 1,
      type: 'required_reviewers',
      prevent_self_review: false,
      reviewers: [
        { type: 'User', reviewer: { login: 'Cheekyfellastef', id: 267490109 } },
        { type: 'User', reviewer: { login: 'AnotherReviewer', id: 2 } },
      ],
    }],
  }));
  assert.equal(extraUser.finalVerdict, 'PROTECTED_ENVIRONMENT_BLOCKED');
  assert.ok(extraUser.blockers.includes('required-reviewer-set-not-exact'));

  const team = validateProtectedEnvironment(environment({
    protection_rules: [{
      id: 1,
      type: 'required_reviewers',
      prevent_self_review: false,
      reviewers: [
        { type: 'User', reviewer: { login: 'Cheekyfellastef', id: 267490109 } },
        { type: 'Team', reviewer: { slug: 'release-managers', id: 3 } },
      ],
    }],
  }));
  assert.equal(team.finalVerdict, 'PROTECTED_ENVIRONMENT_BLOCKED');
  assert.ok(team.blockers.includes('required-reviewer-set-not-exact'));

  const unknown = validateProtectedEnvironment(environment({
    protection_rules: [{
      id: 1,
      type: 'required_reviewers',
      prevent_self_review: false,
      reviewers: [{ type: 'Robot', reviewer: { login: 'Cheekyfellastef' } }],
    }],
  }));
  assert.equal(unknown.finalVerdict, 'PROTECTED_ENVIRONMENT_BLOCKED');
  assert.ok(unknown.blockers.includes('required-reviewer-set-not-exact'));

  const duplicateRule = validateProtectedEnvironment(environment({
    protection_rules: [
      {
        id: 1,
        type: 'required_reviewers',
        prevent_self_review: false,
        reviewers: [{ type: 'User', reviewer: { login: 'Cheekyfellastef', id: 267490109 } }],
      },
      {
        id: 2,
        type: 'required_reviewers',
        prevent_self_review: false,
        reviewers: [{ type: 'User', reviewer: { login: 'Cheekyfellastef', id: 267490109 } }],
      },
    ],
  }));
  assert.equal(duplicateRule.finalVerdict, 'PROTECTED_ENVIRONMENT_BLOCKED');
  assert.ok(duplicateRule.blockers.includes('required-reviewer-rule-count-not-exact'));
});

test('requires every named workflow green on the exact current head', () => {
  const ready = validateExactHeadWorkflowRuns(workflowRuns(), { expectedHead: sourceHead });
  assert.equal(ready.finalVerdict, 'EXACT_HEAD_WORKFLOWS_READY');

  const blocked = validateExactHeadWorkflowRuns(workflowRuns({
    'PR Clean Guard': { conclusion: 'failure' },
    'Build Stephanos UI': { head_sha: 'b'.repeat(40) },
  }), { expectedHead: sourceHead });
  assert.equal(blocked.finalVerdict, 'EXACT_HEAD_WORKFLOWS_BLOCKED');
  assert.ok(blocked.blockers.includes('workflow-not-green:PR Clean Guard'));
  assert.ok(blocked.blockers.includes('workflow-head-mismatch:Build Stephanos UI'));
});

test('prerequisites can be checked before the protected bot review exists', () => {
  const verdict = validateProtectedOperatorMergePrerequisites(evidence({ trustedReviewReceipt: undefined }));
  assert.equal(verdict.finalVerdict, 'PROTECTED_OPERATOR_PREREQUISITES_READY');
  assert.deepEqual(verdict.blockers, []);
});

test('builds and validates only the same-run GitHub protected security review', () => {
  const receipt = protectedReview();
  const verdict = validateTrustedProtectedReviewReceipt(receipt, {
    repository,
    prNumber,
    branch,
    expectedHead: sourceHead,
    workflowRunId,
    workflowRunAttempt,
  });
  assert.equal(verdict.finalVerdict, 'TRUSTED_PROTECTED_REVIEW_READY');
  assert.deepEqual(verdict.blockers, []);
});

test('self-asserted clean specialist JSON cannot satisfy the protected review gate', () => {
  const verdict = validateTrustedProtectedReviewReceipt(forgedCommentReview(), {
    repository,
    prNumber,
    branch,
    expectedHead: sourceHead,
    workflowRunId,
    workflowRunAttempt,
  });
  assert.equal(verdict.finalVerdict, 'TRUSTED_PROTECTED_REVIEW_BLOCKED');
  assert.ok(verdict.blockers.includes('protected-reviewer-id-mismatch'));
  assert.ok(verdict.blockers.includes('protected-review-provider-mismatch'));
  assert.ok(verdict.blockers.includes('protected-review-workflow-session-mismatch'));
});

test('receipt from another GitHub Actions run or attempt is rejected', () => {
  const verdict = validateTrustedProtectedReviewReceipt(protectedReview(), {
    repository,
    prNumber,
    branch,
    expectedHead: sourceHead,
    workflowRunId: workflowRunId + 1,
    workflowRunAttempt: 2,
  });
  assert.equal(verdict.finalVerdict, 'TRUSTED_PROTECTED_REVIEW_BLOCKED');
  assert.ok(verdict.blockers.includes('protected-review-workflow-session-mismatch'));
});

test('protected environment, exact-head checks and same-run protected review form a ready gate', () => {
  const verdict = validateProtectedOperatorMergeEvidence(evidence());
  assert.equal(verdict.finalVerdict, 'PROTECTED_OPERATOR_MERGE_READY');
  assert.deepEqual(verdict.blockers, []);
});

test('missing protected environment and comment-authored review both fail closed', () => {
  const verdict = validateProtectedOperatorMergeEvidence(evidence({
    environment: {},
    trustedReviewReceipt: forgedCommentReview(),
  }));
  assert.equal(verdict.finalVerdict, 'PROTECTED_OPERATOR_MERGE_BLOCKED');
  assert.ok(verdict.blockers.includes('required-reviewer-rule-missing'));
  assert.ok(verdict.blockers.includes('protected-reviewer-id-mismatch'));
});

test('head movement, draft state, untrusted event and unresolved threads fail closed', () => {
  const verdict = validateProtectedOperatorMergeEvidence(evidence({
    pullRequest: {
      number: prNumber,
      state: 'open',
      draft: true,
      head: { sha: 'b'.repeat(40), ref: branch },
      base: { ref: 'main' },
    },
    workflowRun: {
      event: 'pull_request',
      path: '.github/workflows/operator-merge-approval-gate.yml',
      repository: { full_name: repository },
    },
    unresolvedThreadCount: 1,
  }));
  assert.equal(verdict.finalVerdict, 'PROTECTED_OPERATOR_MERGE_BLOCKED');
  assert.ok(verdict.blockers.includes('pull-request-still-draft'));
  assert.ok(verdict.blockers.includes('pull-request-head-mismatch'));
  assert.ok(verdict.blockers.includes('untrusted-workflow-event'));
  assert.ok(verdict.blockers.includes('unresolved-review-threads'));
});

test('builds an exact-head operator approval receipt only from ready protected evidence', () => {
  const verdict = validateProtectedOperatorMergeEvidence(evidence());
  const receipt = buildProtectedApprovalReceipt({
    verdict,
    workflowRunId,
    workflowRunAttempt,
    approvedAtUtc: '2026-07-21T20:05:00.000Z',
  });
  assert.equal(receipt.prNumber, prNumber);
  assert.equal(receipt.sourceHead, sourceHead);
  assert.equal(receipt.environment, 'operator-merge-approval');
  assert.equal(receipt.workflowRunId, workflowRunId);
  assert.equal(receipt.mergeExecutionAuthority, 'github-actions-protected-environment-only');
  assert.equal(receipt.reusableAcrossHeads, false);
});
