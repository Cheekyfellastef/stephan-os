function summarizeAudit(auditPreview = []) {
  return {
    auditPreviewStatus: Array.isArray(auditPreview) && auditPreview.length > 0 ? 'preview_ready' : 'missing_preview',
    auditEventCount: Array.isArray(auditPreview) ? auditPreview.length : 0,
  };
}

export function buildOpenClawOperatorReviewQueue({
  openClawProposalPacket = {},
  openClawProposalEvidence = {},
  openClawProposalRisk = {},
  openClawProposalApprovalRequirements = {},
  openClawProposalRollback = {},
  openClawPermissionDiff = {},
  openClawAuditLedgerPreview = [],
  openClawOversightProposal = {},
} = {}) {
  const packetId = openClawProposalPacket.packetId || 'none';
  const packetStatus = String(openClawProposalPacket.packetStatus || 'awaiting_packet');
  const riskLevel = String(openClawProposalRisk.riskLevel || 'guarded');
  const evidenceStatus = String(openClawProposalEvidence.status || 'missing_evidence');
  const approvalStatus = String(openClawProposalApprovalRequirements.approvalStatus || 'awaiting_requirements');
  const rollbackStatus = String(openClawProposalRollback.rollbackStatus || 'missing_preview');
  const permissionDiffStatus = String(openClawPermissionDiff.diffStatus || 'missing_preview');
  const { auditPreviewStatus, auditEventCount } = summarizeAudit(openClawAuditLedgerPreview);

  let queueStatus = 'awaiting_packet';
  if (!openClawProposalPacket.packetId) queueStatus = 'empty';
  else if (riskLevel === 'high') queueStatus = 'blocked_by_risk';
  else if (!['ready', 'sufficient', 'provided'].includes(evidenceStatus)) queueStatus = 'needs_more_evidence';
  else if (packetStatus === 'ready_for_operator_review') queueStatus = 'ready_for_operator_review';

  const queueItem = openClawProposalPacket.packetId ? {
    packetId,
    title: openClawProposalPacket.proposalTitle || 'OpenClaw proposal packet',
    proposalType: openClawProposalPacket.proposalType || 'observe_capability',
    requestedOutcome: openClawProposalPacket.requestedOutcome || 'operator_review',
    riskLevel,
    packetStatus,
    evidenceStatus,
    approvalStatus,
    rollbackStatus,
    permissionDiffStatus,
    auditPreviewStatus,
    createdAt: openClawProposalPacket.createdAt || new Date(0).toISOString(),
    source: openClawProposalPacket.source || 'unknown',
    blockedActions: openClawProposalPacket.blockedActions || [],
    forbiddenSelfActions: openClawProposalPacket.forbiddenSelfActions || [],
    nextAction: openClawProposalPacket.nextAction || 'Operator review only.',
  } : null;

  return {
    queueId: `openclaw-operator-review-${packetId}`,
    queueStatus,
    queueMode: 'operator_review_only',
    packetCount: queueItem ? 1 : 0,
    activePacketId: queueItem ? queueItem.packetId : 'none',
    packets: queueItem ? [queueItem] : [],
    reviewStatus: 'not_reviewed',
    riskSummary: { riskLevel, riskStatus: openClawProposalRisk.riskStatus || 'under_review' },
    evidenceSummary: { evidenceStatus, evidenceCount: (openClawProposalPacket.readonlyEvidence || []).length },
    approvalSummary: { approvalStatus, openClawSelfApprovalAllowed: false },
    rollbackSummary: { rollbackStatus },
    permissionDiffSummary: { permissionDiffStatus },
    auditSummary: { auditPreviewStatus, auditEventCount },
    operatorApprovalRequired: true,
    executionAllowed: false,
    selfModificationAllowed: false,
    actionExecutionEligible: false,
    openClawSelfApprovalAllowed: false,
    operatorReviewStatus: 'not_reviewed',
    operatorReviewMode: 'manual_review',
    reviewedBy: 'unknown',
    reviewDecision: 'not_reviewed',
    reviewNotes: '',
    reviewEvidence: [],
    nextAction: queueStatus === 'ready_for_operator_review'
      ? 'Route packet for human/ChatGPT/Codex manual review.'
      : (openClawOversightProposal.nextAction || 'Collect missing readiness evidence.'),
  };
}
