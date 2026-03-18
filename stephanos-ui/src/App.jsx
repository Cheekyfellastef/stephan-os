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
import { useAIConsole } from './hooks/useAIConsole';
import { useDebugConsole } from './hooks/useDebugConsole';
import { buildProviderStatusSummary } from './ai/providerConfig';
import { useAIStore } from './state/aiStore';
import {
  STEPHANOS_UI_BUILD_STAMP,
  STEPHANOS_UI_BUILD_TARGET,
  STEPHANOS_UI_BUILD_TARGET_IDENTIFIER,
  STEPHANOS_UI_RUNTIME_ID,
  STEPHANOS_UI_RUNTIME_LABEL,
  STEPHANOS_UI_RUNTIME_MARKER,
  STEPHANOS_UI_SOURCE,
  STEPHANOS_UI_SOURCE_FINGERPRINT,
} from './runtimeInfo';

const APP_COMPONENT_MARKER = STEPHANOS_UI_RUNTIME_MARKER;

export default function App() {
  const { input, setInput, submitPrompt, commandHistory, refreshHealth } = useAIConsole();
  const { provider, getActiveProviderConfig, setUiDiagnostics, apiStatus, providerHealth } = useAIStore();
  useDebugConsole();

  const providerSummary = buildProviderStatusSummary(provider, getActiveProviderConfig(), apiStatus.baseUrl, providerHealth[provider]);

  useEffect(() => {
    setUiDiagnostics((prev) => ({ ...prev, appRootRendered: true, componentMarker: APP_COMPONENT_MARKER }));
  }, [setUiDiagnostics]);

  return (
    <main className="app-shell-root">
      <section className="provider-dock panel">
        <h2>AI Provider Controls</h2>
        <p className="provider-dock-status">
          Current Provider: <strong>{providerSummary.providerLabel}</strong> · Health: <strong>{providerSummary.healthBadge}</strong> · Model: <strong>{providerSummary.model}</strong>
        </p>
        <p className="provider-dock-status">
          Backend API: <strong>{providerSummary.apiBaseUrl}</strong> · Provider Target: <strong>{providerSummary.providerTarget}</strong>
        </p>
        <ProviderToggle
          onTestConnection={refreshHealth}
          onSendTestPrompt={() => submitPrompt('Run a quick Stephanos provider self-test and explain what mode is active.')}
        />
      </section>

      <section className="app-shell">
        <AIConsole input={input} setInput={setInput} submitPrompt={submitPrompt} commandHistory={commandHistory} />
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

      <footer className="runtime-diagnostic" aria-label="runtime diagnostic">
        <span>{STEPHANOS_UI_RUNTIME_LABEL}</span>
        <span>build: {STEPHANOS_UI_BUILD_STAMP}</span>
        <span>marker: {STEPHANOS_UI_RUNTIME_MARKER}</span>
        <span>launcher: root index.html → apps/stephanos/dist/index.html</span>
        <span>runtime id: {STEPHANOS_UI_RUNTIME_ID}</span>
        <span>build target: {STEPHANOS_UI_BUILD_TARGET}</span>
        <span>target id: {STEPHANOS_UI_BUILD_TARGET_IDENTIFIER}</span>
        <span>source: {STEPHANOS_UI_SOURCE}</span>
        <span>fingerprint: {STEPHANOS_UI_SOURCE_FINGERPRINT.slice(0, 12)}…</span>
      </footer>

      <DebugConsole />
    </main>
  );
}
