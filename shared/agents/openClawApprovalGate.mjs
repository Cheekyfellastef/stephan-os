const REQUIRED_PRECONDITIONS = Object.freeze([
  'readonly validation succeeded',
  'capability trial report generated',
  'permission diff reviewed',
  'audit preview generated',
  'rollback plan present',
  'risk classification present',
  'operator explicit approval captured in future stage',
]);

function toSatisfiedMap({ readonlyValidated = false, capabilityReportReady = false, permissionDiffReady = false, auditPreviewReady = false, rollbackReady = false, riskPresent = false } = {}) {
  return {
    'readonly validation succeeded': readonlyValidated,
    'capability trial report generated': capabilityReportReady,
    'permission diff reviewed': permissionDiffReady,
    'audit preview generated': auditPreviewReady,
    'rollback plan present': rollbackReady,
    'risk classification present': riskPresent,
    'operator explicit approval captured in future stage': false,
  };
}

export function buildOpenClawApprovalGate(inputs = {}) {
  const map = toSatisfiedMap(inputs);
  const satisfiedPreconditions = REQUIRED_PRECONDITIONS.filter((item) => map[item]);
  const missingPreconditions = REQUIRED_PRECONDITIONS.filter((item) => !map[item]);
  return {
    gateStatus: missingPreconditions.length === 0 ? 'harness_locked_operator_stage_pending' : 'preconditions_incomplete',
    gateMode: 'operator_review_only',
    approvalEligible: false,
    operatorApprovalRequired: true,
    requiredPreconditions: [...REQUIRED_PRECONDITIONS],
    missingPreconditions,
    satisfiedPreconditions,
    blockedReasons: [
      'Harness stage: approval execution is not implemented in v1.',
      'OpenClaw cannot approve or apply its own permission increase.',
    ],
    executionAllowed: false,
    selfModificationAllowed: false,
    nextAction: 'Keep proposal-only review path; collect operator-reviewed evidence for future stage gating.',
  };
}
