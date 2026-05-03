function asArray(v){return Array.isArray(v)?v.filter(Boolean):[];}

const REQUIRED = [
  'readonly_validation_succeeded','capability_report_available','proposal_packet_ready','operator_review_decision_ready_for_codex_review','codex_review_result_parsed','implementation_plan_ready','risk_classification_present','rollback_plan_present','tests_specified','audit_preview_present','permission_diff_present',
];

export function buildOpenClawApprovalGateReadiness(input = {}) {
  const satisfiedGates = asArray(input?.satisfiedGates);
  const missingGates = REQUIRED.filter((g) => !satisfiedGates.includes(g));
  const blockedReasons = asArray(input?.blockedReasons);
  const blocked = blockedReasons.length > 0 || input?.planStatus === 'blocked_by_risk';
  const approvalReadinessStatus = blocked ? 'blocked_by_risk' : missingGates.length ? 'missing_evidence' : 'ready_for_operator_review';
  return {
    approvalReadinessStatus,
    approvalMode: 'operator_review_only',
    requiredGates: REQUIRED,
    satisfiedGates,
    missingGates,
    blockedReasons,
    riskLevel: input?.riskLevel || 'guarded',
    rollbackReady: input?.rollbackReady === true,
    testsSpecified: input?.testsSpecified === true,
    evidenceReady: input?.evidenceReady === true,
    permissionDiffReady: input?.permissionDiffReady === true,
    auditReady: input?.auditReady === true,
    operatorApprovalRequired: true,
    approvalEligible: false,
    executionAllowed: false,
    nextAction: approvalReadinessStatus === 'ready_for_operator_review' ? 'Ready for future operator approval design (execution still disabled).' : 'Complete missing approval-readiness gates.',
  };
}
