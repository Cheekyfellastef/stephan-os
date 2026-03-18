import { buildProviderStatusSummary } from '../ai/providerConfig';
import { useAIStore } from '../state/aiStore';
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
    providerHealth,
    getActiveProviderConfig,
    getActiveProviderConfigSource,
    uiDiagnostics,
  } = useAIStore();

  const latest = commandHistory[commandHistory.length - 1];
  const activeConfig = getActiveProviderConfig();
  const statusSummary = buildProviderStatusSummary(provider, activeConfig, apiStatus.baseUrl, providerHealth[provider]);

  return (
    <aside className="status-panel panel">
      <h2>Status</h2>
      <ul>
        <li>Backend: {apiStatus.label}</li>
        <li>Backend Reachable: {apiStatus.backendReachable ? 'yes' : 'no'}</li>
        <li>Backend Default Provider: {apiStatus.backendDefaultProvider || 'n/a'}</li>
        <li>Active Provider: {statusSummary.providerLabel}</li>
        <li>Provider Health: {statusSummary.healthBadge}</li>
        <li>Provider State: {statusSummary.healthState}</li>
        <li>Provider Detail: {statusSummary.healthDetail}</li>
        <li>Provider Reason: {statusSummary.healthReason || 'n/a'}</li>
        <li>Provider Selection Source: {providerSelectionSource}</li>
        <li>Active Provider Config Source: {getActiveProviderConfigSource()}</li>
        <li>Dev Mode: {devMode ? 'on' : 'off'}</li>
        <li>Fallback Enabled: {fallbackEnabled ? 'yes' : 'no'}</li>
        <li>Provider Endpoint: {statusSummary.providerEndpoint}</li>
        <li>Provider Model: {statusSummary.model}</li>
        <li>Execution: {isBusy ? 'busy' : status}</li>
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
      <p className={`api-banner ${apiStatus.state}`}>{apiStatus.detail}</p>
    </aside>
  );
}
