function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function createDecision(fields = {}) {
  return {
    decisionId: asText(fields.decisionId, `decision-${Math.random().toString(36).slice(2, 10)}`),
    missionId: asText(fields.missionId, 'unknown-mission'),
    decisionType: asText(fields.decisionType, 'hold_for_operator'),
    title: asText(fields.title, 'Operator decision required'),
    summary: asText(fields.summary, ''),
    sourceSystem: asText(fields.sourceSystem, 'mission_console'),
    sourceStatus: asText(fields.sourceStatus, 'unknown'),
    riskLevel: asText(fields.riskLevel, 'medium'),
    urgency: asText(fields.urgency, 'normal'),
    recommendedAction: asText(fields.recommendedAction, 'review'),
    allowedActions: asList(fields.allowedActions),
    blockedActions: asList(fields.blockedActions),
    requiresExplicitApproval: fields.requiresExplicitApproval === true,
    authorityImplication: asText(fields.authorityImplication, 'operator_review_required'),
    relatedSubsystems: asList(fields.relatedSubsystems),
    relatedEvidenceIds: asList(fields.relatedEvidenceIds),
    createdAt: asText(fields.createdAt, new Date().toISOString()),
    status: asText(fields.status, 'pending'),
    warningLevel: asText(fields.warningLevel, 'none'),
    reason: asText(fields.reason, fields.summary),
  };
}

