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
import { useAIStore } from './state/aiStore';

const APP_COMPONENT_MARKER = 'stephanos-ui/App.jsx::provider-dock-v4';

export default function App() {
  const { input, setInput, submitPrompt, commandHistory } = useAIConsole();
  const { provider, providerDraftStatus, getActiveProviderConfig, setUiDiagnostics } = useAIStore();
  useDebugConsole();

  const activeConfig = getActiveProviderConfig();
  const configMode = provider === 'custom' ? providerDraftStatus.custom.mode : 'saved';

  useEffect(() => {
    console.log('[App] mounted from', APP_COMPONENT_MARKER);
    setUiDiagnostics((prev) => ({
      ...prev,
      appRootRendered: true,
      componentMarker: APP_COMPONENT_MARKER,
    }));
  }, [setUiDiagnostics]);

  return (
    <main className="app-shell-root">
      <div className="render-debug-banner" role="status" aria-live="polite">
        DEBUG: APP ROOT RENDERED · DEBUG: AI CONSOLE RENDERED · DEBUG: PROVIDER TOGGLE RENDERED
      </div>

      <section className="provider-dock panel">
        <h2>AI Provider Controls</h2>
        <p className="provider-dock-status">
          Active provider: <strong>{provider}</strong> · Config mode: <strong>{configMode}</strong> · Base URL: <strong>{activeConfig.baseUrl || 'n/a'}</strong> · Endpoint: <strong>{activeConfig.chatEndpoint || 'n/a'}</strong>
        </p>
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
