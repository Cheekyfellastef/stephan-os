function hasEvidence(evidence = [], evidenceType = '') {
  return evidence.some((item) => item?.evidenceType === evidenceType && item?.evidenceStatus !== 'blocked');
}

export function buildOpenClawProposalApprovalRequirements({ evidence = [], risk = {}, rollback = {}, proposalType = '' } = {}) {
  const requiredChecks = [
    'readonly validation succeeded',
    'capability report present',
    'risk classification present',
    'rollback preview present',
    'permission boundary present',
    'operator review required',
  ];
  if (['propose_code_change', 'propose_ui_change'].includes(proposalType)) requiredChecks.push('test evidence required for code/UI changes');

  const satisfiedChecks = [];
  if (hasEvidence(evidence, 'readonly_validation')) satisfiedChecks.push('readonly validation succeeded');
  if (hasEvidence(evidence, 'capability_report')) satisfiedChecks.push('capability report present');
  if (risk.riskLevel) satisfiedChecks.push('risk classification present');
  if (rollback.rollbackStatus) satisfiedChecks.push('rollback preview present');
  if (hasEvidence(evidence, 'permission_boundary')) satisfiedChecks.push('permission boundary present');
  satisfiedChecks.push('operator review required');
  if (requiredChecks.includes('test evidence required for code/UI changes') && hasEvidence(evidence, 'test_evidence')) {
    satisfiedChecks.push('test evidence required for code/UI changes');
  }

  const missingChecks = requiredChecks.filter((check) => !satisfiedChecks.includes(check));
  return {
    approvalStatus: missingChecks.length === 0 ? 'ready_for_operator_review' : 'awaiting_requirements',
    approvalMode: 'operator_review_required',
    operatorApprovalRequired: true,
    openClawSelfApprovalAllowed: false,
    requiredChecks,
    missingChecks,
    satisfiedChecks,
    executionAllowed: false,
    approvalAllowsExecution: false,
    nextAction: missingChecks.length === 0 ? 'Submit packet for operator review.' : `Complete missing checks: ${missingChecks.join(', ')}`,
  };
}
