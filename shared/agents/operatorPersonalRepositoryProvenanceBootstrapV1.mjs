import {
  APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE,
  APPROVAL_BOUNDARY_BOOTSTRAP_REVIEW_SCOPE,
  OPERATOR_MERGE_ENVIRONMENT,
} from './operatorMergeApprovalGate.mjs';
import {
  INDEPENDENT_REVIEW_FINDINGS_ARTIFACT_KIND,
  INDEPENDENT_REVIEW_FINDINGS_ARTIFACT_SCHEMA_VERSION,
  independentReviewFindingsArtifactPayloadSha256,
} from './operatorMergeReviewArtifactV1.mjs';

export const PROVENANCE_BOOTSTRAP_PR = 1581;
export const PROVENANCE_BOOTSTRAP_BRANCH = 'fix/bounded-github-admin-mailbox';
export const PROVENANCE_BOOTSTRAP_EXTRA_FINDING = 'write-workflow-does-not-use-trusted-source';
export const PROVENANCE_BOOTSTRAP_WORKFLOW_PATH = '.github/workflows/operator-merge-approval-gate.yml';

const EXPECTED_BOOTSTRAP_PATHS = Object.freeze([
  '.github/workflows/operator-merge-approval-gate.yml',
  '.github/workflows/operator-merge-approval-gate-test.yml',
  'scripts/operator-protected-personal-repository-merge.mjs',
  'shared/agents/operatorMergeApprovalGate.mjs',
  'shared/agents/operatorPersonalRepositoryMergeV1.mjs',
]);

const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const text = (value) => String(value ?? '').trim();
const integer = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);
const unique = (values) => [...new Set(values)];

function exactIdentity(artifact, options) {
  return artifact?.repository === 'Cheekyfellastef/stephan-os'
    && artifact?.prNumber === PROVENANCE_BOOTSTRAP_PR
    && artifact?.branch === PROVENANCE_BOOTSTRAP_BRANCH
    && SHA.test(text(artifact?.sourceHead))
    && artifact.sourceHead === text(options.sourceHead).toLowerCase()
    && SHA.test(text(artifact?.baseSha))
    && artifact.baseSha === text(options.baseSha).toLowerCase()
    && integer(artifact?.workflowRunId) === integer(options.workflowRunId)
    && integer(artifact?.workflowRunAttempt) === integer(options.workflowRunAttempt);
}

function exactFindings(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (analysis?.schemaVersion !== 'stephanos.independent-security-analysis.v1'
    || analysis?.verdict !== 'findings'
    || analysis?.finalVerdict !== 'INDEPENDENT_SECURITY_REVIEW_FINDINGS'
    || analysis?.counts?.P0 !== 6
    || analysis?.counts?.P1 !== 0
    || analysis?.counts?.P2 !== 0
    || findings.length !== 6) return false;

  const extra = findings.filter((item) => (
    text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === PROVENANCE_BOOTSTRAP_EXTRA_FINDING
    && text(item?.path) === PROVENANCE_BOOTSTRAP_WORKFLOW_PATH
    && /protected-workflow-dispatch-inputs-not-exact/.test(text(item?.summary))
  ));
  const bootstrap = findings.filter((item) => (
    text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE
    && EXPECTED_BOOTSTRAP_PATHS.includes(text(item?.path))
  ));
  const bootstrapPaths = bootstrap.map((item) => text(item.path)).sort();
  return extra.length === 1
    && bootstrap.length === EXPECTED_BOOTSTRAP_PATHS.length
    && JSON.stringify(bootstrapPaths) === JSON.stringify([...EXPECTED_BOOTSTRAP_PATHS].sort());
}

function exactSourceSemantics(workflowSource, gateSource) {
  const workflow = String(workflowSource || '');
  const gate = String(gateSource || '');
  return /^ {6}authorization_comment_id:\s*$/m.test(workflow)
    && /description:\s*Event-derived exact owner-authored #1507 authorization comment ID for protected squash only/.test(workflow)
    && /^ {8}required:\s*false\s*$/m.test(workflow)
    && /^ {8}default:\s*''\s*$/m.test(workflow)
    && /authorization_comment_id/.test(gate)
    && /'authorization_comment_id'/.test(gate)
    && !/arbitrary.*authorization_comment_id/i.test(workflow);
}

function exactFailedReviewRun(run = {}, jobs = [], options = {}) {
  const expectedHead = text(options.sourceHead).toLowerCase();
  const runName = text(run?.name || run?.display_title);
  const jobList = Array.isArray(jobs) ? jobs : [];
  return integer(run?.id) === integer(options.workflowRunId)
    && integer(run?.run_attempt) === integer(options.workflowRunAttempt)
    && text(run?.event) === 'workflow_dispatch'
    && text(run?.status) === 'completed'
    && text(run?.conclusion) === 'failure'
    && runName.includes(`pr-${PROVENANCE_BOOTSTRAP_PR}-head-${expectedHead}-binding-`)
    && jobList.length === 1
    && text(jobList[0]?.name) === 'independent-security-review'
    && text(jobList[0]?.status) === 'completed'
    && text(jobList[0]?.conclusion) === 'failure';
}

export function validateProvenanceBootstrapFindingsCompatibilityV1(input = {}, options = {}) {
  const artifact = input?.artifact && typeof input.artifact === 'object' && !Array.isArray(input.artifact)
    ? input.artifact : {};
  const blockers = [];
  if (artifact?.schemaVersion !== INDEPENDENT_REVIEW_FINDINGS_ARTIFACT_SCHEMA_VERSION
    || artifact?.kind !== INDEPENDENT_REVIEW_FINDINGS_ARTIFACT_KIND) {
    blockers.push('provenance-bootstrap-findings-artifact-kind-invalid');
  }
  if (!exactIdentity(artifact, options)) blockers.push('provenance-bootstrap-identity-mismatch');
  if (!SHA256.test(text(artifact?.payloadSha256))
    || artifact.payloadSha256 !== independentReviewFindingsArtifactPayloadSha256(artifact)) {
    blockers.push('provenance-bootstrap-payload-digest-invalid');
  }
  if (!exactFindings(artifact?.analysis)) blockers.push('provenance-bootstrap-findings-not-exact');
  if (!exactFailedReviewRun(input?.run, input?.jobs, options)) blockers.push('provenance-bootstrap-review-run-not-exact');
  if (!exactSourceSemantics(input?.workflowSource, input?.gateSource)) {
    blockers.push('provenance-bootstrap-authorization-comment-source-not-proven');
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
      'bounded-authorization-comment-provenance-compatibility-v1',
    ]),
    findings: Object.freeze(Array.isArray(artifact?.analysis?.findings) ? artifact.analysis.findings : []),
    blockers: Object.freeze(unique(blockers)),
    mutationAllowed: false,
    finalVerdict: blockers.length
      ? 'PROVENANCE_BOOTSTRAP_FINDINGS_COMPATIBILITY_BLOCKED'
      : 'PROVENANCE_BOOTSTRAP_FINDINGS_COMPATIBILITY_ADMITTED',
  });
}
