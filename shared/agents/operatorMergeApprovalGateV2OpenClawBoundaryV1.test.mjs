import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPENCLAW_REVIEWER_SPECIALIST_BOUNDARY_PATHS_V1,
  REVIEW_DISPATCH_IDENTITY_BOUNDARY_PATHS_V1,
  analyzeIndependentSecurityReview,
} from './operatorMergeApprovalGateV2.mjs';
import {
  APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE,
  isApprovalBoundaryBootstrapAnalysis,
} from './operatorMergeApprovalGate.mjs';

function diffFor(path) {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1 +1 @@',
    '+export const changed = true;',
  ].join('\n');
}

test('protects the exact OpenClaw reviewer-specialist composition boundary', () => {
  assert.deepEqual(OPENCLAW_REVIEWER_SPECIALIST_BOUNDARY_PATHS_V1, [
    'scripts/independent-merge-security-review-entry-v1.mjs',
    'scripts/independent-merge-security-review-with-openclaw-specialist-v1.mjs',
    'shared/agents/openClawBuilderProviderSpecialistReviewV1.mjs',
    'shared/agents/openClawBuilderProviderSpecialistReviewV1.test.mjs',
    'shared/agents/openClawBuilderProviderSpecialistReviewLegacyV1.mjs',
    'shared/agents/openClawBuilderProviderSpecialistReviewSuccessorV1.mjs',
    'shared/agents/openClawBuilderProviderSpecialistReviewSuccessorV1.test.mjs',
  ]);

  for (const path of OPENCLAW_REVIEWER_SPECIALIST_BOUNDARY_PATHS_V1) {
    const result = analyzeIndependentSecurityReview({
      changedFiles: [path],
      diff: diffFor(path),
    });
    assert.ok(result.findings.some((item) => (
      item.code === APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE
      && item.path === path
    )), path);
    assert.equal(result.findings.some((item) => (
      item.code === 'unsupported-high-risk-surface'
      && item.path === path
    )), false, path);
    assert.equal(isApprovalBoundaryBootstrapAnalysis(result), true, path);
  }
});

test('protects exact workflow-dispatch review identity consumers as bootstrap boundaries', () => {
  assert.deepEqual(REVIEW_DISPATCH_IDENTITY_BOUNDARY_PATHS_V1, [
    'shared/agents/independentReviewWorkflowDispatchExecutionV1.mjs',
    'shared/agents/independentReviewWorkflowDispatchExecutionV1.test.mjs',
    'shared/agents/independentReviewWorkflowDispatchRunDiscoveryV1.mjs',
    'shared/agents/independentReviewWorkflowDispatchRunDiscoveryV1.test.mjs',
  ]);

  for (const path of REVIEW_DISPATCH_IDENTITY_BOUNDARY_PATHS_V1) {
    const result = analyzeIndependentSecurityReview({
      changedFiles: [path],
      diff: diffFor(path),
    });
    assert.ok(result.findings.some((item) => (
      item.code === APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE
      && item.path === path
    )), path);
    assert.equal(result.findings.some((item) => (
      item.code === 'unsupported-high-risk-surface'
      && item.path === path
    )), false, path);
    assert.equal(isApprovalBoundaryBootstrapAnalysis(result), true, path);
  }
});

test('combined workflow-dispatch identity self-change remains qualified bootstrap only', () => {
  const result = analyzeIndependentSecurityReview({
    changedFiles: [...REVIEW_DISPATCH_IDENTITY_BOUNDARY_PATHS_V1],
    diff: REVIEW_DISPATCH_IDENTITY_BOUNDARY_PATHS_V1.map(diffFor).join('\n'),
  });
  assert.equal(result.finalVerdict, 'INDEPENDENT_SECURITY_REVIEW_FINDINGS');
  assert.equal(result.counts.P0, REVIEW_DISPATCH_IDENTITY_BOUNDARY_PATHS_V1.length);
  assert.equal(result.counts.P1, 0);
  assert.equal(result.counts.P2, 0);
  assert.equal(result.findings.every((item) => (
    item.code === APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE
  )), true);
  assert.equal(isApprovalBoundaryBootstrapAnalysis(result), true);
});

test('combined OpenClaw reviewer-specialist self-change remains a qualified bootstrap, not a clean self-review', () => {
  const result = analyzeIndependentSecurityReview({
    changedFiles: [...OPENCLAW_REVIEWER_SPECIALIST_BOUNDARY_PATHS_V1],
    diff: OPENCLAW_REVIEWER_SPECIALIST_BOUNDARY_PATHS_V1.map(diffFor).join('\n'),
  });
  assert.equal(result.finalVerdict, 'INDEPENDENT_SECURITY_REVIEW_FINDINGS');
  assert.equal(result.counts.P0, OPENCLAW_REVIEWER_SPECIALIST_BOUNDARY_PATHS_V1.length);
  assert.equal(result.counts.P1, 0);
  assert.equal(result.counts.P2, 0);
  assert.equal(result.findings.every((item) => (
    item.code === APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE
  )), true);
  assert.equal(isApprovalBoundaryBootstrapAnalysis(result), true);
});

test('unrelated OpenClaw high-risk source remains unsupported and blocks bootstrap', () => {
  const unrelated = 'integrations/openclaw/arbitrary-provider/index.mjs';
  const result = analyzeIndependentSecurityReview({
    changedFiles: [
      'shared/agents/openClawBuilderProviderSpecialistReviewV1.mjs',
      unrelated,
    ],
    diff: [
      diffFor('shared/agents/openClawBuilderProviderSpecialistReviewV1.mjs'),
      diffFor(unrelated),
    ].join('\n'),
  });
  assert.ok(result.findings.some((item) => (
    item.code === APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE
    && item.path === 'shared/agents/openClawBuilderProviderSpecialistReviewV1.mjs'
  )));
  assert.ok(result.findings.some((item) => (
    item.code === 'unsupported-high-risk-surface'
    && item.path === unrelated
  )));
  assert.equal(isApprovalBoundaryBootstrapAnalysis(result), false);
});
