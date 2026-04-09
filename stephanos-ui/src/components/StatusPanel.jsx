import { useState } from 'react';
import { buildProviderStatusSummary, resolveProviderEndpointForDisplay } from '../ai/providerConfig';
import { useAIStore } from '../state/aiStore';
import { ensureRuntimeStatusModel } from '../state/runtimeStatusDefaults';
import { buildFinalRouteTruthView } from '../state/finalRouteTruthView';
import { buildSupportSnapshot } from '../state/supportSnapshot';
import { deriveContinuityLoopSnapshot } from '../state/continuityLoopSnapshot.js';
import {
  STEPHANOS_UI_BUILD_TARGET,
  STEPHANOS_UI_BUILD_TARGET_IDENTIFIER,
  STEPHANOS_UI_BUILD_TIMESTAMP,
  STEPHANOS_UI_GIT_COMMIT,
  STEPHANOS_UI_RUNTIME_ID,
  STEPHANOS_UI_RUNTIME_MARKER,
  STEPHANOS_UI_SOURCE,
  STEPHANOS_UI_SOURCE_FINGERPRINT,
  STEPHANOS_UI_VERSION,
} from '../runtimeInfo';
import {
  STEPHANOS_PROVIDER_ROUTING_MARKER,
  STEPHANOS_ROUTE_ADOPTION_MARKER,
} from '../../../shared/runtime/stephanosRouteMarkers.mjs';
import CollapsiblePanel from './CollapsiblePanel';

