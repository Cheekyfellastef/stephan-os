import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE,
  OPERATOR_MERGE_ENVIRONMENT,
} from './operatorMergeApprovalGate.mjs';
import {
  buildIndependentReviewArtifact,
  validateIndependentReviewArtifact,
} from './operatorMergeReviewArtifactV1.mjs';
import {
  PERSONAL_REPOSITORY_REVIEW_MODE_BOOTSTRAP,
  validatePersonalRepositoryReviewAdmission,
} from './operatorPersonalRepositoryReviewAdmissionV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const prNumber = 1838;
const branch = 'fix/independent-review-github-read-resilience-v1';
const sourceHead = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const workflowRunId = 123456;
const workflowRunAttempt = 1;

function bootstrapAnalysis() {
  const findings = [{
    severity: 'P0',
    code: APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE,
    summary: 'Trusted approval-boundary source changed and requires protected operator bootstrap.',
    path: '.github/workflows/independent-merge-security-review.yml',
  }];
  return {
    schemaVersion: 'stephanos.independent-security-analysis.v1',
    findings,
    counts: { P0: 1, P1: 0, P2: 0 },
    verdict: 'findings',
    proofRefs: ['proofs/independent-review/bootstrap-compatibility'],
    finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_FINDINGS',
  };
}

test('canonical immutable review artifact preserves qualified bootstrap identity', () => {
  const artifact = buildIndependentReviewArtifact({
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
    workflowRunId,
    workflowRunAttempt,
    createdAtUtc: '2026-08-17T15:00:00.000Z',
    analysis: bootstrapAnalysis(),
  });
  assert.equal(artifact.reviewMode, PERSONAL_REPOSITORY_REVIEW_MODE_BOOTSTRAP);
  assert.equal(artifact.receipt.verdict, 'findings');
  assert.equal(artifact.receipt.blocker, '');
  assert.equal(artifact.receipt.findings.length, 1);

  const validation = validateIndependentReviewArtifact(artifact, {
    repository,
    prNumber,
    branch,
    expectedHead: sourceHead,
    expectedBaseSha: baseSha,
    workflowRunId,
    workflowRunAttempt,
  });
  assert.equal(validation.valid, true);
  assert.equal(validation.review.reviewMode, PERSONAL_REPOSITORY_REVIEW_MODE_BOOTSTRAP);
  assert.equal(validation.review.operatorBootstrapRequired, true);

  const admission = validatePersonalRepositoryReviewAdmission({ artifact, validation }, {
    protectedEnvironmentAdmitted: true,
    environmentName: OPERATOR_MERGE_ENVIRONMENT,
  });
  assert.equal(admission.valid, true);
  assert.equal(admission.finalVerdict, 'PERSONAL_REPOSITORY_BOOTSTRAP_REVIEW_ADMITTED');
  assert.equal(admission.mutationAllowed, false);
});

test('same qualified bootstrap artifact is not admitted before protected environment', () => {
  const artifact = buildIndependentReviewArtifact({
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
    workflowRunId,
    workflowRunAttempt,
    createdAtUtc: '2026-08-17T15:00:00.000Z',
    analysis: bootstrapAnalysis(),
  });
  const validation = validateIndependentReviewArtifact(artifact, {
    repository,
    prNumber,
    branch,
    expectedHead: sourceHead,
    expectedBaseSha: baseSha,
    workflowRunId,
    workflowRunAttempt,
  });
  const admission = validatePersonalRepositoryReviewAdmission({ artifact, validation });
  assert.equal(admission.valid, false);
  assert.ok(admission.blockers.includes('personal-repository-bootstrap-review-not-protected-admitted'));
  assert.equal(admission.mutationAllowed, false);
});
