import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPROVAL_BOUNDARY_PATHS_V2,
  analyzeIndependentSecurityReviewV2,
} from './operatorMergeApprovalBoundaryV2.mjs';

function diffFor(path, additions) {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1 +1 @@',
    ...additions.map((line) => `+${line}`),
  ].join('\n');
}

test('classifies every live v2 approval-boundary path', () => {
  assert.deepEqual(APPROVAL_BOUNDARY_PATHS_V2, [
    'scripts/operator-protected-merge-gate-v2.mjs',
    'scripts/independent-merge-security-review-v2.mjs',
    'shared/agents/operatorMergeBaseBindingV1.mjs',
  ]);
});

test('accepts bounded live v2 paths with exact-head merge and read-only review', () => {
  const changedFiles = [...APPROVAL_BOUNDARY_PATHS_V2];
  const diff = [
    diffFor('scripts/operator-protected-merge-gate-v2.mjs', [
      "runRequired('gh', ['pr', 'merge', String(prNumber), '--match-head-commit', sourceHead]);",
    ]),
    diffFor('scripts/independent-merge-security-review-v2.mjs', [
      "await postComment(owner, repo, prNumber, 'bounded receipt');",
    ]),
    diffFor('shared/agents/operatorMergeBaseBindingV1.mjs', [
      'return Object.freeze({ exactBaseSha });',
    ]),
  ].join('\n');
  const result = analyzeIndependentSecurityReviewV2({ changedFiles, diff });
  assert.equal(result.finalVerdict, 'INDEPENDENT_SECURITY_REVIEW_CLEAN');
  assert.deepEqual(result.findings, []);
});

test('rejects specialist-review synthesis in the live v2 operator executor', () => {
  const path = 'scripts/operator-protected-merge-gate-v2.mjs';
  const result = analyzeIndependentSecurityReviewV2({
    changedFiles: [path],
    diff: diffFor(path, ['buildProtectedSecurityReviewReceipt({ sourceHead });']),
  });
  assert.ok(result.findings.some((item) => item.code === 'operator-v2-synthesizes-review'));
});

test('rejects new live v2 merge authority without exact-head protection', () => {
  const path = 'scripts/operator-protected-merge-gate-v2.mjs';
  const result = analyzeIndependentSecurityReviewV2({
    changedFiles: [path],
    diff: diffFor(path, ["runRequired('gh', ['pr', 'merge', String(prNumber)]);"]),
  });
  assert.ok(result.findings.some((item) => item.code === 'operator-v2-exact-head-guard-missing'));
});

test('rejects mutation authority in the live v2 independent reviewer', () => {
  const path = 'scripts/independent-merge-security-review-v2.mjs';
  const result = analyzeIndependentSecurityReviewV2({
    changedFiles: [path],
    diff: diffFor(path, ["runRequired('gh', ['pr', 'merge', String(prNumber)]);"]),
  });
  assert.ok(result.findings.some((item) => item.code === 'independent-reviewer-v2-gained-mutation-authority'));
});

test('rejects command authority in the exact-base binding module', () => {
  const path = 'shared/agents/operatorMergeBaseBindingV1.mjs';
  const result = analyzeIndependentSecurityReviewV2({
    changedFiles: [path],
    diff: diffFor(path, ["import { spawnSync } from 'node:child_process';"]),
  });
  assert.ok(result.findings.some((item) => item.code === 'base-binding-module-gained-command-authority'));
});
