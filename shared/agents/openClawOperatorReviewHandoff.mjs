function statusText(value = '', fallback = 'unknown') {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : fallback;
}

export function buildOpenClawOperatorReviewHandoff({
  readonlyValidated = false,
  capabilityTrial = {},
  capabilityReport = {},
  oversightProposal = {},
  proposalPacket = {},
  proposalReviewQueue = {},
  approvalGate = {},
  killSwitchEngaged = false,
  paused = false,
} = {}) {
  const trialReady = ['ready', 'report_ready', 'completed'].includes(statusText(capabilityTrial.trialStatus).toLowerCase());
  const reportReady = statusText(capabilityReport.reportStatus).toLowerCase() === 'ready';
  const oversightReady = statusText(oversightProposal.proposalStatus).toLowerCase() === 'ready_for_operator_review';
  const packetReady = statusText(proposalPacket.packetStatus).toLowerCase() === 'ready_for_operator_review';
  const queueReady = statusText(proposalReviewQueue.queueStatus).toLowerCase() === 'ready_for_operator_review';
  const gateReady = statusText(approvalGate.gateStatus).toLowerCase() === 'ready_for_operator_review';
  const riskBlocked = statusText(proposalPacket.riskClassification?.riskStatus || proposalPacket.riskStatus || '').toLowerCase() === 'blocked';
  const submittedPreview = proposalReviewQueue.submissionState === 'submitted_preview' || proposalReviewQueue.submittedPreview === true;

  let handoffStatus = 'blocked_by_readonly_validation';
  let nextAction = 'Validate readonly OpenClaw health/handshake.';

  if (killSwitchEngaged) {
    handoffStatus = 'blocked_by_risk';
    nextAction = 'Kill switch engaged: OpenClaw control plane blocked. Execution remains disabled.';
  } else if (paused) {
    handoffStatus = 'blocked_by_risk';
    nextAction = 'Paused: readonly validation is paused. Execution remains disabled.';
  } else if (!readonlyValidated) {
    handoffStatus = 'blocked_by_readonly_validation';
    nextAction = 'Validate readonly OpenClaw health/handshake.';
  } else if (!reportReady || !trialReady) {
    handoffStatus = 'awaiting_capability_report';
    nextAction = 'Run readonly capability trial.';
  } else if (riskBlocked) {
    handoffStatus = 'blocked_by_risk';
    nextAction = 'Resolve risk blockers before operator review handoff.';
  } else if (submittedPreview) {
    handoffStatus = 'submitted_for_operator_review';
    nextAction = 'Packet submission marker is preview-only; wait for operator decision.';
  } else if (packetReady || queueReady || gateReady || oversightReady) {
    handoffStatus = 'ready_for_operator_review';
    nextAction = (packetReady || queueReady)
      ? 'Submit packet for operator review.'
      : 'Prepare proposal packet for operator review.';
  }

  return {
    handoffStatus,
    reviewQueueStatus: statusText(proposalReviewQueue.queueStatus, 'not_available'),
    packetStatus: statusText(proposalPacket.packetStatus, 'unknown'),
    approvalGateStatus: statusText(approvalGate.gateStatus, 'unknown'),
    executionAllowed: false,
    selfModificationAllowed: false,
    operatorApprovalRequired: true,
    openClawSelfApprovalForbidden: true,
    nextAction,
    submissionMode: submittedPreview ? 'preview_only' : 'not_submitted',
  };
}
