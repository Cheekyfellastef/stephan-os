import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createProviderNeutralReviewReceipt } from './providerNeutralReviewV1.mjs';
import {
  INDEPENDENT_REVIEW_JOB,
  INDEPENDENT_REVIEW_WORKFLOW_NAME,
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
  REQUIRED_EXACT_HEAD_WORKFLOW_IDENTITIES,
  analyzeIndependentSecurityReview,
  bindRequiredExactHeadWorkflowIdentities,
  buildProtectedApprovalReceipt,
  buildProtectedSecurityReviewReceipt,
  extractJsonObjects,
  parseIndependentReviewSessionId,
  isApprovalBoundaryBootstrapAnalysis,
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
const baseSha = 'b'.repeat(40);
const branch = 'fix/protected-operator-merge';
const operatorRunId = 12345;
const operatorRunAttempt = 1;
const reviewRunId = 67890;
const reviewRunAttempt = 2;
const reviewWorkflowId = 6789;
const reviewArtifactId = 24680;
const reviewArtifactDigest = `sha256:${'c'.repeat(64)}`;
const reviewPayloadSha256 = 'd'.repeat(64);
const protectedWorkflowPaths = [
  '.github/workflows/operator-merge-approval-gate.yml',
  '.github/workflows/independent-merge-security-review.yml',
];

function protectedWorkflowContent(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

function protectedWorkflowSource(path, content = protectedWorkflowContent(path), overrides = {}) {
  const size = Buffer.byteLength(content, 'utf8');
  const blobSha = createHash('sha1')
    .update(`blob ${size}\0`, 'utf8')
    .update(content, 'utf8')
    .digest('hex');
  return {
    schemaVersion: 'stephanos.protected-workflow-source.v1',
    repository,
    path,
    ref: sourceHead,
    exists: true,
    size,
    blobSha,
    content,
    ...overrides,
  };
}

function protectedWorkflowAnalysisEvidence(sourceOverrides = {}, paths = protectedWorkflowPaths) {
  return {
    repository,
    sourceHead,
    protectedWorkflowSources: paths.map((path) => {
      const content = Object.hasOwn(sourceOverrides, path)
        ? sourceOverrides[path]
        : protectedWorkflowContent(path);
      return protectedWorkflowSource(path, content);
    }),
  };
}

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
  return REQUIRED_EXACT_HEAD_WORKFLOW_IDENTITIES.map(({ name, path, event }, index) => ({
    id: index + 10,
    run_number: index + 100,
    workflow_id: index + 1000,
    name,
    path,
    event,
    repository: { full_name: repository },
    head_sha: sourceHead,
    status: 'completed',
    conclusion: 'success',
    pull_requests: [{
      number: prNumber,
      head: { sha: sourceHead, ref: branch },
      base: { sha: baseSha, ref: 'main' },
    }],
    ...(overrides[name] || {}),
  }));
}

function workflowDefinitions(overrides = {}) {
  return REQUIRED_EXACT_HEAD_WORKFLOW_IDENTITIES.map(({ name, path }, index) => ({
    id: index + 1000,
    name,
    path,
    state: 'active',
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

function bootstrapAnalysis(overrides = {}) {
  const findings = [{
    severity: 'P0',
    code: 'approval-boundary-v2-self-change-requires-qualified-review',
    summary: 'Protected policy source changed and requires the human-protected bootstrap gate.',
    path: 'shared/agents/operatorMergeApprovalGate.mjs',
  }];
  return {
    finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_FINDINGS',
    verdict: 'findings',
    findings,
    counts: { P0: findings.length, P1: 0, P2: 0 },
    proofRefs: ['proofs/diff/complete', 'proofs/policy/bootstrap'],
    ...overrides,
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
    workflow_id: reviewWorkflowId,
    name: INDEPENDENT_REVIEW_WORKFLOW_NAME,
    path: INDEPENDENT_REVIEW_WORKFLOW_PATH,
    event: 'pull_request_target',
    repository: { full_name: repository },
    status: 'completed',
    conclusion: 'success',
    pull_requests: [{
      number: prNumber,
      head: { sha: sourceHead, ref: branch },
      base: { sha: baseSha, ref: 'main' },
    }],
    ...overrides,
  };
}

function independentWorkflowJobs(overrides = {}) {
  return [{
    name: INDEPENDENT_REVIEW_JOB,
    run_attempt: reviewRunAttempt,
    run_url: `https://api.github.com/repos/${repository}/actions/runs/${reviewRunId}`,
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
    baseSha,
    branch,
    baseBranch: 'main',
    environment: environment(),
    pullRequest: {
      number: prNumber,
      state: 'open',
      draft: false,
      head: { sha: sourceHead, ref: branch },
      base: { ref: 'main', sha: baseSha },
    },
    workflowRun: {
      event: 'pull_request_target',
      path: '.github/workflows/operator-merge-approval-gate.yml',
      repository: { full_name: repository },
    },
    workflowDefinitions: workflowDefinitions(),
    workflowRuns: workflowRuns(),
    unresolvedThreadCount: 0,
    reviewDecision: null,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    trustedReviewReceipt: protectedReview(),
    reviewWorkflowRun: independentWorkflowRun(),
    reviewWorkflowJobs: independentWorkflowJobs(),
    reviewWorkflowId,
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
    '+ref: ${{ github.event.pull_request.base.sha }}',
    '+persist-credentials: false',
    'diff --git a/.github/workflows/independent-merge-security-review.yml b/.github/workflows/independent-merge-security-review.yml',
    '--- /dev/null',
    '+++ b/.github/workflows/independent-merge-security-review.yml',
    '@@ -0,0 +1,5 @@',
    '+pull_request_target:',
    '+ref: ${{ github.event.pull_request.base.sha }}',
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

test('requires exactly Stephan and the protected-branches-only environment mode', () => {
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

  const customBranchPolicy = validateProtectedEnvironment(environment({
    deployment_branch_policy: {
      protected_branches: false,
      custom_branch_policies: true,
    },
  }));
  assert.ok(customBranchPolicy.blockers.includes('environment-not-limited-to-protected-branches'));
});

test('normalizes only operator workflow path suffixes bound to the exact PR base', () => {
  const pullRequests = [{
    number: prNumber,
    head: { sha: sourceHead, ref: branch },
    base: { sha: baseSha, ref: 'main' },
  }];
  for (const path of [
    '.github/workflows/operator-merge-approval-gate.yml@main',
    `${repository}/.github/workflows/operator-merge-approval-gate.yml@refs/heads/main`,
  ]) {
    const verdict = validateProtectedOperatorMergePrerequisites(evidence({
      workflowRun: {
        event: 'pull_request_target',
        path,
        repository: { full_name: repository },
        pull_requests: pullRequests,
      },
    }));
    assert.equal(verdict.finalVerdict, 'PROTECTED_OPERATOR_PREREQUISITES_READY', path);
  }

  for (const path of [
    '.github/workflows/operator-merge-approval-gate.yml@refs/heads/release',
    '.github/workflows/operator-merge-approval-gate.yml@main@refs/heads/main',
  ]) {
    const verdict = validateProtectedOperatorMergePrerequisites(evidence({
      workflowRun: {
        event: 'pull_request_target',
        path,
        repository: { full_name: repository },
        pull_requests: pullRequests,
      },
    }));
    assert.ok(verdict.blockers.includes('untrusted-workflow-path'), path);
  }
});

test('requires every path/id/event/repository-bound workflow green on the exact head', () => {
  const binding = bindRequiredExactHeadWorkflowIdentities(workflowDefinitions(), { repository });
  assert.equal(binding.finalVerdict, 'REQUIRED_WORKFLOW_IDENTITIES_READY');
  assert.equal(validateExactHeadWorkflowRuns(workflowRuns(), {
    expectedHead: sourceHead,
    expectedPrNumber: prNumber,
    expectedBranch: branch,
    expectedBaseBranch: 'main',
    expectedBaseSha: baseSha,
    expectedWorkflowId: reviewWorkflowId,
    requiredIdentities: binding.identities,
  }).valid, true);
  const blocked = validateExactHeadWorkflowRuns(workflowRuns({
    'PR Clean Guard': { conclusion: 'failure' },
    'Build Stephanos UI': { head_sha: 'b'.repeat(40) },
  }), {
    expectedHead: sourceHead,
    expectedPrNumber: prNumber,
    expectedBranch: branch,
    expectedBaseBranch: 'main',
    expectedBaseSha: baseSha,
    requiredIdentities: binding.identities,
  });
  assert.ok(blocked.blockers.includes('workflow-not-green:PR Clean Guard'));
  assert.ok(blocked.blockers.includes('workflow-head-mismatch:Build Stephanos UI'));

  const spoofed = validateExactHeadWorkflowRuns([
    ...workflowRuns(),
    {
      ...workflowRuns()[0],
      id: 99999,
      run_number: 99999,
      workflow_id: 99999,
      path: '.github/workflows/untrusted-name-spoof.yml',
    },
  ], {
    expectedHead: sourceHead,
    expectedPrNumber: prNumber,
    expectedBranch: branch,
    expectedBaseBranch: 'main',
    expectedBaseSha: baseSha,
    requiredIdentities: binding.identities,
  });
  assert.ok(spoofed.blockers.includes('workflow-identity-spoof:Build Stephanos UI'));

  for (const override of [
    { workflow_id: 99999 },
    { event: 'workflow_dispatch' },
    { repository: { full_name: 'other/repository' } },
    { path: '.github/workflows/untrusted-name-spoof.yml' },
  ]) {
    const identityMismatch = validateExactHeadWorkflowRuns(workflowRuns({
      'Build Stephanos UI': override,
    }), {
      expectedHead: sourceHead,
      expectedPrNumber: prNumber,
      expectedBranch: branch,
      expectedBaseBranch: 'main',
      expectedBaseSha: baseSha,
      expectedWorkflowId: reviewWorkflowId,
      requiredIdentities: binding.identities,
    });
    assert.ok(identityMismatch.blockers.includes('workflow-identity-spoof:Build Stephanos UI'));
  }

  const documentedFullPath = validateExactHeadWorkflowRuns(workflowRuns({
    'Build Stephanos UI': {
      path: `${repository}/.github/workflows/build-stephanos-ui.yml@refs/pull/${prNumber}/merge`,
    },
  }), {
    expectedHead: sourceHead,
    expectedPrNumber: prNumber,
    expectedBranch: branch,
    expectedBaseBranch: 'main',
    expectedBaseSha: baseSha,
    expectedWorkflowId: reviewWorkflowId,
    requiredIdentities: binding.identities,
  });
  assert.equal(documentedFullPath.valid, true);
  for (const suffix of [branch, `refs/heads/${branch}`, 'main', 'refs/heads/main']) {
    const documentedShortOrBranchPath = validateExactHeadWorkflowRuns(workflowRuns({
      'Build Stephanos UI': {
        path: `.github/workflows/build-stephanos-ui.yml@${suffix}`,
      },
    }), {
      expectedHead: sourceHead,
      expectedPrNumber: prNumber,
      expectedBranch: branch,
      expectedBaseBranch: 'main',
      expectedBaseSha: baseSha,
      requiredIdentities: binding.identities,
    });
    assert.equal(documentedShortOrBranchPath.valid, true, suffix);
  }

  for (const path of [
    `${repository}/.github/workflows/build-stephanos-ui.yml@refs/pull/9999/merge`,
    `${repository}/.github/workflows/build-stephanos-ui.yml@refs/heads/unrelated`,
  ]) {
    const invalidSuffix = validateExactHeadWorkflowRuns(workflowRuns({
      'Build Stephanos UI': { path },
    }), {
      expectedHead: sourceHead,
      expectedPrNumber: prNumber,
      expectedBranch: branch,
      expectedBaseBranch: 'main',
      expectedBaseSha: baseSha,
      requiredIdentities: binding.identities,
    });
    assert.ok(invalidSuffix.blockers.includes('workflow-identity-spoof:Build Stephanos UI'));
  }

  const wrongPullRequestBinding = validateExactHeadWorkflowRuns(workflowRuns({
    'Build Stephanos UI': {
      pull_requests: [{
        number: 9999,
        head: { sha: sourceHead, ref: 'wrong/head-branch' },
        base: { sha: 'c'.repeat(40), ref: 'wrong-base' },
      }],
    },
  }), {
    expectedHead: sourceHead,
    expectedPrNumber: prNumber,
    expectedBranch: branch,
    expectedBaseBranch: 'main',
    expectedBaseSha: baseSha,
    requiredIdentities: binding.identities,
  });
  assert.ok(wrongPullRequestBinding.blockers.includes('workflow-pr-binding-mismatch:Build Stephanos UI'));
  assert.ok(wrongPullRequestBinding.blockers.includes('workflow-pr-head-mismatch:Build Stephanos UI'));
  assert.ok(wrongPullRequestBinding.blockers.includes('workflow-head-branch-mismatch:Build Stephanos UI'));
  assert.ok(wrongPullRequestBinding.blockers.includes('workflow-base-branch-mismatch:Build Stephanos UI'));
  assert.ok(wrongPullRequestBinding.blockers.includes('workflow-base-sha-mismatch:Build Stephanos UI'));

  const duplicateDefinition = bindRequiredExactHeadWorkflowIdentities([
    ...workflowDefinitions(),
    {
      id: 99999,
      name: 'Build Stephanos UI',
      path: '.github/workflows/untrusted-name-spoof.yml',
      state: 'active',
    },
  ], { repository });
  assert.ok(duplicateDefinition.blockers.includes(
    'required-workflow-definition-name-ambiguous:Build Stephanos UI',
  ));
});

test('independent reviewer analyzes the complete diff and rejects operator-synthesized review', () => {
  const clean = analyzeIndependentSecurityReview({
    changedFiles: cleanBoundaryFiles,
    diff: cleanBoundaryDiff(),
    ...protectedWorkflowAnalysisEvidence(),
  });
  assert.equal(clean.finalVerdict, 'INDEPENDENT_SECURITY_REVIEW_CLEAN');

  const movingTrustedSource = analyzeIndependentSecurityReview({
    changedFiles: cleanBoundaryFiles,
    diff: cleanBoundaryDiff(),
    ...protectedWorkflowAnalysisEvidence(Object.fromEntries(protectedWorkflowPaths.map((path) => [
      path,
      protectedWorkflowContent(path)
        .replaceAll('github.event.pull_request.base.sha', 'github.event.repository.default_branch')
        .replaceAll('github.event.merge_group.base_sha', 'github.event.repository.default_branch'),
    ]))),
  });
  assert.ok(movingTrustedSource.findings.some((item) => (
    item.code === 'write-workflow-does-not-use-trusted-source'
  )));
  assert.ok(movingTrustedSource.findings.some((item) => (
    item.code === 'independent-review-workflow-not-trusted'
  )));

  const bad = analyzeIndependentSecurityReview({
    changedFiles: cleanBoundaryFiles,
    diff: cleanBoundaryDiff().replace(
      "+runRequired('gh', ['pr', 'merge', '1600', '--match-head-commit', sourceHead]);",
      "+buildProtectedSecurityReviewReceipt({ sourceHead });\n+runRequired('gh', ['pr', 'merge', '1600', '--match-head-commit', sourceHead]);",
    ),
    ...protectedWorkflowAnalysisEvidence(),
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
    ...protectedWorkflowAnalysisEvidence({
      '.github/workflows/independent-merge-security-review.yml': protectedWorkflowContent(
        '.github/workflows/independent-merge-security-review.yml',
      )
        .replace('ref: ${{ github.event.pull_request.base.sha }}', 'ref: ${{ github.event.pull_request.head.sha }}')
        .replace('contents: read', 'contents: write'),
    }, ['.github/workflows/independent-merge-security-review.yml']),
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

test('permits only self-change findings through the human-protected bootstrap route', () => {
  const analysis = bootstrapAnalysis();
  assert.equal(isApprovalBoundaryBootstrapAnalysis(analysis), true);
  const receipt = buildProtectedSecurityReviewReceipt({
    repository,
    prNumber,
    branch,
    sourceHead,
    workflowRunId: reviewRunId,
    workflowRunAttempt: reviewRunAttempt,
    timestampUtc: '2026-07-21T20:00:00.000Z',
    analysis,
  });
  assert.equal(receipt.verdict, 'findings');
  assert.ok(receipt.reviewScope.includes('operator-protected-bootstrap-required'));
  const validation = validateTrustedProtectedReviewReceipt(receipt, {
    repository,
    prNumber,
    branch,
    expectedHead: sourceHead,
    workflowRunId: reviewRunId,
    workflowRunAttempt: reviewRunAttempt,
  });
  assert.equal(validation.valid, true);
  assert.equal(validation.operatorBootstrapRequired, true);
  assert.equal(validation.finalVerdict, 'TRUSTED_PROTECTED_BOOTSTRAP_REVIEW_READY');

  const mixed = bootstrapAnalysis({
    findings: [
      ...analysis.findings,
      {
        severity: 'P0',
        code: 'operator-v2-arbitrary-command-authority',
        summary: 'An unrelated security finding must remain blocking.',
        path: 'scripts/operator-protected-merge-gate-v2.mjs',
      },
    ],
    counts: { P0: 2, P1: 0, P2: 0 },
  });
  assert.equal(isApprovalBoundaryBootstrapAnalysis(mixed), false);
  assert.throws(() => buildProtectedSecurityReviewReceipt({
    repository,
    prNumber,
    branch,
    sourceHead,
    workflowRunId: reviewRunId,
    workflowRunAttempt: reviewRunAttempt,
    analysis: mixed,
  }));
});

test('requires the independent workflow path, job, run attempt, PR and head binding', () => {
  const ready = validateIndependentReviewWorkflowRun(independentWorkflowRun(), independentWorkflowJobs(), {
    repository,
    prNumber,
    expectedHead: sourceHead,
    expectedBranch: branch,
    expectedBaseBranch: 'main',
    expectedBaseSha: baseSha,
    expectedWorkflowId: reviewWorkflowId,
    workflowRunId: reviewRunId,
    workflowRunAttempt: reviewRunAttempt,
  });
  assert.equal(ready.finalVerdict, 'INDEPENDENT_REVIEW_WORKFLOW_READY');

  const blocked = validateIndependentReviewWorkflowRun(
    independentWorkflowRun({ path: '.github/workflows/other.yml', pull_requests: [{ number: prNumber, head: { sha: 'b'.repeat(40) } }] }),
    independentWorkflowJobs({ conclusion: 'failure' }),
    {
      repository,
      prNumber,
      expectedHead: sourceHead,
      expectedBranch: branch,
      expectedBaseBranch: 'main',
      expectedBaseSha: baseSha,
      expectedWorkflowId: reviewWorkflowId,
      workflowRunId: reviewRunId,
      workflowRunAttempt: reviewRunAttempt,
    },
  );
  assert.ok(blocked.blockers.includes('independent-review-workflow-path-mismatch'));
  assert.ok(blocked.blockers.includes('independent-review-head-mismatch'));
  assert.ok(blocked.blockers.includes('independent-review-job-not-green'));

  const documentedFullPath = validateIndependentReviewWorkflowRun(independentWorkflowRun({
    path: `${repository}/${INDEPENDENT_REVIEW_WORKFLOW_PATH}@refs/heads/main`,
  }), independentWorkflowJobs(), {
    repository,
    prNumber,
    expectedHead: sourceHead,
    expectedBranch: branch,
    expectedBaseBranch: 'main',
    expectedBaseSha: baseSha,
    expectedWorkflowId: reviewWorkflowId,
    workflowRunId: reviewRunId,
    workflowRunAttempt: reviewRunAttempt,
  });
  assert.equal(documentedFullPath.valid, true);
  assert.equal(validateIndependentReviewWorkflowRun(independentWorkflowRun({
    path: `${INDEPENDENT_REVIEW_WORKFLOW_PATH}@main`,
  }), independentWorkflowJobs(), {
    repository,
    prNumber,
    expectedHead: sourceHead,
    expectedBranch: branch,
    expectedBaseBranch: 'main',
    expectedBaseSha: baseSha,
    expectedWorkflowId: reviewWorkflowId,
    workflowRunId: reviewRunId,
    workflowRunAttempt: reviewRunAttempt,
  }).valid, true);

  for (const overrides of [
    { path: `${repository}/${INDEPENDENT_REVIEW_WORKFLOW_PATH}@refs/heads/unrelated` },
    { path: `${repository}/${INDEPENDENT_REVIEW_WORKFLOW_PATH}@refs/pull/${prNumber}/merge` },
    { pull_requests: [...independentWorkflowRun().pull_requests, ...independentWorkflowRun().pull_requests] },
  ]) {
    const invalidBinding = validateIndependentReviewWorkflowRun(
      independentWorkflowRun(overrides),
      independentWorkflowJobs(),
      {
        repository,
        prNumber,
        expectedHead: sourceHead,
        expectedBranch: branch,
        expectedBaseBranch: 'main',
        expectedBaseSha: baseSha,
        expectedWorkflowId: reviewWorkflowId,
        workflowRunId: reviewRunId,
        workflowRunAttempt: reviewRunAttempt,
      },
    );
    assert.equal(invalidBinding.valid, false);
  }

  const priorGreenCurrentFailed = validateIndependentReviewWorkflowRun(
    independentWorkflowRun(),
    [
      ...independentWorkflowJobs({ run_attempt: reviewRunAttempt - 1 }),
      ...independentWorkflowJobs({ conclusion: 'failure' }),
    ],
    {
      repository,
      prNumber,
      expectedHead: sourceHead,
      expectedBranch: branch,
      expectedBaseBranch: 'main',
      expectedBaseSha: baseSha,
      expectedWorkflowId: reviewWorkflowId,
      workflowRunId: reviewRunId,
      workflowRunAttempt: reviewRunAttempt,
    },
  );
  assert.equal(priorGreenCurrentFailed.valid, false);
  assert.ok(priorGreenCurrentFailed.blockers.includes('independent-review-job-not-green'));

  const duplicateCurrentJobs = validateIndependentReviewWorkflowRun(
    independentWorkflowRun(),
    [...independentWorkflowJobs(), ...independentWorkflowJobs()],
    {
      repository,
      prNumber,
      expectedHead: sourceHead,
      expectedBranch: branch,
      expectedBaseBranch: 'main',
      expectedBaseSha: baseSha,
      expectedWorkflowId: reviewWorkflowId,
      workflowRunId: reviewRunId,
      workflowRunAttempt: reviewRunAttempt,
    },
  );
  assert.ok(duplicateCurrentJobs.blockers.includes('independent-review-job-count-not-one'));
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

test('operator prerequisites fail closed on review blockers and non-clean merge state', () => {
  const blocked = validateProtectedOperatorMergePrerequisites(evidence({
    reviewDecision: 'CHANGES_REQUESTED',
    mergeable: 'CONFLICTING',
    mergeStateStatus: 'DIRTY',
  }));
  assert.ok(blocked.blockers.includes('pull-request-review-decision-blocked'));
  assert.ok(blocked.blockers.includes('pull-request-not-mergeable'));
  assert.ok(blocked.blockers.includes('pull-request-merge-state-not-clean'));

  const missing = validateProtectedOperatorMergePrerequisites((() => {
    const input = evidence();
    delete input.reviewDecision;
    delete input.mergeable;
    delete input.mergeStateStatus;
    return input;
  })());
  assert.ok(missing.blockers.includes('pull-request-review-decision-missing'));
  assert.ok(missing.blockers.includes('pull-request-mergeable-evidence-missing'));
  assert.ok(missing.blockers.includes('pull-request-merge-state-evidence-missing'));
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
    independentReviewWorkflowRunId: reviewRunId,
    independentReviewWorkflowRunAttempt: reviewRunAttempt,
    independentReviewArtifactId: reviewArtifactId,
    independentReviewArtifactDigest: reviewArtifactDigest,
    independentReviewPayloadSha256: reviewPayloadSha256,
    approvedAtUtc: '2026-07-21T20:05:00.000Z',
  });
  assert.equal(receipt.prNumber, prNumber);
  assert.equal(receipt.sourceHead, sourceHead);
  assert.equal(receipt.workflowRunId, operatorRunId);
  assert.equal(receipt.independentReviewWorkflowRunId, reviewRunId);
  assert.equal(receipt.independentReviewWorkflowRunAttempt, reviewRunAttempt);
  assert.equal(receipt.independentReviewArtifactId, reviewArtifactId);
  assert.equal(receipt.independentReviewArtifactDigest, reviewArtifactDigest);
  assert.equal(receipt.independentReviewPayloadSha256, reviewPayloadSha256);
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
  const selfAttestedProjection = projectProtectedApprovalReceiptForWorkspace(
    workspaceProjection.receipt,
    { nowUtc: '2026-07-21T20:06:00.000Z' },
  );
  assert.equal(selfAttestedProjection.valid, false);
  assert.ok(selfAttestedProjection.blockers.includes('approval-environment-provenance-missing'));
  assert.throws(() => buildProtectedApprovalReceipt({
    verdict,
    workflowRunId: operatorRunId,
    workflowRunAttempt: operatorRunAttempt,
    approvedAtUtc: '2026-07-21T20:05:00.000Z',
  }), /immutable independent-review artifact identity/);
});
