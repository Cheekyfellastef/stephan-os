function summarizeAudit(auditPreview = []) {
  return {
    auditPreviewStatus: Array.isArray(auditPreview) && auditPreview.length > 0 ? 'preview_ready' : 'missing_preview',
    auditEventCount: Array.isArray(auditPreview) ? auditPreview.length : 0,
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
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
  openClawCodexProposalExport = {},
  openClawReviewDecision = {},
  openClawEvidenceRequest = {},
  openClawEvidenceAttachments = [],
} = {}) {
  const packetId = openClawProposalPacket.packetId || 'none';
  const packetStatus = String(openClawProposalPacket.packetStatus || 'awaiting_packet');
  const riskStatus = String(openClawProposalRisk.riskStatus || 'under_review');
  const riskLevel = String(openClawProposalRisk.riskLevel || 'guarded');
  const evidenceStatus = String(openClawProposalEvidence.status || 'missing_evidence');
  const approvalStatus = String(openClawProposalApprovalRequirements.approvalStatus || 'awaiting_requirements');
  const rollbackStatus = String(openClawProposalRollback.rollbackStatus || 'missing_preview');
  const permissionDiffStatus = String(openClawPermissionDiff.diffStatus || 'missing_preview');
  const codexExportStatus = String(openClawCodexProposalExport.exportStatus || 'unavailable');
  const { auditPreviewStatus, auditEventCount } = summarizeAudit(openClawAuditLedgerPreview);

  const missingEvidence = [];
  if (packetStatus !== 'ready_for_operator_review') missingEvidence.push('proposal_packet_not_ready');
  if (!['capability_report_available', 'ready', 'sufficient', 'provided'].includes(evidenceStatus)) missingEvidence.push('capability_report_missing');
  if (approvalStatus !== 'ready_for_operator_review') missingEvidence.push('approval_requirements_not_ready');
  if (rollbackStatus !== 'preview_ready') missingEvidence.push('rollback_preview_missing');
  if (permissionDiffStatus !== 'preview_ready') missingEvidence.push('permission_diff_preview_missing');
  if (auditPreviewStatus !== 'preview_ready') missingEvidence.push('audit_preview_missing');
  const evidenceMissing = asArray(openClawEvidenceRequest.missingEvidence);
  if (evidenceMissing.length > 0) missingEvidence.push(...evidenceMissing.map((m)=>`evidence_request:${m}`));

  const availableEvidence = [
    `packet:${packetStatus}`,
    `evidence:${evidenceStatus}`,
    `approval:${approvalStatus}`,
    `rollback:${rollbackStatus}`,
    `permission_diff:${permissionDiffStatus}`,
    `audit:${auditPreviewStatus}`,
  ];

  let queueStatus = 'awaiting_packet';
  if (!openClawProposalPacket.packetId) queueStatus = packetStatus === 'awaiting_packet' ? 'awaiting_packet' : 'empty';
  else if (riskStatus === 'blocked' || riskLevel === 'critical' || riskLevel === 'high') queueStatus = 'blocked_by_risk';
  else if (missingEvidence.length === 0) queueStatus = 'ready_for_operator_review';
  else queueStatus = 'needs_more_evidence';

  return {
    queueId: `openclaw-operator-review-${packetId}`,
    queueStatus,
    queueMode: 'operator_review_only',
    activePacketId: packetId,
    reviewStatus: openClawReviewDecision.reviewDecision || 'not_reviewed',
    missingEvidence,
    availableEvidence,
    reviewBlockers: queueStatus === 'blocked_by_risk' ? [openClawProposalRisk.riskSummary || `Risk level ${riskLevel} requires mitigation.`] : [],
    reviewWarnings: asArray(openClawProposalRisk.riskWarnings),
    riskSummary: { riskLevel, riskStatus, riskSummary: openClawProposalRisk.riskSummary || 'Risk under operator review.' },
    approvalSummary: { approvalStatus, requiredApprovals: asArray(openClawProposalApprovalRequirements.requiredApprovals), openClawSelfApprovalAllowed: false },
    rollbackSummary: { rollbackStatus, rollbackSummary: openClawProposalRollback.rollbackSummary || 'Rollback preview pending.' },
    permissionDiffSummary: { permissionDiffStatus, diffSummary: openClawPermissionDiff.diffSummary || 'Permission diff preview pending.' },
    auditSummary: { auditPreviewStatus, auditEventCount },
    codexExportStatus,
    evidenceRequests: openClawEvidenceRequest.requestStatus && openClawEvidenceRequest.requestStatus !== 'none' ? [openClawEvidenceRequest] : [],
    attachedEvidence: asArray(openClawEvidenceAttachments),
    executionAllowed: false,
    selfModificationAllowed: false,
    actionExecutionEligible: false,
    openClawSelfApprovalAllowed: false,
    operatorApprovalRequired: true,
    nextAction: queueStatus === 'ready_for_operator_review'
      ? (openClawReviewDecision.nextAction || 'Review proposal packet / Copy Codex review prompt.')
      : queueStatus === 'needs_more_evidence'
        ? `Collect missing evidence: ${missingEvidence.join(', ')}`
        : queueStatus === 'blocked_by_risk'
          ? 'Resolve risk blockers before operator review.'
          : (openClawOversightProposal.nextAction || 'Prepare proposal packet for operator review.'),
  };
}
