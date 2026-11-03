import {
  analyzeIndependentSecurityReviewV2,
} from './operatorMergeApprovalBoundaryV2.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
  migrateIndependentReviewWorkflowFinalPolicyAnalysisV1,
  validateIndependentReviewWorkflowFinalSourcePolicyV1,
} from './operatorMergeApprovalGateV2IndependentReviewFinalSourceV1.mjs';

export const INDEPENDENT_REVIEW_WORKFLOW_RUN_NAME_POLICY_SCHEMA = 'stephanos.independent-review-workflow-run-name-policy.v1';
export const INDEPENDENT_REVIEW_WORKFLOW_RUN_NAME_EXPRESSION_V1 = "stephanos-independent-review-pr-${{ inputs.pr_number || github.event.pull_request.number }}-head-${{ inputs.source_head || github.event.pull_request.head.sha }}-binding-${{ inputs.handoff_binding_sha256 || 'legacy-pull-request-target' }}";

function text(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return [...new Set(values)];
}

function runNameLines(source) {
  return String(source ?? '')
    .split(/\r?\n/)
    .filter((line) => /^run-name:\s*/.test(line));
}

export function validateIndependentReviewWorkflowRunNameFinalSourceV1(input = {}) {
  const base = validateIndependentReviewWorkflowFinalSourcePolicyV1(input);
  if (!base.applicable) {
    return Object.freeze({
      schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_RUN_NAME_POLICY_SCHEMA,
      applicable: false,
      valid: false,
      blockers: Object.freeze([...base.blockers]),
      proofRefs: Object.freeze([]),
    });
  }
  if (!base.valid) {
    return Object.freeze({
      schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_RUN_NAME_POLICY_SCHEMA,
      applicable: true,
      valid: false,
      blockers: Object.freeze(unique(['independent-review-final-source-policy-invalid', ...base.blockers])),
      proofRefs: Object.freeze([]),
    });
  }

  const sources = Array.isArray(input.protectedWorkflowSources) ? input.protectedWorkflowSources : [];
  const candidates = sources.filter((source) => text(source?.path) === INDEPENDENT_REVIEW_WORKFLOW_PATH);
  const source = candidates.length === 1 ? candidates[0] : null;
  const lines = runNameLines(source?.content);
  const value = lines.length === 1 ? text(lines[0].slice('run-name:'.length)) : '';
  const blockers = [];
  if (lines.length !== 1) blockers.push('independent-review-run-name-count-not-exact');
  if (lines.length === 1 && value !== INDEPENDENT_REVIEW_WORKFLOW_RUN_NAME_EXPRESSION_V1) {
    blockers.push('independent-review-run-name-not-exact');
  }

  return Object.freeze({
    schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_RUN_NAME_POLICY_SCHEMA,
    applicable: true,
    valid: blockers.length === 0,
    blockers: Object.freeze(blockers),
    proofRefs: Object.freeze(blockers.length ? [] : [
      base.proofRef,
      `${base.proofRef}:run-name`,
    ]),
  });
}

export function analyzeIndependentSecurityReviewWithRunNamePolicyV1(input = {}) {
  const legacy = analyzeIndependentSecurityReviewV2(input);
  const runName = validateIndependentReviewWorkflowRunNameFinalSourceV1(input);
  if (!runName.valid) return legacy;
  return migrateIndependentReviewWorkflowFinalPolicyAnalysisV1(legacy, input);
}
