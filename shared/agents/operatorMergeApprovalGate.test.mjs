import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviderNeutralReviewReceipt } from './providerNeutralReviewV1.mjs';
import {
  INDEPENDENT_REVIEW_JOB,
  INDEPENDENT_REVIEW_WORKFLOW_NAME,
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
  analyzeIndependentSecurityReview,
  buildProtectedApprovalReceipt,
  buildProtectedSecurityReviewReceipt,
  extractJsonObjects,
  parseIndependentReviewSessionId,
  projectProtectedApprovalReceiptForWorkspace,
  validateExactHeadWorkflowRuns,
  validateIndependentReviewWorkflowRun,
  validateProtectedEnvironment,
  validateProtectedApprovalReceipt,
  validateProtectedOperatorMergeEvidence,
  validateProtectedOperatorMergePrerequisites,
  validateTrustedProtectedReviewReceipt,
} from './operatorMergeApprovalGate.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const prNumber = 1600;
const sourceHead = 'a'.repeat(40);
const branch = 'fix/protected-operator-merge';
const operatorRunId = 12345;
const operatorRunAttempt = 1;
const reviewRunId = 67890;
const reviewRunAttempt = 2;

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

function cleanAnalysis() {
  return {
    finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_CLEAN',
    verdict: 'clean',
    findings: [],
    proofRefs: ['proofs/diff/complete', 'proofs/policy/green'],
  };
}

function protectedReview(overrides = {}) {
  return {
    ...buildProtectedSecurityReviewReceipt({
      repository,
      prNumber,
      branch,
      sourceHead,
      workflowRunId: reviewRunId,
      workflowRunAttempt: reviewRunAttempt,
      timestampUtc: '2026-07-21T20:00:00.000Z',
      analysis: cleanAnalysis(),
    }),
    ...overrides,
  };
}

function independentWorkflowRun(overrides = {}) {
  return {
    id: reviewRunId,
    run_attempt: reviewRunAttempt,
    name: INDEPENDENT_REVIEW_WORKFLOW_NAME,
    path: INDEPENDENT_REVIEW_WORKFLOW_PATH,
    event: 'pull_request_target',
    repository: { full_name: repository },
    status: 'completed',
    conclusion: 'success',
    pull_requests: [{ number: prNumber, head: { sha: sourceHead } }],
    ...overrides,
  };
}

function independentWorkflowJobs(overrides = {}) {
  return [{
    name: INDEPENDENT_REVIEW_JOB,
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  }];
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
    reviewerSessionId: `github-actions-independent-review-run-${reviewRunId}-attempt-${reviewRunAttempt}`,
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
    reviewWorkflowRun: independentWorkflowRun(),
    reviewWorkflowJobs: independentWorkflowJobs(),
    reviewWorkflowRunId: reviewRunId,
    reviewWorkflowRunAttempt: reviewRunAttempt,
    ...overrides,
  };
}

function cleanBoundaryDiff() {
  return [
    'diff --git a/scripts/operator-protected-merge-gate.mjs b/scripts/operator-protected-merge-gate.mjs',
    '--- a/scripts/operator-protected-merge-gate.mjs',
    '+++ b/scripts/operator-protected-merge-gate.mjs',
    '@@ -1 +1 @@',
    "+runRequired('gh', ['pr', 'merge', '1600', '--match-head-commit', sourceHead]);",
    'diff --git a/.github/workflows/operator-merge-approval-gate.yml b/.github/workflows/operator-merge-approval-gate.yml',
    '--- a/.github/workflows/operator-merge-approval-gate.yml',
    '+++ b/.github/workflows/operator-merge-approval-gate.yml',
    '@@ -1 +1,4 @@',
    '+ref: ${{ github.event.repository.default_branch }}',
    '+persist-credentials: false',
    'diff --git a/.github/workflows/independent-merge-security-review.yml b/.github/workflows/independent-merge-security-review.yml',
    '--- /dev/null',
    '+++ b/.github/workflows/independent-merge-security-review.yml',
    '@@ -0,0 +1,5 @@',
    '+pull_request_target:',
    '+ref: ${{ github.event.repository.default_branch }}',
    '+persist-credentials: false',
    '+contents: read',
    '+pull-requests: read',
    'diff --git a/scripts/independent-merge-security-review.mjs b/scripts/independent-merge-security-review.mjs',
    '--- /dev/null',
    '+++ b/scripts/independent-merge-security-review.mjs',
    '@@ -0,0 +1 @@',
    "+postComment('bounded receipt only');",
  ].join('\n');
}

