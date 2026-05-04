function asText(value = '') {
  return String(value || '').trim();
}

function asList(value) {
  return Array.isArray(value)
    ? value.map((entry) => asText(entry)).filter(Boolean)
    : [];
}

const DEFAULT_STAGES = Object.freeze([
  'interpret_intent',
  'inspect_current_truth',
  'identify_capability_gaps',
  'recommend_minds',
  'recommend_external_sources',
  'request_operator_approval',
  'generate_codex_packet',
  'await_agent_result',
  'verify_result',
  'propose_memory_updates',
  'propose_roadmap_updates',
  'ready_for_operator_review',
]);

const DEFAULT_GUARDRAILS = Object.freeze([
  'no_external_account_creation_without_operator_approval',
  'no_automatic_terms_acceptance',
  'no_automatic_payment_method_changes',
  'no_repo_secret_storage',
  'no_api_key_display_in_ui_or_support_snapshot',
  'no_cloud_context_for_private_local_without_approval',
  'no_openclaw_access_to_unapproved_minds',
  'no_route_default_changes_without_approval',
  'no_destructive_file_ops_without_approval',
  'no_deploy_without_verification',
]);

export function buildRealityUpgradeOrchestrator({ runtimeContext = {}, aiMindRegistry = {} } = {}) {
  const intent = runtimeContext?.realityUpgradeIntent || {};
  const upgradeIntent = asText(intent.upgradeIntent || intent.rawIntent || runtimeContext?.latestOperatorIntent);
  const desiredFutureState = asText(intent.desiredFutureState || 'Operator-defined future state pending.');
  const affectedSystemArea = asText(intent.affectedSystemArea || intent.targetArea || 'unknown');
  const capabilityGaps = asList(intent.capabilityGaps);
  const explicitRoles = asList(intent.requiredMindRoles);
  const requiredMindRoles = explicitRoles.length ? explicitRoles : capabilityGaps.map((gap) => `role:${gap}`);
  const approvedMinds = Array.isArray(aiMindRegistry?.minds) ? aiMindRegistry.minds.filter((mind) => mind.approvalState === 'approved') : [];
  const recommendedMinds = approvedMinds.filter((mind) => mind.recommendedRoles.some((role) => requiredMindRoles.includes(role))).slice(0, 4);
  const candidateMindSources = Array.isArray(aiMindRegistry?.externalMindSourcesProjection) ? aiMindRegistry.externalMindSourcesProjection.filter((source) => source.approvalState !== 'approved') : [];
  const riskFlags = [
    ...(capabilityGaps.length > 0 ? ['capability_gaps_detected'] : []),
    ...(candidateMindSources.some((source) => source.privacyClass === 'cloud') ? ['cloud_privacy_review_required'] : []),
  ];
  const approvalCheckpoints = [
    'approve_external_mind_onboarding',
    'approve_private_context_sharing',
    'approve_openclaw_mind_access',
    'approve_route_default_changes',
    'approve_destructive_or_deploy_actions',
  ];
  const missionStages = DEFAULT_STAGES.map((stageId, index) => ({
    stageId,
    order: index + 1,
    status: index === 0 ? 'active' : 'pending',
  }));
  const definitionOfDone = asText(intent.definitionOfDone || 'Mission result verified, approvals satisfied, and update proposals prepared.');

  const projection = {
    plainLanguageInterpretation: upgradeIntent
      ? `Interpret operator intent: ${upgradeIntent}`
      : 'Awaiting operator high-level upgrade intent.',
    targetSystemArea: affectedSystemArea,
    missingCapabilities: capabilityGaps,
    requiredMinds: requiredMindRoles,
    recommendedMissionStages: missionStages.map((stage) => stage.stageId),
    risks: riskFlags,
    approvalsNeeded: approvalCheckpoints,
    definitionOfDone,
  };

  return {
    upgradeIntent,
    desiredFutureState,
    affectedSystemArea,
    capabilityGaps,
    requiredMindRoles,
    candidateMindSources,
    recommendedMinds: recommendedMinds.map((mind) => ({ mindId: mind.mindId, displayName: mind.displayName, providerId: mind.providerId })),
    requiredTools: asList(intent.requiredTools),
    requiredPermissions: asList(intent.requiredPermissions),
    riskFlags,
    guardrailChecks: DEFAULT_GUARDRAILS,
    approvalCheckpoints,
    missionStages,
    verificationContract: {
      checks: asList(Array.isArray(intent.verificationChecks) && intent.verificationChecks.length ? intent.verificationChecks : ['npm run stephanos:verify']),
      deploymentBlockedUntilVerified: true,
    },
    memoryUpdateCandidates: asList(intent.memoryUpdateCandidates),
    roadmapUpdateCandidates: asList(intent.roadmapUpdateCandidates),
    recommendedNextAction: asText(intent.recommendedNextAction || 'Review mission interpretation and approve scoped onboarding only as needed.'),
    orchestrationStatus: upgradeIntent ? 'draft_plan_ready' : 'awaiting_intent',
    intentToMissionProjection: projection,
    supportSnapshot: {
      realityUpgradeStatus: upgradeIntent ? 'draft_plan_ready' : 'awaiting_intent',
      currentUpgradeIntent: upgradeIntent || 'none',
      affectedSystemArea,
      capabilityGapCount: capabilityGaps.length,
      recommendedMindCount: recommendedMinds.length,
      pendingApprovalCount: approvalCheckpoints.length,
      activeMissionStage: missionStages.find((stage) => stage.status === 'active')?.stageId || 'none',
      recommendedNextUpgradeAction: asText(intent.recommendedNextAction || 'Review plan and approve next stage.'),
      upgradeRiskSummary: riskFlags.join(', ') || 'none',
      verificationContractSummary: definitionOfDone,
    },
  };
}
