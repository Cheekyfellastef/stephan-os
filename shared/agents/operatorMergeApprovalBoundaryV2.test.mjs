import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  APPROVAL_BOUNDARY_PATHS_V2,
  analyzeIndependentSecurityReviewV2,
} from './operatorMergeApprovalBoundaryV2.mjs';
import { isApprovalBoundaryBootstrapAnalysis } from './operatorMergeApprovalGateV2.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const sourceHead = 'a'.repeat(40);
const protectedWorkflowPaths = [
  '.github/workflows/operator-merge-approval-gate.yml',
  '.github/workflows/independent-merge-security-review.yml',
];

function workflowContent(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

function workflowSource(path, overrides = {}) {
  const content = Object.hasOwn(overrides, 'content') ? overrides.content : workflowContent(path);
  const size = typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : 0;
  const blobSha = typeof content === 'string'
    ? createHash('sha1').update(`blob ${size}\0`, 'utf8').update(content, 'utf8').digest('hex')
    : null;
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

function workflowEvidence(paths = protectedWorkflowPaths) {
  return {
    repository,
    sourceHead,
    protectedWorkflowSources: paths.map((path) => workflowSource(path)),
  };
}

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
    '.github/workflows/operator-merge-approval-gate.yml',
    '.github/workflows/independent-merge-security-review.yml',
    '.github/workflows/build-stephanos-ui.yml',
    '.github/workflows/pr-clean.yml',
    '.github/workflows/exact-head-review-dispatch.yml',
    '.github/workflows/battle-bridge-publisher-proof.yml',
    '.github/workflows/codex-dispatch-queue-proof.yml',
    '.github/workflows/openclaw-github-operator.yml',
    '.github/workflows/operator-merge-approval-gate-test.yml',
    '.github/workflows/stephanos-deploy.yml',
    'scripts/operator-protected-merge-gate-v2.mjs',
    'scripts/independent-merge-security-review-v2.mjs',
    'shared/agents/operatorMergeApprovalGate.mjs',
    'shared/agents/operatorMergeApprovalGateV2.mjs',
    'shared/agents/operatorMergeApprovalBoundaryV2.mjs',
    'shared/agents/operatorMergeBaseBindingV1.mjs',
    'shared/agents/operatorMergeReviewArtifactV1.mjs',
    'shared/agents/providerNeutralReviewV1.mjs',
  ]);
});

test('fails closed when any live v2 boundary attempts to review itself', () => {
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
  const result = analyzeIndependentSecurityReviewV2({
    changedFiles,
    diff,
    ...workflowEvidence(),
  });
  assert.equal(result.finalVerdict, 'INDEPENDENT_SECURITY_REVIEW_FINDINGS');
  const selfChangeFindings = result.findings.filter((item) => (
    item.code === 'approval-boundary-v2-self-change-requires-qualified-review'
  ));
  assert.equal(selfChangeFindings.length, APPROVAL_BOUNDARY_PATHS_V2.length);
});

test('valid final exact-head workflow source prevents hunk-only false trust findings', () => {
  const path = '.github/workflows/independent-merge-security-review.yml';
  const finalContent = workflowContent(path).replace('timeout-minutes: 15', 'timeout-minutes: 16');
  const result = analyzeIndependentSecurityReviewV2({
    changedFiles: [{ filename: path, status: 'modified' }],
    diff: diffFor(path, ['timeout-minutes: 16']),
    repository,
    sourceHead,
    protectedWorkflowSources: [workflowSource(path, { content: finalContent })],
  });
  assert.equal(result.findings.filter((item) => (
    item.code === 'approval-boundary-v2-self-change-requires-qualified-review'
  )).length, 1);
  assert.equal(result.findings.some((item) => item.code === 'independent-review-workflow-not-trusted'), false);
  assert.equal(isApprovalBoundaryBootstrapAnalysis(result), true);
});

test('deleted or renamed-away protected workflows cannot pass bootstrap-only review', () => {
  const path = '.github/workflows/independent-merge-security-review.yml';
  const missingSource = workflowSource(path, {
    exists: false,
    size: 0,
    blobSha: null,
    content: null,
  });
  for (const [changedFiles, diff] of [
    [[{ filename: path, status: 'removed' }], [
      `diff --git a/${path} b/${path}`,
      'deleted file mode 100644',
      `--- a/${path}`,
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-name: Independent Merge Security Review',
    ].join('\n')],
    [[{
      filename: '.github/workflows/independent-review-untrusted.yml',
      previous_filename: path,
      status: 'renamed',
    }], [
      `diff --git a/${path} b/.github/workflows/independent-review-untrusted.yml`,
      'similarity index 100%',
      `rename from ${path}`,
      'rename to .github/workflows/independent-review-untrusted.yml',
    ].join('\n')],
  ]) {
    const result = analyzeIndependentSecurityReviewV2({
      changedFiles,
      diff,
      repository,
      sourceHead,
      protectedWorkflowSources: [missingSource],
    });
    assert.ok(result.findings.some((item) => item.code === 'protected-workflow-final-source-missing'));
    assert.equal(isApprovalBoundaryBootstrapAnalysis(result), false);
  }
});

