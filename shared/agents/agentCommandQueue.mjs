function asArray(v){return Array.isArray(v)?v:[];}

function createItem(item){
  return {
    operatorReviewRequired: true,
    executionAllowed: false,
    blockers: [], warnings: [], evidence: [],
    ...item,
  };
}

export function buildAgentCommandQueue({agentTaskProjection=null}={}){
  const surface = agentTaskProjection?.operatorSurface || {};
  const packetId = surface.openClawProposalPacket?.packetId || 'none';
  const reviewDecision = surface.openClawReviewDecisionStatus || 'not_reviewed';
  const evidenceRequest = surface.openClawEvidenceRequest || {};
  const codexExport = surface.openClawCodexProposalExport || {};
  const codexResult = surface.openClawCodexReviewResult || {};
  const implementation = surface.openClawImplementationPlan || {};
  const approval = surface.openClawApprovalGateReadiness || {};
  const dryRun = surface.openClawDryRunPlan || {};

  const items = [
    createItem({ itemId:`intent-${packetId}`, itemType:'operator_intent', label:'Operator intent captured', status:'ready_for_review', sourceAgent:'stephanos', targetAgent:'openclaw', riskLevel:'guarded', packetId, nextAction:'Review intent and packet scope.' }),
    createItem({ itemId:`packet-${packetId}`, itemType:'openclaw_proposal_packet', label:'OpenClaw proposal packet', status: surface.openClawProposalPacket?.packetStatus === 'ready_for_operator_review' ? 'ready_for_review' : 'draft', sourceAgent:'openclaw', targetAgent:'operator', riskLevel:surface.openClawProposalRisk?.riskLevel || 'guarded', packetId, nextAction: surface.openClawReviewDecisionNextAction || 'Review proposal packet.' }),
    createItem({ itemId:`codex-prompt-${packetId}`, itemType:'codex_review_prompt', label:'Codex review prompt export', status: reviewDecision === 'ready_for_codex_review' ? 'ready_for_codex_review' : 'draft', sourceAgent:'openclaw', targetAgent:'codex', riskLevel:'guarded', packetId, nextAction: codexExport.nextAction || 'Copy prompt for Codex review.', evidence: asArray(codexExport.includedEvidence) }),
    createItem({ itemId:`codex-result-${packetId}`, itemType:'codex_review_result', label:'Codex review result intake', status: codexResult.resultStatus === 'not_received' ? 'waiting_for_codex_result' : 'ready_for_implementation_planning', sourceAgent:'codex', targetAgent:'stephanos', riskLevel:'guarded', packetId, nextAction: codexResult.nextAction || 'Import Codex review result.' }),
    createItem({ itemId:`impl-${packetId}`, itemType:'implementation_plan', label:'Implementation planning packet', status: implementation.planStatus === 'ready_for_operator_review' ? 'ready_for_approval_review' : 'draft', sourceAgent:'stephanos', targetAgent:'operator', riskLevel:'guarded', packetId, nextAction: implementation.nextAction || 'Review implementation plan.' }),
    createItem({ itemId:`evidence-${packetId}`, itemType:'evidence_request', label:'Evidence request', status: evidenceRequest.requestStatus === 'requested' ? 'needs_more_evidence' : 'archived', sourceAgent:'operator', targetAgent:'openclaw', riskLevel:'guarded', packetId, nextAction: evidenceRequest.nextAction || 'Attach evidence note.', blockers: asArray(evidenceRequest.missingEvidence) }),
    createItem({ itemId:`approval-${packetId}`, itemType:'approval_readiness', label:'Approval readiness', status: approval.readinessStatus === 'ready_for_operator_review' ? 'ready_for_approval_review' : 'draft', sourceAgent:'stephanos', targetAgent:'operator', riskLevel:approval.riskLevel || 'guarded', packetId, nextAction: approval.nextAction || 'Review approval readiness.' }),
    createItem({ itemId:`dryrun-${packetId}`, itemType:'dry_run_preview', label:'Dry-run preview', status: dryRun.planStatus === 'ready_for_operator_preview' ? 'dry_run_preview_ready' : 'draft', sourceAgent:'stephanos', targetAgent:'operator', riskLevel:'guarded', packetId, nextAction: dryRun.nextAction || 'Review dry-run preview.' }),
  ];
  const blockedItems = items.filter((i)=>i.status==='blocked').length;
  const readyCount = items.filter((i)=>['ready_for_review','ready_for_codex_review','ready_for_implementation_planning','ready_for_approval_review','dry_run_preview_ready'].includes(i.status)).length;
  return {
    queueStatus: blockedItems>0?'blocked':readyCount>0?'active':'idle',
    activeItemId: items.find((i)=>i.status!=='archived')?.itemId || 'none',
    items,
    itemCount: items.length,
    readyCount,
    blockedCount: blockedItems,
    reviewRequiredCount: items.filter((i)=>i.operatorReviewRequired).length,
    nextAction: items.find((i)=>i.status==='ready_for_codex_review')?.nextAction || items[0].nextAction,
    executionAllowed: false,
  };
}
