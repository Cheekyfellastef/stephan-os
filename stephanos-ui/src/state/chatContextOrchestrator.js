import { buildContextProviderSnapshot } from './contextProviderRegistry.js';
import { buildGithubPrEvidenceProvider } from './githubPrEvidenceProvider.js';
import { detectOperatorExplanationIntent } from './operatorExplanationProjection.js';

const CHAT_CONTEXT_VERSION = 'v1';

const CANON_RULES = [
  { id: 'canon.merge_block_failed_checks', text: 'do not merge when checks/build/verify fail', tags: ['merge', 'pr', 'codex'] },
  { id: 'canon.dist_not_truth', text: 'dist is never source of truth', tags: ['ui', 'build', 'truth'] },
  { id: 'canon.ui_reality_proof', text: 'visual UI changes require browser/UI Reality proof', tags: ['ui', 'proof'] },
  { id: 'canon.source_owns_behavior', text: 'source must own behaviour', tags: ['architecture', 'truth'] },
  { id: 'canon.tests_not_ui_proof', text: 'do not treat terminal-only UI checks as complete', tags: ['ui', 'proof', 'merge', 'pr'] },
  { id: 'canon.no_broad_refactor', text: 'no broad UI refactors when repairing one pane', tags: ['ui', 'repair'] },
  { id: 'canon.first_class_collapsible', text: 'first-class panes must be collapsible', tags: ['ui'] },
  { id: 'canon.arrange_mode_controls', text: 'Move up/down belongs to Arrange Mode', tags: ['ui'] },
  { id: 'canon.copy_green_confirmed', text: 'copy buttons turn green only after confirmed clipboard success', tags: ['ui'] },
  { id: 'canon.multi_surface_allowed', text: 'Mission Console multi-surface mounting is allowed, duplicate implementation is not', tags: ['mission-console', 'architecture'] },
  { id: 'canon.prefer_pr_amend_open', text: 'prefer amendment to existing PR when PR is still open', tags: ['merge', 'pr', 'codex'] },
  { id: 'canon.no_junk_drawer', text: 'AI Console must not become a junk drawer for operational panes', tags: ['ai-console', 'architecture'] },
];

export const INTENT_RULES = [
  {
    id: 'identity-recall',
    responseMode: 'identity-recall',
    pattern: /\b(can you remember my name|what is my name|who am i|do you know my name|remember my name)\b/,
  },
  {
    id: 'agent-reality-loop',
    responseMode: 'mission-planning',
    pattern: /\b(agent reality loop( v1)?|reality loop|agent loop|codex\/openclaw coordination loop|proof loop|merge readiness loop)\b/,
  },
  {
    id: 'merge-decision',
    responseMode: 'merge-decision',
    pattern: 'contains "merge" and merge-decision companion phrase',
  },
  {
    id: 'codex-dispatch',
    responseMode: 'codex-dispatch',
    pattern: /\b(get|ask|have|make)\b[^.!?]{0,80}\bcodex\b[^.!?]{0,120}\b(fix|repair|build|implement|next step|prompt)\b|\bcodex should\b/,
  },
  {
    id: 'codex-prompt',
    responseMode: 'codex-prompt',
    pattern: /\b(give|make)\b[^.!?]{0,60}\b(codex )?prompt\b|\bcodex prompt\b/,
  },
  {
    id: 'operator-explanation',
    responseMode: 'operator-explanation',
    pattern: 'detected by operator explanation intent projection',
  },
  {
    id: 'diagnosis',
    responseMode: 'diagnosis',
    pattern: /\bbroken\b|\bnot working\b|\berror\b|\bbug\b|\bpane is broken\b/,
  },
  {
    id: 'builder-mesh-routing',
    responseMode: 'work-routing',
    pattern: /\b(who should (work on|handle|do) this|who should do (the )?next task|what builder should (take|handle|do)|can openclaw help|can my local ais? do this|how do we avoid using codex|without using metered codex|without hitting the meter|keep building without (using )?(metered )?codex|zero-cost builder|builder mesh|local ai.*openclaw|codex meter)\b/,
  },
  {
    id: 'work-routing',
    responseMode: 'work-routing',
    pattern: /\b(who should do (the )?next task|should (codex|openclaw)\b[^.!?]{0,40}\b(handle|do)\b|what packet should i copy next|can (codex|openclaw) help with this|what should the next round be|click monkey|can codex and openclaw help with the next task)\b/,
  },
  {
    id: 'mission-planning',
    responseMode: 'mission-planning',
    pattern: /\bwhat should we build next\b|\bbuild next\b|\bmission plan\b|\bmission planning\b|\bcurrent main mission\b|\bnext best action\b|\bwhat should we do next\b|\breduce operator complexity\b|\bcan (codex|openclaw) help\b/,
  },
  {
    id: 'architecture-guidance',
    responseMode: 'architecture-guidance',
    pattern: /\bwhy does it feel generic\b|\bwhy does stephanos feel generic\b|\barchitecture\b/,
  },
  {
    id: 'research-scouting',
    responseMode: 'research-scouting',
    pattern: /\bvr\b|flat-to-vr|\bresearch\b/,
  },
];

