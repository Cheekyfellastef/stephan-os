import assert from 'node:assert/strict';
import test from 'node:test';
import {
  independentReviewArtifactPayloadSha256,
} from './operatorMergeReviewArtifactV1.mjs';
import {
  PROVENANCE_BOOTSTRAP_BASE,
  PROVENANCE_BOOTSTRAP_BRANCH,
  PROVENANCE_BOOTSTRAP_HEAD,
  PROVENANCE_BOOTSTRAP_PR,
  isProvenanceBootstrapDispatchCompatibilityTarget,
  validateProvenanceBootstrapFindingsCompatibilityV1,
} from './operatorPersonalRepositoryProvenanceBootstrapV1.mjs';

const runId = 33667762906;
const runAttempt = 1;
const binding = 'fca0a9bf3eaef27fd830c5006cb4a6e46e4db2c0c157f42385208a40c8e280b5';

const artifactTemplate = Object.freeze({
  schemaVersion: 'stephanos.independent-review-artifact.v1',
  kind: 'stephanos.independent-review.artifact',
  artifactName: `stephanos-independent-review-${runId}-attempt-${runAttempt}`,
  artifactFile: 'independent-review-result.json',
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: PROVENANCE_BOOTSTRAP_PR,
  branch: PROVENANCE_BOOTSTRAP_BRANCH,
  sourceHead: PROVENANCE_BOOTSTRAP_HEAD,
  baseSha: PROVENANCE_BOOTSTRAP_BASE,
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
  reviewMode: 'qualified-operator-bootstrap',
  createdAtUtc: '2026-09-02T18:32:08.413Z',
  receipt: {
    schemaVersion: 'stephanos.provider-neutral-review.v1',
    kind: 'stephanos.provider-neutral.review',
    receiptId: `independent-review-pr${PROVENANCE_BOOTSTRAP_PR}-run${runId}-attempt${runAttempt}`,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1568,
    prNumber: PROVENANCE_BOOTSTRAP_PR,
    branch: PROVENANCE_BOOTSTRAP_BRANCH,
    sourceHead: PROVENANCE_BOOTSTRAP_HEAD,
    reviewerId: 'github-actions-independent-security-review',
    reviewerClass: 'external-qualified',
    provider: 'github-actions-independent-review',
    modelClass: 'source-controlled-high-assurance',
    reviewerSessionId: `github-actions-independent-review-run-${runId}-attempt-${runAttempt}`,
    implementerProvider: 'canonical-programme-builder',
    implementerSessionId: `pr-${PROVENANCE_BOOTSTRAP_PR}-implementation-lane`,
    riskTier: 'high',
    assuranceMode: 'specialist',
    reviewScope: [
      'complete-exact-head-diff',
      'changed-file-risk-classification',
      'approval-boundary-invariants',
      'merge-authority-separation',
      'forbidden-authority-scan',
      'operator-protected-bootstrap-required',
      'exact-base-sha-binding',
    ],
    findings: [
      {
        severity: 'P0',
        code: 'approval-boundary-v2-self-change-requires-qualified-review',
        summary: 'A live v2 approval-boundary self-change requires a separate qualified bootstrap review and cannot self-attest clean.',
        path: 'shared/agents/operatorMergeApprovalBoundaryV2.mjs',
      },
      {
        severity: 'P0',
        code: 'approval-boundary-v2-self-change-requires-qualified-review',
        summary: 'A live v2 approval-boundary self-change requires a separate qualified bootstrap review and cannot self-attest clean.',
        path: 'shared/agents/windowsAuthoritySpecialistReviewV1.mjs',
      },
    ],
    verdict: 'findings',
    timestampUtc: '2026-09-02T18:32:08.413Z',
    proofRefs: [
      `proofs/independent-review/run-${runId}`,
      `proofs/independent-review/head-${PROVENANCE_BOOTSTRAP_HEAD.slice(0, 12)}`,
      'proofs/changed-file/shared/agents/operatorMergeApprovalBoundaryV2.mjs',
      'proofs/changed-file/shared/agents/windowsAuthorityMissionWorkerCleanupReviewV1.mjs',
      'proofs/changed-file/shared/agents/windowsAuthorityMissionWorkerCleanupReviewV1.test.mjs',
      'proofs/changed-file/shared/agents/windowsAuthoritySpecialistBoundaryV1.test.mjs',
      'proofs/changed-file/shared/agents/windowsAuthoritySpecialistReviewV1.mjs',
      'proofs/changed-file/shared/agents/windowsAuthoritySpecialistReviewV1.test.mjs',
      'proofs/approval-boundary-v2/shared/agents/operatorMergeApprovalBoundaryV2.mjs',
      'proofs/approval-boundary-v2/shared/agents/windowsAuthoritySpecialistReviewV1.mjs',
      `proofs/independent-review/base-${PROVENANCE_BOOTSTRAP_BASE}`,
    ],
    quorumChecks: [],
    blocker: '',
  },
  payloadSha256: '4e8348cbfbb3e12734cf9fe0f8c327747e9d29721c6ef812b87b4276139945a5',
});

