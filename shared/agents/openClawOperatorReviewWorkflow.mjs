function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const ALLOWED_REVIEW_ACTIONS = [
  'copy_review_packet',
  'copy_codex_prompt',
  'mark_needs_more_evidence',
  'mark_rejected',
  'mark_ready_for_codex_review',
  'archive_packet',
];

const FORBIDDEN_REVIEW_ACTIONS = [
  'approve_execution',
  'apply_packet',
  'change_openclaw_permissions',
  'run_commands',
  'edit_files',
  'write_git',
  'control_browser',
  'execute_autonomously',
];

export function buildOpenClawOperatorReviewWorkflow({
  reviewQueue = {},
  codexProposalExport = {},
  priorDecision = 'not_reviewed',
  reviewedBy = 'unknown',
  reviewNotes = '',
  reviewEvidence = [],
} = {}) {
  const activePacketId = reviewQueue.activePacketId || 'none';
  const queueReady = reviewQueue.queueStatus === 'ready_for_operator_review';
  const exportAvailable = codexProposalExport.exportStatus === 'generated';
  const missingEvidence = asArray(reviewQueue.missingEvidence);
  const safeDecision = queueReady && exportAvailable && missingEvidence.length === 0
    ? (priorDecision === 'ready_for_codex_review' ? priorDecision : 'not_reviewed')
    : (priorDecision === 'archived' || priorDecision === 'rejected' || priorDecision === 'needs_more_evidence' ? priorDecision : 'not_reviewed');

  const workflowStatus = activePacketId === 'none'
    ? 'awaiting_packet'
    : safeDecision === 'archived'
      ? 'archived'
      : safeDecision === 'rejected'
        ? 'rejected'
        : safeDecision === 'needs_more_evidence'
          ? 'needs_more_evidence'
          : queueReady
            ? 'ready_for_operator_review'
            : reviewQueue.queueStatus || 'needs_more_evidence';

  return {
    workflowStatus,
    workflowMode: 'manual_review',
    activePacketId,
    reviewDecision: safeDecision,
    reviewedBy,
    reviewNotes,
    reviewEvidence: asArray(reviewEvidence),
    allowedReviewActions: ALLOWED_REVIEW_ACTIONS,
    forbiddenReviewActions: FORBIDDEN_REVIEW_ACTIONS,
    nextAction: safeDecision === 'ready_for_codex_review'
      ? 'Copy Codex review prompt for manual ChatGPT/Codex review.'
      : queueReady
        ? (exportAvailable ? 'Review proposal packet and copy Codex review prompt.' : 'Generate/copy Codex proposal export for review.')
        : (reviewQueue.nextAction || 'Collect missing review evidence.'),
    executionAllowed: false,
    operatorApprovalRequired: true,
    openClawSelfApprovalAllowed: false,
  };
}