function normalizeIntentInput(msg = '') {
  return String(msg || '').replace(/\s+/g, ' ').trim();
}

function normalizeIntentInputForMatching(msg = '') {
  return normalizeIntentInput(msg)
    .toLowerCase()
    .replace(/[?!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyIntent(msg = '') {
  const normalized = normalizeIntentInput(msg);
  const normalizedForMatching = normalizeIntentInputForMatching(msg);
  const mergeRulePattern = 'contains: merge + any(pr|pull request|this|this one|this pr|should i|do i|can i)';
  const identityRecallPattern = 'contains: name/identity recall phrase';
  const mergeRuleMatched = normalizedForMatching.includes('merge')
    && (
      normalizedForMatching.includes('pr')
      || normalizedForMatching.includes('pull request')
      || normalizedForMatching.includes('this one')
      || normalizedForMatching.includes('this pr')
      || normalizedForMatching.includes('this')
      || normalizedForMatching.includes('should i')
      || normalizedForMatching.includes('do i')
      || normalizedForMatching.includes('can i')
    );
  const candidateRulesEvaluated = [];
  let matchedRule = null;
  const explanationMatched = detectOperatorExplanationIntent(normalizedForMatching).matched;
  for (const rule of INTENT_RULES) {
    const matched = rule.id === 'merge-decision'
      ? mergeRuleMatched
      : (rule.id === 'operator-explanation' ? explanationMatched : rule.pattern.test(normalizedForMatching));
    candidateRulesEvaluated.push(`${rule.id}:${matched ? '1' : '0'}`);
    if (matched && !matchedRule) matchedRule = rule;
  }
  if (!matchedRule) return {
    responseMode: 'direct-answer',
    matchedRule: 'direct-answer',
    normalized,
    classifierFunctionSource: 'chatContextOrchestrator.INTENT_RULES',
    classifierRuleOrder: INTENT_RULES.map((rule) => rule.id),
    candidateRulesEvaluated,
    mergeRuleMatched: false,
    mergeRulePattern,
    mergeRuleTestResult: mergeRuleMatched ? 'yes' : 'no',
    matchInput: normalizedForMatching,
    firstMatchingRule: 'direct-answer',
    matchedRuleIndex: -1,
    matchedRegex: 'none',
    fallbackApplied: true,
    normalizedForMatching,
  };
  return {
    responseMode: matchedRule.responseMode,
    matchedRule: matchedRule.id,
    normalized,
    classifierFunctionSource: 'chatContextOrchestrator.INTENT_RULES',
    classifierRuleOrder: INTENT_RULES.map((rule) => rule.id),
    candidateRulesEvaluated,
    mergeRuleMatched: matchedRule.id === 'merge-decision',
    identityRecallMatched: matchedRule.id === 'identity-recall',
    mergeRulePattern,
    mergeRuleTestResult: mergeRuleMatched ? 'yes' : 'no',
    matchInput: normalizedForMatching,
    firstMatchingRule: matchedRule.id,
    matchedRuleIndex: INTENT_RULES.findIndex((rule) => rule.id === matchedRule.id),
    matchedRegex: matchedRule.id === 'merge-decision' ? mergeRulePattern : matchedRule.pattern.source,
    normalizedForMatching,
    fallbackApplied: false,
  };
}

function pickResponseMode(msg = '') {
  return classifyIntent(msg).responseMode;
}

function buildProjectAwarenessPack({ missionState = {}, missionIntelligence = {}, proofState = {}, operatorProfile = {} } = {}) {
  const sourcesUsed = [];
  if (missionState && Object.keys(missionState).length) sourcesUsed.push('missionState');
  if (missionIntelligence && Object.keys(missionIntelligence).length) sourcesUsed.push('missionIntelligence');
  if (missionState?.operatorReliefProjection?.harnessAgentProjection || missionState?.harnessAgentProjection) sourcesUsed.push('harnessAgentProjection');
  if (proofState && Object.keys(proofState).length) sourcesUsed.push('proofState');
  if (operatorProfile && Object.keys(operatorProfile).length) sourcesUsed.push('operatorProfile');
  sourcesUsed.push('canonRules');
  const agentRealityLoopProjection = missionState?.operatorReliefProjection?.agentRealityLoopProjection || missionState?.agentRealityLoopProjection || {};
  const agentRealityLoopProjectionSource = missionState?.operatorReliefProjection?.agentRealityLoopProjection
    ? 'operator-relief-bridge'
    : (missionState?.agentRealityLoopProjection ? 'mission-brain' : 'none');
  if (agentRealityLoopProjectionSource !== 'none') sourcesUsed.push(agentRealityLoopProjectionSource);

  const warnings = [
    'Do not add new panes when existing Mission Brain / Operator Relief / Command Deck surfaces can be extended.',
    'Do not ask operator to manually juggle multiple branches.',
    'Do not create dashboards that only report toil back to the operator.',
    'Prefer distilled next actions and approval-gated automation.',
    'Keep merge authority with operator.',
    'Preserve source-only PR hygiene.',
  ];
  const hasMissionIntelligence = missionIntelligence && Object.keys(missionIntelligence).length > 0;
  const hasMissionState = missionState && Object.keys(missionState).length > 0;
  const hasHarness = Boolean(missionState?.operatorReliefProjection?.harnessAgentProjection || missionState?.harnessAgentProjection);
  return {
    status: hasMissionIntelligence && hasHarness ? 'available' : (hasMissionState ? 'degraded' : 'unavailable'),
    sourcesUsed,
    projectNorthStar: 'Stephanos OS is being built into an operator-relief AI cockpit where the user remains the intent engine while Stephanos, Codex, OpenClaw, and assistant intelligence handle increasing amounts of planning, proof, orchestration, coding, and housework under approval gates.',
    operatorWorkflowPreference: missionIntelligence.operatorWorkflowPreference || 'Operator prefers main-first/main-only simplicity for now. Avoid branch-management-heavy workflows until Stephanos/OpenClaw can handle branch creation, PR hygiene, merge/rebase/conflict management, and proof collection automatically.',
    currentMissionSummary: missionIntelligence.currentMissionSummary || missionState?.activeMission?.summary || 'unknown',
    missionIntelligenceSummary: missionIntelligence.missionIntelligenceStatus || 'unknown',
    harnessAgentSummary: missionState?.operatorReliefProjection?.harnessAgentProjection?.harnessVersion || missionState?.harnessAgentProjection?.harnessVersion || 'unavailable',
    protectedCanonSummary: missionIntelligence.protectedCanonSummary || 'Preserve launcher/runtime separation and protected command deck canon boundaries.',
    currentProofState: missionIntelligence.proofRequiredSummary || proofState?.buildVerifyStatus || 'unknown',
    currentBlockers: Array.isArray(missionIntelligence.currentBlockers) ? missionIntelligence.currentBlockers : [],
    codexRole: 'Codex executes bounded implementation/proof work under approval gates; no autonomous execution or merge authority.',
    openClawRole: 'OpenClaw supports orchestration/research/proof under approval gates without bypassing operator merge authority.',
    nextBestAction: missionIntelligence.nextBestAction || 'Integrate Mission Brain, Harness, proof, and canon context into the existing Chat Context Pack path.',
    agentRealityLoopV1Summary: 'Agent Reality Loop V1 is a read-only coordination/proof projection in Mission Brain / Operator Relief that routes work between Codex, OpenClaw, operator, or hold; exposes required proof; blocks merge when proof is missing; and proposes lesson candidates for operator approval.',
    agentRealityLoopProjectionStatus: agentRealityLoopProjection.status || agentRealityLoopProjection.loopStatus || (Object.keys(agentRealityLoopProjection).length ? 'available' : 'unavailable'),
    agentRealityLoopProjectionSource,
    forbiddenComplexityWarnings: warnings,
    warningCount: warnings.length,
  };
}

export function buildChatContextPack(input = {}) {
  const operatorMessage = String(input.operatorMessage || '').trim();
  const uiReality = input.uiRealityStatus || {};
  const routeTruth = input.routeTruth || {};
  const providerTruth = input.providerTruth || {};
  const missionState = input.missionState || {};
  const intent = classifyIntent(operatorMessage);
  const explanationIntent = detectOperatorExplanationIntent(operatorMessage);
  const buildSource = String(input.buildSource || input.submissionSource || 'unknown').trim() || 'unknown';
  const responseMode = intent.responseMode;
  const warnings = [];
  if (!operatorMessage) warnings.push('operator message missing');
  if (String(uiReality.severity || '').toUpperCase() === 'FAIL') warnings.push('UI Reality FAIL: visual proof required before merge claims.');
  const uiTask = /\b(ui|pane|render|layout|button|console|collapse|arrange)\b/i.test(operatorMessage) || responseMode === 'diagnosis';
  const mergeDecisionTask = responseMode === 'merge-decision';
  const codexDispatchTask = responseMode === 'codex-dispatch' || responseMode === 'codex-prompt';
  const identityRecallTask = responseMode === 'identity-recall';
  const operatorExplanationTask = responseMode === 'operator-explanation' || explanationIntent.matched;
  const missionPlanningTask = responseMode === 'mission-planning' || responseMode === 'work-routing';
  const agentRealityLoopTask = intent.matchedRule === 'agent-reality-loop';
  const requiredProviders = mergeDecisionTask
    ? ['uiReality', 'proofState', 'prEvidence', 'canonRules', 'runtimeTruth', 'providerTruth', 'missionState']
    : ((missionPlanningTask || agentRealityLoopTask) ? ['missionState', 'proofState', 'canonRules'] : []);
  const optionalProviders = mergeDecisionTask
    ? ['memoryContinuity', 'conversationContinuity', 'operatorProfile', 'agentState']
    : ((missionPlanningTask || agentRealityLoopTask) ? ['runtimeTruth', 'providerTruth', 'conversationContinuity', 'operatorProfile', 'agentState'] : ['conversationContinuity', 'operatorProfile', 'agentState']);
  const contextProviderIdsRequested = [...requiredProviders, ...optionalProviders];
  let inferredSubsystems = ['general'];
  if (mergeDecisionTask) inferredSubsystems = ['merge', 'pr', 'codex', 'proof', 'source-truth'];
  else if (codexDispatchTask) inferredSubsystems = ['codex', 'mission-console', 'proof', 'source-truth'];
  else if (operatorExplanationTask) inferredSubsystems = ['operator-relief', 'support-snapshot', 'proof', 'source-truth'];
  else if (uiTask) inferredSubsystems = ['ui', 'proof', 'source-truth'];
  else if (identityRecallTask) inferredSubsystems = ['identity', 'memory', 'operator-profile'];
  else if (agentRealityLoopTask) inferredSubsystems = ['operator-relief', 'mission-brain', 'proof', 'codex', 'openclaw'];
  const githubPrEvidence = buildGithubPrEvidenceProvider({
    ...(input.githubPrEvidence || {}),
    connectorEvidence: input.githubPrEvidence?.connectorEvidence || input.connectorEvidence,
    pastedEvidence: input.githubPrEvidence?.pastedEvidence || input.pastedEvidence,
    operatorPrompt: input.operatorPrompt,
    operatorMessage,
    matchInput: intent.matchInput || normalizeIntentInputForMatching(operatorMessage),
    chatContextMatchInput: intent.matchInput || normalizeIntentInputForMatching(operatorMessage),
    retrieval_query: input.retrieval_query || input.retrievalQuery || operatorMessage,
    raw_input: input.raw_input || input.rawInput || operatorMessage,
    normalizedOperatorMessage: input.normalizedOperatorMessage || normalizeIntentInput(operatorMessage),
  });

  const providerSnapshot = buildContextProviderSnapshot({
    ...input,
    githubPrEvidence,
    contextProviderIdsRequested,
  });
  const relevantCanon = CANON_RULES.filter((rule) => {
    if (mergeDecisionTask) return rule.tags.includes('merge') || rule.tags.includes('pr') || rule.tags.includes('codex') || rule.tags.includes('truth') || rule.tags.includes('ui') || rule.tags.includes('proof');
    if (uiTask) return rule.tags.includes('ui') || rule.tags.includes('truth') || rule.tags.includes('proof');
    return true;
  });


  warnings.push(...providerSnapshot.providerWarnings);
  const contextProviderProofState = providerSnapshot.contextProviderProofState;
  const providerNextActions = providerSnapshot.providerNextActions;
  const providerSummaries = providerSnapshot.providerSummaries;
  const contextProviderIdsRegistered = providerSnapshot.contextProviderIdsRegistered;
  const contextProviderRegistryStatus = providerSnapshot.contextProviderRegistryStatus;
  const contextProviderCanonLinks = providerSnapshot.contextProviderCanonLinks;

  const missionIntelligence = missionState?.operatorReliefProjection?.missionIntelligenceSummary
    || missionState?.missionIntelligenceSummary
    || {};
  const agentWorkRouting = missionState?.operatorReliefProjection?.agentWorkRoutingProjection || missionState?.agentWorkRoutingProjection || {};
  const coBuilderLoop = missionState?.operatorReliefProjection?.coBuilderLoopProjection || missionState?.coBuilderLoopProjection || {};
  const builderMeshProjection = missionState?.operatorReliefProjection?.builderMeshProjection || missionState?.builderMeshProjection || {};
  const agentRealityLoopProjection = missionState?.operatorReliefProjection?.agentRealityLoopProjection || missionState?.agentRealityLoopProjection || {};
  const agentRealityLoopProjectionSource = missionState?.operatorReliefProjection?.agentRealityLoopProjection
    ? 'operator-relief-bridge'
    : (missionState?.agentRealityLoopProjection ? 'mission-brain' : 'none');
  const boundedMissionIntelligenceContext = {
    missionSummary: missionIntelligence.currentMissionSummary || missionState?.activeMission?.summary || 'unknown',
    nextBestAction: missionIntelligence.nextBestAction || 'Review mission intelligence summary in Mission Brain.',
    harnessAgentRiskLevel: missionState?.operatorReliefProjection?.missionBrainNextAction?.riskLevel || 'unknown',
    affectedSubsystems: Array.isArray(input.supportSnapshot?.affectedSubsystems) ? input.supportSnapshot.affectedSubsystems : inferredSubsystems,
    protectedCanonSummary: missionIntelligence.protectedCanonSummary || 'Preserve protected canon boundaries.',
    proofStatus: missionIntelligence.proofRequiredSummary || 'targeted evidence required',
    blockers: Array.isArray(missionIntelligence.currentBlockers) ? missionIntelligence.currentBlockers : [],
    codexOpenClawReadiness: {
      codexReady: missionIntelligence.codexReady || 'unknown',
      openClawReady: missionIntelligence.openClawReady || 'unknown',
    },
    operatorApprovalRequired: missionIntelligence.operatorDecisionRequired !== false,
    agentWorkRouting: missionPlanningTask ? {
      workRoutingStatus: agentWorkRouting.workRoutingStatus || 'unknown',
      recommendedRoute: agentWorkRouting.recommendedRoute || 'unknown',
      recommendedRouteReason: agentWorkRouting.recommendedRouteReason || 'unknown',
      codexReady: agentWorkRouting.codexReady || 'unknown',
      openClawResearchReady: agentWorkRouting.openClawResearchReady || 'unknown',
      openClawExecutionReady: agentWorkRouting.openClawExecutionReady || 'no',
      operatorApprovalRequired: agentWorkRouting.operatorApprovalRequired || 'yes',
      requiredProof: Array.isArray(agentWorkRouting.requiredProof) ? agentWorkRouting.requiredProof : [],
      nextOperatorAction: agentWorkRouting.nextOperatorAction || 'Review mission routing summary and hold or approve bounded packet.',
    } : undefined,
    agentRealityLoop: agentRealityLoopTask ? {
      projectionSource: agentRealityLoopProjectionSource,
      projectionAvailable: Object.keys(agentRealityLoopProjection).length ? 'yes' : 'no',
      status: agentRealityLoopProjection.status || agentRealityLoopProjection.loopStatus || (Object.keys(agentRealityLoopProjection).length ? 'available' : 'unavailable'),
      recommendedLead: agentRealityLoopProjection.recommendedLead || 'hold',
      mergeRecommendation: agentRealityLoopProjection.mergeRecommendation || 'hold',
      operatorApprovalRequired: agentRealityLoopProjection.operatorApprovalRequired ?? true,
      requiredProof: Array.isArray(agentRealityLoopProjection.requiredProof) ? agentRealityLoopProjection.requiredProof : [],
      copyPacketsAvailable: agentRealityLoopProjection.copyCodexPacket && agentRealityLoopProjection.copyOpenClawPacket && agentRealityLoopProjection.copyOperatorProofChecklist ? 'yes' : 'no',
    } : undefined,
    builderMesh: missionPlanningTask ? {
      builderMeshStatus: builderMeshProjection.builderMeshStatus || 'unavailable',
      recommendedBuilder: builderMeshProjection.recommendedBuilder || 'hold',
      zeroCostRouteAvailable: builderMeshProjection.zeroCostRouteAvailable === true,
      codexRequired: builderMeshProjection.codexRequired === true,
      codexReason: builderMeshProjection.codexReason || 'Codex is fallback only unless explicitly justified.',
      localAiCanHelp: builderMeshProjection.localAiCanHelp || 'unknown',
      openClawCanHelp: builderMeshProjection.openClawCanHelp || 'unknown',
      githubCanHelp: builderMeshProjection.githubCanHelp || 'unknown',
      approvalRequiredBeforeMutation: builderMeshProjection.approvalRequiredBeforeMutation !== false,
      proofRequiredBeforeMerge: Array.isArray(builderMeshProjection.proofRequiredBeforeMerge) ? builderMeshProjection.proofRequiredBeforeMerge : [],
      blockers: Array.isArray(builderMeshProjection.blockers) ? builderMeshProjection.blockers : [],
      warnings: Array.isArray(builderMeshProjection.warnings) ? builderMeshProjection.warnings : [],
      nextBestAction: builderMeshProjection.nextBestAction || 'Review Builder Mesh truth in Operator Relief.',
      copyPacketNames: builderMeshProjection.copyPackets ? Object.keys(builderMeshProjection.copyPackets) : [],
    } : undefined,
    coBuilderLoop: missionPlanningTask ? {
      coBuilderStatus: coBuilderLoop.coBuilderStatus || 'inactive',
      loopRound: coBuilderLoop.loopRound || 1,
      maxRounds: coBuilderLoop.maxRounds || 3,
      recommendedLead: coBuilderLoop.recommendedLead || 'hold',
      recommendedNextWorker: coBuilderLoop.recommendedNextWorker || 'hold',
      recommendedNextAction: coBuilderLoop.recommendedNextAction || 'Review Co-Builder Loop summary.',
      operatorApprovalRequired: coBuilderLoop.operatorApprovalRequired || 'yes',
      packetAvailability: {
        openClawResearch: coBuilderLoop.openClawResearchPacketAvailable || 'no',
        codexImplementation: coBuilderLoop.codexPacketAvailable || 'no',
        verification: coBuilderLoop.verificationPacketAvailable || 'no',
        repair: coBuilderLoop.repairPacketAvailable || 'no',
        openClawExecution: coBuilderLoop.openClawExecutionPacketAvailable || 'no',
      },
      blockers: Array.isArray(coBuilderLoop.blockers) ? coBuilderLoop.blockers : [],
      requiredProof: Array.isArray(coBuilderLoop.requiredProof) ? coBuilderLoop.requiredProof : [],
      finalOperatorDecisionNeeded: coBuilderLoop.finalOperatorDecisionNeeded || 'approve | hold | copy packet',
    } : undefined,
  };
  const projectAwareness = buildProjectAwarenessPack({ missionState, missionIntelligence, proofState: contextProviderProofState, operatorProfile: input.operatorProfile || {} });

  const compactSummary = {
    status: warnings.length > 0 && !operatorMessage ? 'warning' : 'active',
    version: CHAT_CONTEXT_VERSION,
    responseMode,
    relevantCanonCount: relevantCanon.length,
    affectedSubsystems: Array.isArray(input.supportSnapshot?.affectedSubsystems) && input.supportSnapshot.affectedSubsystems.length
      ? input.supportSnapshot.affectedSubsystems
      : inferredSubsystems,
    nextAction: mergeDecisionTask
      ? 'Collect build/verify/UI proof and amend the open PR before deciding merge.'
      : (codexDispatchTask
        ? 'Build a Codex Dispatch Packet draft and wait for operator approval.'
        : (agentRealityLoopTask
          ? 'Answer with Stephanos Agent Reality Loop V1 projection (coordination/proof/merge-readiness/lesson-candidate truth), not generic agent loop failure guidance.'
        : (operatorExplanationTask
          ? 'Provide compact operator explanation and next bounded action.'
          : (uiTask ? 'Capture browser/UI Reality proof before asserting visible fix.' : 'Answer directly with bounded confidence.')))),
    warningCount: warnings.length,
    warnings,
    missionIntelligence: boundedMissionIntelligenceContext,
    projectAwareness,
    agentRealityLoopProjection: agentRealityLoopTask ? agentRealityLoopProjection : undefined,
    agentRealityLoopProjectionSource: agentRealityLoopTask ? agentRealityLoopProjectionSource : 'none',
    agentRealityLoopContextInjected: agentRealityLoopTask && Object.keys(agentRealityLoopProjection).length ? 'yes' : 'no',
    contextProviderIdsUsed: providerSnapshot.contextProviderIdsUsed,
    contextProviderIdsRegistered,
    contextProviderRegistryStatus,
    contextProviderWarningCount: providerSnapshot.contextProviderWarningCount,
    contextProviderProofState,
    contextProviderNextActions: providerNextActions,
    contextProviderCanonLinksCount: contextProviderCanonLinks.length,
    contextSourcesUsed: [
      'uiRealityStatus', 'routeTruth', 'providerTruth', 'missionState', 'supportSnapshot', 'memoryState', 'chatContinuity', 'operatorProfile', 'agentState',
      ...(boundedMissionIntelligenceContext.missionSummary !== 'unknown' || boundedMissionIntelligenceContext.nextBestAction !== 'Review mission intelligence summary in Mission Brain.'
        ? ['missionIntelligence']
        : []),
      ...(projectAwareness.status !== 'unavailable' ? ['projectAwareness'] : []),
      ...(missionPlanningTask ? ['agentWorkRouting', 'coBuilderLoop', 'builderMesh'] : []),
    ].filter((key) => key === 'missionIntelligence'
      || key === 'projectAwareness'
      || key === 'agentWorkRouting'
      || key === 'coBuilderLoop'
      || key === 'builderMesh'
      || (input[key] && typeof input[key] === 'object')),
    uiRealityStatusAtBuild: String(uiReality.severity || 'UNKNOWN'),
    missionStateAtBuild: boundedMissionIntelligenceContext.missionSummary !== 'unknown' ? 'known' : String(missionState.mode || missionState.status || 'unknown'),
    providerRouteSummaryAtBuild: `${String(routeTruth.routeKind || 'unknown')}:${String(routeTruth.executedProvider || providerTruth.executableProvider || 'unknown')}:${String(routeTruth.routeUsableState || 'unknown')}`,
    createdAt: new Date().toISOString(),
    requestId: String(input.requestId || input.commandId || '').trim() || null,
    buildSource,
  };

  const classifierProof = {
    matchInput: intent.matchInput || normalizeIntentInputForMatching(operatorMessage),
    mergeRulePattern: intent.mergeRulePattern || 'none',
    mergeRuleTestResult: intent.mergeRuleTestResult || 'no',
    firstMatchingRule: intent.firstMatchingRule || intent.matchedRule || 'direct-answer',
    evaluatedRuleResults: Array.isArray(intent.candidateRulesEvaluated) ? intent.candidateRulesEvaluated : [],
    intentClassifierMatchedRule: intent.matchedRule || responseMode || 'direct-answer',
    responseMode,
    defaultPackUsed: (intent.matchedRule && intent.matchedRule !== 'direct-answer') ? 'no' : 'yes',
    fallbackApplied: intent.fallbackApplied ? 'yes' : 'no',
    operatorExplanationIntentDetected: explanationIntent.matched ? 'yes' : 'no',
    operatorExplanationMode: explanationIntent.mode || 'compact',
  };

  return {
    version: CHAT_CONTEXT_VERSION,
    compactSummary,
    operatorIntent: responseMode,
    affectedSubsystems: Array.isArray(input.supportSnapshot?.affectedSubsystems) && input.supportSnapshot.affectedSubsystems.length
      ? input.supportSnapshot.affectedSubsystems
      : inferredSubsystems,
    missionMode: String(missionState.mode || missionState.status || 'unknown'),
    inputMissionState: missionState,
    riskLevel: (uiTask || mergeDecisionTask) ? 'medium' : 'low',
    relevantCanon,
    providerSummaries,
    githubPrEvidence,
    providerWarnings: providerSnapshot.providerWarnings,
    providerNextActions,
    contextProviderIdsUsed: providerSnapshot.contextProviderIdsUsed,
    contextProviderIdsRegistered,
    contextProviderRegistryStatus,
    contextProviderWarningCount: providerSnapshot.contextProviderWarningCount,
    contextProviderProofState,
    contextProviderNextActions: providerNextActions,
    contextProviderCanonLinksCount: contextProviderCanonLinks.length,
    relevantMemory: Array.isArray(input.memoryState?.candidates) ? input.memoryState.candidates.slice(0, 3) : [],
    operatorProfile: input.operatorProfile && typeof input.operatorProfile === 'object' ? {
      operatorName: String(input.operatorProfile.operatorName || ''),
      known: input.operatorProfile.known === true,
      confidence: String(input.operatorProfile.confidence || 'unknown'),
      source: String(input.operatorProfile.source || 'none'),
      nextAction: String(input.operatorProfile.nextAction || 'Ask operator for preferred name when relevant.'),
    } : { operatorName: '', known: false, confidence: 'unknown', source: 'none', nextAction: 'Ask operator for preferred name when relevant.' },
    currentTruthSummary: {
      runtime: String(input.runtimeTruth?.status || 'unknown'),
      routeKind: String(routeTruth.routeKind || 'unknown'),
      routeUsable: String(routeTruth.routeUsableState || 'unknown'),
      provider: String(routeTruth.executedProvider || providerTruth.executableProvider || 'unknown'),
    },
    uiRealitySummary: {
      status: String(uiReality.severity || 'UNKNOWN'),
      reason: String(uiReality.reason || uiReality.uiRealityReason || 'unknown'),
    },
    routeProviderSummary: {
      requestedProvider: String(routeTruth.requestedProvider || 'unknown'),
      selectedProvider: String(routeTruth.selectedProvider || 'unknown'),
      executedProvider: String(routeTruth.executedProvider || providerTruth.executableProvider || 'unknown'),
    },
    agentSummary: input.agentState || {},
    chatContinuity: input.chatContinuity || {},
    proofRequirements: uiTask
      ? ['browser-ui-reality-proof', 'source-of-truth-proof', 'targeted-tests']
      : ['targeted-evidence'],
    recommendedResponseMode: responseMode,
    operatorExplanationIntentDetected: explanationIntent.matched ? 'yes' : 'no',
    operatorExplanationMode: explanationIntent.mode || 'compact',
    intentClassifierMatchedRule: classifierProof.intentClassifierMatchedRule,
    matchInput: classifierProof.matchInput,
    mergeRulePattern: classifierProof.mergeRulePattern,
    mergeRuleTestResult: classifierProof.mergeRuleTestResult,
    firstMatchingRule: classifierProof.firstMatchingRule,
    evaluatedRuleResults: classifierProof.evaluatedRuleResults,
    classifierProof,
    recommendedNextAction: mergeDecisionTask
      ? 'Collect build/verify/UI proof and amend the open PR before deciding merge.'
      : (codexDispatchTask
        ? 'Build a Codex Dispatch Packet draft and wait for operator approval.'
        : (agentRealityLoopTask
          ? 'Answer with Stephanos Agent Reality Loop V1 projection (coordination/proof/merge-readiness/lesson-candidate truth), not generic agent loop failure guidance.'
          : (uiTask ? 'Capture browser/UI Reality proof before asserting visible fix.' : 'Answer directly with bounded confidence.'))),
    warnings,
    contextForPrompt: {
      operatorMessage,
      responseMode,
      intentClassifierMatchedRule: intent.matchedRule,
      missionMode: String(missionState.mode || missionState.status || 'unknown'),
    inputMissionState: missionState,
      uiRealityStatus: String(uiReality.severity || 'UNKNOWN'),
      route: String(routeTruth.routeKind || 'unknown'),
      provider: String(routeTruth.executedProvider || providerTruth.executableProvider || 'unknown'),
      canon: relevantCanon.map((rule) => rule.text),
      contextProviderCanonLinks,
      proofRequirements: uiTask ? 'ui-reality+source-truth required' : 'standard',
      operatorProfileLine: providerSummaries?.operatorProfile?.known === 'yes' ? `Operator profile indicates the operator's name is ${providerSummaries.operatorProfile.operatorName}. Use this if asked about the operator's name.` : 'Operator profile does not include a known operator name yet.',
      missionIntelligence: boundedMissionIntelligenceContext,
      projectAwareness,
    },
    classifierDebug: {
      classifierFunctionSource: intent.classifierFunctionSource,
      classifierRuleOrder: intent.classifierRuleOrder,
      classifierCandidateRulesEvaluated: intent.candidateRulesEvaluated,
      classifierMergeRuleMatched: intent.mergeRuleMatched ? 'yes' : 'no',
      classifierRegexUsed: intent.matchedRegex,
      classifierRuleIndex: intent.matchedRuleIndex,
      classifierFallbackApplied: intent.fallbackApplied ? 'yes' : 'no',
      classifierMatchInput: classifierProof.matchInput,
      classifierMergeRulePattern: intent.mergeRulePattern || 'none',
      classifierMergeRuleTestResult: intent.mergeRuleTestResult || 'no',
      classifierFirstMatchingRule: intent.firstMatchingRule || intent.matchedRule,
      defaultOverrideReason: 'none',
      builderFunction: 'buildChatContextPack',
      fallbackBranchTaken: intent.fallbackApplied ? 'yes' : 'no',
      fallbackBranchReason: intent.fallbackApplied ? 'no-intent-rule-matched' : 'none',
    },
  };
}

export { pickResponseMode, classifyIntent, normalizeIntentInput, normalizeIntentInputForMatching };
