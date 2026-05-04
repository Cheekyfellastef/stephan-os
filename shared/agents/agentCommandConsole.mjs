function asArray(v){return Array.isArray(v)?v:[];}

export function buildAgentCommandConsoleProjection({agentTaskProjection=null, telemetrySummary=null, promptBuilderSummary=null, projectProgressNextActions=[], missionHandoffMilestones=[], finalRouteTruth=null}={}){
  const surface = agentTaskProjection?.operatorSurface || {};
  const reviewDecision = String(surface.openClawReviewDecisionStatus || 'not_reviewed');
  const codexExport = surface.openClawCodexProposalExport || {};
  const codexResult = surface.openClawCodexReviewResult || {};
  const implementation = surface.openClawImplementationPlan || {};
  const approval = surface.openClawApprovalGateReadiness || {};
  const dryRun = surface.openClawDryRunPlan || {};
  const evidenceRequest = surface.openClawEvidenceRequest || {};
  const workflow = surface.openClawOperatorReviewWorkflow || {};
  const reviewQueue = surface.openClawOperatorReviewQueue || {};
  const proposalPacket = surface.openClawProposalPacket || {};
  const canonicalReviewReady = proposalPacket.packetStatus === 'ready_for_operator_review'
    || reviewQueue.queueStatus === 'ready_for_operator_review'
    || workflow.workflowStatus === 'ready_for_operator_review';
  const hasCanonicalBlockers = asArray(surface.blockers).length > 0;
  const missingEvidence = asArray(evidenceRequest.missingEvidence);

  let commandConsoleMode = 'observer';
  if (hasCanonicalBlockers && !canonicalReviewReady) commandConsoleMode = 'blocked';
  else if (dryRun.planStatus === 'ready_for_operator_preview') commandConsoleMode = 'dry_run_preview';
  else if (approval.readinessStatus === 'ready_for_operator_review') commandConsoleMode = 'approval_readiness';
  else if (implementation.planStatus === 'ready_for_operator_review') commandConsoleMode = 'implementation_planning';
  else if (codexResult.resultStatus && codexResult.resultStatus !== 'not_received') commandConsoleMode = 'codex_review';
  else if (canonicalReviewReady || reviewDecision === 'ready_for_codex_review' || codexExport.exportStatus === 'generated') commandConsoleMode = 'proposal_review';

  const activeAgent = commandConsoleMode === 'codex_review' || commandConsoleMode === 'implementation_planning' ? 'codex'
    : commandConsoleMode === 'proposal_review' ? 'openclaw' : 'stephanos';

  return {
    commandConsoleStatus: hasCanonicalBlockers && !canonicalReviewReady ? 'blocked' : 'ready',
    commandConsoleMode,
    activeAgent,
    activePacketId: codexExport.sourcePacketId || surface.openClawProposalPacket?.packetId || 'none',
    activeMissionId: surface.handoffPacketSummary || 'none',
    activeStage: commandConsoleMode,
    nextBestAction: surface.openClawReviewDecisionNextAction || codexExport.nextAction || surface.nextAction?.title || 'Review mission workflow state.',
    operatorActionRequired: true,
    blockers: [...asArray(surface.blockers), ...missingEvidence].filter(Boolean),
    warnings: asArray(surface.warnings),
    evidence: [
      ...(codexExport.includedEvidence || []),
      ...asArray(surface.openClawReviewDecisionEvidence),
      ...asArray(missionHandoffMilestones),
    ].filter(Boolean),
    executionAllowed: false,
    openClawExecutionAllowed: false,
    codexExecutionMode: codexExport.exportMode === 'manual_prompt' ? 'manual_prompt' : (codexExport.exportStatus ? 'review_only' : 'unavailable'),
    approvalRequired: true,
    safetyPosture: surface.openClawControlledExecutionGate?.controlledExecutionStatus || 'future_gated',
    missionSummary: {
      reviewDecision,
      codexExportStatus: codexExport.exportStatus || 'unavailable',
      codexReviewStatus: codexResult.resultStatus || 'not_received',
      implementationPlanStatus: implementation.planStatus || 'not_ready',
      approvalReadinessStatus: approval.readinessStatus || 'not_ready',
      dryRunPreviewStatus: dryRun.planStatus || 'not_ready',
      telemetryStatus: telemetrySummary?.status || 'unknown',
      promptBuilderStatus: promptBuilderSummary?.status || 'unknown',
      nextActions: asArray(projectProgressNextActions),
      runtimeRoute: finalRouteTruth?.finalRoute || finalRouteTruth?.route || 'unknown',
      controlledExecution: 'future_gated',
    },
  };
}
