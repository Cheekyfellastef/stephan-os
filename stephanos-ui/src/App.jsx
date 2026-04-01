import { useEffect, useMemo, useRef, useState } from 'react';
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
import MissionDashboardPanel from './components/MissionDashboardPanel';
import SimulationHistoryPanel from './components/SimulationHistoryPanel';
import RuntimeFingerprintPanel from './components/RuntimeFingerprintPanel';
import ProviderToggle from './components/ProviderToggle';
import CollapsiblePanel from './components/CollapsiblePanel';
import MeaningStrip from './components/system/MeaningStrip';
import TelemetryFeed from './components/system/TelemetryFeed';
import PromptBuilder from './components/system/PromptBuilder.jsx';
import { useAIConsole } from './hooks/useAIConsole';
import { collectActionHints } from './components/system/actionHints.js';
import { appendTelemetryHistory, createTelemetryBaselineEvent, extractTelemetryEvents, TELEMETRY_MAX_HISTORY } from './components/system/telemetryEvents.js';
import { useDebugConsole } from './hooks/useDebugConsole';
import { buildProviderStatusSummary } from './ai/providerConfig';
import { useAIStore } from './state/aiStore';
import { ensureRuntimeStatusModel } from './state/runtimeStatusDefaults';
import { buildFinalRouteTruthView } from './state/finalRouteTruthView';
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
import { createStephanosLocalUrls } from '../../shared/runtime/stephanosLocalUrls.mjs';
import { createBuildParitySnapshot } from '../../shared/runtime/buildParity.mjs';

const APP_COMPONENT_MARKER = STEPHANOS_UI_RUNTIME_MARKER;

