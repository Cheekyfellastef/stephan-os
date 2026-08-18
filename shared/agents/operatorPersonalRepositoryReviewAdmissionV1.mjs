import {
  APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE,
  APPROVAL_BOUNDARY_BOOTSTRAP_REVIEW_SCOPE,
  OPERATOR_MERGE_ENVIRONMENT,
} from './operatorMergeApprovalGate.mjs';

export const PERSONAL_REPOSITORY_REVIEW_ADMISSION_SCHEMA_VERSION = 'stephanos.personal-repository-review-admission.v1';
export const PERSONAL_REPOSITORY_REVIEW_MODE_CLEAN = 'clean-independent';
export const PERSONAL_REPOSITORY_REVIEW_MODE_BOOTSTRAP = 'qualified-operator-bootstrap';

function text(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return [...new Set(values)];
}

function cleanReceipt(receipt = {}) {
  const scope = Array.isArray(receipt?.reviewScope) ? receipt.reviewScope.map(text) : [];
  return receipt?.verdict === 'clean'
    && text(receipt?.blocker) === ''
    && Array.isArray(receipt?.findings)
    && receipt.findings.length === 0
    && !scope.includes(APPROVAL_BOUNDARY_BOOTSTRAP_REVIEW_SCOPE);
}

function bootstrapReceipt(receipt = {}) {
  const findings = Array.isArray(receipt?.findings) ? receipt.findings : [];
  const scope = Array.isArray(receipt?.reviewScope) ? receipt.reviewScope.map(text) : [];
  return receipt?.verdict === 'findings'
    && text(receipt?.blocker) === ''
    && scope.includes(APPROVAL_BOUNDARY_BOOTSTRAP_REVIEW_SCOPE)
    && findings.length > 0
    && findings.every((finding) => (
      text(finding?.severity).toUpperCase() === 'P0'
      && text(finding?.code) === APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE
      && Boolean(text(finding?.path))
    ));
}

export function validatePersonalRepositoryReviewAdmission(input = {}, options = {}) {
  const artifact = input?.artifact && typeof input.artifact === 'object' && !Array.isArray(input.artifact)
    ? input.artifact
    : {};
  const validation = input?.validation && typeof input.validation === 'object' && !Array.isArray(input.validation)
    ? input.validation
    : {};
  const review = validation?.review && typeof validation.review === 'object' && !Array.isArray(validation.review)
    ? validation.review
    : {};
  const receipt = artifact?.receipt && typeof artifact.receipt === 'object' && !Array.isArray(artifact.receipt)
    ? artifact.receipt
    : {};
  const reviewMode = text(artifact?.reviewMode);
  const validationMode = text(review?.reviewMode);
  const environmentName = text(options.environmentName);
  const protectedEnvironmentAdmitted = options.protectedEnvironmentAdmitted === true;
  const blockers = [];

  if (validation?.valid !== true) blockers.push('personal-repository-review-artifact-invalid');
  if (!reviewMode) blockers.push('personal-repository-review-mode-missing');
  if (reviewMode !== validationMode) blockers.push('personal-repository-review-mode-validation-mismatch');

  let admissionMode = null;
  let operatorProtectedApprovalRequired = false;
  if (reviewMode === PERSONAL_REPOSITORY_REVIEW_MODE_CLEAN) {
    if (review?.operatorBootstrapRequired === true) {
      blockers.push('personal-repository-clean-review-marked-bootstrap');
    }
    if (!cleanReceipt(receipt)) blockers.push('personal-repository-clean-review-not-clean');
    admissionMode = PERSONAL_REPOSITORY_REVIEW_MODE_CLEAN;
  } else if (reviewMode === PERSONAL_REPOSITORY_REVIEW_MODE_BOOTSTRAP) {
    operatorProtectedApprovalRequired = true;
    if (review?.operatorBootstrapRequired !== true) {
      blockers.push('personal-repository-bootstrap-review-not-qualified');
    }
    if (!bootstrapReceipt(receipt)) blockers.push('personal-repository-bootstrap-review-findings-invalid');
    if (!protectedEnvironmentAdmitted || environmentName !== OPERATOR_MERGE_ENVIRONMENT) {
      blockers.push('personal-repository-bootstrap-review-not-protected-admitted');
    }
    admissionMode = PERSONAL_REPOSITORY_REVIEW_MODE_BOOTSTRAP;
  } else if (reviewMode) {
    blockers.push('personal-repository-review-mode-unsupported');
  }

  return Object.freeze({
    schemaVersion: PERSONAL_REPOSITORY_REVIEW_ADMISSION_SCHEMA_VERSION,
    valid: blockers.length === 0,
    reviewMode: reviewMode || null,
    admissionMode,
    operatorProtectedApprovalRequired,
    protectedEnvironmentAdmitted,
    environmentName: environmentName || null,
    findings: Object.freeze(Array.isArray(receipt?.findings) ? receipt.findings : []),
    blockers: Object.freeze(unique(blockers)),
    mutationAllowed: false,
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_REVIEW_ADMISSION_BLOCKED'
      : admissionMode === PERSONAL_REPOSITORY_REVIEW_MODE_BOOTSTRAP
        ? 'PERSONAL_REPOSITORY_BOOTSTRAP_REVIEW_ADMITTED'
        : 'PERSONAL_REPOSITORY_CLEAN_REVIEW_ADMITTED',
  });
}