function artifact() {
  return JSON.parse(JSON.stringify(artifactTemplate));
}

const workflowSource = `
jobs:
  operator-personal-repository-squash-merge:
    environment:
      name: operator-merge-approval
    steps:
      - run: node scripts/operator-protected-personal-repository-merge.mjs merge
`;
const gateSource = `
export const APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE = 'approval-boundary-v2-self-change-requires-qualified-review';
export const APPROVAL_BOUNDARY_BOOTSTRAP_REVIEW_SCOPE = 'operator-protected-bootstrap-required';
`;
const runName = `stephanos-independent-review-pr-${PROVENANCE_BOOTSTRAP_PR}-head-${PROVENANCE_BOOTSTRAP_HEAD}-binding-${binding}`;
const run = {
  id: runId,
  run_attempt: runAttempt,
  workflow_id: 318073448,
  path: '.github/workflows/independent-merge-security-review.yml',
  event: 'workflow_dispatch',
  head_branch: 'main',
  head_sha: PROVENANCE_BOOTSTRAP_BASE,
  status: 'completed',
  conclusion: 'success',
  pull_requests: [],
  name: runName,
  display_title: runName,
};
const jobs = [{ name: 'independent-security-review', status: 'completed', conclusion: 'success' }];
const options = {
  sourceHead: PROVENANCE_BOOTSTRAP_HEAD,
  baseSha: PROVENANCE_BOOTSTRAP_BASE,
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
  protectedEnvironmentAdmitted: true,
  environmentName: 'operator-merge-approval',
};

function validate(overrides = {}) {
  return validateProvenanceBootstrapFindingsCompatibilityV1({
    artifact: overrides.artifact || artifact(),
    run: overrides.run || run,
    jobs: overrides.jobs || jobs,
    workflowSource: overrides.workflowSource ?? workflowSource,
    gateSource: overrides.gateSource ?? gateSource,
  }, { ...options, ...(overrides.options || {}) });
}

test('admits the exact immutable PR #2100 qualified bootstrap review and nothing broader', () => {
  const result = validate();
  assert.equal(result.valid, true, JSON.stringify(result.blockers));
  assert.equal(result.reviewMode, 'qualified-operator-bootstrap');
  assert.equal(result.mutationAllowed, false);
  assert.equal(result.findings.length, 2);
});

test('dispatch compatibility target is exact on PR, branch, head and base', () => {
  const exact = {
    prNumber: PROVENANCE_BOOTSTRAP_PR,
    expectedBranch: PROVENANCE_BOOTSTRAP_BRANCH,
    expectedHead: PROVENANCE_BOOTSTRAP_HEAD,
    expectedBaseSha: PROVENANCE_BOOTSTRAP_BASE,
  };
  assert.equal(isProvenanceBootstrapDispatchCompatibilityTarget(exact), true);
  for (const changed of [
    { prNumber: PROVENANCE_BOOTSTRAP_PR + 1 },
    { expectedBranch: 'review/other' },
    { expectedHead: '0'.repeat(40) },
    { expectedBaseSha: '1'.repeat(40) },
  ]) {
    assert.equal(isProvenanceBootstrapDispatchCompatibilityTarget({ ...exact, ...changed }), false);
  }
});

test('fails closed on an unrelated or substituted bootstrap finding', () => {
  const changed = artifact();
  changed.receipt.findings[1] = {
    ...changed.receipt.findings[1],
    code: 'unsupported-high-risk-surface',
    path: 'scripts/windows/unrelated.ps1',
  };
  changed.payloadSha256 = independentReviewArtifactPayloadSha256(changed);
  const result = validate({ artifact: changed });
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('provenance-bootstrap-findings-not-exact'));
});

test('fails closed on review-run identity drift or a non-green review', () => {
  for (const changed of [
    { head_sha: '0'.repeat(40) },
    { head_branch: PROVENANCE_BOOTSTRAP_BRANCH },
    { conclusion: 'failure' },
    { pull_requests: [{ number: PROVENANCE_BOOTSTRAP_PR }] },
    { display_title: 'spoofed' },
  ]) {
    const result = validate({ run: { ...run, ...changed } });
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('provenance-bootstrap-review-run-not-exact'));
  }
});

test('fails closed without the protected merge source semantics or protected environment admission', () => {
  const sourceBlocked = validate({ workflowSource: 'jobs: {}\n' });
  assert.equal(sourceBlocked.valid, false);
  assert.ok(sourceBlocked.blockers.includes('provenance-bootstrap-protected-source-not-proven'));

  const environmentBlocked = validate({ options: { protectedEnvironmentAdmitted: false } });
  assert.equal(environmentBlocked.valid, false);
  assert.ok(environmentBlocked.blockers.includes('provenance-bootstrap-protected-environment-not-admitted'));
});
