export function buildOpenClawProposalReviewQueue({ proposalPacket = {}, evidence = {}, risk = {}, rollback = {}, approvalRequirements = {} } = {}) {
  const readyForReview = proposalPacket.packetStatus === 'ready_for_operator_review';
  return {
    queueMode: 'review_only',
    queueStatus: readyForReview ? 'ready_for_operator_review' : 'awaiting_packet_readiness',
    executionAllowed: false,
    operatorApprovalRequired: true,
    selfApprovalAllowed: false,
    actionExecutionEligible: false,
    itemCount: proposalPacket.packetId ? 1 : 0,
    items: proposalPacket.packetId ? [{
      packetId: proposalPacket.packetId,
      packetStatus: proposalPacket.packetStatus || 'unknown',
      evidenceStatus: evidence.status || 'unknown',
      riskLevel: risk.riskLevel || 'guarded',
      rollbackStatus: rollback.rollbackStatus || 'unknown',
      approvalStatus: approvalRequirements.approvalStatus || 'unknown',
      reviewMode: 'operator_only',
    }] : [],
    nextAction: readyForReview
      ? 'Review proposal packet in operator queue.'
      : 'Complete packet readiness signals before operator queue review.',
  };
}
