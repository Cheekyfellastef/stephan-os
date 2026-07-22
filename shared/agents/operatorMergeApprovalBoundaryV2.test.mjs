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
    'scripts/operator-protected-merge-head-status-v1.mjs',
    'scripts/independent-merge-security-review-v2.mjs',
    'shared/agents/operatorMergeBaseBindingV1.mjs',
    'shared/agents/operatorMergeHeadStatusV1.mjs',
  ]);
});

test('accepts bounded live v2 paths with exact-head merge, fixed status and read-only review', () => {
  const changedFiles = [...APPROVAL_BOUNDARY_PATHS_V2];
  const diff = [
    diffFor('scripts/operator-protected-merge-gate-v2.mjs', [
      "runRequired('gh', ['pr', 'merge', String(prNumber), '--match-head-commit', sourceHead]);",
    ]),
    diffFor('scripts/operator-protected-merge-head-status-v1.mjs', [
      "api(`repos/${owner}/${repo}/statuses/${sourceHead}`, { method: 'POST' });",
    ]),
    diffFor('scripts/independent-merge-security-review-v2.mjs', [
      "await postComment(owner, repo, prNumber, 'bounded receipt');",
    ]),
    diffFor('shared/agents/operatorMergeBaseBindingV1.mjs', [
      'return Object.freeze({ exactBaseSha });',
    ]),
    diffFor('shared/agents/operatorMergeHeadStatusV1.mjs', [
      'return Object.freeze({ sourceHead, context: OPERATOR_MERGE_HEAD_STATUS_CONTEXT });',
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

test('rejects unrelated mutation and arbitrary identity input in the head-status executor', () => {
  const path = 'scripts/operator-protected-merge-head-status-v1.mjs';
  const mutation = analyzeIndependentSecurityReviewV2({
    changedFiles: [path],
    diff: diffFor(path, ["runRequired('gh', ['pr', 'merge', String(prNumber)]);"]),
  });
  assert.ok(mutation.findings.some((item) => item.code === 'head-status-executor-gained-unrelated-mutation-authority'));
  const identity = analyzeIndependentSecurityReviewV2({
    changedFiles: [path],
    diff: diffFor(path, ['const sourceHead = process.env.HEAD_STATUS_SHA;']),
  });
  assert.ok(identity.findings.some((item) => item.code === 'head-status-executor-gained-arbitrary-identity-input'));
});

test('rejects mutation authority in the live v2 independent reviewer', () => {
  const path = 'scripts/independent-merge-security-review-v2.mjs';
  const result = analyzeIndependentSecurityReviewV2({
    changedFiles: [path],
    diff: diffFor(path, ["runRequired('gh', ['pr', 'merge', String(prNumber)]);"]),
  });
  assert.ok(result.findings.some((item) => item.code === 'independent-reviewer-v2-gained-mutation-authority'));
});

test('rejects command authority in pure exact-base and exact-head modules', () => {
  const basePath = 'shared/agents/operatorMergeBaseBindingV1.mjs';
  const base = analyzeIndependentSecurityReviewV2({
    changedFiles: [basePath],
    diff: diffFor(basePath, ["import { spawnSync } from 'node:child_process';"]),
  });
  assert.ok(base.findings.some((item) => item.code === 'base-binding-module-gained-command-authority'));
  const headPath = 'shared/agents/operatorMergeHeadStatusV1.mjs';
  const head = analyzeIndependentSecurityReviewV2({
    changedFiles: [headPath],
    diff: diffFor(headPath, ["import { spawnSync } from 'node:child_process';"]),
  });
  assert.ok(head.findings.some((item) => item.code === 'head-status-validator-gained-command-authority'));
});
