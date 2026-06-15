export const MISSION_EVIDENCE_EVENT_TYPES = Object.freeze([
  'intent_captured','mission_spec_generated','memory_context_applied','architecture_context_applied','openclaw_delegation_previewed','finish_authority_assessed','codex_handoff_generated','pr_evidence_parsed','verification_return_received','verification_judged','task_finisher_planned','memory_librarian_candidates_created','proof_of_done_pending','operator_decision_required','codex_pr_repair_contract_created','codex_pr_repair_blocked','codex_pr_repair_pushed','codex_pr_remote_checks_green','codex_pr_remote_checks_failed','codex_pr_repair_complete','manual_emergency_intervention_required',
]);

function asText(v,f=''){ const t=String(v??'').trim(); return t||f; }
const has = (v)=>asText(v)!=='';

function entry(base, i, data){
  const ts = new Date(new Date(base).getTime()+i*1000).toISOString();
  return { timestamp: ts, ...data, entryId: `${data.missionId||'mission'}-${data.eventType}-${i+1}`};
}

export function buildMissionEvidenceLedger({ missionSpec = {}, prEvidenceConnector = null, verificationReturnText = '', verificationJudge = null, taskFinisherPlan = null, memoryLibrarianQueue = null } = {}) {
  const missionId = asText(missionSpec.missionId, 'mission-unknown');
  const base = asText(missionSpec.generatedAt, new Date(0).toISOString());
  const entries = [];
  let i = 0;
  const push = (d)=>entries.push(entry(base, i++, { missionId, evidenceStatus:'observed', source:'mission_console', confidence:'high', warningLevel:'none', requiresOperatorReview:false, relatedSubsystems:[], relatedFiles:[], linkedCandidateId:'', rawReference:'', ...d }));
  if (has(missionSpec.rawIntent)) push({eventType:'intent_captured', summary:'Operator intent captured.', source:'mission_spec', rawReference: missionSpec.rawIntent});
  push({eventType:'mission_spec_generated', summary:'Mission spec generated.', source:'mission_spec'});
  if ((missionSpec.missionMemoryInfluence||[]).length>0) push({eventType:'memory_context_applied', summary:'Mission memory context applied.', source:'mission_memory', relatedSubsystems:['mission-memory']});
  if ((missionSpec.repoArchitectureContext?.affectedSubsystems||[]).length>0) push({eventType:'architecture_context_applied', summary:'Repo architecture context applied.', source:'repo_architecture', relatedSubsystems: missionSpec.repoArchitectureContext.affectedSubsystems});
  if (missionSpec.openClawDelegation) push({eventType:'openclaw_delegation_previewed', summary:'OpenClaw delegation envelope prepared.', source:'openclaw_delegation', requiresOperatorReview:true});
  if (missionSpec.finishAuthority) push({eventType:'finish_authority_assessed', summary:`Finish authority status: ${asText(missionSpec.finishAuthority.finishAuthorityStatus,'not_granted')}.`, source:'finish_authority', warningLevel: missionSpec.finishAuthority.mergeAuthorityIncluded ? 'none':'warning', evidenceStatus: missionSpec.finishAuthority.mergeAuthorityIncluded ? 'observed':'warning'});
  if (has(missionSpec.codexHandoffPrompt || missionSpec.codexPrompt)) push({eventType:'codex_handoff_generated', summary:'Codex handoff generated.', source:'intent_to_build'});
  if (prEvidenceConnector?.parsed || prEvidenceConnector?.prEvidence) push({eventType:'pr_evidence_parsed', summary:'PR evidence parsed from operator input.', source:'pr_evidence_connector'});
  if (has(verificationReturnText)) push({eventType:'verification_return_received', summary:'Verification return text received.', source:'verification_return'});
  if (verificationJudge) push({eventType:'verification_judged', summary:`Verification judge: ${asText(verificationJudge.judgment,'unknown')}.`, source:'verification_judge', warningLevel:(verificationJudge.blockers||[]).length?'blocked':(verificationJudge.warnings||[]).length?'warning':'none', evidenceStatus:(verificationJudge.blockers||[]).length?'blocked':'observed'});
  if (taskFinisherPlan || missionSpec.taskFinisherPlan) push({eventType:'task_finisher_planned', summary:'Task finisher plan prepared.', source:'task_finisher'});
  if ((memoryLibrarianQueue?.queue||missionSpec.memoryLibrarian?.queue||[]).length>0) push({eventType:'memory_librarian_candidates_created', summary:'Memory librarian candidates available.', source:'memory_librarian', linkedCandidateId: (memoryLibrarianQueue?.queue||missionSpec.memoryLibrarian?.queue||[])[0]?.id||''});
  const repair = missionSpec.codexPrRepairContract || {};
  if (repair.contractId) {
    push({eventType:'codex_pr_repair_contract_created', summary:'Codex PR repair contract created.', source:'codex_pr_repair'});
    if ((repair.blockers||[]).length>0) push({eventType:'codex_pr_repair_blocked', summary:`Codex PR repair blocked: ${(repair.blockers||[]).join(', ')}`, source:'codex_pr_repair', evidenceStatus:'blocked', warningLevel:'blocked', requiresOperatorReview:true});
    if (repair.livePrHeadChanged) push({eventType:'codex_pr_repair_pushed', summary:'Live PR head changed after repair push.', source:'codex_pr_repair'});
    if (repair.remoteChecksVerified && repair.githubEvidenceStatus==='checks_green') push({eventType:'codex_pr_remote_checks_green', summary:'Remote PR checks verified green.', source:'codex_pr_repair'});
    if (repair.remoteChecksVerified && repair.githubEvidenceStatus==='checks_failed') push({eventType:'codex_pr_remote_checks_failed', summary:'Remote PR checks verified failed.', source:'codex_pr_repair', evidenceStatus:'blocked', warningLevel:'blocked'});
    if (repair.repairCompleteness==='repair_complete') push({eventType:'codex_pr_repair_complete', summary:'Codex PR repair complete.', source:'codex_pr_repair'});
    if (repair.operatorManualInterventionRequired==='decision_required') push({eventType:'manual_emergency_intervention_required', summary:'Operator must choose repair path; manual emergency intervention is optional.', source:'operator_console', requiresOperatorReview:true, warningLevel:'warning'});
  }

  if (!has(verificationReturnText)) push({eventType:'proof_of_done_pending', summary:'Proof-of-done pending: verification return missing.', source:'verification_return', evidenceStatus:'pending', warningLevel:'warning', requiresOperatorReview:true});
  if (!missionSpec.finishAuthority?.mergeAuthorityIncluded) push({eventType:'operator_decision_required', summary:'Merge authority not granted; operator decision required.', source:'finish_authority', evidenceStatus:'pending', warningLevel:'warning', requiresOperatorReview:true});

  const warningCount = entries.filter((e)=>e.warningLevel==='warning').length;
  const blockerCount = entries.filter((e)=>e.warningLevel==='blocked' || e.evidenceStatus==='blocked').length;
  const pendingOperatorReviewCount = entries.filter((e)=>e.requiresOperatorReview).length;
  const hasPr = entries.some((e)=>e.eventType==='pr_evidence_parsed');
  const hasVr = entries.some((e)=>e.eventType==='verification_return_received');
  const hasJudge = entries.some((e)=>e.eventType==='verification_judged');
  const hasFinish = entries.some((e)=>e.eventType==='finish_authority_assessed');
  const evidenceCompleteness = hasPr && hasVr && hasJudge && hasFinish ? 'high' : hasPr || hasVr ? 'partial' : 'low';
  const nextRequiredEvidence = !hasPr ? 'pr_evidence_parsed' : !hasVr ? 'verification_return_received' : !hasJudge ? 'verification_judged' : !missionSpec.finishAuthority?.mergeAuthorityIncluded ? 'operator_decision_required' : 'none';
  const latestEventType = entries.at(-1)?.eventType || 'none';
  let missionReadyNarrative = 'Evidence trail initialized.';
  if (!hasVr && hasPr) missionReadyNarrative = 'Evidence is incomplete: PR evidence supplied, but verification return is missing.';
  else if ((verificationJudge?.blockers||[]).length) missionReadyNarrative = 'Evidence shows verification needs fix; request Codex narrow repair.';
  else if (hasVr && !missionSpec.finishAuthority?.mergeAuthorityIncluded) missionReadyNarrative = 'Evidence shows checks passed, but merge authority is not granted.';

  return { entries, summary: { ledgerEntryCount: entries.length, warningCount, blockerCount, pendingOperatorReviewCount, evidenceCompleteness, latestEventType, nextRequiredEvidence, missionReadyNarrative } };
}

