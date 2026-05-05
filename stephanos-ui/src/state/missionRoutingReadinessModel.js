function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asText(entry)).filter(Boolean);
}

function hasBlockedActionRequest(values = []) {
  const blocked = ['shell', 'github merge', 'github write', 'openclaw execution', 'secrets', 'external account', 'file deletion', 'memory auto-promotion'];
  const joined = asList(values).join(' | ').toLowerCase();
  return blocked.some((token) => joined.includes(token));
}

export function buildMissionRoutingReadiness(input = {}) {
  const missionSpec = input.missionSpec || {};
  const missionCommandPacket = input.missionCommandPacket || {};
  const agentAssignmentMatrix = input.agentAssignmentMatrix || {};
  const operatorDecisionConsole = input.operatorDecisionConsole || {};
  const missionEvidenceLedger = input.missionEvidenceLedger || {};
  const verificationJudge = input.verificationJudge || {};
  const taskFinisherPlan = input.taskFinisherPlan || {};
  const memoryLibrarianQueue = input.memoryLibrarianQueue || {};
  const prEvidenceIntake = input.prEvidenceIntake || {};
  const openClawDelegation = input.openClawDelegation || {};
  const finishAuthority = input.finishAuthority || {};

  const missionId = asText(missionSpec.missionId, asText(missionCommandPacket.missionId, 'unknown-mission'));
  const assignedRoles = asList(agentAssignmentMatrix.assignments?.map((entry) => entry.roleId));
  const assignedLeadRole = asText(agentAssignmentMatrix.summary?.recommendedLeadRole, 'operator');
  const blockedActions = [
    ...asList(missionSpec.approvalBoundary?.blockedActions),
    ...asList(agentAssignmentMatrix.summary?.blockedActions),
  ];
  const blockers = [];
  const warnings = [];
  const requiredBeforeRoute = [];

  let routeStatus = 'draft';
  let recommendedRoute = 'operator_decision';
  let readinessLevel = 'not_ready';
  let nextAction = 'Provide mission intent and bounded mission spec.';

  const hasIntent = Boolean(asText(missionSpec.rawIntent) || asText(missionSpec.targetArea));
  if (!hasIntent || missionId === 'unknown-mission') {
    requiredBeforeRoute.push('Capture operator intent and generate mission spec.');
  }

  const verificationBlockers = asList(verificationJudge.blockers);
  if (verificationBlockers.length) {
    routeStatus = 'verification_repair_needed';
    recommendedRoute = 'verification_repair';
    readinessLevel = 'blocked';
    blockers.push(...verificationBlockers);
    nextAction = asText(verificationJudge.nextAction, 'Repair verification blockers and return proof.');
  }

  const proofPending = asText(verificationJudge.judgment).includes('proof_pending');
  const prEvidenceMissing = asText(prEvidenceIntake.normalizedStatus || prEvidenceIntake.status, 'no_pr_evidence') === 'no_pr_evidence';
  const verificationReturnMissing = !asText(verificationJudge.judgment) || asText(verificationJudge.judgment) === 'no_return';

  if (proofPending && !verificationBlockers.length) {
    if (prEvidenceMissing) {
      routeStatus = 'awaiting_pr_evidence';
      recommendedRoute = 'evidence_intake';
      readinessLevel = 'partial';
      requiredBeforeRoute.push('Attach PR evidence after Codex handoff output.');
      nextAction = 'Collect PR evidence and ingest it into Mission Evidence Ledger.';
    } else if (verificationReturnMissing || proofPending) {
      routeStatus = 'awaiting_verification_return';
      recommendedRoute = 'verification_return';
      readinessLevel = 'partial';
      requiredBeforeRoute.push('Provide verification return details for adjudication.');
      nextAction = 'Return verification output and rerun judge.';
    } else {
      routeStatus = 'awaiting_operator_decision';
      recommendedRoute = 'operator_decision';
      readinessLevel = 'partial';
      nextAction = asText(operatorDecisionConsole.nextAction, 'Resolve operator decision queue.');
    }
  }

  if ((memoryLibrarianQueue.counts?.approvalRequired || 0) > 0) {
    routeStatus = 'memory_review_needed';
    recommendedRoute = 'memory_review';
    readinessLevel = 'partial';
    requiredBeforeRoute.push('Operator review of memory/canon candidates is required.');
    nextAction = asText(memoryLibrarianQueue.nextAction, 'Review memory approvals before delegation.');
  }

  const highRiskPending = (operatorDecisionConsole.summary?.highRiskPendingCount || 0) > 0;
  if (highRiskPending) {
    routeStatus = 'awaiting_operator_decision';
    recommendedRoute = 'operator_decision';
    readinessLevel = 'partial';
    requiredBeforeRoute.push('Resolve high-risk operator decisions.');
    nextAction = asText(operatorDecisionConsole.nextAction, 'Resolve high-risk decisions before continuing.');
  }

  const codexAssigned = assignedRoles.includes('codex_builder') || agentAssignmentMatrix.summary?.codexAssigned === true;
  const openClawAssigned = agentAssignmentMatrix.summary?.openClawAssigned === true || assignedRoles.includes('openclaw_research');
  const openClawResearchOnly = asText(openClawDelegation.authorityLevel).includes('research') || asText(openClawDelegation.authorityLevel).includes('prepare_codex_handoff');

  if (hasIntent && codexAssigned && missionEvidenceLedger.entries?.length === 0 && routeStatus === 'draft') {
    routeStatus = 'ready_for_codex';
    recommendedRoute = 'codex_handoff';
    readinessLevel = 'ready';
    nextAction = 'Send bounded Mission Command Packet + Codex handoff.';
  }

  if (hasIntent && openClawAssigned && openClawResearchOnly && !asText(openClawDelegation.finishAuthority).includes('execute')) {
    if (routeStatus === 'draft' || routeStatus === 'ready_for_codex') {
      routeStatus = 'ready_for_openclaw_research';
      recommendedRoute = 'openclaw_research';
      readinessLevel = 'ready';
      nextAction = 'Delegate bounded research-only packet to OpenClaw (no execution).';
    }
  }

  if (taskFinisherPlan.safeToContinueRoutineFinish === true) {
    routeStatus = 'routine_finish_ready';
    recommendedRoute = 'routine_finish';
    readinessLevel = 'ready';
    nextAction = asText(taskFinisherPlan.nextAction, 'Proceed with routine finish checklist.');
  }

  if (verificationJudge.mergeReadyCandidate === true && finishAuthority.mergeAuthorityIncluded !== true) {
    routeStatus = 'awaiting_operator_decision';
    recommendedRoute = 'operator_decision';
    readinessLevel = 'partial';
    requiredBeforeRoute.push('Operator merge decision required by Finish Authority.');
    nextAction = 'Request explicit operator merge decision.';
  }

  if (missionEvidenceLedger.completeness === 'complete' && blockers.length === 0 && requiredBeforeRoute.length === 0) {
    routeStatus = 'complete_candidate';
    recommendedRoute = 'operator_closeout';
    readinessLevel = 'complete_candidate';
    nextAction = 'Operator may confirm mission completion candidate.';
  }

  if (hasBlockedActionRequest(blockedActions)) {
    routeStatus = 'blocked';
    recommendedRoute = 'hold';
    readinessLevel = 'blocked';
    blockers.push('Blocked action requested by mission boundaries.');
    requiredBeforeRoute.push('Remove blocked action request and request operator override if needed.');
    nextAction = 'Hold mission until blocked action is removed or explicitly approved.';
  }

  const codexReady = routeStatus === 'ready_for_codex';
  const openClawResearchReady = routeStatus === 'ready_for_openclaw_research';
  const operatorDecisionRequired = routeStatus === 'awaiting_operator_decision';
  const evidenceRequired = routeStatus === 'awaiting_pr_evidence';
  const verificationRepairRequired = routeStatus === 'verification_repair_needed';
  const memoryReviewRequired = routeStatus === 'memory_review_needed';
  const routineFinishReady = routeStatus === 'routine_finish_ready';
  const holdRequired = routeStatus === 'blocked';
  const delegationReady = codexReady || openClawResearchReady;

  const allowedNextActions = delegationReady
    ? ['prepare_packet', 'prepare_handoff', recommendedRoute]
    : ['review_status', 'request_operator_decision'];

  return {
    missionId,
    routeStatus,
    recommendedRoute,
    routeReason: nextAction,
    readinessLevel,
    blockers,
    warnings,
    requiredBeforeRoute,
    allowedNextActions,
    blockedNextActions: blockedActions,
    assignedLeadRole,
    delegationReady,
    codexReady,
    openClawResearchReady,
    operatorDecisionRequired,
    evidenceRequired,
    verificationRepairRequired,
    memoryReviewRequired,
    routineFinishReady,
    holdRequired,
    nextAction,
    routeSummary: {
      routeStatus,
      recommendedRoute,
      assignedLeadRole,
      readinessLevel,
      blockerCount: blockers.length,
      warningCount: warnings.length,
      requiredBeforeRouteCount: requiredBeforeRoute.length,
      codexReady,
      openClawResearchReady,
      operatorDecisionRequired,
      nextAction,
    },
  };
}
