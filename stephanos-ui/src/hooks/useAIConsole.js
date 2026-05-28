import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseCommand } from '../ai/commandParser';
import { checkApiHealth, getApiRuntimeConfig, getProviderHealth, releaseLocalOllamaLoad, resolveStreamingRequestPolicy, sendPrompt } from '../ai/aiClient';
import { applyDetectedOllamaConnection, createSearchingOllamaHealth, runOllamaDiscovery, shouldAutoSyncOllama } from '../ai/ollamaRuntimeSync';
import { getApiRuntimeConfigSnapshotKey } from '../ai/apiConfig';
import { resolveUiRequestTimeoutPolicy } from '../ai/timeoutPolicy';
import { resolveOllamaLoadGovernorPolicy } from '../../../shared/ai/ollamaLoadGovernor.mjs';
import {
  DEFAULT_HOME_NODE_BACKEND_PORT,
  createStephanosHomeNodeUrls,
  discoverStephanosHomeNode,
  extractHostname,
  isLoopbackHost,
  normalizeStephanosHomeNode,
  summarizeStephanosHomeNode,
  validateStephanosBackendTargetUrl,
} from '../../../shared/runtime/stephanosHomeNode.mjs';
import { createRuntimeStatusModel } from '../../../shared/runtime/runtimeStatusModel.mjs';
import { createRuntimeWorkGovernor } from '../../../shared/runtime/runtimeWorkGovernor.mjs';
import { useAIStore } from '../state/aiStore';
import { resolveUiReachabilityFromHealth, summarizeHomeNodeUsabilityTruth } from '../state/homeNodeUsabilityTruth.js';
import { buildFinalRouteTruthView } from '../state/finalRouteTruthView.js';
import { buildContinuitySummary, getContinuityContext } from '../state/continuityRetrieval.js';
import { assembleStephanosContext } from '../../../shared/ai/assembleStephanosContext.mjs';
import { buildAiActionContext, readMissionDashboardStateFromMemory } from '../state/aiActionContext';
import { buildMissionActionPrompt, validateAiActionContext } from '../ai/missionActionService';
import { classifyPromptFreshness, resolveFreshnessRoutingDecision } from '../ai/freshnessRouting';
import { buildContextAssembly } from '../ai/contextAssembly.js';
import { classifyOperatorIntent } from '../ai/intentEngine.js';
import { buildMissionExecutionPacket } from '../ai/missionExecutionEngine.js';
import { appendCommandHistory, upsertCommandHistoryById } from './commandHistory.js';
import { evaluateRequestDispatchGate } from './requestDispatchGate.js';
import { normalizeMissionPacketTruth } from '../state/missionPacketWorkflow.js';
import { buildCanonicalMissionPacket } from '../state/runtimeOrchestrationTruth.js';
import { deriveRuntimeOrchestrationSelectors } from '../state/runtimeOrchestrationSelectors.js';
import { adjudicateOperatorLifecycleIntent } from '../state/operatorCommandIntents.js';
import { buildOperatorReplyPayload, resolveOperatorReplyPromptKey } from '../state/operatorReplyAdapter.js';
import { recordPerfCounter, recordPerfEvent, setPerfIdentityField } from '../state/perfDiagnostics.js';
import { buildChatContextPack } from '../state/chatContextOrchestrator.js';
import { resolveGithubPrEvidenceReadOnly } from '../state/githubPrEvidenceProvider.js';
import { buildResponsePlan } from '../state/responsePlanner.js';
import { buildOperatorExplanationProjection, detectOperatorExplanationIntent, formatOperatorExplanation } from '../state/operatorExplanationProjection.js';
import { buildChatContinuitySummary, readChatContinuity, persistChatContinuity, seedChatContinuityFromExistingHistory } from '../state/chatContinuity.js';
import { readOperatorProfile, updateOperatorProfileFromMessage, persistOperatorProfile } from '../state/operatorProfileMemory.js';
import { buildActiveMissionState, persistActiveMissionState, readActiveMissionState } from '../state/activeMissionState.js';
import { attachChatContextToEnvelope, attachExecutionMetadataToEnvelope, attachPrEvidenceToEnvelope, attachProviderRequestToEnvelope, createCommandEnvelope, projectEnvelopeToExecutionMetadata } from '../state/commandEnvelope.js';
import { buildAnswerDeliveryTruth } from '../state/answerDeliveryTruth.js';

const BACKEND_UNREACHABLE_MESSAGE = 'Backend unreachable from current frontend origin.';
const FAST_RESPONSE_MODEL = 'llama3.2:3b';
const HEAVY_OLLAMA_MODELS = new Set(['gpt-oss:20b', 'qwen:14b', 'qwen:32b']);
const OLLAMA_MODEL_MATCHERS = ['llama', 'qwen', 'gpt-oss'];

function normalizeProviderKey(value = '') {
  return String(value || '').trim().toLowerCase();
}

function modelMatchesProviderFamily(provider = '', model = '') {
  const normalizedProvider = normalizeProviderKey(provider);
  const normalizedModel = String(model || '').trim().toLowerCase();
  if (!normalizedProvider || !normalizedModel) return true;
  if (normalizedProvider === 'ollama') {
    return !normalizedModel.includes('gemini');
  }
  if (normalizedProvider === 'gemini') {
    return !OLLAMA_MODEL_MATCHERS.some((token) => normalizedModel.includes(token));
  }
  return true;
}

