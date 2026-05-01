const SUPPORTED_EVENT_TYPES = Object.freeze([
  'readonly_validation_observed',
  'capability_trial_reported',
  'oversight_proposal_generated',
  'permission_diff_previewed',
  'approval_gate_evaluated',
  'rollback_plan_previewed',
  'kill_switch_state_observed',
  'pause_state_observed',
]);

export function createOpenClawAuditPreviewEvent({ eventType = 'approval_gate_evaluated', source = 'agent_task_projection', timestamp = new Date().toISOString(), evidenceTokens = [], actionRequested = 'none', reason = '', riskLevel = 'guarded' } = {}) {
  const normalizedType = SUPPORTED_EVENT_TYPES.includes(eventType) ? eventType : 'approval_gate_evaluated';
  return {
    auditEventId: `openclaw-audit-${normalizedType}-${timestamp}`,
    eventType: normalizedType,
    eventStatus: 'preview',
    actor: 'stephanos',
    subject: 'openclaw',
    source,
    timestamp,
    evidenceTokens: Array.isArray(evidenceTokens) ? evidenceTokens : [],
    actionRequested,
    actionAllowed: false,
    actionExecuted: false,
    reason: reason || 'Preview-only governance event. No action execution path is enabled.',
    riskLevel,
    operatorApprovalRequired: true,
  };
}

export { SUPPORTED_EVENT_TYPES };
