function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstOf(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
}

function summarizePermissionDiff(permissionDiff = null) {
  const diff = permissionDiff && typeof permissionDiff == "object" ? permissionDiff : {};
  return firstOf(
    diff.diffSummary,
    diff.summary,
    diff.diffStatus ? `Permission diff status: ${diff.diffStatus}` : '',
    'Permission diff preview pending.',
  );
}

export function buildOpenClawCodexProposalExport({
  proposalPacket = null,
  operatorReviewQueue = null,
  approvalRequirements = null,
  risk = null,
  rollback = null,
  permissionDiff = null,
  auditPreview = [],
  reviewDecision = null,
  evidenceRequest = {},
  evidenceAttachments = [],
} = {}) {
  const packetStatus = String(proposalPacket?.packetStatus || '').toLowerCase();
  const sourcePacketId = proposalPacket?.packetId || 'none';
  const packetReady = packetStatus === 'ready_for_operator_review';
  const riskLevel = String(risk?.riskLevel || proposalPacket?.riskClassification?.riskLevel || 'guarded');
  const blockedByRisk = riskLevel === 'critical';
  const exportStatus = !proposalPacket
    ? 'missing_packet'
    : blockedByRisk
      ? 'blocked_by_risk'
      : packetReady
        ? 'generated'
        : 'unavailable';

  const requiredTests = asArray(proposalPacket?.requiredTests).length > 0
    ? asArray(proposalPacket.requiredTests)
    : ['node --test shared/agents/*.test.mjs shared/project/*.test.mjs', 'node --test stephanos-ui/src/components/OpenClawTile*.test.mjs'];
  const requiredBuildSteps = asArray(proposalPacket?.requiredBuildSteps).length > 0
    ? asArray(proposalPacket.requiredBuildSteps)
    : ['npm run stephanos:build', 'npm run stephanos:verify'];

  const approvalList = asArray(approvalRequirements?.requiredApprovals).length > 0
    ? asArray(approvalRequirements.requiredApprovals)
    : asArray(proposalPacket?.approvalRequirements?.requiredApprovals);

  const forbiddenSelfActions = Array.from(new Set([
    ...asArray(proposalPacket?.forbiddenSelfActions),
    'approve_own_proposal',
    'execute_without_operator_approval',
  ]));

  const blockedActions = asArray(proposalPacket?.blockedActions).length > 0
    ? asArray(proposalPacket.blockedActions)
    : ['execute_commands', 'edit_repository', 'create_commits', 'create_pull_requests'];

  const evidenceIncomplete = ['requested','partially_satisfied','blocked'].includes(String(evidenceRequest.requestStatus || 'none'));
  const promptLines = [
    'OpenClaw Proposal Packet → Codex Review/Planning Prompt (v1)',
    `Project context: Stephanos OpenClaw proposal-only workflow. Packet id: ${sourcePacketId}.`,
    `Exact proposed task: ${proposalPacket?.proposalTitle || 'Review and plan the proposed OpenClaw packet change.'}`,
    `Summary: ${proposalPacket?.proposalSummary || 'Proposal-only packet for operator review; non-executing.'}`,
    `Allowed scope: analyze proposal packet, inspect listed files, propose implementation plan, produce safe review notes.`,
    `Blocked scope: ${blockedActions.join(', ') || 'none'}.`,
    `Files to inspect: ${(asArray(proposalPacket?.proposedFiles).join(', ') || 'shared/agents/**, stephanos-ui/src/components/OpenClawTile.jsx')}.`,
    `Required checks: ${requiredTests.join(' | ')}.`,
    `Build/verify commands: ${requiredBuildSteps.join(' | ')}.`,
    'Safety constraints: no execution path changes; no repo mutation by OpenClaw; maintain operator-gated approval boundaries.',
    'OpenClaw cannot execute.',
    'OpenClaw cannot approve itself.',
    `Risk classification: ${riskLevel}.`,
    `Rollback plan: ${firstOf(rollback?.rollbackSummary, proposalPacket?.rollbackPreview?.rollbackSummary, 'Rollback via operator-managed revert of touched files.')}`,
    `Approval requirements: ${approvalList.join(', ') || 'operator approval required before any future execution-stage design.'}`,
    `Forbidden self-actions: ${forbiddenSelfActions.join(', ') || 'none'}.`,
    'Do not enable OpenClaw execution in this task unless the operator explicitly requests a future execution-stage design.',
    'Definition of done: produce review findings, implementation plan, risks, rollback validation, and required test/check results.',
    `Evidence request status: ${evidenceRequest.requestStatus || 'none'}.`,
    `Evidence missing items: ${asArray(evidenceRequest.missingEvidence).join(', ') || 'none'}.`,
    `Evidence attachment summaries: ${asArray(evidenceAttachments).map((a)=>a.summary || a.title || a.evidenceType).join(' | ') || 'none'}.`,
    evidenceIncomplete ? 'Evidence is incomplete. Review only; do not implement unless operator explicitly asks.' : 'Evidence appears satisfied for review context.',
    'Required report format: Summary, Files/Scope, Risks, Rollback, Required Checks, Safety Confirmations, Open Questions.',
  ];

  const decision = reviewDecision?.reviewDecision || 'not_reviewed';
  const nextAction = decision === 'ready_for_codex_review'
    ? 'Copy Codex prompt for review/planning.'
    : decision === 'needs_more_evidence'
      ? 'Evidence incomplete: add requested proposal evidence before Codex review.'
      : decision === 'rejected' || decision === 'archived'
        ? 'Packet inactive for active Codex handoff; use audit copy only if needed.'
        : exportStatus === 'generated'
    ? 'Review proposal packet first, then copy prompt for Codex/ChatGPT review.'
    : exportStatus === 'blocked_by_risk'
      ? 'Resolve critical risk before generating Codex export.'
      : exportStatus === 'missing_packet'
        ? 'Generate proposal packet first.'
        : 'Advance packet to ready_for_operator_review.';

  return {
    exportId: sourcePacketId === 'none' ? 'openclaw-codex-export-none' : `openclaw-codex-export-${sourcePacketId}`,
    exportStatus,
    exportMode: 'manual_prompt',
    sourcePacketId,
    title: proposalPacket?.proposalTitle || 'OpenClaw Codex Proposal Export v1',
    summary: proposalPacket?.proposalSummary || 'Codex-ready proposal export for operator handoff only.',
    codexPrompt: promptLines.join('\n'),
    includedEvidence: asArray(proposalPacket?.readonlyEvidence),
    riskSummary: firstOf(risk?.riskSummary, `Risk level: ${riskLevel}`),
    permissionDiffSummary: summarizePermissionDiff(permissionDiff),
    rollbackSummary: firstOf(rollback?.rollbackSummary, proposalPacket?.rollbackPreview?.rollbackSummary, 'Rollback summary pending.'),
    approvalRequirements: approvalList,
    blockedActions,
    forbiddenSelfActions,
    requiredTests,
    requiredBuildSteps,
    operatorInstructions: 'Copy prompt and hand to Codex/ChatGPT. Keep proposal-only and operator-approved flow.',
    executionAllowed: false,
    openClawExecutionAllowed: false,
    operatorApprovalRequired: true,
    nextAction,
    queueStatus: operatorReviewQueue?.queueStatus || 'awaiting_packet',
    reviewDecision: decision,
    evidenceRequestStatus: evidenceRequest.requestStatus || 'none',
    evidenceIncomplete,
    evidenceAttachmentSummaries: asArray(evidenceAttachments).map((a)=>a.summary || a.title || a.evidenceType),
    auditPreviewCount: asArray(auditPreview).length,
  };
}
