import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE,
  APPROVAL_BOUNDARY_BOOTSTRAP_REVIEW_SCOPE,
  OPERATOR_MERGE_ENVIRONMENT,
} from './operatorMergeApprovalGate.mjs';
import {
  PERSONAL_REPOSITORY_REVIEW_MODE_BOOTSTRAP,
  PERSONAL_REPOSITORY_REVIEW_MODE_CLEAN,
  validatePersonalRepositoryReviewAdmission,
} from './operatorPersonalRepositoryReviewAdmissionV1.mjs';

function cleanArtifact(overrides = {}) {
  return {
    reviewMode: PERSONAL_REPOSITORY_REVIEW_MODE_CLEAN,
    receipt: {
      verdict: 'clean',
      blocker: '',
      findings: [],
      reviewScope: ['complete-exact-head-diff', 'approval-boundary-invariants'],
    },
    ...overrides,
  };
}

function bootstrapArtifact(overrides = {}) {
  return {
    reviewMode: PERSONAL_REPOSITORY_REVIEW_MODE_BOOTSTRAP,
    receipt: {
      verdict: 'findings',
      blocker: '',
      findings: [{
        severity: 'P0',
        code: APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE,
        path: '.github/workflows/independent-merge-security-review.yml',
      }],
      reviewScope: [
        'complete-exact-head-diff',
        'approval-boundary-invariants',
        APPROVAL_BOUNDARY_BOOTSTRAP_REVIEW_SCOPE,
      ],
    },
    ...overrides,
  };
}

function validation(reviewMode, operatorBootstrapRequired = false, overrides = {}) {
  return {
    valid: true,
    review: {
      reviewMode,
      operatorBootstrapRequired,
    },
    ...overrides,
  };
}

test('clean independent review remains admitted without widening authority', () => {
  const verdict = validatePersonalRepositoryReviewAdmission({
    artifact: cleanArtifact(),
    validation: validation(PERSONAL_REPOSITORY_REVIEW_MODE_CLEAN),
  });
  assert.equal(verdict.valid, true);
  assert.equal(verdict.finalVerdict, 'PERSONAL_REPOSITORY_CLEAN_REVIEW_ADMITTED');
  assert.equal(verdict.operatorProtectedApprovalRequired, false);
  assert.equal(verdict.mutationAllowed, false);
});

test('qualified bootstrap review is admitted only after exact protected-environment admission', () => {
  const input = {
    artifact: bootstrapArtifact(),
    validation: validation(PERSONAL_REPOSITORY_REVIEW_MODE_BOOTSTRAP, true),
  };
  const beforeProtection = validatePersonalRepositoryReviewAdmission(input);
  assert.equal(beforeProtection.valid, false);
  assert.ok(beforeProtection.blockers.includes('personal-repository-bootstrap-review-not-protected-admitted'));

  const admitted = validatePersonalRepositoryReviewAdmission(input, {
    protectedEnvironmentAdmitted: true,
    environmentName: OPERATOR_MERGE_ENVIRONMENT,
  });
  assert.equal(admitted.valid, true);
  assert.equal(admitted.finalVerdict, 'PERSONAL_REPOSITORY_BOOTSTRAP_REVIEW_ADMITTED');
  assert.equal(admitted.operatorProtectedApprovalRequired, true);
  assert.equal(admitted.findings.length, 1);
  assert.equal(admitted.mutationAllowed, false);
});

test('bootstrap admission rejects wrong environment or unqualified artifact validation', () => {
  const input = {
    artifact: bootstrapArtifact(),
    validation: validation(PERSONAL_REPOSITORY_REVIEW_MODE_BOOTSTRAP, true),
  };
  const wrongEnvironment = validatePersonalRepositoryReviewAdmission(input, {
    protectedEnvironmentAdmitted: true,
    environmentName: 'not-the-protected-operator-environment',
  });
  assert.equal(wrongEnvironment.valid, false);

  const invalidArtifact = validatePersonalRepositoryReviewAdmission({
    ...input,
    validation: validation(PERSONAL_REPOSITORY_REVIEW_MODE_BOOTSTRAP, true, { valid: false }),
  }, {
    protectedEnvironmentAdmitted: true,
    environmentName: OPERATOR_MERGE_ENVIRONMENT,
  });
  assert.equal(invalidArtifact.valid, false);
  assert.ok(invalidArtifact.blockers.includes('personal-repository-review-artifact-invalid'));
});

test('bootstrap admission rejects mixed, widened or blocked findings', () => {
  const options = {
    protectedEnvironmentAdmitted: true,
    environmentName: OPERATOR_MERGE_ENVIRONMENT,
  };
  for (const artifact of [
    bootstrapArtifact({ receipt: { ...bootstrapArtifact().receipt, blocker: 'something-else' } }),
    bootstrapArtifact({ receipt: { ...bootstrapArtifact().receipt, reviewScope: ['complete-exact-head-diff'] } }),
    bootstrapArtifact({ receipt: {
      ...bootstrapArtifact().receipt,
      findings: [{ severity: 'P1', code: APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE, path: 'x' }],
    } }),
    bootstrapArtifact({ receipt: {
      ...bootstrapArtifact().receipt,
      findings: [{ severity: 'P0', code: 'different-finding', path: 'x' }],
    } }),
  ]) {
    const verdict = validatePersonalRepositoryReviewAdmission({
      artifact,
      validation: validation(PERSONAL_REPOSITORY_REVIEW_MODE_BOOTSTRAP, true),
    }, options);
    assert.equal(verdict.valid, false);
    assert.ok(verdict.blockers.includes('personal-repository-bootstrap-review-findings-invalid'));
  }
});

test('review-mode relabelling and unsupported modes fail closed', () => {
  const relabelled = validatePersonalRepositoryReviewAdmission({
    artifact: bootstrapArtifact({ reviewMode: PERSONAL_REPOSITORY_REVIEW_MODE_CLEAN }),
    validation: validation(PERSONAL_REPOSITORY_REVIEW_MODE_BOOTSTRAP, true),
  }, {
    protectedEnvironmentAdmitted: true,
    environmentName: OPERATOR_MERGE_ENVIRONMENT,
  });
  assert.equal(relabelled.valid, false);
  assert.ok(relabelled.blockers.includes('personal-repository-review-mode-validation-mismatch'));

  const unsupported = validatePersonalRepositoryReviewAdmission({
    artifact: cleanArtifact({ reviewMode: 'self-declared-clean' }),
    validation: validation('self-declared-clean'),
  });
  assert.equal(unsupported.valid, false);
  assert.ok(unsupported.blockers.includes('personal-repository-review-mode-unsupported'));
});
