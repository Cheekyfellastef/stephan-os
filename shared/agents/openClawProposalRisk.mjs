const BLOCKED_TOKENS = [
  'execution', 'execute_command', 'file mutation', 'edit_file', 'git write', 'write_git',
  'browser control', 'control_browser', 'autonomous action', 'autonomous_action',
  'self-permission change', 'change_own_permissions', 'approval bypass', 'bypass_operator_approval',
  'audit hiding', 'hide_audit_trail', 'guardrail weakening', 'weaken_guardrails',
];

export function classifyOpenClawProposalRisk({ proposedActions = [], proposalType = '' } = {}) {
  const normalized = (Array.isArray(proposedActions) ? proposedActions : []).map((a) => String(a).toLowerCase());
  const blockedReasons = BLOCKED_TOKENS.filter((token) => normalized.some((action) => action.includes(token)));
  let riskLevel = 'low';
  if (blockedReasons.length > 0) riskLevel = 'blocked';
  else if (proposalType === 'propose_permission_change') riskLevel = 'elevated';
  else if (normalized.length > 0) riskLevel = 'guarded';
  const riskReasons = blockedReasons.length > 0 ? ['dangerous_proposed_action_detected'] : ['proposal_only_review'];
  return {
    riskLevel,
    riskReasons,
    blockedReasons,
    operatorReviewRequired: true,
    executionAllowed: false,
    nextAction: riskLevel === 'blocked' ? 'Remove blocked actions before operator review.' : 'Continue proposal-only operator review.',
  };
}
