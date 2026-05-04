const EXECUTION_POSTURE = 'proposal_only_execution_disabled';

function normalize(value, fallback = 'unknown') { return value == null || value === '' ? fallback : String(value); }

function includesAny(value, tokens) {
  const source = String(value || '').toLowerCase();
  return tokens.some((token) => source.includes(token));
}

export function buildMissionIntelligenceLayer(input = {}) {
  const compact = input.compactVerificationSummary || {};
  const operatorSurface = input.agentTaskProjection?.operatorSurface || {};
  const reviewQueue = operatorSurface.openClawOperatorReviewQueue || {};
  const evidenceRequest = operatorSurface.openClawEvidenceRequest || {};
  const routeHealth = normalize(input.finalRouteTruth?.runtimeHealth || input.finalRouteTruth?.routeStatus, 'unknown');
  const bridgeState = normalize(input.missionBridgeState?.state, 'idle');

  const blockers = [];
  const warnings = [];
  const missingInformation = [];
  const contradictionSignals = [];
  const staleSignals = [];

  const battleBridgeUnhealthy = includesAny(routeHealth, ['degraded', 'unhealthy', 'offline', 'failed']);
  const validationSucceeded = includesAny(compact.openClawHealthValidationStatus, ['succeed', 'pass', 'ready']);
  const packetReady = includesAny(compact.openClawProposalPacketStatus, ['ready']);
  const codexExportGenerated = includesAny(compact.openClawCodexProposalExportStatus, ['generated', 'ready']);
  const codexResultMissing = includesAny(compact.openClawCodexReviewResultStatus, ['not_received', 'missing', 'needed']);
  const evidenceMissing = includesAny(evidenceRequest.requestStatus, ['needed', 'pending', 'missing']) || includesAny(reviewQueue.queueStatus, ['needs_more_evidence']);

  if (evidenceMissing && !(Array.isArray(evidenceRequest.missingEvidence) && evidenceRequest.missingEvidence.length > 0)) contradictionSignals.push('Review queue requires evidence, but missing evidence list is empty.');
  if (validationSucceeded && includesAny(compact.openClawHealthValidationStatus, ['idle'])) contradictionSignals.push('OpenClaw validation reports both succeeded and idle.');
  if (codexExportGenerated && includesAny(reviewQueue.reviewDecision, ['not_reviewed'])) contradictionSignals.push('Codex export exists while review decision remains not_reviewed.');
  if (battleBridgeUnhealthy && includesAny(compact.openClawAdapterConnectionState, ['connected', 'healthy'])) contradictionSignals.push('Battle Bridge unhealthy while adapter reports connected/healthy state.');

  let missionPhase = 'idle_ready';
  if (battleBridgeUnhealthy) missionPhase = 'battle_bridge_repair';
  else if (!validationSucceeded) missionPhase = 'openclaw_readonly_validation';
  else if (evidenceMissing) missionPhase = 'evidence_needed';
  else if (codexExportGenerated && codexResultMissing) missionPhase = 'codex_review_result_needed';
  else if (packetReady && includesAny(reviewQueue.queueStatus, ['ready_for_review', 'awaiting_review'])) missionPhase = 'openclaw_proposal_review';
  else if (includesAny(compact.openClawImplementationPlanStatus, ['ready'])) missionPhase = 'implementation_planning';
  else if (includesAny(compact.openClawApprovalGateReadinessStatus, ['ready'])) missionPhase = 'approval_readiness';
  else if (includesAny(compact.openClawControlledExecutionStatus, ['future_gated'])) missionPhase = 'future_execution_gated';
  else if (includesAny(compact.openClawDryRunPlanStatus, ['ready'])) missionPhase = 'dry_run_preview';

  let recommendedNextAction = 'Review mission console summaries and confirm operator intent.';
  let recommendedNextMission = 'Maintain guarded proposal-only workflow.';
  let suggestedAgentRoute = 'mixed';
  let reason = 'Signals are stable enough for guarded synthesis.';

  if (missionPhase === 'battle_bridge_repair') { recommendedNextAction = 'Run Battle Bridge repair.'; suggestedAgentRoute = 'operator'; }
  else if (missionPhase === 'openclaw_readonly_validation') { recommendedNextAction = 'Re-check readonly OpenClaw validation.'; suggestedAgentRoute = 'openclaw'; }
  else if (missionPhase === 'evidence_needed') { recommendedNextAction = 'Attach missing operator evidence.'; suggestedAgentRoute = 'operator'; }
  else if (missionPhase === 'openclaw_proposal_review') { recommendedNextAction = 'Mark packet ready for Codex review.'; suggestedAgentRoute = 'operator'; }
  else if (missionPhase === 'codex_review_result_needed') { recommendedNextAction = 'Copy Codex prompt and paste Codex review result.'; suggestedAgentRoute = 'codex'; }
  else if (missionPhase === 'implementation_planning') { recommendedNextAction = 'Review implementation plan.'; suggestedAgentRoute = 'codex'; }
  else if (missionPhase === 'approval_readiness') { recommendedNextAction = 'Review approval readiness checklist.'; suggestedAgentRoute = 'operator'; }
  else if (missionPhase === 'dry_run_preview') { recommendedNextAction = 'Review dry-run preview.'; suggestedAgentRoute = 'operator'; }
  else if (missionPhase === 'future_execution_gated') { recommendedNextAction = 'Keep controlled execution disabled and continue proposal-only review.'; suggestedAgentRoute = 'stephanos'; }

  recommendedNextMission = `Advance from ${missionPhase} to the next guarded review milestone.`;
  const riskLevel = missionPhase === 'battle_bridge_repair' || contradictionSignals.length > 0 ? 'elevated' : 'guarded';
  if (contradictionSignals.length > 0) warnings.push('Contradictory truth signals detected; resolve before promoting workflow phase.');
  if (bridgeState === 'idle' && packetReady) staleSignals.push('Mission bridge is idle while proposal packet appears ready.');
  if (codexResultMissing) missingInformation.push('Codex review result payload has not been imported yet.');
  if (!validationSucceeded) blockers.push('Readonly validation has not succeeded.');

  const intelligenceStatus = blockers.length > 0 ? 'blocked' : (missingInformation.length > 0 ? 'needs_operator_input' : 'synthesised');
  return {
    intelligenceStatus,
    missionPhase,
    currentSituationSummary: `Phase ${missionPhase}. Route health is ${routeHealth}. OpenClaw execution remains disabled and proposal-only safeguards stay active.`,
    recommendedNextMission,
    recommendedNextAction,
    recommendedAgentRoute: suggestedAgentRoute,
    reason,
    riskLevel,
    blockers,
    warnings,
    evidence: [
      `routeHealth:${routeHealth}`,
      `validation:${normalize(compact.openClawHealthValidationStatus)}`,
      `packet:${normalize(compact.openClawProposalPacketStatus)}`,
      `codexExport:${normalize(compact.openClawCodexProposalExportStatus)}`,
      `codexResult:${normalize(compact.openClawCodexReviewResultStatus)}`,
    ],
    missingInformation,
    operatorDecisionNeeded: evidenceMissing || missionPhase === 'openclaw_proposal_review',
    suggestedOperatorActions: [recommendedNextAction].filter((action) => !includesAny(action, ['execute', 'commit', 'deploy', 'browse', 'edit file'])),
    suggestedCodexPromptAvailable: codexExportGenerated,
    suggestedOpenClawRole: 'readonly validation, packet synthesis, and proposal context only',
    suggestedCodexRole: 'manual review/planning intake only',
    executionPosture: EXECUTION_POSTURE,
    confidence: contradictionSignals.length > 0 ? 'medium' : 'high',
    staleSignals,
    contradictionSignals,
    nextReviewCheckpoint: codexResultMissing ? 'Codex review result imported.' : 'Operator confirms next gate.',
  };
}