function normalizeFastLanePrompt(prompt = '') {
  const text = String(prompt || '').trim();
  if (!text) return '';
  const boundaryPatterns = [
    /\n+\[system awareness context:/i,
    /\n+##\s*memory\b/i,
    /\n+##\s*conversation\b/i,
    /\n+##\s*runtime\b/i,
  ];
  let normalized = text;
  for (const pattern of boundaryPatterns) {
    const match = normalized.match(pattern);
    if (match?.index > 0) {
      normalized = normalized.slice(0, match.index).trim();
      break;
    }
  }
  return normalized
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || normalized;
}

function isFastLanePromptEligible(prompt = '') {
  const normalized = normalizeFastLanePrompt(prompt);
  if (!normalized) return true;
  if (/\bwho am i talking to\b/i.test(normalized)) return true;
  return normalized.split(/\s+/).filter(Boolean).length <= 18;
}

function summarizeDiscoveryAttempts(attempts = []) {
  if (!Array.isArray(attempts) || !attempts.length) {
    return 'No non-loopback candidates were available to probe.';
  }

  return attempts
    .map((attempt) => {
      const candidate = `${attempt.source || 'unknown'}:${attempt.host || 'unknown'}`;
      if (attempt.ok) {
        return `${candidate} accepted`;
      }

      return `${candidate} rejected (${attempt.failureDetail || attempt.reason || 'unknown failure'})`;
    })
    .join(' | ');
}

function resolveCompatibleTarget(candidate = '', fallback = '', { allowLoopback = false } = {}) {
  const candidateValidation = validateStephanosBackendTargetUrl(candidate, { allowLoopback });
  if (candidateValidation.ok) {
    return candidate;
  }

  const fallbackValidation = validateStephanosBackendTargetUrl(fallback, { allowLoopback });
  if (fallbackValidation.ok) {
    return fallback;
  }

  return allowLoopback ? (candidate || fallback || '') : '';
}

function resolveLocalDesktopBackendBaseUrl(frontendOrigin = '') {
  const frontendHost = extractHostname(frontendOrigin);
  const preferredHost = isLoopbackHost(frontendHost) ? frontendHost : 'localhost';
  return createStephanosHomeNodeUrls({
    host: preferredHost || 'localhost',
    backendPort: DEFAULT_HOME_NODE_BACKEND_PORT,
  }).backendUrl;
}

function enforceLocalDesktopExecuteRoute(routeTruthView = {}, runtimeContext = {}) {
  const forcedLocalDesktopTarget = resolveLocalDesktopBackendBaseUrl(runtimeContext.frontendOrigin || '');
  return {
    ...routeTruthView,
    preferredTarget: forcedLocalDesktopTarget || routeTruthView.preferredTarget || '',
    actualTarget: forcedLocalDesktopTarget || routeTruthView.actualTarget || '',
  };
}

function resolveExecuteRouteTruth({ runtimeStatus = null, routeTruthView = null } = {}) {
  const status = runtimeStatus && typeof runtimeStatus === 'object' ? runtimeStatus : {};
  const view = routeTruthView && typeof routeTruthView === 'object' ? routeTruthView : {};
  const runtimeContext = status.runtimeContext && typeof status.runtimeContext === 'object' ? status.runtimeContext : {};
  const canonicalRouteTruth = status.canonicalRouteRuntimeTruth && typeof status.canonicalRouteRuntimeTruth === 'object'
    ? status.canonicalRouteRuntimeTruth
    : {};
  const runtimeTruthRouteCandidates = Array.isArray(status?.runtimeTruth?.routeCandidates) ? status.runtimeTruth.routeCandidates : [];
  const runtimeContextRouteCandidates = Array.isArray(runtimeContext?.routeCandidates) ? runtimeContext.routeCandidates : [];
  const routeCandidates = [...runtimeTruthRouteCandidates, ...runtimeContextRouteCandidates];
  const sessionKind = String(runtimeContext.sessionKind || canonicalRouteTruth.sessionKind || '').trim();
  const deviceContext = String(runtimeContext.deviceContext || canonicalRouteTruth.deviceContext || '').trim();
  const localDesktopSession = sessionKind === 'local-desktop' || deviceContext === 'pc-local-browser';
  if (!localDesktopSession) return view;
  const localDesktopDiagnostics = runtimeContext.routeDiagnostics?.['local-desktop'] || {};
  const localDesktopCandidate = routeCandidates.find((candidate) => candidate?.routeKind === 'local-desktop') || null;
  const localDesktopReachable = localDesktopDiagnostics.available === true
    || localDesktopDiagnostics.backendReachable === true
    || localDesktopCandidate?.available === true;
  const localDesktopUsable = localDesktopCandidate?.usable === true
    || localDesktopDiagnostics.usable === true
    || localDesktopReachable;
  if (!localDesktopCandidate && !localDesktopReachable) return view;

  const localDesktopTarget = String(
    runtimeContext.routeDiagnostics?.['local-desktop']?.actualTarget
    || runtimeContext.routeDiagnostics?.['local-desktop']?.target
    || runtimeContext.backendBaseUrl
    || runtimeContext.baseUrl
    || canonicalRouteTruth.actualTarget
    || '',
  ).trim();
  return enforceLocalDesktopExecuteRoute({
    ...view,
    routeKind: 'local-desktop',
    preferredRoute: 'local-desktop',
    selectedRouteReachableState: 'yes',
    routeUsableState: localDesktopUsable ? 'yes' : 'no',
    backendReachableState: localDesktopReachable ? 'yes' : 'no',
    preferredTarget: localDesktopTarget || view.preferredTarget,
    actualTarget: localDesktopTarget || view.actualTarget,
    winnerReason: localDesktopCandidate?.reason || localDesktopDiagnostics.reason || view.winnerReason,
    routeUsabilityVetoReason: localDesktopUsable ? null : 'backend-route-unavailable',
  }, runtimeContext);
}

export function buildResponsePlanExecutionMetadata(responsePlan = null) {
  const plan = responsePlan && typeof responsePlan === 'object' ? responsePlan : {};
  const warnings = Array.isArray(plan.warnings) ? plan.warnings : [];
  const requiredSections = Array.isArray(plan.requiredSections) ? plan.requiredSections : [];
  const canonApplied = Array.isArray(plan.canonApplied) ? plan.canonApplied : [];
  return {
    response_planner_status: plan.status || 'unavailable',
    response_planner_version: plan.version || 'n/a',
    response_planner_response_mode: plan.responseMode || 'direct-answer',
    response_planner_answer_shape: plan.answerShape || 'direct-answer',
    response_planner_required_sections: requiredSections.length ? requiredSections.join('|') : 'none',
    response_planner_risk_level: plan.riskLevel || 'low',
    response_planner_proof_required: plan.proofRequired || 'no',
    response_planner_merge_decision: plan.mergeDecision || 'unknown',
    response_planner_codex_prompt_required: plan.codexPromptRequired || 'no',
    response_planner_next_action: plan.recommendedNextAction || 'answer directly with bounded confidence',
    response_planner_warning_count: warnings.length,
    response_planner_warnings: warnings.length ? warnings.join(' | ') : 'none',
    response_planner_canon_applied: canonApplied.length ? canonApplied.join('|') : 'none',
    response_planner_identity_recall: plan.identityRecallUsed || 'no',
    response_planner_operator_name_used: plan.operatorNameUsed || 'no',
    response_planner_identity_prompt_injected: plan.identityPromptInjected || 'no',
    operator_profile_prompt_line_present: plan.operatorProfilePromptLinePresent || 'no',
    final_answer_used_operator_profile: plan.finalAnswerUsedOperatorProfile || 'no',
    identity_recall_deterministic_answer_used: plan.identityRecallDeterministicAnswerUsed || 'no',
  };
}


function toTruthyValue(value = '') {
  const normalized = String(value ?? '').trim();
  return normalized && normalized !== 'unknown' && normalized !== 'none' ? normalized : '';
}

function buildProjectAwarenessPromptContext(chatContextPack = null, prompt = '') {
  const responseMode = String(chatContextPack?.recommendedResponseMode || '').trim().toLowerCase();
  const normalizedPrompt = String(prompt || '').trim().toLowerCase();
  const missionPlanningEligible = responseMode === 'mission-planning'
    || responseMode === 'architecture-guidance'
    || /\b(mission|project|build|next best action|next action|workflow|codex|openclaw|agent reality loop|reality loop|agent loop|proof loop|merge readiness loop)\b/.test(normalizedPrompt);
  if (!missionPlanningEligible) {
    return { block: '', injected: 'no', sources: [], missionPlanningContextUsed: 'no' };
  }
  const projectAwareness = chatContextPack?.contextForPrompt?.projectAwareness || chatContextPack?.compactSummary?.projectAwareness || {};
  const missionAgentRealityLoopProjection = chatContextPack?.inputMissionState?.operatorReliefProjection?.agentRealityLoopProjection
    || chatContextPack?.inputMissionState?.agentRealityLoopProjection
    || {};
  const projectionStatusNormalized = String(
    missionAgentRealityLoopProjection?.status
    || missionAgentRealityLoopProjection?.loopStatus
    || projectAwareness?.agentRealityLoopProjectionStatus
    || '',
  ).trim().toLowerCase();
  const projectionAvailable = ['available', 'active', 'ready'].includes(projectionStatusNormalized)
    || Object.keys(missionAgentRealityLoopProjection).length > 0;
  const projectionBlocker = projectionAvailable ? 'none' : 'projection-missing-from-command-deck-path';
  const missionIntelligence = chatContextPack?.contextForPrompt?.missionIntelligence || chatContextPack?.compactSummary?.missionIntelligence || {};
  const sources = Array.isArray(projectAwareness.sourcesUsed) ? projectAwareness.sourcesUsed.filter(Boolean) : [];
  const hasStrategicContext = Boolean(
    projectAwareness.projectNorthStar
    || projectAwareness.operatorWorkflowPreference
    || projectAwareness.nextBestAction
    || projectAwareness.codexRole
    || projectAwareness.openClawRole,
  );
  const strategicMissionFallback = 'Not fully established in active mission state, but best available project-awareness context says the active strategic mission is to reduce operator complexity by wiring Mission Brain, Harness Agent, proof, canon, and project awareness into the existing Command Deck AI path while preserving main-first/main-only simplicity and avoiding new panes.';
  const currentMissionSummary = projectAwareness.currentMissionSummary
    || missionIntelligence.missionSummary
    || (hasStrategicContext ? strategicMissionFallback : 'unknown (warning: degraded context)');
  const blockLines = [
    '[Project Awareness Context: bounded truth for mission-planning only]',
    `- project north star: ${projectAwareness.projectNorthStar || 'unknown'}`,
    `- operator workflow preference: ${projectAwareness.operatorWorkflowPreference || 'unknown'}`,
    `- project awareness status: ${projectAwareness.status || 'unavailable'}`,
    `- current mission: ${currentMissionSummary}`,
    `- next best action: ${projectAwareness.nextBestAction || missionIntelligence.nextBestAction || 'unknown'}`,
    `- codex role: ${projectAwareness.codexRole || 'unknown'}`,
    `- openclaw role: ${projectAwareness.openClawRole || 'unknown'}`,
    `- agent reality loop v1 summary: ${projectAwareness.agentRealityLoopV1Summary || 'Agent Reality Loop V1: read-only coordination/proof projection inside Mission Brain / Operator Relief.'}`,
    `- agent reality loop projection status: ${projectAwareness.agentRealityLoopProjectionStatus || missionAgentRealityLoopProjection?.status || missionAgentRealityLoopProjection?.loopStatus || 'unavailable'}`,
    `- agent reality loop projection available: ${projectionAvailable ? 'yes' : 'no'}`,
    `- agent reality loop availability blocker: ${projectionBlocker}`,
    `- protected canon summary: ${projectAwareness.protectedCanonSummary || 'Preserve launcher/runtime separation, truth boundaries, and command deck protections.'}`,
    `- forbidden complexity warnings: ${projectAwareness.forbiddenComplexityWarnings || 'Do not add panes/systems or duplicate mission/chat/memory surfaces.'}`,
    '- answer synthesis directive (mission-planning only): Do not claim Agent Reality Loop V1 is unavailable when projection exists. If Project Awareness is degraded, phrase only as: "Some mission details may be incomplete because Project Awareness is degraded."',
    `- relevant mission/proof/canon sources: ${sources.length ? sources.join('|') : 'none'}`,
  ];
  const block = blockLines.join('\n');
  return { block, injected: 'yes', sources, missionPlanningContextUsed: 'yes' };
}

function buildWorkRoutingPromptContext(chatContextPack = null, prompt = '', modeHints = {}) {
  const responseModeCandidates = [
    chatContextPack?.recommendedResponseMode,
    modeHints?.responsePlannerResponseMode,
    modeHints?.commandEnvelopeResponseMode,
    modeHints?.chatContextResponseMode,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  const responseMode = responseModeCandidates.find((value) => value !== 'direct-answer') || (responseModeCandidates[0] || '');
  if (responseMode !== 'work-routing') {
    return { block: '', injected: 'no', sources: [], packStatus: 'unavailable' };
  }
  const missionIntelligence = chatContextPack?.contextForPrompt?.missionIntelligence || chatContextPack?.compactSummary?.missionIntelligence || {};
  const agentWorkRouting = missionIntelligence?.agentWorkRouting || {};
  const coBuilderLoop = missionIntelligence?.coBuilderLoop || {};
  const sources = ['agentWorkRouting', 'coBuilderLoop'];
  const requiredProof = [
    ...(Array.isArray(agentWorkRouting.requiredProof) ? agentWorkRouting.requiredProof : []),
    ...(Array.isArray(coBuilderLoop.requiredProof) ? coBuilderLoop.requiredProof : []),
  ].filter(Boolean);
  const blockers = [
    ...(Array.isArray(agentWorkRouting.blockers) ? agentWorkRouting.blockers : []),
    ...(Array.isArray(coBuilderLoop.blockers) ? coBuilderLoop.blockers : []),
  ].filter(Boolean);
  const packetAvailability = coBuilderLoop?.packetAvailability || {};
  const hasAnyContext = Object.keys(agentWorkRouting).length > 0 || Object.keys(coBuilderLoop).length > 0;
  const packStatus = hasAnyContext ? 'degraded' : 'unavailable';
  const blockLines = [
    '[Work Routing Context: bounded truth for Codex/OpenClaw task assignment only]',
    `- recommended route: ${agentWorkRouting.recommendedRoute || 'unknown'}`,
    `- recommended next worker: ${coBuilderLoop.recommendedNextWorker || 'hold'}`,
    `- codex readiness: ${agentWorkRouting.codexReady || 'unknown'}`,
    `- openclaw research readiness: ${agentWorkRouting.openClawResearchReady || 'unknown'}`,
    `- openclaw execution readiness: ${agentWorkRouting.openClawExecutionReady || 'no'}`,
    `- operator approval required: ${agentWorkRouting.operatorApprovalRequired || coBuilderLoop.operatorApprovalRequired || 'yes'}`,
    `- current co-builder loop status: ${coBuilderLoop.coBuilderStatus || 'inactive'}`,
    `- round / maxRounds: ${coBuilderLoop.loopRound || 1} / ${coBuilderLoop.maxRounds || 3}`,
    `- OpenClaw Research Packet availability: ${packetAvailability.openClawResearch || 'no'}`,
    `- Codex Implementation Packet availability: ${packetAvailability.codexImplementation || 'no'}`,
    `- Verification Packet availability: ${packetAvailability.verification || 'no'}`,
    `- Repair Packet availability: ${packetAvailability.repair || 'no'}`,
    `- required proof: ${requiredProof.length ? requiredProof.join(' | ') : 'targeted proof required'}`,
    `- blockers / warnings: ${blockers.length ? blockers.join(' | ') : 'none reported'}`,
    `- next operator action: ${agentWorkRouting.nextOperatorAction || coBuilderLoop.recommendedNextAction || 'Review routing summary, then approve | hold | copy packet.'}`,
    '- approval-gated caveat: operator remains final approval authority for execution and merge.',
    '- no auto-dispatch / no auto-merge caveat: do not auto-dispatch OpenClaw/Codex execution and do not auto-merge.',
    '- operator preference: main-first/main-only workflow until approved otherwise.',
  ];
  return { block: blockLines.join('\n'), injected: 'yes', sources, packStatus };
}

export function normalizeProjectAwarenessMetadata({
  responseMode = 'direct-answer',
  compact = {},
  projectAwareness = {},
  providerIdsUsed = [],
  missionState = {},
  boundedMissionSummary = 'unknown',
} = {}) {
  const missionSummaryFallback = toTruthyValue(projectAwareness.currentMissionSummary)
    || toTruthyValue(boundedMissionSummary)
    || toTruthyValue(missionState?.activeMission?.summary)
    || 'unknown';
  const sources = Array.isArray(projectAwareness.sourcesUsed) ? projectAwareness.sourcesUsed.filter(Boolean) : [];
  const hasMeaningfulField = Boolean(
    toTruthyValue(projectAwareness.nextBestAction)
    || toTruthyValue(projectAwareness.operatorWorkflowPreference)
    || toTruthyValue(projectAwareness.codexRole)
    || toTruthyValue(projectAwareness.openClawRole)
    || sources.length,
  );
  const warnings = [];
  let status = projectAwareness.status || 'unavailable';
  if (hasMeaningfulField && status === 'unavailable') status = 'degraded';
  if (hasMeaningfulField && missionSummaryFallback === 'unknown') {
    status = 'degraded';
    warnings.push('project awareness current mission summary unavailable');
  }
  if (hasMeaningfulField && !sources.length) sources.push('projectAwarenessDerived');
  const boundedMissionKnown = toTruthyValue(boundedMissionSummary);
  const missionProviderReady = providerIdsUsed.includes('missionState');
  let chatContextMissionState = compact?.missionStateAtBuild || 'unknown';
  if ((missionProviderReady || boundedMissionKnown) && chatContextMissionState === 'unknown') {
    chatContextMissionState = boundedMissionKnown || 'degraded';
  }
  const sourceSet = new Set(Array.isArray(compact?.contextSourcesUsed) ? compact.contextSourcesUsed.filter(Boolean) : []);
  const agentRealityLoopProjection = missionState?.operatorReliefProjection?.agentRealityLoopProjection || missionState?.agentRealityLoopProjection || {};
  const agentRealityLoopAvailable = Object.keys(agentRealityLoopProjection).length > 0;
  const planningOrRoutingMode = responseMode === 'mission-planning' || responseMode === 'work-routing';
  if (planningOrRoutingMode && status !== 'unavailable') sourceSet.add('projectAwareness');
  if (planningOrRoutingMode && boundedMissionKnown) sourceSet.add('missionIntelligence');
  if (agentRealityLoopAvailable) sourceSet.add(missionState?.operatorReliefProjection?.agentRealityLoopProjection ? 'operator-relief-bridge' : 'mission-brain');
  const chatContextSourcesUsed = Array.from(sourceSet);
  const baseChatContextPackStatus = compact?.status === 'unavailable' && planningOrRoutingMode && providerIdsUsed.length
    ? 'degraded'
    : (compact?.status || 'unavailable');
  const chatContextPackStatus = agentRealityLoopAvailable && baseChatContextPackStatus !== 'active'
    ? 'degraded-with-arl'
    : baseChatContextPackStatus;

  return {
    projectAwarenessStatus: status,
    projectAwarenessSourcesUsed: sources,
    projectAwarenessCurrentMission: missionSummaryFallback,
    projectAwarenessNextAction: projectAwareness.nextBestAction || 'unknown',
    projectAwarenessWorkflowPreference: projectAwareness.operatorWorkflowPreference || 'unknown',
    projectAwarenessCodexRole: projectAwareness.codexRole || 'unknown',
    projectAwarenessOpenClawRole: projectAwareness.openClawRole || 'unknown',
    projectAwarenessWarnings: warnings,
    chatContextMissionState,
    chatContextSourcesUsed,
    chatContextPackStatus,
  };
}

export function buildChatContextExecutionMetadata(chatContextPack = null) {
  const hasPack = chatContextPack && typeof chatContextPack === 'object';
  const compact = chatContextPack?.compactSummary || {};
  const providerIdsUsed = Array.isArray(chatContextPack?.contextProviderIdsUsed)
    ? chatContextPack.contextProviderIdsUsed
    : (Array.isArray(compact?.contextProviderIdsUsed) ? compact.contextProviderIdsUsed : []);
  const providerIdsRegistered = Array.isArray(chatContextPack?.contextProviderIdsRegistered)
    ? chatContextPack.contextProviderIdsRegistered
    : (Array.isArray(compact?.contextProviderIdsRegistered) ? compact.contextProviderIdsRegistered : []);
  const providerNextActions = Array.isArray(chatContextPack?.providerNextActions)
    ? chatContextPack.providerNextActions
    : (Array.isArray(compact?.contextProviderNextActions) ? compact.contextProviderNextActions : []);
  const providerProofState = chatContextPack?.contextProviderProofState || compact?.contextProviderProofState || null;

  const activeMission = chatContextPack?.providerSummaries?.missionState || {};
  const providerCanonLinksCount = Array.isArray(chatContextPack?.contextForPrompt?.contextProviderCanonLinks)
    ? chatContextPack.contextForPrompt.contextProviderCanonLinks.length
    : Number(compact?.contextProviderCanonLinksCount || 0);
  const projectAwareness = compact?.projectAwareness || chatContextPack?.contextForPrompt?.projectAwareness || {};
  const projectAwarenessTruth = normalizeProjectAwarenessMetadata({
    responseMode: chatContextPack?.recommendedResponseMode || compact?.responseMode || 'direct-answer',
    compact,
    projectAwareness,
    providerIdsUsed,
    missionState: chatContextPack?.inputMissionState || {},
    boundedMissionSummary: compact?.missionIntelligence?.missionSummary || 'unknown',
  });
  const agentRealityLoopProjection = chatContextPack?.inputMissionState?.operatorReliefProjection?.agentRealityLoopProjection
    || chatContextPack?.inputMissionState?.agentRealityLoopProjection
    || {};
  const matchedRule = String(chatContextPack?.intentClassifierMatchedRule || compact?.intentClassifierMatchedRule || '').trim().toLowerCase();
  const firstMatchingRule = String(chatContextPack?.firstMatchingRule || compact?.firstMatchingRule || '').trim().toLowerCase();
  const explicitIntentMatched = String(chatContextPack?.contextForPrompt?.intentClassifierMatchedRule || '').trim().toLowerCase() === 'agent-reality-loop';
  const agentRealityLoopTermsDetected = /\b(agent reality loop( v1)?|reality loop|agent loop|codex\/openclaw coordination loop|proof loop|merge readiness loop)\b/.test(
    String(chatContextPack?.matchInput || '').toLowerCase(),
  );
  const agentRealityLoopContextRecognized = matchedRule === 'agent-reality-loop'
    || firstMatchingRule === 'agent-reality-loop'
    || explicitIntentMatched
    || agentRealityLoopTermsDetected;
  const projectionStatus = String(agentRealityLoopProjection?.status || agentRealityLoopProjection?.loopStatus || '').trim().toLowerCase();
  const projectionAvailableStatus = ['available', 'active', 'ready'].includes(projectionStatus);
  const projectionObjectPresent = Object.keys(agentRealityLoopProjection).length > 0;
  const projectionAvailable = projectionAvailableStatus || projectionObjectPresent;
  const projectionSourceSeen = projectionObjectPresent
    ? (chatContextPack?.inputMissionState?.operatorReliefProjection?.agentRealityLoopProjection ? 'operator-relief-bridge' : 'mission-brain')
    : (projectAwareness?.agentRealityLoopProjectionStatus ? 'projectAwareness.status-only' : 'none');
  const copyPacketsAvailable = Boolean(
    agentRealityLoopProjection?.copyCodexPacket
    && agentRealityLoopProjection?.copyOpenClawPacket
    && agentRealityLoopProjection?.copyOperatorProofChecklist,
  );
  const contextSourceParts = [];
  if (agentRealityLoopContextRecognized) contextSourceParts.push('chatContext.intent');
  if (projectionObjectPresent) contextSourceParts.push('command-deck-projection-bridge');
  else if (projectAwarenessTruth.projectAwarenessStatus !== 'unavailable') contextSourceParts.push('projectAwareness');
  const contextSource = contextSourceParts.length ? contextSourceParts.join('+') : 'none';

  return {
    chat_context_pack_status: projectAwarenessTruth.chatContextPackStatus || compact?.status || (hasPack ? 'active' : 'unavailable'),
    chat_context_version: chatContextPack?.version || 'n/a',
    chat_context_response_mode: chatContextPack?.recommendedResponseMode || compact?.responseMode || 'direct-answer',
    chat_context_operator_explanation_intent_detected: chatContextPack?.operatorExplanationIntentDetected || 'no',
    chat_context_operator_explanation_mode: chatContextPack?.operatorExplanationMode || 'compact',
    chat_context_relevant_canon_count: Array.isArray(chatContextPack?.relevantCanon) ? chatContextPack.relevantCanon.length : Number(compact?.relevantCanonCount || 0),
    chat_context_affected_subsystems: Array.isArray(chatContextPack?.affectedSubsystems) ? chatContextPack.affectedSubsystems.join('|') : (Array.isArray(compact?.affectedSubsystems) ? compact.affectedSubsystems.join('|') : 'none'),
    chat_context_sources_used: projectAwarenessTruth.chatContextSourcesUsed.length ? projectAwarenessTruth.chatContextSourcesUsed.join('|') : 'none',
    chat_context_ui_reality_status: compact?.uiRealityStatusAtBuild || 'UNKNOWN',
    chat_context_mission_state: projectAwarenessTruth.chatContextMissionState || 'unknown',
    chat_context_next_action: chatContextPack?.recommendedNextAction || compact?.nextAction || 'Answer directly with bounded confidence.',
    chat_context_warning_count: Number(compact?.warningCount || 0),
    chat_context_warnings: Array.isArray(chatContextPack?.warnings) ? chatContextPack.warnings.join(' | ') : (Array.isArray(compact?.warnings) ? compact.warnings.join(' | ') : 'none'),
    chat_context_provider_ids_used: providerIdsUsed.length ? providerIdsUsed.join('|') : 'none',
    chat_context_provider_registry_status: chatContextPack?.contextProviderRegistryStatus || compact?.contextProviderRegistryStatus || 'inactive',
    chat_context_provider_ids_registered: providerIdsRegistered.length ? providerIdsRegistered.join('|') : 'none',
    chat_context_provider_warning_count: Number(chatContextPack?.contextProviderWarningCount ?? compact?.contextProviderWarningCount ?? 0),
    chat_context_operator_name_known: chatContextPack?.providerSummaries?.operatorProfile?.known || 'no',
    chat_context_operator_name: chatContextPack?.providerSummaries?.operatorProfile?.operatorName || 'unknown',
    chat_context_operator_identity_source: chatContextPack?.providerSummaries?.operatorProfile?.source || 'none',
    chat_context_operator_identity_confidence: chatContextPack?.providerSummaries?.operatorProfile?.confidence || 'unknown',
    chat_context_operator_identity_updated_at: chatContextPack?.providerSummaries?.operatorProfile?.updatedAt || 'unknown',
    chat_context_operator_identity_next_action: chatContextPack?.providerSummaries?.operatorProfile?.nextAction || 'Ask operator for preferred name when relevant.',
    chat_context_operator_profile_rehydrated: chatContextPack?.providerSummaries?.operatorProfile?.rehydrated || 'no',
    chat_context_operator_profile_storage_key: chatContextPack?.providerSummaries?.operatorProfile?.storageKey || 'stephanos.operator.profile.v1',
    chat_context_operator_profile_storage_read_status: chatContextPack?.providerSummaries?.operatorProfile?.storageReadStatus || 'missing',
    chat_context_operator_profile_last_read_at: chatContextPack?.providerSummaries?.operatorProfile?.lastReadAt || 'unknown',
    chat_context_operator_profile_last_write_at: chatContextPack?.providerSummaries?.operatorProfile?.lastWriteAt || 'unknown',
    chat_context_provider_next_actions: providerNextActions.length ? providerNextActions.slice(0, 3).join(' | ') : 'none',
    chat_context_provider_proof_state: providerProofState ? JSON.stringify(providerProofState) : 'unknown',
    chat_context_provider_canon_links_count: providerCanonLinksCount,
    chat_context_active_mission_status: activeMission?.activeMissionTitle && activeMission?.activeMissionTitle !== 'unknown' ? 'active' : 'unknown',
    chat_context_active_mission_id: activeMission?.activeMissionId || 'unknown',
    chat_context_active_mission_title: activeMission?.activeMissionTitle || 'unknown',
    chat_context_active_mission_phase: activeMission?.canonicalMissionPhase || 'unknown',
    chat_context_active_mission_current_focus: chatContextPack?.inputMissionState?.activeMission?.currentFocus || 'unknown',
    chat_context_active_mission_next_step: activeMission?.missionNextAction || 'unknown',
    chat_context_active_mission_proof_state: chatContextPack?.inputMissionState?.activeMission?.proofState || 'unknown',
    chat_context_active_mission_related_systems: Array.isArray(chatContextPack?.inputMissionState?.activeMission?.relatedSystems) ? chatContextPack.inputMissionState.activeMission.relatedSystems.join('|') : 'none',
    chat_context_active_mission_rehydrated: activeMission?.activeMissionRehydrated || 'no',
    chat_context_active_mission_storage_key: chatContextPack?.inputMissionState?.activeMission?.storageKey || 'stephanos.active.mission.v1',
    chat_context_active_mission_raw_transcript_stored: chatContextPack?.inputMissionState?.activeMission?.rawTranscriptStored || 'no',
    project_awareness_pack_status: projectAwarenessTruth.projectAwarenessStatus || 'unavailable',
    project_awareness_sources_used: projectAwarenessTruth.projectAwarenessSourcesUsed.length ? projectAwarenessTruth.projectAwarenessSourcesUsed.join('|') : 'none',
    project_awareness_current_mission: projectAwarenessTruth.projectAwarenessCurrentMission || 'unknown',
    project_awareness_next_best_action: projectAwarenessTruth.projectAwarenessNextAction || 'unknown',
    project_awareness_operator_workflow_preference: projectAwarenessTruth.projectAwarenessWorkflowPreference || 'unknown',
    project_awareness_codex_role: projectAwarenessTruth.projectAwarenessCodexRole || 'unknown',
    project_awareness_openclaw_role: projectAwarenessTruth.projectAwarenessOpenClawRole || 'unknown',
    project_awareness_warning_count: Number((projectAwareness.warningCount || 0) + projectAwarenessTruth.projectAwarenessWarnings.length),
    project_awareness_prompt_injected: 'no',
    project_awareness_prompt_block_length: 0,
    project_awareness_prompt_sources: 'none',
    mission_planning_prompt_context_used: 'no',
    agent_reality_loop_context_recognized: agentRealityLoopContextRecognized ? 'yes' : 'no',
    agent_reality_loop_context_source: contextSource,
    agent_reality_loop_projection_available: projectionAvailable ? 'yes' : 'no',
    agent_reality_loop_projection_source_seen: projectionSourceSeen,
    agent_reality_loop_projection_raw_status: projectionStatus || String(projectAwareness?.agentRealityLoopProjectionStatus || '').trim().toLowerCase() || 'unknown',
    agent_reality_loop_context_injected: agentRealityLoopContextRecognized && projectionAvailable ? 'yes' : 'no',
    agent_reality_loop_projection_keys_seen: projectionObjectPresent ? Object.keys(agentRealityLoopProjection).join('|') : 'none',
    agent_reality_loop_metadata_source: hasPack ? 'chatContextPack' : 'none',
    agent_reality_loop_metadata_derivation_reason: agentRealityLoopContextRecognized ? 'intent-classifier-match-or-term-detection' : 'no-agent-reality-loop-signal',
    agent_reality_loop_availability_blocker: projectionAvailable ? 'none' : 'projection-missing-from-command-deck-path',
    agent_reality_loop_recommended_lead: agentRealityLoopProjection?.recommendedLead || 'hold',
    agent_reality_loop_merge_recommendation: agentRealityLoopProjection?.mergeRecommendation || 'hold',
    agent_reality_loop_copy_packets_available: copyPacketsAvailable ? 'yes' : 'no',
  };
}




function reconcileBackendHealthTruth({ runtimeContext = {}, healthOk = false, source = 'unknown', status = 0, hadRouteUnavailableFailure = false } = {}) {
  const previous = runtimeContext?.healthProbeTruth && typeof runtimeContext.healthProbeTruth === 'object'
    ? runtimeContext.healthProbeTruth
    : {};
  return {
    ...previous,
    lastBackendHealthProbeAt: new Date().toISOString(),
    lastBackendHealthProbeResult: healthOk ? 'ok:true' : (status ? `ok:false:http-${status}` : 'ok:false:error'),
    routeHealthRevalidatedAfterFailure: healthOk && hadRouteUnavailableFailure ? 'yes' : (healthOk ? (previous.routeHealthRevalidatedAfterFailure || 'no') : 'no'),
    currentBackendHealthSource: source,
  };
}

function adoptRemoteHomeNodeFromHealth(resolvedRuntimeContext, health = {}) {
  const frontendHost = extractHostname(resolvedRuntimeContext.frontendOrigin);
  const localDesktopSession = isLoopbackHost(frontendHost);
  if (localDesktopSession || !health?.ok) {
    return {
      homeNode: resolvedRuntimeContext.homeNode || null,
      nodeAddressSource: resolvedRuntimeContext.nodeAddressSource || '',
      preferredTarget: resolvedRuntimeContext.preferredTarget || '',
      actualTargetUsed: resolvedRuntimeContext.actualTargetUsed || resolvedRuntimeContext.baseUrl || '',
      adopted: false,
    };
  }

  const existingHomeNode = resolvedRuntimeContext.homeNode || null;
  const existingSource = existingHomeNode?.source || '';
  const publishedClientRoute = String(health.data?.published_client_route || '').trim();
  const publishedBackendBaseUrl = String(health.data?.published_backend_base_url || health.data?.backend_base_url || '').trim();
  const backendRequestBaseUrl = String(health.baseUrl || resolvedRuntimeContext.baseUrl || resolvedRuntimeContext.apiBaseUrl || '').trim();
  const candidateUrls = [
    backendRequestBaseUrl,
    resolvedRuntimeContext.baseUrl,
    resolvedRuntimeContext.apiBaseUrl,
    existingHomeNode?.backendUrl,
    publishedClientRoute,
    publishedBackendBaseUrl,
  ].filter(Boolean);
  const adoptedUrl = candidateUrls.find((candidate) => !isLoopbackHost(extractHostname(candidate))) || '';
  const adoptedHost = extractHostname(adoptedUrl);

  if (!adoptedHost) {
    return {
      homeNode: existingHomeNode,
      nodeAddressSource: resolvedRuntimeContext.nodeAddressSource || existingSource || '',
      preferredTarget: resolvedRuntimeContext.preferredTarget || '',
      actualTargetUsed: resolvedRuntimeContext.actualTargetUsed || backendRequestBaseUrl || '',
      adopted: false,
    };
  }

  const requestOrigin = (() => {
    try {
      return backendRequestBaseUrl ? new URL(backendRequestBaseUrl).origin : '';
    } catch {
      return '';
    }
  })();
  const publishedClientHost = extractHostname(publishedClientRoute);
  const preferredUiUrl = publishedClientRoute && !isLoopbackHost(publishedClientHost)
    ? publishedClientRoute
    : (existingHomeNode?.uiUrl || createStephanosHomeNodeUrls({ host: adoptedHost }).uiUrl);
  const fallbackUrls = createStephanosHomeNodeUrls({
    host: adoptedHost,
    uiPort: existingHomeNode?.uiPort,
    backendPort: existingHomeNode?.backendPort,
    distPort: existingHomeNode?.distPort,
  });
  const source = resolvedRuntimeContext.nodeAddressSource
    || health.data?.client_route_source
    || existingSource
    || (existingHomeNode?.configured ? 'manual' : 'discovered');

  const adoptedHomeNode = normalizeStephanosHomeNode({
    ...(existingHomeNode || {}),
    host: adoptedHost,
    backendUrl: requestOrigin || existingHomeNode?.backendUrl || fallbackUrls.backendUrl,
    backendHealthUrl: `${requestOrigin || existingHomeNode?.backendUrl || fallbackUrls.backendUrl}/api/health`,
    uiUrl: preferredUiUrl,
    source,
    reachable: true,
  }, { source });

  return {
    homeNode: adoptedHomeNode,
    nodeAddressSource: source,
    preferredTarget: requestOrigin || adoptedHomeNode.backendUrl || resolvedRuntimeContext.preferredTarget || '',
    actualTargetUsed: requestOrigin || adoptedHomeNode.backendUrl || resolvedRuntimeContext.actualTargetUsed || '',
    adopted: true,
  };
}



function normalizeChatContextOperatorMessage(message = '') {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function isDefaultChatContextValue(key = '', value = '') {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return true;
  if (key === 'chat_context_pack_status') return ['unavailable', 'warning'].includes(normalized);
  if (key === 'chat_context_response_mode') return normalized === 'direct-answer';
  if (key === 'chat_context_relevant_canon_count') return normalized === '0';
  if (key === 'chat_context_provider_registry_status') return normalized === 'inactive';
  if (key === 'chat_context_provider_warning_count' || key === 'chat_context_provider_canon_links_count') return normalized === '0';
  if (key.startsWith('chat_context_provider_')) return ['none', 'unknown'].includes(normalized);
  return ['none', 'unknown', 'n/a'].includes(normalized);
}

function pickChatContextField(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return value;
  }
  return undefined;
}

function pickChatContextFieldPreferRequestNonDefault(key = '', rawValue, traceValue, requestValue, fallback) {
  const requestIsNonDefault = !isDefaultChatContextValue(key, requestValue);
  const rawIsDefault = isDefaultChatContextValue(key, rawValue);
  const traceIsDefault = isDefaultChatContextValue(key, traceValue);
  if (requestIsNonDefault && rawIsDefault && traceIsDefault) return requestValue;
  return pickChatContextField(rawValue, traceValue, requestValue, fallback);
}

function pickChatContextFieldPreferPackOrRebuildNonDefault(key = '', rawValue, traceValue, requestValue, rebuiltValue, fallback) {
  const preferredValue = !isDefaultChatContextValue(key, requestValue) ? requestValue : rebuiltValue;
  const preferredIsNonDefault = !isDefaultChatContextValue(key, preferredValue);
  const rawIsDefault = isDefaultChatContextValue(key, rawValue);
  const traceIsDefault = isDefaultChatContextValue(key, traceValue);
  if (preferredIsNonDefault && rawIsDefault && traceIsDefault) return preferredValue;
  return pickChatContextField(rawValue, traceValue, requestValue, rebuiltValue, fallback);
}

export function buildChatContextAttachmentMetadata({ normalizedExecutionMetadata = {}, rawExecutionMetadata = {}, requestTrace = {}, requestPayload = {} }) {
  const normalized = normalizedExecutionMetadata && typeof normalizedExecutionMetadata === 'object' ? normalizedExecutionMetadata : {};
  const raw = rawExecutionMetadata && typeof rawExecutionMetadata === 'object' ? rawExecutionMetadata : {};
  const trace = requestTrace && typeof requestTrace === 'object' ? requestTrace : {};
  const requestChatContext = buildChatContextExecutionMetadata(requestPayload?.chatContextPack || null);
  const rawOperatorMessage = normalizeChatContextOperatorMessage(requestPayload?.raw_input || requestPayload?.prompt || requestPayload?.operatorMessage || '');
  const normalizedOperatorMessage = normalizeChatContextOperatorMessage(requestPayload?.chatContextPack?.contextForPrompt?.operatorMessage || rawOperatorMessage);
  const probePrompt = String(requestPayload?.prompt || requestPayload?.raw_input || requestPayload?.operatorMessage || '').trim();
  const normalizedProbePrompt = probePrompt ? (probePrompt.length > 96 ? `${probePrompt.slice(0, 93)}...` : probePrompt) : 'n/a';
  const merged = {
    chat_context_pack_status: pickChatContextFieldPreferRequestNonDefault('chat_context_pack_status', raw.chat_context_pack_status, trace.chat_context_pack_status, requestChatContext.chat_context_pack_status),
    chat_context_version: pickChatContextField(raw.chat_context_version, trace.chat_context_version, requestChatContext.chat_context_version),
    chat_context_response_mode: pickChatContextFieldPreferRequestNonDefault('chat_context_response_mode', raw.chat_context_response_mode, trace.chat_context_response_mode, requestChatContext.chat_context_response_mode),
    chat_context_relevant_canon_count: pickChatContextFieldPreferRequestNonDefault('chat_context_relevant_canon_count', raw.chat_context_relevant_canon_count, trace.chat_context_relevant_canon_count, requestChatContext.chat_context_relevant_canon_count),
    chat_context_affected_subsystems: pickChatContextField(raw.chat_context_affected_subsystems, trace.chat_context_affected_subsystems, requestChatContext.chat_context_affected_subsystems),
    chat_context_sources_used: pickChatContextField(raw.chat_context_sources_used, trace.chat_context_sources_used, requestChatContext.chat_context_sources_used),
    chat_context_ui_reality_status: pickChatContextField(raw.chat_context_ui_reality_status, trace.chat_context_ui_reality_status, requestChatContext.chat_context_ui_reality_status),
    chat_context_mission_state: pickChatContextField(raw.chat_context_mission_state, trace.chat_context_mission_state, requestChatContext.chat_context_mission_state),
    chat_context_next_action: pickChatContextField(raw.chat_context_next_action, trace.chat_context_next_action, requestChatContext.chat_context_next_action),
    chat_context_warning_count: pickChatContextField(raw.chat_context_warning_count, trace.chat_context_warning_count, requestChatContext.chat_context_warning_count),
    chat_context_warnings: pickChatContextField(raw.chat_context_warnings, trace.chat_context_warnings, requestChatContext.chat_context_warnings),
    chat_context_created_at: pickChatContextField(raw.chat_context_created_at, trace.chat_context_created_at, requestPayload?.chatContextPack?.createdAt, new Date().toISOString()),
    chat_context_request_id: pickChatContextField(raw.chat_context_request_id, trace.chat_context_request_id, raw.request_execution_id, trace.request_execution_id, requestPayload?.request_execution_id),
    chat_context_attachment_point: 'lastExecutionMetadata',
    chat_context_attached_to_same_metadata_as_retrieval_query: 'yes',
    chat_context_attachment_probe: 'attached-at-final-execution-metadata',
    chat_context_attachment_probe_request_id: pickChatContextField(raw.request_execution_id, trace.request_execution_id, requestPayload?.request_execution_id, normalized.chat_context_request_id),
    chat_context_attachment_probe_prompt: normalizedProbePrompt,
    chat_context_attachment_probe_response_mode: pickChatContextFieldPreferRequestNonDefault('chat_context_response_mode', raw.chat_context_response_mode, trace.chat_context_response_mode, requestChatContext.chat_context_response_mode, 'direct-answer'),
  };
  const validRequestPack = requestChatContext.chat_context_pack_status === 'active' && requestChatContext.chat_context_response_mode !== 'direct-answer';
  const deterministicRuleMatched = String(requestPayload?.chatContextPack?.intentClassifierMatchedRule || '').trim().toLowerCase();
  const defaultPackUsed = (deterministicRuleMatched && deterministicRuleMatched !== 'direct-answer')
    ? 'no'
    : (requestChatContext.chat_context_pack_status !== 'active' ? 'yes' : 'no');
  const overwrittenByDefault = validRequestPack && (isDefaultChatContextValue('chat_context_pack_status', raw.chat_context_pack_status) || isDefaultChatContextValue('chat_context_response_mode', raw.chat_context_response_mode));
  const metadataKeys = Object.keys(merged).filter((key) => key.startsWith('chat_context_') && merged[key] !== undefined && merged[key] !== null && String(merged[key]).trim() !== '');
  const requestPack = requestPayload?.chatContextPack || {};
  const requestPackClassifierProof = requestPack.classifierProof && typeof requestPack.classifierProof === 'object' ? requestPack.classifierProof : null;
  const rebuildCandidates = [
    ['retrieval_query', normalized.retrieval_query],
    ['raw_input', requestPayload?.raw_input],
    ['operatorMessage', requestPayload?.operatorMessage],
    ['prompt', requestPayload?.prompt],
    ['chat_context_raw_operator_message_seen', raw.chat_context_raw_operator_message_seen],
    ['chat_context_normalized_operator_message', raw.chat_context_normalized_operator_message],
  ];
  const rebuildSource = rebuildCandidates.find(([, value]) => normalizeChatContextOperatorMessage(value));
  const rebuiltOperatorMessage = rebuildSource ? normalizeChatContextOperatorMessage(rebuildSource[1]) : '';
  const rebuiltPack = (!requestPackClassifierProof && rebuiltOperatorMessage)
    ? buildChatContextPack({
      operatorMessage: rebuiltOperatorMessage,
      buildSource: 'final-metadata-attachment-rebuild',
      submissionSource: requestPayload?.submissionSource || requestPayload?.chatContextPack?.compactSummary?.buildSource || 'stephanos-mission-console',
    })
    : null;
  const classifierProof = requestPackClassifierProof || (rebuiltPack?.classifierProof && typeof rebuiltPack.classifierProof === 'object' ? rebuiltPack.classifierProof : null);
  const classifierProofSource = requestPackClassifierProof
    ? 'request-pack'
    : (classifierProof ? 'rebuilt-from-final-message' : 'missing');
  const rebuiltAtFinalAttachment = (!requestPackClassifierProof && classifierProof) ? 'yes' : 'no';
  const rebuildSourceField = rebuiltAtFinalAttachment === 'yes' ? rebuildSource?.[0] : 'none';
  const classifierProofMissing = !classifierProof;
  const resolvedMatchInput = classifierProof?.matchInput || normalizedOperatorMessage || rawOperatorMessage || rebuiltOperatorMessage || 'n/a';
  const resolvedRuleResults = Array.isArray(classifierProof?.evaluatedRuleResults) ? classifierProof.evaluatedRuleResults : [];
  const rebuiltExecutionMetadata = buildChatContextExecutionMetadata(rebuiltPack);
  const resolvedProviderRegistryStatus = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'chat_context_provider_registry_status',
    raw.chat_context_provider_registry_status,
    trace.chat_context_provider_registry_status,
    requestChatContext.chat_context_provider_registry_status,
    rebuiltExecutionMetadata.chat_context_provider_registry_status,
    'inactive',
  );
  const resolvedProviderIdsRegistered = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'chat_context_provider_ids_registered',
    raw.chat_context_provider_ids_registered,
    trace.chat_context_provider_ids_registered,
    requestChatContext.chat_context_provider_ids_registered,
    rebuiltExecutionMetadata.chat_context_provider_ids_registered,
    'none',
  );
  const resolvedProviderIdsUsed = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'chat_context_provider_ids_used',
    raw.chat_context_provider_ids_used,
    trace.chat_context_provider_ids_used,
    requestChatContext.chat_context_provider_ids_used,
    rebuiltExecutionMetadata.chat_context_provider_ids_used,
    'none',
  );
  const resolvedProviderWarningCount = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'chat_context_provider_warning_count',
    raw.chat_context_provider_warning_count,
    trace.chat_context_provider_warning_count,
    requestChatContext.chat_context_provider_warning_count,
    rebuiltExecutionMetadata.chat_context_provider_warning_count,
    0,
  );
  const resolvedProviderProofState = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'chat_context_provider_proof_state',
    raw.chat_context_provider_proof_state,
    trace.chat_context_provider_proof_state,
    requestChatContext.chat_context_provider_proof_state,
    rebuiltExecutionMetadata.chat_context_provider_proof_state,
    'unknown',
  );
  const resolvedProviderNextActions = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'chat_context_provider_next_actions',
    raw.chat_context_provider_next_actions,
    trace.chat_context_provider_next_actions,
    requestChatContext.chat_context_provider_next_actions,
    rebuiltExecutionMetadata.chat_context_provider_next_actions,
    'none',
  );
  const resolvedProviderCanonLinksCount = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'chat_context_provider_canon_links_count',
    raw.chat_context_provider_canon_links_count,
    trace.chat_context_provider_canon_links_count,
    requestChatContext.chat_context_provider_canon_links_count,
    rebuiltExecutionMetadata.chat_context_provider_canon_links_count,
    0,
  );
  const resolvedProjectAwarenessPackStatus = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'project_awareness_pack_status',
    raw.project_awareness_pack_status,
    trace.project_awareness_pack_status,
    requestChatContext.project_awareness_pack_status,
    rebuiltExecutionMetadata.project_awareness_pack_status,
    'unavailable',
  );
  const resolvedProjectAwarenessSourcesUsed = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'project_awareness_sources_used',
    raw.project_awareness_sources_used,
    trace.project_awareness_sources_used,
    requestChatContext.project_awareness_sources_used,
    rebuiltExecutionMetadata.project_awareness_sources_used,
    'none',
  );
  const resolvedProjectAwarenessCurrentMission = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'project_awareness_current_mission',
    raw.project_awareness_current_mission,
    trace.project_awareness_current_mission,
    requestChatContext.project_awareness_current_mission,
    rebuiltExecutionMetadata.project_awareness_current_mission,
    'unknown',
  );
  const resolvedProjectAwarenessNextBestAction = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'project_awareness_next_best_action',
    raw.project_awareness_next_best_action,
    trace.project_awareness_next_best_action,
    requestChatContext.project_awareness_next_best_action,
    rebuiltExecutionMetadata.project_awareness_next_best_action,
    'unknown',
  );
  const resolvedProjectAwarenessWorkflowPreference = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'project_awareness_operator_workflow_preference',
    raw.project_awareness_operator_workflow_preference,
    trace.project_awareness_operator_workflow_preference,
    requestChatContext.project_awareness_operator_workflow_preference,
    rebuiltExecutionMetadata.project_awareness_operator_workflow_preference,
    'unknown',
  );
  const resolvedProjectAwarenessCodexRole = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'project_awareness_codex_role',
    raw.project_awareness_codex_role,
    trace.project_awareness_codex_role,
    requestChatContext.project_awareness_codex_role,
    rebuiltExecutionMetadata.project_awareness_codex_role,
    'unknown',
  );
  const resolvedProjectAwarenessOpenClawRole = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'project_awareness_openclaw_role',
    raw.project_awareness_openclaw_role,
    trace.project_awareness_openclaw_role,
    requestChatContext.project_awareness_openclaw_role,
    rebuiltExecutionMetadata.project_awareness_openclaw_role,
    'unknown',
  );
  const resolvedProjectAwarenessWarningCount = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'project_awareness_warning_count',
    raw.project_awareness_warning_count,
    trace.project_awareness_warning_count,
    requestChatContext.project_awareness_warning_count,
    rebuiltExecutionMetadata.project_awareness_warning_count,
    0,
  );
  const resolvedAgentRealityLoopContextRecognized = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'agent_reality_loop_context_recognized',
    raw.agent_reality_loop_context_recognized,
    trace.agent_reality_loop_context_recognized,
    requestChatContext.agent_reality_loop_context_recognized,
    rebuiltExecutionMetadata.agent_reality_loop_context_recognized,
    'no',
  );
  const resolvedAgentRealityLoopContextSource = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'agent_reality_loop_context_source',
    raw.agent_reality_loop_context_source,
    trace.agent_reality_loop_context_source,
    requestChatContext.agent_reality_loop_context_source,
    rebuiltExecutionMetadata.agent_reality_loop_context_source,
    'none',
  );
  const resolvedAgentRealityLoopProjectionAvailable = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'agent_reality_loop_projection_available',
    raw.agent_reality_loop_projection_available,
    trace.agent_reality_loop_projection_available,
    requestChatContext.agent_reality_loop_projection_available,
    rebuiltExecutionMetadata.agent_reality_loop_projection_available,
    'no',
  );
  const resolvedAgentRealityLoopProjectionSourceSeen = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'agent_reality_loop_projection_source_seen',
    raw.agent_reality_loop_projection_source_seen,
    trace.agent_reality_loop_projection_source_seen,
    requestChatContext.agent_reality_loop_projection_source_seen,
    rebuiltExecutionMetadata.agent_reality_loop_projection_source_seen,
    'none',
  );
  const resolvedAgentRealityLoopContextInjectedRaw = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'agent_reality_loop_context_injected',
    raw.agent_reality_loop_context_injected,
    trace.agent_reality_loop_context_injected,
    requestChatContext.agent_reality_loop_context_injected,
    rebuiltExecutionMetadata.agent_reality_loop_context_injected,
    'no',
  );
  const resolvedAgentRealityLoopRecommendedLead = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'agent_reality_loop_recommended_lead',
    raw.agent_reality_loop_recommended_lead,
    trace.agent_reality_loop_recommended_lead,
    requestChatContext.agent_reality_loop_recommended_lead,
    rebuiltExecutionMetadata.agent_reality_loop_recommended_lead,
    'hold',
  );
  const resolvedAgentRealityLoopMergeRecommendation = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'agent_reality_loop_merge_recommendation',
    raw.agent_reality_loop_merge_recommendation,
    trace.agent_reality_loop_merge_recommendation,
    requestChatContext.agent_reality_loop_merge_recommendation,
    rebuiltExecutionMetadata.agent_reality_loop_merge_recommendation,
    'hold',
  );
  const resolvedAgentRealityLoopCopyPacketsAvailable = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'agent_reality_loop_copy_packets_available',
    raw.agent_reality_loop_copy_packets_available,
    trace.agent_reality_loop_copy_packets_available,
    requestChatContext.agent_reality_loop_copy_packets_available,
    rebuiltExecutionMetadata.agent_reality_loop_copy_packets_available,
    'no',
  );
  const resolvedAgentRealityLoopAvailabilityBlockerRaw = pickChatContextFieldPreferPackOrRebuildNonDefault(
    'agent_reality_loop_availability_blocker',
    raw.agent_reality_loop_availability_blocker,
    trace.agent_reality_loop_availability_blocker,
    requestChatContext.agent_reality_loop_availability_blocker,
    rebuiltExecutionMetadata.agent_reality_loop_availability_blocker,
    'projection-missing-from-command-deck-path',
  );
  const resolvedAgentRealityLoopProjectionUnavailable = String(resolvedAgentRealityLoopProjectionAvailable).trim().toLowerCase() !== 'yes';
  const resolvedAgentRealityLoopProjectionSource = resolvedAgentRealityLoopProjectionUnavailable
    ? resolvedAgentRealityLoopProjectionSourceSeen
    : (String(resolvedAgentRealityLoopProjectionSourceSeen || '').trim().toLowerCase() === 'none'
      ? 'command-deck-projection-bridge'
      : resolvedAgentRealityLoopProjectionSourceSeen);
  const resolvedAgentRealityLoopContextInjected = String(resolvedAgentRealityLoopContextInjectedRaw || '').trim().toLowerCase() === 'yes'
    || (String(resolvedAgentRealityLoopContextRecognized || '').trim().toLowerCase() === 'yes'
      && !resolvedAgentRealityLoopProjectionUnavailable
      && String(resolvedAgentRealityLoopProjectionSource || '').trim().toLowerCase() !== 'none')
    ? 'yes'
    : 'no';
  const resolvedAgentRealityLoopAvailabilityBlocker = resolvedAgentRealityLoopProjectionUnavailable
    ? (
      String(resolvedAgentRealityLoopAvailabilityBlockerRaw || '').trim()
      || 'projection-missing-from-command-deck-path'
    )
    : 'none';
  return {
    ...merged,
    chat_context_raw_operator_message_seen: rawOperatorMessage || 'n/a',
    chat_context_normalized_operator_message: normalizedOperatorMessage || 'n/a',
    chat_context_intent_classifier_matched_rule: classifierProof?.intentClassifierMatchedRule || requestPack.intentClassifierMatchedRule || requestPack.recommendedResponseMode || rebuiltPack?.intentClassifierMatchedRule || 'direct-answer',
    chat_context_match_input: resolvedMatchInput,
    chat_context_merge_rule_pattern: classifierProof?.mergeRulePattern || 'none',
    chat_context_merge_rule_test_result: classifierProof?.mergeRuleTestResult || 'no',
    chat_context_first_matching_rule: classifierProof?.firstMatchingRule || 'direct-answer',
    chat_context_evaluated_rule_results: resolvedRuleResults.length > 0 ? resolvedRuleResults.join(',') : 'n/a',
    chat_context_builder_function: requestPayload?.chatContextPack?.classifierDebug?.builderFunction || 'buildChatContextPack',
    chat_context_build_source: requestPayload?.submissionSource || requestPayload?.chatContextPack?.compactSummary?.buildSource || 'stephanos-mission-console',
    chat_context_default_pack_used: classifierProof?.defaultPackUsed || defaultPackUsed,
    chat_context_was_overwritten: overwrittenByDefault ? 'yes' : 'no',
    chat_context_classifier_function_source: requestPayload?.chatContextPack?.classifierDebug?.classifierFunctionSource || 'other',
    chat_context_classifier_function_source_label: requestPayload?.chatContextPack?.classifierDebug?.classifierFunctionSource || 'other',
    chat_context_classifier_rule_order: Array.isArray(requestPayload?.chatContextPack?.classifierDebug?.classifierRuleOrder) ? requestPayload.chatContextPack.classifierDebug.classifierRuleOrder.join('>') : 'n/a',
    chat_context_classifier_candidate_rules_evaluated: Array.isArray(requestPayload?.chatContextPack?.classifierDebug?.classifierCandidateRulesEvaluated) ? requestPayload.chatContextPack.classifierDebug.classifierCandidateRulesEvaluated.join(',') : 'n/a',
    chat_context_classifier_merge_rule_matched: requestPayload?.chatContextPack?.classifierDebug?.classifierMergeRuleMatched || 'no',
    chat_context_classifier_regex_used: requestPayload?.chatContextPack?.classifierDebug?.classifierRegexUsed || 'none',
    chat_context_classifier_rule_index: requestPayload?.chatContextPack?.classifierDebug?.classifierRuleIndex ?? -1,
    chat_context_classifier_fallback_applied: classifierProof?.fallbackApplied || requestPayload?.chatContextPack?.classifierDebug?.classifierFallbackApplied || 'no',
    chat_context_fallback_branch_taken: classifierProof?.fallbackApplied || requestPayload?.chatContextPack?.classifierDebug?.fallbackBranchTaken || 'no',
    chat_context_fallback_branch_reason: classifierProof?.fallbackApplied === 'yes' ? 'no-intent-rule-matched' : (requestPayload?.chatContextPack?.classifierDebug?.fallbackBranchReason || 'none'),
    chat_context_classifier_proof_missing: classifierProofMissing ? 'yes' : 'no',
    chat_context_classifier_proof_warning: classifierProofMissing ? 'classifier-proof-missing-after-final-attachment-rebuild' : 'none',
    chat_context_rebuilt_at_final_attachment: rebuiltAtFinalAttachment,
    chat_context_rebuild_source_field: rebuildSourceField,
    chat_context_classifier_proof_source: classifierProofSource,
    chat_context_provider_registry_status: resolvedProviderRegistryStatus,
    chat_context_provider_ids_registered: resolvedProviderIdsRegistered,
    chat_context_provider_ids_used: resolvedProviderIdsUsed,
    chat_context_provider_warning_count: resolvedProviderWarningCount,
    chat_context_provider_proof_state: resolvedProviderProofState,
    chat_context_provider_next_actions: resolvedProviderNextActions,
    chat_context_provider_canon_links_count: resolvedProviderCanonLinksCount,
    project_awareness_pack_status: resolvedProjectAwarenessPackStatus,
    project_awareness_sources_used: resolvedProjectAwarenessSourcesUsed,
    project_awareness_current_mission: resolvedProjectAwarenessCurrentMission,
    project_awareness_next_best_action: resolvedProjectAwarenessNextBestAction,
    project_awareness_operator_workflow_preference: resolvedProjectAwarenessWorkflowPreference,
    project_awareness_codex_role: resolvedProjectAwarenessCodexRole,
    project_awareness_openclaw_role: resolvedProjectAwarenessOpenClawRole,
    project_awareness_warning_count: resolvedProjectAwarenessWarningCount,
    project_awareness_prompt_injected: String(requestPayload?.project_awareness_prompt_injected || 'no'),
    project_awareness_prompt_block_length: Number(requestPayload?.project_awareness_prompt_block_length || 0),
    project_awareness_prompt_sources: String(requestPayload?.project_awareness_prompt_sources || 'none'),
    mission_planning_prompt_context_used: String(requestPayload?.mission_planning_prompt_context_used || 'no'),
    agent_reality_loop_context_recognized: resolvedAgentRealityLoopContextRecognized,
    agent_reality_loop_context_source: resolvedAgentRealityLoopContextSource,
    agent_reality_loop_projection_available: resolvedAgentRealityLoopProjectionAvailable,
    agent_reality_loop_projection_source_seen: resolvedAgentRealityLoopProjectionSource,
    agent_reality_loop_context_injected: resolvedAgentRealityLoopContextInjected,
    agent_reality_loop_recommended_lead: resolvedAgentRealityLoopRecommendedLead,
    agent_reality_loop_merge_recommendation: resolvedAgentRealityLoopMergeRecommendation,
    agent_reality_loop_copy_packets_available: resolvedAgentRealityLoopCopyPacketsAvailable,
    agent_reality_loop_availability_blocker: resolvedAgentRealityLoopAvailabilityBlocker,
    chat_context_default_override_reason: overwrittenByDefault ? 'backend-default-overrode-request-pack' : (requestPayload?.chatContextPack?.classifierDebug?.defaultOverrideReason || 'none'),
    chat_context_metadata_keys_present: metadataKeys.join('|') || 'none',
  };
}