export function buildOperatorDecisionQueue(input = {}) {
  const missionSpec = input.missionSpec || {};
  const missionId = asText(missionSpec.missionId, 'unknown-mission');
  const now = new Date().toISOString();
  const decisions = [];
  const verificationJudge = input.verificationJudge || missionSpec.verificationJudge || {};
  const taskFinisherPlan = input.taskFinisherPlan || missionSpec.taskFinisherPlan || {};
  const memoryLibrarianQueue = input.memoryLibrarianQueue || missionSpec.memoryLibrarian || {};
  const finishAuthority = input.finishAuthority || missionSpec.finishAuthority || {};
  const prEvidenceIntake = input.prEvidenceIntake || missionSpec.prEvidenceIntake || {};
  const openClawDelegation = input.openClawDelegation || missionSpec.openClawDelegation || {};
  const repoArchitectureContext = input.repoArchitectureContext || missionSpec.repoArchitectureContext || {};

  if ((verificationJudge.blockers || 0) > 0) {
    decisions.push(createDecision({ missionId, createdAt: now, decisionType:'request_codex_fix', title:'Verification blockers require Codex repair', summary:'Verification Judge reported blockers.', sourceSystem:'verification_judge', sourceStatus:verificationJudge.judgment || 'blocked', riskLevel:'high', urgency:'high', recommendedAction:'request_codex_fix', allowedActions:['request-codex-fix','hold-for-operator'], blockedActions:['approve-mission-finish'], requiresExplicitApproval:true, authorityImplication:'mission_finish_blocked_until_repairs', relatedSubsystems:['verification_judge','task_finisher'], status:'blocked', warningLevel:'high', reason:'Verification blockers are unresolved.' }));
  }
  if (asText(verificationJudge.proofOfDoneStatus) === 'pending') {
    decisions.push(createDecision({ missionId, createdAt: now, decisionType:'review_proof_of_done', title:'Proof-of-done review required', summary:'Proof-of-done is pending.', sourceSystem:'verification_judge', sourceStatus:'pending', riskLevel:'medium', urgency:'normal', recommendedAction:'review_proof_of_done', allowedActions:['review-proof'], blockedActions:['approve-mission-finish'], requiresExplicitApproval:true, authorityImplication:'proof_review_required', relatedSubsystems:['verification_judge','mission_evidence_ledger'], status:'pending', warningLevel:'medium', reason:'Operator-visible proof has not been confirmed.' }));
  }
  if (taskFinisherPlan.codexRepairNeeded === true) {
    decisions.push(createDecision({ missionId, createdAt: now, decisionType:'request_codex_fix', title:'Task Finisher recommends Codex fix', summary:'Routine finisher reports a repair requirement.', sourceSystem:'task_finisher', sourceStatus:taskFinisherPlan.finishPlanStatus || 'needs-repair', riskLevel:'medium', urgency:'high', recommendedAction:'request_codex_fix', allowedActions:['request-codex-fix'], blockedActions:['approve-mission-finish'], requiresExplicitApproval:true, authorityImplication:'repair_required_before_finish', relatedSubsystems:['task_finisher'], status:'recommended', warningLevel:'medium', reason:asText(taskFinisherPlan.nextAction, 'Codex repair is needed.') }));
  }
  const approvalRequiredCandidates = asList(memoryLibrarianQueue.queue).filter((c) => c.requiresOperatorApproval === true);
  approvalRequiredCandidates.forEach((candidate) => {
    decisions.push(createDecision({ missionId, createdAt: now, decisionType: candidate.suggestedAction === 'promote_to_canon' ? 'promote_canon_candidate' : 'approve_memory_candidate', title:`Memory candidate review: ${asText(candidate.memoryCandidateType, 'candidate')}`, summary:asText(candidate.summary, 'Candidate requires operator review.'), sourceSystem:'memory_librarian', sourceStatus:asText(candidate.status, 'pending'), riskLevel:candidate.memoryCandidateType === 'architecture_canon_candidate' ? 'high' : 'medium', urgency:'normal', recommendedAction:candidate.suggestedAction || 'approve_or_reject_memory_candidate', allowedActions:['approve_memory_candidate','reject_memory_candidate'], blockedActions:['auto_promote_memory'], requiresExplicitApproval:true, authorityImplication:'durable_memory_change_requires_operator', relatedSubsystems:['memory_librarian','mission_memory'], status:'pending', warningLevel:'medium', reason:asText(candidate.reason, 'Pending durable memory decision.') }));
  });
  if (finishAuthority.mergeAuthorityIncluded !== true && verificationJudge.mergeReadyCandidate === true) {
    decisions.push(createDecision({ missionId, createdAt: now, decisionType:'approve_merge_authority', title:'Merge authority decision required', summary:'Mission appears merge-ready but merge authority is not included.', sourceSystem:'finish_authority', sourceStatus:finishAuthority.finishAuthorityStatus || 'not_granted', riskLevel:'high', urgency:'high', recommendedAction:'approve_merge_authority_or_hold', allowedActions:['approve_merge_authority','hold_for_operator'], blockedActions:['merge_without_authority'], requiresExplicitApproval:true, authorityImplication:'merge_explicit_authority_required', relatedSubsystems:['finish_authority','verification_judge'], status:'pending', warningLevel:'high', reason:'Merge-ready candidate cannot merge without explicit authority.' }));
  }
  if (prEvidenceIntake?.mergedWithoutRecordedAuthority === true) {
    decisions.push(createDecision({ missionId, createdAt: now, decisionType:'review_pr_evidence_warning', title:'PR evidence warning: merge authority mismatch', summary:'PR appears merged without recorded mission authority.', sourceSystem:'pr_evidence', sourceStatus:prEvidenceIntake.readiness || 'warning', riskLevel:'critical', urgency:'high', recommendedAction:'review_pr_evidence_warning', allowedActions:['review_pr_evidence_warning','hold_for_operator'], blockedActions:['ignore_authority_mismatch'], requiresExplicitApproval:true, authorityImplication:'authority_audit_required', relatedSubsystems:['pr_evidence','finish_authority','mission_evidence_ledger'], status:'blocked', warningLevel:'critical', reason:'Merged state conflicts with mission authority record.' }));
  }
  if (openClawDelegation && Object.keys(openClawDelegation).length > 0) {
    decisions.push(createDecision({ missionId, createdAt: now, decisionType:'review_openclaw_delegation', title:'Review OpenClaw delegation envelope', summary:'Delegation envelope is present and operator visibility is required.', sourceSystem:'openclaw_delegation', sourceStatus:openClawDelegation.finishAuthority || 'plan_only', riskLevel:'medium', urgency:'normal', recommendedAction:'review_openclaw_delegation', allowedActions:['review_openclaw_delegation','hold_for_operator'], blockedActions:['openclaw_execute'], requiresExplicitApproval:true, authorityImplication:'delegation_is_plan_only_unless_explicit', relatedSubsystems:['openclaw_delegation'], status:'informational', warningLevel:'low', reason:'OpenClaw delegation exists but execution remains blocked.' }));
  }
  const hasCapabilityGap = (memoryLibrarianQueue.counts?.capabilityGaps || 0) > 0 || (repoArchitectureContext.riskSummary || []).some((v) => /capability gap/i.test(String(v)));
  if (hasCapabilityGap) {
    decisions.push(createDecision({ missionId, createdAt: now, decisionType:'review_capability_gap', title:'Review capability gap signal', summary:'Capability gap was detected in mission memory or architecture context.', sourceSystem:'memory_librarian', sourceStatus:'pending', riskLevel:'medium', urgency:'normal', recommendedAction:'review_capability_gap', allowedActions:['review_capability_gap','defer'], blockedActions:[], requiresExplicitApproval:false, authorityImplication:'future_mission_planning_input', relatedSubsystems:['memory_librarian','repo_architecture_context'], status:'recommended', warningLevel:'low', reason:'Capability gap should be triaged for follow-up.' }));
  }

  const blockers = decisions.filter((d) => d.status === 'blocked').length;
  if (decisions.length === 0) {
    decisions.push(createDecision({ missionId, createdAt: now, decisionType:'no_action_required', title:'No operator action required', summary:'No pending decision surfaced from mission systems.', sourceSystem:'mission_console', sourceStatus:'stable', riskLevel:'low', urgency:'low', recommendedAction:'no_action_required', allowedActions:['continue_monitoring'], blockedActions:[], requiresExplicitApproval:false, authorityImplication:'none', relatedSubsystems:['mission_console'], status:'informational', warningLevel:'none', reason:'Evidence indicates no pending operator decision.' }));
  } else if (blockers === 0 && verificationJudge.mergeReadyCandidate === true && finishAuthority.mergeAuthorityIncluded !== true) {
    decisions.push(createDecision({ missionId, createdAt: now, decisionType:'approve_mission_finish', title:'Approve mission finish posture', summary:'Evidence is complete; operator finish decision is required.', sourceSystem:'mission_evidence_ledger', sourceStatus:'ready_for_operator', riskLevel:'medium', urgency:'normal', recommendedAction:'approve_mission_finish', allowedActions:['approve_mission_finish','defer'], blockedActions:['auto_finish'], requiresExplicitApproval:true, authorityImplication:'operator_finish_authority_required', relatedSubsystems:['mission_evidence_ledger','finish_authority'], status:'recommended', warningLevel:'medium', reason:'Mission may be finish-ready but authority remains operator-controlled.' }));
  }

  const summary = {
    pendingDecisionCount: decisions.filter((d) => ['pending','recommended','blocked'].includes(d.status)).length,
    highRiskDecisionCount: decisions.filter((d) => ['high','critical'].includes(d.riskLevel)).length,
    approvalRequiredCount: decisions.filter((d) => d.requiresExplicitApproval).length,
    blockedDecisionCount: blockers,
    recommendedNextDecision: decisions.find((d) => d.status === 'blocked')?.decisionType || decisions.find((d) => d.status === 'recommended')?.decisionType || decisions[0].decisionType,
    operatorCanFinishMission: blockers === 0 && !decisions.some((d) => d.decisionType === 'request_codex_fix'),
    operatorMergeDecisionRequired: decisions.some((d) => d.decisionType === 'approve_merge_authority'),
    memoryApprovalRequired: decisions.some((d) => ['approve_memory_candidate','promote_canon_candidate'].includes(d.decisionType)),
    codexFixRecommended: decisions.some((d) => d.decisionType === 'request_codex_fix'),
    proofReviewRequired: decisions.some((d) => d.decisionType === 'review_proof_of_done'),
  };

  return { decisions, summary };
}
