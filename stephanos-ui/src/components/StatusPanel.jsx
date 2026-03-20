import { buildProviderStatusSummary } from '../ai/providerConfig';
import { useAIStore } from '../state/aiStore';
import { createRuntimeStatusModel } from '../../../shared/runtime/runtimeStatusModel.mjs';
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
    devMode,
    fallbackEnabled,
    fallbackOrder,
    providerHealth,
    getActiveProviderConfig,
    getActiveProviderConfigSource,
    uiDiagnostics,
    lastExecutionMetadata,
    uiLayout,
    togglePanel,
  } = useAIStore();

  const latest = commandHistory[commandHistory.length - 1];
  const activeConfig = getActiveProviderConfig();
  const statusSummary = buildProviderStatusSummary(provider, activeConfig, apiStatus.baseUrl, providerHealth[provider]);
  const runtimeStatus = createRuntimeStatusModel({
    appId: 'stephanos',
    appName: 'Stephanos Mission Console',
    validationState: 'healthy',
    selectedProvider: provider,
    fallbackEnabled,
    fallbackOrder,
    providerHealth,
    backendAvailable: apiStatus.backendReachable,
    preferAuto: typeof window !== 'undefined' && window.innerWidth <= 820,
    activeProviderHint: lastExecutionMetadata?.actual_provider_used || '',
  });
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

  return (
    <CollapsiblePanel
      as="aside"
      panelId="statusPanel"
      title="Status"
      description="Live routing, backend, and runtime diagnostics."
      className="status-panel"
      isOpen={uiLayout.statusPanel}
      onToggle={() => togglePanel('statusPanel')}
    >
      <ul>
        <li>Launch State: {runtimeStatus.appLaunchState}</li>
        <li>Route Mode: {runtimeStatus.providerMode}</li>
        <li>Selected Provider: {runtimeStatus.selectedProvider}</li>
        <li>Active Provider: {runtimeStatus.activeProvider}</li>
        <li>Fallback Active: {runtimeStatus.fallbackActive ? 'yes' : 'no'}</li>
        <li>Backend: {apiStatus.label}</li>
        <li>Backend Reachable: {runtimeStatus.backendAvailable ? 'yes' : 'no'}</li>
        <li>Local Available: {runtimeStatus.localAvailable ? 'yes' : 'no'}</li>
        <li>Cloud Available: {runtimeStatus.cloudAvailable ? 'yes' : 'no'}</li>
        <li>Dependency Summary: {runtimeStatus.dependencySummary}</li>
        <li>Backend Default Provider: {apiStatus.backendDefaultProvider || 'n/a'}</li>
        <li>Selected Provider Health: {statusSummary.healthBadge}</li>
        <li>Selected Provider State: {statusSummary.healthState}</li>
        <li>Selected Provider Detail: {statusSummary.healthDetail}</li>
        <li>Selected Provider Reason: {statusSummary.healthReason || 'n/a'}</li>
        <li>Provider Selection Source: {providerSelectionSource}</li>
        <li>Active Provider Config Source: {getActiveProviderConfigSource()}</li>
        <li>Dev Mode: {devMode ? 'on' : 'off'}</li>
        <li>Fallback Enabled: {fallbackEnabled ? 'yes' : 'no'}</li>
        <li>Provider Endpoint: {statusSummary.providerEndpoint}</li>
        <li>Provider Model: {statusSummary.model}</li>
        <li>Last UI Requested Provider: {lastExecutionMetadata?.ui_requested_provider || 'n/a'}</li>
        <li>Last Backend Default Provider: {lastExecutionMetadata?.backend_default_provider || apiStatus.backendDefaultProvider || 'n/a'}</li>
        <li>Last Requested Provider: {lastExecutionMetadata?.requested_provider || 'n/a'}</li>
        <li>Last Selected Provider: {lastExecutionMetadata?.selected_provider || 'n/a'}</li>
        <li>Last Actual Provider Used: {lastExecutionMetadata?.actual_provider_used || 'n/a'}</li>
        <li>Last Model Used: {lastExecutionMetadata?.model_used || 'n/a'}</li>
        <li>Last Response Truth: {responseTruth}</li>
        <li>Last Fallback Used: {lastExecutionMetadata ? (lastExecutionMetadata.fallback_used ? 'yes' : 'no') : 'n/a'}</li>
        <li>Last Fallback Reason: {lastExecutionMetadata?.fallback_reason || 'n/a'}</li>
        <li>Execution Truth: {executionTruth}</li>
        <li>Execution Status: {isBusy ? 'busy' : status}</li>
        <li>Route: {lastRoute}</li>
        <li>Commands: {commandHistory.length}</li>
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
        <li>Debug Console: F1</li>
      </ul>
      <p className={`api-banner ${runtimeStatus.statusTone}`}>{runtimeStatus.dependencySummary}</p>
    </CollapsiblePanel>
  );
}
