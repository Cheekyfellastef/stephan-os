const REVIEW_DECISIONS = new Set([
  'not_reviewed',
  'needs_more_evidence',
  'ready_for_codex_review',
  'rejected',
  'archived',
]);

const NEXT_ACTION_BY_DECISION = {
  not_reviewed: 'Review proposal packet and copy Codex review prompt.',
  needs_more_evidence: 'Add requested evidence before Codex review.',
  ready_for_codex_review: 'Copy Codex prompt for review/planning.',
  rejected: 'Archive or revise proposal packet.',
  archived: 'No active review action.',
};

export function normalizeOpenClawReviewDecision(input = {}, { packetId = 'none' } = {}) {
  const reviewDecision = REVIEW_DECISIONS.has(input?.reviewDecision)
    ? input.reviewDecision
    : 'not_reviewed';
  const now = new Date().toISOString();
  return {
    decisionId: input?.decisionId || `openclaw-review-${packetId}`,
    packetId: input?.packetId || packetId || 'none',
    decisionStatus: input?.decisionStatus || 'recorded',
    decisionMode: 'operator_review_state',
    reviewDecision,
    reviewedBy: ['operator', 'chatgpt', 'codex', 'unknown'].includes(input?.reviewedBy) ? input.reviewedBy : 'unknown',
    reviewNotes: typeof input?.reviewNotes === 'string' ? input.reviewNotes : '',
    reviewEvidence: Array.isArray(input?.reviewEvidence) ? input.reviewEvidence : [],
    reviewReason: typeof input?.reviewReason === 'string' ? input.reviewReason : '',
    createdAt: input?.createdAt || now,
    updatedAt: input?.updatedAt || now,
    executionAllowed: false,
    selfModificationAllowed: false,
    openClawSelfApprovalAllowed: false,
    actionExecutionEligible: false,
    operatorApprovalRequired: true,
    nextAction: NEXT_ACTION_BY_DECISION[reviewDecision],
  };
}