const cleanBoundaryFiles = [
  'scripts/operator-protected-merge-gate.mjs',
  '.github/workflows/operator-merge-approval-gate.yml',
  '.github/workflows/independent-merge-security-review.yml',
  'scripts/independent-merge-security-review.mjs',
];

test('extracts bounded JSON receipts and parses independent run identity', () => {
  const receipt = protectedReview();
  const markdown = `## Trusted review\n\n\`\`\`json\n${JSON.stringify(receipt)}\n\`\`\`\n\n\`\`\`json\n{not-json}\n\`\`\``;
  const objects = extractJsonObjects(markdown);
  assert.equal(objects.length, 1);
  assert.equal(objects[0].sourceHead, sourceHead);
  assert.deepEqual(parseIndependentReviewSessionId(receipt.reviewerSessionId), {
    workflowRunId: reviewRunId,
    workflowRunAttempt: reviewRunAttempt,
  });
  assert.equal(parseIndependentReviewSessionId('controller-claimed-session'), null);
});

test('requires exactly Stephan as the sole protected environment reviewer', () => {
  const ready = validateProtectedEnvironment(environment());
  assert.equal(ready.finalVerdict, 'PROTECTED_ENVIRONMENT_READY');

  const extraUser = validateProtectedEnvironment(environment({
    protection_rules: [{
      type: 'required_reviewers',
      reviewers: [
        { type: 'User', reviewer: { login: 'Cheekyfellastef' } },
        { type: 'User', reviewer: { login: 'AnotherReviewer' } },
      ],
    }],
  }));
  assert.ok(extraUser.blockers.includes('required-reviewer-set-not-exact'));

  const team = validateProtectedEnvironment(environment({
    protection_rules: [{
      type: 'required_reviewers',
      reviewers: [
        { type: 'User', reviewer: { login: 'Cheekyfellastef' } },
        { type: 'Team', reviewer: { slug: 'release-managers' } },
      ],
    }],
  }));
  assert.ok(team.blockers.includes('required-reviewer-set-not-exact'));
});

test('requires every named workflow green on the exact head', () => {
  assert.equal(validateExactHeadWorkflowRuns(workflowRuns(), { expectedHead: sourceHead }).valid, true);
  const blocked = validateExactHeadWorkflowRuns(workflowRuns({
    'PR Clean Guard': { conclusion: 'failure' },
    'Build Stephanos UI': { head_sha: 'b'.repeat(40) },
  }), { expectedHead: sourceHead });
  assert.ok(blocked.blockers.includes('workflow-not-green:PR Clean Guard'));
  assert.ok(blocked.blockers.includes('workflow-head-mismatch:Build Stephanos UI'));
});

test('independent reviewer analyzes the complete diff and rejects operator-synthesized review', () => {
  const clean = analyzeIndependentSecurityReview({ changedFiles: cleanBoundaryFiles, diff: cleanBoundaryDiff() });
  assert.equal(clean.finalVerdict, 'INDEPENDENT_SECURITY_REVIEW_CLEAN');

  const bad = analyzeIndependentSecurityReview({
    changedFiles: cleanBoundaryFiles,
    diff: cleanBoundaryDiff().replace(
      "+runRequired('gh', ['pr', 'merge', '1600', '--match-head-commit', sourceHead]);",
      "+buildProtectedSecurityReviewReceipt({ sourceHead });\n+runRequired('gh', ['pr', 'merge', '1600', '--match-head-commit', sourceHead]);",
    ),
  });
  assert.equal(bad.finalVerdict, 'INDEPENDENT_SECURITY_REVIEW_FINDINGS');
  assert.ok(bad.findings.some((item) => item.code === 'operator-gate-synthesizes-review'));
});