const EVIDENCE_SAFETY_DEFAULTS = Object.freeze({
  durableWriteAllowed: false,
  operatorApprovalRequiredForWrite: true,
  mutationAllowed: false,
  openClawMutationLocked: true,
  codexAutoDispatchAllowed: false,
  trustedForMerge: false,
  trustedForCanon: false,
});

function stableEvidenceId(type, sourceSystem, missionId, relatedId = '') {
  return [type, sourceSystem, missionId || 'mission-unknown', relatedId || 'mission'].map((part) => String(part || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown').join('__');
}

function evidenceEntry({ type, sourceSystem, missionId, relatedId = '', severity = 'info', status = 'observed', summary, proof = false, pendingReview = false }) {
  return {
    id: stableEvidenceId(type, sourceSystem, missionId, relatedId),
    entryId: stableEvidenceId(type, sourceSystem, missionId, relatedId),
    type,
    eventType: type,
    sourceSystem,
    source: sourceSystem,
    missionId: missionId || 'mission-unknown',
    relatedId,
    severity,
    status,
    evidenceStatus: status,
    proof,
    pendingReview,
    requiresOperatorReview: pendingReview,
    summary,
  };
}

export function deriveMissionEvidenceLedgerProjection(input = {}) {
  const projectAwareness = input.projectAwarenessProjection || input.projectAwareness || {};
  const agentRealityLoop = input.agentRealityLoopProjection || input.agentRealityLoop || {};
  const packetBay = input.packetBayProjection || input.packetBay || {};
  const builderMesh = input.builderMeshProjection || input.builderMesh || {};
  const workbench = builderMesh.builderWorkbenchProjection || input.builderWorkbenchProjection || {};
  const sourcePack = workbench.openClawSourcePackRunner || input.openClawSourcePackRunner || {};
  const hygiene = workbench.openClawWorkspaceHygiene || input.openClawWorkspaceHygiene || {};
  const verification = input.missionVerification || input.verificationReturnIntake || {};
  const prEvidence = input.prEvidence || input.prEvidenceModel || {};
  const uiReality = input.uiRealityTruth || input.uiReality || {};
  const missionId = asText(projectAwareness.missionId || input.missionId, 'mission-unknown');
  const missionTitle = asText(projectAwareness.title || projectAwareness.missionTitle || input.missionTitle, 'unknown');
  const missionPhase = asText(projectAwareness.phase || projectAwareness.missionPhase || input.missionPhase, 'unknown');
  const entries = [];
  const add = (entryInput) => entries.push(evidenceEntry({ missionId, ...entryInput }));

  const hasAnyTruth = [projectAwareness, agentRealityLoop, packetBay, builderMesh, sourcePack, hygiene, verification, prEvidence, uiReality]
    .some((value) => value && typeof value === 'object' && Object.keys(value).length > 0);
  if (!hasAnyTruth) {
    return { status: 'unavailable', missionId, missionTitle, missionPhase, completeness: 'unavailable', entryCount: 0, proofEntryCount: 0, warningCount: 0, blockerCount: 0, pendingReviewCount: 0, latestEvent: 'none', nextRequiredEvidence: 'runtime-truth', nextAction: 'Wait for runtime truth projections before deriving mission evidence.', projectionSource: 'mission-evidence-ledger-v1a-runtime-truth-projection', confidence: 'low', ...EVIDENCE_SAFETY_DEFAULTS, missingProofSummary: 'runtime truth', topEntries: [], entries: [] };
  }

  if (projectAwareness.status === 'blocked' || (projectAwareness.blockers || []).length) add({ type: 'mission-state-blocker', sourceSystem: 'project-awareness', severity: 'blocker', status: 'blocked', pendingReview: true, summary: 'Project Awareness reports blocked mission state.' });
  if (agentRealityLoop.status === 'blocked' || (agentRealityLoop.blockers || []).length) add({ type: 'arl-blocker', sourceSystem: 'agent-reality-loop', severity: 'blocker', status: 'blocked', pendingReview: true, summary: 'Agent Reality Loop is blocked.' });
  (packetBay.packets || []).filter((p) => p.status === 'ready' || p.readyToCopy).forEach((p) => add({ type: 'packet-ready', sourceSystem: 'packet-bay', relatedId: p.id, severity: 'info', status: 'observed', proof: true, summary: `Packet ready for ${p.target || p.packetTarget || 'operator route'}.` }));
  if (builderMesh.recommendedBuilder === 'local-ai') add({ type: 'local-ai-route-proof-needed', sourceSystem: 'builder-mesh', severity: 'warning', status: 'pending', pendingReview: true, summary: 'Builder Mesh recommends local-ai; proof remains required before trust.' });
  if (verification.buildRun !== true && verification.buildPassed !== true) add({ type: 'missing-build-proof', sourceSystem: 'mission-verification', severity: 'warning', status: 'missing', pendingReview: true, summary: 'Build proof is missing.' });
  if (verification.verifyRun !== true && verification.verifyPassed !== true) add({ type: 'missing-verify-proof', sourceSystem: 'mission-verification', severity: 'warning', status: 'missing', pendingReview: true, summary: 'Verify proof is missing.' });
  const browserOk = (verification.browserProof || []).length > 0 || uiReality.status === 'OK' || uiReality.status === 'ok';
  if (!browserOk) add({ type: 'missing-browser-proof', sourceSystem: 'ui-reality', severity: 'warning', status: 'missing', pendingReview: true, summary: 'Browser/UI proof is missing.' });
  if (uiReality.status === 'OK' || uiReality.status === 'ok') add({ type: 'ui-reality-observed', sourceSystem: 'ui-reality', severity: 'info', status: 'observed', proof: true, summary: 'UI Reality reports OK; merge trust remains false without explicit merge proof.' });
  if (hygiene.status === 'clean' || hygiene.workspaceStatus === 'clean' || hygiene.hygieneStatus === 'clean') add({ type: 'openclaw-hygiene-clean', sourceSystem: 'openclaw-workspace-hygiene', severity: 'info', status: 'observed', proof: true, summary: 'OpenClaw workspace hygiene is clean.' });
  if (sourcePack.sourcePackStatus === 'needs-output' || sourcePack.needsOutput === true) add({ type: 'source-pack-output-missing', sourceSystem: 'openclaw-source-pack-runner', severity: 'warning', status: 'missing', pendingReview: true, summary: 'OpenClaw Source Pack Runner needs output.' });
  const prUnavailable = !prEvidence || ['unavailable', 'disabled', 'unknown', 'unknown-disabled', ''].includes(asText(prEvidence.evidenceTruthStatus || prEvidence.status || prEvidence.availability, 'unknown'));
  if (prUnavailable) add({ type: 'pr-evidence-missing', sourceSystem: 'pr-evidence', severity: 'warning', status: 'missing', pendingReview: true, summary: 'PR evidence is unavailable, disabled, or unknown.' });

  const proofEntryCount = entries.filter((entry) => entry.proof).length;
  const blockerCount = entries.filter((entry) => entry.severity === 'blocker' || entry.status === 'blocked').length;
  const warningCount = entries.filter((entry) => entry.severity === 'warning').length;
  const pendingReviewCount = entries.filter((entry) => entry.pendingReview).length;
  const missingProof = entries.filter((entry) => entry.status === 'missing' || entry.status === 'pending').map((entry) => entry.type);
  return { status: blockerCount ? 'blocked' : (entries.length ? 'active' : 'empty'), missionId, missionTitle, missionPhase, completeness: blockerCount ? 'blocked' : (missingProof.length ? 'low' : 'partial'), entryCount: entries.length, proofEntryCount, warningCount, blockerCount, pendingReviewCount, latestEvent: entries.at(-1)?.type || 'none', nextRequiredEvidence: missingProof[0] || 'operator-review', nextAction: missingProof.length ? `Collect ${missingProof[0]}.` : 'Review projected mission evidence; durable writes remain disabled.', projectionSource: 'mission-evidence-ledger-v1a-runtime-truth-projection', confidence: entries.length ? 'medium' : 'low', ...EVIDENCE_SAFETY_DEFAULTS, missingProofSummary: missingProof.join(' | ') || 'none', topEntries: entries.slice(0, 3), entries };
}
