import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseCommand } from '../ai/commandParser';
import { checkApiHealth, getApiRuntimeConfig, getProviderHealth, sendPrompt } from '../ai/aiClient';
import { applyDetectedOllamaConnection, createSearchingOllamaHealth, runOllamaDiscovery, shouldAutoSyncOllama } from '../ai/ollamaRuntimeSync';
import { getApiRuntimeConfigSnapshotKey } from '../ai/apiConfig';
import { resolveUiRequestTimeoutPolicy } from '../ai/timeoutPolicy';
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
import { appendCommandHistory } from './commandHistory.js';
import { evaluateRequestDispatchGate } from './requestDispatchGate.js';
import { normalizeMissionPacketTruth } from '../state/missionPacketWorkflow.js';
import { buildCanonicalMissionPacket } from '../state/runtimeOrchestrationTruth.js';
import { deriveRuntimeOrchestrationSelectors } from '../state/runtimeOrchestrationSelectors.js';
import { adjudicateOperatorLifecycleIntent } from '../state/operatorCommandIntents.js';
import { buildOperatorReplyPayload, resolveOperatorReplyPromptKey } from '../state/operatorReplyAdapter.js';

const BACKEND_UNREACHABLE_MESSAGE = 'Backend unreachable from current frontend origin.';

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

