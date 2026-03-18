import { buildProviderStatusSummary } from '../ai/providerConfig';
import { useAIStore } from '../state/aiStore';

export default function StatusPanel() {
  const {
    status,
    isBusy,
    lastRoute,
    commandHistory,
    apiStatus,
    provider,
    providerDraftStatus,
    providerSelectionSource,
    getActiveProviderConfig,
    getActiveProviderConfigSource,
    uiDiagnostics,
  } = useAIStore();
  const latest = commandHistory[commandHistory.length - 1];
  const proposalStats = commandHistory.findLast((entry) => entry.data_payload?.stats)?.data_payload?.stats;
  const roadmapSummary = commandHistory.findLast((entry) => entry.data_payload?.summary)?.data_payload?.summary;

  const activeConfig = getActiveProviderConfig();
  const configState = provider === 'custom' ? providerDraftStatus.custom.mode : 'saved';
  const statusSummary = buildProviderStatusSummary(provider, activeConfig, apiStatus.baseUrl);
  const backendDefaults = apiStatus.meta?.provider_defaults;

  return (
    <aside className="status-panel panel">
      <h2>Status</h2>
      <ul>
        <li>Backend: {apiStatus.label}</li>
        <li>Frontend API Base URL: {statusSummary.apiBaseUrl}</li>
        <li>API Health: {apiStatus.state}</li>
        <li>Current Provider: {statusSummary.providerLabel}</li>
        <li>Provider Key: {provider}</li>
        <li>Provider Target: {statusSummary.providerTarget}</li>
        <li>Provider Selection Source: {providerSelectionSource}</li>
        <li>Active Provider Config Source: {getActiveProviderConfigSource()}</li>
        <li>Config Mode: {configState}</li>
        <li>Provider Base URL: {activeConfig.baseUrl || 'n/a'}</li>
        <li>Provider Chat Endpoint: {activeConfig.chatEndpoint || 'n/a'}</li>
        <li>Provider Endpoint Summary: {statusSummary.providerEndpoint}</li>
        <li>Provider Model: {statusSummary.model}</li>
        {provider === 'ollama' ? <li>Ollama Endpoint: {statusSummary.providerEndpoint}</li> : null}
        <li>Backend Default Provider: {apiStatus.meta?.default_provider || 'n/a'}</li>
        <li>Backend Default Ollama Endpoint: {backendDefaults ? `${backendDefaults.ollama.baseUrl}${backendDefaults.ollama.chatEndpoint}` : 'n/a'}</li>
        <li>Last Provider Save: {providerDraftStatus.custom.savedAt || 'n/a'}</li>
        <li>Execution: {isBusy ? 'busy' : status}</li>
        <li>Route: {lastRoute}</li>
        <li>Commands: {commandHistory.length}</li>
        <li>Latest Tool: {latest?.tool_used ?? 'none'}</li>
        <li>Pending Proposals: {proposalStats?.pending ?? 'n/a'}</li>
        <li>Roadmap Open: {roadmapSummary?.open ?? 'n/a'}</li>
        <li>Provider Toggle Mounted: {uiDiagnostics.providerToggleMounted ? 'yes' : 'no'}</li>
        <li>UI Marker: {uiDiagnostics.componentMarker}</li>
        <li>Debug Console: F1</li>
      </ul>
      <p className={`api-banner ${apiStatus.state}`}>{apiStatus.detail}</p>
    </aside>
  );
}
