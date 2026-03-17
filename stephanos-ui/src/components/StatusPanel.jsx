import { buildProviderDisplayLabel } from '../ai/providerConfig';
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
    getActiveProviderConfig,
    uiDiagnostics,
  } = useAIStore();
  const latest = commandHistory[commandHistory.length - 1];
  const proposalStats = commandHistory.findLast((entry) => entry.data_payload?.stats)?.data_payload?.stats;
  const roadmapSummary = commandHistory.findLast((entry) => entry.data_payload?.summary)?.data_payload?.summary;

  const activeConfig = getActiveProviderConfig();
  const providerLabel = buildProviderDisplayLabel(provider, activeConfig);
  const configState = provider === 'custom' ? providerDraftStatus.custom.mode : 'saved';

  return (
    <aside className="status-panel panel">
      <h2>Status</h2>
      <ul>
        <li>Backend: {apiStatus.label}</li>
        <li>API URL: {apiStatus.baseUrl || 'n/a'}</li>
        <li>API Health: {apiStatus.state}</li>
        <li>Current Provider: {providerLabel}</li>
        <li>Provider Key: {provider}</li>
        <li>Config Mode: {configState}</li>
        <li>Active Base URL: {activeConfig.baseUrl || 'n/a'}</li>
        <li>Active Chat Endpoint: {activeConfig.chatEndpoint || 'n/a'}</li>
        <li>Active Model: {activeConfig.model || 'server default'}</li>
        {provider === 'ollama' ? <li>Ollama Default Port: 11434</li> : null}
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