test('protected workflow evidence is bound to exact ref, size, blob and least-authority permissions', () => {
  const path = '.github/workflows/independent-merge-security-review.yml';
  const changedFiles = [{ filename: path, status: 'modified' }];
  const diff = diffFor(path, ['timeout-minutes: 16']);
  for (const source of [
    workflowSource(path, { ref: 'b'.repeat(40) }),
    workflowSource(path, { size: 1 }),
    workflowSource(path, { blobSha: 'c'.repeat(40) }),
  ]) {
    const result = analyzeIndependentSecurityReviewV2({
      changedFiles,
      diff,
      repository,
      sourceHead,
      protectedWorkflowSources: [source],
    });
    assert.ok(result.findings.some((item) => item.code === 'protected-workflow-source-evidence-invalid'));
    assert.equal(isApprovalBoundaryBootstrapAnalysis(result), false);
  }

  const excessiveAuthority = workflowContent(path).replace('pull-requests: read', 'pull-requests: write');
  const permissionResult = analyzeIndependentSecurityReviewV2({
    changedFiles,
    diff,
    repository,
    sourceHead,
    protectedWorkflowSources: [workflowSource(path, { content: excessiveAuthority })],
  });
  assert.ok(permissionResult.findings.some((item) => item.code === 'independent-review-workflow-not-trusted'));
  assert.ok(permissionResult.findings.some((item) => item.code === 'independent-reviewer-has-source-authority'));
  assert.equal(isApprovalBoundaryBootstrapAnalysis(permissionResult), false);
});

test('protects the live v2 policy engine and wrapper from clean self-attestation', () => {
  for (const path of [
    'shared/agents/operatorMergeApprovalBoundaryV2.mjs',
    'shared/agents/operatorMergeApprovalGateV2.mjs',
  ]) {
    const result = analyzeIndependentSecurityReviewV2({
      changedFiles: [path],
      diff: diffFor(path, ['export const secure = false;']),
    });
    assert.ok(result.findings.some((item) => (
      item.code === 'approval-boundary-v2-self-change-requires-qualified-review'
      && item.path === path
    )));
  }
});

test('classifies both sides of a GitHub rename so protected paths cannot be renamed away', () => {
  const protectedPath = 'shared/agents/operatorMergeApprovalGate.mjs';
  const renamedPath = 'shared/agents/operatorMergeApprovalGate-untrusted.mjs';
  const result = analyzeIndependentSecurityReviewV2({
    changedFiles: [{
      filename: renamedPath,
      previous_filename: protectedPath,
      status: 'renamed',
    }],
    diff: [
      `diff --git a/${protectedPath} b/${renamedPath}`,
      `similarity index 100%`,
      `rename from ${protectedPath}`,
      `rename to ${renamedPath}`,
    ].join('\n'),
  });
  assert.ok(result.findings.some((item) => (
    item.code === 'approval-boundary-v2-self-change-requires-qualified-review'
    && item.path === protectedPath
  )));
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

  const boundedRead = analyzeIndependentSecurityReviewV2({
    changedFiles: [path],
    diff: diffFor(path, [
      'await githubRequest(`/repos/${owner}/${repo}/contents/${encodedPath}?ref=${sourceHead}`);',
    ]),
  });
  assert.equal(boundedRead.findings.some((item) => (
    item.code === 'independent-reviewer-v2-gained-mutation-authority'
  )), false);

  const contentMutation = analyzeIndependentSecurityReviewV2({
    changedFiles: [path],
    diff: diffFor(path, [
      'await githubRequest(`/repos/${owner}/${repo}/contents/${encodedPath}`, { method: "PUT" });',
    ]),
  });
  assert.ok(contentMutation.findings.some((item) => (
    item.code === 'independent-reviewer-v2-gained-mutation-authority'
  )));
});

test('rejects command authority in the exact-base binding module', () => {
  const path = 'shared/agents/operatorMergeBaseBindingV1.mjs';
  const result = analyzeIndependentSecurityReviewV2({
    changedFiles: [path],
    diff: diffFor(path, ["import { spawnSync } from 'node:child_process';"]),
  });
  assert.ok(result.findings.some((item) => item.code === 'base-binding-module-gained-command-authority'));
});
