import {
  APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE,
  APPROVAL_BOUNDARY_BOOTSTRAP_REVIEW_SCOPE,
  OPERATOR_MERGE_ENVIRONMENT,
} from './operatorMergeApprovalGate.mjs';
import {
  INDEPENDENT_REVIEW_ARTIFACT_KIND,
  INDEPENDENT_REVIEW_ARTIFACT_SCHEMA_VERSION,
  independentReviewArtifactPayloadSha256,
  validateIndependentReviewArtifact,
} from './operatorMergeReviewArtifactV1.mjs';

export const PROVENANCE_BOOTSTRAP_PR = 2100;
export const PROVENANCE_BOOTSTRAP_BRANCH = 'review/non-codex-mission-worker-cleanup-specialist-v1';
export const PROVENANCE_BOOTSTRAP_HEAD = '24ca1d1f91ab95a41f749fea3e30a66a8fd832dd';
export const PROVENANCE_BOOTSTRAP_BASE = 'e8ffb503867ed37affb4744340a61f04135755e6';

const EXPECTED_BOOTSTRAP_PATHS = Object.freeze([
  'shared/agents/operatorMergeApprovalBoundaryV2.mjs',
  'shared/agents/windowsAuthoritySpecialistReviewV1.mjs',
]);
const REVIEWER_ID = 'github-actions-independent-security-review';
const REVIEWER_CLASS = 'external-qualified';
const REVIEW_PROVIDER = 'github-actions-independent-review';
const REVIEW_MODEL_CLASS = 'source-controlled-high-assurance';
const REVIEW_WORKFLOW_ID = 318073448;
const REVIEW_WORKFLOW_PATH = '.github/workflows/independent-merge-security-review.yml';
const REVIEW_JOB = 'independent-security-review';
const SHA256 = /^[a-f0-9]{64}$/;
const text = (value) => String(value ?? '').trim();
const integer = (value) => (Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0);
const unique = (values) => [...new Set(values)];

export function isProvenanceBootstrapDispatchCompatibilityTarget(options = {}) {
  return Number(options.prNumber) === PROVENANCE_BOOTSTRAP_PR
    && text(options.expectedBranch) === PROVENANCE_BOOTSTRAP_BRANCH
    && text(options.expectedHead).toLowerCase() === PROVENANCE_BOOTSTRAP_HEAD
    && text(options.expectedBaseSha).toLowerCase() === PROVENANCE_BOOTSTRAP_BASE;
}

function exactIdentity(artifact, options) {
  const artifactValidation = validateIndependentReviewArtifact(artifact, {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: PROVENANCE_BOOTSTRAP_PR,
    branch: PROVENANCE_BOOTSTRAP_BRANCH,
    expectedHead: PROVENANCE_BOOTSTRAP_HEAD,
    expectedBaseSha: PROVENANCE_BOOTSTRAP_BASE,
    workflowRunId: integer(options.workflowRunId),
    workflowRunAttempt: integer(options.workflowRunAttempt),
  });
  return artifactValidation.valid
    && artifact?.schemaVersion === INDEPENDENT_REVIEW_ARTIFACT_SCHEMA_VERSION
    && artifact?.kind === INDEPENDENT_REVIEW_ARTIFACT_KIND
    && artifact?.reviewMode === 'qualified-operator-bootstrap'
    && artifact?.sourceHead === PROVENANCE_BOOTSTRAP_HEAD
    && artifact?.baseSha === PROVENANCE_BOOTSTRAP_BASE
    && artifact?.payloadSha256 === independentReviewArtifactPayloadSha256(artifact)
    && text(options.sourceHead).toLowerCase() === PROVENANCE_BOOTSTRAP_HEAD
    && text(options.baseSha).toLowerCase() === PROVENANCE_BOOTSTRAP_BASE;
}

function exactFindings(receipt = {}) {
  const findings = Array.isArray(receipt?.findings) ? receipt.findings : [];
  const reviewScope = Array.isArray(receipt?.reviewScope) ? receipt.reviewScope : [];
  const paths = findings.map((item) => text(item?.path)).sort();
  return receipt?.verdict === 'findings'
    && text(receipt?.blocker) === ''
    && text(receipt?.reviewerId) === REVIEWER_ID
    && text(receipt?.reviewerClass) === REVIEWER_CLASS
    && text(receipt?.provider) === REVIEW_PROVIDER
    && text(receipt?.modelClass) === REVIEW_MODEL_CLASS
    && text(receipt?.riskTier) === 'high'
    && text(receipt?.assuranceMode) === 'specialist'
    && reviewScope.includes('approval-boundary-invariants')
    && reviewScope.includes(APPROVAL_BOUNDARY_BOOTSTRAP_REVIEW_SCOPE)
    && reviewScope.includes('exact-base-sha-binding')
    && findings.length === EXPECTED_BOOTSTRAP_PATHS.length
    && findings.every((item) => (
      text(item?.severity).toUpperCase() === 'P0'
      && text(item?.code) === APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE
      && EXPECTED_BOOTSTRAP_PATHS.includes(text(item?.path))
    ))
    && JSON.stringify(paths) === JSON.stringify([...EXPECTED_BOOTSTRAP_PATHS].sort());
}

