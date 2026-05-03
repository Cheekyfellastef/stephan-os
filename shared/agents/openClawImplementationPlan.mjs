function asArray(v){return Array.isArray(v)?v.filter(Boolean):[];}
function asText(v){return typeof v==='string'?v.trim():'';}

export function buildOpenClawImplementationPlan({ packetId='none', reviewResult={} } = {}) {
  const status = reviewResult?.resultStatus || 'not_received';
  const blocked = asArray(reviewResult?.blockers).length > 0;
  const needsEvidence = status === 'needs_more_evidence';
  const ready = status === 'ready_for_implementation_planning';
  const planStatus = blocked ? 'blocked_by_risk' : needsEvidence ? 'needs_more_evidence' : ready ? 'ready_for_operator_review' : 'unavailable';
  return {
    planId: `openclaw-implementation-plan-${packetId}`,
    packetId,
    sourceReviewResultId: reviewResult?.resultId || 'none',
    planStatus,
    planMode: 'planning_only',
    implementationSummary: asText(reviewResult?.reviewSummary),
    proposedFilesToInspect: asArray(reviewResult?.recommendedFilesToInspect || reviewResult?.proposedFilesToInspect),
    proposedFilesToChange: asArray(reviewResult?.recommendedFilesToChange || reviewResult?.proposedFilesToChange),
    blockedFiles: asArray(reviewResult?.blockedFiles),
    proposedTests: asArray(reviewResult?.requiredTests),
    proposedBuildChecks: asArray(reviewResult?.requiredBuildCommands),
    rolloutPlan: asArray(reviewResult?.rolloutPlan),
    rollbackPlan: asArray(reviewResult?.rollbackPlan),
    risks: asArray(reviewResult?.risks),
    assumptions: asArray(reviewResult?.assumptions),
    openQuestions: asArray(reviewResult?.openQuestions),
    operatorApprovalRequired: true,
    executionAllowed: false,
    actionExecutionEligible: false,
    nextAction: planStatus === 'ready_for_operator_review' ? 'Submit implementation planning packet for operator review.' : planStatus === 'needs_more_evidence' ? 'Collect missing evidence before planning review.' : planStatus === 'blocked_by_risk' ? 'Resolve blocked risk areas before planning review.' : 'Ingest Codex review result before creating implementation plan.',
  };
}
