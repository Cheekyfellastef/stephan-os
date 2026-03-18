import { useEffect } from 'react';
import AIConsole from './components/AIConsole';
import StatusPanel from './components/StatusPanel';
import DebugConsole from './components/DebugConsole';
import ToolsPanel from './components/ToolsPanel';
import MemoryPanel from './components/MemoryPanel';
import KnowledgeGraphPanel from './components/KnowledgeGraphPanel';
import SimulationPanel from './components/SimulationPanel';
import ProposalPanel from './components/ProposalPanel';
import ActivityPanel from './components/ActivityPanel';
import RoadmapPanel from './components/RoadmapPanel';
import SimulationHistoryPanel from './components/SimulationHistoryPanel';
import ProviderToggle from './components/ProviderToggle';
import CustomProviderPanel from './components/CustomProviderPanel';
import { useAIConsole } from './hooks/useAIConsole';
import { useDebugConsole } from './hooks/useDebugConsole';
import { buildProviderStatusSummary } from './ai/providerConfig';
import { useAIStore } from './state/aiStore';

const APP_COMPONENT_MARKER = 'stephanos-ui/App.jsx::ollama-default-router-v1';
const BUILD_MARKER = 'STEPHANOS BUILD MARKER: ollama-default-router-v1 | 2026-03-18T18:00:00Z';

export default function App() {
  const { input, setInput, submitPrompt, commandHistory } = useAIConsole();
  const {
    provider,
    providerDraftStatus,
    providerSelectionSource,
    getActiveProviderConfig,
    getActiveProviderConfigSource,
    setUiDiagnostics,
    apiStatus,
  } = useAIStore();
  useDebugConsole();

  const activeConfig = getActiveProviderConfig();
  const configMode = provider === 'custom' ? providerDraftStatus.custom.mode : 'saved';
  const providerSummary = buildProviderStatusSummary(provider, activeConfig, apiStatus.baseUrl);

  useEffect(() => {
    console.log(BUILD_MARKER);
    console.log('[App] mounted from', APP_COMPONENT_MARKER);
    setUiDiagnostics((prev) => ({
      ...prev,
      appRootRendered: true,
      componentMarker: APP_COMPONENT_MARKER,
    }));
  }, [setUiDiagnostics]);

  return (
    <main className="app-shell-root">
      <div className="build-marker-banner" role="status" aria-live="polite">
        {BUILD_MARKER}
      </div>

      <section className="provider-dock panel">
        <h2>AI Provider Controls</h2>
        <p className="provider-dock-status">
          Current Provider: <strong>{providerSummary.providerLabel}</strong> · Provider Key: <strong>{provider}</strong> · Frontend API Base URL: <strong>{providerSummary.apiBaseUrl}</strong>
        </p>
        <p className="provider-dock-status">
          Provider Target: <strong>{providerSummary.providerTarget}</strong> · Provider Endpoint Summary: <strong>{providerSummary.providerEndpoint}</strong> · Active Model: <strong>{providerSummary.model}</strong>
        </p>
        <p className="provider-dock-status">
          Provider Selection Source: <strong>{providerSelectionSource}</strong> · Active Config Source: <strong>{getActiveProviderConfigSource()}</strong> · Config Mode: <strong>{configMode}</strong>
        </p>
        {provider === 'ollama' ? (
          <p className="provider-dock-status">
            Ollama Endpoint: <strong>{providerSummary.providerEndpoint}</strong> · Browser traffic still posts only to <strong>{providerSummary.apiBaseUrl}</strong>
          </p>
        ) : null}
        <ProviderToggle />
        {provider === 'custom' ? <CustomProviderPanel /> : null}
      </section>

      <section className="app-shell">
        <AIConsole
          input={input}
          setInput={setInput}
          submitPrompt={submitPrompt}
          commandHistory={commandHistory}
        />
        <div className="side-stack">
          <StatusPanel />
          <ToolsPanel commandHistory={commandHistory} />
          <MemoryPanel commandHistory={commandHistory} />
          <KnowledgeGraphPanel commandHistory={commandHistory} />
          <SimulationPanel commandHistory={commandHistory} />
          <SimulationHistoryPanel commandHistory={commandHistory} />
          <ProposalPanel commandHistory={commandHistory} />
          <ActivityPanel commandHistory={commandHistory} />
          <RoadmapPanel commandHistory={commandHistory} />
        </div>
      </section>

      <DebugConsole />
    </main>
  );
}