function exactSuccessfulReviewRun(run = {}, jobs = [], options = {}) {
  const expectedName = new RegExp(
    `^stephanos-independent-review-pr-${PROVENANCE_BOOTSTRAP_PR}-head-${PROVENANCE_BOOTSTRAP_HEAD}-binding-([a-f0-9]{64})$`,
  );
  const runName = text(run?.name);
  const displayTitle = text(run?.display_title);
  const jobList = Array.isArray(jobs) ? jobs : [];
  const matchingJobs = jobList.filter((job) => text(job?.name) === REVIEW_JOB);
  return integer(run?.id) === integer(options.workflowRunId)
    && integer(run?.run_attempt) === integer(options.workflowRunAttempt)
    && integer(run?.workflow_id) === REVIEW_WORKFLOW_ID
    && text(run?.path) === REVIEW_WORKFLOW_PATH
    && text(run?.event) === 'workflow_dispatch'
    && text(run?.head_branch) === 'main'
    && text(run?.head_sha).toLowerCase() === PROVENANCE_BOOTSTRAP_BASE
    && text(run?.status) === 'completed'
    && text(run?.conclusion) === 'success'
    && Array.isArray(run?.pull_requests)
    && run.pull_requests.length === 0
    && runName === displayTitle
    && expectedName.test(runName)
    && matchingJobs.length === 1
    && text(matchingJobs[0]?.status) === 'completed'
    && text(matchingJobs[0]?.conclusion) === 'success';
}

function exactSourceSemantics(workflowSource, gateSource) {
  const workflow = String(workflowSource || '');
  const gate = String(gateSource || '');
  return /operator-personal-repository-squash-merge/.test(workflow)
    && /name:\s*operator-merge-approval/.test(workflow)
    && /node scripts\/operator-protected-personal-repository-merge\.mjs merge/.test(workflow)
    && gate.includes(APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE)
    && gate.includes(APPROVAL_BOUNDARY_BOOTSTRAP_REVIEW_SCOPE);
}

export function validateProvenanceBootstrapFindingsCompatibilityV1(input = {}, options = {}) {
  const artifact = input?.artifact && typeof input.artifact === 'object' && !Array.isArray(input.artifact)
    ? input.artifact : {};
  const blockers = [];
  if (!isProvenanceBootstrapDispatchCompatibilityTarget({
    prNumber: artifact?.prNumber,
    expectedBranch: artifact?.branch,
    expectedHead: artifact?.sourceHead,
    expectedBaseSha: artifact?.baseSha,
  })) blockers.push('provenance-bootstrap-identity-mismatch');
  if (!exactIdentity(artifact, options)) blockers.push('provenance-bootstrap-artifact-not-exact');
  if (!SHA256.test(text(artifact?.payloadSha256))) blockers.push('provenance-bootstrap-payload-digest-invalid');
  if (!exactFindings(artifact?.receipt)) blockers.push('provenance-bootstrap-findings-not-exact');
  if (!exactSuccessfulReviewRun(input?.run, input?.jobs, options)) blockers.push('provenance-bootstrap-review-run-not-exact');
  if (!exactSourceSemantics(input?.workflowSource, input?.gateSource)) {
    blockers.push('provenance-bootstrap-protected-source-not-proven');
  }
  if (options.protectedEnvironmentAdmitted !== true
    || text(options.environmentName) !== OPERATOR_MERGE_ENVIRONMENT) {
    blockers.push('provenance-bootstrap-protected-environment-not-admitted');
  }

  return Object.freeze({
    valid: blockers.length === 0,
    reviewMode: 'qualified-operator-bootstrap',
    operatorBootstrapRequired: true,
    operatorProtectedApprovalRequired: true,
    reviewScope: Object.freeze([
      'complete-exact-head-diff',
      'approval-boundary-invariants',
      APPROVAL_BOUNDARY_BOOTSTRAP_REVIEW_SCOPE,
      'exact-base-sha-binding',
      'bounded-pr2100-mission-worker-specialist-bootstrap-compatibility-v1',
    ]),
    findings: Object.freeze(Array.isArray(artifact?.receipt?.findings) ? artifact.receipt.findings : []),
    blockers: Object.freeze(unique(blockers)),
    mutationAllowed: false,
    finalVerdict: blockers.length
      ? 'PROVENANCE_BOOTSTRAP_FINDINGS_COMPATIBILITY_BLOCKED'
      : 'PROVENANCE_BOOTSTRAP_FINDINGS_COMPATIBILITY_ADMITTED',
  });
}
