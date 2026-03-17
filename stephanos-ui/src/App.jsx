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

const APP_COMPONENT_MARKER = 'stephanos-ui/App.jsx::provider-dock-live-audit-v1';
const BUILD_MARKER = 'STEPHANOS BUILD MARKER: provider-fix-live-audit-v1';
const BUILD_TIMESTAMP = '2026-03-17T18:10:00Z';

export default function App() {
  const { input, setInput, submitPrompt, commandHistory } = useAIConsole();
  const {
    provider,
    providerDraftStatus,
    getSavedProviderConfig,
    setUiDiagnostics,
  } = useAIStore();
  useDebugConsole();

  const savedConfig = getSavedProviderConfig(provider);
  const configMode = provider === 'custom' ? providerDraftStatus.custom.mode : 'saved';

  useEffect(() => {
    console.log('[App] mounted from', APP_COMPONENT_MARKER);
    console.log(`${BUILD_MARKER} | ${BUILD_TIMESTAMP}`);
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

      <section className="build-marker-banner panel" role="status" aria-live="polite">
        <strong>{BUILD_MARKER}</strong> | {BUILD_TIMESTAMP}
      </section>

      <section className="provider-dock panel">
        <h2>AI Provider Controls</h2>
        <p className="provider-dock-status">
          Current provider: <strong>{provider}</strong> · Active base URL: <strong>{savedConfig.baseUrl || 'n/a'}</strong> · Active endpoint: <strong>{savedConfig.chatEndpoint || 'n/a'}</strong> · Active model: <strong>{savedConfig.model || 'n/a'}</strong> · Config mode: <strong>{configMode}</strong>
        </p>
        {provider === 'custom' && configMode === 'draft' ? (
          <p className="provider-dock-status">
            Draft changes are visible in form fields, but live requests still use the saved custom config until Save / Apply is pressed.
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
