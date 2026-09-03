import assert from 'node:assert/strict';
import test from 'node:test';
import {
  independentReviewFindingsArtifactPayloadSha256,
} from './operatorMergeReviewArtifactV1.mjs';
import {
  PROVENANCE_BOOTSTRAP_BRANCH,
  PROVENANCE_BOOTSTRAP_PR,
  validateProvenanceBootstrapFindingsCompatibilityV1,
} from './operatorPersonalRepositoryProvenanceBootstrapV1.mjs';

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const runId = 123456;

function artifact() {
  const value = {
    schemaVersion: 'stephanos.independent-review-findings-artifact.v1',
    kind: 'stephanos.independent-review.findings-artifact',
    artifactName: `stephanos-independent-review-${runId}-attempt-1`,
    artifactFile: 'independent-review-result.json',
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: PROVENANCE_BOOTSTRAP_PR,
    branch: PROVENANCE_BOOTSTRAP_BRANCH,
    sourceHead: head,
    baseSha: base,
    workflowRunId: runId,
    workflowRunAttempt: 1,
    createdAtUtc: '2026-08-31T02:40:26.278Z',
    analysis: {
      schemaVersion: 'stephanos.independent-security-analysis.v1',
      findings: [
        { severity: 'P0', code: 'write-workflow-does-not-use-trusted-source', summary: 'The final exact-head workflow source violates: protected-workflow-dispatch-inputs-not-exact.', path: '.github/workflows/operator-merge-approval-gate.yml' },
        ...[
          '.github/workflows/operator-merge-approval-gate.yml',
          '.github/workflows/operator-merge-approval-gate-test.yml',
          'scripts/operator-protected-personal-repository-merge.mjs',
          'shared/agents/operatorMergeApprovalGate.mjs',
          'shared/agents/operatorPersonalRepositoryMergeV1.mjs',
        ].map((path) => ({ severity: 'P0', code: 'approval-boundary-v2-self-change-requires-qualified-review', summary: 'bootstrap', path })),
      ],
      counts: { P0: 6, P1: 0, P2: 0 },
      verdict: 'findings',
      proofRefs: ['proofs/changed-file/.github/workflows/operator-merge-approval-gate.yml'],
      finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_FINDINGS',
    },
  };
  return { ...value, payloadSha256: independentReviewFindingsArtifactPayloadSha256(value) };
}

const workflowSource = `
  workflow_dispatch:
    inputs:
      authorization_comment_id:
        description: Event-derived exact owner-authored #1507 authorization comment ID for protected squash only
        required: false
        default: ''
        type: string
`;
const gateSource = `const requiredInputs = ['authorization_comment_id'];\nvoid authorization_comment_id;\n`;
const run = { id: runId, run_attempt: 1, event: 'workflow_dispatch', status: 'completed', conclusion: 'failure', name: `stephanos-independent-review-pr-1581-head-${head}-binding-${'c'.repeat(64)}` };
const jobs = [{ name: 'independent-security-review', status: 'completed', conclusion: 'failure' }];
const options = { sourceHead: head, baseSha: base, workflowRunId: runId, workflowRunAttempt: 1, protectedEnvironmentAdmitted: true, environmentName: 'operator-merge-approval' };

test('admits only the exact #1581 provenance bootstrap findings case', () => {
  const result = validateProvenanceBootstrapFindingsCompatibilityV1({ artifact: artifact(), run, jobs, workflowSource, gateSource }, options);
  assert.equal(result.valid, true, JSON.stringify(result.blockers));
  assert.equal(result.reviewMode, 'qualified-operator-bootstrap');
  assert.equal(result.mutationAllowed, false);
});

test('fails closed on an extra unrelated finding', () => {
  const changed = artifact();
  changed.analysis.findings = [...changed.analysis.findings, { severity: 'P0', code: 'unrelated', summary: 'bad', path: 'x' }];
  changed.analysis.counts = { P0: 7, P1: 0, P2: 0 };
  changed.payloadSha256 = independentReviewFindingsArtifactPayloadSha256(changed);
  const result = validateProvenanceBootstrapFindingsCompatibilityV1({ artifact: changed, run, jobs, workflowSource, gateSource }, options);
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('provenance-bootstrap-findings-not-exact'));
});

test('fails closed when authorization_comment_id source semantics are absent', () => {
  const result = validateProvenanceBootstrapFindingsCompatibilityV1({ artifact: artifact(), run, jobs, workflowSource: 'workflow_dispatch:\n', gateSource }, options);
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('provenance-bootstrap-authorization-comment-source-not-proven'));
});