function attachChatContextToExecutionMetadata({
  executionMetadata = {},
  rawExecutionMetadata = {},
  requestTrace = {},
  requestPayload = {},
}) {
  const normalizedExecutionMetadata = executionMetadata && typeof executionMetadata === 'object' ? executionMetadata : {};
  return {
    ...normalizedExecutionMetadata,
    ...buildChatContextAttachmentMetadata({
      normalizedExecutionMetadata,
      rawExecutionMetadata,
      requestTrace,
      requestPayload,
    }),
  };
}
function normalizeExecutionMetadata({ data, requestPayload, backendDefaultProvider }) {
  const executionMetadata = data.data?.execution_metadata || {};
  const requestTrace = data.data?.request_trace || {};
  const contextAssemblyMetadata = requestPayload?.contextAssemblyMetadata || {};
  const requestExecutionId = String(requestPayload?.request_execution_id || '').trim();
  const executionMetadataRequestId = String(
    executionMetadata.request_execution_id
    || executionMetadata.request_id
    || executionMetadata.execution_id
    || '',
  ).trim();
  const requestTraceRequestId = String(
    requestTrace.request_execution_id
    || requestTrace.request_id
    || requestTrace.execution_id
    || '',
  ).trim();
  const currentRequestRouterMetadata = requestExecutionId
    && (executionMetadataRequestId === requestExecutionId || requestTraceRequestId === requestExecutionId);
  const uiRequestedProvider = normalizeProviderKey(
    executionMetadata.ui_requested_provider
    || requestTrace.ui_requested_provider
    || requestPayload.ui_requested_provider
    || requestPayload.provider,
  );
  const providerFallbackBlockedByRoute = Boolean(
    executionMetadata.provider_fallback_blocked_by_route
    ?? requestTrace.provider_fallback_blocked_by_route
    ?? false,
  );
  const providerExecutionGateStatus = String(
    executionMetadata.provider_execution_gate_status
    || requestTrace.provider_execution_gate_status
    || '',
  ).trim().toLowerCase();
  const blockedBeforeProvider = providerFallbackBlockedByRoute || providerExecutionGateStatus === 'blocked-by-route';

  const requestSideSelectedProvider = normalizeProviderKey(
    executionMetadata.request_side_selected_provider
    || requestTrace.request_side_selected_provider
    || requestPayload.request_side_selected_provider
    || requestPayload.provider,
  );
  const executableProvider = blockedBeforeProvider
    ? 'none'
    : normalizeProviderKey(
      executionMetadata.executable_provider
    || requestTrace.executable_provider
    || requestPayload.runtimeContext?.finalRouteTruth?.executedProvider
    || requestPayload.runtimeContext?.canonicalRouteRuntimeTruth?.executedProvider
    || requestPayload.runtimeContext?.finalRouteTruth?.selectedProvider
    || requestPayload.runtimeContext?.canonicalRouteRuntimeTruth?.selectedProvider
    || requestSideSelectedProvider
    || uiRequestedProvider,
    );
  const actualProviderUsed = blockedBeforeProvider
    ? 'none'
    : normalizeProviderKey(
      executionMetadata.actual_provider_used
    || data.data?.actual_provider_used
    || data.data?.provider
    || executableProvider
    || null,
    );
  const fallbackUsedForRouter = Boolean(
    executionMetadata.fallback_used
    ?? requestTrace.fallback_used
    ?? false,
  );
  const providerOverrideReasonForRouter = String(
    executionMetadata.provider_override_reason
    || requestTrace.provider_override_reason
    || requestPayload.provider_override_reason
    || '',
  ).trim();
  const requestedProviderIntent = requestPayload?.routeDecision?.defaultProvider
    || requestTrace.ui_default_provider
    || executionMetadata.ui_default_provider
    || requestPayload.provider;
  const requestedProviderForRequest = executionMetadata.requested_provider_for_request
    || requestTrace.requested_provider_for_request
    || requestPayload.routeDecision?.requestedProviderForRequest
    || requestPayload.execution_requested_provider
    || requestPayload.provider;
  const executionRequestedProvider = executionMetadata.execution_requested_provider
    || requestTrace.execution_requested_provider
    || requestPayload.execution_requested_provider
    || requestedProviderForRequest;
  const selectedProvider = blockedBeforeProvider
    ? 'none'
    : (
      executionMetadata.selected_provider
      || requestTrace.selected_provider
      || requestPayload.routeDecision?.selectedProvider
      || requestPayload.provider
    );
  const executionSelectedProvider = blockedBeforeProvider
    ? 'none'
    : (
      executionMetadata.execution_selected_provider
      || requestTrace.execution_selected_provider
      || requestPayload.runtimeContext?.finalRouteTruth?.executedProvider
      || requestPayload.runtimeContext?.canonicalRouteRuntimeTruth?.executedProvider
      || requestPayload.runtimeContext?.finalRouteTruth?.selectedProvider
      || requestPayload.runtimeContext?.canonicalRouteRuntimeTruth?.selectedProvider
      || actualProviderUsed
      || selectedProvider
    );
  const timeoutEffectiveProvider = actualProviderUsed
    || executionSelectedProvider
    || executionMetadata.timeout_provider
    || requestTrace.timeout_provider
    || requestPayload.runtimeContext?.timeoutPolicy?.timeoutProvider
    || selectedProvider;
  const executionStatus = String(
    executionMetadata.execution_status
    || requestTrace.execution_status
    || data.data?.execution_status
    || data.data?.status
    || '',
  ).trim().toLowerCase();
  const executionTruth = String(
    executionMetadata.execution_truth
    || requestTrace.execution_truth
    || data.data?.execution_truth
    || '',
  ).trim().toLowerCase();
  const finalExecutionOutcome = String(
    executionMetadata.selected_provider_final_execution_outcome
    || requestTrace.selected_provider_final_execution_outcome
    || '',
  ).trim().toLowerCase();
  const successClassOutcome = finalExecutionOutcome === 'success'
    || executionStatus.startsWith('ok')
    || executionTruth.includes('answered');
  const requestScopedRouterTraceProvider = normalizeProviderKey(
    currentRequestRouterMetadata
      ? (
        executionMetadata.router_selected_provider
        || requestTrace.router_selected_provider
        || executionMetadata.router_provider
        || requestTrace.router_provider
      )
      : null,
  );
  const rawRouterSelectedProvider = normalizeProviderKey(
    requestSideSelectedProvider
    || executableProvider
    || actualProviderUsed
    || requestScopedRouterTraceProvider
    || requestPayload.routeDecision?.selectedProvider
    || requestPayload.router_selected_provider
    || null,
  );
  const routerSelectedProvider = (() => {
    if (successClassOutcome && !fallbackUsedForRouter && !providerOverrideReasonForRouter) {
      return normalizeProviderKey(
        actualProviderUsed
        || executableProvider
        || requestSideSelectedProvider
        || requestScopedRouterTraceProvider
        || requestPayload.provider,
      );
    }
    if (
      rawRouterSelectedProvider
      && (
        rawRouterSelectedProvider === requestSideSelectedProvider
        || rawRouterSelectedProvider === executableProvider
        || rawRouterSelectedProvider === actualProviderUsed
      )
    ) {
      return rawRouterSelectedProvider;
    }
    return normalizeProviderKey(
      requestSideSelectedProvider
      || executableProvider
      || actualProviderUsed
      || requestScopedRouterTraceProvider
      || requestPayload.provider,
    );
  })();
  const cancellationClassOutcome = /(cancel|abort)/.test(finalExecutionOutcome);
  const rawExecutionCancelled = Boolean(executionMetadata.execution_cancelled ?? requestPayload.execution_cancelled ?? false);
  const rawProviderCancelled = Boolean(executionMetadata.provider_cancelled ?? requestPayload.provider_cancelled ?? false);
  const rawCancellationSource = executionMetadata.cancellation_source || requestPayload.cancellation_source || null;
  const rawProviderCancelReason = executionMetadata.provider_cancel_reason || requestPayload.provider_cancel_reason || null;
  const rawOllamaAbortSent = Boolean(executionMetadata.ollama_abort_sent ?? requestPayload.ollama_abort_sent ?? false);
  const normalizedCancellation = successClassOutcome && !cancellationClassOutcome
    ? {
      execution_cancelled: false,
      cancellation_source: null,
      provider_cancelled: false,
      provider_cancel_reason: null,
      ollama_abort_sent: false,
    }
    : {
      execution_cancelled: rawExecutionCancelled,
      cancellation_source: rawCancellationSource,
      provider_cancelled: rawProviderCancelled,
      provider_cancel_reason: rawProviderCancelReason,
      ollama_abort_sent: rawOllamaAbortSent,
    };
  const rawModelUsed = executionMetadata.model_used
    || data.data?.model_used
    || data.data?.provider_model
    || requestTrace.model_used
    || requestPayload?.providerConfigs?.ollama?.model
    || requestPayload?.providerConfig?.model
    || null;
  const modelUsed = modelMatchesProviderFamily(actualProviderUsed, rawModelUsed)
    ? rawModelUsed
    : (
      executionMetadata.ollama_model_after_load_policy
      || requestTrace.ollama_model_after_load_policy
      || executionMetadata.ollama_model_selected
      || requestTrace.ollama_model_selected
      || requestPayload?.providerConfigs?.[actualProviderUsed]?.model
      || rawModelUsed
    );
  const freshnessNeed = executionMetadata.freshness_need || requestTrace.freshness_need || requestPayload.freshnessContext?.freshnessNeed || 'low';
  const freshnessRequiredForTruth = Boolean(
    executionMetadata.freshness_required_for_truth
    ?? requestTrace.freshness_required_for_truth
    ?? (freshnessNeed === 'high'),
  );
  const routeDecision = requestPayload.routeDecision || {};
  const defaultSelectedAnswerMode = executionMetadata.selected_answer_mode
    || requestTrace.selected_answer_mode
    || routeDecision?.selectedAnswerMode
    || 'local-private';
  const shouldPromoteHostedCloudBasic = freshnessNeed === 'low'
    && routeDecision?.aiPolicy?.aiPolicyMode === 'hosted-cloud-first-for-freshness'
    && String(executionMetadata.selected_provider || requestTrace.selected_provider || routeDecision?.selectedProvider || '').trim().toLowerCase() === 'groq'
    && routeDecision?.cloudRouteAvailable === true
    && routeDecision?.localRouteAvailable === false
    && defaultSelectedAnswerMode === 'local-private';
  const selectedAnswerMode = shouldPromoteHostedCloudBasic ? 'cloud-basic' : defaultSelectedAnswerMode;
  const defaultPolicyReason = executionMetadata.ai_policy_reason
    || requestTrace.ai_policy_reason
    || routeDecision?.policyReason
    || 'Local-first policy applied.';
  const aiPolicyReason = shouldPromoteHostedCloudBasic
    && defaultPolicyReason === 'Local-private default for low-freshness or private/system reasoning.'
    ? 'Hosted session using zero-cost cloud reasoning path for low-freshness request.'
    : defaultPolicyReason;
  const latestUserPrompt = Array.isArray(requestPayload?.messages)
    ? [...requestPayload.messages]
      .reverse()
      .find((entry) => String(entry?.role || '').toLowerCase() === 'user')?.content
    : '';
  const promptForFastLaneInference = latestUserPrompt || requestPayload?.raw_input || '';
  const promptFastLaneEligible = isFastLanePromptEligible(promptForFastLaneInference);
  const providerForFastLaneInference = String(actualProviderUsed || executionSelectedProvider || selectedProvider || '').trim().toLowerCase();
  const modelForFastLaneInference = String(modelUsed || '').trim().toLowerCase();
  const explicitFastLaneEligible = executionMetadata.fast_response_lane_eligible ?? requestTrace.fast_response_lane_eligible;
  const explicitFastLaneActive = executionMetadata.fast_response_lane_active ?? requestTrace.fast_response_lane_active;
  const inferredFastLaneActive = providerForFastLaneInference === 'ollama'
    && modelForFastLaneInference === FAST_RESPONSE_MODEL
    && promptFastLaneEligible;
  const effectiveFastLaneEligible = typeof explicitFastLaneEligible === 'boolean'
    ? explicitFastLaneEligible
    : inferredFastLaneActive;
  const effectiveFastLaneActive = typeof explicitFastLaneActive === 'boolean'
    ? explicitFastLaneActive
    : inferredFastLaneActive;
  const effectiveFastLaneModel = executionMetadata.fast_response_model
    || requestTrace.fast_response_model
    || (effectiveFastLaneActive ? modelUsed : null);
  const effectiveFastLaneReason = executionMetadata.fast_response_lane_reason
    || requestTrace.fast_response_lane_reason
    || (effectiveFastLaneActive ? 'short-local-private-prompt' : null);
  const streamPolicyDecision = String(
    executionMetadata.streaming_policy_decision
    || requestTrace.streaming_policy_decision
    || requestPayload.streaming_policy_decision
    || '',
  ).trim().toLowerCase();
  const streamRequestSource = String(
    executionMetadata.streaming_request_source
    || requestTrace.streaming_request_source
    || requestPayload.streaming_request_source
    || '',
  ).trim().toLowerCase();
  const streamOpenedOrEventsObserved = Boolean(
    executionMetadata.streaming_client_opened
    ?? requestTrace.streaming_client_opened
    ?? executionMetadata.streaming_first_event_received
    ?? requestTrace.streaming_first_event_received
    ?? executionMetadata.streaming_used
    ?? requestTrace.streaming_used
    ?? data?.data?.__stream?.used
    ?? false,
  );
  const streamingRequested = Boolean(
    executionMetadata.streaming_requested
    ?? requestTrace.streaming_requested
    ?? requestPayload.streaming_requested
    ?? false,
  ) || streamPolicyDecision === 'stream-enabled'
    || streamRequestSource === 'auto-heavy-ollama'
    || streamRequestSource === 'operator-on'
    || streamOpenedOrEventsObserved;
  const streamingUsed = Boolean(
    executionMetadata.streaming_used
    ?? requestTrace.streaming_used
    ?? data?.data?.__stream?.used
    ?? false,
  ) || streamOpenedOrEventsObserved;
  const streamingFinalized = Boolean(
    executionMetadata.streaming_finalized
    ?? requestTrace.streaming_finalized
    ?? data?.data?.__stream?.finalized
    ?? false,
  );
  const explicitFinalMetadataMissing = executionMetadata.final_metadata_missing
    ?? requestTrace.final_metadata_missing
    ?? data?.data?.__stream?.metadataReceived === false;
  const finalMetadataMissing = Boolean(
    explicitFinalMetadataMissing
    ?? (data?.success && streamingUsed && !streamingFinalized),
  );
  const streamingCompletionQuality = executionMetadata.streaming_completion_quality
    || requestTrace.streaming_completion_quality
    || data?.data?.__stream?.completionQuality
    || (streamingUsed
      ? (streamingFinalized
        ? (finalMetadataMissing ? 'partial-success' : 'fully-finalized')
        : (finalMetadataMissing ? 'partial-success' : 'stream-ended'))
      : 'not-used');
  const policyProviderModel = selectedProvider === 'ollama'
    ? (requestPayload?.providerConfigs?.ollama?.model || requestPayload?.providerConfig?.model || null)
    : null;
  const streamingProvider = executionMetadata.streaming_provider
    || requestTrace.streaming_provider
    || (streamingRequested || streamingUsed ? 'ollama' : null);
  const streamingModel = executionMetadata.streaming_model
    || requestTrace.streaming_model
    || modelUsed
    || policyProviderModel
    || null;
  const streamingSupported = Boolean(
    executionMetadata.streaming_supported
    ?? requestTrace.streaming_supported
    ?? false,
  ) || Boolean((streamingRequested || streamingUsed) && streamingProvider === 'ollama');

  return {
    ui_default_provider: executionMetadata.ui_default_provider
      || requestTrace.ui_default_provider
      || requestPayload.routeDecision?.defaultProvider
      || requestPayload.provider,
    ui_requested_provider: uiRequestedProvider || requestPayload.provider,
    request_side_selected_provider: requestSideSelectedProvider || requestPayload.provider,
    router_selected_provider: routerSelectedProvider || selectedProvider,
    submission_console: requestTrace.submission_console || requestPayload.submissionSource || executionMetadata.submission_console || 'stephanos-mission-console',
    submission_route: executionMetadata.submission_route || requestTrace.submission_route || requestPayload.submissionRoute || 'assistant-router',
    requested_provider_intent: requestedProviderIntent,
    freshness_candidate_provider: executionMetadata.freshness_candidate_provider
      || requestTrace.freshness_candidate_provider
      || requestPayload.routeDecision?.freshnessCandidateProvider
      || null,
    execution_requested_provider: executionRequestedProvider,
    requested_provider_for_request: requestedProviderForRequest,
    backend_default_provider: executionMetadata.backend_default_provider || requestTrace.backend_default_provider || backendDefaultProvider || 'unknown',
    route_mode: executionMetadata.route_mode || requestTrace.route_mode || requestPayload.routeMode || 'auto',
    effective_route_mode: executionMetadata.effective_route_mode || requestTrace.effective_route_mode || requestPayload.routeMode || 'auto',
    requested_provider: executionMetadata.requested_provider
      || requestTrace.requested_provider
      || executionMetadata.requested_provider_for_request
      || requestedProviderForRequest,
    selected_provider: selectedProvider,
    execution_selected_provider: executionSelectedProvider || timeoutEffectiveProvider || selectedProvider,
    executable_provider: executableProvider || executionSelectedProvider || selectedProvider,
    actual_provider_used: actualProviderUsed || (streamingUsed ? streamingProvider : null),
    actual_model_used: modelUsed,
    model_used: modelUsed,
    fallback_provider_used: executionMetadata.fallback_provider_used || requestTrace.fallback_provider_used || null,
    provider_override_reason: executionMetadata.provider_override_reason
      || requestTrace.provider_override_reason
      || requestPayload.provider_override_reason
      || null,
    ollama_model_default: executionMetadata.ollama_model_default || requestTrace.ollama_model_default || null,
    ollama_model_preferred: executionMetadata.ollama_model_preferred || requestTrace.ollama_model_preferred || null,
    ollama_model_requested: executionMetadata.ollama_model_requested || requestTrace.ollama_model_requested || null,
    ollama_model_selected: executionMetadata.ollama_model_selected || requestTrace.ollama_model_selected || null,
    ollama_load_mode: executionMetadata.ollama_load_mode || requestTrace.ollama_load_mode || requestPayload.ollama_load_mode || null,
    ollama_load_policy_applied: Boolean(executionMetadata.ollama_load_policy_applied ?? requestTrace.ollama_load_policy_applied ?? false),
    ollama_load_policy_reason: executionMetadata.ollama_load_policy_reason || requestTrace.ollama_load_policy_reason || null,
    ollama_heavy_model_requested: Boolean(executionMetadata.ollama_heavy_model_requested ?? requestTrace.ollama_heavy_model_requested ?? false),
    ollama_heavy_model_allowed: executionMetadata.ollama_heavy_model_allowed ?? requestTrace.ollama_heavy_model_allowed ?? null,
    ollama_model_before_load_policy: executionMetadata.ollama_model_before_load_policy || requestTrace.ollama_model_before_load_policy || null,
    ollama_model_after_load_policy: executionMetadata.ollama_model_after_load_policy || requestTrace.ollama_model_after_load_policy || null,
    ollama_reasoning_mode: executionMetadata.ollama_reasoning_mode || requestTrace.ollama_reasoning_mode || null,
    ollama_escalation_active: Boolean(executionMetadata.ollama_escalation_active ?? requestTrace.ollama_escalation_active ?? false),
    ollama_escalation_reason: executionMetadata.ollama_escalation_reason || requestTrace.ollama_escalation_reason || null,
    fast_response_lane_eligible: effectiveFastLaneEligible,
    fast_response_lane_active: effectiveFastLaneActive,
    fast_response_lane_reason: effectiveFastLaneReason,
    fast_response_model: effectiveFastLaneModel,
    fast_response_streaming: Boolean(executionMetadata.fast_response_streaming ?? requestTrace.fast_response_streaming ?? false),
    streaming_mode_preference: executionMetadata.streaming_mode_preference
      || requestTrace.streaming_mode_preference
      || requestPayload.streaming_mode_preference
      || requestPayload.streamingMode
      || 'auto',
    streaming_mode_preference_input: executionMetadata.streaming_mode_preference_input
      || requestTrace.streaming_mode_preference_input
      || requestPayload.streaming_mode_preference_input
      || requestPayload.streaming_mode_preference
      || requestPayload.streamingMode
      || 'auto',
    streaming_mode_preference_rehydrated: Boolean(
      executionMetadata.streaming_mode_preference_rehydrated
      ?? requestTrace.streaming_mode_preference_rehydrated
      ?? requestPayload.streaming_mode_preference_rehydrated
      ?? false,
    ),
    streaming_persistence_source: executionMetadata.streaming_persistence_source
      || requestTrace.streaming_persistence_source
      || requestPayload.streaming_persistence_source
      || 'default/auto',
    streaming_persistence_updated_at: executionMetadata.streaming_persistence_updated_at
      || requestTrace.streaming_persistence_updated_at
      || requestPayload.streaming_persistence_updated_at
      || null,
    streaming_requested: streamingRequested,
    streaming_request_source: executionMetadata.streaming_request_source
      || requestTrace.streaming_request_source
      || requestPayload.streaming_request_source
      || 'auto-default-off',
    streaming_policy_decision: executionMetadata.streaming_policy_decision
      || requestTrace.streaming_policy_decision
      || requestPayload.streaming_policy_decision
      || null,
    streaming_policy_reason: executionMetadata.streaming_policy_reason
      || requestTrace.streaming_policy_reason
      || requestPayload.streaming_policy_reason
      || null,
    streaming_supported: streamingSupported,
    streaming_used: streamingUsed,
    streaming_entered_backend: Boolean(executionMetadata.streaming_entered_backend ?? requestTrace.streaming_entered_backend ?? false),
    streaming_client_opened: Boolean(executionMetadata.streaming_client_opened ?? requestTrace.streaming_client_opened ?? false),
    streaming_first_event_received: Boolean(executionMetadata.streaming_first_event_received ?? requestTrace.streaming_first_event_received ?? false),
    streaming_inactivity_timeout_ms: executionMetadata.streaming_inactivity_timeout_ms
      || requestTrace.streaming_inactivity_timeout_ms
      || null,
    streaming_last_event_at: executionMetadata.streaming_last_event_at
      || requestTrace.streaming_last_event_at
      || null,
    streaming_failure_phase: executionMetadata.streaming_failure_phase
      || requestTrace.streaming_failure_phase
      || null,
    streaming_provider: streamingProvider,
    streaming_model: streamingModel,
    streaming_finalized: streamingFinalized,
    streaming_fallback_reason: executionMetadata.streaming_fallback_reason
      || requestTrace.streaming_fallback_reason
      || (finalMetadataMissing ? 'stream-ended-before-final-metadata' : null),
    final_metadata_missing: finalMetadataMissing,
    streaming_completion_quality: streamingCompletionQuality,
    escalation_model: executionMetadata.escalation_model || requestTrace.escalation_model || null,
    escalation_reason: executionMetadata.escalation_reason || requestTrace.escalation_reason || null,
    ollama_fallback_model: executionMetadata.ollama_fallback_model || requestTrace.ollama_fallback_model || null,
    ollama_fallback_model_used: Boolean(executionMetadata.ollama_fallback_model_used ?? requestTrace.ollama_fallback_model_used ?? false),
    ollama_fallback_reason: executionMetadata.ollama_fallback_reason || requestTrace.ollama_fallback_reason || null,
    ollama_timeout_ms: executionMetadata.ollama_timeout_ms || requestTrace.ollama_timeout_ms || null,
    ollama_timeout_source: executionMetadata.ollama_timeout_source || requestTrace.ollama_timeout_source || null,
    ollama_timeout_model: executionMetadata.ollama_timeout_model || requestTrace.ollama_timeout_model || null,
    ui_request_timeout_ms: executionMetadata.ui_request_timeout_ms
      || requestTrace.ui_request_timeout_ms
      || requestPayload.runtimeContext?.timeoutPolicy?.uiRequestTimeoutMs
      || requestPayload.runtimeContext?.timeoutMs
      || null,
    ui_stream_inactivity_timeout_ms: executionMetadata.ui_stream_inactivity_timeout_ms
      || requestTrace.ui_stream_inactivity_timeout_ms
      || null,
    backend_route_timeout_ms: executionMetadata.backend_route_timeout_ms
      || requestTrace.backend_route_timeout_ms
      || requestPayload.runtimeContext?.timeoutPolicy?.backendRouteTimeoutMs
      || null,
    provider_timeout_ms: executionMetadata.provider_timeout_ms
      || requestTrace.provider_timeout_ms
      || requestPayload.runtimeContext?.timeoutPolicy?.providerTimeoutMs
      || null,
    model_timeout_ms: executionMetadata.model_timeout_ms
      || requestTrace.model_timeout_ms
      || requestPayload.runtimeContext?.timeoutPolicy?.modelTimeoutMs
      || null,
    timeout_policy_source: executionMetadata.timeout_policy_source
      || requestTrace.timeout_policy_source
      || requestPayload.runtimeContext?.timeoutPolicy?.timeoutPolicySource
      || requestPayload.runtimeContext?.timeoutSource
      || null,
    timeout_effective_provider: timeoutEffectiveProvider || null,
    timeout_effective_model: executionMetadata.timeout_model
      || requestTrace.timeout_model
      || requestPayload.runtimeContext?.timeoutPolicy?.timeoutModel
      || modelUsed
      || null,
    timeout_override_applied: Boolean(
      executionMetadata.timeout_override_applied
      ?? requestTrace.timeout_override_applied
      ?? requestPayload.runtimeContext?.timeoutPolicy?.timeoutOverrideApplied
      ?? false,
    ),
    timeout_failure_layer: executionMetadata.timeout_failure_layer || requestTrace.timeout_failure_layer || null,
    timeout_failure_label: executionMetadata.timeout_failure_label || requestTrace.timeout_failure_label || null,
    execution_cancelled: normalizedCancellation.execution_cancelled,
    cancellation_source: normalizedCancellation.cancellation_source,
    provider_cancelled: normalizedCancellation.provider_cancelled,
    provider_cancel_reason: normalizedCancellation.provider_cancel_reason,
    ollama_abort_sent: normalizedCancellation.ollama_abort_sent,
    ui_timeout_triggered: Boolean(executionMetadata.ui_timeout_triggered ?? requestPayload.ui_timeout_triggered ?? false),
    backend_timeout_triggered: Boolean(executionMetadata.backend_timeout_triggered ?? requestPayload.backend_timeout_triggered ?? false),
    abort_signal_created: Boolean(executionMetadata.abort_signal_created ?? requestPayload.abort_signal_created ?? false),
    abort_signal_fired: Boolean(executionMetadata.abort_signal_fired ?? requestPayload.abort_signal_fired ?? false),
    abort_forwarded_to_router: Boolean(executionMetadata.abort_forwarded_to_router ?? requestPayload.abort_forwarded_to_router ?? false),
    abort_forwarded_to_provider: Boolean(executionMetadata.abort_forwarded_to_provider ?? requestPayload.abort_forwarded_to_provider ?? false),
    abort_forwarded_to_ollama_fetch: Boolean(executionMetadata.abort_forwarded_to_ollama_fetch ?? requestPayload.abort_forwarded_to_ollama_fetch ?? false),
    ollama_fetch_aborted: Boolean(executionMetadata.ollama_fetch_aborted ?? requestPayload.ollama_fetch_aborted ?? false),
    ollama_reader_cancelled: Boolean(executionMetadata.ollama_reader_cancelled ?? requestPayload.ollama_reader_cancelled ?? false),
    provider_generation_still_running_unknown: Boolean(executionMetadata.provider_generation_still_running_unknown ?? requestTrace.provider_generation_still_running_unknown ?? false),
    provider_generation_confirmed_stopped: Boolean(executionMetadata.provider_generation_confirmed_stopped ?? requestTrace.provider_generation_confirmed_stopped ?? false),
    cancellation_effectiveness: executionMetadata.cancellation_effectiveness || requestTrace.cancellation_effectiveness || 'not-attempted',
    fallback_used: Boolean(executionMetadata.fallback_used ?? requestTrace.fallback_used ?? false),
    fallback_reason: executionMetadata.fallback_reason || requestTrace.fallback_reason || null,
    selected_provider_health_ok: Boolean(executionMetadata.selected_provider_health_ok ?? requestTrace.selected_provider_health_ok ?? false),
    selected_provider_health_state: executionMetadata.selected_provider_health_state || requestTrace.selected_provider_health_state || null,
    selected_provider_execution_viability: executionMetadata.selected_provider_execution_viability || requestTrace.selected_provider_execution_viability || null,
    selected_provider_execution_failure_layer: executionMetadata.selected_provider_execution_failure_layer || requestTrace.selected_provider_execution_failure_layer || null,
    selected_provider_execution_failure_label: executionMetadata.selected_provider_execution_failure_label || requestTrace.selected_provider_execution_failure_label || null,
    selected_provider_execution_failure_phase: executionMetadata.selected_provider_execution_failure_phase || requestTrace.selected_provider_execution_failure_phase || null,
    selected_provider_timeout_category: executionMetadata.selected_provider_timeout_category || requestTrace.selected_provider_timeout_category || null,
    selected_provider_model_warmup_likely: Boolean(
      executionMetadata.selected_provider_model_warmup_likely
      ?? requestTrace.selected_provider_model_warmup_likely
      ?? false,
    ),
    selected_provider_warmup_retry_applied: Boolean(
      executionMetadata.selected_provider_warmup_retry_applied
      ?? requestTrace.selected_provider_warmup_retry_applied
      ?? false,
    ),
    selected_provider_warmup_retry_timeout_ms: executionMetadata.selected_provider_warmup_retry_timeout_ms
      || requestTrace.selected_provider_warmup_retry_timeout_ms
      || null,
    selected_provider_warmup_retry_eligible: Boolean(
      executionMetadata.selected_provider_warmup_retry_eligible
      ?? requestTrace.selected_provider_warmup_retry_eligible
      ?? false,
    ),
    selected_provider_warmup_retry_reason: executionMetadata.selected_provider_warmup_retry_reason
      || requestTrace.selected_provider_warmup_retry_reason
      || null,
    selected_provider_warmup_retry_attempt_count: executionMetadata.selected_provider_warmup_retry_attempt_count
      ?? requestTrace.selected_provider_warmup_retry_attempt_count
      ?? null,
    selected_provider_first_attempt_elapsed_ms: executionMetadata.selected_provider_first_attempt_elapsed_ms
      ?? requestTrace.selected_provider_first_attempt_elapsed_ms
      ?? null,
    selected_provider_final_attempt_elapsed_ms: executionMetadata.selected_provider_final_attempt_elapsed_ms
      ?? requestTrace.selected_provider_final_attempt_elapsed_ms
      ?? null,
    selected_provider_initial_failure_layer: executionMetadata.selected_provider_initial_failure_layer
      || requestTrace.selected_provider_initial_failure_layer
      || null,
    selected_provider_initial_failure_label: executionMetadata.selected_provider_initial_failure_label
      || requestTrace.selected_provider_initial_failure_label
      || null,
    selected_provider_initial_failure_phase: executionMetadata.selected_provider_initial_failure_phase
      || requestTrace.selected_provider_initial_failure_phase
      || null,
    selected_provider_initial_timeout_category: executionMetadata.selected_provider_initial_timeout_category
      || requestTrace.selected_provider_initial_timeout_category
      || null,
    selected_provider_final_execution_outcome: executionMetadata.selected_provider_final_execution_outcome
      || requestTrace.selected_provider_final_execution_outcome
      || null,
    selected_provider_fallback_after_warmup_retry: Boolean(
      executionMetadata.selected_provider_fallback_after_warmup_retry
      ?? requestTrace.selected_provider_fallback_after_warmup_retry
      ?? false,
    ),
    selected_provider_elapsed_ms: executionMetadata.selected_provider_elapsed_ms || requestTrace.selected_provider_elapsed_ms || null,
    explicit_provider_fallback_policy_triggered: Boolean(
      executionMetadata.explicit_provider_fallback_policy_triggered
      ?? requestTrace.explicit_provider_fallback_policy_triggered
      ?? false,
    ),
    freshness_need: freshnessNeed,
    freshness_required_for_truth: freshnessRequiredForTruth,
    fresh_answer_required: Boolean(
      executionMetadata.fresh_answer_required
      ?? requestTrace.fresh_answer_required
      ?? freshnessRequiredForTruth,
    ),
    fresh_provider_available_for_request: Boolean(
      executionMetadata.fresh_provider_available_for_request
      ?? requestTrace.fresh_provider_available_for_request
      ?? false,
    ),
    fresh_provider_succeeded: Boolean(
      executionMetadata.fresh_provider_succeeded
      ?? requestTrace.fresh_provider_succeeded
      ?? false,
    ),
    freshness_reason: executionMetadata.freshness_reason || requestTrace.freshness_reason || requestPayload.freshnessContext?.freshnessReason || 'n/a',
    stale_risk: executionMetadata.stale_risk || requestTrace.stale_risk || requestPayload.freshnessContext?.staleRisk || 'low',
    selected_answer_mode: selectedAnswerMode,
    override_denial_reason: executionMetadata.override_denial_reason
      || requestTrace.override_denial_reason
      || requestPayload.routeDecision?.overrideDeniedReason
      || null,
    freshness_warning: executionMetadata.freshness_warning || requestTrace.freshness_warning || requestPayload.routeDecision?.freshnessWarning || null,
    freshness_routed: Boolean(executionMetadata.freshness_routed ?? requestTrace.freshness_routed ?? requestPayload.routeDecision?.freshnessRouted ?? false),
    ai_policy_mode: executionMetadata.ai_policy_mode
      || requestTrace.ai_policy_mode
      || requestPayload.routeDecision?.aiPolicy?.aiPolicyMode
      || 'local-first-cloud-when-needed',
    ai_policy_reason: aiPolicyReason,
    execution_provider_policy_source: routeDecision?.executionProviderPolicySource || 'freshness-routing-policy',
    execution_provider_policy_reason: routeDecision?.executionProviderPolicyReason || null,
    groq_endpoint_used: executionMetadata.groq_endpoint_used || requestTrace.groq_endpoint_used || null,
    groq_model_used: executionMetadata.groq_model_used || requestTrace.groq_model_used || null,
    groq_fresh_web_active: Boolean(executionMetadata.groq_fresh_web_active ?? requestTrace.groq_fresh_web_active ?? false),
    groq_fresh_web_candidate_available: Boolean(
      executionMetadata.groq_fresh_web_candidate_available
      ?? requestTrace.groq_fresh_web_candidate_available
      ?? false,
    ),
    groq_fresh_candidate_model: executionMetadata.groq_fresh_candidate_model
      || requestTrace.groq_fresh_candidate_model
      || requestPayload.routeDecision?.candidateFreshModel
      || null,
    groq_fresh_web_path: executionMetadata.groq_fresh_web_path || requestTrace.groq_fresh_web_path || null,
    groq_capability_reason: executionMetadata.groq_capability_reason || requestTrace.groq_capability_reason || null,
    stale_fallback_attempted: Boolean(
      executionMetadata.stale_fallback_attempted
      ?? requestTrace.stale_fallback_attempted
      ?? requestPayload.routeDecision?.staleFallbackAttempted
      ?? false,
    ),
    stale_fallback_permitted: Boolean(
      executionMetadata.stale_fallback_permitted
      ?? requestTrace.stale_fallback_permitted
      ?? requestPayload.routeDecision?.staleFallbackPermitted
      ?? requestPayload.freshnessContext?.staleFallbackPermitted
      ?? false,
    ),
    stale_fallback_used: Boolean(
      executionMetadata.stale_fallback_used
      ?? requestTrace.stale_fallback_used
      ?? false,
    ),
    stale_answer_warning: executionMetadata.stale_answer_warning || requestTrace.stale_answer_warning || null,
    answer_truth_mode: executionMetadata.answer_truth_mode || requestTrace.answer_truth_mode || null,
    freshness_integrity_preserved: Boolean(
      executionMetadata.freshness_integrity_preserved
      ?? requestTrace.freshness_integrity_preserved
      ?? !freshnessRequiredForTruth,
    ),
    freshness_integrity_failure_reason: executionMetadata.freshness_integrity_failure_reason
      || requestTrace.freshness_integrity_failure_reason
      || null,
    freshness_truth_reason: executionMetadata.freshness_truth_reason || requestTrace.freshness_truth_reason || null,
    freshness_next_actions: Array.isArray(executionMetadata.freshness_next_actions)
      ? executionMetadata.freshness_next_actions
      : (Array.isArray(requestTrace.freshness_next_actions) ? requestTrace.freshness_next_actions : []),
    retrieval_mode: executionMetadata.retrieval_mode || requestTrace.retrieval_mode || 'none',
    retrieval_eligible: Boolean(executionMetadata.retrieval_eligible ?? requestTrace.retrieval_eligible ?? false),
    retrieval_used: Boolean(executionMetadata.retrieval_used ?? requestTrace.retrieval_used ?? false),
    retrieval_reason: executionMetadata.retrieval_reason || requestTrace.retrieval_reason || 'Retrieval not evaluated.',
    retrieved_chunk_count: Number(executionMetadata.retrieved_chunk_count ?? requestTrace.retrieved_chunk_count ?? 0),
    retrieved_sources: Array.isArray(executionMetadata.retrieved_sources)
      ? executionMetadata.retrieved_sources
      : (Array.isArray(requestTrace.retrieved_sources) ? requestTrace.retrieved_sources : []),
    retrieval_query: executionMetadata.retrieval_query || requestTrace.retrieval_query || '',
    retrieval_index_status: executionMetadata.retrieval_index_status || requestTrace.retrieval_index_status || 'missing',
    memory_eligible: Boolean(executionMetadata.memory_eligible ?? requestTrace.memory_eligible ?? false),
    memory_promoted: Boolean(executionMetadata.memory_promoted ?? requestTrace.memory_promoted ?? false),
    memory_reason: executionMetadata.memory_reason || requestTrace.memory_reason || 'No memory candidate submitted for adjudication.',
    memory_source_type: executionMetadata.memory_source_type || requestTrace.memory_source_type || 'operator',
    memory_source_ref: executionMetadata.memory_source_ref || requestTrace.memory_source_ref || '',
    memory_confidence: executionMetadata.memory_confidence || requestTrace.memory_confidence || 'low',
    memory_class: executionMetadata.memory_class || requestTrace.memory_class || 'durable',
    context_assembly_used: Boolean(
      executionMetadata.context_assembly_used
      ?? requestTrace.context_assembly_used
      ?? contextAssemblyMetadata.context_assembly_used
      ?? false,
    ),
    context_assembly_mode: executionMetadata.context_assembly_mode
      || requestTrace.context_assembly_mode
      || contextAssemblyMetadata.context_assembly_mode
      || 'minimal',
    context_sources_considered: executionMetadata.context_sources_considered
      || requestTrace.context_sources_considered
      || contextAssemblyMetadata.context_sources_considered
      || [],
    context_sources_used: executionMetadata.context_sources_used
      || requestTrace.context_sources_used
      || contextAssemblyMetadata.context_sources_used
      || [],
    context_source_reason_map: executionMetadata.context_source_reason_map
      || requestTrace.context_source_reason_map
      || contextAssemblyMetadata.context_source_reason_map
      || {},
    context_bundle_summary: executionMetadata.context_bundle_summary
      || requestTrace.context_bundle_summary
      || contextAssemblyMetadata.context_bundle_summary
      || {},
    self_build_prompt_detected: Boolean(
      executionMetadata.self_build_prompt_detected
      ?? requestTrace.self_build_prompt_detected
      ?? contextAssemblyMetadata.self_build_prompt_detected
      ?? false,
    ),
    self_build_reason: executionMetadata.self_build_reason
      || requestTrace.self_build_reason
      || contextAssemblyMetadata.self_build_reason
      || null,
    system_awareness_level: executionMetadata.system_awareness_level
      || requestTrace.system_awareness_level
      || contextAssemblyMetadata.system_awareness_level
      || 'baseline',
    augmented_prompt_used: Boolean(
      executionMetadata.augmented_prompt_used
      ?? requestTrace.augmented_prompt_used
      ?? contextAssemblyMetadata.augmented_prompt_used
      ?? false,
    ),
    augmented_prompt_length: executionMetadata.augmented_prompt_length
      || requestTrace.augmented_prompt_length
      || contextAssemblyMetadata.augmented_prompt_length
      || 0,
    context_assembly_warnings: executionMetadata.context_assembly_warnings
      || requestTrace.context_assembly_warnings
      || contextAssemblyMetadata.context_assembly_warnings
      || [],
    context_integrity_preserved: Boolean(
      executionMetadata.context_integrity_preserved
      ?? requestTrace.context_integrity_preserved
      ?? contextAssemblyMetadata.context_integrity_preserved
      ?? true,
    ),
    memory_elevation_active: Boolean(
      executionMetadata.memory_elevation_active
      ?? requestTrace.memory_elevation_active
      ?? contextAssemblyMetadata.memory_elevation_active
      ?? false,
    ),
    memory_elevation_mode: executionMetadata.memory_elevation_mode
      || requestTrace.memory_elevation_mode
      || contextAssemblyMetadata.memory_elevation_mode
      || 'bounded',
    memory_truth_preserved: Boolean(
      executionMetadata.memory_truth_preserved
      ?? requestTrace.memory_truth_preserved
      ?? contextAssemblyMetadata.memory_truth_preserved
      ?? true,
    ),
    memory_candidates_considered: Number(
      executionMetadata.memory_candidates_considered
      ?? requestTrace.memory_candidates_considered
      ?? contextAssemblyMetadata.memory_candidates_considered
      ?? 0
    ),
    elevated_memory_count: Number(
      executionMetadata.elevated_memory_count
      ?? requestTrace.elevated_memory_count
      ?? contextAssemblyMetadata.elevated_memory_count
      ?? 0
    ),
    graph_linked_memory_count: Number(
      executionMetadata.graph_linked_memory_count
      ?? requestTrace.graph_linked_memory_count
      ?? contextAssemblyMetadata.graph_linked_memory_count
      ?? 0
    ),
    deferred_graph_link_count: Number(
      executionMetadata.deferred_graph_link_count
      ?? requestTrace.deferred_graph_link_count
      ?? contextAssemblyMetadata.deferred_graph_link_count
      ?? 0
    ),
    build_relevant_memory_count: Number(
      executionMetadata.build_relevant_memory_count
      ?? requestTrace.build_relevant_memory_count
      ?? contextAssemblyMetadata.build_relevant_memory_count
      ?? 0
    ),
    mission_critical_memory_count: Number(
      executionMetadata.mission_critical_memory_count
      ?? requestTrace.mission_critical_memory_count
      ?? contextAssemblyMetadata.mission_critical_memory_count
      ?? 0
    ),
    continuity_confidence: executionMetadata.continuity_confidence
      || requestTrace.continuity_confidence
      || contextAssemblyMetadata.continuity_confidence
      || 'low',
    continuity_reason: executionMetadata.continuity_reason
      || requestTrace.continuity_reason
      || contextAssemblyMetadata.continuity_reason
      || '',
    recurrence_signals: executionMetadata.recurrence_signals
      || requestTrace.recurrence_signals
      || contextAssemblyMetadata.recurrence_signals
      || [],
    top_memory_influencers: executionMetadata.top_memory_influencers
      || requestTrace.top_memory_influencers
      || contextAssemblyMetadata.top_memory_influencers
      || [],
    memory_elevation_warnings: executionMetadata.memory_elevation_warnings
      || requestTrace.memory_elevation_warnings
      || contextAssemblyMetadata.memory_elevation_warnings
      || [],
    graph_link_truth_preserved: Boolean(
      executionMetadata.graph_link_truth_preserved
      ?? requestTrace.graph_link_truth_preserved
      ?? contextAssemblyMetadata.graph_link_truth_preserved
      ?? true,
    ),
    graph_link_reason: executionMetadata.graph_link_reason
      || requestTrace.graph_link_reason
      || contextAssemblyMetadata.graph_link_reason
      || '',
    source_provenance_summary: executionMetadata.source_provenance_summary
      || requestTrace.source_provenance_summary
      || contextAssemblyMetadata.source_provenance_summary
      || [],
    memory_informed_recommendation: executionMetadata.memory_informed_recommendation
      || requestTrace.memory_informed_recommendation
      || contextAssemblyMetadata.memory_informed_recommendation
      || '',
    planning_mode: executionMetadata.planning_mode
      || requestTrace.planning_mode
      || contextAssemblyMetadata.planning_mode
      || 'inactive',
    planning_intent_detected: Boolean(
      executionMetadata.planning_intent_detected
      ?? requestTrace.planning_intent_detected
      ?? contextAssemblyMetadata.planning_intent_detected
      ?? false,
    ),
    planning_confidence: executionMetadata.planning_confidence
      || requestTrace.planning_confidence
      || contextAssemblyMetadata.planning_confidence
      || 'low',
    current_system_maturity_estimate: executionMetadata.current_system_maturity_estimate
      || requestTrace.current_system_maturity_estimate
      || contextAssemblyMetadata.current_system_maturity_estimate
      || 'unknown',
    candidate_moves: executionMetadata.candidate_moves
      || requestTrace.candidate_moves
      || contextAssemblyMetadata.candidate_moves
      || [],
    ranked_moves: executionMetadata.ranked_moves
      || requestTrace.ranked_moves
      || contextAssemblyMetadata.ranked_moves
      || [],
    planning_blockers: executionMetadata.planning_blockers
      || requestTrace.planning_blockers
      || contextAssemblyMetadata.planning_blockers
      || [],
    planning_dependencies: executionMetadata.planning_dependencies
      || requestTrace.planning_dependencies
      || contextAssemblyMetadata.planning_dependencies
      || [],
    recommended_next_move: executionMetadata.recommended_next_move
      || requestTrace.recommended_next_move
      || contextAssemblyMetadata.recommended_next_move
      || null,
    recommendation_reason: executionMetadata.recommendation_reason
      || requestTrace.recommendation_reason
      || contextAssemblyMetadata.recommendation_reason
      || null,
    planning_evidence_sources: executionMetadata.planning_evidence_sources
      || requestTrace.planning_evidence_sources
      || contextAssemblyMetadata.planning_evidence_sources
      || [],
    planning_truth_warnings: executionMetadata.planning_truth_warnings
      || requestTrace.planning_truth_warnings
      || contextAssemblyMetadata.planning_truth_warnings
      || [],
    planning_operator_actions: executionMetadata.planning_operator_actions
      || requestTrace.planning_operator_actions
      || contextAssemblyMetadata.planning_operator_actions
      || [],
    codex_handoff_eligible: Boolean(
      executionMetadata.codex_handoff_eligible
      ?? requestTrace.codex_handoff_eligible
      ?? contextAssemblyMetadata.codex_handoff_eligible
      ?? false,
    ),
    proposal_eligible: Boolean(
      executionMetadata.proposal_eligible
      ?? requestTrace.proposal_eligible
      ?? contextAssemblyMetadata.proposal_eligible
      ?? false,
    ),
    proposal_packet_active: Boolean(
      executionMetadata.proposal_packet_active
      ?? requestTrace.proposal_packet_active
      ?? contextAssemblyMetadata.proposal_packet_active
      ?? false,
    ),
    proposal_packet_mode: executionMetadata.proposal_packet_mode
      || requestTrace.proposal_packet_mode
      || contextAssemblyMetadata.proposal_packet_mode
      || 'inactive',
    proposal_packet_confidence: executionMetadata.proposal_packet_confidence
      || requestTrace.proposal_packet_confidence
      || contextAssemblyMetadata.proposal_packet_confidence
      || 'low',
    proposal_packet_truth_preserved: Boolean(
      executionMetadata.proposal_packet_truth_preserved
      ?? requestTrace.proposal_packet_truth_preserved
      ?? contextAssemblyMetadata.proposal_packet_truth_preserved
      ?? true,
    ),
    codex_handoff_available: Boolean(
      executionMetadata.codex_handoff_available
      ?? requestTrace.codex_handoff_available
      ?? contextAssemblyMetadata.codex_handoff_available
      ?? false,
    ),
    operator_approval_required: Boolean(
      executionMetadata.operator_approval_required
      ?? requestTrace.operator_approval_required
      ?? contextAssemblyMetadata.operator_approval_required
      ?? true,
    ),
    proposed_move_id: executionMetadata.proposed_move_id
      || requestTrace.proposed_move_id
      || contextAssemblyMetadata.proposed_move_id
      || '',
    proposed_move_title: executionMetadata.proposed_move_title
      || requestTrace.proposed_move_title
      || contextAssemblyMetadata.proposed_move_title
      || '',
    proposed_move_rationale: executionMetadata.proposed_move_rationale
      || requestTrace.proposed_move_rationale
      || contextAssemblyMetadata.proposed_move_rationale
      || '',
    proposal_packet_warnings: executionMetadata.proposal_packet_warnings
      || requestTrace.proposal_packet_warnings
      || contextAssemblyMetadata.proposal_packet_warnings
      || [],
    proposal_packet: executionMetadata.proposal_packet
      || requestTrace.proposal_packet
      || contextAssemblyMetadata.proposal_packet
      || null,
    codex_prompt: executionMetadata.codex_prompt
      || requestTrace.codex_prompt
      || contextAssemblyMetadata.codex_prompt
      || '',
    codex_prompt_summary: executionMetadata.codex_prompt_summary
      || requestTrace.codex_prompt_summary
      || contextAssemblyMetadata.codex_prompt_summary
      || '',
    codex_constraints: executionMetadata.codex_constraints
      || requestTrace.codex_constraints
      || contextAssemblyMetadata.codex_constraints
      || [],
    codex_success_criteria: executionMetadata.codex_success_criteria
      || requestTrace.codex_success_criteria
      || contextAssemblyMetadata.codex_success_criteria
      || [],
    codex_handoff_payload: executionMetadata.codex_handoff_payload
      || requestTrace.codex_handoff_payload
      || contextAssemblyMetadata.codex_handoff_payload
      || '',
    proposal_operator_actions: executionMetadata.proposal_operator_actions
      || requestTrace.proposal_operator_actions
      || contextAssemblyMetadata.proposal_operator_actions
      || [],
    execution_eligible: Boolean(
      executionMetadata.execution_eligible
      ?? requestTrace.execution_eligible
      ?? contextAssemblyMetadata.execution_eligible
      ?? false,
    ),
  };
}

