import {
  APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE,
} from './operatorMergeApprovalGate.mjs';
import {
  analyzeIndependentSecurityReviewWithRunNamePolicyV1,
} from './operatorMergeApprovalGateV2IndependentReviewRunNamePolicyV1.mjs';

export {
  INDEPENDENT_REVIEW_JOB,
  PROTECTED_WORKFLOW_SOURCE_MAX_BYTES,
  PROTECTED_WORKFLOW_SOURCE_PATHS,
  PROTECTED_WORKFLOW_SOURCE_SCHEMA_VERSION,
  PROTECTED_REVIEW_MARKER,
  REQUIRED_EXACT_HEAD_WORKFLOW_IDENTITIES,
  bindRequiredExactHeadWorkflowIdentities,
  buildProtectedSecurityReviewReceipt,
  exactHeadWorkflowFailureIsTerminal,
  isApprovalBoundaryBootstrapAnalysis,
  validateExactHeadWorkflowRuns,
} from './operatorMergeApprovalGate.mjs';

export {
  INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_RUN_SCHEMA,
  validateIndependentReviewWorkflowDispatchRunV1,
} from './independentReviewWorkflowDispatchAdmissionV1.mjs';

export const OPENCLAW_REVIEWER_SPECIALIST_BOUNDARY_PATHS_V1 = Object.freeze([
  'scripts/independent-merge-security-review-entry-v1.mjs',
  'scripts/independent-merge-security-review-with-openclaw-specialist-v1.mjs',
  'shared/agents/openClawBuilderProviderSpecialistReviewV1.mjs',
  'shared/agents/openClawBuilderProviderSpecialistReviewV1.test.mjs',
  'shared/agents/openClawBuilderProviderSpecialistReviewLegacyV1.mjs',
  'shared/agents/openClawBuilderProviderSpecialistReviewSuccessorV1.mjs',
  'shared/agents/openClawBuilderProviderSpecialistReviewSuccessorV1.test.mjs',
]);

export const REVIEW_DISPATCH_IDENTITY_BOUNDARY_PATHS_V1 = Object.freeze([
  'shared/agents/independentReviewWorkflowDispatchExecutionV1.mjs',
  'shared/agents/independentReviewWorkflowDispatchExecutionV1.test.mjs',
  'shared/agents/independentReviewWorkflowDispatchRunDiscoveryV1.mjs',
  'shared/agents/independentReviewWorkflowDispatchRunDiscoveryV1.test.mjs',
]);

const EXTENDED_APPROVAL_BOUNDARY_PATHS_V1 = Object.freeze([
  ...OPENCLAW_REVIEWER_SPECIALIST_BOUNDARY_PATHS_V1,
  ...REVIEW_DISPATCH_IDENTITY_BOUNDARY_PATHS_V1,
]);

function text(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return [...new Set(values)];
}

function changedFilePaths(item) {
  if (typeof item === 'string') return [text(item)].filter(Boolean);
  return unique([
    text(item?.filename ?? item?.path),
    text(item?.previous_filename),
  ]).filter(Boolean);
}

function approvalBoundaryFinding(path) {
  return Object.freeze({
    severity: 'P0',
    code: APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE,
    summary: 'A live protected review or merge identity boundary self-change requires a separate qualified bootstrap review and cannot self-attest clean.',
    path,
  });
}

export function analyzeIndependentSecurityReview(input = {}) {
  const legacy = analyzeIndependentSecurityReviewWithRunNamePolicyV1(input);
  const changedFiles = (Array.isArray(input.changedFiles) ? input.changedFiles : [])
    .flatMap(changedFilePaths)
    .filter(Boolean);
  const activeBoundaryPaths = EXTENDED_APPROVAL_BOUNDARY_PATHS_V1
    .filter((path) => changedFiles.includes(path));
  if (activeBoundaryPaths.length === 0) return legacy;

  const findings = (Array.isArray(legacy?.findings) ? legacy.findings : []).filter((item) => !(
    text(item?.code) === 'unsupported-high-risk-surface'
    && EXTENDED_APPROVAL_BOUNDARY_PATHS_V1.includes(text(item?.path))
  ));
  const existingApprovalBoundaryPaths = new Set(findings
    .filter((item) => text(item?.code) === APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE)
    .map((item) => text(item?.path))
    .filter(Boolean));
  for (const path of activeBoundaryPaths) {
    if (!existingApprovalBoundaryPaths.has(path)) findings.push(approvalBoundaryFinding(path));
  }

  const counts = Object.freeze({
    P0: findings.filter((item) => text(item?.severity).toUpperCase() === 'P0').length,
    P1: findings.filter((item) => text(item?.severity).toUpperCase() === 'P1').length,
    P2: findings.filter((item) => text(item?.severity).toUpperCase() === 'P2').length,
  });
  const verdict = counts.P0 || counts.P1 || counts.P2 ? 'findings' : 'clean';
  const proofRefs = Object.freeze(unique([
    ...(Array.isArray(legacy?.proofRefs) ? legacy.proofRefs : []),
    ...activeBoundaryPaths.map((path) => `proofs/approval-boundary-v2/${path}`),
  ]));

  return Object.freeze({
    ...legacy,
    findings: Object.freeze(findings),
    counts,
    verdict,
    proofRefs,
    finalVerdict: verdict === 'clean'
      ? 'INDEPENDENT_SECURITY_REVIEW_CLEAN'
      : 'INDEPENDENT_SECURITY_REVIEW_FINDINGS',
  });
}