test('independent reviewer rejects write authority and unsupported high-risk surfaces', () => {
  const bad = analyzeIndependentSecurityReview({
    changedFiles: ['.github/workflows/independent-merge-security-review.yml', 'scripts/windows/mutate-host.ps1'],
    diff: [
      'diff --git a/.github/workflows/independent-merge-security-review.yml b/.github/workflows/independent-merge-security-review.yml',
      '+++ b/.github/workflows/independent-merge-security-review.yml',
      '+pull_request_target:',
      '+ref: ${{ github.event.pull_request.head.sha }}',
      '+contents: write',
      'diff --git a/scripts/windows/mutate-host.ps1 b/scripts/windows/mutate-host.ps1',
      '+++ b/scripts/windows/mutate-host.ps1',
      '+Write-Host unsafe',
    ].join('\n'),
  });
  assert.ok(bad.findings.some((item) => item.code === 'independent-review-workflow-not-trusted'));
  assert.ok(bad.findings.some((item) => item.code === 'independent-reviewer-has-source-authority'));
  assert.ok(bad.findings.some((item) => item.code === 'unsupported-high-risk-surface'));
});

test('builds a clean high-risk receipt only from clean independent analysis', () => {
  const receipt = protectedReview();
  assert.equal(receipt.reviewerClass, 'external-qualified');
  assert.equal(receipt.assuranceMode, 'specialist');
  assert.equal(receipt.verdict, 'clean');
  assert.throws(() => buildProtectedSecurityReviewReceipt({
    repository,
    prNumber,
    branch,
    sourceHead,
    workflowRunId: reviewRunId,
    workflowRunAttempt: reviewRunAttempt,
    analysis: { finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_FINDINGS', verdict: 'findings', findings: [{}] },
  }));
});

test('requires the independent workflow path, job, run attempt, PR and head binding', () => {
  const ready = validateIndependentReviewWorkflowRun(independentWorkflowRun(), independentWorkflowJobs(), {
    repository,
    prNumber,
    expectedHead: sourceHead,
    workflowRunId: reviewRunId,
    workflowRunAttempt: reviewRunAttempt,
  });
  assert.equal(ready.finalVerdict, 'INDEPENDENT_REVIEW_WORKFLOW_READY');

  const blocked = validateIndependentReviewWorkflowRun(
    independentWorkflowRun({ path: '.github/workflows/other.yml', pull_requests: [{ number: prNumber, head: { sha: 'b'.repeat(40) } }] }),
    independentWorkflowJobs({ conclusion: 'failure' }),
    { repository, prNumber, expectedHead: sourceHead, workflowRunId: reviewRunId, workflowRunAttempt: reviewRunAttempt },
  );
  assert.ok(blocked.blockers.includes('independent-review-workflow-path-mismatch'));
  assert.ok(blocked.blockers.includes('independent-review-head-mismatch'));
  assert.ok(blocked.blockers.includes('independent-review-job-not-green'));
});

test('validates only a receipt bound to the independent review run', () => {
  const ready = validateTrustedProtectedReviewReceipt(protectedReview(), {
    repository,
    prNumber,
    branch,
    expectedHead: sourceHead,
    workflowRunId: reviewRunId,
    workflowRunAttempt: reviewRunAttempt,
  });
  assert.equal(ready.finalVerdict, 'TRUSTED_PROTECTED_REVIEW_READY');

  const forged = validateTrustedProtectedReviewReceipt(forgedCommentReview(), {
    repository,
    prNumber,
    branch,
    expectedHead: sourceHead,
    workflowRunId: reviewRunId,
    workflowRunAttempt: reviewRunAttempt,
  });
  assert.ok(forged.blockers.includes('protected-reviewer-id-mismatch'));
  assert.ok(forged.blockers.includes('protected-review-provider-mismatch'));

  const stale = validateTrustedProtectedReviewReceipt(protectedReview(), {
    repository,
    prNumber,
    branch,
    expectedHead: sourceHead,
    workflowRunId: reviewRunId + 1,
    workflowRunAttempt: 1,
  });
  assert.ok(stale.blockers.includes('protected-review-workflow-session-mismatch'));
});

test('operator prerequisites do not mint or imply a security review', () => {
  const prerequisites = validateProtectedOperatorMergePrerequisites(evidence({
    trustedReviewReceipt: undefined,
    reviewWorkflowRun: undefined,
    reviewWorkflowJobs: undefined,
  }));
  assert.equal(prerequisites.finalVerdict, 'PROTECTED_OPERATOR_PREREQUISITES_READY');
  assert.equal(Object.hasOwn(prerequisites, 'review'), false);
});

test('independent review plus protected operator approval forms the ready gate', () => {
  const verdict = validateProtectedOperatorMergeEvidence(evidence());
  assert.equal(verdict.finalVerdict, 'PROTECTED_OPERATOR_MERGE_READY');
  assert.deepEqual(verdict.blockers, []);
});

test('missing independent workflow evidence, draft movement and unresolved threads fail closed', () => {
  const verdict = validateProtectedOperatorMergeEvidence(evidence({
    pullRequest: {
      number: prNumber,
      state: 'open',
      draft: true,
      head: { sha: 'b'.repeat(40), ref: branch },
      base: { ref: 'main' },
    },
    reviewWorkflowRun: {},
    reviewWorkflowJobs: [],
    unresolvedThreadCount: 1,
  }));
  assert.equal(verdict.finalVerdict, 'PROTECTED_OPERATOR_MERGE_BLOCKED');
  assert.ok(verdict.blockers.includes('pull-request-still-draft'));
  assert.ok(verdict.blockers.includes('pull-request-head-mismatch'));
  assert.ok(verdict.blockers.includes('independent-review-workflow-path-mismatch'));
  assert.ok(verdict.blockers.includes('unresolved-review-threads'));
});

test('builds an exact-head operator approval receipt only from ready separated evidence', () => {
  const verdict = validateProtectedOperatorMergeEvidence(evidence());
  const receipt = buildProtectedApprovalReceipt({
    verdict,
    workflowRunId: operatorRunId,
    workflowRunAttempt: operatorRunAttempt,
    approvedAtUtc: '2026-07-21T20:05:00.000Z',
  });
  assert.equal(receipt.prNumber, prNumber);
  assert.equal(receipt.sourceHead, sourceHead);
  assert.equal(receipt.workflowRunId, operatorRunId);
  assert.equal(receipt.mergeExecutionAuthority, 'github-actions-protected-environment-only');
  assert.equal(receipt.reusableAcrossHeads, false);
  assert.equal(receipt.protectionBoundary, 'github-protected-environment:operator-merge-approval');
  assert.equal(validateProtectedApprovalReceipt(receipt, {
    nowUtc: '2026-07-21T20:06:00.000Z',
  }).valid, true);
  for (const invalid of [
    { schemaVersion: 'self-attested.approval.v1' },
    { requiredReviewer: 'untrusted-writer' },
    { workflowPath: '.github/workflows/untrusted.yml' },
    { workflowRunId: null },
    { approvedAtUtc: 'not-a-time' },
    { approvedAtUtc: '2099-01-01T00:00:00.000Z' },
    { mergeExecutionAuthority: 'caller' },
    { reusableAcrossHeads: true },
  ]) {
    assert.equal(validateProtectedApprovalReceipt({
      ...receipt,
      ...invalid,
    }, {
      nowUtc: '2026-07-21T20:06:00.000Z',
    }).valid, false);
  }
  const workspaceProjection = projectProtectedApprovalReceiptForWorkspace(receipt, {
    nowUtc: '2026-07-21T20:06:00.000Z',
  });
  assert.equal(workspaceProjection.valid, true);
  assert.equal(Object.hasOwn(workspaceProjection.receipt, 'environment'), false);
  assert.equal(
    workspaceProjection.receipt.protectionBoundary,
    'github-protected-environment:operator-merge-approval',
  );
  assert.equal(validateProtectedApprovalReceipt(workspaceProjection.receipt, {
    nowUtc: '2026-07-21T20:06:00.000Z',
  }).valid, true);
});