function resolveHostedProviderKey(providerLabel = '') {
  const normalized = String(providerLabel || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'groq' || normalized.startsWith('groq-')) return 'groq';
  if (normalized === 'gemini' || normalized.startsWith('gemini-')) return 'gemini';
  return '';
}

function deriveExecutionStatus(executionMetadata) {
  if (!executionMetadata?.actual_provider_used) {
    return 'ok';
  }

  if (executionMetadata.actual_provider_used === 'mock') {
    return executionMetadata.fallback_used ? 'mock-fallback' : 'mock';
  }

  return executionMetadata.fallback_used ? `fallback:${executionMetadata.actual_provider_used}` : `ok:${executionMetadata.actual_provider_used}`;
}

function buildExecutionSummary(executionMetadata) {
  const summaryPrefix = `UI route mode ${executionMetadata.route_mode}. Effective route ${executionMetadata.effective_route_mode}. UI default ${executionMetadata.ui_default_provider}. Request provider ${executionMetadata.requested_provider_for_request}. Backend default ${executionMetadata.backend_default_provider}. Requested ${executionMetadata.requested_provider}. Selected ${executionMetadata.selected_provider}. Executed ${executionMetadata.actual_provider_used}`;
  const modelSuffix = executionMetadata.model_used ? ` (${executionMetadata.model_used})` : '';
  const freshnessSuffix = ` Freshness ${executionMetadata.freshness_need} via ${executionMetadata.selected_answer_mode}. Policy ${executionMetadata.ai_policy_mode}: ${executionMetadata.ai_policy_reason}`;
  const retrievalSuffix = ` Retrieval ${executionMetadata.retrieval_mode}/${executionMetadata.retrieval_index_status}; eligible=${executionMetadata.retrieval_eligible}; used=${executionMetadata.retrieval_used}; chunks=${executionMetadata.retrieved_chunk_count}.`;
  const memorySuffix = ` Memory class=${executionMetadata.memory_class}; eligible=${executionMetadata.memory_eligible}; promoted=${executionMetadata.memory_promoted}; reason=${executionMetadata.memory_reason}.`;

  if (executionMetadata.fallback_used) {
    return `${summaryPrefix}${modelSuffix}. Fallback used${executionMetadata.fallback_reason ? `: ${executionMetadata.fallback_reason}` : '.'}${freshnessSuffix}${retrievalSuffix}${memorySuffix}`;
  }

  if (executionMetadata.actual_provider_used === 'mock') {
    return `${summaryPrefix}${modelSuffix}. Mock answered directly.${freshnessSuffix}${retrievalSuffix}${memorySuffix}`;
  }

  return `${summaryPrefix}${modelSuffix}.${freshnessSuffix}${retrievalSuffix}${memorySuffix}`;
}



function createRouteUnavailableResult({
  prompt,
  parsed,
  startedAt,
  routeDecision,
  continuityMode,
  continuityContext,
  continuityLookup,
  requestPayload,
}) {
  const requestDispatchGate = routeDecision?.requestDispatchGate || {};
  const fallbackReason = requestDispatchGate.reasonCode
    || routeDecision?.fallbackReasonCode
    || routeDecision?.freshRouteValidation?.failureReasons?.[0]
    || 'selected-route-unusable';
  const routeKind = requestDispatchGate.selectedRouteKind || routeDecision?.requestRouteTruth?.routeKind || 'unavailable';
  const routeUsableState = requestDispatchGate.routeUsableState || routeDecision?.requestRouteTruth?.routeUsableState || 'unknown';
  const routeProviderMismatchBlocker = routeDecision?.requestRouteTruth?.providerMismatch ? 'provider-route-mismatch' : null;
  const fallbackVetoReason = requestDispatchGate.fallbackVetoReason || routeDecision?.requestRouteTruth?.routeUsabilityVetoReason || null;
  const dispatchBlockedDespiteUsableRoute = routeUsableState === 'yes'
    && fallbackReason === 'backend-execution-contract-mismatch';
  const output = routeDecision?.selectedAnswerMode === 'fallback-stale-risk'
    ? `Fresh route unavailable; safe stale fallback used. (${fallbackReason})`
    : dispatchBlockedDespiteUsableRoute
      ? 'Route truth is healthy, but backend execution contract is stale or incompatible. Rebuild/restart Battle Bridge and retry provider dispatch.'
    : `Selected route unusable at request time (${routeKind}).`;
  const blockedBeforeProvider = fallbackReason === 'backend-route-unavailable'
    || fallbackReason === 'backend-unreachable'
    || fallbackReason === 'battle-bridge-unreachable-hosted-cloud-cognition-available';
  const routeFailureIndicatesBackendUnavailable = (
    blockedBeforeProvider
    || (
      String(requestDispatchGate.backendReachabilityState || '').trim().toLowerCase() === 'no'
      && /route[_-]unavailable/i.test(String(fallbackReason || ''))
    )
  );
  const normalizedFailureCode = routeFailureIndicatesBackendUnavailable
    ? 'backend-route-unavailable'
    : fallbackReason;
  const errorCode = dispatchBlockedDespiteUsableRoute
    ? 'PROVIDER_EXECUTION_CONTRACT_MISMATCH'
    : (normalizedFailureCode || 'ROUTE_UNAVAILABLE');
  const blockedProviderState = blockedBeforeProvider ? 'none' : (routeDecision?.selectedProvider || requestPayload.provider);

  return {
    data: {
      type: 'assistant_response',
      route: 'assistant',
      success: false,
      output_text: output,
      error: output,
      error_code: errorCode,
      timing_ms: Math.round(performance.now() - startedAt),
      data: {
        request_trace: {
          ui_default_provider: requestPayload.routeDecision?.defaultProvider || requestPayload.provider,
          requested_provider_for_request: blockedBeforeProvider ? 'none' : (requestPayload.routeDecision?.requestedProviderForRequest || requestPayload.provider),
          requested_provider: blockedBeforeProvider ? 'none' : requestPayload.provider,
          selected_provider: blockedProviderState,
          fallback_used: routeDecision?.selectedAnswerMode === 'fallback-stale-risk',
          fallback_reason: fallbackReason,
          freshness_need: requestPayload.freshnessContext?.freshnessNeed || 'low',
          freshness_reason: requestPayload.freshnessContext?.freshnessReason || 'n/a',
          stale_risk: requestPayload.freshnessContext?.staleRisk || 'low',
          selected_answer_mode: routeDecision?.selectedAnswerMode || 'local-private',
          override_denial_reason: routeDecision?.overrideDeniedReason || null,
          freshness_warning: routeDecision?.freshnessWarning || null,
          freshness_routed: Boolean(routeDecision?.freshnessRouted),
          stale_fallback_attempted: Boolean(routeDecision?.staleFallbackAttempted),
          stale_fallback_permitted: Boolean(routeDecision?.staleFallbackPermitted ?? requestPayload?.freshnessContext?.staleFallbackPermitted ?? false),
          stale_fallback_used: routeDecision?.selectedAnswerMode === 'fallback-stale-risk',
          answer_truth_mode: routeDecision?.selectedAnswerMode === 'fallback-stale-risk'
            ? 'degraded-stale-allowed'
            : 'degraded-freshness-unavailable',
          freshness_required_for_truth: requestPayload?.freshnessContext?.freshnessNeed === 'high',
          fresh_answer_required: requestPayload?.freshnessContext?.freshnessNeed === 'high',
          fresh_provider_available_for_request: Boolean(routeDecision?.freshRouteAvailable),
          fresh_provider_succeeded: false,
          freshness_integrity_preserved: true,
          freshness_integrity_failure_reason: null,
          stale_answer_warning: routeDecision?.selectedAnswerMode === 'fallback-stale-risk'
            ? 'Operator-approved degraded stale fallback path.'
            : null,
          freshness_truth_reason: routeDecision?.policyReason || null,
          freshness_next_actions: routeDecision?.selectedAnswerMode === 'fallback-stale-risk'
            ? ['retry-fresh-provider', 'switch-provider']
            : ['retry-fresh-provider', 'allow-degraded-stale-fallback', 'switch-provider'],
          ai_policy_mode: routeDecision?.aiPolicy?.aiPolicyMode || 'local-first-cloud-when-needed',
          ai_policy_reason: routeDecision?.policyReason || 'Local-first policy applied.',
          groq_fresh_candidate_model: routeDecision?.candidateFreshModel || null,
          groq_fresh_web_path: routeDecision?.candidateFreshPath || null,
          selected_route_kind: routeKind,
          selected_route_usable: routeUsableState === 'yes',
          selected_route_usable_state: routeUsableState,
          route_unavailable_reason: normalizedFailureCode || fallbackReason,
          provider_execution_block_reason: dispatchBlockedDespiteUsableRoute ? fallbackReason : null,
          provider_fallback_blocked_by_route: blockedBeforeProvider,
          route_provider_mismatch_blocker: routeProviderMismatchBlocker,
          fallback_veto_reason: fallbackVetoReason,
        },
        execution_metadata: {
          executable_provider: 'none',
          execution_selected_provider: 'none',
          selected_provider: 'none',
          actual_provider_used: 'none',
          fallback_active: false,
          provider_fallback_blocked_by_route: blockedBeforeProvider,
          provider_execution_gate_status: blockedBeforeProvider ? 'blocked-by-route' : 'unavailable',
          command_pipeline_last_failure_reason: normalizedFailureCode || fallbackReason || 'route-unavailable',
          command_pipeline_last_finalization_path: 'error',
          command_pipeline_last_input_restore_available: 'yes',
          response_planner_status: blockedBeforeProvider ? 'blocked-before-provider' : 'unavailable',
          github_pr_evidence_fetch_attempted: 'no',
        },
      },
    },
    requestPayload,
    entry: {
      id: `cmd_${Date.now()}`,
      raw_input: prompt,
      parsed_command: parsed,
      route: 'assistant',
      tool_used: null,
      success: false,
      output_text: output,
      data_payload: null,
      timing_ms: Math.round(performance.now() - startedAt),
      timestamp: new Date().toISOString(),
      error: output,
      error_code: errorCode,
      response: { type: 'assistant_response', route: 'assistant', success: false, output_text: output, error: output, error_code: errorCode },
      continuity_mode: continuityMode,
      continuity_context: continuityContext,
      continuity_retrieval_state: continuityLookup.retrievalState,
      continuity_retrieval_reason: continuityLookup.reason,
    },
  };
}

function createIdentityRecallDeterministicResult({
  prompt,
  parsed,
  startedAt,
  requestPayload,
  operatorName = '',
  operatorProfileSource = 'operator profile',
}) {
  const safeName = String(operatorName || '').trim();
  const output = safeName
    ? `Yes. Your name is ${safeName}.\n\nI have that from your ${operatorProfileSource}.`
    : 'I do not have your preferred name stored yet.';
  return {
    data: {
      type: 'assistant_response',
      route: 'assistant',
      success: true,
      output_text: output,
      error: null,
      error_code: null,
      timing_ms: Math.round(performance.now() - startedAt),
      data: {
        execution_metadata: {
          final_answer_used_operator_profile: safeName ? 'yes' : 'no',
          identity_recall_deterministic_answer_used: safeName ? 'yes' : 'no',
        },
      },
      raw_input: prompt,
      parsed_command: parsed,
      request_execution_id: requestPayload?.request_execution_id || null,
    },
    requestPayload: {
      ...requestPayload,
    },
  };
}

function createOperatorExplanationDeterministicResult({
  prompt,
  parsed,
  startedAt,
  requestPayload,
  projection = {},
  output = '',
}) {
  return {
    data: {
      type: 'assistant_response',
      route: 'assistant',
      success: true,
      output_text: output,
      error: null,
      error_code: null,
      timing_ms: Math.round(performance.now() - startedAt),
      data: {
        operator_explanation_projection: projection,
        execution_metadata: {
          operator_explanation_mode: projection?.mode || 'compact',
          operator_explanation_verdict: projection?.verdict || 'unknown',
          operator_explanation_triggered: 'yes',
          operator_explanation_projection_used: 'yes',
        },
      },
      raw_input: prompt,
      parsed_command: parsed,
      request_execution_id: requestPayload?.request_execution_id || null,
    },
    requestPayload: { ...requestPayload },
  };
}

function formatAgentRealityLoopAnswer(projection = {}, projectAwareness = {}) {
  const recommendedLead = projection?.recommendedLead || 'hold';
  const mergeRecommendation = projection?.mergeRecommendation || 'hold';
  const status = projection?.status || projection?.loopStatus || 'available';
  const requiredProof = Array.isArray(projection?.requiredProof) && projection.requiredProof.length
    ? projection.requiredProof.join(', ')
    : 'targeted proof from the existing Operator Relief / Mission Brain projection';
  const copyPackets = [
    projection?.copyCodexPacket ? 'Codex packet' : '',
    projection?.copyOpenClawPacket ? 'OpenClaw packet' : '',
    projection?.copyOperatorProofChecklist ? 'operator proof checklist' : '',
  ].filter(Boolean).join(', ') || 'no copy packets reported';
  const degradedNotice = String(projectAwareness?.status || '').trim().toLowerCase() === 'degraded'
    ? '\n\nSome mission details may be incomplete because Project Awareness is degraded.'
    : '';
  return [
    'Agent Reality Loop V1 is live in the Operator Relief / Mission Brain projection path.',
    `Current ARL status: ${status}.`,
    `Recommended lead: ${recommendedLead}.`,
    `Merge recommendation: ${mergeRecommendation}.`,
    `Required proof: ${requiredProof}.`,
    `Available handoff material: ${copyPackets}.`,
    'It is a read-only coordination/proof projection: it routes bounded work between Codex, OpenClaw, the operator, or hold; preserves operator approval; and does not create a second ARL authority.',
  ].join('\n') + degradedNotice;
}

function createAgentRealityLoopDeterministicResult({
  prompt,
  parsed,
  startedAt,
  requestPayload,
  projection = {},
  projectAwareness = {},
}) {
  return {
    data: {
      type: 'assistant_response',
      route: 'assistant',
      success: true,
      output_text: formatAgentRealityLoopAnswer(projection, projectAwareness),
      error: null,
      error_code: null,
      timing_ms: Math.round(performance.now() - startedAt),
      data: {
        execution_metadata: {
          agent_reality_loop_answer_used_live_projection: 'yes',
          agent_reality_loop_unavailable_claim_suppressed: 'yes',
        },
      },
      raw_input: prompt,
      parsed_command: parsed,
      request_execution_id: requestPayload?.request_execution_id || null,
    },
    requestPayload: { ...requestPayload },
  };
}

function transportErrorToUi(error, { routeDecision = null } = {}) {
  const routeFailureReason = routeDecision?.fallbackReasonCode || routeDecision?.freshRouteValidation?.failureReasons?.[0] || '';
  const routeTruthUsable = routeDecision?.requestDispatchGate?.selectedRouteUsable === true
    || routeDecision?.requestRouteTruth?.routeUsable === true;
  if (!error?.code && routeFailureReason === 'groq-web-capability-unsupported') {
    return {
      error: 'Fresh-web route override is unsupported by the active provider capability set.',
      errorCode: 'UNSUPPORTED_ROUTE_OVERRIDE',
      output: 'Fresh-web route override is unsupported by provider capabilities. Routed to stale-risk fallback instead.',
    };
  }
  if (!error?.code && routeFailureReason === 'groq-provider-unhealthy') {
    return {
      error: 'Fresh-web provider is currently unavailable.',
      errorCode: 'PROVIDER_UNAVAILABLE',
      output: 'Fresh-web provider is unavailable. Stephanos is using stale-risk fallback to preserve continuity.',
    };
  }
  if (!error?.code && routeFailureReason === 'groq-transport-unreachable') {
    return {
      error: 'Fresh-web provider transport is unreachable from the current backend route.',
      errorCode: 'PROVIDER_TRANSPORT_UNREACHABLE',
      output: 'Provider transport network path is unreachable. Stephanos downgraded to stale-risk fallback.',
    };
  }
  if (!error?.code) {
    if (routeFailureReason) {
      return {
        error: 'Selected route is unusable for transport dispatch.',
        errorCode: 'SELECTED_ROUTE_UNUSABLE',
        output: `Selected route unusable at request time (${routeFailureReason}). No transport dispatch was attempted.`,
      };
    }
    if (routeTruthUsable) {
      return {
        error: 'Route is usable, but executable provider adjudication failed.',
        errorCode: 'PROVIDER_EXECUTION_UNAVAILABLE',
        output: 'Route truth is healthy, but no executable provider was adjudicated. Refresh provider execution truth and retry dispatch.',
      };
    }
    return {
      error: 'Selected route is unavailable for transport dispatch.',
      errorCode: 'ROUTE_UNAVAILABLE',
      output: 'Fresh route unavailable or backend unavailable. Stephanos preserved metadata without dispatching transport.',
    };
  }
  if (error.code === 'BACKEND_OFFLINE') {
    return { error: error.message, errorCode: error.code, output: `${BACKEND_UNREACHABLE_MESSAGE} Start stephanos-server or update VITE_API_BASE_URL to a reachable API.` };
  }
  if (error.code === 'TIMEOUT') {
    const timeoutLayer = error?.details?.timeoutFailureLayer || 'ui';
    const timeoutMs = Number(error?.details?.timeoutMs) || null;
    const timeoutLabel = error?.details?.timeoutLabel || 'ui_request_timeout_ms';
    const timeoutLayerMessage = timeoutLayer === 'ui'
      ? 'UI request timeout elapsed before backend response.'
      : 'Request timeout elapsed before completion.';
    return {
      error: error.message,
      errorCode: error.code,
      output: `${timeoutLayerMessage}${timeoutMs ? ` (${timeoutMs}ms)` : ''} Layer: ${timeoutLayer}. Label: ${timeoutLabel}.`,
      timeoutFailureLayer: timeoutLayer,
      timeoutFailureLabel: timeoutLabel,
      timeoutMs,
      timeoutPolicySource: error?.details?.timeoutPolicySource || null,
      timeoutOverrideApplied: Boolean(error?.details?.timeoutOverrideApplied),
    };
  }
  if (error.code === 'CANCELLED') {
    const cancellationSource = String(error?.details?.cancellationSource || 'user-cancel').trim();
    return {
      error: 'Request cancelled.',
      errorCode: 'CANCELLED',
      output: `Request cancelled before completion. Source: ${cancellationSource}.`,
      cancellationSource,
    };
  }
  if (error.code === 'NETWORK_TRANSPORT_UNREACHABLE') {
    return { error: error.message, errorCode: error.code, output: 'Network transport failed before backend response. Check browser-to-backend reachability and CORS/published client route truth.' };
  }
  if (error.code === 'INVALID_JSON') {
    return { error: error.message, errorCode: error.code, output: 'Backend responded with invalid JSON. Check server logs for serialization issues.' };
  }
  if (error.code === 'STREAM_FINALIZATION_MISSING') {
    const reason = String(error?.details?.streamingFallbackReason || 'stream-ended-before-final-metadata').trim();
    return {
      error: error.message,
      errorCode: error.code,
      output: `Streaming ended before final metadata. Partial stream output is preserved when available. Reason: ${reason}.`,
    };
  }
  return { error: error.message, errorCode: error.code, output: error.message };
}