export default function StatusPanel() {
  const [copyNotice, setCopyNotice] = useState(null);
  const {
    status,
    isBusy,
    lastRoute,
    commandHistory,
    apiStatus,
    provider,
    providerSelectionSource,
    routeMode,
    devMode,
    fallbackEnabled,
    disableHomeNodeForLocalSession,
    fallbackOrder,
    providerHealth,
    getActiveProviderConfig,
    getEffectiveProviderConfig,
    getActiveProviderConfigSource,
    uiDiagnostics,
    lastExecutionMetadata,
    runtimeStatusModel,
    uiLayout,
    togglePanel,
    workingMemory,
    projectMemory,
    sessionRestoreDiagnostics,
    homeNodeStatus,
  } = useAIStore();

  const safeApiStatus = apiStatus || {};
  const safeProviderHealth = providerHealth && typeof providerHealth === 'object' ? providerHealth : {};
  const safeUiLayout = uiLayout || {};
  const safeCommandHistory = Array.isArray(commandHistory) ? commandHistory : [];
  const safeSessionRestoreDiagnostics = sessionRestoreDiagnostics || { message: 'Portable session state restored.', reasons: [], ignoredFields: [] };
  const safeWorkingMemory = workingMemory || { recentCommands: [], currentTask: '', activeFocusLabel: '', missionNote: '' };
  const safeProjectMemory = projectMemory || { currentMilestone: '' };
  const latest = safeCommandHistory[safeCommandHistory.length - 1];
  const continuityMode = latest?.continuity_mode || 'recording-only';
  const activeConfig = getActiveProviderConfig();
  const statusSummary = buildProviderStatusSummary(provider, activeConfig, safeApiStatus.baseUrl, safeProviderHealth[provider]);
  const runtimeStatus = ensureRuntimeStatusModel(runtimeStatusModel);
  // finalRoute is the sole resolved route truth for UI rendering; guardrails report when any projection drifts.
  const finalRoute = runtimeStatus.finalRoute ?? {};
  const finalRouteTruth = runtimeStatus.finalRouteTruth ?? {};
  const runtimeTruth = runtimeStatus.runtimeTruth ?? {};
  const canonicalTruth = runtimeStatus.canonicalRouteRuntimeTruth ?? {};
  const adjudication = runtimeStatus.runtimeAdjudication ?? { issues: [] };
  const runtimeSessionTruth = runtimeTruth.session ?? {};
  const runtimeRouteTruth = runtimeTruth.route ?? {};
  const runtimeReachabilityTruth = runtimeTruth.reachabilityTruth ?? {};
  const runtimeProviderTruth = runtimeTruth.provider ?? {};
  const runtimeDiagnosticsTruth = runtimeTruth.diagnostics ?? {};
  const routeTruthView = buildFinalRouteTruthView(runtimeStatus);
  const continuitySnapshot = deriveContinuityLoopSnapshot({ runtimeStatus, commandHistory: safeCommandHistory });
  const providerEligibility = runtimeTruth.providerEligibility ?? finalRoute.providerEligibility ?? {};
  const reachability = runtimeTruth.reachabilityRaw ?? runtimeTruth.reachability ?? finalRoute.reachability ?? {};
  const runtimeContext = runtimeStatus.runtimeContext ?? {};
  const homeNodeDiagnostics = runtimeContext.routeDiagnostics?.['home-node'] ?? {};
  const interactionAuditSummary = [
    `click:${uiDiagnostics.homeNodeInputClickReceived ? 'yes' : 'no'}`,
    `focus:${uiDiagnostics.homeNodeInputFocusReceived ? 'yes' : 'no'}`,
    `input:${uiDiagnostics.homeNodeInputEventReceived ? 'yes' : 'no'}`,
    `state-updated:${uiDiagnostics.homeNodeInputStateUpdated ? 'yes' : 'no'}`,
    `overwritten:${uiDiagnostics.homeNodeInputStateOverwritten ? 'yes' : 'no'}`,
  ].join(' · ');
  const homeNodeAttempts = Array.isArray(homeNodeStatus?.attempts) ? homeNodeStatus.attempts : [];
  const runtimeDiagnostics = uiDiagnostics.runtimeDiagnostics || {};
  const homeNodeAttemptSummary = homeNodeAttempts.length
    ? homeNodeAttempts.map((attempt) => {
      const base = `${attempt.source || 'unknown'}:${attempt.host || 'unknown'}`;
      return attempt.ok
        ? `${base} accepted`
        : `${base} rejected (${attempt.failureDetail || attempt.reason || 'unknown failure'})`;
    }).join(' | ')
    : 'no probe attempts captured';
  const homeNodeActionMatch = String(homeNodeDiagnostics.blockedReason || homeNodeDiagnostics.reason || '')
    .match(/Action:\s*([^]+)$/i);
  const homeNodeAction = homeNodeActionMatch?.[1]?.trim() || 'n/a';
  const guardrails = runtimeStatus.guardrails ?? { summary: { total: 0, errors: 0, warnings: 0 }, errors: [], warnings: [] };
  const primaryGuardrailMessage = guardrails.errors?.[0]?.message || guardrails.warnings?.[0]?.message || 'none';
  const executionTruth = isBusy
    ? 'busy'
    : !lastExecutionMetadata?.actual_provider_used
      ? status
      : lastExecutionMetadata.provider_answered === false
        ? `failed via ${lastExecutionMetadata.actual_provider_used}`
      : lastExecutionMetadata.fallback_used
        ? `fallback via ${lastExecutionMetadata.actual_provider_used} after ${lastExecutionMetadata.requested_provider_for_request || lastExecutionMetadata.selected_provider || 'selected-provider'} failure`
        : lastExecutionMetadata.actual_provider_used === 'mock'
          ? 'mock response'
          : `${lastExecutionMetadata.actual_provider_used} answered`;
  const responseTruth = lastExecutionMetadata?.actual_provider_used
    ? (lastExecutionMetadata.actual_provider_used === 'mock' ? 'mock' : 'live')
    : 'n/a';
  const providerEndpointDisplay = resolveProviderEndpointForDisplay({
    providerKey: provider,
    config: activeConfig,
    runtimeContext,
    sessionRestoreDiagnostics,
  });
  const readyCloudProviders = runtimeStatus.readyCloudProviders.length > 0 ? runtimeStatus.readyCloudProviders.join(', ') : 'pending';
  const readyLocalProviders = runtimeStatus.readyLocalProviders.length > 0 ? runtimeStatus.readyLocalProviders.join(', ') : 'pending';
  const attemptOrder = runtimeStatus.attemptOrder.length > 0 ? runtimeStatus.attemptOrder.join(' → ') : 'pending';
  const sessionRestoreReason = safeSessionRestoreDiagnostics.reasons?.[0] || runtimeContext.restoreDecision || 'Portable session state restored.';
  const browserWindow = typeof window !== 'undefined' ? window : null;
  const browserNavigator = typeof navigator !== 'undefined' ? navigator : null;
  const snapshotProviderKey = routeTruthView.selectedProvider || routeTruthView.executedProvider || provider;
  const snapshotProviderConfig = (typeof getEffectiveProviderConfig === 'function'
    ? getEffectiveProviderConfig(snapshotProviderKey)
    : null) || activeConfig;
  const snapshotStatusSummary = buildProviderStatusSummary(
    snapshotProviderKey,
    snapshotProviderConfig,
    safeApiStatus.baseUrl,
    safeProviderHealth[snapshotProviderKey],
  );
  const snapshotProviderEndpointDisplay = resolveProviderEndpointForDisplay({
    providerKey: snapshotProviderKey,
    config: snapshotProviderConfig,
    runtimeContext,
    sessionRestoreDiagnostics,
  });
  const notifyCopyResult = (message, tone) => {
    setCopyNotice({ message, tone });
    globalThis.setTimeout(() => {
      setCopyNotice((current) => (current?.message === message ? null : current));
    }, 2800);
  };
  const supportSnapshot = buildSupportSnapshot({
    runtimeStatus: {
      ...runtimeStatus,
      providerSelectionSource,
      activeProviderConfigSource: getActiveProviderConfigSource(),
      devMode,
      fallbackEnabled,
      providerEndpoint: snapshotProviderEndpointDisplay,
      providerModel: snapshotStatusSummary.model,
      lastUiDefaultProvider: lastExecutionMetadata?.ui_default_provider || provider,
      lastUiRequestedProvider: lastExecutionMetadata?.ui_requested_provider,
      lastRequestedProviderIntent: lastExecutionMetadata?.requested_provider_intent || 'n/a',
      lastFreshnessCandidateProvider: lastExecutionMetadata?.freshness_candidate_provider || 'n/a',
      lastRequestedProviderForRequest: lastExecutionMetadata?.requested_provider_for_request || lastExecutionMetadata?.requested_provider,
      lastFallbackProviderUsed: lastExecutionMetadata?.fallback_provider_used || 'n/a',
      lastBackendDefaultProvider: lastExecutionMetadata?.backend_default_provider || safeApiStatus.backendDefaultProvider,
      lastRequestedProvider: lastExecutionMetadata?.requested_provider
        || lastExecutionMetadata?.requested_provider_for_request
        || routeTruthView.requestedProvider,
      lastRequestSelectedProvider: lastExecutionMetadata?.selected_provider || 'n/a',
      lastSelectedProvider: lastExecutionMetadata?.execution_selected_provider
        || lastExecutionMetadata?.actual_provider_used
        || lastExecutionMetadata?.timeout_effective_provider
        || routeTruthView?.executedProvider
        || routeTruthView?.selectedProvider
        || 'n/a',
      lastActualProviderUsed: lastExecutionMetadata?.actual_provider_used,
      lastModelUsed: lastExecutionMetadata?.model_used,
      lastOllamaModelDefault: lastExecutionMetadata?.ollama_model_default || 'n/a',
      lastOllamaModelPreferred: lastExecutionMetadata?.ollama_model_preferred || 'n/a',
      lastOllamaModelRequested: lastExecutionMetadata?.ollama_model_requested || 'n/a',
      lastOllamaModelSelected: lastExecutionMetadata?.ollama_model_selected || 'n/a',
      lastOllamaReasoningMode: lastExecutionMetadata?.ollama_reasoning_mode || 'n/a',
      lastOllamaEscalationActive: String(lastExecutionMetadata?.ollama_escalation_active ?? 'n/a'),
      lastOllamaEscalationReason: lastExecutionMetadata?.ollama_escalation_reason || 'n/a',
      lastOllamaFallbackModel: lastExecutionMetadata?.ollama_fallback_model || 'n/a',
      lastOllamaFallbackModelUsed: String(lastExecutionMetadata?.ollama_fallback_model_used ?? 'n/a'),
      lastOllamaFallbackReason: lastExecutionMetadata?.ollama_fallback_reason || 'n/a',
      lastOllamaTimeoutMs: String(lastExecutionMetadata?.ollama_timeout_ms ?? 'n/a'),
      lastOllamaTimeoutSource: lastExecutionMetadata?.ollama_timeout_source || 'n/a',
      lastOllamaTimeoutModel: lastExecutionMetadata?.ollama_timeout_model || 'n/a',
      lastUiRequestTimeoutMs: String(lastExecutionMetadata?.ui_request_timeout_ms ?? 'n/a'),
      lastBackendRouteTimeoutMs: String(lastExecutionMetadata?.backend_route_timeout_ms ?? 'n/a'),
      lastProviderTimeoutMs: String(lastExecutionMetadata?.provider_timeout_ms ?? 'n/a'),
      lastModelTimeoutMs: String(lastExecutionMetadata?.model_timeout_ms ?? 'n/a'),
      lastTimeoutPolicySource: lastExecutionMetadata?.timeout_policy_source || 'n/a',
      lastTimeoutEffectiveProvider: lastExecutionMetadata?.timeout_effective_provider || 'n/a',
      lastTimeoutEffectiveModel: lastExecutionMetadata?.timeout_effective_model || 'n/a',
      lastTimeoutOverrideApplied: String(lastExecutionMetadata?.timeout_override_applied ?? 'n/a'),
      lastTimeoutFailureLayer: lastExecutionMetadata?.timeout_failure_layer || 'n/a',
      lastTimeoutFailureLabel: lastExecutionMetadata?.timeout_failure_label || 'n/a',
      lastGroqEndpointUsed: lastExecutionMetadata?.groq_endpoint_used || 'n/a',
      lastGroqModelUsed: lastExecutionMetadata?.groq_model_used || 'n/a',
      lastGroqFreshWebActive: String(lastExecutionMetadata?.groq_fresh_web_active ?? 'n/a'),
      lastGroqFreshCandidateAvailable: String(lastExecutionMetadata?.groq_fresh_web_candidate_available ?? 'n/a'),
      lastGroqFreshCandidateModel: lastExecutionMetadata?.groq_fresh_candidate_model || 'n/a',
      lastGroqFreshWebPath: lastExecutionMetadata?.groq_fresh_web_path || 'n/a',
      lastGroqCapabilityReason: lastExecutionMetadata?.groq_capability_reason || 'n/a',
      lastZeroCostPolicy: String(lastExecutionMetadata?.zero_cost_policy ?? statusSummary.providerCapability?.zeroCostPolicy ?? 'n/a'),
      lastPaidFreshRoutesEnabled: String(lastExecutionMetadata?.paid_fresh_routes_enabled ?? statusSummary.providerCapability?.paidFreshRoutesEnabled ?? 'n/a'),
      lastFreshCapabilityMode: lastExecutionMetadata?.fresh_capability_mode || statusSummary.providerCapability?.freshCapabilityMode || 'n/a',
      lastResponseTruth: responseTruth,
      lastFallbackUsed: lastExecutionMetadata ? (lastExecutionMetadata.fallback_used ? 'yes' : 'no') : 'n/a',
      lastFallbackReason: lastExecutionMetadata?.fallback_reason,
      lastSelectedProviderHealthOk: String(lastExecutionMetadata?.selected_provider_health_ok ?? 'n/a'),
      lastSelectedProviderHealthState: lastExecutionMetadata?.selected_provider_health_state || 'n/a',
      lastSelectedProviderExecutionViability: lastExecutionMetadata?.selected_provider_execution_viability || 'n/a',
      lastSelectedProviderExecutionFailureLayer: lastExecutionMetadata?.selected_provider_execution_failure_layer || 'n/a',
      lastSelectedProviderExecutionFailureLabel: lastExecutionMetadata?.selected_provider_execution_failure_label || 'n/a',
      lastSelectedProviderExecutionFailurePhase: lastExecutionMetadata?.selected_provider_execution_failure_phase || 'n/a',
      lastSelectedProviderTimeoutCategory: lastExecutionMetadata?.selected_provider_timeout_category || 'n/a',
      lastSelectedProviderModelWarmupLikely: String(lastExecutionMetadata?.selected_provider_model_warmup_likely ?? 'n/a'),
      lastSelectedProviderWarmupRetryApplied: String(lastExecutionMetadata?.selected_provider_warmup_retry_applied ?? 'n/a'),
      lastSelectedProviderWarmupRetryTimeoutMs: String(lastExecutionMetadata?.selected_provider_warmup_retry_timeout_ms ?? 'n/a'),
      lastSelectedProviderElapsedMs: String(lastExecutionMetadata?.selected_provider_elapsed_ms ?? 'n/a'),
      lastExplicitProviderFallbackPolicyTriggered: String(lastExecutionMetadata?.explicit_provider_fallback_policy_triggered ?? 'n/a'),
      lastEffectiveAnswerMode: lastExecutionMetadata?.effective_answer_mode || 'n/a',
      lastFreshProviderAttempted: lastExecutionMetadata?.fresh_provider_attempted || 'n/a',
      lastFreshProviderSucceeded: String(lastExecutionMetadata?.fresh_provider_succeeded ?? 'n/a'),
      lastFreshProviderFailureReason: lastExecutionMetadata?.fresh_provider_failure_reason || 'n/a',
      lastGroundingEnabled: String(lastExecutionMetadata?.grounding_enabled ?? 'n/a'),
      lastGroundingActiveForRequest: lastExecutionMetadata?.grounding_active_for_request || 'n/a',
      lastFreshnessRequiredForTruth: String(lastExecutionMetadata?.freshness_required_for_truth ?? 'n/a'),
      lastFreshAnswerRequired: String(lastExecutionMetadata?.fresh_answer_required ?? 'n/a'),
      lastFreshProviderAvailableForRequest: String(lastExecutionMetadata?.fresh_provider_available_for_request ?? 'n/a'),
      lastStaleFallbackPermitted: String(lastExecutionMetadata?.stale_fallback_permitted ?? 'n/a'),
      lastStaleFallbackAttempted: lastExecutionMetadata ? (lastExecutionMetadata.stale_fallback_attempted ? 'yes' : 'no') : 'n/a',
      lastStaleFallbackUsed: lastExecutionMetadata ? (lastExecutionMetadata.stale_fallback_used ? 'yes' : 'no') : 'n/a',
      lastStaleAnswerWarning: lastExecutionMetadata?.stale_answer_warning || 'n/a',
      lastFreshnessNeed: lastExecutionMetadata?.freshness_need || 'n/a',
      lastAnswerTruthMode: lastExecutionMetadata?.answer_truth_mode || 'n/a',
      lastFreshnessIntegrityPreserved: String(lastExecutionMetadata?.freshness_integrity_preserved ?? 'n/a'),
      lastFreshnessIntegrityFailureReason: lastExecutionMetadata?.freshness_integrity_failure_reason || 'n/a',
      lastFreshnessTruthReason: lastExecutionMetadata?.freshness_truth_reason || 'n/a',
      lastFreshnessNextActions: Array.isArray(lastExecutionMetadata?.freshness_next_actions)
        ? lastExecutionMetadata.freshness_next_actions.join(', ')
        : 'n/a',
      lastFreshnessReason: lastExecutionMetadata?.freshness_reason || 'n/a',
      lastStaleRisk: lastExecutionMetadata?.stale_risk || 'n/a',
      lastAnswerMode: lastExecutionMetadata?.selected_answer_mode || 'n/a',
      lastOverrideDenialReason: lastExecutionMetadata?.override_denial_reason || 'n/a',
      lastFreshnessWarning: lastExecutionMetadata?.freshness_warning || 'n/a',
      lastAiPolicyMode: lastExecutionMetadata?.ai_policy_mode || 'local-first-cloud-when-needed',
      lastAiPolicyReason: lastExecutionMetadata?.ai_policy_reason || 'Local-first policy applied.',
      lastRetrievalMode: lastExecutionMetadata?.retrieval_mode || 'none',
      lastRetrievalEligible: String(lastExecutionMetadata?.retrieval_eligible ?? 'n/a'),
      lastRetrievalUsed: String(lastExecutionMetadata?.retrieval_used ?? 'n/a'),
      lastRetrievalReason: lastExecutionMetadata?.retrieval_reason || 'n/a',
      lastRetrievedChunkCount: String(lastExecutionMetadata?.retrieved_chunk_count ?? '0'),
      lastRetrievalIndexStatus: lastExecutionMetadata?.retrieval_index_status || 'n/a',
      lastRetrievalQuery: lastExecutionMetadata?.retrieval_query || 'n/a',
      lastRetrievedSources: Array.isArray(lastExecutionMetadata?.retrieved_sources)
        ? lastExecutionMetadata.retrieved_sources.map((source) => `${source.sourceType || source.sourceId || 'source'}:${source.path || 'n/a'}#${source.chunkIndex ?? 'n/a'}`)
        : [],
      lastMemoryEligible: String(lastExecutionMetadata?.memory_eligible ?? 'n/a'),
      lastMemoryPromoted: String(lastExecutionMetadata?.memory_promoted ?? 'n/a'),
      lastMemoryReason: lastExecutionMetadata?.memory_reason || 'n/a',
      lastMemorySourceType: lastExecutionMetadata?.memory_source_type || 'n/a',
      lastMemorySourceRef: lastExecutionMetadata?.memory_source_ref || 'n/a',
      lastMemoryConfidence: lastExecutionMetadata?.memory_confidence || 'n/a',
      lastMemoryClass: lastExecutionMetadata?.memory_class || 'durable',
      lastContextAssemblyUsed: String(lastExecutionMetadata?.context_assembly_used ?? 'n/a'),
      lastContextAssemblyMode: lastExecutionMetadata?.context_assembly_mode || 'n/a',
      lastContextSourcesUsed: Array.isArray(lastExecutionMetadata?.context_sources_used)
        ? lastExecutionMetadata.context_sources_used.join(', ')
        : 'n/a',
      lastSelfBuildPromptDetected: String(lastExecutionMetadata?.self_build_prompt_detected ?? 'n/a'),
      lastSelfBuildReason: lastExecutionMetadata?.self_build_reason || 'n/a',
      lastSystemAwarenessLevel: lastExecutionMetadata?.system_awareness_level || 'baseline',
      lastAugmentedPromptUsed: String(lastExecutionMetadata?.augmented_prompt_used ?? 'n/a'),
      lastAugmentedPromptLength: String(lastExecutionMetadata?.augmented_prompt_length ?? '0'),
      lastContextIntegrityPreserved: String(lastExecutionMetadata?.context_integrity_preserved ?? 'n/a'),
      lastContextAssemblyWarnings: Array.isArray(lastExecutionMetadata?.context_assembly_warnings)
        ? lastExecutionMetadata.context_assembly_warnings.join(', ')
        : 'n/a',
      lastTileActionType: lastExecutionMetadata?.tile_action_type || 'n/a',
      lastTileSource: lastExecutionMetadata?.tile_source || 'n/a',
      lastMemoryCandidateSubmitted: String(lastExecutionMetadata?.memory_candidate_submitted ?? 'n/a'),
      lastTileMemoryPromoted: String(lastExecutionMetadata?.memory_promoted ?? 'n/a'),
      lastTileMemoryReason: lastExecutionMetadata?.memory_reason || 'n/a',
      lastRetrievalContributionSubmitted: String(lastExecutionMetadata?.retrieval_contribution_submitted ?? 'n/a'),
      lastRetrievalIngested: String(lastExecutionMetadata?.retrieval_ingested ?? 'n/a'),
      lastRetrievalSourceRef: lastExecutionMetadata?.retrieval_source_ref || 'n/a',
      executionTruth,
      executionStatus: isBusy ? 'busy' : status,
      route: lastRoute,
      commands: safeCommandHistory.length,
      latestTool: latest?.tool_used ?? 'none',
      uiMarker: uiDiagnostics.componentMarker,
      uiVersion: STEPHANOS_UI_VERSION,
      uiGitCommit: STEPHANOS_UI_GIT_COMMIT,
      uiBuildTimestamp: STEPHANOS_UI_BUILD_TIMESTAMP,
      uiRuntimeId: STEPHANOS_UI_RUNTIME_ID,
      uiRuntimeMarker: STEPHANOS_UI_RUNTIME_MARKER,
      uiBuildTarget: STEPHANOS_UI_BUILD_TARGET,
      uiBuildTargetIdentifier: STEPHANOS_UI_BUILD_TARGET_IDENTIFIER,
      uiSource: STEPHANOS_UI_SOURCE,
      uiSourceFingerprint: STEPHANOS_UI_SOURCE_FINGERPRINT,
      debugConsole: 'F1',
    },
    routeTruthView,
    runtimeSessionTruth,
    runtimeRouteTruth,
    runtimeReachabilityTruth,
    runtimeProviderTruth,
    runtimeDiagnosticsTruth,
    runtimeContext,
    safeApiStatus,
    statusSummary: snapshotStatusSummary,
    origin: browserWindow?.location?.origin,
    href: browserWindow?.location?.href,
  });

  const handleCopySupportSnapshot = async () => {
    if (!browserNavigator?.clipboard?.writeText) {
      notifyCopyResult('Copy failed', 'degraded');
      return;
    }

    try {
      await browserNavigator.clipboard.writeText(supportSnapshot);
      notifyCopyResult('Support snapshot copied', 'ready');
    } catch (_error) {
      notifyCopyResult('Copy failed', 'degraded');
    }
  };

  return (
    <CollapsiblePanel
      as="aside"
      panelId="statusPanel"
      title="Status"
      description="Live routing, backend, and runtime diagnostics."
      className="status-panel"
      isOpen={safeUiLayout.statusPanel !== false}
      onToggle={() => togglePanel('statusPanel')}
      actions={(
        <button
          type="button"
          className="status-panel-copy-button"
          onClick={handleCopySupportSnapshot}
          aria-label="Copy Support Snapshot [IGNITION LOCAL]"
        >
          Copy Support Snapshot [IGNITION LOCAL]
        </button>
      )}
    >
      {copyNotice ? (
        <div className="status-panel-copy-actions">
          <span className={`status-panel-copy-notice ${copyNotice.tone}`} role="status" aria-live="polite">
            {copyNotice.message}
          </span>
        </div>
      ) : null}
      <ul>
        <li>Launch State: {runtimeStatus.appLaunchState}</li>
        <li>Effective Launch State: {routeTruthView.effectiveLaunchState || runtimeStatus.appLaunchState}</li>
        <li>Requested Route Mode: {runtimeStatus.requestedRouteMode}</li>
        <li>Effective Route Mode: {runtimeStatus.effectiveRouteMode}</li>
        <li>Requested Provider: {routeTruthView.requestedProvider}</li>
        <li>Route Selected Provider: {routeTruthView.selectedProvider}</li>
        <li>Active Provider: {routeTruthView.executedProvider}</li>
        <li>Active Route Kind: {runtimeStatus.activeRouteKind}</li>
        <li>Fallback Active: {routeTruthView.fallbackActive ? 'yes' : 'no'}</li>
        <li>Backend: {safeApiStatus.label || 'Checking backend...'}</li>
        <li>Runtime Mode: {runtimeStatus.runtimeModeLabel}</li>
        <li>Session Kind: {canonicalTruth.sessionKind || runtimeSessionTruth.sessionKind || runtimeTruth.sessionKind || finalRouteTruth.sessionKind || runtimeContext.sessionKind || 'unknown'}</li>
        <li>Non-Local Session: {(runtimeSessionTruth.nonLocalSession === true) ? 'yes' : 'no'}</li>
        <li>Route Kind: {routeTruthView.routeKind}</li>
        <li>Preferred Route: {routeTruthView.preferredRoute}</li>
        <li>Winning Route Reason: {routeTruthView.winnerReason}</li>
        <li>Adjudicated Winning Reason: {runtimeRouteTruth.winningReason || routeTruthView.winnerReason}</li>
        <li>Preferred Target: {routeTruthView.preferredTarget}</li>
        <li>Actual Target Used: {routeTruthView.actualTarget}</li>
        <li>Final Route Source: {routeTruthView.source}</li>
        <li>Final Route Reachable: {routeTruthView.selectedRouteReachableState}</li>
        <li>Selected Route UI Reachable: {routeTruthView.uiReachableState}</li>
        <li>Selected Route Usable: {routeTruthView.routeUsableState}</li>
        <li>Truth Inconsistent: {routeTruthView.truthInconsistent ? 'yes' : 'no'}</li>
        <li>Route Reconciled: {routeTruthView.routeReconciled ? 'yes' : 'no'} ({routeTruthView.routeReconciliationReason || 'n/a'})</li>
        <li>Adjudicated UI Reachable: {runtimeReachabilityTruth.uiReachableState || 'unknown'}</li>
        <li>Home Node Usable: {routeTruthView.homeNodeUsableState}</li>
        <li>Backend-Mediated Providers Eligible: {providerEligibility.backendMediatedProviders ? 'yes' : 'pending'}</li>
        <li>Local Providers Eligible: {providerEligibility.localProviders ? 'yes' : 'pending'}</li>
        <li>Cloud Providers Eligible: {providerEligibility.cloudProviders ? 'yes' : 'pending'}</li>
        <li>Mock Fallback Only: {providerEligibility.mockFallbackOnly ? 'yes' : 'pending'}</li>
        <li>Runtime Truth Contract: core truth persisted separately; runtime truth adjudicated per-session</li>
        <li>[CONTINUITY LOOP] Canonical Loop State: {continuitySnapshot.continuityLoopState}</li>
        <li>[SHARED MEMORY] Source: {continuitySnapshot.sharedMemorySource}</li>
        <li>[SHARED MEMORY] Hydration: {continuitySnapshot.sharedMemoryHydrationState}</li>
        <li>[SHARED MEMORY] Fallback Reason: {continuitySnapshot.sharedMemoryFallbackReason}</li>
        <li>[TILE LINK] State: {continuitySnapshot.tileLinkState}</li>
        <li>[AI CONTINUITY] State: {continuitySnapshot.aiContinuityState}</li>
        <li>[AI CONTINUITY] Mode: {continuitySnapshot.aiContinuityMode}</li>
        <li>[AI CONTINUITY] Request Mode: {continuityMode}</li>
        <li>[MEMORY ADJUDICATION] Eligible: {String(lastExecutionMetadata?.memory_eligible ?? 'n/a')}</li>
        <li>[MEMORY ADJUDICATION] Promoted: {String(lastExecutionMetadata?.memory_promoted ?? 'n/a')}</li>
        <li>[MEMORY ADJUDICATION] Reason: {lastExecutionMetadata?.memory_reason || 'n/a'}</li>
        <li>[MEMORY ADJUDICATION] Source: {lastExecutionMetadata?.memory_source_type || 'n/a'} · {lastExecutionMetadata?.memory_source_ref || 'n/a'}</li>
        <li>[SYSTEM AWARENESS] Context Assembly Used: {String(lastExecutionMetadata?.context_assembly_used ?? 'n/a')}</li>
        <li>[SYSTEM AWARENESS] Assembly Mode: {lastExecutionMetadata?.context_assembly_mode || 'n/a'}</li>
        <li>[SYSTEM AWARENESS] Sources Used: {Array.isArray(lastExecutionMetadata?.context_sources_used) ? lastExecutionMetadata.context_sources_used.join(', ') : 'n/a'}</li>
        <li>[SYSTEM AWARENESS] Self-Build Prompt Detected: {String(lastExecutionMetadata?.self_build_prompt_detected ?? 'n/a')}</li>
        <li>[SYSTEM AWARENESS] System Awareness Level: {lastExecutionMetadata?.system_awareness_level || 'baseline'}</li>
        <li>[SYSTEM AWARENESS] Context Integrity Preserved: {String(lastExecutionMetadata?.context_integrity_preserved ?? 'n/a')}</li>
        <li>[TILE ACTION] Type: {lastExecutionMetadata?.tile_action_type || 'n/a'}</li>
        <li>[TILE ACTION] Source: {lastExecutionMetadata?.tile_source || 'n/a'}</li>
        <li>[TILE ACTION] Memory Candidate Submitted: {String(lastExecutionMetadata?.memory_candidate_submitted ?? 'n/a')}</li>
        <li>[TILE ACTION] Memory Promoted: {String(lastExecutionMetadata?.memory_promoted ?? 'n/a')}</li>
        <li>[TILE ACTION] Memory Reason: {lastExecutionMetadata?.memory_reason || 'n/a'}</li>
        <li>[TILE ACTION] Retrieval Contribution Submitted: {String(lastExecutionMetadata?.retrieval_contribution_submitted ?? 'n/a')}</li>
        <li>[TILE ACTION] Retrieval Ingested: {String(lastExecutionMetadata?.retrieval_ingested ?? 'n/a')}</li>
        <li>[TILE ACTION] Retrieval Source Ref: {lastExecutionMetadata?.retrieval_source_ref || 'n/a'}</li>
        <li>[EXECUTION LOOP] Last Event: {continuitySnapshot.lastContinuityEventType} @ {continuitySnapshot.lastContinuityEventAt || 'n/a'}</li>
        <li>Guardrails Errors: {guardrails.summary?.errors ?? 0}</li>
        <li>Guardrails Warnings: {guardrails.summary?.warnings ?? 0}</li>
        <li>Guardrails Detail: {primaryGuardrailMessage}</li>
        <li>Adjudicator Blocking Issues: {runtimeDiagnosticsTruth.blockingIssues?.length ?? 0}</li>
        <li>Adjudicator Warnings: {runtimeDiagnosticsTruth.invariantWarnings?.length ?? 0}</li>
        <li>Adjudicator Total Issues: {adjudication.issues?.length ?? 0}</li>
        <li>Local Node Reachable (diagnostic): {runtimeStatus.localNodeReachable ? 'yes' : 'no'}</li>
        <li>Cloud Route Reachable (diagnostic): {runtimeStatus.cloudRouteReachable ? 'yes' : 'no'}</li>
        <li>Home Node Reachable (diagnostic): {runtimeStatus.homeNodeReachable ? 'yes' : 'no'}</li>
        <li>Home Node Diagnostic Reason: {homeNodeDiagnostics.reason || 'n/a'}</li>
        <li>Home Node Diagnostic Blocked Reason: {homeNodeDiagnostics.blockedReason || 'n/a'}</li>
        <li>Home Node Candidate Attempts: {homeNodeAttemptSummary}</li>
        <li>Home Node Operator Action: {homeNodeAction}</li>
        <li>Home Node Input Mode: {homeNodeDiagnostics.source || 'manual'}</li>
        <li>Home Node Input Draft Value: {uiDiagnostics.homeNodeInputDraftValue || ''}</li>
        <li>Home Node Input Saved Value: {uiDiagnostics.homeNodeInputSavedValue || ''}</li>
        <li>Home Node Input Editing Active: {uiDiagnostics.homeNodeInputEditingActive ? 'yes' : 'no'}</li>
        <li>Home Node Input Overwrite Source: {uiDiagnostics.homeNodeInputOverwriteSource || 'none'}</li>
        <li>Home Node Input Interaction Audit: {interactionAuditSummary}</li>
        <li>Diagnostics Active Timers: {runtimeDiagnostics.activeTimerCount ?? 0}</li>
        <li>Diagnostics Active Listeners: {runtimeDiagnostics.activeListenerCount ?? 0}</li>
        <li>Diagnostics Telemetry History Length: {runtimeDiagnostics.telemetryHistoryLength ?? 0}</li>
        <li>Diagnostics Continuity Event Count: {runtimeDiagnostics.continuityEventCount ?? 0}</li>
        <li>Diagnostics Active Panels: {runtimeDiagnostics.activePanels ?? 0}/{runtimeDiagnostics.totalPanels ?? 0}</li>
        <li>Diagnostics Animation Active Count: {runtimeDiagnostics.animationActiveCount ?? 0}</li>
        <li>Diagnostics Event Rate (/s): {runtimeDiagnostics.eventRatePerSecond ?? 0}</li>
        <li>Node Address Source: {routeTruthView.source}</li>
        <li>Backend Reachable: {routeTruthView.backendReachableState}</li>
        <li>Backend URL In Use: {uiDiagnostics.backendUrlInUse || runtimeContext.apiBaseUrl || safeApiStatus.baseUrl || 'n/a'}</li>
        <li>Ollama Base URL In Use: {uiDiagnostics.ollamaBaseUrlInUse || 'n/a'}</li>
        <li>Requested Provider (UI): {uiDiagnostics.requestedProvider || provider}</li>
        <li>Selected Provider (Route): {routeTruthView.selectedProvider}</li>
        <li>Executed Provider (Route): {routeTruthView.executedProvider}</li>
        <li>Executable Provider (Adjudicated): {runtimeProviderTruth.executableProvider || 'n/a'}</li>
        <li>Local Available: {runtimeStatus.localAvailable ? 'yes' : 'no'}</li>
        <li>Cloud Available: {runtimeStatus.cloudAvailable ? 'yes' : 'no'}</li>
        <li>Ready Cloud Providers: {readyCloudProviders}</li>
        <li>Ready Local Providers: {readyLocalProviders}</li>
        <li>Dependency Summary: {runtimeStatus.dependencySummary || 'pending'}</li>
        <li>Backend Default Provider: {safeApiStatus.backendDefaultProvider || 'n/a'}</li>
        <li>Selected Provider Health: {statusSummary.healthBadge}</li>
        <li>Selected Provider State: {statusSummary.healthState}</li>
        <li>Selected Provider Detail: {statusSummary.healthDetail}</li>
        <li>Selected Provider Reason: {statusSummary.healthReason || 'n/a'}</li>
        <li>Selected Provider Supports Fresh Web: {String(statusSummary.providerCapability?.supportsFreshWeb ?? 'unknown')}</li>
        <li>Selected Provider Supports Current Answers: {String(statusSummary.providerCapability?.supportsCurrentAnswers ?? 'unknown')}</li>
        <li>Selected Provider Configured Model: {statusSummary.providerCapability?.configuredModel || statusSummary.model || 'n/a'}</li>
        <li>Selected Provider Configured Model Supports Fresh Web: {String(statusSummary.providerCapability?.configuredModelSupportsFreshWeb ?? 'unknown')}</li>
        <li>Selected Provider Fresh Candidate Available: {String(statusSummary.providerCapability?.candidateFreshRouteAvailable ?? 'unknown')}</li>
        <li>Selected Provider Fresh Candidate Model: {statusSummary.providerCapability?.candidateFreshWebModel || 'n/a'}</li>
        <li>Selected Provider Fresh Web Path: {statusSummary.providerCapability?.freshWebPath || 'n/a'}</li>
        <li>Selected Provider Capability Reason: {statusSummary.providerCapability?.capabilityReason || 'n/a'}</li>
        <li>Zero Cost Policy: {String(statusSummary.providerCapability?.zeroCostPolicy ?? 'unknown')}</li>
        <li>Paid Fresh Routes Enabled: {String(statusSummary.providerCapability?.paidFreshRoutesEnabled ?? 'unknown')}</li>
        <li>Fresh Capability Mode: {statusSummary.providerCapability?.freshCapabilityMode || 'n/a'}</li>
        <li>Provider Selection Source: {providerSelectionSource}</li>
        <li>Stored Route Mode: {routeMode}</li>
        <li>Active Provider Config Source: {getActiveProviderConfigSource()}</li>
        <li>Session Restore Decision: {safeSessionRestoreDiagnostics.message || 'Portable session state restored.'}</li>
        <li>Session Restore Reason: {sessionRestoreReason}</li>
        <li>Dev Mode: {devMode ? 'on' : 'off'}</li>
        <li>Fallback Enabled: {fallbackEnabled ? 'yes' : 'no'}</li>
        <li>Home Node Disabled For Local Session: {disableHomeNodeForLocalSession ? 'yes' : 'no'}</li>
        <li>Provider Endpoint: {providerEndpointDisplay}</li>
        <li>Provider Model: {statusSummary.model}</li>
        <li>Last UI Requested Provider: {lastExecutionMetadata?.ui_requested_provider || 'n/a'}</li>
        <li>Last UI Default Provider: {lastExecutionMetadata?.ui_default_provider || provider || 'n/a'}</li>
        <li>Last Requested Provider For Request: {lastExecutionMetadata?.requested_provider_for_request || lastExecutionMetadata?.requested_provider || 'n/a'}</li>
        <li>Last Backend Default Provider: {lastExecutionMetadata?.backend_default_provider || safeApiStatus.backendDefaultProvider || 'n/a'}</li>
        <li>Last Route Mode: {lastExecutionMetadata?.route_mode || 'n/a'}</li>
        <li>Last Effective Route Mode: {lastExecutionMetadata?.effective_route_mode || 'n/a'}</li>
        <li>Last Requested Provider: {lastExecutionMetadata?.requested_provider || 'n/a'}</li>
        <li>Last Selected Provider: {lastExecutionMetadata?.selected_provider || 'n/a'}</li>
        <li>Last Actual Provider Used: {lastExecutionMetadata?.actual_provider_used || 'n/a'}</li>
        <li>Last Fallback Provider Used: {lastExecutionMetadata?.fallback_provider_used || 'n/a'}</li>
        <li>Last Model Used: {lastExecutionMetadata?.model_used || 'n/a'}</li>
        <li>Last Ollama Default Model: {lastExecutionMetadata?.ollama_model_default || 'n/a'}</li>
        <li>Last Ollama Preferred Model: {lastExecutionMetadata?.ollama_model_preferred || 'n/a'}</li>
        <li>Last Ollama Requested Model: {lastExecutionMetadata?.ollama_model_requested || 'n/a'}</li>
        <li>Last Ollama Selected Model: {lastExecutionMetadata?.ollama_model_selected || 'n/a'}</li>
        <li>Last Ollama Reasoning Mode: {lastExecutionMetadata?.ollama_reasoning_mode || 'n/a'}</li>
        <li>Last Ollama Escalation Active: {String(lastExecutionMetadata?.ollama_escalation_active ?? 'n/a')}</li>
        <li>Last Ollama Escalation Reason: {lastExecutionMetadata?.ollama_escalation_reason || 'n/a'}</li>
        <li>Last Ollama Fallback Model: {lastExecutionMetadata?.ollama_fallback_model || 'n/a'}</li>
        <li>Last Ollama Fallback Model Used: {String(lastExecutionMetadata?.ollama_fallback_model_used ?? 'n/a')}</li>
        <li>Last Ollama Fallback Reason: {lastExecutionMetadata?.ollama_fallback_reason || 'n/a'}</li>
        <li>Last Ollama Timeout (ms): {String(lastExecutionMetadata?.ollama_timeout_ms ?? 'n/a')}</li>
        <li>Last Ollama Timeout Source: {lastExecutionMetadata?.ollama_timeout_source || 'n/a'}</li>
        <li>Last Ollama Timeout Model: {lastExecutionMetadata?.ollama_timeout_model || 'n/a'}</li>
        <li>Last UI Request Timeout (ms): {String(lastExecutionMetadata?.ui_request_timeout_ms ?? 'n/a')}</li>
        <li>Last Backend Route Timeout (ms): {String(lastExecutionMetadata?.backend_route_timeout_ms ?? 'n/a')}</li>
        <li>Last Provider Timeout (ms): {String(lastExecutionMetadata?.provider_timeout_ms ?? 'n/a')}</li>
        <li>Last Model Timeout (ms): {String(lastExecutionMetadata?.model_timeout_ms ?? 'n/a')}</li>
        <li>Last Timeout Policy Source: {lastExecutionMetadata?.timeout_policy_source || 'n/a'}</li>
        <li>Last Timeout Override Applied: {String(lastExecutionMetadata?.timeout_override_applied ?? 'n/a')}</li>
        <li>Last Timeout Failure Layer: {lastExecutionMetadata?.timeout_failure_layer || 'n/a'}</li>
        <li>Last Timeout Failure Label: {lastExecutionMetadata?.timeout_failure_label || 'n/a'}</li>
        <li>Last Groq Endpoint Used: {lastExecutionMetadata?.groq_endpoint_used || 'n/a'}</li>
        <li>Last Groq Model Used: {lastExecutionMetadata?.groq_model_used || 'n/a'}</li>
        <li>Last Groq Fresh Web Active: {String(lastExecutionMetadata?.groq_fresh_web_active ?? 'n/a')}</li>
        <li>Last Groq Fresh Candidate Available: {String(lastExecutionMetadata?.groq_fresh_web_candidate_available ?? 'n/a')}</li>
        <li>Last Groq Fresh Web Path: {lastExecutionMetadata?.groq_fresh_web_path || 'n/a'}</li>
        <li>Last Groq Capability Reason: {lastExecutionMetadata?.groq_capability_reason || 'n/a'}</li>
        <li>Last Zero Cost Policy: {String(lastExecutionMetadata?.zero_cost_policy ?? 'n/a')}</li>
        <li>Last Paid Fresh Routes Enabled: {String(lastExecutionMetadata?.paid_fresh_routes_enabled ?? 'n/a')}</li>
        <li>Last Fresh Capability Mode: {lastExecutionMetadata?.fresh_capability_mode || 'n/a'}</li>
        <li>Last Response Truth: {responseTruth}</li>
        <li>Last Fallback Used: {lastExecutionMetadata ? (lastExecutionMetadata.fallback_used ? 'yes' : 'no') : 'n/a'}</li>
        <li>Last Fallback Reason: {lastExecutionMetadata?.fallback_reason || 'n/a'}</li>
        <li>Last Effective Answer Mode: {lastExecutionMetadata?.effective_answer_mode || 'n/a'}</li>
        <li>Last Fresh Provider Attempted: {lastExecutionMetadata?.fresh_provider_attempted || 'n/a'}</li>
        <li>Last Fresh Provider Succeeded: {String(lastExecutionMetadata?.fresh_provider_succeeded ?? 'n/a')}</li>
        <li>Last Fresh Provider Failure Reason: {lastExecutionMetadata?.fresh_provider_failure_reason || 'n/a'}</li>
        <li>Grounding Enabled: {String(lastExecutionMetadata?.grounding_enabled ?? 'n/a')}</li>
        <li>Grounding Active For Request: {lastExecutionMetadata?.grounding_active_for_request || 'n/a'}</li>
        <li>Freshness Required For Truth: {String(lastExecutionMetadata?.freshness_required_for_truth ?? 'n/a')}</li>
        <li>Fresh Answer Required: {String(lastExecutionMetadata?.fresh_answer_required ?? 'n/a')}</li>
        <li>Fresh Provider Available For Request: {String(lastExecutionMetadata?.fresh_provider_available_for_request ?? 'n/a')}</li>
        <li>Last Stale Fallback Permitted: {String(lastExecutionMetadata?.stale_fallback_permitted ?? 'n/a')}</li>
        <li>Last Freshness Need: {lastExecutionMetadata?.freshness_need || 'n/a'}</li>
        <li>Last Answer Truth Mode: {lastExecutionMetadata?.answer_truth_mode || 'n/a'}</li>
        <li>Last Stale Fallback Used: {String(lastExecutionMetadata?.stale_fallback_used ?? 'n/a')}</li>
        <li>Last Stale Answer Warning: {lastExecutionMetadata?.stale_answer_warning || 'n/a'}</li>
        <li>Freshness Integrity Preserved: {String(lastExecutionMetadata?.freshness_integrity_preserved ?? 'n/a')}</li>
        <li>Freshness Integrity Failure Reason: {lastExecutionMetadata?.freshness_integrity_failure_reason || 'n/a'}</li>
        <li>Freshness Truth Reason: {lastExecutionMetadata?.freshness_truth_reason || 'n/a'}</li>
        <li>Freshness Next Actions: {Array.isArray(lastExecutionMetadata?.freshness_next_actions) ? lastExecutionMetadata.freshness_next_actions.join(', ') : 'n/a'}</li>
        <li>Last Answer Mode: {lastExecutionMetadata?.selected_answer_mode || 'n/a'}</li>
        <li>Last Stale Risk: {lastExecutionMetadata?.stale_risk || 'n/a'}</li>
        <li>Last Freshness Reason: {lastExecutionMetadata?.freshness_reason || 'n/a'}</li>
        <li>Last Override Denial Reason: {lastExecutionMetadata?.override_denial_reason || 'n/a'}</li>
        <li>Last Freshness Warning: {lastExecutionMetadata?.freshness_warning || 'n/a'}</li>
        <li>AI Policy Mode: {lastExecutionMetadata?.ai_policy_mode || 'local-first-cloud-when-needed'}</li>
        <li>AI Policy Reason: {lastExecutionMetadata?.ai_policy_reason || 'Local-first policy applied.'}</li>
        <li>Execution Truth: {executionTruth}</li>
        <li>Execution Provider (Truth): {routeTruthView.executedProvider}</li>
        <li>Recovery Guidance: {routeTruthView.operatorReason || homeNodeAction || 'n/a'}</li>
        <li>Attempt Order: {attemptOrder}</li>
        <li>Execution Status: {isBusy ? 'busy' : status}</li>
        <li>Session Workspace: mission-console</li>
        <li>Session Subview: {lastRoute || 'assistant'}</li>
        <li>Remembered Commands: {safeWorkingMemory.recentCommands.length}</li>
        <li>Working Task: {safeWorkingMemory.currentTask || 'n/a'}</li>
        <li>Working Focus: {safeWorkingMemory.activeFocusLabel || 'n/a'}</li>
        <li>Mission Note: {safeWorkingMemory.missionNote || 'n/a'}</li>
        <li>Project Milestone: {safeProjectMemory.currentMilestone || 'n/a'}</li>
        <li>Route: {lastRoute}</li>
        <li>Commands: {safeCommandHistory.length}</li>
        <li>Latest Tool: {latest?.tool_used ?? 'none'}</li>
        <li>UI Marker: {uiDiagnostics.componentMarker}</li>
        <li>UI Version: {STEPHANOS_UI_VERSION}</li>
        <li>UI Git Commit: {STEPHANOS_UI_GIT_COMMIT}</li>
        <li>UI Build Timestamp: {STEPHANOS_UI_BUILD_TIMESTAMP}</li>
        <li>UI Runtime ID: {STEPHANOS_UI_RUNTIME_ID}</li>
        <li>UI Runtime Marker: {STEPHANOS_UI_RUNTIME_MARKER}</li>
        <li>UI Build Target: {STEPHANOS_UI_BUILD_TARGET}</li>
        <li>UI Build Target Identifier: {STEPHANOS_UI_BUILD_TARGET_IDENTIFIER}</li>
        <li>UI Source: {STEPHANOS_UI_SOURCE}</li>
        <li>UI Source Fingerprint: {STEPHANOS_UI_SOURCE_FINGERPRINT.slice(0, 12)}…</li>
        <li>Route Adoption Marker: {STEPHANOS_ROUTE_ADOPTION_MARKER}</li>
        <li>Provider Routing Marker: {STEPHANOS_PROVIDER_ROUTING_MARKER}</li>
        <li>[CONTINUITY LOOP] Recent Activity: {continuitySnapshot.recentContinuityEvents.length > 0 ? continuitySnapshot.recentContinuityEvents.map((event) => event.summary).join(' | ') : 'none observed'}</li>
        <li>Debug Console: F1</li>
      </ul>
      <p className={`api-banner ${runtimeStatus.statusTone}`}>{runtimeStatus.dependencySummary || 'Diagnostics pending'}</p>
    </CollapsiblePanel>
  );
}
