import { buildProviderStatusSummary, resolveProviderEndpointForDisplay } from '../ai/providerConfig';
import { useAIStore } from '../state/aiStore';
import { ensureRuntimeStatusModel } from '../state/runtimeStatusDefaults';
import { buildFinalRouteTruthView } from '../state/finalRouteTruthView';
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
  const activeConfig = getActiveProviderConfig();
  const statusSummary = buildProviderStatusSummary(provider, activeConfig, safeApiStatus.baseUrl, safeProviderHealth[provider]);
  const runtimeStatus = ensureRuntimeStatusModel(runtimeStatusModel);
  // finalRoute is the sole resolved route truth for UI rendering; guardrails report when any projection drifts.
  const finalRoute = runtimeStatus.finalRoute ?? {};
  const finalRouteTruth = runtimeStatus.finalRouteTruth ?? {};
  const routeTruthView = buildFinalRouteTruthView(runtimeStatus);
  const providerEligibility = finalRoute.providerEligibility ?? {};
  const reachability = finalRoute.reachability ?? {};
  const runtimeContext = runtimeStatus.runtimeContext ?? {};
  const homeNodeDiagnostics = runtimeContext.routeDiagnostics?.['home-node'] ?? {};
  const homeNodeAttempts = Array.isArray(homeNodeStatus?.attempts) ? homeNodeStatus.attempts : [];
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
      : lastExecutionMetadata.fallback_used
        ? `fallback via ${lastExecutionMetadata.actual_provider_used}`
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

  return (
    <CollapsiblePanel
      as="aside"
      panelId="statusPanel"
      title="Status"
      description="Live routing, backend, and runtime diagnostics."
      className="status-panel"
      isOpen={safeUiLayout.statusPanel !== false}
      onToggle={() => togglePanel('statusPanel')}
    >
      <ul>
        <li>Launch State: {runtimeStatus.appLaunchState}</li>
        <li>Requested Route Mode: {runtimeStatus.requestedRouteMode}</li>
        <li>Effective Route Mode: {runtimeStatus.effectiveRouteMode}</li>
        <li>Requested Provider: {routeTruthView.requestedProvider}</li>
        <li>Route Selected Provider: {routeTruthView.selectedProvider}</li>
        <li>Active Provider: {routeTruthView.executedProvider}</li>
        <li>Active Route Kind: {runtimeStatus.activeRouteKind}</li>
        <li>Fallback Active: {runtimeStatus.fallbackActive ? 'yes' : 'no'}</li>
        <li>Backend: {safeApiStatus.label || 'Checking backend...'}</li>
        <li>Runtime Mode: {runtimeStatus.runtimeModeLabel}</li>
        <li>Session Kind: {finalRouteTruth.sessionKind || runtimeContext.sessionKind || 'unknown'}</li>
        <li>Route Kind: {routeTruthView.routeKind}</li>
        <li>Preferred Route: {routeTruthView.preferredRoute}</li>
        <li>Winning Route Reason: {routeTruthView.winnerReason}</li>
        <li>Preferred Target: {routeTruthView.preferredTarget}</li>
        <li>Actual Target Used: {routeTruthView.actualTarget}</li>
        <li>Final Route Source: {finalRoute.source || 'unknown'}</li>
        <li>Final Route Reachable: {routeTruthView.selectedRouteReachableState}</li>
        <li>Selected Route UI Reachable: {routeTruthView.uiReachableState}</li>
        <li>Selected Route Usable: {routeTruthView.routeUsableState}</li>
        <li>Home Node Usable: {routeTruthView.homeNodeUsableState}</li>
        <li>Backend-Mediated Providers Eligible: {providerEligibility.backendMediatedProviders ? 'yes' : 'pending'}</li>
        <li>Local Providers Eligible: {providerEligibility.localProviders ? 'yes' : 'pending'}</li>
        <li>Cloud Providers Eligible: {providerEligibility.cloudProviders ? 'yes' : 'pending'}</li>
        <li>Mock Fallback Only: {providerEligibility.mockFallbackOnly ? 'yes' : 'pending'}</li>
        <li>Guardrails Errors: {guardrails.summary?.errors ?? 0}</li>
        <li>Guardrails Warnings: {guardrails.summary?.warnings ?? 0}</li>
        <li>Guardrails Detail: {primaryGuardrailMessage}</li>
        <li>Local Node Reachable: {runtimeStatus.localNodeReachable ? 'yes' : 'no'}</li>
        <li>Cloud Route Reachable: {runtimeStatus.cloudRouteReachable ? 'yes' : 'no'}</li>
        <li>Home Node Reachable: {runtimeStatus.homeNodeReachable ? 'yes' : 'no'}</li>
        <li>Home Node Diagnostic Reason: {homeNodeDiagnostics.reason || 'n/a'}</li>
        <li>Home Node Diagnostic Blocked Reason: {homeNodeDiagnostics.blockedReason || 'n/a'}</li>
        <li>Home Node Candidate Attempts: {homeNodeAttemptSummary}</li>
        <li>Home Node Operator Action: {homeNodeAction}</li>
        <li>Node Address Source: {routeTruthView.source}</li>
        <li>Backend Reachable: {routeTruthView.backendReachableState}</li>
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
        <li>Last Backend Default Provider: {lastExecutionMetadata?.backend_default_provider || safeApiStatus.backendDefaultProvider || 'n/a'}</li>
        <li>Last Route Mode: {lastExecutionMetadata?.route_mode || 'n/a'}</li>
        <li>Last Effective Route Mode: {lastExecutionMetadata?.effective_route_mode || 'n/a'}</li>
        <li>Last Requested Provider: {lastExecutionMetadata?.requested_provider || 'n/a'}</li>
        <li>Last Selected Provider: {lastExecutionMetadata?.selected_provider || 'n/a'}</li>
        <li>Last Actual Provider Used: {lastExecutionMetadata?.actual_provider_used || 'n/a'}</li>
        <li>Last Model Used: {lastExecutionMetadata?.model_used || 'n/a'}</li>
        <li>Last Response Truth: {responseTruth}</li>
        <li>Last Fallback Used: {lastExecutionMetadata ? (lastExecutionMetadata.fallback_used ? 'yes' : 'no') : 'n/a'}</li>
        <li>Last Fallback Reason: {lastExecutionMetadata?.fallback_reason || 'n/a'}</li>
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
        <li>Debug Console: F1</li>
      </ul>
      <p className={`api-banner ${runtimeStatus.statusTone}`}>{runtimeStatus.dependencySummary || 'Diagnostics pending'}</p>
    </CollapsiblePanel>
  );
}
