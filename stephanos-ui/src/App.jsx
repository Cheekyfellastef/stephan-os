import { useEffect } from 'react';
import AIConsole from './components/AIConsole';
import StatusPanel from './components/StatusPanel';
import DebugConsole from './components/DebugConsole';
import ToolsPanel from './components/ToolsPanel';
import MemoryPanel from './components/MemoryPanel';
import KnowledgeGraphPanel from './components/KnowledgeGraphPanel';
import SimulationListPanel from './components/SimulationListPanel';
import SimulationPanel from './components/SimulationPanel';
import ProposalPanel from './components/ProposalPanel';
import ActivityPanel from './components/ActivityPanel';
import RoadmapPanel from './components/RoadmapPanel';
import SimulationHistoryPanel from './components/SimulationHistoryPanel';
import ProviderToggle from './components/ProviderToggle';
import CollapsiblePanel from './components/CollapsiblePanel';
import { useAIConsole } from './hooks/useAIConsole';
import { useDebugConsole } from './hooks/useDebugConsole';
import { buildProviderStatusSummary } from './ai/providerConfig';
import { useAIStore } from './state/aiStore';
import { createRuntimeStatusModel } from '../../shared/runtime/runtimeStatusModel.mjs';
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
  const {
    provider,
    getActiveProviderConfig,
    setProvider,
    routeMode,
    setUiDiagnostics,
    apiStatus,
    providerHealth,
    fallbackEnabled,
    fallbackOrder,
    lastExecutionMetadata,
    uiLayout,
    togglePanel,
  } = useAIStore();
  useDebugConsole();

  const providerSummary = buildProviderStatusSummary(provider, getActiveProviderConfig(), apiStatus.baseUrl, providerHealth[provider]);
  const runtimeStatus = createRuntimeStatusModel({
    appId: 'stephanos',
    appName: 'Stephanos Mission Console',
    validationState: 'healthy',
    selectedProvider: provider,
    routeMode,
    fallbackEnabled,
    fallbackOrder,
    providerHealth,
    backendAvailable: apiStatus.backendReachable,
    runtimeContext: apiStatus.runtimeContext || { frontendOrigin: apiStatus.frontendOrigin, apiBaseUrl: apiStatus.baseUrl, homeNode: apiStatus.runtimeContext?.homeNode || null },
    activeProviderHint: lastExecutionMetadata?.actual_provider_used || '',
  });
  const showCloudFallbackAction = provider === 'ollama' && runtimeStatus.cloudAvailable && !runtimeStatus.localAvailable;

  useEffect(() => {
    setUiDiagnostics((prev) => ({ ...prev, appRootRendered: true, componentMarker: APP_COMPONENT_MARKER }));
  }, [setUiDiagnostics]);

  return (
    <main className="app-shell-root">
      <CollapsiblePanel
        panelId="providerControlsPanel"
        title="AI Provider Controls"
        description="Configure providers, health checks, models, and routing without losing your layout preference after restart."
        className="provider-dock"
        isOpen={uiLayout.providerControlsPanel}
        onToggle={() => togglePanel('providerControlsPanel')}
        actions={showCloudFallbackAction ? (
          <button type="button" className="ghost-button" onClick={() => setProvider(runtimeStatus.activeProvider)}>
            Use {runtimeStatus.activeProvider}
          </button>
        ) : null}
      >
        <div className="local-ai-banner-wrap">
          <div className={`local-ai-banner ${runtimeStatus.statusTone}`}>
            <div>
              <span className="local-ai-pill">{runtimeStatus.effectiveRouteMode} route</span>
              <p className="local-ai-text">
                {runtimeStatus.headline}. <strong>{runtimeStatus.dependencySummary}</strong>
              </p>
              <p className="local-ai-text secondary">
                Requested mode: <strong>{routeMode}</strong> · Route kind: <strong>{runtimeStatus.routeKind}</strong> · Selected provider: <strong>{providerSummary.providerLabel}</strong> · Active route: <strong>{runtimeStatus.activeProvider}</strong> · Backend: <strong>{runtimeStatus.backendAvailable ? 'online' : 'offline'}</strong>
              </p>
              <p className="local-ai-text secondary">
                Preferred target: <strong>{runtimeStatus.preferredTarget || 'n/a'}</strong> · Actual target: <strong>{runtimeStatus.actualTargetUsed || 'n/a'}</strong> · Node source: <strong>{runtimeStatus.nodeAddressSource}</strong>
              </p>
              <p className="local-ai-text secondary">
                Live source: <strong>stephanos-ui/src</strong> → built runtime: <strong>apps/stephanos/dist</strong>.
              </p>
            </div>
          </div>
        </div>

        <p className="provider-dock-status">
          Current Provider: <strong>{providerSummary.providerLabel}</strong> · Requested Route Mode: <strong>{runtimeStatus.requestedRouteMode}</strong> · Effective Route Mode: <strong>{runtimeStatus.effectiveRouteMode}</strong> · Launch State: <strong>{runtimeStatus.appLaunchState}</strong>
        </p>
        <p className="provider-dock-status">
          Backend API: <strong>{providerSummary.apiBaseUrl}</strong> · Runtime: <strong>{runtimeStatus.runtimeModeLabel}</strong> · Active Route: <strong>{runtimeStatus.activeProvider}</strong> · Provider Target: <strong>{providerSummary.providerTarget}</strong>
        </p>
        <ProviderToggle
          onTestConnection={refreshHealth}
          onSendTestPrompt={() => submitPrompt('Run a quick Stephanos provider self-test and explain what route is active right now.')}
        />
      </CollapsiblePanel>

      <section className="app-shell">
        <AIConsole input={input} setInput={setInput} submitPrompt={submitPrompt} commandHistory={commandHistory} />
        <div className="side-stack">
          <StatusPanel />
          <ToolsPanel commandHistory={commandHistory} />
          <MemoryPanel commandHistory={commandHistory} />
          <KnowledgeGraphPanel commandHistory={commandHistory} />
          <SimulationListPanel commandHistory={commandHistory} />
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