function normalizeExecutionMetadata({ data, requestPayload, backendDefaultProvider }) {
  const executionMetadata = data.data?.execution_metadata || {};
  const requestTrace = data.data?.request_trace || {};
  const contextAssemblyMetadata = requestPayload?.contextAssemblyMetadata || {};
  const actualProviderUsed = executionMetadata.actual_provider_used || data.data?.actual_provider_used || data.data?.provider || null;
  const requestedProviderIntent = requestPayload?.routeDecision?.defaultProvider
    || requestTrace.ui_default_provider
    || executionMetadata.ui_default_provider
    || requestPayload.provider;
  const requestedProviderForRequest = executionMetadata.requested_provider_for_request
    || requestTrace.requested_provider_for_request
    || requestPayload.routeDecision?.requestedProviderForRequest
    || requestPayload.provider;
  const selectedProvider = executionMetadata.selected_provider
    || requestTrace.selected_provider
    || requestPayload.routeDecision?.selectedProvider
    || requestPayload.provider;
  const executionSelectedProvider = executionMetadata.execution_selected_provider
    || requestTrace.execution_selected_provider
    || requestPayload.runtimeContext?.finalRouteTruth?.executedProvider
    || requestPayload.runtimeContext?.canonicalRouteRuntimeTruth?.executedProvider
    || requestPayload.runtimeContext?.finalRouteTruth?.selectedProvider
    || requestPayload.runtimeContext?.canonicalRouteRuntimeTruth?.selectedProvider
    || actualProviderUsed
    || selectedProvider;
  const timeoutEffectiveProvider = actualProviderUsed
    || executionSelectedProvider
    || executionMetadata.timeout_provider
    || requestTrace.timeout_provider
    || requestPayload.runtimeContext?.timeoutPolicy?.timeoutProvider
    || selectedProvider;
  const modelUsed = executionMetadata.model_used || data.data?.model_used || data.data?.provider_model || null;
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

  return {
    ui_default_provider: executionMetadata.ui_default_provider
      || requestTrace.ui_default_provider
      || requestPayload.routeDecision?.defaultProvider
      || requestPayload.provider,
    ui_requested_provider: executionMetadata.ui_requested_provider || requestTrace.ui_requested_provider || requestPayload.provider,
    requested_provider_intent: requestedProviderIntent,
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
    actual_provider_used: actualProviderUsed,
    model_used: modelUsed,
    ollama_model_default: executionMetadata.ollama_model_default || requestTrace.ollama_model_default || null,
    ollama_model_preferred: executionMetadata.ollama_model_preferred || requestTrace.ollama_model_preferred || null,
    ollama_model_requested: executionMetadata.ollama_model_requested || requestTrace.ollama_model_requested || null,
    ollama_model_selected: executionMetadata.ollama_model_selected || requestTrace.ollama_model_selected || null,
    ollama_reasoning_mode: executionMetadata.ollama_reasoning_mode || requestTrace.ollama_reasoning_mode || null,
    ollama_escalation_active: Boolean(executionMetadata.ollama_escalation_active ?? requestTrace.ollama_escalation_active ?? false),
    ollama_escalation_reason: executionMetadata.ollama_escalation_reason || requestTrace.ollama_escalation_reason || null,
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
    freshness_candidate_provider: executionMetadata.freshness_candidate_provider
      || requestTrace.freshness_candidate_provider
      || requestPayload.routeDecision?.freshnessCandidateProvider
      || null,
    timeout_override_applied: Boolean(
      executionMetadata.timeout_override_applied
      ?? requestTrace.timeout_override_applied
      ?? requestPayload.runtimeContext?.timeoutPolicy?.timeoutOverrideApplied
      ?? false,
    ),
    timeout_failure_layer: executionMetadata.timeout_failure_layer || requestTrace.timeout_failure_layer || null,
    timeout_failure_label: executionMetadata.timeout_failure_label || requestTrace.timeout_failure_label || null,
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
  const errorCode = dispatchBlockedDespiteUsableRoute ? 'PROVIDER_EXECUTION_CONTRACT_MISMATCH' : 'ROUTE_UNAVAILABLE';

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
          requested_provider_for_request: requestPayload.routeDecision?.requestedProviderForRequest || requestPayload.provider,
          requested_provider: requestPayload.provider,
          selected_provider: routeDecision?.selectedProvider || requestPayload.provider,
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
          route_unavailable_reason: fallbackReason,
          provider_execution_block_reason: dispatchBlockedDespiteUsableRoute ? fallbackReason : null,
          route_provider_mismatch_blocker: routeProviderMismatchBlocker,
          fallback_veto_reason: fallbackVetoReason,
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
  if (error.code === 'NETWORK_TRANSPORT_UNREACHABLE') {
    return { error: error.message, errorCode: error.code, output: 'Network transport failed before backend response. Check browser-to-backend reachability and CORS/published client route truth.' };
  }
  if (error.code === 'INVALID_JSON') {
    return { error: error.message, errorCode: error.code, output: 'Backend responded with invalid JSON. Check server logs for serialization issues.' };
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

  return {
    ui_default_provider: requestPayload?.routeDecision?.defaultProvider || fallbackProvider || selectedProvider || 'unknown',
    ui_requested_provider: requestedProvider || fallbackProvider || 'unknown',
    requested_provider_intent: requestPayload?.routeDecision?.defaultProvider || fallbackProvider || selectedProvider || 'unknown',
    requested_provider_for_request: requestedProvider || fallbackProvider || 'unknown',
    backend_default_provider: 'unknown',
    route_mode: requestPayload?.routeMode || 'auto',
    effective_route_mode: requestPayload?.routeMode || 'auto',
    requested_provider: requestedProvider || fallbackProvider || 'unknown',
    selected_provider: requestPayload?.routeDecision?.selectedProvider || selectedProvider || fallbackProvider || 'unknown',
    execution_selected_provider: selectedProvider || fallbackProvider || 'unknown',
    actual_provider_used: '',
    model_used: requestedModel || null,
    ollama_timeout_ms: selectedProvider === 'ollama'
      ? (timeoutDetails.providerTimeoutMs ?? canonicalTimeoutPolicy.providerTimeoutMs ?? null)
      : null,
    ollama_timeout_source: selectedProvider === 'ollama'
      ? (timeoutDetails.timeoutPolicySource || canonicalTimeoutPolicy.timeoutPolicySource || null)
      : null,
    ollama_timeout_model: selectedProvider === 'ollama'
      ? (timeoutDetails.timeoutModel || canonicalTimeoutPolicy.timeoutModel || requestedModel || null)
      : null,
    ui_request_timeout_ms: timeoutDetails.timeoutMs ?? timeoutDetails.uiRequestTimeoutMs ?? canonicalTimeoutPolicy.uiRequestTimeoutMs ?? null,
    backend_route_timeout_ms: timeoutDetails.backendRouteTimeoutMs ?? canonicalTimeoutPolicy.backendRouteTimeoutMs ?? null,
    provider_timeout_ms: timeoutDetails.providerTimeoutMs ?? canonicalTimeoutPolicy.providerTimeoutMs ?? null,
    model_timeout_ms: timeoutDetails.modelTimeoutMs ?? canonicalTimeoutPolicy.modelTimeoutMs ?? null,
    timeout_policy_source: timeoutDetails.timeoutPolicySource || canonicalTimeoutPolicy.timeoutPolicySource || null,
    timeout_effective_provider: timeoutDetails.timeoutProvider || selectedProvider || null,
    timeout_effective_model: timeoutDetails.timeoutModel || canonicalTimeoutPolicy.timeoutModel || requestedModel || null,
    timeout_override_applied: Boolean(
      timeoutDetails.timeoutOverrideApplied
      ?? canonicalTimeoutPolicy.timeoutOverrideApplied
      ?? false,
    ),
    timeout_failure_layer: timeoutDetails.timeoutFailureLayer || null,
    timeout_failure_label: timeoutDetails.timeoutLabel || null,
    fallback_used: false,
    fallback_reason: null,
    freshness_need: requestPayload?.freshnessContext?.freshnessNeed || 'low',
    freshness_reason: requestPayload?.freshnessContext?.freshnessReason || 'n/a',
    stale_risk: requestPayload?.freshnessContext?.staleRisk || 'low',
    selected_answer_mode: requestPayload?.routeDecision?.selectedAnswerMode || 'local-private',
    override_denial_reason: requestPayload?.routeDecision?.overrideDeniedReason || null,
    freshness_warning: requestPayload?.routeDecision?.freshnessWarning || null,
    freshness_routed: Boolean(requestPayload?.routeDecision?.freshnessRouted ?? false),
    freshness_candidate_provider: requestPayload?.routeDecision?.freshnessCandidateProvider || null,
    ai_policy_mode: requestPayload?.routeDecision?.aiPolicy?.aiPolicyMode || 'local-first-cloud-when-needed',
    ai_policy_reason: requestPayload?.routeDecision?.policyReason || 'Local-first policy applied.',
  };
}

function buildPreArmTimeoutExecutionEnvelope({
  routeDecision = {},
  runtimeStatus = {},
  requestedProvider = '',
  providerConfigs = {},
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
  const effectiveModel = String(providerConfigs?.[effectiveProvider]?.model || '').trim();

  return {
    requestedProvider: requestedProviderNormalized || requestedProvider || '',
    effectiveProvider: effectiveProvider || requestedProviderNormalized || requestedProvider || '',
    effectiveModel: effectiveModel || null,
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
    debugData,
    reportSurfaceFriction,
    setSurfaceOverride,
    explainMemoryToOperator,
  } = useAIStore();

  const runtimeConfigKey = getApiRuntimeConfigSnapshotKey();
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
  const providerHealthRef = useRef(providerHealth);
  const effectiveProviderConfigs = useMemo(() => getEffectiveProviderConfigs(), [getEffectiveProviderConfigs]);
  const ollamaDraftConfig = effectiveProviderConfigs.ollama || {};
  const ollamaHealth = providerHealth.ollama || {};

  useEffect(() => {
    providerHealthRef.current = providerHealth;
  }, [providerHealth]);

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
        ...(resolvedRuntimeContext.routeDiagnostics || {}),
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


  const refreshHealth = useCallback(async () => {
    let resolvedRuntimeContext = runtimeConfig;

    try {
      ({ runtimeConfig: resolvedRuntimeContext } = await resolveRuntimeConfig());
      const health = await checkApiHealth(resolvedRuntimeContext);
      const hydratedRuntimeContext = buildRuntimeContextFromHealth(resolvedRuntimeContext, health);
      const providerHealth = await getProviderHealth({ provider, routeMode, providerConfigs: effectiveProviderConfigs, fallbackEnabled, fallbackOrder, devMode, runtimeContext: hydratedRuntimeContext }, hydratedRuntimeContext);
      const nextProviderHealth = providerHealth.data || {};
      setProviderHealth(nextProviderHealth);
      ['groq', 'gemini'].forEach((providerKey) => {
        const health = nextProviderHealth?.[providerKey] || {};
        const ok = health.ok === true;
        setHostedCloudCognitionHealth(providerKey, {
          status: ok ? 'healthy' : (health.detail ? 'unhealthy' : 'unknown'),
          reason: String(health.detail || health.reason || (ok ? 'Provider reachable.' : 'No provider health data yet.')),
          checkedAt: new Date().toISOString(),
          lastSuccessAt: ok ? new Date().toISOString() : (hostedCloudCognition?.lastHealth?.[providerKey]?.lastSuccessAt || ''),
          lastFailureAt: ok ? (hostedCloudCognition?.lastHealth?.[providerKey]?.lastFailureAt || '') : new Date().toISOString(),
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
        runtimeContext: finalized.runtimeContext,
        lastCheckedAt: new Date().toISOString(),
        meta: {
          ...(health.data || {}),
          final_route: finalized.runtimeStatus.finalRoute,
        },
      });
    } catch (error) {
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
        runtimeContext: finalized.runtimeContext,
        lastCheckedAt: new Date().toISOString(),
        meta: null,
      });
    }
  }, [runtimeConfig, setApiStatus, provider, routeMode, effectiveProviderConfigs, fallbackEnabled, fallbackOrder, devMode, setProviderHealth, resolveRuntimeConfig, buildRuntimeContextFromHealth, setHomeNodeLastKnown, setHomeNodeStatus, finalizeRuntimeContext, setHostedCloudCognitionHealth, hostedCloudCognition?.lastHealth]);

  useEffect(() => {
    void refreshHealth();
    // Intentionally execute only once at mount; interval and visibility handlers perform subsequent refreshes.
    // This prevents dependency churn from creating refresh feedback loops.
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let intervalId = null;
    const runRefresh = () => {
      void refreshHealth();
    };
    const restartPolling = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
      }
      const pollIntervalMs = document.visibilityState === 'visible' ? 60_000 : 180_000;
      intervalId = window.setInterval(runRefresh, pollIntervalMs);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        runRefresh();
      }
      restartPolling();
    };

    restartPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshHealth]);

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

  async function submitPrompt(rawPrompt, { telemetryEntries = [], orchestrationTruth = null } = {}) {
    const prompt = rawPrompt.trim();
    if (!prompt) return;
    if (prompt === '/clear') {
      clearConsole();
      return;
    }

    const normalizedPrompt = prompt.toLowerCase();
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
    };
    const runtimeSelectors = orchestrationTruth?.selectors || null;


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

    try {
      const { runtimeConfig: resolvedRuntimeContext } = await resolveRuntimeConfig();
      const finalizedRequestContext = finalizeRuntimeContext(resolvedRuntimeContext).runtimeContext;
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
      const requestRouteTruthView = buildFinalRouteTruthView(requestRuntimeStatus);
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
        runtimeContext: finalizedRequestContext,
      }));
      const requestedProvider = freshnessRouteDecision.requestedProviderForRequest
        || freshnessRouteDecision.selectedProvider
        || provider;
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
      const requestPayload = {
        provider: requestedProvider,
        routeMode: routeModeForRequest,
        freshnessContext: freshnessClassification,
        routeDecision: freshnessRouteDecision,
        contextAssemblyMetadata: contextAssembly.truthMetadata,
        intentResult,
        missionPacket,
      };
      inFlightRequestPayload = requestPayload;
      const requestDispatchGate = evaluateRequestDispatchGate({
        routeDecision: freshnessRouteDecision,
        routeTruthView: requestRouteTruthView,
        runtimeStatus: requestRuntimeStatus,
      });
      freshnessRouteDecision.requestDispatchGate = requestDispatchGate;
      const timeoutExecutionEnvelope = buildPreArmTimeoutExecutionEnvelope({
        routeDecision: freshnessRouteDecision,
        runtimeStatus: requestRuntimeStatus,
        requestedProvider,
        providerConfigs: effectiveProviderConfigs,
      });
      const runtimeConfigWithExecutionTruth = {
        ...finalizedRequestContext,
        finalRouteTruth: requestRuntimeStatus?.finalRouteTruth || finalizedRequestContext?.finalRouteTruth || {},
        canonicalRouteRuntimeTruth: requestRuntimeStatus?.canonicalRouteRuntimeTruth || finalizedRequestContext?.canonicalRouteRuntimeTruth || {},
        timeoutExecutionEnvelope,
      };
      inFlightRuntimeContext = runtimeConfigWithExecutionTruth;
      const routeDispatchBlocked = requestDispatchGate.dispatchAllowed !== true;
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
      const routeUnavailableResult = routeDispatchBlocked
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
      const { data, requestPayload: effectiveRequestPayload } = routeUnavailableResult || await sendPrompt({
        prompt: contextAssembly.truthMetadata.augmented_prompt_used ? contextAssembly.augmentedPrompt : prompt,
        provider: requestedProvider,
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
      });

      if (
        data.success
        && freshnessRouteDecision.selectedAnswerMode === 'fallback-stale-risk'
        && freshnessRouteDecision.freshnessWarning
      ) {
        data.output_text = `[Freshness warning] ${freshnessRouteDecision.freshnessWarning}\n\n${data.output_text}`;
      }

      const providerHealth = data.data?.provider_health || {};
      if (Object.keys(providerHealth).length) {
        setProviderHealth(providerHealth);
      }

      const executionMetadataBase = normalizeExecutionMetadata({
        data,
        requestPayload: effectiveRequestPayload,
        backendDefaultProvider: apiStatus.backendDefaultProvider,
      });
      const executionMetadata = {
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
      };
      const executionSummaryForStage = buildExecutionSummary(executionMetadata);

      const selectedAnswerMode = String(executionMetadata.selected_answer_mode || '').trim().toLowerCase();
      const hostedProvider = String(
        executionMetadata.actual_provider_used
        || executionMetadata.execution_selected_provider
        || executionMetadata.selected_provider
        || '',
      ).trim().toLowerCase();
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
          sourceAuthorityLevel: 'hosted-observer',
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
        id: `cmd_${Date.now()}`,
        raw_input: prompt,
        parsed_command: parsed,
        route: data.route,
        tool_used: data.tools_used?.[0] ?? null,
        success: data.success,
        output_text: data.output_text,
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

      setCommandHistory((prev) => appendCommandHistory(prev, entry));
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

      setLastExecutionMetadata(executionMetadata);

      setDebugData({
        request_payload: effectiveRequestPayload,
        response_payload: data,
        parsed_command: parsed,
        timing_ms: data.timing_ms ?? Math.round(performance.now() - startedAt),
        error: data.error,
        error_code: data.error_code ?? data.debug?.error_code ?? null,
        ui_requested_provider: executionMetadata.ui_requested_provider,
        backend_default_provider: executionMetadata.backend_default_provider,
        requested_provider_intent: executionMetadata.requested_provider_intent,
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
        provider_health: providerHealth,
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
    } catch (error) {
      const uiError = transportErrorToUi(error, {
        routeDecision: activeRouteDecision,
      });
      setStatus('error');
      const timeoutDetails = error?.details && typeof error.details === 'object' ? error.details : {};
      const timeoutFailureMetadata = buildTimeoutFailureExecutionMetadata({
        requestPayload: inFlightRequestPayload,
        runtimeContext: inFlightRuntimeContext,
        providerConfigs: effectiveProviderConfigs,
        fallbackProvider: provider,
        timeoutDetails,
      });
      setLastExecutionMetadata(timeoutFailureMetadata);
      setApiStatus((prev) => ({ ...prev, state: 'offline', label: 'Backend offline', detail: uiError.output, backendReachable: false, lastCheckedAt: new Date().toISOString() }));

      setCommandHistory((prev) => appendCommandHistory(prev, {
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
      }));
      setDebugData({
        parsed_command: parsed,
        request_payload: inFlightRequestPayload,
        response_payload: null,
        error: uiError.error,
        error_code: uiError.errorCode,
        timeout_failure_layer: uiError.timeoutFailureLayer || timeoutFailureMetadata.timeout_failure_layer || null,
        timeout_failure_label: uiError.timeoutFailureLabel || timeoutFailureMetadata.timeout_failure_label || null,
        ui_request_timeout_ms: uiError.timeoutMs || timeoutFailureMetadata.ui_request_timeout_ms || null,
        backend_route_timeout_ms: timeoutFailureMetadata.backend_route_timeout_ms || null,
        provider_timeout_ms: timeoutFailureMetadata.provider_timeout_ms || null,
        model_timeout_ms: timeoutFailureMetadata.model_timeout_ms || null,
        timeout_policy_source: uiError.timeoutPolicySource || timeoutFailureMetadata.timeout_policy_source || null,
        timeout_effective_provider: timeoutFailureMetadata.timeout_effective_provider || null,
        timeout_effective_model: timeoutFailureMetadata.timeout_effective_model || null,
        timeout_override_applied: Boolean(uiError.timeoutOverrideApplied ?? timeoutFailureMetadata.timeout_override_applied ?? false),
        execution_metadata: timeoutFailureMetadata,
      });
    } finally {
      setIsBusy(false);
    }
  }

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
    clearConsole,
    refreshHealth,
    runAiButlerAction,
    aiActionState,
  };
}