function buildTimeoutFailureExecutionMetadata({
  requestPayload = null,
  runtimeContext = null,
  providerConfigs = {},
  fallbackProvider = '',
  timeoutDetails = {},
} = {}) {
  const requestedProvider = String(
    requestPayload?.provider
    || requestPayload?.routeDecision?.requestedProviderForRequest
    || fallbackProvider
    || '',
  ).trim();
  const selectedProvider = String(
    runtimeContext?.finalRouteTruth?.executedProvider
    || runtimeContext?.finalRouteTruth?.selectedProvider
    || runtimeContext?.canonicalRouteRuntimeTruth?.executedProvider
    || runtimeContext?.canonicalRouteRuntimeTruth?.selectedProvider
    || requestPayload?.routeDecision?.selectedProvider
    || requestPayload?.routeDecision?.requestedProviderForRequest
    || requestedProvider
    || fallbackProvider
    || '',
  ).trim().toLowerCase();
  const safeProviderConfigs = providerConfigs && typeof providerConfigs === 'object' ? providerConfigs : {};
  const requestedModel = safeProviderConfigs?.[selectedProvider]?.model || '';
  const canonicalTimeoutPolicy = resolveUiRequestTimeoutPolicy({
    runtimeConfig: runtimeContext || {},
    provider: selectedProvider,
    providerConfigs: safeProviderConfigs,
    requestedModel,
  });
  const cancellationSource = String(timeoutDetails.cancellationSource || '').trim() || null;
  const cancelled = timeoutDetails.errorCode === 'CANCELLED' || Boolean(cancellationSource);
  const uiTimeoutTriggered = timeoutDetails.timeoutFailureLayer === 'ui';
  const streamingRequested = Boolean(requestPayload?.streaming_requested ?? false);
  const streamingSupported = selectedProvider === 'ollama';
  const inactivityTimeoutTriggered = timeoutDetails.timeoutLabel === 'ui_stream_inactivity_timeout_ms';
  const ollamaLoadMode = String(
    requestPayload?.ollama_load_mode
    || requestPayload?.ollamaLoadMode
    || 'balanced',
  ).trim().toLowerCase();
  const ollamaLoadGovernor = selectedProvider === 'ollama'
    ? resolveOllamaLoadGovernorPolicy({
      ollamaLoadMode,
      requestedModel,
      prompt: String(requestPayload?.prompt || ''),
      forceHeavyModel: requestPayload?.routeDecision?.operatorForceHeavyLocal === true,
      availableModels: [],
    })
    : null;
  const ollamaModelBeforeLoadPolicy = selectedProvider === 'ollama'
    ? String(ollamaLoadGovernor?.modelBeforePolicy || requestedModel || '').trim() || null
    : null;
  const ollamaModelAfterLoadPolicy = selectedProvider === 'ollama'
    ? String(ollamaLoadGovernor?.modelAfterPolicy || requestedModel || '').trim() || null
    : null;
  const postGovernorModel = selectedProvider === 'ollama'
    ? (ollamaModelAfterLoadPolicy || requestedModel || null)
    : (requestedModel || null);
  const effectiveStreamingPolicyModel = selectedProvider === 'ollama'
    ? String(ollamaModelAfterLoadPolicy || requestedModel || '').trim().toLowerCase()
    : String(requestedModel || '').trim().toLowerCase();
  const heavyModelAfterLoadPolicy = selectedProvider === 'ollama' && HEAVY_OLLAMA_MODELS.has(effectiveStreamingPolicyModel);
  const streamingModePreference = requestPayload?.streamingMode || requestPayload?.streaming_mode_preference || 'auto';
  const streamingModePreferenceInput = requestPayload?.streaming_mode_preference_input || requestPayload?.streamingMode || requestPayload?.streaming_mode_preference || 'auto';
  const timeoutStreamingPolicyDecision = selectedProvider === 'ollama'
    ? resolveStreamingRequestPolicy({
      streamingMode: streamingModePreference,
      provider: selectedProvider,
      executionProvider: selectedProvider,
      executionModel: effectiveStreamingPolicyModel,
      providerConfigs: safeProviderConfigs,
      ollamaLoadMode,
      prompt: String(requestPayload?.prompt || ''),
    })
    : null;
  const streamingPolicyDecision = timeoutStreamingPolicyDecision?.streamingPolicyDecision
    || requestPayload?.streaming_policy_decision
    || null;
  const streamingRequestSource = timeoutStreamingPolicyDecision?.streamingRequestSource
    || requestPayload?.streaming_request_source
    || 'auto-default-off';
  const streamingRequestAllowed = timeoutStreamingPolicyDecision?.streamingRequested === true
    || streamingPolicyDecision === 'stream-enabled'
    || heavyModelAfterLoadPolicy;

  return {
    ui_default_provider: requestPayload?.routeDecision?.defaultProvider || fallbackProvider || selectedProvider || 'unknown',
    ui_requested_provider: requestPayload?.ui_requested_provider || requestedProvider || fallbackProvider || 'unknown',
    request_side_selected_provider: requestPayload?.request_side_selected_provider || requestedProvider || fallbackProvider || 'unknown',
    router_selected_provider: requestPayload?.routeDecision?.selectedProvider || selectedProvider || fallbackProvider || 'unknown',
    requested_provider_intent: requestPayload?.routeDecision?.defaultProvider || fallbackProvider || selectedProvider || 'unknown',
    freshness_candidate_provider: requestPayload?.routeDecision?.freshnessCandidateProvider || null,
    execution_requested_provider: requestedProvider || fallbackProvider || 'unknown',
    requested_provider_for_request: requestedProvider || fallbackProvider || 'unknown',
    backend_default_provider: 'unknown',
    route_mode: requestPayload?.routeMode || 'auto',
    effective_route_mode: requestPayload?.routeMode || 'auto',
    requested_provider: requestedProvider || fallbackProvider || 'unknown',
    selected_provider: requestPayload?.routeDecision?.selectedProvider || selectedProvider || fallbackProvider || 'unknown',
    execution_selected_provider: selectedProvider || fallbackProvider || 'unknown',
    executable_provider: selectedProvider || fallbackProvider || 'unknown',
    actual_provider_used: selectedProvider || fallbackProvider || 'unknown',
    actual_model_used: postGovernorModel,
    model_used: postGovernorModel,
    fallback_provider_used: null,
    provider_override_reason: requestPayload?.provider_override_reason || null,
    ollama_load_mode: selectedProvider === 'ollama' ? (ollamaLoadGovernor?.ollamaLoadMode || ollamaLoadMode || 'balanced') : null,
    ollama_load_policy_applied: selectedProvider === 'ollama' ? Boolean(ollamaLoadGovernor?.policyApplied) : false,
    ollama_load_policy_reason: selectedProvider === 'ollama' ? (ollamaLoadGovernor?.policyReason || null) : null,
    ollama_heavy_model_requested: selectedProvider === 'ollama' ? Boolean(ollamaLoadGovernor?.heavyModelRequested) : false,
    ollama_heavy_model_allowed: selectedProvider === 'ollama' ? (ollamaLoadGovernor?.heavyModelAllowed ?? null) : null,
    ollama_model_before_load_policy: ollamaModelBeforeLoadPolicy,
    ollama_model_after_load_policy: ollamaModelAfterLoadPolicy,
    ollama_timeout_ms: selectedProvider === 'ollama'
      ? (timeoutDetails.providerTimeoutMs ?? canonicalTimeoutPolicy.providerTimeoutMs ?? null)
      : null,
    ollama_timeout_source: selectedProvider === 'ollama'
      ? (timeoutDetails.timeoutPolicySource || canonicalTimeoutPolicy.timeoutPolicySource || null)
      : null,
    ollama_timeout_model: selectedProvider === 'ollama'
      ? (timeoutDetails.timeoutModel || canonicalTimeoutPolicy.timeoutModel || requestedModel || null)
      : null,
    ui_request_timeout_ms: inactivityTimeoutTriggered
      ? null
      : (timeoutDetails.timeoutMs ?? timeoutDetails.uiRequestTimeoutMs ?? canonicalTimeoutPolicy.uiRequestTimeoutMs ?? null),
    ui_stream_inactivity_timeout_ms: inactivityTimeoutTriggered ? (timeoutDetails.timeoutMs ?? null) : null,
    backend_route_timeout_ms: timeoutDetails.backendRouteTimeoutMs ?? canonicalTimeoutPolicy.backendRouteTimeoutMs ?? null,
    provider_timeout_ms: timeoutDetails.providerTimeoutMs ?? canonicalTimeoutPolicy.providerTimeoutMs ?? null,
    model_timeout_ms: timeoutDetails.modelTimeoutMs ?? canonicalTimeoutPolicy.modelTimeoutMs ?? null,
    timeout_policy_source: timeoutDetails.timeoutPolicySource || canonicalTimeoutPolicy.timeoutPolicySource || null,
    timeout_effective_provider: timeoutDetails.timeoutProvider || selectedProvider || null,
    timeout_effective_model: timeoutDetails.timeoutModel || canonicalTimeoutPolicy.timeoutModel || postGovernorModel || null,
    timeout_override_applied: Boolean(
      timeoutDetails.timeoutOverrideApplied
      ?? canonicalTimeoutPolicy.timeoutOverrideApplied
      ?? false,
    ),
    timeout_failure_layer: timeoutDetails.timeoutFailureLayer || null,
    timeout_failure_label: timeoutDetails.timeoutLabel || null,
    streaming_mode_preference: streamingModePreference,
    streaming_mode_preference_input: streamingModePreferenceInput,
    streaming_mode_preference_rehydrated: Boolean(requestPayload?.streaming_mode_preference_rehydrated ?? false),
    streaming_persistence_source: requestPayload?.streaming_persistence_source || 'default/auto',
    streaming_persistence_updated_at: requestPayload?.streaming_persistence_updated_at || null,
    streaming_requested: streamingRequested || streamingRequestAllowed,
    streaming_request_source: streamingRequestSource,
    streaming_policy_decision: streamingPolicyDecision,
    streaming_policy_reason: timeoutStreamingPolicyDecision?.streamingPolicyReason || requestPayload?.streaming_policy_reason || null,
    streaming_supported: streamingSupported,
    streaming_used: Boolean(timeoutDetails.streamingUsed ?? false),
    streaming_entered_backend: Boolean(timeoutDetails.streamingEnteredBackend ?? streamingRequested),
    streaming_client_opened: Boolean(timeoutDetails.streamingClientOpened ?? false),
    streaming_first_event_received: Boolean(timeoutDetails.streamingFirstEventReceived ?? false),
    streaming_inactivity_timeout_ms: timeoutDetails.streamingInactivityTimeoutMs
      ?? (inactivityTimeoutTriggered ? (timeoutDetails.timeoutMs ?? null) : null),
    streaming_last_event_at: timeoutDetails.streamingLastEventAt ?? null,
    streaming_failure_phase: timeoutDetails.streamingFailurePhase || null,
    streaming_provider: streamingSupported ? 'ollama' : null,
    streaming_model: streamingSupported ? (postGovernorModel || null) : null,
    streaming_finalized: false,
    streaming_fallback_reason: timeoutDetails.streamingFallbackReason
      || (streamingRequested && !streamingSupported ? 'provider-streaming-not-enabled' : null),
    execution_cancelled: cancelled,
    cancellation_source: cancellationSource,
    provider_cancelled: cancelled,
    provider_cancel_reason: cancelled ? `frontend abort propagated (${cancellationSource || 'unknown'})` : null,
    ollama_abort_sent: cancelled && selectedProvider === 'ollama',
    ui_timeout_triggered: uiTimeoutTriggered,
    backend_timeout_triggered: timeoutDetails.timeoutFailureLayer === 'backend' || timeoutDetails.timeoutFailureLayer === 'provider',
    abort_signal_created: true,
    abort_signal_fired: cancelled || uiTimeoutTriggered,
    abort_forwarded_to_router: cancelled || uiTimeoutTriggered,
    abort_forwarded_to_provider: cancelled || uiTimeoutTriggered,
    abort_forwarded_to_ollama_fetch: selectedProvider === 'ollama' && (cancelled || uiTimeoutTriggered),
    ollama_fetch_aborted: selectedProvider === 'ollama' && (cancelled || uiTimeoutTriggered),
    ollama_reader_cancelled: selectedProvider === 'ollama' && Boolean(timeoutDetails.ollamaReaderCancelled ?? cancelled),
    provider_generation_still_running_unknown: selectedProvider === 'ollama'
      && (cancelled || uiTimeoutTriggered || timeoutDetails.errorCode === 'STREAM_FINALIZATION_MISSING'),
    provider_generation_confirmed_stopped: false,
    cancellation_effectiveness: selectedProvider === 'ollama'
      ? ((cancelled || uiTimeoutTriggered) ? 'attempted-unknown' : 'not-attempted')
      : (cancelled ? 'attempted-confirmed' : 'not-attempted'),
    fallback_used: false,
    fallback_reason: null,
    freshness_need: requestPayload?.freshnessContext?.freshnessNeed || 'low',
    freshness_reason: requestPayload?.freshnessContext?.freshnessReason || 'n/a',
    stale_risk: requestPayload?.freshnessContext?.staleRisk || 'low',
    selected_answer_mode: requestPayload?.routeDecision?.selectedAnswerMode || 'local-private',
    override_denial_reason: requestPayload?.routeDecision?.overrideDeniedReason || null,
    freshness_warning: requestPayload?.routeDecision?.freshnessWarning || null,
    freshness_routed: Boolean(requestPayload?.routeDecision?.freshnessRouted ?? false),
    ai_policy_mode: requestPayload?.routeDecision?.aiPolicy?.aiPolicyMode || 'local-first-cloud-when-needed',
    ai_policy_reason: requestPayload?.routeDecision?.policyReason || 'Local-first policy applied.',
    execution_provider_policy_source: requestPayload?.routeDecision?.executionProviderPolicySource || 'freshness-routing-policy',
    execution_provider_policy_reason: requestPayload?.routeDecision?.executionProviderPolicyReason || null,
  };
}

function buildPreArmTimeoutExecutionEnvelope({
  routeDecision = {},
  runtimeStatus = {},
  requestedProvider = '',
  providerConfigs = {},
  ollamaLoadMode = 'balanced',
  prompt = '',
} = {}) {
  const canonicalRouteTruth = runtimeStatus?.canonicalRouteRuntimeTruth || {};
  const finalRouteTruth = runtimeStatus?.finalRouteTruth || {};
  const requestDispatchGate = routeDecision?.requestDispatchGate || {};
  const selectedAnswerMode = String(
    requestDispatchGate.selectedAnswerMode
    || routeDecision?.selectedAnswerMode
    || '',
  ).trim().toLowerCase();
  const localRouteViable = requestDispatchGate.localRouteViable ?? routeDecision?.localRouteAvailable ?? null;
  const cloudRouteViable = requestDispatchGate.cloudRouteViable ?? routeDecision?.cloudRouteAvailable ?? null;
  const requestedProviderNormalized = String(requestedProvider || '').trim().toLowerCase();
  const canonicalExecutionProvider = String(
    finalRouteTruth?.executedProvider
    || canonicalRouteTruth?.executedProvider
    || finalRouteTruth?.selectedProvider
    || canonicalRouteTruth?.selectedProvider
    || '',
  ).trim().toLowerCase();
  const modeReconciledProvider = (selectedAnswerMode === 'local-private' || selectedAnswerMode === 'fallback-stale-risk')
    && localRouteViable === true
    ? 'ollama'
    : (
      (selectedAnswerMode === 'fresh-cloud' || selectedAnswerMode === 'cloud-basic')
      && cloudRouteViable === true
        ? String(routeDecision?.requestedProviderForRequest || routeDecision?.selectedProvider || '').trim().toLowerCase()
        : ''
    );
  const effectiveProvider = canonicalExecutionProvider
    || modeReconciledProvider
    || String(routeDecision?.requestedProviderForRequest || '').trim().toLowerCase()
    || requestedProviderNormalized;
  const requestedExecutionModel = String(providerConfigs?.[effectiveProvider]?.model || '').trim();
  const ollamaLoadPreview = effectiveProvider === 'ollama'
    ? resolveOllamaLoadGovernorPolicy({
      ollamaLoadMode,
      requestedModel: requestedExecutionModel,
      prompt,
      forceHeavyModel: routeDecision?.operatorForceHeavyLocal === true,
      availableModels: [],
    })
    : null;
  const effectiveModel = effectiveProvider === 'ollama'
    ? String(ollamaLoadPreview?.modelAfterPolicy || requestedExecutionModel || '').trim()
    : requestedExecutionModel;

  return {
    requestedProvider: requestedProviderNormalized || requestedProvider || '',
    effectiveProvider: effectiveProvider || requestedProviderNormalized || requestedProvider || '',
    effectiveModel: effectiveModel || null,
    ollamaLoadMode: effectiveProvider === 'ollama' ? (ollamaLoadPreview?.ollamaLoadMode || ollamaLoadMode || 'balanced') : null,
  };
}

