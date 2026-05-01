const ALLOWED_CAPABILITIES = Object.freeze([
  'health_check',
  'handshake_check',
  'identity_report',
  'safety_posture_report',
  'capability_report',
  'oversight_proposal',
  'permission_diff_preview',
  'rollback_plan_preview',
  'audit_event_preview',
]);

const BLOCKED_CAPABILITIES = Object.freeze([
  'execute_command',
  'edit_file',
  'control_browser',
  'write_git',
  'mutate_system',
  'autonomous_action',
  'change_own_permissions',
  'bypass_operator_approval',
  'weaken_guardrails',
  'hide_audit_trail',
  'enable_execution',
]);

const FUTURE_GATED_CAPABILITIES = Object.freeze([
  'limited_execution_candidate',
  'operator_approved_permission_apply',
]);

export function buildOpenClawPermissionEnvelope({ readonlyValidated = false, evidenceTokens = [] } = {}) {
  return {
    envelopeStatus: readonlyValidated ? 'readonly_validated' : 'readonly_validation_required',
    currentMode: 'proposal_only',
    executionAllowed: false,
    selfModificationAllowed: false,
    operatorApprovalRequired: true,
    allowedCapabilities: [...ALLOWED_CAPABILITIES],
    blockedCapabilities: [...BLOCKED_CAPABILITIES],
    futureGatedCapabilities: [...FUTURE_GATED_CAPABILITIES],
    permissionBoundaryVersion: 'openclaw-envelope-v1',
    sourceEvidenceTokens: [...evidenceTokens, 'execution:disabled', 'self_modification:disabled', 'approval:required'],
    riskLevel: readonlyValidated ? 'guarded' : 'high',
    nextAction: readonlyValidated
      ? 'Review permission diff and approval gate in operator review queue.'
      : 'Complete readonly validation before any permission-change review.',
  };
}

export { ALLOWED_CAPABILITIES, BLOCKED_CAPABILITIES, FUTURE_GATED_CAPABILITIES };