export default function App() {
  const {
    input,
    setInput,
    submitPrompt,
    commandHistory,
    refreshHealth,
    runAiButlerAction,
    aiActionState,
  } = useAIConsole();
  const {
    provider,
    getActiveProviderConfig,
    setProvider,
    routeMode,
    setUiDiagnostics,
    apiStatus,
    providerHealth,
    runtimeStatusModel,
    uiLayout,
    togglePanel,
    setPaneOrder,
    paneLayout,
  } = useAIStore();
  useDebugConsole();

  const safeUiLayout = uiLayout || {};
  const safePaneLayout = paneLayout && typeof paneLayout === 'object' ? paneLayout : {};
  const safeApiStatus = apiStatus || {};
  const safeProviderHealth = providerHealth && typeof providerHealth === 'object' ? providerHealth : {};
  const runtimeStatus = ensureRuntimeStatusModel(runtimeStatusModel);
  const routeTruthView = buildFinalRouteTruthView(runtimeStatus);
  const providerSummary = buildProviderStatusSummary(
    provider,
    getActiveProviderConfig(),
    safeApiStatus.baseUrl,
    safeProviderHealth[provider],
  );
  const startupDiagnosticsVisible = runtimeStatus.appLaunchState === 'pending' || safeApiStatus.state === 'checking';
  const showCloudFallbackAction = provider === 'ollama' && runtimeStatus.cloudAvailable && !runtimeStatus.localAvailable;
  const runtimeFingerprint = useMemo(() => {
    const canonicalUrls = createStephanosLocalUrls();
    const browserOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    const browserPathname = typeof window !== 'undefined' ? window.location.pathname : '';
    const runtimeRole = browserPathname.startsWith('/apps/stephanos/dist/') ? 'mission-control-dist-runtime' : 'mission-control-dev-runtime';

    return {
      commitHash: STEPHANOS_UI_SOURCE_FINGERPRINT,
      buildFingerprint: STEPHANOS_UI_RUNTIME_MARKER,
      buildTimestamp: STEPHANOS_UI_BUILD_STAMP,
      currentOrigin: browserOrigin,
      currentPathname: browserPathname,
      runtimeRole,
      expectedRootLauncherUrl: canonicalUrls.launcherShellUrl,
      expectedMissionControlDistUrl: canonicalUrls.runtimeIndexUrl,
      routeSourceLabel: routeTruthView.source,
    };
  }, [routeTruthView.source]);
  const runtimeBuildParity = useMemo(
    () => createBuildParitySnapshot({
      requestedSourceMarker: STEPHANOS_UI_SOURCE_FINGERPRINT,
      builtMarker: STEPHANOS_UI_RUNTIME_MARKER,
      servedMarker: runtimeStatus.runtimeTruth?.servedMarker,
      buildTimestamp: STEPHANOS_UI_BUILD_STAMP,
      servedBuildTimestamp: runtimeStatus.runtimeTruth?.servedBuildTimestamp,
      servedSourceTruthAvailable: runtimeStatus.runtimeTruth?.servedSourceTruthAvailable,
      sourceDistParityOk: runtimeStatus.runtimeTruth?.sourceDistParityOk,
      ignitionRestartSupported: runtimeStatus.runtimeTruth?.ignitionRestartSupported,
      realitySyncEnabled: safeUiLayout.realitySyncEnabled !== false,
    }),
    [runtimeStatus.runtimeTruth, safeUiLayout.realitySyncEnabled],
  );
  const [telemetryEntries, setTelemetryEntries] = useState([]);
  const telemetryBaselineAddedRef = useRef(false);
  const previousTelemetryTruthRef = useRef(null);
  const finalRouteTruth = runtimeStatusModel?.finalRouteTruth ?? null;
  const actionHints = useMemo(() => collectActionHints(finalRouteTruth).map((text) => ({ severity: 'info', subsystem: 'SYSTEM', text })), [finalRouteTruth]);

  useEffect(() => {
    if (!finalRouteTruth) {
      setTelemetryEntries([]);
      previousTelemetryTruthRef.current = null;
      telemetryBaselineAddedRef.current = false;
      return;
    }

    const timestamp = new Date().toISOString();
    const incoming = [];

    if (!telemetryBaselineAddedRef.current) {
      incoming.push(createTelemetryBaselineEvent(finalRouteTruth, timestamp));
      telemetryBaselineAddedRef.current = true;
    }

    incoming.push(...extractTelemetryEvents(previousTelemetryTruthRef.current, finalRouteTruth, timestamp));

    if (incoming.length > 0) {
      setTelemetryEntries((previous) => appendTelemetryHistory(previous, incoming, TELEMETRY_MAX_HISTORY));
    }

    previousTelemetryTruthRef.current = finalRouteTruth;
  }, [finalRouteTruth]);

  const ignitionModeBanner = useMemo(() => {
    const pathname = runtimeFingerprint.currentPathname || '';
    const origin = runtimeFingerprint.currentOrigin || '';
    const isDistRuntime = pathname.startsWith('/apps/stephanos/dist/');
    const isViteDevRuntime = origin.includes(':5173');
    const mode = isViteDevRuntime
      ? '5173 Vite dev runtime'
      : isDistRuntime
        ? '4173 dist runtime'
        : '4173 launcher-root';

    return {
      mode,
      tone: isViteDevRuntime ? 'warning' : isDistRuntime ? 'ready' : 'neutral',
    };
  }, [runtimeFingerprint]);

  const paneDefinitions = useMemo(() => ([
    { id: 'aiConsole', className: 'pane-span-2', render: () => (
      <div className="primary-stack">
        {startupDiagnosticsVisible ? (
          <div className="api-banner degraded" role="status" aria-live="polite">
            <strong>{runtimeStatus.headline || 'Diagnostics pending'}</strong>
            <span>{runtimeStatus.dependencySummary || safeApiStatus.detail || 'Stephanos is loading runtime diagnostics and route status.'}</span>
          </div>
        ) : null}
        <AIConsole
          input={input}
          setInput={setInput}
          submitPrompt={submitPrompt}
          commandHistory={commandHistory}
        />
      </div>
    ) },
    { id: 'statusPanel', render: () => <StatusPanel /> },
    {
      id: 'toolsPanel',
      render: () => (
        <ToolsPanel
          commandHistory={commandHistory}
          runAiButlerAction={runAiButlerAction}
          aiActionState={aiActionState}
        />
      ),
    },
    { id: 'memoryPanel', render: () => <MemoryPanel commandHistory={commandHistory} /> },
    { id: 'knowledgeGraphPanel', render: () => <KnowledgeGraphPanel commandHistory={commandHistory} /> },
    { id: 'simulationListPanel', render: () => <SimulationListPanel commandHistory={commandHistory} /> },
    { id: 'simulationPanel', render: () => <SimulationPanel commandHistory={commandHistory} /> },
    { id: 'simulationHistoryPanel', render: () => <SimulationHistoryPanel commandHistory={commandHistory} /> },
    { id: 'proposalPanel', render: () => <ProposalPanel commandHistory={commandHistory} /> },
    { id: 'activityPanel', render: () => <ActivityPanel commandHistory={commandHistory} /> },
    { id: 'telemetryFeedPanel', render: () => <TelemetryFeed runtimeStatusModel={runtimeStatusModel} telemetryEntries={telemetryEntries} /> },
    { id: 'promptBuilderPanel', className: 'pane-span-2', render: () => <PromptBuilder runtimeStatusModel={runtimeStatusModel} telemetryEntries={telemetryEntries} actionHints={actionHints} /> },
    { id: 'roadmapPanel', render: () => <RoadmapPanel commandHistory={commandHistory} /> },
    { id: 'missionDashboardPanel', className: 'pane-span-2', render: () => <MissionDashboardPanel /> },
    { id: 'missionFingerprintPanel', render: () => <RuntimeFingerprintPanel runtimeFingerprint={runtimeFingerprint} /> },
  ]), [
    aiActionState,
    commandHistory,
    input,
    runAiButlerAction,
    runtimeFingerprint,
    runtimeStatusModel,
    runtimeStatus.headline,
    telemetryEntries,
    actionHints,
    runtimeStatus.dependencySummary,
    safeApiStatus.detail,
    setInput,
    startupDiagnosticsVisible,
    submitPrompt,
  ]);

  const safePaneOrder = useMemo(() => {
    if (Array.isArray(safePaneLayout.order) && safePaneLayout.order.length > 0) {
      return safePaneLayout.order;
    }
    return paneDefinitions.map((pane) => pane.id);
  }, [paneDefinitions, safePaneLayout.order]);

  const paneMap = useMemo(() => new Map(paneDefinitions.map((pane) => [pane.id, pane])), [paneDefinitions]);
  const orderedPanes = useMemo(() => safePaneOrder
    .map((paneId) => paneMap.get(paneId))
    .filter(Boolean), [safePaneOrder, paneMap]);
  const [dragPaneId, setDragPaneId] = useState('');

  function reorderPanes(sourcePaneId, targetPaneId) {
    if (!sourcePaneId || !targetPaneId || sourcePaneId === targetPaneId) {
      return;
    }
    const order = safePaneOrder;
    const sourceIndex = order.indexOf(sourcePaneId);
    const targetIndex = order.indexOf(targetPaneId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }

    const next = [...order];
    next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, sourcePaneId);
    setPaneOrder(next);
    console.info('[PANES] pane order updated', { order: next });
    console.info('[PANES] reflow completed after visibility change', { trigger: 'pane-order-change' });
  }

  function nudgePane(paneId, direction = 1) {
    const order = [...safePaneOrder];
    const index = order.indexOf(paneId);
    if (index < 0) {
      return;
    }
    const nextIndex = Math.max(0, Math.min(order.length - 1, index + direction));
    if (nextIndex === index) {
      return;
    }
    const [pane] = order.splice(index, 1);
    order.splice(nextIndex, 0, pane);
    setPaneOrder(order);
    console.info('[PANES] pane order updated', { order, interaction: 'touch-nudge' });
  }

  useEffect(() => {
    setUiDiagnostics((prev) => ({ ...prev, appRootRendered: true, componentMarker: APP_COMPONENT_MARKER }));
  }, [setUiDiagnostics]);

  useEffect(() => {
    console.info('[Stephanos Runtime Fingerprint] mission-control', runtimeFingerprint);
  }, [runtimeFingerprint]);

  useEffect(() => {
    console.info('[PANES] fingerprint pane registered', { paneId: 'missionFingerprintPanel' });
    console.info('[PANES] layout restored from memory', { order: safePaneOrder });
  }, [safePaneOrder]);

  return (
    <main className="app-shell-root">
      <div className={`ignition-mode-banner ${ignitionModeBanner.tone}`} role="status" aria-live="polite">
        IGNITION MODE: <strong>{ignitionModeBanner.mode}</strong> · origin <code>{runtimeFingerprint.currentOrigin}</code> · path <code>{runtimeFingerprint.currentPathname}</code>
      </div>
      <CollapsiblePanel
        panelId="providerControlsPanel"
        title="AI Provider Controls"
        description="Configure providers, health checks, models, and routing without losing your layout preference after restart."
        className="provider-dock"
        isOpen={safeUiLayout.providerControlsPanel !== false}
        onToggle={() => togglePanel('providerControlsPanel')}
        actions={showCloudFallbackAction ? (
          <button type="button" className="ghost-button" onClick={() => setProvider(routeTruthView.executedProvider)}>
            Use {routeTruthView.executedProvider}
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
                Requested mode: <strong>{routeMode}</strong> · Route kind: <strong>{routeTruthView.routeKind}</strong> · Requested provider: <strong>{routeTruthView.requestedProvider}</strong> · Selected provider: <strong>{routeTruthView.selectedProvider}</strong> · Executed provider: <strong>{routeTruthView.executedProvider}</strong> · Backend: <strong>{routeTruthView.backendReachableState}</strong>
              </p>
              <p className="local-ai-text secondary">
                Preferred target: <strong>{routeTruthView.preferredTarget}</strong> · Actual target: <strong>{routeTruthView.actualTarget}</strong> · Node source: <strong>{routeTruthView.source}</strong>
              </p>
              <p className="local-ai-text secondary">
                Live source: <strong>stephanos-ui/src</strong> → built runtime: <strong>apps/stephanos/dist</strong>.
              </p>
              <p className="local-ai-text secondary">
                Build parity confidence: <strong>{runtimeBuildParity.confidence}</strong> · source/dist parity: <strong>{runtimeBuildParity.sourceDistParityOk == null ? 'pending' : runtimeBuildParity.sourceDistParityOk ? 'true' : 'false'}</strong>
              </p>
            </div>
          </div>
        </div>

        <p className="provider-dock-status">
          Current Provider: <strong>{providerSummary.providerLabel}</strong> · Requested Route Mode: <strong>{runtimeStatus.requestedRouteMode}</strong> · Effective Route Mode: <strong>{runtimeStatus.effectiveRouteMode}</strong> · Launch State: <strong>{runtimeStatus.appLaunchState}</strong>
        </p>
        <p className="provider-dock-status">
          Backend API: <strong>{providerSummary.apiBaseUrl}</strong> · Runtime: <strong>{runtimeStatus.runtimeModeLabel}</strong> · Active Route: <strong>{routeTruthView.executedProvider}</strong> · Provider Target: <strong>{providerSummary.providerTarget}</strong>
        </p>
        <ProviderToggle
          onTestConnection={refreshHealth}
          onSendTestPrompt={() => submitPrompt('Run a quick Stephanos provider self-test and explain what route is active right now.')}
        />
      </CollapsiblePanel>

      <section className="operator-pane-wall" onDragOver={(event) => event.preventDefault()}>
        {orderedPanes.map((pane) => (
          <div
            key={pane.id}
            className={`operator-pane-slot ${pane.className || ''} ${dragPaneId === pane.id ? 'dragging' : ''}`}
            draggable
            onDragStart={() => setDragPaneId(pane.id)}
            onDragEnd={() => setDragPaneId('')}
            onDrop={() => {
              reorderPanes(dragPaneId, pane.id);
              setDragPaneId('');
            }}
          >
            <div className="pane-order-controls" aria-label="Pane arrangement controls">
              <button type="button" className="ghost-button" onClick={() => nudgePane(pane.id, -1)}>Move up</button>
              <button type="button" className="ghost-button" onClick={() => nudgePane(pane.id, 1)}>Move down</button>
            </div>
            {pane.render()}
          </div>
        ))}
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
      <MeaningStrip finalRouteTruth={runtimeStatusModel?.finalRouteTruth} />
    </main>
  );
}
