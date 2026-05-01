import { normalizeOpenClawProposalEvidence } from './openClawProposalEvidence.mjs';
import { classifyOpenClawProposalRisk } from './openClawProposalRisk.mjs';
import { buildOpenClawProposalRollback } from './openClawProposalRollback.mjs';
import { buildOpenClawProposalApprovalRequirements } from './openClawProposalApprovalRequirements.mjs';

export const OPENCLAW_BLOCKED_ACTIONS = [
  'execute_command','edit_file','control_browser','write_git','mutate_system','autonomous_action','change_own_permissions','bypass_operator_approval','weaken_guardrails','hide_audit_trail','enable_execution',
];
export const OPENCLAW_FORBIDDEN_SELF_ACTIONS = [
  'approve_own_packet','apply_own_packet','alter_own_approval_gate','remove_audit_requirement','reduce_operator_visibility','escalate_without_operator','create_execution_endpoint',
];

export function buildOpenClawProposalPacket(input = {}) {
  const proposalType = input.proposalType || 'observe_capability';
  const evidence = normalizeOpenClawProposalEvidence(input.readonlyEvidence || []);
  const risk = classifyOpenClawProposalRisk({ proposedActions: input.proposedActions || [], proposalType });
  const rollback = buildOpenClawProposalRollback({ rollbackSteps: input.rollbackPreview?.rollbackSteps });
  const approvalRequirements = buildOpenClawProposalApprovalRequirements({ evidence, risk, rollback, proposalType });
  const readonlyOk = input.readonlyTruth?.adapterValidated === true
    || evidence.some((e) => e.evidenceType === 'readonly_validation' && e.evidenceStatus === 'succeeded');
  const capabilityOk = input.proposalEvidenceStatus === 'capability_report_available'
    || evidence.some((e) => e.evidenceType === 'capability_report' && e.evidenceStatus !== 'blocked');
  let packetStatus = 'awaiting_readonly_validation';
  if (risk.riskLevel === 'blocked') packetStatus = 'blocked_by_risk';
  else if (readonlyOk && !capabilityOk) packetStatus = 'awaiting_capability_report';
  else if (readonlyOk && capabilityOk) packetStatus = 'ready_for_operator_review';
  return {
    packetId: String(input.packetId || `packet-${Date.now()}`),
    packetStatus,
    packetMode: 'proposal_only',
    source: String(input.source || 'stephanos_openclaw'),
    createdAt: String(input.createdAt || new Date().toISOString()),
    proposalType,
    proposalTitle: String(input.proposalTitle || 'OpenClaw Proposal Packet'),
    proposalSummary: String(input.proposalSummary || 'Proposal-only review packet. No execution path is enabled.'),
    requestedOutcome: String(input.requestedOutcome || 'operator_review'),
    proposedActions: Array.isArray(input.proposedActions) ? input.proposedActions : [],
    readonlyEvidence: evidence,
    capabilityEvidence: evidence.filter((e) => ['capability_trial', 'capability_report'].includes(e.evidenceType)),
    safetyEvidence: evidence.filter((e) => ['permission_boundary', 'risk_note', 'rollback_note'].includes(e.evidenceType)),
    permissionBoundary: input.permissionBoundary || { executionAllowed: false, selfModificationAllowed: false, operatorApprovalRequired: true },
    riskClassification: risk,
    rollbackPreview: rollback,
    approvalRequirements,
    blockedActions: OPENCLAW_BLOCKED_ACTIONS,
    forbiddenSelfActions: OPENCLAW_FORBIDDEN_SELF_ACTIONS,
    operatorApprovalRequired: true,
    executionAllowed: false,
    selfModificationAllowed: false,
    actionExecutionEligible: false,
    nextAction: risk.riskLevel === 'blocked' ? 'Packet blocked by risk. Remove blocked actions and resubmit for operator review.' : approvalRequirements.nextAction,
  };
}
