import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviderNeutralReviewReceipt } from './providerNeutralReviewV1.mjs';
import {
  buildProtectedApprovalReceipt,
  extractJsonObjects,
  findCleanSpecialistReview,
  validateExactHeadWorkflowRuns,
  validateProtectedEnvironment,
  validateProtectedOperatorMergeEvidence,
} from './operatorMergeApprovalGate.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const prNumber = 1600;
const sourceHead = 'a'.repeat(40);
const branch = 'fix/protected-operator-merge';

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

function specialistReview(overrides = {}) {
  return createProviderNeutralReviewReceipt({
    receiptId: 'review-pr1600-specialist-a',
    repository,
    issueNumber: 1568,
    prNumber,
    branch,
    sourceHead,
    reviewerId: 'independent-security-reviewer',
    reviewerClass: 'external-qualified',
    provider: 'chatgpt-github-independent',
    modelClass: 'gpt-5-6-thinking',
    reviewerSessionId: 'independent-review-session-1600',
    implementerProvider: 'chatgpt-github',
    implementerSessionId: 'implementation-session-1600',
    riskTier: 'high',
    assuranceMode: 'specialist',
    reviewScope: ['complete-diff', 'approval-boundary', 'exact-head'],
    findings: [],
    verdict: 'clean',
    timestampUtc: '2026-07-21T20:00:00.000Z',
    proofRefs: ['receipts/reviews/pr-1600-head-a'],
    quorumChecks: [],
    blocker: '',
    ...overrides,
  });
}

function markdownReceipt(receipt = specialistReview()) {
  return `## Provider-neutral review\n\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\``;
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
    reviewBodies: [markdownReceipt()],
    unresolvedThreadCount: 0,
    ...overrides,
  };
}

test('extracts bounded JSON review receipts and ignores malformed blocks', () => {
  const objects = extractJsonObjects(`${markdownReceipt()}\n\n\`\`\`json\n{not-json}\n\`\`\``);
  assert.equal(objects.length, 1);
  assert.equal(objects[0].sourceHead, sourceHead);
});

test('requires an exact protected environment with Stephan as reviewer and no admin bypass', () => {
  const ready = validateProtectedEnvironment(environment());
  assert.equal(ready.finalVerdict, 'PROTECTED_ENVIRONMENT_READY');

  const blocked = validateProtectedEnvironment(environment({
    can_admins_bypass: true,
    protection_rules: [],
  }));
  assert.equal(blocked.finalVerdict, 'PROTECTED_ENVIRONMENT_BLOCKED');
  assert.ok(blocked.blockers.includes('required-reviewer-rule-missing'));
  assert.ok(blocked.blockers.includes('environment-admin-bypass-not-disabled'));
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

test('accepts only a clean high-risk specialist provider-neutral review', () => {
  const ready = findCleanSpecialistReview([markdownReceipt()], {
    repository,
    prNumber,
    branch,
    expectedHead: sourceHead,
  });
  assert.equal(ready.finalVerdict, 'SPECIALIST_REVIEW_READY');

  const standardReceipt = specialistReview({ riskTier: 'standard', assuranceMode: 'independent' });
  const blocked = findCleanSpecialistReview([markdownReceipt(standardReceipt)], {
    repository,
    prNumber,
    branch,
    expectedHead: sourceHead,
  });
  assert.equal(blocked.finalVerdict, 'SPECIALIST_REVIEW_BLOCKED');
});

test('protected environment, trusted default-branch workflow, checks and specialist review form a ready gate', () => {
  const verdict = validateProtectedOperatorMergeEvidence(evidence());
  assert.equal(verdict.finalVerdict, 'PROTECTED_OPERATOR_MERGE_READY');
  assert.deepEqual(verdict.blockers, []);
});

test('caller-authored approval text cannot replace GitHub protected environment evidence', () => {
  const verdict = validateProtectedOperatorMergeEvidence(evidence({
    environment: {},
    reviewBodies: ['I approve PR #1600 at exact head ' + sourceHead + ' for merge.'],
  }));
  assert.equal(verdict.finalVerdict, 'PROTECTED_OPERATOR_MERGE_BLOCKED');
  assert.ok(verdict.blockers.includes('required-reviewer-rule-missing'));
  assert.ok(verdict.blockers.includes('clean-high-risk-specialist-review-missing'));
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

test('builds an exact-head GitHub Actions approval receipt only from ready evidence', () => {
  const verdict = validateProtectedOperatorMergeEvidence(evidence());
  const receipt = buildProtectedApprovalReceipt({
    verdict,
    workflowRunId: 12345,
    workflowRunAttempt: 1,
    approvedAtUtc: '2026-07-21T20:05:00.000Z',
  });
  assert.equal(receipt.prNumber, prNumber);
  assert.equal(receipt.sourceHead, sourceHead);
  assert.equal(receipt.environment, 'operator-merge-approval');
  assert.equal(receipt.mergeExecutionAuthority, 'github-actions-protected-environment-only');
  assert.equal(receipt.reusableAcrossHeads, false);
});
