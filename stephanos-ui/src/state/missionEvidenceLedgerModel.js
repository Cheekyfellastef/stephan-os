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