export function useAIConsole() {
  const [input, setInput] = useState('');
  const [aiActionState, setAiActionState] = useState({
    mode: '',
    isRunning: false,
    output: '',
    error: '',
    missingContext: [],
    generatedAt: '',
    contextPreview: null,
    requestedProvider: '',
    selectedProvider: '',
    executedProvider: '',
    fallbackUsed: null,
  });
  const {
    commandHistory,
    setCommandHistory,
    setIsBusy,
    setStatus,
    setLastRoute,
    setDebugData,
    setApiStatus,
    provider,
    routeMode,
    streamingMode,
    ollamaLoadMode,
    streamingModePreferenceRehydrated,
    streamingPersistenceSource,
    streamingPersistenceUpdatedAt,
    devMode,
    fallbackEnabled,
    fallbackOrder,
    disableHomeNodeForLocalSession,
    providerSelectionSource,
    getActiveProviderConfigSource,
    getEffectiveProviderConfigs,
    hostedCloudCognition,
    setHostedCloudCognitionHealth,
    getDraftProviderConfig,
    updateDraftProviderConfig,
    ollamaConnection,
    rememberSuccessfulOllamaConnection,
    homeNodePreference,
    homeNodeLastKnown,
    setHomeNodeLastKnown,
    setHomeNodeStatus,
    providerHealth,
    apiStatus,
    setProviderHealth,
    lastExecutionMetadata,
    setLastExecutionMetadata,
    missionPacketWorkflow,
    missionLineage,
    applyMissionPacketWorkflowAction,
    applyMissionLineageAction,
    setWorkingMemory,
    workingMemory,
    addHostedStagedItem,
    uiLayout,
    paneLayout,
    runtimeStatusModel,
    setUiDiagnostics,
    debugData,
    reportSurfaceFriction,
    setSurfaceOverride,
    explainMemoryToOperator,
  } = useAIStore();

  const runtimeConfigKey = getApiRuntimeConfigSnapshotKey();
  useEffect(() => {
    const profile = readOperatorProfile();
    setLastExecutionMetadata((prev = {}) => ({
      ...prev,
      chat_context_operator_name_known: profile.known ? 'yes' : 'no',
      chat_context_operator_name: profile.known ? profile.operatorName : 'unknown',
      chat_context_operator_identity_source: profile.source || 'none',
      chat_context_operator_identity_confidence: profile.confidence || 'unknown',
      chat_context_operator_identity_updated_at: profile.updatedAt || 'unknown',
      chat_context_operator_identity_next_action: profile.nextAction || 'Ask operator for preferred name when relevant.',
      chat_context_operator_profile_rehydrated: profile.rehydrated ? 'yes' : 'no',
      chat_context_operator_profile_storage_key: profile.storageKey || 'stephanos.operator.profile.v1',
      chat_context_operator_profile_storage_read_status: profile.storageReadStatus || 'missing',
      chat_context_operator_profile_last_read_at: profile.lastReadAt || 'unknown',
      chat_context_operator_profile_last_write_at: profile.lastWriteAt || 'unknown',
      raw_transcript_stored: 'no',
    }));
  }, [setLastExecutionMetadata]);

  const runtimeConfig = useMemo(() => getApiRuntimeConfig(), [runtimeConfigKey]);
  const hostedCloudConfigOverlay = useMemo(() => ({
    enabled: hostedCloudCognition?.enabled === true,
    selectedProvider: String(hostedCloudCognition?.selectedProvider || 'groq').trim().toLowerCase(),
    proxyUrl: '',
    providerProxyUrls: {
      groq: String(hostedCloudCognition?.providers?.groq?.baseURL || '').trim(),
      gemini: String(hostedCloudCognition?.providers?.gemini?.baseURL || '').trim(),
    },
    providers: {
      groq: {
        enabled: hostedCloudCognition?.providers?.groq?.enabled !== false,
        baseURL: String(hostedCloudCognition?.providers?.groq?.baseURL || '').trim(),
        model: String(hostedCloudCognition?.providers?.groq?.model || '').trim(),
      },
      gemini: {
        enabled: hostedCloudCognition?.providers?.gemini?.enabled !== false,
        baseURL: String(hostedCloudCognition?.providers?.gemini?.baseURL || '').trim(),
        model: String(hostedCloudCognition?.providers?.gemini?.model || '').trim(),
      },
    },
    lastHealth: {
      groq: hostedCloudCognition?.lastHealth?.groq || {},
      gemini: hostedCloudCognition?.lastHealth?.gemini || {},
    },
    chatPath: String(hostedCloudCognition?.chatPath || '/api/ai/chat').trim() || '/api/ai/chat',
    backendOnlySecrets: true,
  }), [hostedCloudCognition]);
  const startupOllamaSyncAttemptedRef = useRef(false);

  const healthRefreshInFlightRef = useRef(false);
  const healthRefreshBackoffUntilMsRef = useRef(0);
  const runtimeGovernorRef = useRef(null);
  const runtimeGovernorStateRef = useRef({ mode: 'passive', leader: false, hidden: false, reason: 'startup', duplicateTabDetected: false, lastGovernorHeartbeat: '' });
  const activePromptRequestRef = useRef(null);
  const providerHealthRef = useRef(providerHealth);
  const hostedCloudLastHealthRef = useRef(hostedCloudCognition?.lastHealth || {});
  const refreshHealthRef = useRef(null);
  const effectiveProviderConfigs = useMemo(() => getEffectiveProviderConfigs(), [getEffectiveProviderConfigs]);
  const ollamaDraftConfig = effectiveProviderConfigs.ollama || {};
  const ollamaHealth = providerHealth.ollama || {};

  useEffect(() => {
    providerHealthRef.current = providerHealth;
  }, [providerHealth]);

  useEffect(() => {
    hostedCloudLastHealthRef.current = hostedCloudCognition?.lastHealth || {};
  }, [hostedCloudCognition?.lastHealth]);

  const buildRuntimeContextFromHealth = useCallback((resolvedRuntimeContext, health = {}) => {
    const backendBaseUrl = health.baseUrl || resolvedRuntimeContext.baseUrl || resolvedRuntimeContext.apiBaseUrl || '';
    const frontendHost = extractHostname(resolvedRuntimeContext.frontendOrigin);
    const backendHost = extractHostname(backendBaseUrl);
    const localDesktopSession = isLoopbackHost(frontendHost);
    const adoptedHomeNode = adoptRemoteHomeNodeFromHealth(resolvedRuntimeContext, health);
    const compatibleBackendBaseUrl = resolveCompatibleTarget(
      backendBaseUrl,
      adoptedHomeNode.homeNode?.backendUrl || resolvedRuntimeContext.homeNode?.backendUrl || resolvedRuntimeContext.baseUrl || resolvedRuntimeContext.apiBaseUrl || '',
      { allowLoopback: localDesktopSession },
    );
    const nodeAddressSource = localDesktopSession
      ? 'local-backend-session'
      : (adoptedHomeNode.nodeAddressSource || resolvedRuntimeContext.nodeAddressSource || health.data?.client_route_source || resolvedRuntimeContext.homeNode?.source || 'route-diagnostics');
    const publishedBackendBaseUrl = String(health.data?.published_backend_base_url || '').trim();
    const preferredTarget = localDesktopSession && compatibleBackendBaseUrl
      ? compatibleBackendBaseUrl
      : resolveCompatibleTarget(
        adoptedHomeNode.actualTargetUsed || adoptedHomeNode.preferredTarget || resolvedRuntimeContext.actualTargetUsed,
        publishedBackendBaseUrl
          || adoptedHomeNode.homeNode?.backendUrl
          || resolvedRuntimeContext.homeNode?.backendUrl
          || resolvedRuntimeContext.baseUrl
          || resolvedRuntimeContext.apiBaseUrl,
        { allowLoopback: localDesktopSession },
      );
    const actualTargetUsed = resolveCompatibleTarget(
      adoptedHomeNode.actualTargetUsed || compatibleBackendBaseUrl,
      resolvedRuntimeContext.actualTargetUsed || adoptedHomeNode.homeNode?.backendUrl || resolvedRuntimeContext.homeNode?.backendUrl || '',
      { allowLoopback: localDesktopSession },
    );
    const baseRouteDiagnostics = { ...(resolvedRuntimeContext.routeDiagnostics || {}) };
    if (localDesktopSession) {
      delete baseRouteDiagnostics['home-node'];
    } else {
      delete baseRouteDiagnostics['local-desktop'];
    }

    return {
      ...resolvedRuntimeContext,
      apiBaseUrl: compatibleBackendBaseUrl,
      backendBaseUrl: compatibleBackendBaseUrl,
      baseUrl: compatibleBackendBaseUrl,
      homeNode: adoptedHomeNode.homeNode || resolvedRuntimeContext.homeNode || null,
      preferredTarget,
      actualTargetUsed,
      nodeAddressSource,
      publishedClientRouteState: health.data?.client_route_state || resolvedRuntimeContext.publishedClientRouteState || 'unknown',
      restoreDecision: !localDesktopSession && isLoopbackHost(backendHost)
        ? 'Ignored loopback backend target for non-local session; using current home-node/network context instead.'
        : (resolvedRuntimeContext.restoreDecision || ''),
      routeDiagnostics: {
        ...baseRouteDiagnostics,
        ...(localDesktopSession && resolvedRuntimeContext.homeNodeOperatorOverrideActive ? {
          'home-node': {
            configured: Boolean(resolvedRuntimeContext.homeNodeOperatorOverrideNodeConfigured),
            available: false,
            misconfigured: false,
            target: resolvedRuntimeContext.homeNode?.backendUrl || '',
            actualTarget: '',
            source: 'local-operator-override',
            reason: 'Home-node route source ignored due to local operator override.',
            blockedReason: 'Force Local On This PC is enabled for this browser session.',
          },
        } : {}),
        ...(!localDesktopSession && adoptedHomeNode.homeNode ? (() => {
          const backendReachable = Boolean(health.ok);
          const uiReachable = resolveUiReachabilityFromHealth(health);
          const usabilityTruth = summarizeHomeNodeUsabilityTruth({ backendReachable, uiReachable, source: nodeAddressSource });
          return {
            'home-node': {
              configured: true,
              available: usabilityTruth.usable,
              backendReachable: usabilityTruth.backendReachable,
              uiReachable: usabilityTruth.uiReachable,
              usable: usabilityTruth.usable,
              fallbackActive: usabilityTruth.fallbackActive,
              misconfigured: false,
              target: actualTargetUsed,
              actualTarget: actualTargetUsed,
              source: nodeAddressSource,
              reason: usabilityTruth.routeReason,
              blockedReason: usabilityTruth.operatorReason,
              routeReason: usabilityTruth.routeReason,
              operatorReason: usabilityTruth.operatorReason,
            },
          };
        })() : {}),
        ...(localDesktopSession ? {
          'local-desktop': {
            configured: true,
            available: Boolean(health.ok),
            misconfigured: false,
            target: backendBaseUrl,
            actualTarget: backendBaseUrl,
            source: 'local-backend-session',
            reason: health.ok
              ? (resolvedRuntimeContext.homeNodeOperatorOverrideActive
                ? 'Backend online locally; home-node route source ignored by operator override.'
                : 'Backend online locally; provider/router is using the live local-desktop backend session')
              : 'Local desktop session detected, but the backend is offline',
            blockedReason: health.ok ? '' : 'backend is offline',
          },
        } : {}),
      },
    };
  }, []);

  const finalizeRuntimeContext = useCallback((runtimeContext, nextProviderHealth = providerHealth, backendAvailableOverride = undefined) => {
    const runtimeStatus = createRuntimeStatusModel({
      appId: 'stephanos',
      appName: 'Stephanos Mission Console',
      validationState: backendAvailableOverride === false ? 'error' : 'healthy',
      selectedProvider: provider,
      routeMode,
      fallbackEnabled,
      fallbackOrder,
      providerHealth: nextProviderHealth,
      backendAvailable: backendAvailableOverride ?? apiStatus.backendReachable,
      runtimeContext,
      activeProviderHint: lastExecutionMetadata?.actual_provider_used || '',
    });

    return {
      runtimeStatus,
      runtimeContext: runtimeStatus.runtimeContext,
    };
  }, [
    apiStatus.backendReachable,
    fallbackEnabled,
    fallbackOrder,
    lastExecutionMetadata?.actual_provider_used,
    provider,
    providerHealth,
    routeMode,
  ]);

  const resolveRuntimeConfig = useCallback(async () => {
    const baseRuntimeConfig = {
      ...getApiRuntimeConfig(),
      hostedCloudConfig: hostedCloudConfigOverlay,
    };
    const localDesktopSession = isLoopbackHost(extractHostname(baseRuntimeConfig.frontendOrigin));
    const shouldIgnoreHomeNodeForThisSession = localDesktopSession && disableHomeNodeForLocalSession;
    const effectiveManualNode = shouldIgnoreHomeNodeForThisSession ? null : homeNodePreference;
    const effectiveLastKnownNode = shouldIgnoreHomeNodeForThisSession ? null : homeNodeLastKnown;
    const discovery = await discoverStephanosHomeNode({
      currentOrigin: baseRuntimeConfig.frontendOrigin,
      manualNode: effectiveManualNode,
      lastKnownNode: effectiveLastKnownNode,
      recentHosts: [
        ollamaConnection.lastSuccessfulHost,
        ...(ollamaConnection.recentHosts || []),
      ].filter(Boolean),
    });

    const homeNodeConfigured = Boolean(homeNodePreference?.host || homeNodeLastKnown?.host);

    const unreachableDetail = homeNodeConfigured
      ? `${discovery.message || 'Home PC node unreachable right now.'} Candidates: ${discovery.attemptSummary || summarizeDiscoveryAttempts(discovery.attempts)} Action: ${discovery.operatorAction || 'Set manual home node to a reachable LAN backend host/IP:port.'} Fallback: ${discovery.fallback?.rule || 'no candidates were reachable; runtime context fell back to current origin.'}`
      : 'No home PC node configured yet.';

    setHomeNodeStatus({
      state: discovery.reachable
        ? 'ready'
        : localDesktopSession
          ? 'optional'
          : (homeNodeConfigured ? 'unreachable' : 'idle'),
      detail: discovery.reachable
        ? `Using ${summarizeStephanosHomeNode(discovery.preferredNode)}.`
        : shouldIgnoreHomeNodeForThisSession
          ? (homeNodeConfigured
            ? 'Home-node route source ignored by local operator override; local desktop routing is active.'
            : 'Local operator override is active; local desktop routing is active.')
        : localDesktopSession
          ? (homeNodeConfigured
            ? 'Home PC node is optional on this local desktop session; local Stephanos routes remain valid when available.'
            : 'Home PC node is optional on this local desktop session.')
          : unreachableDetail,
      attempts: discovery.attempts,
      node: shouldIgnoreHomeNodeForThisSession ? null : discovery.preferredNode,
      source: shouldIgnoreHomeNodeForThisSession
        ? 'local-operator-override'
        : (discovery.source || (localDesktopSession ? 'local-browser-session' : 'route-diagnostics')),
      fallback: discovery.fallback || null,
    });

    if (!shouldIgnoreHomeNodeForThisSession && discovery.preferredNode) {
      setHomeNodeLastKnown(discovery.preferredNode);
    }

    const nextRuntimeConfig = {
      ...getApiRuntimeConfig(),
      hostedCloudConfig: hostedCloudConfigOverlay,
    };
    const localDesktopBackendUrl = resolveLocalDesktopBackendBaseUrl(nextRuntimeConfig.frontendOrigin);
    const effectiveRuntimeBaseUrl = shouldIgnoreHomeNodeForThisSession
      ? localDesktopBackendUrl
      : nextRuntimeConfig.baseUrl;
    const compatibleBackendBaseUrl = resolveCompatibleTarget(
      effectiveRuntimeBaseUrl,
      discovery.preferredNode?.backendUrl || nextRuntimeConfig.homeNode?.backendUrl || '',
      { allowLoopback: localDesktopSession },
    );
    const localBackendSession = localDesktopSession;
    const preferredTarget = localBackendSession
      ? compatibleBackendBaseUrl
      : resolveCompatibleTarget(
        discovery.preferredNode?.backendUrl || nextRuntimeConfig.homeNode?.backendUrl || '',
        compatibleBackendBaseUrl,
        { allowLoopback: localDesktopSession },
      );
    return {
      runtimeConfig: {
        ...nextRuntimeConfig,
        apiBaseUrl: compatibleBackendBaseUrl,
        backendBaseUrl: compatibleBackendBaseUrl,
        baseUrl: compatibleBackendBaseUrl,
        homeNode: shouldIgnoreHomeNodeForThisSession
          ? (nextRuntimeConfig.homeNode || homeNodePreference || homeNodeLastKnown || null)
          : (discovery.preferredNode || nextRuntimeConfig.homeNode || homeNodePreference || homeNodeLastKnown || null),
        nodeAddressSource: localBackendSession
          ? (shouldIgnoreHomeNodeForThisSession ? 'local-backend-session:operator-override' : 'local-backend-session')
          : (discovery.preferredNode?.source || discovery.source || nextRuntimeConfig.homeNode?.source || 'route-diagnostics'),
        preferredTarget,
        actualTargetUsed: resolveCompatibleTarget(
          discovery.preferredNode?.backendUrl || nextRuntimeConfig.homeNode?.backendUrl || '',
          compatibleBackendBaseUrl,
          { allowLoopback: localDesktopSession },
        ),
        restoreDecision: !localDesktopSession && isLoopbackHost(extractHostname(nextRuntimeConfig.baseUrl))
          ? 'Ignored loopback backend target for non-local session; using current home-node/network context instead.'
          : (shouldIgnoreHomeNodeForThisSession
            ? 'Home-node/manual route source ignored for this local browser session by operator override.'
            : ''),
        homeNodeOperatorOverrideActive: shouldIgnoreHomeNodeForThisSession,
        homeNodeOperatorOverrideNodeConfigured: homeNodeConfigured,
      },
      discovery,
    };
  }, [homeNodeLastKnown, homeNodePreference, ollamaConnection.lastSuccessfulHost, ollamaConnection.recentHosts, setHomeNodeLastKnown, setHomeNodeStatus, disableHomeNodeForLocalSession, hostedCloudConfigOverlay]);


  const refreshHealth = useCallback(async ({ force = false } = {}) => {
    recordPerfCounter('polling', force ? 'refreshHealth.force' : 'refreshHealth.interval');
    const governor = runtimeGovernorStateRef.current;
    const nowMs = Date.now();
    if (!force && (governor.mode === 'standby' || governor.mode === 'hidden')) {
      recordPerfCounter('polling', 'refreshHealth.skip_governor');
      return;
    }
    if (!force && nowMs < healthRefreshBackoffUntilMsRef.current) {
      recordPerfCounter('polling', 'refreshHealth.skip_backoff');
      return;
    }
    if (healthRefreshInFlightRef.current) {
      recordPerfCounter('polling', 'refreshHealth.skip_in_flight');
      return;
    }
    healthRefreshInFlightRef.current = true;
    let resolvedRuntimeContext = runtimeConfig;

    try {
      ({ runtimeConfig: resolvedRuntimeContext } = await resolveRuntimeConfig());
      recordPerfCounter('polling', 'checkApiHealth.attempt');
      const health = await checkApiHealth(resolvedRuntimeContext);
      const hydratedRuntimeContext = buildRuntimeContextFromHealth(resolvedRuntimeContext, health);
      const providerHealth = await getProviderHealth({ provider, routeMode, providerConfigs: effectiveProviderConfigs, fallbackEnabled, fallbackOrder, devMode, runtimeContext: hydratedRuntimeContext }, hydratedRuntimeContext);
      const nextProviderHealth = providerHealth.data || {};
      setProviderHealth(nextProviderHealth);
      recordPerfCounter('store_writes', 'providerHealth');
      ['groq', 'gemini'].forEach((providerKey) => {
        const health = nextProviderHealth?.[providerKey] || {};
        const ok = health.ok === true;
        setHostedCloudCognitionHealth(providerKey, {
          status: ok ? 'healthy' : (health.detail ? 'unhealthy' : 'unknown'),
          reason: String(health.detail || health.reason || (ok ? 'Provider reachable.' : 'No provider health data yet.')),
          checkedAt: new Date().toISOString(),
          lastSuccessAt: ok ? new Date().toISOString() : (hostedCloudLastHealthRef.current?.[providerKey]?.lastSuccessAt || ''),
          lastFailureAt: ok ? (hostedCloudLastHealthRef.current?.[providerKey]?.lastFailureAt || '') : new Date().toISOString(),
        });
      });
      const finalized = finalizeRuntimeContext(hydratedRuntimeContext, nextProviderHealth, health.ok);
      if (finalized.runtimeContext.homeNode?.reachable && !isLoopbackHost(extractHostname(finalized.runtimeContext.frontendOrigin))) {
        setHomeNodeLastKnown(finalized.runtimeContext.homeNode);
        setHomeNodeStatus({
          state: 'ready',
          detail: `Using ${summarizeStephanosHomeNode(finalized.runtimeContext.homeNode)}.`,
          attempts: [],
          node: finalized.runtimeContext.homeNode,
          source: finalized.runtimeContext.nodeAddressSource || finalized.runtimeContext.homeNode.source || 'route-diagnostics',
        });
      }
      setApiStatus({
        state: health.ok ? 'online' : 'error',
        label: `Connected to ${health.target} API`,
        detail: health.ok
          ? `Backend reachable. Default provider: ${health.data?.default_provider || 'mock'}.`
          : `Health check failed (${health.status}).`,
        target: health.target,
        baseUrl: health.baseUrl,
        frontendOrigin: finalized.runtimeContext.frontendOrigin,
        strategy: finalized.runtimeContext.strategy,
        backendTargetEndpoint: health.data?.backend_target_endpoint || finalized.runtimeContext.backendTargetEndpoint,
        healthEndpoint: finalized.runtimeContext.healthEndpoint,
        backendReachable: health.ok,
        backendDefaultProvider: health.data?.default_provider || 'mock',
        runtimeContext: {
          ...finalized.runtimeContext,
          healthProbeTruth: reconcileBackendHealthTruth({
            runtimeContext: finalized.runtimeContext,
            healthOk: health.ok === true,
            source: 'refresh-health-poll',
            status: health.status || 0,
            hadRouteUnavailableFailure: ['ROUTE_UNAVAILABLE', 'BACKEND_ROUTE_UNAVAILABLE'].includes(String(lastExecutionMetadata?.command_pipeline_last_failure_reason || '').trim().toUpperCase()),
          }),
        },
        lastCheckedAt: new Date().toISOString(),
        meta: {
          ...(health.data || {}),
          final_route: finalized.runtimeStatus.finalRoute,
        },
      });
      recordPerfCounter('store_writes', 'apiStatus');
    } catch (error) {
      recordPerfEvent('polling', 'checkApiHealth.error', error?.message || 'unknown');
      healthRefreshBackoffUntilMsRef.current = Date.now() + 30_000;
      const uiError = transportErrorToUi(error);
      const finalized = finalizeRuntimeContext(resolvedRuntimeContext, providerHealthRef.current, false);
      setApiStatus({
        state: 'offline',
        label: 'Backend offline',
        detail: uiError.output,
        target: resolvedRuntimeContext.target || runtimeConfig.target,
        baseUrl: resolvedRuntimeContext.baseUrl || runtimeConfig.baseUrl,
        frontendOrigin: resolvedRuntimeContext.frontendOrigin || runtimeConfig.frontendOrigin,
        strategy: resolvedRuntimeContext.strategy || runtimeConfig.strategy,
        backendTargetEndpoint: resolvedRuntimeContext.backendTargetEndpoint || runtimeConfig.backendTargetEndpoint,
        healthEndpoint: resolvedRuntimeContext.healthEndpoint || runtimeConfig.healthEndpoint,
        backendReachable: false,
        backendDefaultProvider: 'unknown',
        runtimeContext: {
          ...finalized.runtimeContext,
          healthProbeTruth: reconcileBackendHealthTruth({
            runtimeContext: finalized.runtimeContext,
            healthOk: false,
            source: 'refresh-health-poll',
            status: 0,
            hadRouteUnavailableFailure: ['ROUTE_UNAVAILABLE', 'BACKEND_ROUTE_UNAVAILABLE'].includes(String(lastExecutionMetadata?.command_pipeline_last_failure_reason || '').trim().toUpperCase()),
          }),
        },
        lastCheckedAt: new Date().toISOString(),
        meta: null,
      });
      recordPerfCounter('store_writes', 'apiStatus');
    } finally {
      healthRefreshInFlightRef.current = false;
    }
  }, [runtimeConfig, setApiStatus, provider, routeMode, effectiveProviderConfigs, fallbackEnabled, fallbackOrder, devMode, setProviderHealth, resolveRuntimeConfig, buildRuntimeContextFromHealth, setHomeNodeLastKnown, setHomeNodeStatus, finalizeRuntimeContext, setHostedCloudCognitionHealth, lastExecutionMetadata?.command_pipeline_last_failure_reason]);


  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const governor = createRuntimeWorkGovernor({
      onStateChange: (nextState) => {
        runtimeGovernorStateRef.current = nextState;
        setPerfIdentityField('runtimeGovernor.lastHeartbeat', String(nextState.lastGovernorHeartbeat || ''));
        setUiDiagnostics((previous) => {
          const changedFields = [];
          if (previous?.runtimeGovernorMode !== nextState.mode) changedFields.push('runtimeGovernorMode');
          if (previous?.runtimeGovernorLeader !== nextState.leader) changedFields.push('runtimeGovernorLeader');
          if (previous?.runtimeGovernorReason !== nextState.reason) changedFields.push('runtimeGovernorReason');
          if (previous?.duplicateTabDetected !== nextState.duplicateTabDetected) changedFields.push('duplicateTabDetected');
          if (previous?.hiddenTabThrottleActive !== nextState.hidden) changedFields.push('hiddenTabThrottleActive');

          if (changedFields.length === 0) {
            recordPerfCounter('store.notify.uiDiagnostics', 'runtimeGovernor.apply_skipped');
            return previous;
          }

          recordPerfCounter('store.notify.uiDiagnostics', 'runtimeGovernor.apply_changed');
          for (const fieldName of changedFields) {
            recordPerfCounter('store.notify.uiDiagnostics.runtimeGovernor.apply_changed', fieldName);
          }

          return {
            ...previous,
            runtimeGovernorMode: nextState.mode,
            runtimeGovernorLeader: nextState.leader,
            runtimeGovernorReason: nextState.reason,
            duplicateTabDetected: nextState.duplicateTabDetected,
            hiddenTabThrottleActive: nextState.hidden,
          };
        });
      },
    });
    runtimeGovernorRef.current = governor;
    governor.start();
    return () => governor.stop();
  }, [setUiDiagnostics]);

  useEffect(() => {
    refreshHealthRef.current = refreshHealth;
  }, [refreshHealth]);

  useEffect(() => {
    void refreshHealth({ force: true });
    // Intentionally execute only once at mount; interval and visibility handlers perform subsequent refreshes.
    // This prevents dependency churn from creating refresh feedback loops.
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    recordPerfCounter('timers', 'health_poll.effect_run');
    let intervalId = null;
    let currentCadenceMs = -1;

    const runRefresh = () => {
      recordPerfCounter('timers', 'health_poll.tick');
      void refreshHealthRef.current?.({ force: false });
    };

    const restartPolling = (reason = 'unknown') => {
      const nextCadenceMs = document.visibilityState === 'visible' ? 60_000 : 180_000;
      recordPerfCounter('timers', `health_poll.effect_restart_reason.${reason}`);
      if (intervalId != null && currentCadenceMs === nextCadenceMs) {
        recordPerfCounter('timers', 'health_poll.restart_skipped_same_cadence');
        return;
      }
      if (intervalId != null) {
        window.clearInterval(intervalId);
      }
      currentCadenceMs = nextCadenceMs;
      recordPerfEvent('timers', 'health_poll.restart', `${nextCadenceMs}`);
      intervalId = window.setInterval(runRefresh, nextCadenceMs);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        runRefresh();
      }
      restartPolling('visibilitychange');
    };

    restartPolling('mount');
    document.addEventListener('visibilitychange', handleVisibilityChange);
    recordPerfCounter('listeners', 'visibilitychange.health_poll.register');

    return () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      recordPerfCounter('listeners', 'visibilitychange.health_poll.cleanup');
    };
  }, []);

  useEffect(() => {
    if (startupOllamaSyncAttemptedRef.current) return;

    const shouldRunStartupDiscovery = shouldAutoSyncOllama({
      apiStatus,
      ollamaHealth,
      ollamaConfig: ollamaDraftConfig,
    });

    if (!shouldRunStartupDiscovery) {
      console.debug('[Stephanos UI] Startup Ollama discovery skipped', {
        backendReachable: apiStatus?.backendReachable,
        frontendOrigin: apiStatus?.frontendOrigin || runtimeConfig.frontendOrigin,
        ollamaHealthState: ollamaHealth?.state || 'unknown',
        ollamaLikelyWrongDevice: ollamaHealth?.likelyWrongDevice === true,
        configuredBaseUrl: ollamaDraftConfig?.baseURL || '',
      });
      return;
    }

    console.debug('[Stephanos UI] Startup Ollama discovery running', {
      backendReachable: apiStatus?.backendReachable,
      frontendOrigin: apiStatus?.frontendOrigin || runtimeConfig.frontendOrigin,
      configuredBaseUrl: ollamaDraftConfig?.baseURL || '',
    });

    startupOllamaSyncAttemptedRef.current = true;

    const startupSearchingHealth = createSearchingOllamaHealth({
      frontendOrigin: runtimeConfig.frontendOrigin,
    });

    setProviderHealth((prev) => ({
      ...prev,
      ollama: startupSearchingHealth,
    }));

    (async () => {
      const draftConfig = getDraftProviderConfig('ollama');
      const { result, searchingState } = await runOllamaDiscovery({
        runtimeConfig,
        ollamaConnection,
        draftConfig,
      });

      setProviderHealth((prev) => ({
        ...prev,
        ollama: {
          ...startupSearchingHealth,
          attempts: searchingState.attempts || [],
        },
      }));

      if (!result.success) {
        console.debug('[Stephanos UI] Startup Ollama discovery did not find a usable endpoint', {
          reason: result.reason || '',
          failureBucket: result.failureBucket || '',
          attempts: result.attempts || [],
        });
        setProviderHealth((prev) => ({
          ...prev,
          ollama: {
            ...(prev.ollama || {}),
            ok: false,
            provider: 'ollama',
            badge: 'Offline',
            state: 'OFFLINE',
            message: 'Cannot connect to Ollama',
            detail: result.reason || 'Stephanos could not reach your Ollama server.',
            reason: result.reason || '',
            failureType: result.failureBucket || 'not_running',
            attempts: result.attempts || [],
          },
        }));
        return;
      }

      console.debug('[Stephanos UI] Startup Ollama discovery detected an endpoint', {
        baseURL: result.baseURL,
        host: result.host,
        models: result.models || [],
      });

      applyDetectedOllamaConnection({
        result,
        draftConfig,
        ollamaConnection,
        updateDraftProviderConfig,
        rememberSuccessfulOllamaConnection,
      });

      const nextModel = result.models.includes(draftConfig.model)
        ? draftConfig.model
        : (result.models[0] || draftConfig.model || ollamaConnection.lastSelectedModel || '');
      const nextProviderConfigs = {
        ...effectiveProviderConfigs,
        ollama: {
          ...ollamaConfig,
          ...draftConfig,
          baseURL: result.baseURL,
          model: nextModel,
        },
      };

      const { runtimeConfig: resolvedRuntimeContext } = await resolveRuntimeConfig();
      const refreshedProviderHealth = await getProviderHealth({
        provider,
        routeMode,
        providerConfigs: nextProviderConfigs,
        fallbackEnabled,
        fallbackOrder,
        devMode,
        runtimeContext: resolvedRuntimeContext,
      }, resolvedRuntimeContext);

      if (refreshedProviderHealth.data && Object.keys(refreshedProviderHealth.data).length) {
        setProviderHealth((prev) => ({
          ...prev,
          ...refreshedProviderHealth.data,
        }));
      }
    })().catch(() => {
      startupOllamaSyncAttemptedRef.current = false;
    });
  }, [
    apiStatus,
    devMode,
    effectiveProviderConfigs,
    fallbackEnabled,
    fallbackOrder,
    getDraftProviderConfig,
    ollamaConnection,
    ollamaDraftConfig,
    ollamaHealth,
    provider,
    rememberSuccessfulOllamaConnection,
    resolveRuntimeConfig,
    runtimeConfig,
    setProviderHealth,
    updateDraftProviderConfig,
    routeMode,
  ]);

  async function submitPrompt(rawPrompt, { telemetryEntries = [], orchestrationTruth = null, submissionSource = 'stephanos-mission-console', submissionRoute = 'assistant-router' } = {}) {
    const prompt = rawPrompt.trim();
    if (!prompt) return { submitAccepted: false, inputCleared: false, restoreInput: true };
    if (prompt === '/clear') {
      clearConsole();
      return { submitAccepted: true, inputCleared: true, restoreInput: false };
    }

    const normalizedPrompt = prompt.toLowerCase();
    let submitAccepted = false;
    let submitAttempted = true;
    let submitBlockReason = 'none';
    let executeHandlerEarlyReturnReason = 'none';
    const executeInputPresent = prompt.length > 0;
    const executeInputLength = prompt.length;
    let commandEnvelopeBuildAttempted = 'no';
    let commandEnvelopeBuildError = 'none';
    let dispatchGateAllowed = 'unknown';
    let dispatchGateReason = 'none';
    let lastFinalizationPath = 'unknown';
    let executeStageLastReached = 'clicked';
    let executePhase = 'input-normalized';
    let executePhaseFailure = 'none';
    let preEnvelopePhaseSafe = 'yes';
    let preEnvelopeCapturesLateVariables = 'no';
    let envelopeBuildId = 'none';
    let userMessageRecordId = 'none';
    let executeStageFailureReason = 'none';
    let preEnvelopeExceptionName = 'none';
    let preEnvelopeExceptionMessage = 'none';
    let envelopeBuildSkippedReason = 'none';
    let userMessageRecordAttempted = 'no';
    let userMessageRecordError = 'none';
    let requestDispatchGate = null;
    let routeUnavailableOutcome = null;
    let providerDispatchResult = null;
    let streamEntryId = `cmd_${Date.now()}_stream`;
    let streamBuffer = '';
    const appendLocalOperatorEntry = (outputText) => {
      const entry = {
        id: `cmd_${Date.now()}`,
        raw_input: prompt,
        parsed_command: null,
        route: 'assistant',
        tool_used: 'local-operator-command',
        success: true,
        output_text: outputText,
        data_payload: null,
        timing_ms: 1,
        timestamp: new Date().toISOString(),
        error: null,
        error_code: null,
        response: { type: 'assistant_response', route: 'assistant', success: true, output_text: outputText },
      };
      setCommandHistory((prev) => appendCommandHistory(prev, entry));
      setLastRoute('assistant');
      setStatus('idle');
      // Local deterministic replies finalize before route dispatch state exists.
      // Keep submit acceptance independent from later routeUnavailableResult initialization.
      submitAccepted = true;
      lastFinalizationPath = 'deterministic-identity';
    };
    const runtimeSelectors = orchestrationTruth?.selectors || null;
    executeStageLastReached = 'input-normalized';
    executePhase = 'input-normalized';

    // Execute packet route map (operator input -> provider dispatch):
    // 1) AIConsole input state -> 2) Execute click handler -> 3) submitPrompt entry
    // 4) input normalization -> 5) submit acceptance metadata -> 6) user message record
    // 7) chat context pack build/use -> 8) response planner build/use -> 9) command envelope build
    // 10) request dispatch gate -> 11) backend target selection -> 12) /api/ai/chat dispatch
    // 13) provider selection/execution -> 14) final metadata normalization
    // 15) Support Snapshot projection -> 16) bottom/status widget projection.

    if (normalizedPrompt === 'what do you remember?' || normalizedPrompt === 'what do you remember') {
      const explanation = explainMemoryToOperator({ mode: 'summary' });
      appendLocalOperatorEntry(explanation.text);
      return;
    }
    if (normalizedPrompt === 'show more detail') {
      const explanation = explainMemoryToOperator({ mode: 'expanded' });
      appendLocalOperatorEntry(explanation.text);
      return;
    }
    if (normalizedPrompt === 'show full memory detail') {
      const explanation = explainMemoryToOperator({ mode: 'diagnostic' });
      appendLocalOperatorEntry(explanation.text);
      return;
    }
    if (normalizedPrompt === 'this is awkward' || normalizedPrompt === 'make this cleaner') {
      const event = reportSurfaceFriction({ userText: prompt, source: 'operator-text' });
      appendLocalOperatorEntry(`Captured friction as ${event.frictionType} (${event.subsystem}) with confidence ${event.confidence}. I will wait for recurrence before proposing behavior changes.`);
      return;
    }
    const replyPromptKey = resolveOperatorReplyPromptKey(normalizedPrompt);
    if (replyPromptKey === 'current-intent' || replyPromptKey === 'show-mission-packet') {
      const reply = buildOperatorReplyPayload({
        promptKey: replyPromptKey,
        orchestrationTruth,
        fallbackMissionSummary: workingMemory?.lastMissionPacketSummary || 'No mission packet summary stored yet.',
      });
      appendLocalOperatorEntry(reply.text || 'No mission packet summary stored yet.');
      return;
    }
    const packetTruth = normalizeMissionPacketTruth(lastExecutionMetadata || {});
    const lifecycleEnvelope = adjudicateOperatorLifecycleIntent({
      commandText: normalizedPrompt,
      selectors: runtimeSelectors || {},
      missionPacketWorkflow,
      missionLineage,
      packetTruth,
      now: new Date().toISOString(),
    });

    if (lifecycleEnvelope.status !== 'unsupported-command') {
      if (lifecycleEnvelope.workflow && lifecycleEnvelope.actionApplied === true && lifecycleEnvelope.workflowAction) {
        applyMissionPacketWorkflowAction(lifecycleEnvelope.workflowAction, packetTruth, new Date().toISOString());
      }
      const nextCanonicalMissionPacket = buildCanonicalMissionPacket({
        missionPacketTruth: packetTruth,
        missionPacketWorkflow: lifecycleEnvelope.workflow || missionPacketWorkflow,
      });
      const nextSelectors = deriveRuntimeOrchestrationSelectors({
        canonicalMissionPacket: nextCanonicalMissionPacket,
        missionPacketWorkflow: lifecycleEnvelope.workflow || missionPacketWorkflow,
      });
      const enrichedEnvelope = {
        ...lifecycleEnvelope,
        resultingLifecycleState: nextSelectors?.currentMissionState?.missionPhase || lifecycleEnvelope.resultingLifecycleState,
        resultingBuildAssistanceState: nextSelectors?.buildAssistanceReadiness?.state || lifecycleEnvelope.resultingBuildAssistanceState,
        nextRecommendedAction: nextSelectors?.nextRecommendedAction || lifecycleEnvelope.nextRecommendedAction,
      };
      const reply = buildOperatorReplyPayload({
        promptKey: replyPromptKey,
        orchestrationTruth: { selectors: nextSelectors || runtimeSelectors || {} },
        latestResponseEnvelope: enrichedEnvelope,
      });
      applyMissionLineageAction({
        packetTruth,
        selectors: nextSelectors || runtimeSelectors || {},
        envelope: enrichedEnvelope,
        now: new Date().toISOString(),
      });
      appendLocalOperatorEntry(reply.text || enrichedEnvelope.operatorMessage || 'No operator feedback available.');
      setDebugData((prev) => ({
        ...(prev || {}),
        latestOperatorCommandEnvelope: enrichedEnvelope,
      }));
      return;
    }

    if (replyPromptKey === 'what-build-next' || replyPromptKey === 'what-can-ai-do' || replyPromptKey === 'why-blocked') {
      const reply = buildOperatorReplyPayload({
        promptKey: replyPromptKey,
        orchestrationTruth,
        latestResponseEnvelope: debugData?.latestOperatorCommandEnvelope || null,
        fallbackMissionSummary: workingMemory?.lastMissionPacketSummary || 'No accepted mission packet exists yet.',
      });
      appendLocalOperatorEntry(reply.text || 'No operator guidance is currently available.');
      return;
    }
    if (normalizedPrompt === 'promote this to roadmap') {
      const reply = buildOperatorReplyPayload({
        promptKey: 'what-build-next',
        orchestrationTruth,
        fallbackMissionSummary: 'Use Mission Packet Queue controls: accept mission packet, then promote. Promotion remains approval-gated and explicit.',
      });
      appendLocalOperatorEntry(`Promotion remains approval-gated and explicit. ${reply.text}`);
      return;
    }
    if (normalizedPrompt === 'explain agent assignments' || normalizedPrompt === 'show execution plan' || normalizedPrompt === 'what tools would be used?') {
      const reply = buildOperatorReplyPayload({
        promptKey: 'what-can-ai-do',
        orchestrationTruth,
        latestResponseEnvelope: debugData?.latestOperatorCommandEnvelope || null,
      });
      appendLocalOperatorEntry(reply.text || 'Build assistance guidance is unavailable.');
      return;
    }

    const parsed = parseCommand(prompt);
    const selectedModel = String(effectiveProviderConfigs?.ollama?.model || '').trim().toLowerCase();
    const heavyOllamaRequest = String(provider || '').trim().toLowerCase() === 'ollama' && HEAVY_OLLAMA_MODELS.has(selectedModel);
    const previousGenerationUncertain = Boolean(lastExecutionMetadata?.provider_generation_still_running_unknown);
    if (heavyOllamaRequest && previousGenerationUncertain) {
      setCommandHistory((prev) => appendCommandHistory(prev, {
        id: `cmd_${Date.now()}`,
        raw_input: prompt,
        parsed_command: parsed,
        route: 'assistant',
        tool_used: null,
        success: false,
        output_text: 'Heavy Ollama request blocked: previous generation may still be running. Use Stop generating or Emergency release Ollama load, then retry after recovery is confirmed.',
        data_payload: null,
        timing_ms: 0,
        timestamp: new Date().toISOString(),
        error: 'Heavy request blocked for local resource safety.',
        error_code: 'OLLAMA_HEAVY_REQUEST_BLOCKED_PENDING_CANCELLATION_RECOVERY',
        response: null,
      }));
      setStatus('blocked');
      return { submitAccepted: true, inputCleared: true, restoreInput: false };
    }
    const startedAt = performance.now();
    setIsBusy(true);
    setStatus('processing');

    console.debug('[Stephanos UI] Preparing AI request', {
      requestedProvider: provider,
      selectedProvider: provider,
      providerConfigSource: getActiveProviderConfigSource(),
      providerSelectionSource,
      fallbackEnabled,
      fallbackOrder,
    });

    let activeRouteDecision = null;
    let inFlightRequestPayload = null;
    let inFlightRuntimeContext = null;
    const requestAbortController = new AbortController();
    activePromptRequestRef.current = requestAbortController;

    try {
      const { runtimeConfig: resolvedRuntimeContext } = await resolveRuntimeConfig();
      const submitHealth = await checkApiHealth(resolvedRuntimeContext).catch((error) => {
        console.warn('[Stephanos UI] Backend health probe failed at submit-time', {
          message: error?.message || 'unknown-error',
          code: error?.code || '',
        });
        return { ok: false, status: 0, data: null };
      });
      const submitHydratedRuntimeContext = submitHealth?.ok
        ? buildRuntimeContextFromHealth(resolvedRuntimeContext, submitHealth)
        : resolvedRuntimeContext;
      const liveOperatorReliefRuntimeContext = runtimeStatusModel?.runtimeContext || {};
      const submitRuntimeContextWithOperatorReliefBridge = {
        ...submitHydratedRuntimeContext,
        operatorReliefProjection: liveOperatorReliefRuntimeContext.operatorReliefProjection
          || submitHydratedRuntimeContext.operatorReliefProjection
          || null,
        operatorReliefBridgeDiagnostics: {
          ...(submitHydratedRuntimeContext.operatorReliefBridgeDiagnostics || {}),
          ...(liveOperatorReliefRuntimeContext.operatorReliefBridgeDiagnostics || {}),
        },
      };
      const finalizedRequestContext = finalizeRuntimeContext(
        submitRuntimeContextWithOperatorReliefBridge,
        providerHealth,
        submitHealth?.ok === true,
      ).runtimeContext;
      inFlightRuntimeContext = finalizedRequestContext;
      const requestBaselineRuntimeStatus = finalizeRuntimeContext(finalizedRequestContext).runtimeStatus;
      const routeTruthView = buildFinalRouteTruthView(requestBaselineRuntimeStatus);
      const continuityAllowed = routeTruthView.routeUsableState === 'yes' && routeTruthView.truthInconsistent !== true;
      const continuityLookup = continuityAllowed
        ? getContinuityContext({
          commandHistory,
          telemetryEntries,
          sharedMemorySource: requestBaselineRuntimeStatus?.runtimeTruth?.memory?.sourceUsedOnLoad === 'shared-backend' ? 'backend' : 'fallback',
        })
        : {
          records: [],
          source: 'fallback',
          retrievalState: 'degraded',
          reason: continuityAllowed
            ? 'Continuity retrieval unavailable.'
            : 'Route truth is not eligible for continuity retrieval.',
        };
      const continuityMode = !continuityAllowed
        ? 'recording-only'
        : continuityLookup.retrievalState === 'degraded'
          ? 'degraded'
          : 'retrieval-active';
      const continuityContext = continuityAllowed
        ? {
          summary: buildContinuitySummary(continuityLookup.records),
          records: continuityLookup.records,
        }
        : null;
      const assembledTileContext = assembleStephanosContext({
        userPrompt: prompt,
        runtimeContext: finalizedRequestContext,
      });
      const freshnessClassification = classifyPromptFreshness(prompt, {
        localPrivateHint: parsed?.route === 'system',
      });
      const refreshedProviderHealthResult = await getProviderHealth({
        provider,
        routeMode,
        providerConfigs: effectiveProviderConfigs,
        fallbackEnabled,
        fallbackOrder,
        devMode,
        runtimeContext: finalizedRequestContext,
      }, finalizedRequestContext).catch((error) => {
        console.warn('[Stephanos UI] Provider health refresh failed prior to freshness route selection', {
          message: error?.message || 'unknown-error',
          code: error?.code || '',
        });
        return null;
      });
      const refreshedProviderHealth = refreshedProviderHealthResult?.data && typeof refreshedProviderHealthResult.data === 'object'
        ? refreshedProviderHealthResult.data
        : providerHealth;
      if (refreshedProviderHealthResult && Object.keys(refreshedProviderHealth).length) {
        setProviderHealth(refreshedProviderHealth);
      }

      const requestRuntimeStatus = finalizeRuntimeContext(finalizedRequestContext, refreshedProviderHealth).runtimeStatus;
      const requestRouteTruthView = resolveExecuteRouteTruth({
        runtimeStatus: requestRuntimeStatus,
        routeTruthView: buildFinalRouteTruthView(requestRuntimeStatus),
      });
      const requestRouteTruth = {
        routeKind: requestRouteTruthView.routeKind,
        routeUsableState: requestRouteTruthView.routeUsableState,
        selectedRouteReachableState: requestRouteTruthView.selectedRouteReachableState,
        backendReachableState: requestRouteTruthView.backendReachableState,
        providerMismatch: requestRouteTruthView.providerMismatch === true,
        routeUsabilityVetoReason: requestRouteTruthView.routeUsabilityVetoReason || null,
      };
      const freshnessRouteDecision = {
        ...resolveFreshnessRoutingDecision({
          classification: freshnessClassification,
          requestedProvider: provider,
          providerHealth: refreshedProviderHealth,
          runtimeStatus: requestRuntimeStatus,
          routeTruthView: requestRouteTruthView,
          providerConfigs: effectiveProviderConfigs,
        }),
        defaultProvider: provider,
        requestRouteTruth,
      };
      activeRouteDecision = freshnessRouteDecision;
      setApiStatus((prev) => ({
        ...prev,
        state: submitHealth?.ok ? 'online' : prev.state,
        label: submitHealth?.ok ? `Connected to ${submitHealth.target || prev.target || 'backend'} API` : prev.label,
        detail: submitHealth?.ok
          ? `Backend reachable. Default provider: ${submitHealth.data?.default_provider || prev.backendDefaultProvider || 'mock'}.`
          : prev.detail,
        target: submitHealth?.target || prev.target,
        baseUrl: submitHealth?.baseUrl || prev.baseUrl,
        backendReachable: submitHealth?.ok === true ? true : prev.backendReachable,
        backendDefaultProvider: submitHealth?.data?.default_provider || prev.backendDefaultProvider,
        lastCheckedAt: new Date().toISOString(),
        runtimeContext: {
          ...finalizedRequestContext,
          healthProbeTruth: reconcileBackendHealthTruth({
            runtimeContext: finalizedRequestContext,
            healthOk: submitHealth?.ok === true,
            source: 'submit-time-probe',
            status: submitHealth?.status || 0,
            hadRouteUnavailableFailure: ['ROUTE_UNAVAILABLE', 'BACKEND_ROUTE_UNAVAILABLE'].includes(String(lastExecutionMetadata?.command_pipeline_last_failure_reason || '').trim().toUpperCase()),
          }),
        },
      }));
      const requestedProvider = freshnessRouteDecision.requestedProviderForRequest
        || freshnessRouteDecision.selectedProvider
        || provider;
      const normalizedUiRequestedProvider = normalizeProviderKey(provider);
      const normalizedRequestProvider = normalizeProviderKey(requestedProvider);
      const providerOverrideReason = normalizedRequestProvider !== normalizedUiRequestedProvider
        ? (
          freshnessRouteDecision.freshnessRouted === true
            ? `freshness-routing:${freshnessRouteDecision.policyReason || 'provider override required by freshness truth'}`
            : `route-selection:${freshnessRouteDecision.policyReason || 'runtime route selected different executable provider'}`
        )
        : null;
      const operatorContext = {
        northStar: 'Persistent cross-device identity and continuity layer that persists across reality.',
        subsystemInventory: [
          'memory',
          'retrieval',
          'knowledge-graph',
          'simulation',
          'tile-context',
          'runtime-truth',
        ],
        openTensions: [
          'preserve freshness integrity without overstating confidence',
          'preserve routing truth while composing multi-source context',
        ],
        recentActivity: Array.isArray(commandHistory)
          ? commandHistory.slice(-4).map((entry) => String(entry?.raw_input || '').slice(0, 140)).filter(Boolean)
          : [],
        roadmapSignals: Array.isArray(telemetryEntries)
          ? telemetryEntries.slice(-4).map((entry) => String(entry?.label || entry?.event || '').slice(0, 120)).filter(Boolean)
          : [],
      };
      const contextAssembly = buildContextAssembly({
        prompt,
        freshnessContext: freshnessClassification,
        runtimeContext: finalizedRequestContext,
        routeDecision: freshnessRouteDecision,
        tileContext: assembledTileContext,
        continuityContext,
        retrievalContext: {
          used: continuityLookup.retrievalState !== 'degraded',
          reason: continuityLookup.reason,
          chunkCount: Array.isArray(continuityLookup.records) ? continuityLookup.records.length : 0,
          sources: [],
        },
        operatorContext,
      });
      const intentResult = classifyOperatorIntent({
        prompt,
        frictionSignals: Array.isArray(workingMemory?.surfaceFrictionEvents) ? workingMemory.surfaceFrictionEvents : [],
        projectContext: operatorContext,
      });
      const missionPacket = buildMissionExecutionPacket({
        intent: intentResult,
        proposalPacket: contextAssembly?.proposalPacket || {},
        missionWorkflow: missionPacketWorkflow || {},
        graphState: contextAssembly?.contextBundle?.knowledgeGraph || {},
      });
      const routeModeForRequest = freshnessRouteDecision.overrideRequested ? 'explicit' : routeMode;
      const timeoutExecutionEnvelope = buildPreArmTimeoutExecutionEnvelope({
        routeDecision: freshnessRouteDecision,
        runtimeStatus: requestRuntimeStatus,
        requestedProvider,
        providerConfigs: effectiveProviderConfigs,
        ollamaLoadMode,
        prompt,
      });
      const streamingPolicy = resolveStreamingRequestPolicy({
        streamingMode,
        provider: requestedProvider,
        executionProvider: timeoutExecutionEnvelope.effectiveProvider || freshnessRouteDecision.selectedProvider || requestedProvider,
        executionModel: timeoutExecutionEnvelope.effectiveModel || '',
        providerConfigs: effectiveProviderConfigs,
      });
      const previousChatContinuityRaw = readChatContinuity();
      const previousChatContinuity = Array.isArray(previousChatContinuityRaw?.summaries) && previousChatContinuityRaw.summaries.length
        ? previousChatContinuityRaw
        : seedChatContinuityFromExistingHistory({
          commandHistory,
          sessionId: requestRuntimeStatus?.sessionId || 'session-local',
        });
      const previousOperatorProfile = readOperatorProfile();
      const nextOperatorProfile = updateOperatorProfileFromMessage(previousOperatorProfile, prompt);
      persistOperatorProfile(nextOperatorProfile);
      const liveGithubPrEvidence = await resolveGithubPrEvidenceReadOnly({
        prompt,
        repo: requestRuntimeStatus?.githubRepo || requestRuntimeStatus?.githubPrEvidenceRepo || '',
        repoConfig: {
          repo: requestRuntimeStatus?.githubRepo || requestRuntimeStatus?.githubPrEvidenceRepo || '',
          owner: requestRuntimeStatus?.githubOwner || '',
          name: requestRuntimeStatus?.githubRepoName || '',
        },
        connectorAvailable: true,
        enableLiveGithubPrEvidenceFetch: false,
        liveFetchDisabledReason: 'live-fetch-disabled-by-default',
      });
      const previousActiveMission = readActiveMissionState();
      const chatContextGithubEvidence = liveGithubPrEvidence || null;
      const bridgedOperatorReliefProjection = requestRuntimeStatus?.operatorReliefProjection
        || requestRuntimeStatus?.runtimeContext?.operatorReliefProjection
        || requestRuntimeStatus?.missionState?.operatorReliefProjection
        || requestRuntimeStatus?.inputMissionState?.operatorReliefProjection
        || {};
      const operatorReliefBridgeDiagnostics = requestRuntimeStatus?.runtimeContext?.operatorReliefBridgeDiagnostics || {};
      const chatContextPack = buildChatContextPack({
        operatorMessage: prompt,
        buildSource: submissionSource,
        uiRealityStatus: requestRuntimeStatus?.uiRealityStatus || {},
        githubPrEvidence: chatContextGithubEvidence,
        runtimeTruth: requestRuntimeStatus,
        routeTruth: requestRouteTruthView,
        providerTruth: {
          executableProvider: requestRouteTruthView.executedProvider,
          selectedProvider: requestRouteTruthView.selectedProvider,
        },
        chatContinuity: previousChatContinuity,
        operatorProfile: nextOperatorProfile,
        missionState: {
          status: missionPacketWorkflow?.status || requestRuntimeStatus?.missionStatus || 'unknown',
          activeMission: previousActiveMission,
          operatorReliefProjection: bridgedOperatorReliefProjection,
          agentRealityLoopProjection: bridgedOperatorReliefProjection?.agentRealityLoopProjection || {},
        },
        agentState: {
          actingAgentId: requestRuntimeStatus?.agentActingAgentId || 'none',
          blockedTaskCount: requestRuntimeStatus?.agentBlockedTaskCount || '0',
        },
        memoryState: {
          candidates: Array.isArray(continuityLookup?.records) ? continuityLookup.records.map((record) => record.summary).filter(Boolean) : [],
        },
        chatContinuity: previousChatContinuity,
        operatorProfile: nextOperatorProfile,
        connectorEvidence: liveGithubPrEvidence,
      });
      const chatContextPackEvidence = chatContextPack?.githubPrEvidence || null;
      const responsePlan = buildResponsePlan({
        operatorMessage: prompt,
        commandEnvelope: null,
        chatContextPack,
        contextProviderSnapshot: {
          contextProviderProofState: chatContextPack.contextProviderProofState || null,
        },
        supportSnapshotSummary: {
          prEvidenceInputDetected: requestRuntimeStatus?.prEvidenceInputDetected || 'unknown',
          prEvidenceStatus: chatContextPack?.githubPrEvidence?.status || requestRuntimeStatus?.prEvidenceStatus,
          prEvidenceChecksStatus: chatContextPack?.githubPrEvidence?.checksStatus || requestRuntimeStatus?.prEvidenceChecksStatus,
          prEvidenceBuildStatus: chatContextPack?.githubPrEvidence?.buildStatus || requestRuntimeStatus?.prEvidenceBuildStatus,
          prEvidenceVerifyStatus: chatContextPack?.githubPrEvidence?.verifyStatus || requestRuntimeStatus?.prEvidenceVerifyStatus,
          prEvidenceChangedFileCount: chatContextPack?.githubPrEvidence?.changedFileCount || requestRuntimeStatus?.prEvidenceChangedFileCount,
          prEvidenceMerged: chatContextPack?.githubPrEvidence?.merged === true ? 'yes' : (requestRuntimeStatus?.prEvidenceMerged || 'no'),
          prEvidenceMergeReadiness: chatContextPack?.githubPrEvidence?.mergeReadiness || requestRuntimeStatus?.prEvidenceMergeReadiness,
          prEvidenceMissingProof: Array.isArray(chatContextPack?.githubPrEvidence?.missingProof)
            ? chatContextPack.githubPrEvidence.missingProof.join('|')
            : (requestRuntimeStatus?.prEvidenceMissingProof || ''),
          prEvidenceParsedPrNumber: chatContextPack?.githubPrEvidence?.prNumber || requestRuntimeStatus?.prEvidenceParsedPrNumber,
        },
        uiRealityStatus: requestRuntimeStatus?.uiRealityStatus || {},
        githubPrEvidence: chatContextPackEvidence,
        runtimeTruth: requestRuntimeStatus || {},
        providerTruth: { executableProvider: requestRouteTruthView.executedProvider },
        chatContinuity: previousChatContinuity,
        operatorProfile: nextOperatorProfile,
        missionState: {
          testsPassed: requestRuntimeStatus?.missionVerificationRequiredTestsRun === 'yes' ? 'yes' : 'no',
          prEvidenceInputDetected: requestRuntimeStatus?.prEvidenceInputDetected || 'unknown',
          activeMission: previousActiveMission,
        },
      });
      const identityRecallKnownName = (
        responsePlan?.responseMode === 'identity-recall'
        && responsePlan?.operatorNameUsed === 'yes'
        && String(chatContextPack?.providerSummaries?.operatorProfile?.operatorName || '').trim()
      );
      if (identityRecallKnownName) {
        responsePlan.identityPromptInjected = 'yes';
        responsePlan.operatorProfilePromptLinePresent = 'yes';
      }
      const missionIntentMatched = /mission|codex|repair|merge|architecture|workflow/i.test(String(prompt || '')) || /mission|codex|merge|repair/i.test(String(chatContextPack?.recommendedResponseMode || ''));
      const nextActiveMission = missionIntentMatched
        ? buildActiveMissionState({
          missionId: previousActiveMission?.missionId && previousActiveMission.missionId !== 'unknown' ? previousActiveMission.missionId : `mission_${Date.now()}`,
          title: previousActiveMission?.title !== 'unknown' ? previousActiveMission.title : 'Close the human-AI-Codex repair loop so Stephanos can manage build/repair workflows without the operator acting as click monkey.',
          phase: missionPacketWorkflow?.status || 'proposed',
          objective: previousActiveMission?.objective !== 'unknown' ? previousActiveMission.objective : 'Close the human-AI-Codex repair loop so Stephanos can manage build/repair workflows without the operator acting as click monkey.',
          currentFocus: 'Mission Repair Loop / Codex Dispatch / PR Evidence loop',
          lastKnownGoodStackState: requestRuntimeStatus?.uiRealityStatus?.severity || previousActiveMission?.lastKnownGoodStackState || 'unknown',
          nextRecommendedStep: responsePlan?.recommendedNextAction || 'Collect approval-safe repair proof and update command envelope.',
          blockedReason: missionPacketWorkflow?.status === 'blocked' ? (responsePlan?.warnings?.[0] || 'Current intent is unknown; mission cannot safely advance.') : 'none',
          proofState: chatContextPack?.contextProviderProofState?.proofState || 'unknown',
          relatedSystems: ['missionRepairLoopModel', 'commandEnvelope', 'responsePlanner', 'contextProviderRegistry'],
        }, previousActiveMission)
        : previousActiveMission;
      persistActiveMissionState(nextActiveMission);
      const nextChatContinuity = buildChatContinuitySummary({
        previousContinuity: previousChatContinuity,
        sessionId: requestRuntimeStatus?.sessionId || 'session-local',
        operatorMessage: prompt,
        sourceCommandId: `req_${Date.now()}`,
        responseMode: chatContextPack?.recommendedResponseMode,
        chatContextPack,
        responsePlanner: responsePlan,
        missionState: { status: missionPacketWorkflow?.status || requestRuntimeStatus?.missionStatus || 'unknown', activeMission: nextActiveMission },
        uiRealityStatus: requestRuntimeStatus?.uiRealityStatus || {},
        githubPrEvidence: chatContextGithubEvidence,
      });
      persistChatContinuity(nextChatContinuity);
      setUiDiagnostics((prev) => ({ ...prev, chatContextPack, responsePlan, chatContinuity: nextChatContinuity }));

      const requestPayload = {
        request_execution_id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        provider: requestedProvider,
        execution_requested_provider: requestedProvider,
        raw_input: prompt,
        ui_requested_provider: normalizedUiRequestedProvider || requestedProvider,
        request_side_selected_provider: normalizedRequestProvider || requestedProvider,
        router_selected_provider: normalizeProviderKey(freshnessRouteDecision.selectedProvider || requestedProvider) || requestedProvider,
        provider_override_reason: providerOverrideReason,
        routeMode: routeModeForRequest,
        streamingMode,
        ollama_load_mode: normalizeProviderKey(requestedProvider) === 'ollama'
          ? (timeoutExecutionEnvelope.ollamaLoadMode || ollamaLoadMode || 'balanced')
          : (ollamaLoadMode || 'balanced'),
        streaming_mode_preference_input: streamingPolicy.streamingModePreferenceInput,
        streaming_mode_preference: streamingPolicy.normalizedMode,
        streaming_mode_preference_rehydrated: streamingModePreferenceRehydrated === true,
        streaming_persistence_source: streamingPersistenceSource || 'default/auto',
        streaming_persistence_updated_at: streamingPersistenceUpdatedAt || null,
        streaming_requested: streamingPolicy.streamingRequested,
        streaming_request_source: streamingPolicy.streamingRequestSource,
        streaming_policy_decision: streamingPolicy.streamingPolicyDecision,
        streaming_policy_reason: streamingPolicy.streamingPolicyReason,
        freshnessContext: freshnessClassification,
        routeDecision: freshnessRouteDecision,
        contextAssemblyMetadata: contextAssembly.truthMetadata,
        intentResult,
        missionPacket,
        chatContextPack,
        responsePlan,
        commandEnvelope: null,
        submissionSource,
        submissionRoute,
        execution_cancelled: false,
        command_pipeline_last_submit_accepted: 'no',
        command_pipeline_last_user_message_recorded: 'no',
        command_pipeline_last_assistant_answer_generated: 'no',
        command_pipeline_last_answer_pane_rendered: 'no',
        command_pipeline_last_failure_reason: 'none',
        command_pipeline_last_finalization_path: 'unknown',
        command_pipeline_last_input_cleared: 'no',
        command_pipeline_last_input_restore_available: 'yes',
        cancellation_source: null,
        provider_cancelled: false,
        provider_cancel_reason: null,
        ollama_abort_sent: false,
        ui_timeout_triggered: false,
        backend_timeout_triggered: false,
        abort_signal_created: false,
        abort_signal_fired: false,
        abort_forwarded_to_router: false,
        abort_forwarded_to_provider: false,
        abort_forwarded_to_ollama_fetch: false,
        ollama_fetch_aborted: false,
        ollama_reader_cancelled: false,
      };
      submitAccepted = true;
      executeStageLastReached = 'submit-accepted';
      executePhase = 'submit-accepted';
      userMessageRecordAttempted = 'yes';
      try {
        const queuedMessageId = `cmd_${Date.now()}_queued`;
        const queuedRequestId = requestPayload.request_execution_id;
        userMessageRecordId = queuedMessageId;
        setCommandHistory((prev) => appendCommandHistory(prev, {
          id: queuedMessageId,
          request_id: queuedRequestId,
          role: 'operator',
          raw_input: prompt,
          parsed_command: parsed,
          route: 'assistant',
          tool_used: null,
          success: true,
          output_text: '',
          stream_buffer_text: '',
          stream_finalized: false,
          data_payload: { stage: 'queued' },
          timing_ms: 0,
          timestamp: new Date().toISOString(),
          error: null,
          error_code: null,
          response: { type: 'operator_prompt', route: 'operator', success: true, output_text: '' },
          continuity_mode: continuityMode,
          continuity_context: continuityContext,
          continuity_retrieval_state: continuityLookup.retrievalState,
          continuity_retrieval_reason: continuityLookup.reason,
        }));
      } catch (error) {
        userMessageRecordError = error?.message || 'message-record-failed';
        submitAccepted = false;
        submitBlockReason = 'user-message-record-failed';
        executeStageFailureReason = userMessageRecordError;
        executeHandlerEarlyReturnReason = 'user-message-record-failed';
        envelopeBuildSkippedReason = 'user-message-record-failed';
        throw error;
      }
      executeStageLastReached = 'message-recorded';
      executePhase = 'message-recorded';
      let commandEnvelope = null;
      executeStageLastReached = 'envelope-build-started';
      executePhase = 'envelope-build-started';
      commandEnvelopeBuildAttempted = 'yes';
      try {
        commandEnvelope = createCommandEnvelope({
          operatorMessage: prompt,
          normalizedOperatorMessage: normalizeChatContextOperatorMessage(prompt),
          commandId: requestPayload.request_execution_id,
          submissionSource,
          submissionRoute,
        });
        envelopeBuildId = String(commandEnvelope?.id || commandEnvelope?.commandId || requestPayload.request_execution_id || 'none');
      } catch (error) {
        commandEnvelopeBuildError = error?.message || 'command-envelope-build-failed';
        preEnvelopeExceptionName = error?.name || 'Error';
        preEnvelopeExceptionMessage = error?.message || 'command-envelope-build-failed';
        executeStageFailureReason = commandEnvelopeBuildError;
        throw error;
      }
      executeStageLastReached = 'envelope-built';
      executePhase = 'envelope-built';
      commandEnvelope = attachChatContextToEnvelope(commandEnvelope, chatContextPack);
      commandEnvelope = attachPrEvidenceToEnvelope(commandEnvelope, chatContextPack?.githubPrEvidence || liveGithubPrEvidence || chatContextPack?.providerSummaries?.prEvidence || null);
      commandEnvelope = attachProviderRequestToEnvelope(commandEnvelope, {
        responsePlannerGuidance: `Use ${responsePlan.answerShape} answer shape: ${responsePlan.requiredSections.join(', ')}. ${responsePlan.identityGuidance || ''} Do not invent PR status if PR evidence is missing.`,
        requestedProvider,
        selectedProvider: freshnessRouteDecision.selectedProvider || requestedProvider,
        executableProvider: timeoutExecutionEnvelope.effectiveProvider || freshnessRouteDecision.selectedProvider || requestedProvider,
        requestedModel: timeoutExecutionEnvelope.effectiveModel || '',
        selectedModel: timeoutExecutionEnvelope.effectiveModel || '',
        freshnessMode: freshnessClassification.freshnessNeed || 'low',
        timeoutPolicy: timeoutExecutionEnvelope.timeoutMode || 'standard',
      });
      const identityRecallDeterministicEligible = responsePlan?.responseMode === 'identity-recall'
        && responsePlan?.operatorNameUsed === 'yes';
      const projectAwarenessPromptContext = buildProjectAwarenessPromptContext(chatContextPack, prompt);
      const workRoutingPromptContext = buildWorkRoutingPromptContext(chatContextPack, prompt, {
        responsePlannerResponseMode: responsePlan?.responseMode,
        commandEnvelopeResponseMode: commandEnvelope?.responseMode,
        chatContextResponseMode: chatContextPack?.recommendedResponseMode,
      });
      const promptWithProjectAwareness = projectAwarenessPromptContext.injected === 'yes'
        ? `${prompt}\n\n${projectAwarenessPromptContext.block}`
        : prompt;
      const promptWithRoutingContext = workRoutingPromptContext.injected === 'yes'
        ? `${promptWithProjectAwareness}\n\n${workRoutingPromptContext.block}`
        : promptWithProjectAwareness;
      if (identityRecallDeterministicEligible) {
        responsePlan.finalAnswerUsedOperatorProfile = 'yes';
        responsePlan.identityRecallDeterministicAnswerUsed = 'yes';
      }
      requestPayload.commandEnvelope = commandEnvelope;
      requestPayload.project_awareness_prompt_injected = projectAwarenessPromptContext.injected;
      requestPayload.project_awareness_prompt_block_length = projectAwarenessPromptContext.block.length;
      requestPayload.project_awareness_prompt_sources = projectAwarenessPromptContext.sources.length ? projectAwarenessPromptContext.sources.join('|') : 'none';
      requestPayload.mission_planning_prompt_context_used = projectAwarenessPromptContext.missionPlanningContextUsed;
      requestPayload.work_routing_prompt_injected = workRoutingPromptContext.injected;
      requestPayload.work_routing_prompt_block_length = workRoutingPromptContext.block.length;
      requestPayload.work_routing_prompt_sources = workRoutingPromptContext.sources.length ? workRoutingPromptContext.sources.join('|') : 'none';
      requestPayload.work_routing_pack_status = workRoutingPromptContext.packStatus;
      inFlightRequestPayload = requestPayload;
      setLastExecutionMetadata((prev) => attachChatContextToExecutionMetadata({
        executionMetadata: {
        ...(prev || {}),
        request_execution_id: requestPayload.request_execution_id,
        ui_requested_provider: requestPayload.ui_requested_provider || 'unknown',
        request_side_selected_provider: requestPayload.request_side_selected_provider || 'unknown',
        router_selected_provider: requestPayload.router_selected_provider || 'unknown',
        router_provider: requestPayload.router_selected_provider || 'unknown',
        request_trace: {
          request_execution_id: requestPayload.request_execution_id,
          router_selected_provider: requestPayload.router_selected_provider || 'unknown',
          router_provider: requestPayload.router_selected_provider || 'unknown',
        },
        selected_provider: requestPayload.router_selected_provider || requestPayload.request_side_selected_provider || requestPayload.provider || 'unknown',
        execution_selected_provider: timeoutExecutionEnvelope.effectiveProvider || requestPayload.router_selected_provider || requestPayload.provider || 'unknown',
        executable_provider: timeoutExecutionEnvelope.effectiveProvider || requestPayload.router_selected_provider || requestPayload.provider || 'unknown',
        execution_cancelled: false,
        cancellation_source: null,
        provider_cancelled: false,
        provider_cancel_reason: null,
        ollama_abort_sent: false,
        ui_timeout_triggered: false,
        backend_timeout_triggered: false,
        abort_signal_created: false,
        abort_signal_fired: false,
        abort_forwarded_to_router: false,
        abort_forwarded_to_provider: false,
        abort_forwarded_to_ollama_fetch: false,
        ollama_fetch_aborted: false,
        ollama_reader_cancelled: false,
        provider_generation_still_running_unknown: false,
        provider_generation_confirmed_stopped: false,
        ...buildChatContextExecutionMetadata(chatContextPack),
        operator_relief_bridge_published: operatorReliefBridgeDiagnostics?.published || 'no',
        operator_relief_bridge_source_surface: operatorReliefBridgeDiagnostics?.sourceSurface || 'unknown',
        operator_relief_bridge_projection_keys_seen: Array.isArray(operatorReliefBridgeDiagnostics?.projectionKeysSeen) ? operatorReliefBridgeDiagnostics.projectionKeysSeen.join('|') : 'none',
        operator_relief_bridge_agent_reality_loop_seen: operatorReliefBridgeDiagnostics?.agentRealityLoopSeen ? 'yes' : 'no',
        operator_relief_bridge_store_updated: operatorReliefBridgeDiagnostics?.storeUpdated || 'no',
        operator_relief_bridge_runtime_context_seen: operatorReliefBridgeDiagnostics?.runtimeContextSeen || 'no',
        operator_relief_bridge_request_runtime_status_seen: bridgedOperatorReliefProjection && Object.keys(bridgedOperatorReliefProjection).length ? 'yes' : 'no',
        operator_relief_bridge_last_updated_at: operatorReliefBridgeDiagnostics?.lastUpdatedAt || 'unknown',
        operator_relief_bridge_drop_boundary: bridgedOperatorReliefProjection && Object.keys(bridgedOperatorReliefProjection).length ? 'none' : 'request-runtime-status',
        ...buildResponsePlanExecutionMetadata(responsePlan),
        ...projectEnvelopeToExecutionMetadata(commandEnvelope),
        },
        requestPayload,
      }));
      executeStageLastReached = 'dispatch-gate-started';
      executePhase = 'dispatch-gate-started';
      requestDispatchGate = evaluateRequestDispatchGate({
        routeDecision: freshnessRouteDecision,
        routeTruthView: requestRouteTruthView,
        runtimeStatus: requestRuntimeStatus,
      });
      freshnessRouteDecision.requestDispatchGate = requestDispatchGate;
      dispatchGateAllowed = requestDispatchGate.dispatchAllowed === true ? 'yes' : 'no';
      dispatchGateReason = requestDispatchGate.reasonCode || 'none';
      executeStageLastReached = 'dispatch-gate-complete';
      executePhase = 'dispatch-gate-complete';
      const runtimeConfigWithExecutionTruth = {
        ...finalizedRequestContext,
        preferredTarget: requestRouteTruthView.preferredTarget || finalizedRequestContext.preferredTarget || '',
        actualTargetUsed: requestRouteTruthView.actualTarget || finalizedRequestContext.actualTargetUsed || '',
        finalRouteTruth: requestRuntimeStatus?.finalRouteTruth || finalizedRequestContext?.finalRouteTruth || {},
        canonicalRouteRuntimeTruth: requestRuntimeStatus?.canonicalRouteRuntimeTruth || finalizedRequestContext?.canonicalRouteRuntimeTruth || {},
        timeoutExecutionEnvelope,
      };
      inFlightRuntimeContext = runtimeConfigWithExecutionTruth;
      const routeDispatchBlocked = requestDispatchGate.dispatchAllowed !== true;
      if (routeDispatchBlocked) {
        submitBlockReason = requestDispatchGate.reasonCode || 'dispatch-gate-blocked';
      }
      console.info('[Stephanos UI] Request dispatch gate evaluated', {
        dispatchAllowed: requestDispatchGate.dispatchAllowed === true,
        reasonCode: requestDispatchGate.reasonCode || null,
        sessionKind: requestRuntimeStatus?.sessionKind || 'unknown',
        routeKind: requestRouteTruthView.routeKind || 'unknown',
        selectedProvider: freshnessRouteDecision.selectedProvider || provider,
        requestedProviderForRequest: requestedProvider,
        selectedAnswerMode: requestDispatchGate.selectedAnswerMode || freshnessRouteDecision.selectedAnswerMode || 'unknown',
        backendReachabilityState: requestDispatchGate.backendReachabilityState || requestRouteTruthView.backendReachableState || 'unknown',
        targetEndpointClass: finalizedRequestContext?.target || finalizedRequestContext?.strategy || 'unknown',
        backendTargetEndpoint: finalizedRequestContext?.backendTargetEndpoint || '',
        timeoutExecutionProvider: timeoutExecutionEnvelope.effectiveProvider || 'unknown',
        timeoutExecutionModel: timeoutExecutionEnvelope.effectiveModel || null,
      });
      routeUnavailableOutcome = routeDispatchBlocked
        ? createRouteUnavailableResult({
          prompt,
          parsed,
          startedAt,
          routeDecision: freshnessRouteDecision,
          continuityMode,
          continuityContext,
          continuityLookup,
          requestPayload,
        })
        : null;
      const identityRecallDeterministicResult = (!routeUnavailableOutcome && identityRecallDeterministicEligible)
        ? createIdentityRecallDeterministicResult({
          prompt,
          parsed,
          startedAt,
          requestPayload,
          operatorName: chatContextPack?.providerSummaries?.operatorProfile?.operatorName || '',
          operatorProfileSource: chatContextPack?.providerSummaries?.operatorProfile?.source || 'operator profile',
        })
        : null;
      const agentRealityLoopProjectionForAnswer = chatContextPack?.inputMissionState?.operatorReliefProjection?.agentRealityLoopProjection
        || chatContextPack?.inputMissionState?.agentRealityLoopProjection
        || {};
      const agentRealityLoopDeterministicEligible = !routeUnavailableOutcome
        && !identityRecallDeterministicResult
        && String(chatContextPack?.intentClassifierMatchedRule || '').trim().toLowerCase() === 'agent-reality-loop'
        && Object.keys(agentRealityLoopProjectionForAnswer).length > 0;
      const agentRealityLoopDeterministicResult = agentRealityLoopDeterministicEligible
        ? createAgentRealityLoopDeterministicResult({
          prompt,
          parsed,
          startedAt,
          requestPayload,
          projection: agentRealityLoopProjectionForAnswer,
          projectAwareness: chatContextPack?.compactSummary?.projectAwareness || {},
        })
        : null;
      const explanationIntent = detectOperatorExplanationIntent(prompt);
      const operatorExplanationModeClassified = String(chatContextPack?.recommendedResponseMode || responsePlan?.responseMode || '').trim().toLowerCase() === 'operator-explanation';
      const operatorExplanationDeterministicEligible = operatorExplanationModeClassified || explanationIntent.matched;
      const operatorExplanationProjection = operatorExplanationDeterministicEligible
        ? buildOperatorExplanationProjection({
          intentToBuildModel: requestRuntimeStatus?.intentToBuildModel || {},
          taskFinisherModel: requestRuntimeStatus?.taskFinisherModel || {},
          missionEvidenceLedgerModel: requestRuntimeStatus?.missionEvidenceLedgerModel || {},
          prEvidenceModel: requestRuntimeStatus?.prEvidenceModel || {},
          proofOfDoneModel: requestRuntimeStatus?.proofOfDoneModel || {},
          operatorDecisionQueue: requestRuntimeStatus?.operatorDecisionQueue || {},
          memoryLibrarianQueue: requestRuntimeStatus?.memoryLibrarianQueue || {},
          supportSnapshot: requestRuntimeStatus?.supportSnapshot || requestRuntimeStatus || {},
        }, prompt)
        : null;
      const operatorExplanationDeterministicResult = (!routeUnavailableOutcome && !identityRecallDeterministicResult && !agentRealityLoopDeterministicResult && operatorExplanationDeterministicEligible)
        ? createOperatorExplanationDeterministicResult({
          prompt,
          parsed,
          startedAt,
          requestPayload,
          projection: operatorExplanationProjection,
          output: formatOperatorExplanation(operatorExplanationProjection, { mode: operatorExplanationProjection?.mode || explanationIntent.mode }),
        })
        : null;
      if (!routeUnavailableOutcome && !identityRecallDeterministicResult && !agentRealityLoopDeterministicResult && !operatorExplanationDeterministicResult) {
        executeStageLastReached = 'provider-dispatch-started';
        executePhase = 'provider-dispatch-started';
        setCommandHistory((prev) => appendCommandHistory(prev, {
          id: streamEntryId,
          raw_input: prompt,
          parsed_command: parsed,
          route: 'assistant',
          tool_used: null,
          success: true,
          output_text: '',
          stream_buffer_text: '',
          stream_finalized: false,
          data_payload: {},
          timing_ms: 0,
          timestamp: new Date().toISOString(),
          error: null,
          error_code: null,
          response: { type: 'operator_prompt', route: 'operator', success: true, output_text: '' },
          continuity_mode: continuityMode,
          continuity_context: continuityContext,
          continuity_retrieval_state: continuityLookup.retrievalState,
          continuity_retrieval_reason: continuityLookup.reason,
        }));
      }
      providerDispatchResult = routeUnavailableOutcome || identityRecallDeterministicResult || agentRealityLoopDeterministicResult || operatorExplanationDeterministicResult || await sendPrompt({
        prompt: contextAssembly.truthMetadata.augmented_prompt_used
          ? contextAssembly.augmentedPrompt.replace(prompt, promptWithRoutingContext)
          : promptWithRoutingContext,
        provider: requestedProvider,
        uiRequestedProvider: requestPayload.ui_requested_provider,
        requestSideSelectedProvider: requestPayload.request_side_selected_provider,
        routerSelectedProvider: requestPayload.router_selected_provider,
        requestExecutionId: requestPayload.request_execution_id,
        providerOverrideReason: requestPayload.provider_override_reason,
        routeMode: routeModeForRequest,
        providerConfigs: effectiveProviderConfigs,
        fallbackEnabled,
        fallbackOrder,
        devMode,
        runtimeConfig: runtimeConfigWithExecutionTruth,
        tileContext: assembledTileContext,
        continuityContext,
        continuityMode,
        freshnessContext: freshnessClassification,
        routeDecision: freshnessRouteDecision,
        contextAssembly,
        chatContextPack,
        projectAwarenessPromptContext,
        streamingMode,
        ollamaLoadMode: requestPayload.ollama_load_mode || ollamaLoadMode,
        abortSignal: activePromptRequestRef.current?.signal || null,
        onStreamEvent: (event) => {
          if (!event || event.type !== 'token') return;
          streamBuffer += String(event.content || '');
          setCommandHistory((prev) => prev.map((entry) => entry.id === streamEntryId
            ? { ...entry, stream_buffer_text: streamBuffer, stream_finalized: false }
            : entry));
        },
      });
      const { data, requestPayload: effectiveRequestPayload } = providerDispatchResult;
      const deterministicAnswerCompleted = Boolean(identityRecallDeterministicResult || agentRealityLoopDeterministicResult || operatorExplanationDeterministicResult);
      executeStageLastReached = deterministicAnswerCompleted ? 'deterministic-answer-complete' : 'provider-dispatch-complete';
      executePhase = executeStageLastReached;

      if (
        data.success
        && freshnessRouteDecision.selectedAnswerMode === 'fallback-stale-risk'
        && freshnessRouteDecision.freshnessWarning
      ) {
        data.output_text = `[Freshness warning] ${freshnessRouteDecision.freshnessWarning}\n\n${data.output_text}`;
      }

      const responseProviderHealth = data.data?.provider_health || {};
      if (Object.keys(responseProviderHealth).length) {
        setProviderHealth(responseProviderHealth);
      }

      const executionMetadataBase = normalizeExecutionMetadata({
        data,
        requestPayload: effectiveRequestPayload,
        backendDefaultProvider: apiStatus.backendDefaultProvider,
      });
      let commandEnvelopeFinal = effectiveRequestPayload?.commandEnvelope || requestPayload.commandEnvelope || null;
      if (commandEnvelopeFinal) {
        commandEnvelopeFinal = attachExecutionMetadataToEnvelope(commandEnvelopeFinal, executionMetadataBase);
      }
      const executionMetadata = attachChatContextToExecutionMetadata({
        executionMetadata: {
        ...executionMetadataBase,
        intent_type: effectiveRequestPayload?.intentResult?.intentType || 'unknown',
        intent_confidence: effectiveRequestPayload?.intentResult?.confidence ?? 0,
        intent_reason: effectiveRequestPayload?.intentResult?.reason || '',
        intent_ambiguity_flags: effectiveRequestPayload?.intentResult?.ambiguityFlags || [],
        intent_build_relevant: effectiveRequestPayload?.intentResult?.buildRelevant === true,
        mission_packet_state: effectiveRequestPayload?.missionPacket?.lifecycleState || 'inactive',
        mission_packet_title: effectiveRequestPayload?.missionPacket?.missionTitle || 'n/a',
        mission_packet_class: effectiveRequestPayload?.missionPacket?.missionClass || 'analysis',
        mission_execution_mode: effectiveRequestPayload?.missionPacket?.executionMode || 'analysis-only',
        request_payload_chat_context_present: Boolean((effectiveRequestPayload?.chatContextPack) || (data?.data?.execution_metadata?.chat_context_pack_status) || (data?.data?.request_trace?.chat_context_pack_status)),
        mission_assigned_roles: Array.isArray(effectiveRequestPayload?.missionPacket?.agentAssignments)
          ? effectiveRequestPayload.missionPacket.agentAssignments.map((assignment) => assignment.roleId).filter(Boolean)
          : [],
        mission_planned_tools: Array.isArray(effectiveRequestPayload?.missionPacket?.toolPlan)
          ? effectiveRequestPayload.missionPacket.toolPlan.map((tool) => tool.toolType || tool.toolId).filter(Boolean)
          : [],
        mission_blockers: effectiveRequestPayload?.missionPacket?.blockers || [],
        mission_warnings: effectiveRequestPayload?.missionPacket?.warnings || [],
        roadmap_promotion_candidate: effectiveRequestPayload?.missionPacket?.roadmapPromotionCandidate === true,
        codex_handoff_eligible: effectiveRequestPayload?.missionPacket?.codexHandoffEligible === true,
        graph_link_suggested: effectiveRequestPayload?.missionPacket?.graphLinkSuggested === true,
        graph_link_eligible: effectiveRequestPayload?.missionPacket?.graphLinkEligible === true,
        graph_promotion_deferred_reason: effectiveRequestPayload?.missionPacket?.graphPromotionDeferredReason || '',
        ...(commandEnvelopeFinal ? projectEnvelopeToExecutionMetadata(commandEnvelopeFinal) : {}),
        ...buildResponsePlanExecutionMetadata(effectiveRequestPayload?.responsePlan || requestPayload?.responsePlan || null),
        },
        rawExecutionMetadata: data?.data?.execution_metadata || {},
        requestTrace: data?.data?.request_trace || {},
        requestPayload: effectiveRequestPayload || {},
      });
      if (executionMetadata.actual_provider_used === 'ollama' && data.success) {
        executionMetadata.provider_generation_still_running_unknown = false;
        executionMetadata.provider_generation_confirmed_stopped = true;
        executionMetadata.cancellation_effectiveness = executionMetadata.execution_cancelled ? 'attempted-confirmed' : 'not-needed';
      }
      const streamFinalizationMissing = Boolean(
        data.success
        && executionMetadata.streaming_used
        && executionMetadata.streaming_finalized !== true,
      );
      if (streamFinalizationMissing) {
        executionMetadata.streaming_diagnostics_warning = 'Final metadata was incomplete; streamed partial answer preserved.';
        executionMetadata.streaming_completion_quality = executionMetadata.streaming_completion_quality || 'partial-success';
      }
      const effectiveOutputText = streamFinalizationMissing
        ? String(data.output_text || streamBuffer || '').trim()
        : data.output_text;
      const executionSummaryForStage = buildExecutionSummary(executionMetadata);

      const selectedAnswerMode = String(executionMetadata.selected_answer_mode || '').trim().toLowerCase();
      const hostedProviderLabel = String(
        executionMetadata.actual_provider_used
        || executionMetadata.execution_selected_provider
        || executionMetadata.selected_provider
        || '',
      ).trim().toLowerCase();
      const hostedProvider = resolveHostedProviderKey(hostedProviderLabel);
      const hostedProviderUsed = hostedProvider === 'groq' || hostedProvider === 'gemini';
      const hostedExecutionPath = selectedAnswerMode === 'fresh-cloud' || selectedAnswerMode === 'cloud-basic';
      if (data.success && hostedProviderUsed && hostedExecutionPath) {
        const missionPacketState = String(executionMetadata.mission_packet_state || '').trim().toLowerCase();
        const stagedType = missionPacketState && missionPacketState !== 'inactive' ? 'mission' : 'idea';
        addHostedStagedItem({
          type: stagedType,
          title: stagedType === 'mission'
            ? (executionMetadata.mission_packet_title || `Hosted mission candidate from ${hostedProvider}`)
            : `Hosted idea candidate from ${hostedProvider}`,
          summary: executionSummaryForStage,
          content: String(data.output_text || '').trim(),
          sourceSurface: 'mission-console',
          sourceProvider: hostedProvider,
          sourceAuthorityLevel: 'hosted-cognition-only',
          status: 'staged',
          promotionTarget: stagedType === 'mission' ? 'mission-lineage' : 'durable-memory',
          confidence: Number(executionMetadata.intent_confidence ?? 0.6),
          tags: ['hosted-cognition', stagedType, selectedAnswerMode],
          linkedMissionId: effectiveRequestPayload?.missionPacket?.moveId || '',
          linkedPacketId: effectiveRequestPayload?.missionPacket?.missionId || '',
          promotionState: 'pending',
          promotionReason: 'Hosted cognition generated staged item. Staged only, not yet canon.',
          sourceMode: 'hosted-cognition',
          canonicalEligibility: false,
          promotionEligibility: 'requires-explicit-canon-promotion',
          sourceProvenance: 'direct-hosted-worker-dispatch',
        });
      }

      setWorkingMemory((prev) => ({
        ...(prev || {}),
        lastIntentType: executionMetadata.intent_type,
        lastMissionPacketSummary: `${executionMetadata.mission_packet_title} | state=${executionMetadata.mission_packet_state} | mode=${executionMetadata.mission_execution_mode}`,
        acceptedMissionCount: Number(prev?.acceptedMissionCount || 0) + (executionMetadata.mission_packet_state === 'execution-ready' ? 1 : 0),
        blockedMissionCount: Number(prev?.blockedMissionCount || 0) + (executionMetadata.mission_packet_state === 'blocked' ? 1 : 0),
        lastExecutionLifecycleState: executionMetadata.mission_packet_state,
        lastMissionSubsystems: effectiveRequestPayload?.missionPacket?.targetSubsystems || [],
        lastMissionApprovalState: executionMetadata.mission_execution_mode,
      }));

      console.debug('[Stephanos UI] Received AI response', executionMetadata);

      const entry = {
        id: routeUnavailableOutcome ? `cmd_${Date.now()}` : streamEntryId,
        raw_input: prompt,
        parsed_command: parsed,
        role: 'assistant',
        final: streamFinalizationMissing ? false : true,
        route: data.route || 'assistant',
        tool_used: data.tools_used?.[0] ?? null,
        success: data.success,
        output_text: effectiveOutputText,
        stream_buffer_text: streamBuffer,
        stream_finalized: streamFinalizationMissing ? false : true,
        data_payload: data.data,
        timing_ms: data.timing_ms ?? Math.round(performance.now() - startedAt),
        timestamp: new Date().toISOString(),
        error: data.error,
        error_code: data.error_code ?? data.debug?.error_code ?? null,
        response: data,
        continuity_mode: continuityMode,
        continuity_context: continuityContext,
        continuity_retrieval_state: continuityLookup.retrievalState,
        continuity_retrieval_reason: continuityLookup.reason,
      };

      setCommandHistory((prev) => {
        if (routeUnavailableOutcome) return appendCommandHistory(prev, entry);
        return upsertCommandHistoryById(prev, entry, streamEntryId);
      });
      submitAccepted = !routeUnavailableOutcome;
      lastFinalizationPath = routeUnavailableOutcome
        ? 'error'
        : identityRecallDeterministicResult
          ? 'deterministic-identity'
          : agentRealityLoopDeterministicResult
            ? 'deterministic-agent-reality-loop'
            : operatorExplanationDeterministicResult
              ? 'deterministic-operator-explanation'
              : 'provider';
      setLastRoute(data.route || 'assistant');
      setStatus(data.success ? deriveExecutionStatus(executionMetadata) : 'error');

      const providerMessage = !data.success && provider !== 'mock'
        ? `${data.error || 'Provider failed.'} Use Mock instead if you want a zero-cost response.`
        : data.output_text;
      const executionSummary = executionSummaryForStage;

      setApiStatus((prev) => ({
        ...prev,
        state: 'online',
        label: `Connected to ${resolvedRuntimeContext.target} API`,
        detail: data.success
          ? executionSummary
          : `Provider issue: ${providerMessage}`,
        backendReachable: true,
        backendDefaultProvider: executionMetadata.backend_default_provider || prev.backendDefaultProvider,
        lastCheckedAt: new Date().toISOString(),
      }));

      const finalExecutionMetadata = attachChatContextToExecutionMetadata({
        executionMetadata,
        rawExecutionMetadata: data?.data?.execution_metadata || {},
        requestTrace: data?.data?.request_trace || {},
        requestPayload: effectiveRequestPayload || {},
      });

      finalExecutionMetadata.command_pipeline_last_submit_accepted = submitAccepted ? 'yes' : 'no';
      finalExecutionMetadata.command_pipeline_last_submit_attempted = submitAttempted ? 'yes' : 'no';
      finalExecutionMetadata.command_pipeline_submit_block_reason = submitBlockReason;
      finalExecutionMetadata.command_envelope_build_attempted = commandEnvelopeBuildAttempted;
      finalExecutionMetadata.command_envelope_build_error = commandEnvelopeBuildError;
      finalExecutionMetadata.dispatch_gate_allowed = dispatchGateAllowed;
      finalExecutionMetadata.dispatch_gate_reason = dispatchGateReason;
      finalExecutionMetadata.execute_input_present = executeInputPresent ? 'yes' : 'no';
      finalExecutionMetadata.execute_input_length = executeInputLength;
      finalExecutionMetadata.execute_handler_early_return_reason = executeHandlerEarlyReturnReason;
      finalExecutionMetadata.direct_answer_submit_allowed = 'yes';
      finalExecutionMetadata.command_pipeline_last_user_message_recorded = userMessageRecordAttempted === 'yes' && userMessageRecordError === 'none' ? 'yes' : 'no';
      const finalAssistantAnswerVisibleCandidate = data.success && String(effectiveOutputText || '').trim().length > 0 && streamFinalizationMissing !== true;
      const answerDeliveryTruth = buildAnswerDeliveryTruth({
        finalAssistantMessageId: entry?.id || '',
        finalAssistantText: effectiveOutputText,
        finalAssistantPayload: data?.structured_output || data?.output_payload || data?.data?.output_payload || data?.data?.structured_output || null,
        providerExecutionStatus: finalExecutionMetadata.command_envelope_execution_status || finalExecutionMetadata.execution_status || 'unknown',
        answerPaneRendered: finalAssistantAnswerVisibleCandidate,
        responseMode: finalExecutionMetadata.chat_context_response_mode || finalExecutionMetadata.response_planner_response_mode || 'direct-answer',
        operatorExplanationIntentDetected: (finalExecutionMetadata.chat_context_operator_explanation_intent_detected || 'no') === 'yes',
        operatorExplanationProjectionUsed: (finalExecutionMetadata.operator_explanation_projection_used || finalExecutionMetadata.operator_explanation_triggered || 'no') === 'yes',
        operatorExplanationAnswerGenerated: (finalExecutionMetadata.operator_explanation_triggered || 'no') === 'yes',
        executionSuccess: data.success === true,
      });
      Object.assign(finalExecutionMetadata, {
        answer_delivery_status: answerDeliveryTruth.answerDeliveryStatus,
        answer_delivery_generated: answerDeliveryTruth.answerDeliveryGenerated,
        answer_delivery_rendered: answerDeliveryTruth.answerDeliveryRendered,
        final_assistant_message_present: answerDeliveryTruth.finalAssistantMessagePresent,
        final_assistant_message_id: answerDeliveryTruth.finalAssistantMessageId,
        final_assistant_text_length: answerDeliveryTruth.finalAssistantTextLength,
        final_assistant_payload_present: answerDeliveryTruth.finalAssistantPayloadPresent,
        answer_delivery_failure_reason: answerDeliveryTruth.answerDeliveryFailureReason,
        answer_delivery_contradiction_detected: answerDeliveryTruth.answerDeliveryContradictionDetected,
        answer_delivery_next_action: answerDeliveryTruth.answerDeliveryNextAction,
      });
      finalExecutionMetadata.command_pipeline_last_assistant_answer_generated = answerDeliveryTruth.answerDeliveryGenerated;
      finalExecutionMetadata.command_pipeline_last_answer_pane_rendered = answerDeliveryTruth.answerDeliveryRendered;
      finalExecutionMetadata.command_pipeline_last_failure_reason = data.success ? 'none' : (data.error_code || data.error || 'unknown');
      finalExecutionMetadata.command_pipeline_last_finalization_path = lastFinalizationPath;
      finalExecutionMetadata.command_pipeline_last_input_cleared = submitAccepted ? 'yes' : 'no';
      finalExecutionMetadata.command_pipeline_last_input_restore_available = submitAccepted ? 'no' : 'yes';
      finalExecutionMetadata.execute_stage_last_reached = executeStageLastReached;
      finalExecutionMetadata.execute_phase = executePhase;
      finalExecutionMetadata.execute_phase_failure = executePhaseFailure;
      finalExecutionMetadata.execute_stage_failure_reason = executeStageFailureReason;
      finalExecutionMetadata.pre_envelope_phase_safe = preEnvelopePhaseSafe;
      finalExecutionMetadata.pre_envelope_captures_late_variables = preEnvelopeCapturesLateVariables;
      finalExecutionMetadata.envelope_build_id = envelopeBuildId;
      finalExecutionMetadata.user_message_record_id = userMessageRecordId;
      finalExecutionMetadata.pre_envelope_exception_name = preEnvelopeExceptionName;
      finalExecutionMetadata.pre_envelope_exception_message = preEnvelopeExceptionMessage;
      finalExecutionMetadata.envelope_build_skipped_reason = envelopeBuildSkippedReason;
      finalExecutionMetadata.user_message_record_attempted = userMessageRecordAttempted;
      finalExecutionMetadata.user_message_record_error = userMessageRecordError;
      setLastExecutionMetadata(finalExecutionMetadata);

      setDebugData({
        request_payload: effectiveRequestPayload,
        response_payload: data,
        parsed_command: parsed,
        timing_ms: data.timing_ms ?? Math.round(performance.now() - startedAt),
        error: data.error,
        error_code: data.error_code ?? data.debug?.error_code ?? null,
        ui_requested_provider: finalExecutionMetadata.ui_requested_provider,
        backend_default_provider: finalExecutionMetadata.backend_default_provider,
        requested_provider_intent: finalExecutionMetadata.requested_provider_intent,
        execution_requested_provider: finalExecutionMetadata.execution_requested_provider,
        requested_provider: effectiveRequestPayload.provider,
        selected_provider: executionMetadata.selected_provider,
        actual_provider_used: executionMetadata.actual_provider_used,
        model_used: executionMetadata.model_used,
        fallback_used: executionMetadata.fallback_used,
        fallback_reason: executionMetadata.fallback_reason,
        freshness_need: executionMetadata.freshness_need,
        freshness_reason: executionMetadata.freshness_reason,
        stale_risk: executionMetadata.stale_risk,
        selected_answer_mode: executionMetadata.selected_answer_mode,
        freshness_warning: executionMetadata.freshness_warning,
        freshness_routed: executionMetadata.freshness_routed,
        retrieval_mode: executionMetadata.retrieval_mode,
        retrieval_eligible: executionMetadata.retrieval_eligible,
        retrieval_used: executionMetadata.retrieval_used,
        retrieval_reason: executionMetadata.retrieval_reason,
        retrieved_chunk_count: executionMetadata.retrieved_chunk_count,
        retrieved_sources: executionMetadata.retrieved_sources,
        retrieval_query: executionMetadata.retrieval_query,
        retrieval_index_status: executionMetadata.retrieval_index_status,
        memory_eligible: executionMetadata.memory_eligible,
        memory_promoted: executionMetadata.memory_promoted,
        memory_reason: executionMetadata.memory_reason,
        memory_source_type: executionMetadata.memory_source_type,
        memory_source_ref: executionMetadata.memory_source_ref,
        memory_confidence: executionMetadata.memory_confidence,
        memory_class: executionMetadata.memory_class,
        context_assembly_used: executionMetadata.context_assembly_used,
        context_assembly_mode: executionMetadata.context_assembly_mode,
        context_sources_considered: executionMetadata.context_sources_considered,
        context_sources_used: executionMetadata.context_sources_used,
        context_source_reason_map: executionMetadata.context_source_reason_map,
        context_bundle_summary: executionMetadata.context_bundle_summary,
        self_build_prompt_detected: executionMetadata.self_build_prompt_detected,
        self_build_reason: executionMetadata.self_build_reason,
        system_awareness_level: executionMetadata.system_awareness_level,
        augmented_prompt_used: executionMetadata.augmented_prompt_used,
        augmented_prompt_length: executionMetadata.augmented_prompt_length,
        context_assembly_warnings: executionMetadata.context_assembly_warnings,
        context_integrity_preserved: executionMetadata.context_integrity_preserved,
        execution_metadata: executionMetadata,
        providerSelectionSource,
        activeProviderConfigSource: getActiveProviderConfigSource(),
        provider_health: responseProviderHealth,
        provider_diagnostics: data.data?.provider_diagnostics || null,
        frontend_origin: finalizedRequestContext.frontendOrigin,
        frontend_api_base_url: finalizedRequestContext.baseUrl,
        backend_target_endpoint: finalizedRequestContext.backendTargetEndpoint,
        backend_health_endpoint: finalizedRequestContext.healthEndpoint,
        final_route: finalizedRequestContext.finalRoute || null,
        request_trace: data.data?.request_trace || null,
        tile_context_diagnostics: data.data?.tile_context_diagnostics || assembledTileContext?.diagnostics || null,
        continuity_mode: continuityMode,
        continuity_retrieval: continuityLookup,
        continuity_context_summary: continuityContext?.summary || '',
        continuity_context_records: continuityContext?.records || [],
      });
      return { submitAccepted: true, inputCleared: true, restoreInput: false };
    } catch (error) {
      healthRefreshBackoffUntilMsRef.current = Date.now() + 30_000;
      const uiError = transportErrorToUi(error, {
        routeDecision: activeRouteDecision,
      });
      setStatus(uiError.errorCode === 'CANCELLED' ? 'cancelled' : 'error');
      const timeoutDetails = error?.details && typeof error.details === 'object' ? error.details : {};
      const timeoutFailureMetadata = buildTimeoutFailureExecutionMetadata({
        requestPayload: inFlightRequestPayload,
        runtimeContext: inFlightRuntimeContext,
        providerConfigs: effectiveProviderConfigs,
        fallbackProvider: provider,
        timeoutDetails: {
          ...timeoutDetails,
          errorCode: uiError.errorCode,
          cancellationSource: uiError.cancellationSource || timeoutDetails.cancellationSource || null,
        },
      });
      timeoutFailureMetadata.command_pipeline_last_submit_accepted = submitAccepted ? 'yes' : 'no';
      timeoutFailureMetadata.command_pipeline_last_submit_attempted = submitAttempted ? 'yes' : 'no';
      timeoutFailureMetadata.command_pipeline_submit_block_reason = submitBlockReason;
      timeoutFailureMetadata.command_envelope_build_attempted = commandEnvelopeBuildAttempted;
      timeoutFailureMetadata.command_envelope_build_error = commandEnvelopeBuildError;
      timeoutFailureMetadata.dispatch_gate_allowed = dispatchGateAllowed;
      timeoutFailureMetadata.dispatch_gate_reason = dispatchGateReason;
      timeoutFailureMetadata.execute_input_present = executeInputPresent ? 'yes' : 'no';
      timeoutFailureMetadata.execute_input_length = executeInputLength;
      timeoutFailureMetadata.execute_handler_early_return_reason = executeHandlerEarlyReturnReason;
      timeoutFailureMetadata.direct_answer_submit_allowed = 'yes';
      timeoutFailureMetadata.command_pipeline_last_user_message_recorded = userMessageRecordAttempted === 'yes' && userMessageRecordError === 'none' ? 'yes' : 'no';
      timeoutFailureMetadata.command_pipeline_last_assistant_answer_generated = 'no';
      timeoutFailureMetadata.command_pipeline_last_answer_pane_rendered = 'no';
      timeoutFailureMetadata.command_pipeline_last_failure_reason = uiError.errorCode || uiError.error || 'unknown';
      const preEnvelopeStageReached = executeStageLastReached === 'input-normalized'
        || executeStageLastReached === 'submit-accepted'
        || executeStageLastReached === 'message-recorded'
        || executeStageLastReached === 'envelope-build-started';
      if (commandEnvelopeBuildAttempted === 'no' || preEnvelopeStageReached) {
        timeoutFailureMetadata.command_pipeline_last_finalization_path = 'pre-envelope-error';
        preEnvelopeExceptionName = error?.name || 'Error';
        preEnvelopeExceptionMessage = error?.message || 'pre-envelope-error';
        commandEnvelopeBuildError = `${preEnvelopeExceptionName}: ${preEnvelopeExceptionMessage}`;
        envelopeBuildSkippedReason = envelopeBuildSkippedReason === 'none' ? 'pre-envelope-exception' : envelopeBuildSkippedReason;
        const normalizedPreEnvelopeCode = preEnvelopeExceptionName === 'ReferenceError'
          ? 'PRE_ENVELOPE_REFERENCE_ERROR'
          : 'PRE_ENVELOPE_EXCEPTION';
        executeStageFailureReason = executeStageFailureReason === 'none'
          ? `${normalizedPreEnvelopeCode}:${preEnvelopeExceptionMessage}`
          : executeStageFailureReason;
        timeoutFailureMetadata.command_pipeline_last_failure_reason = `${normalizedPreEnvelopeCode}:${preEnvelopeExceptionName}`;
        executePhaseFailure = executeStageFailureReason === 'none' ? `${normalizedPreEnvelopeCode}:${preEnvelopeExceptionMessage}` : executeStageFailureReason;
        preEnvelopePhaseSafe = 'no';
      } else {
        timeoutFailureMetadata.command_pipeline_last_finalization_path = 'error';
      }
      timeoutFailureMetadata.command_pipeline_last_input_cleared = submitAccepted ? 'yes' : 'no';
      timeoutFailureMetadata.command_pipeline_last_input_restore_available = submitAccepted ? 'no' : 'yes';
      timeoutFailureMetadata.execute_stage_last_reached = executeStageLastReached;
      timeoutFailureMetadata.execute_phase = executePhase;
      timeoutFailureMetadata.execute_phase_failure = executePhaseFailure === 'none' ? timeoutFailureMetadata.execute_stage_failure_reason : executePhaseFailure;
      timeoutFailureMetadata.execute_stage_failure_reason = executeStageFailureReason === 'none' ? (uiError.errorCode || uiError.error || 'unknown') : executeStageFailureReason;
      timeoutFailureMetadata.pre_envelope_phase_safe = preEnvelopePhaseSafe;
      timeoutFailureMetadata.pre_envelope_captures_late_variables = preEnvelopeCapturesLateVariables;
      timeoutFailureMetadata.envelope_build_id = envelopeBuildId;
      timeoutFailureMetadata.user_message_record_id = userMessageRecordId;
      timeoutFailureMetadata.pre_envelope_exception_name = preEnvelopeExceptionName;
      timeoutFailureMetadata.pre_envelope_exception_message = preEnvelopeExceptionMessage;
      timeoutFailureMetadata.envelope_build_skipped_reason = envelopeBuildSkippedReason;
      timeoutFailureMetadata.user_message_record_attempted = userMessageRecordAttempted;
      timeoutFailureMetadata.user_message_record_error = userMessageRecordError;
      const preEnvelopeFailureActive = String(timeoutFailureMetadata.command_pipeline_last_finalization_path || '') === 'pre-envelope-error';
      if (preEnvelopeFailureActive) {
        timeoutFailureMetadata.active_provider = 'none';
        timeoutFailureMetadata.fallback_used = 'no';
        timeoutFailureMetadata.last_executable_provider = 'none';
        timeoutFailureMetadata.actual_provider_used = 'none';
        timeoutFailureMetadata.command_envelope_actual_provider = 'none';
        timeoutFailureMetadata.execution_truth = 'pre-envelope-error';
        timeoutFailureMetadata.provider_mismatch = 'no';
        timeoutFailureMetadata.executable_provider = 'none';
      }
      setLastExecutionMetadata(attachChatContextToExecutionMetadata({
        executionMetadata: timeoutFailureMetadata,
        requestPayload: inFlightRequestPayload || {},
      }));
      setApiStatus((prev) => {
        if (uiError.errorCode === 'TIMEOUT' || uiError.errorCode === 'CANCELLED' || uiError.errorCode === 'STREAM_FINALIZATION_MISSING') {
          return {
            ...prev,
            state: 'online',
            label: 'Backend reachable; execution interrupted',
            detail: uiError.output,
            backendReachable: prev.backendReachable !== false,
            lastCheckedAt: new Date().toISOString(),
          };
        }
        return { ...prev, state: 'offline', label: 'Backend offline', detail: uiError.output, backendReachable: false, lastCheckedAt: new Date().toISOString() };
      });

      setCommandHistory((prev) => {
        if (uiError.errorCode === 'CANCELLED' || uiError.errorCode === 'TIMEOUT' || uiError.errorCode === 'STREAM_FINALIZATION_MISSING') {
          let updated = false;
          const next = [...prev].reverse().map((entry) => {
            if (updated || entry?.route !== 'assistant' || entry?.stream_finalized === true) return entry;
            updated = true;
            const partial = String(entry?.stream_buffer_text || '').trim();
            return {
              ...entry,
              success: false,
              output_text: partial || uiError.output,
              stream_finalized: partial ? false : true,
              error: uiError.error,
              error_code: uiError.errorCode,
            };
          }).reverse();
          if (updated) return next;
        }
        return appendCommandHistory(prev, {
          id: `cmd_${Date.now()}`,
          raw_input: prompt,
          parsed_command: parsed,
          route: 'assistant',
          tool_used: null,
          success: false,
          output_text: uiError.output,
          data_payload: null,
          timing_ms: Math.round(performance.now() - startedAt),
          timestamp: new Date().toISOString(),
          error: uiError.error,
          error_code: uiError.errorCode,
          response: { type: 'assistant_response', route: 'assistant', success: false, output_text: uiError.output, error: uiError.error, error_code: uiError.errorCode },
        });
      });
      setDebugData({
        parsed_command: parsed,
        request_payload: inFlightRequestPayload,
        response_payload: null,
        error: uiError.error,
        error_code: uiError.errorCode,
        timeout_failure_layer: uiError.timeoutFailureLayer || timeoutFailureMetadata.timeout_failure_layer || null,
        timeout_failure_label: uiError.timeoutFailureLabel || timeoutFailureMetadata.timeout_failure_label || null,
        ui_request_timeout_ms: uiError.timeoutFailureLabel === 'ui_stream_inactivity_timeout_ms'
          ? null
          : (uiError.timeoutMs || timeoutFailureMetadata.ui_request_timeout_ms || null),
        ui_stream_inactivity_timeout_ms: timeoutFailureMetadata.ui_stream_inactivity_timeout_ms || null,
        backend_route_timeout_ms: timeoutFailureMetadata.backend_route_timeout_ms || null,
        provider_timeout_ms: timeoutFailureMetadata.provider_timeout_ms || null,
        model_timeout_ms: timeoutFailureMetadata.model_timeout_ms || null,
        timeout_policy_source: uiError.timeoutPolicySource || timeoutFailureMetadata.timeout_policy_source || null,
        timeout_effective_provider: timeoutFailureMetadata.timeout_effective_provider || null,
        timeout_effective_model: timeoutFailureMetadata.timeout_effective_model || null,
        timeout_override_applied: Boolean(uiError.timeoutOverrideApplied ?? timeoutFailureMetadata.timeout_override_applied ?? false),
        execution_metadata: timeoutFailureMetadata,
      });
      return { submitAccepted, inputCleared: submitAccepted, restoreInput: !submitAccepted };
    } finally {
      activePromptRequestRef.current = null;
      setIsBusy(false);
    }
    return { submitAccepted, inputCleared: submitAccepted, restoreInput: !submitAccepted };
  }

  const cancelActivePrompt = useCallback(() => {
    if (!activePromptRequestRef.current) return false;
    activePromptRequestRef.current.abort('user-cancel');
    return true;
  }, []);

  const emergencyReleaseOllamaLoad = useCallback(async () => {
    const runtimeConfig = getApiRuntimeConfig();
    const sessionKind = String(runtimeConfig?.sessionKind || '').trim().toLowerCase();
    if (sessionKind && sessionKind !== 'local-desktop') {
      setStatus('warning');
      return { ok: false, message: 'Emergency release is local-desktop only.' };
    }
    const response = await releaseLocalOllamaLoad({
      releaseMode: 'active-request-only',
      source: 'operator-emergency-button',
    }, runtimeConfig);
    setStatus(response?.safeTargetedKillAvailable === true ? 'ready' : 'warning');
    return response;
  }, []);

  function clearConsole() {
    setCommandHistory([]);
    setStatus('idle');
    setLastRoute('assistant');
    setDebugData({});
    setInput('');
  }

  async function runAiButlerAction(mode, { operatorNotes = '' } = {}) {
    setAiActionState((prev) => ({
      ...prev,
      mode,
      isRunning: true,
      error: '',
    }));
    console.info('[AI ACTION] building mission/workspace context', { mode });

    try {
      const missionState = await readMissionDashboardStateFromMemory();
      const context = buildAiActionContext({
        missionState,
        uiLayout,
        paneLayout,
        runtimeStatusModel,
        commandHistory,
        debugData,
        operatorNotes,
      });
      console.info('[AI ACTION] context built from canonical state sources', {
        mode,
        missingContext: context.missingContext,
      });

      const validation = validateAiActionContext(context);
      const missingContext = Object.entries(context.missingContext || {})
        .filter(([, missing]) => missing === true)
        .map(([key]) => key);
      missingContext.forEach((missingSource) => {
        console.warn(`[AI ACTION] missing context source ${missingSource}`);
      });

      if (!validation.hasRequiredCore) {
        const message = 'Runtime truth is unavailable; cannot request AI action yet.';
        setAiActionState({
          mode,
          isRunning: false,
          output: '',
          error: message,
          missingContext,
          generatedAt: new Date().toISOString(),
          contextPreview: context,
          requestedProvider: provider,
          selectedProvider: '',
          executedProvider: '',
          fallbackUsed: null,
        });
        console.warn('[AI ACTION] response rejected due to missing context', {
          mode,
          missingContext,
        });
        return { ok: false, error: message, missingContext };
      }

      const prompt = buildMissionActionPrompt({ mode, context });
      const { runtimeConfig: resolvedRuntimeContext } = await resolveRuntimeConfig();
      const finalizedRequestContext = finalizeRuntimeContext(resolvedRuntimeContext).runtimeContext;
      const assembledTileContext = assembleStephanosContext({
        userPrompt: prompt,
        runtimeContext: finalizedRequestContext,
      });
      console.info(`[AI ACTION] requesting ${mode}`);
      const { data } = await sendPrompt({
        prompt,
        provider,
        routeMode,
        providerConfigs: effectiveProviderConfigs,
        fallbackEnabled,
        fallbackOrder,
        devMode,
        runtimeConfig: finalizedRequestContext,
        tileContext: assembledTileContext,
        streamingMode,
      });
      const actionExecution = normalizeExecutionMetadata({
        data,
        requestPayload: { provider, routeMode },
        backendDefaultProvider: apiStatus?.backendDefaultProvider,
      });
      console.info('[AI ACTION] response received', { mode, success: data.success !== false });
      console.info('[AI ACTION] provider requested <x>', { requestedProvider: actionExecution.requested_provider });
      console.info('[AI ACTION] provider executed <y>', { executedProvider: actionExecution.actual_provider_used });
      console.info('[AI ACTION] fallback active', { fallbackUsed: actionExecution.fallback_used });

      if (!data?.output_text) {
        const message = 'AI action returned an empty response.';
        setAiActionState({
          mode,
          isRunning: false,
          output: '',
          error: message,
          missingContext,
          generatedAt: new Date().toISOString(),
          contextPreview: context,
          requestedProvider: actionExecution.requested_provider || provider,
          selectedProvider: actionExecution.selected_provider || '',
          executedProvider: actionExecution.actual_provider_used || '',
          fallbackUsed: actionExecution.fallback_used,
        });
        return { ok: false, error: message };
      }

      setAiActionState({
        mode,
        isRunning: false,
        output: data.output_text,
        error: '',
        missingContext,
        generatedAt: new Date().toISOString(),
        contextPreview: context,
        requestedProvider: actionExecution.requested_provider || provider,
        selectedProvider: actionExecution.selected_provider || '',
        executedProvider: actionExecution.actual_provider_used || '',
        fallbackUsed: actionExecution.fallback_used,
      });
      return { ok: true, output: data.output_text, missingContext };
    } catch (error) {
      healthRefreshBackoffUntilMsRef.current = Date.now() + 30_000;
      const uiError = transportErrorToUi(error);
      setAiActionState({
        mode,
        isRunning: false,
        output: '',
        error: uiError.output,
        missingContext: [],
        generatedAt: new Date().toISOString(),
        contextPreview: null,
        requestedProvider: provider,
        selectedProvider: '',
        executedProvider: '',
        fallbackUsed: null,
      });
      return { ok: false, error: uiError.output };
    }
  }

  return {
    input,
    setInput,
    commandHistory,
    submitPrompt,
    cancelActivePrompt,
    emergencyReleaseOllamaLoad,
    clearConsole,
    refreshHealth,
    runAiButlerAction,
    aiActionState,
  };
}

// test guard: githubPrEvidence: chatContextPack?.githubPrEvidence || null
