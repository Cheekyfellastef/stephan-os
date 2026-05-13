import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AIConsole from './components/AIConsole';
import PowerShellMergeConsolePanel from './components/PowerShellMergeConsolePanel';
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
import IntentEnginePanel from './components/IntentEnginePanel.jsx';
import SimulationHistoryPanel from './components/SimulationHistoryPanel';
import RuntimeFingerprintPanel from './components/RuntimeFingerprintPanel';
import MissionPacketQueuePanel from './components/MissionPacketQueuePanel';
import HostedIdeaStagingPanel from './components/HostedIdeaStagingPanel';
import CockpitPanel from './components/CockpitPanel';
import ProviderToggle from './components/ProviderToggle';
import HomeBridgePanel from './components/HomeBridgePanel';
import CollapsiblePanel from './components/CollapsiblePanel';
import MeaningStrip from './components/system/MeaningStrip';
import TelemetryFeed from './components/system/TelemetryFeed';
import PromptBuilder from './components/system/PromptBuilder.jsx';
import AgentsTile from './components/AgentsTile.jsx';
import AgentQuickControls from './components/AgentQuickControls.jsx';
import OpenClawTile from './components/OpenClawTile.jsx';
import MissionConsoleTile from './components/MissionConsoleTile.jsx';
import CapabilityRadarTile from './components/CapabilityRadarTile.jsx';
import SkillForgeTile from './components/SkillForgeTile.jsx';
import WorldWorkspaceTile from './components/WorldWorkspaceTile.jsx';
import StephanosSurfacePane from './components/StephanosSurfacePane.jsx';
import { useAIConsole } from './hooks/useAIConsole';
import { collectActionHints } from './components/system/actionHints.js';
import { appendTelemetryHistory, createTelemetryBaselineEvent, extractTelemetryEvents, TELEMETRY_MAX_HISTORY } from './components/system/telemetryEvents.js';
import { useDebugConsole } from './hooks/useDebugConsole';
import { buildProviderStatusSummary } from './ai/providerConfig';
import { useAIStore } from './state/aiStore';
import { ensureRuntimeStatusModel } from './state/runtimeStatusDefaults';
import { buildFinalRouteTruthView } from './state/finalRouteTruthView';
import { evaluateRuntimeTruthDependencyGate } from './state/runtimeTruthDependencyGate.js';
import { deriveContinuityLoopSnapshot } from './state/continuityLoopSnapshot';
import { recordPerfCounter, setPerfIdentityField } from './state/perfDiagnostics.js';
import {
  buildCanonicalCurrentIntent,
  buildCanonicalMemoryContext,
  buildCanonicalMissionPacket,
  buildCanonicalSourceDistAlignment,
} from './state/runtimeOrchestrationTruth';
import { normalizeMissionPacketTruth } from './state/missionPacketWorkflow';
import { deriveRuntimeOrchestrationSelectors } from './state/runtimeOrchestrationSelectors.js';
import {
  STEPHANOS_UI_BUILD_STAMP,
  STEPHANOS_UI_BUILD_TIMESTAMP,
  STEPHANOS_UI_BUILD_TARGET,
  STEPHANOS_UI_BUILD_TARGET_IDENTIFIER,
  STEPHANOS_UI_GIT_COMMIT,
  STEPHANOS_UI_RUNTIME_ID,
  STEPHANOS_UI_RUNTIME_LABEL,
  STEPHANOS_UI_RUNTIME_MARKER,
  STEPHANOS_UI_SOURCE,
  STEPHANOS_UI_SOURCE_FINGERPRINT,
} from './runtimeInfo';
import { createStephanosLocalUrls } from '../../shared/runtime/stephanosLocalUrls.mjs';
import { resolveCommandDeckDestinationPath } from '../../shared/runtime/commandDeckDestination.mjs';
import { createBuildParitySnapshot } from '../../shared/runtime/buildParity.mjs';
import { buildAgentRegistry } from '../../shared/agents/agentRegistry.mjs';
import { adjudicateAgents } from '../../shared/agents/agentAdjudicator.mjs';
import { buildFinalAgentView } from '../../shared/agents/finalAgentView.mjs';
import { buildAgentSurfaceProjection, resolveAgentSurfaceMode } from '../../shared/agents/agentSurfaceProjection.mjs';
import { buildAgentTaskProjection } from '../../shared/agents/agentTaskProjection.mjs';
import { recordStartupRenderStage } from '../../shared/runtime/startupLaunchDiagnostics.mjs';
import { OPENCLAW_READONLY_VALIDATION_ENDPOINT } from '../../shared/agents/openClawReadonlyValidationEndpoint.mjs';
import { buildOpenClawIntegrationSnapshot } from './components/openclaw/openclawIntegrationAdapter.js';
import {
  loadPaneOrder,
  reconcilePaneOrder,
  savePaneOrder,
  STEPHANOS_TILE_PANE_ORDER_STORAGE_KEY,
} from './utils/paneOrderPersistence.js';
import { getPaneMoveAvailability, resolvePaneCollapsedState } from './utils/stephanosPaneBehavior.js';
import { auditStephanosTilePanes } from './utils/stephanosPaneContract.js';
import {
  OPENCLAW_DEFAULT_HOST,
  OPENCLAW_DEFAULT_PORT,
  OPENCLAW_ENDPOINT_STORAGE_KEY,
  normalizeEndpointDraft,
  resolveReadonlyValidationEndpoint,
} from './utils/openClawEndpointConfig.js';
import {
  buildOpenClawValidationEndpointFingerprint,
  classifyReadonlyValidationFreshness,
  loadOpenClawReadonlyValidationEvidence,
  saveOpenClawReadonlyValidationEvidence,
} from '../../shared/agents/openClawReadonlyValidationStore.mjs';

const APP_COMPONENT_MARKER = STEPHANOS_UI_RUNTIME_MARKER;
const HEAVY_OLLAMA_MODELS = new Set(['gpt-oss:20b', 'qwen:14b', 'qwen:32b']);

const PANE_DRAG_HANDLE_SELECTOR = '[data-pane-drag-handle="true"]';
const PANE_DRAG_BLOCK_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'label',
  'a',
  '[role="button"]',
  '[data-no-drag]',
  '[data-stephanos-no-drag]',
].join(', ');

function readSurfaceModeFromLocation(windowRef = globalThis.window) {
  if (!windowRef?.location) {
    return 'mission-control';
  }
  const params = new URLSearchParams(windowRef.location.search || '');
  return resolveAgentSurfaceMode(params.get('surface') || params.get('app'));
}

function clearLauncherSurfaceQuery(windowRef = globalThis.window) {
  if (!windowRef?.location || !windowRef?.history?.replaceState) {
    return;
  }
  const currentUrl = new URL(windowRef.location.href);
  currentUrl.searchParams.delete('surface');
  currentUrl.searchParams.delete('app');
  currentUrl.searchParams.delete('destination');
  windowRef.history.replaceState(windowRef.history.state, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
}
function recordCommandDeckReturnDiagnostic(windowRef, key, value) {
  if (!windowRef || !key) return;
  const namespace = '__stephanosReturnDiagnostics';
  const store = windowRef[namespace] || {};
  const counters = store.counters || {};
  counters[key] = Number(counters[key] || 0) + 1;
  store.counters = counters;
  store[key] = value;
  windowRef[namespace] = store;
}

function countTelemetryEventsSince(entries = [], sinceMs = 0) {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  let count = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const timestampMs = Date.parse(entries[index]?.timestamp || '');
    if (!Number.isFinite(timestampMs) || timestampMs < sinceMs) break;
    count += 1;
  }
  return count;
}

function signaturesEqual(a, b) {
  return a === b;
}

function stableJsonSignature(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value ?? '');
  }
}

function buildOpenClawIntegrationInputSignature({
  routeTruthView = {},
  runtimeStatusModel = {},
  runtimeStatus = {},
} = {}) {
  const runtimeContext = runtimeStatusModel?.runtimeContext || runtimeStatus?.runtimeContext || {};
  return [
    String(routeTruthView?.routeKind || ''),
    String(routeTruthView?.routeLayerStatus || ''),
    String(routeTruthView?.selectedRouteReachableState || ''),
    String(routeTruthView?.routeUsableState || ''),
    String(routeTruthView?.backendReachableState || ''),
    String(routeTruthView?.selectedProvider || ''),
    String(routeTruthView?.executedProvider || ''),
    String(routeTruthView?.providerExecutionGateStatus || ''),
    String(routeTruthView?.backendExecutionContractStatus || ''),
    String(routeTruthView?.effectiveLaunchState || ''),
    String(runtimeContext?.repoBranch || runtimeStatus?.runtimeTruth?.repoBranch || 'unknown'),
  ].join('::');
}
function buildOpenClawIntegrationSignature(snapshot = {}) {
  return [
    String(snapshot.currentActivity || ''),
    String(snapshot.zeroCostGuardrailsStatus || ''),
    String(snapshot.approvalRequired || ''),
    String(snapshot.sandboxStatus || ''),
    Array.isArray(snapshot.warnings) ? snapshot.warnings.join('|') : '',
    String(snapshot.routeHealth || ''),
    String(snapshot.routeReachability || ''),
    String(snapshot.runtimeMode || ''),
  ].join('::');
}


export function shouldStartPaneDrag(target) {
  if (!target || typeof target.closest !== 'function') {
    return false;
  }

  const dragHandle = target.closest(PANE_DRAG_HANDLE_SELECTOR);
  if (!dragHandle) {
    return false;
  }

  return !target.closest(PANE_DRAG_BLOCK_SELECTOR);
}

export default function App() {
  recordPerfCounter('render', 'App');
  recordPerfCounter('hook.App.useAIConsole.render_or_call', 'called');
  const lastAppUpdateSourceRef = useRef('initial');
  const pendingAppUpdateSourcesRef = useRef([]);
  const consumedAppUpdateSourceRef = useRef('');
  const previousRenderSignatureRef = useRef('');
  const previousStoreChurnSignatureRef = useRef('');
  const renderCountRef = useRef(0);
  const {
    input,
    setInput,
    submitPrompt,
    cancelActivePrompt,
    emergencyReleaseOllamaLoad,
    commandHistory,
    refreshHealth,
    runAiButlerAction,
    aiActionState,
  } = useAIConsole();
  recordPerfCounter('hook.App.useAIStore.render_or_call', 'called');

  useEffect(() => {
    recordPerfCounter('surface_mount', 'app.mount');
    return () => recordPerfCounter('surface_mount', 'app.unmount');
  }, []);

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
    setPanelState,
    setPaneOrder,
    paneLayout,
    lastExecutionMetadata,
    missionPacketWorkflow,
    missionLineage,
    surfaceFrictionPatterns,
    debugData,
  } = useAIStore();
  const previousAppStoreFieldsRef = useRef(null);
  recordPerfCounter('hook.App.useDebugConsole.render_or_call', 'called');
  useDebugConsole();
  const startupStageRef = useRef(new Set());
  const markStartupStage = (stage, details = null) => {
    if (startupStageRef.current.has(stage)) {
      return;
    }
    startupStageRef.current.add(stage);
    recordStartupRenderStage({
      stage,
      status: 'ok',
      sourceModule: 'stephanos-ui/src/App.jsx',
      sourceFunction: 'App.render',
      details,
    });
  };
  markStartupStage('app-render-start');

  const safeUiLayout = uiLayout || {};
  const safePaneLayout = paneLayout && typeof paneLayout === 'object' ? paneLayout : {};
  const safeApiStatus = apiStatus || {};
  const safeProviderHealth = providerHealth && typeof providerHealth === 'object' ? providerHealth : {};
  const runtimeStatus = ensureRuntimeStatusModel(runtimeStatusModel);
  const appStoreFieldsSnapshot = useMemo(() => ({
    provider,
    routeMode,
    apiStatusState: safeApiStatus.state || '',
    providerHealthSignature: `${Object.keys(safeProviderHealth).length}:${String(safeProviderHealth[provider]?.status || '')}`,
    runtimeStatusState: runtimeStatus?.appLaunchState || '',
    uiLayoutSignature: `${Object.keys(safeUiLayout).length}:${Object.values(safeUiLayout).filter(Boolean).length}`,
    paneLayoutSignature: `${String(safePaneLayout.activeWorkspace || '')}:${Array.isArray(safePaneLayout.operatorPaneOrder) ? safePaneLayout.operatorPaneOrder.length : 0}`,
    missionPacketRevision: String(missionPacketWorkflow?.lastUpdatedAt || ''),
    missionLineageRevision: String(missionLineage?.lastUpdatedAt || ''),
    surfaceFrictionRevision: `${surfaceFrictionPatterns?.trend || ''}:${surfaceFrictionPatterns?.totalEvents || 0}`,
    debugDataRevision: `${String(debugData?.status || '')}:${String(debugData?.lastUpdatedAt || '')}`,
  }), [debugData?.lastUpdatedAt, debugData?.status, missionLineage?.lastUpdatedAt, missionPacketWorkflow?.lastUpdatedAt, provider, routeMode, runtimeStatus?.appLaunchState, safeApiStatus.state, safePaneLayout.activeWorkspace, safePaneLayout.operatorPaneOrder, safeProviderHealth, safeUiLayout, surfaceFrictionPatterns?.totalEvents, surfaceFrictionPatterns?.trend]);
  useEffect(() => {
    const previous = previousAppStoreFieldsRef.current;
    if (!previous) {
      previousAppStoreFieldsRef.current = appStoreFieldsSnapshot;
      return;
    }
    let changedCount = 0;
    Object.entries(appStoreFieldsSnapshot).forEach(([field, value]) => {
      if (previous[field] !== value) {
        changedCount += 1;
        recordPerfCounter('store.subscription.App.aiStore.selected_changed', field);
      } else {
        recordPerfCounter('store.subscription.App.aiStore.selected_unchanged', field);
      }
    });
    recordPerfCounter('store.subscription.App.aiStore.callback', changedCount === 0 ? 'selected_unchanged_all' : 'selected_changed');
    previousAppStoreFieldsRef.current = appStoreFieldsSnapshot;
  }, [appStoreFieldsSnapshot]);
  const [surfaceMode, setSurfaceMode] = useState(() => readSurfaceModeFromLocation());
  const launcherDestination = useMemo(() => {
    if (typeof window === 'undefined') {
      return '';
    }

    const params = new URLSearchParams(window.location.search);
    return String(params.get('destination') || '').trim().toLowerCase();
  }, []);
  const cockpitSurfaceMode = surfaceMode === 'cockpit';
  const agentsSurfaceMode = surfaceMode === 'agents';
  const missionConsoleSurfaceMode = surfaceMode === 'mission-console';
  const openClawSurfaceMode = surfaceMode === 'openclaw' || launcherDestination === 'openclaw';
  const capabilityRadarSurfaceMode = surfaceMode === 'capability-radar';
  const skillForgeSurfaceMode = surfaceMode === 'skill-forge' || launcherDestination === 'skill-forge';
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleRouteChange = () => {
      setSurfaceMode(readSurfaceModeFromLocation(window));
    };
    const returnToCommandDeck = () => {
      const surfaceBefore = readSurfaceModeFromLocation(window);
      const queryBefore = window.location?.search || '';
      recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.surface_before', surfaceBefore);
      recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.query_before', queryBefore);
      recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.active_tile_before', window.__stephanosRuntime?.context?.workspace?.activeProjectKey || '');
      try {
        if (window.parent && window.parent !== window && typeof window.parent.returnToCommandDeck === 'function') {
          const handledByParent = window.parent.returnToCommandDeck();
          recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.parent_handler_found', true);
          recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.parent_handler_invoked', true);
          recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.handler_invoked', 'parent_from_runtime');
          if (handledByParent !== false) {
            return true;
          }
        }
        const destination = resolveCommandDeckDestinationPath(window);
        recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.fallback_destination', destination);
        const currentUrl = String(window.location?.href || '').trim();
        if (destination && destination !== currentUrl) {
          window.location.assign(destination);
          recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.fallback_navigation_used', true);
          recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.handler_invoked', 'runtime_fallback_navigation');
          return true;
        }
        clearLauncherSurfaceQuery(window);
        setSurfaceMode('mission-control');
        recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.local_handler_invoked', true);
        recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.handler_invoked', 'runtime_local');
        recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.surface_after', 'mission-control');
        recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.query_after', window.location?.search || '');
        recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.active_tile_after', '');
        return true;
      } catch (error) {
        const message = String(error?.message || error || 'unknown');
        recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.handler_error', message);
        try {
          window.parent?.postMessage?.({ type: 'stephanos:return-to-command-deck', source: 'stephanos-runtime' }, '*');
          recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.parent_handler_invoked', 'postmessage');
          recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.handler_invoked', 'parent_postmessage');
          return true;
        } catch (postMessageError) {
          recordCommandDeckReturnDiagnostic(window, 'commandDeckReturn.handler_error', String(postMessageError?.message || postMessageError || message));
          return false;
        }
      }
    };
    window.addEventListener('popstate', handleRouteChange);
    window.returnToCommandDeck = returnToCommandDeck;
    return () => {
      window.removeEventListener('popstate', handleRouteChange);
      if (window.returnToCommandDeck === returnToCommandDeck) {
        delete window.returnToCommandDeck;
      }
    };
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const { pathname = '', search = '', hash = '', href = '' } = window.location || {};
    setPerfIdentityField('page.url', href);
    setPerfIdentityField('page.title', typeof document !== 'undefined' ? document.title || '' : '');
    setPerfIdentityField('route.pathname', pathname);
    setPerfIdentityField('route.search', search);
    setPerfIdentityField('route.hash', hash);
    setPerfIdentityField('surface.mode', surfaceMode || '');
    setPerfIdentityField('surface.workspace', missionConsoleSurfaceMode || '');
    setPerfIdentityField('component.app', true);
  }, [missionConsoleSurfaceMode, surfaceMode]);
  const routeTruthView = useMemo(() => buildFinalRouteTruthView(runtimeStatus), [runtimeStatus]);
  useEffect(() => {
    if (launcherDestination !== 'openclaw') {
      return;
    }

    setPanelState('missionConsolePanel', true);
    setPanelState('openClawPanel', true);
  }, [launcherDestination, setPanelState]);
  markStartupStage('app-derived-route-truth-ready', {
    routeKind: routeTruthView?.routeKind || '',
    routeUsableState: routeTruthView?.routeUsableState || '',
  });
  const providerSummary = buildProviderStatusSummary(
    provider,
    getActiveProviderConfig(),
    safeApiStatus.baseUrl,
    safeProviderHealth[provider],
  );
  const activeProviderModel = String(getActiveProviderConfig()?.model || '').trim().toLowerCase();
  const heavyOllamaModelActive = provider === 'ollama' && HEAVY_OLLAMA_MODELS.has(activeProviderModel);
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
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [agentControls, setAgentControls] = useState({
    visible: false,
    globalVisibilityToggle: true,
    autonomyMasterToggle: true,
    safeMode: false,
    debugVisibility: false,
    globalAutonomy: 'assisted',
    agentEnabledMap: {},
  });
  const [metricsTick, setMetricsTick] = useState(() => Date.now());
  const [openClawIntegration, setOpenClawIntegration] = useState(() => buildOpenClawIntegrationSnapshot({
    runtimeStatusModel,
    finalRouteTruth: routeTruthView,
    repoPath: '/workspace/stephan-os',
    branchName: runtimeStatus?.runtimeContext?.repoBranch || runtimeStatus?.runtimeTruth?.repoBranch || 'unknown',
  }));
  const [intentToBuildTruth, setIntentToBuildTruth] = useState({
    latestMissionId: 'n/a',
    missionStatus: 'draft',
    approvalRequired: 'no',
    generatedPromptAvailable: 'no',
    verificationStatus: 'pending',
  });
  const [missionBridgeTruth, setMissionBridgeTruth] = useState(null);
  const [openClawEndpointDraft, setOpenClawEndpointDraft] = useState({
    endpointLabel: 'Local OpenClaw Adapter',
    endpointHost: OPENCLAW_DEFAULT_HOST,
    endpointPort: OPENCLAW_DEFAULT_PORT,
    endpointScope: 'local_only',
    expectedProtocolVersion: 'v1',
    expectedAdapterIdentity: '',
    allowedProbeTypes: 'health_and_handshake',
    configPersistenceMode: 'session_only',
    endpointMode: 'configured',
  });
  const [openClawReadonlyValidation, setOpenClawReadonlyValidation] = useState({
    validationStatus: 'idle',
    validationMode: 'health_and_handshake',
    validationSource: 'operator',
    validationEvidence: ['safe-probe-path:available'],
    safeProbePathAvailable: true,
    readonlyValidationEndpoint: OPENCLAW_READONLY_VALIDATION_ENDPOINT,
    openClawReadonlyValidationEndpointAvailable: OPENCLAW_READONLY_VALIDATION_ENDPOINT.available,
    openClawReadonlyValidationEndpointPath: OPENCLAW_READONLY_VALIDATION_ENDPOINT.path,
    openClawReadonlyValidationEndpointMode: OPENCLAW_READONLY_VALIDATION_ENDPOINT.mode,
    openClawReadonlyValidationEndpointCanExecute: OPENCLAW_READONLY_VALIDATION_ENDPOINT.canExecute,
    validationFreshness: 'unknown',
    validationRestoredFromStorage: false,
    validationLastCheckedAt: '',
  });
  const telemetryBaselineAddedRef = useRef(false);
  const previousTelemetryTruthRef = useRef(null);
  const finalRouteTruth = runtimeStatusModel?.finalRouteTruth ?? null;
  const continuitySnapshot = useMemo(
    () => deriveContinuityLoopSnapshot({ runtimeStatus, commandHistory, telemetryEntries, now: metricsTick }),
    [runtimeStatus, commandHistory, telemetryEntries, metricsTick],
  );
  renderCountRef.current += 1;
  const renderSignature = [
    surfaceMode,
    missionConsoleSurfaceMode ? 'mission-console:1' : 'mission-console:0',
    runtimeStatus?.appLaunchState || '',
    runtimeStatus?.runtimeTruth?.runtimeState || '',
    routeTruthView?.routeKind || '',
    routeTruthView?.routeUsableState || '',
    routeTruthView?.backendReachableState || '',
    safeApiStatus.state || '',
    safeApiStatus.detail || '',
    provider || '',
    safeProviderHealth?.[provider]?.status || '',
    uiLayout?.workspacePaneCanonEnabled ? 'panecanon:1' : 'panecanon:0',
    safePaneLayout?.activePaneId || '',
    Array.isArray(safePaneLayout?.order) ? safePaneLayout.order.join('|') : '',
    telemetryEntries.length,
    continuitySnapshot?.recentContinuityEvents?.length || 0,
    continuitySnapshot?.recentActivityActive ? 'activity:1' : 'activity:0',
    metricsTick,
  ].join('::');
  const storeChurnSignature = [
    safeUiLayout?.debugConsole ? 'debug:1' : 'debug:0',
    String(runtimeStatusModel?.runtimeMarker || ''),
    String(runtimeStatusModel?.runtimeContext?.runtimeGovernorMode || ''),
    String(runtimeStatusModel?.runtimeContext?.runtimeGovernorLeader || ''),
    String(runtimeStatusModel?.runtimeContext?.runtimeGovernorReason || ''),
    String(runtimeStatusModel?.runtimeContext?.lastGovernorHeartbeat || ''),
  ].join('::');
  if (renderCountRef.current === 1) {
    recordPerfCounter('render_reason.App', 'initial');
  } else if (previousRenderSignatureRef.current === renderSignature) {
    if (previousStoreChurnSignatureRef.current === storeChurnSignature) {
      recordPerfCounter('render_reason.App', 'parent_forced');
    } else {
      recordPerfCounter('render_reason.App', 'provider_churn');
    }
    recordPerfCounter('render_reason.App', 'no_semantic_change');
  } else {
    recordPerfCounter('render_reason.App', 'state_changed');
  }
  const pendingSource = pendingAppUpdateSourcesRef.current.shift();
  if (pendingSource) {
    consumedAppUpdateSourceRef.current = pendingSource;
    lastAppUpdateSourceRef.current = pendingSource;
    recordPerfCounter('render_trigger.App.last_source', pendingSource);
    recordPerfCounter('app_render_after_update', pendingSource);
  } else if (renderCountRef.current > 1) {
    consumedAppUpdateSourceRef.current = '';
    recordPerfCounter('render_trigger.App', 'unknown_external');
  }
  previousRenderSignatureRef.current = renderSignature;
  previousStoreChurnSignatureRef.current = storeChurnSignature;
  const missionPacketTruth = useMemo(
    () => normalizeMissionPacketTruth(lastExecutionMetadata || {}),
    [lastExecutionMetadata],
  );
  const canonicalMemoryContext = useMemo(() => buildCanonicalMemoryContext({
    continuitySnapshot,
    missionPacketWorkflow,
    memoryElevation: runtimeStatus?.runtimeTruth?.memoryElevation || {},
    surfaceAwareness: runtimeStatus?.runtimeContext?.surfaceAwareness || {},
    surfaceFrictionPatterns,
  }), [continuitySnapshot, missionPacketWorkflow, runtimeStatus?.runtimeContext?.surfaceAwareness, runtimeStatus?.runtimeTruth?.memoryElevation, surfaceFrictionPatterns]);
  const canonicalCurrentIntent = useMemo(() => buildCanonicalCurrentIntent({
    intent: runtimeStatus?.runtimeTruth?.intent || {},
    operatorIntentCapture: missionPacketWorkflow?.operatorIntentCapture || {},
    missionPacket: {
      ...missionPacketTruth,
      status: missionPacketTruth.active ? 'awaiting-approval' : 'proposed',
      title: missionPacketTruth.moveTitle,
    },
    proposal: {
      active: missionPacketTruth.active,
      moveId: missionPacketTruth.moveId,
      warnings: missionPacketTruth.warnings,
      status: missionPacketTruth.active ? 'proposed' : 'proposed',
    },
    execution: {
      lastExecutionMetadata,
      status: lastExecutionMetadata?.provider_answered === false
        ? 'failed'
        : lastExecutionMetadata?.actual_provider_used ? 'completed' : 'not-executing',
      actualProvider: lastExecutionMetadata?.actual_provider_used,
    },
  }), [lastExecutionMetadata, missionPacketTruth, missionPacketWorkflow?.operatorIntentCapture, runtimeStatus?.runtimeTruth?.intent]);
  const canonicalMissionPacket = useMemo(() => buildCanonicalMissionPacket({
    missionPacketTruth,
    missionPacketWorkflow,
    currentIntent: canonicalCurrentIntent,
    operatorIntentCapture: missionPacketWorkflow?.operatorIntentCapture || {},
  }), [canonicalCurrentIntent, missionPacketTruth, missionPacketWorkflow]);
  const canonicalSourceDistAlignment = useMemo(() => buildCanonicalSourceDistAlignment({
    sourceFingerprint: STEPHANOS_UI_SOURCE_FINGERPRINT,
    buildRuntimeMarker: STEPHANOS_UI_RUNTIME_MARKER,
    buildCommit: STEPHANOS_UI_GIT_COMMIT,
    buildTimestamp: STEPHANOS_UI_BUILD_TIMESTAMP,
    runtimeTruth: runtimeStatus?.runtimeTruth || {},
    runtimeContext: runtimeStatus?.runtimeContext || {},
  }), [runtimeStatus?.runtimeContext, runtimeStatus?.runtimeTruth]);
  const orchestrationSelectors = useMemo(() => deriveRuntimeOrchestrationSelectors({
    canonicalMemoryContext,
    canonicalCurrentIntent,
    canonicalMissionPacket,
    missionPacketWorkflow,
    missionLineage,
    finalRouteTruth,
  }), [canonicalCurrentIntent, canonicalMemoryContext, canonicalMissionPacket, finalRouteTruth, missionPacketWorkflow, missionLineage]);
  markStartupStage('app-derived-orchestration-selectors-ready', {
    executionState: orchestrationSelectors?.executionState || '',
    continuityState: orchestrationSelectors?.continuityState || '',
  });
  const orchestrationTruth = useMemo(() => ({
    canonicalMemoryContext,
    canonicalCurrentIntent,
    canonicalMissionPacket,
    canonicalSourceDistAlignment,
    selectors: orchestrationSelectors,
    latestResponseEnvelope: debugData?.latestOperatorCommandEnvelope || null,
  }), [canonicalCurrentIntent, canonicalMemoryContext, canonicalMissionPacket, canonicalSourceDistAlignment, orchestrationSelectors, debugData?.latestOperatorCommandEnvelope]);
  const actionHints = useMemo(() => collectActionHints(finalRouteTruth, orchestrationTruth)
    .map((hint) => (typeof hint === 'string'
      ? { severity: 'info', subsystem: 'SYSTEM', text: hint }
      : hint)), [finalRouteTruth, orchestrationTruth]);
  const agentRegistry = useMemo(() => buildAgentRegistry(), []);
  const agentEventLog = useMemo(() => {
    const now = new Date().toISOString();
    const latestCommand = Array.isArray(commandHistory) && commandHistory.length > 0 ? commandHistory[commandHistory.length - 1] : null;
    const latestPrompt = String(latestCommand?.prompt || latestCommand?.command || '').trim();
    const latestTaskId = String(latestCommand?.id || latestCommand?.request_id || '').trim();
    const includesResearch = /research|fresh|latest|today|news/i.test(latestPrompt);
    const includesExecution = /run|execute|build|test|install|deploy/i.test(latestPrompt);
    const includesIdeas = /idea|brainstorm|concept/i.test(latestPrompt);
    const events = [
      { agentId: 'intent-engine', type: 'state', state: latestPrompt ? 'acting' : 'watching', reason: latestPrompt ? 'Parsing operator request into task graph.' : 'Watching for operator intent.', at: now },
      { agentId: 'intent-engine', type: 'task', taskId: latestTaskId, taskSummary: latestPrompt || 'Awaiting operator request.', at: now },
      { agentId: 'intent-engine', type: 'action', reason: 'Intent normalization updated.', at: now },
      { agentId: 'memory-agent', type: 'state', state: missionPacketWorkflow?.active ? 'preparing' : 'watching', reason: missionPacketWorkflow?.active ? 'Evaluating mission packet for continuity memory candidates.' : 'Watching continuity stream for new candidates.', at: now },
    ];
    if (includesResearch) {
      events.push(
        { agentId: 'research-agent', type: 'state', state: 'acting', reason: 'Fresh-world evidence required by operator request.', at: now },
        { agentId: 'research-agent', type: 'handoff', fromAgentId: 'intent-engine', toAgentId: 'research-agent', reason: 'intent-engine → research-agent', at: now },
      );
    }
    if (missionPacketWorkflow?.active || String(latestCommand?.continuity_mode || '').toLowerCase() === 'retrieval-active') {
      events.push(
        { agentId: 'memory-agent', type: 'handoff', fromAgentId: 'intent-engine', toAgentId: 'memory-agent', reason: 'intent-engine → memory-agent', at: now },
        { agentId: 'memory-agent', type: 'action', reason: 'Continuity retrieval/adjudication cycle advanced.', at: now },
      );
    }
    if (aiActionState?.isRunning || includesExecution) {
      events.push(
        { agentId: 'execution-agent', type: 'state', state: aiActionState?.isRunning ? 'acting' : 'preparing', reason: aiActionState?.isRunning ? 'Executing approved workflow action.' : 'Execution-capable task detected, awaiting approval.', at: now },
        { agentId: 'execution-agent', type: 'handoff', fromAgentId: 'intent-engine', toAgentId: 'execution-agent', reason: 'intent-engine → execution-agent', at: now },
      );
    }
    if (includesIdeas) {
      events.push(
        { agentId: 'ideas-agent', type: 'state', state: 'acting', reason: 'Idea signal detected and being normalized.', at: now },
        { agentId: 'ideas-agent', type: 'handoff', fromAgentId: 'intent-engine', toAgentId: 'ideas-agent', reason: 'intent-engine → ideas-agent', at: now },
      );
    }
    return events;
  }, [aiActionState?.isRunning, commandHistory, missionPacketWorkflow?.active]);
  const latestCommandPrompt = useMemo(() => {
    const latestCommand = Array.isArray(commandHistory) && commandHistory.length > 0 ? commandHistory[commandHistory.length - 1] : null;
    return String(latestCommand?.prompt || latestCommand?.command || '').trim();
  }, [commandHistory]);
  const hasFreshResearchIntent = /research|fresh|latest|today|news/i.test(latestCommandPrompt);
  const hasAssignedTaskIntent = latestCommandPrompt.length > 0;
  const runtimeTruthDependencyGate = useMemo(() => evaluateRuntimeTruthDependencyGate({
    routeTruthView,
    runtimeStatus,
  }), [routeTruthView, runtimeStatus]);
  const agentTruth = useMemo(() => adjudicateAgents({
    registry: agentRegistry,
    eventLog: agentEventLog,
    context: {
      sessionKind: runtimeStatus?.runtimeContext?.sessionKind || 'local-dev',
      surface: openClawSurfaceMode
        ? 'openclaw'
        : missionConsoleSurfaceMode
          ? 'mission-console'
          : agentsSurfaceMode
            ? 'agents'
            : cockpitSurfaceMode
              ? 'cockpit'
              : 'mission-control',
      dependencyReadyMap: {
        'runtime-truth': runtimeTruthDependencyGate.passed,
        'provider-routing': routeTruthView?.routeUsableState !== 'no',
        'shared-memory': continuitySnapshot?.memoryCapabilityReady === true,
        'operator-policy': true,
        'intent-engine': true,
        'memory-agent': true,
      },
      memoryCapability: {
        state: continuitySnapshot?.memoryCapabilityState || 'unavailable',
        ready: continuitySnapshot?.memoryCapabilityReady === true,
        canonical: continuitySnapshot?.memoryCapabilityCanonical === true,
        reason: continuitySnapshot?.memoryCapabilityReason || 'Memory capability state unavailable.',
      },
      providerRouteTruth: {
        passed: routeTruthView?.routeUsableState === 'yes' && (routeTruthView?.backendReachableState === 'yes' || routeTruthView?.routeKind === 'local'),
        reason: routeTruthView?.routeUsableState !== 'yes'
          ? routeTruthView?.routeStatusReason || 'Route is not currently usable.'
          : routeTruthView?.backendReachableState !== 'yes' && routeTruthView?.routeKind !== 'local'
            ? routeTruthView?.backendStatusReason || 'Waiting for route/provider viability.'
            : 'Route/provider viability is healthy.',
      },
      currentIntentState: hasAssignedTaskIntent ? 'classified' : 'none',
      currentIntentReason: hasAssignedTaskIntent ? 'Command intent parsed from latest operator request.' : 'Waiting for intent classification.',
      hasFreshIntent: hasFreshResearchIntent,
      hasAssignedTask: hasAssignedTaskIntent,
      hasTaskIntent: hasAssignedTaskIntent,
    },
    operatorControls: agentControls,
  }), [agentControls, agentEventLog, agentRegistry, agentsSurfaceMode, cockpitSurfaceMode, hasAssignedTaskIntent, hasFreshResearchIntent, missionConsoleSurfaceMode, continuitySnapshot?.memoryCapabilityCanonical, continuitySnapshot?.memoryCapabilityReady, continuitySnapshot?.memoryCapabilityReason, continuitySnapshot?.memoryCapabilityState, openClawSurfaceMode, routeTruthView?.backendReachableState, routeTruthView?.backendStatusReason, routeTruthView?.routeKind, routeTruthView?.routeStatusReason, routeTruthView?.routeUsableState, runtimeStatus?.runtimeContext?.sessionKind, runtimeTruthDependencyGate.passed]);
  const finalAgentView = useMemo(() => buildFinalAgentView({
    adjudicated: agentTruth,
    selectedAgentId,
  }), [agentTruth, selectedAgentId]);
  const displayAgentView = agentControls.globalVisibilityToggle
    ? finalAgentView
    : {
      ...finalAgentView,
      visibleAgents: [],
      activeAgentIds: [],
      actingAgentId: '',
      operatorSummary: 'Agent visuals are hidden by operator quick control.',
    };
  const agentSurfaceProjection = useMemo(() => buildAgentSurfaceProjection({
    finalAgentView: displayAgentView,
    surfaceMode,
  }), [displayAgentView, surfaceMode]);
  const agentTaskProjection = useMemo(() => {
    const missionPacket = missionBridgeTruth?.missionPacket || {};
    const missionEvents = Array.isArray(missionBridgeTruth?.events) ? missionBridgeTruth.events : [];
    const codexEventReady = missionEvents.some((entry) => entry?.type === 'codex-handoff-ready');
    const codexReadiness = codexEventReady
      ? 'ready'
      : missionPacket?.codexHandoffEligible === true
        ? 'manual_handoff_only'
        : 'needs_adapter';
    const hasOpenClawPolicyHarness = openClawIntegration?.zeroCostGuardrailsStatus === 'validated'
      && String(openClawIntegration?.approvalRequired || '').toLowerCase() === 'required'
      && String(openClawIntegration?.sandboxStatus || '').toLowerCase() !== 'unsafe';

    return buildAgentTaskProjection({
      model: {
        taskIdentity: {
          taskId: missionPacket?.missionId || 'agent-task-layer-v1',
          title: missionPacket?.missionTitle || 'Agent Task Layer v1',
          operatorIntent: canonicalCurrentIntent?.operatorIntent?.label || latestCommandPrompt || 'Upgrade agent task truth surfaces.',
          taskType: missionPacket?.intentType || 'system-upgrade',
          targetArea: 'agent-layer',
          createdAt: missionPacket?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        taskLifecycle: {
          state: missionBridgeTruth?.state === 'blocked'
            ? 'blocked'
            : missionBridgeTruth?.state === 'awaiting-approval'
              ? 'ready_for_review'
              : hasAssignedTaskIntent
                ? 'in_progress'
                : 'draft',
        },
        agentAssignment: {
          recommendedAgent: missionPacket?.agentAssignments?.[0]?.roleId || 'stephanos',
          assignedAgent: missionBridgeTruth?.orchestration?.actingAgent || displayAgentView?.actingAgentId || 'manual',
          availableAgents: ['stephanos', 'codex', 'openclaw', 'manual'],
          agentReason: missionBridgeTruth?.nextRecommendedAction || displayAgentView?.operatorSummary || 'Awaiting adjudication from runtime truth.',
        },
        agentReadiness: {
          stephanos: 'ready',
          codex: codexReadiness,
          openclaw: hasOpenClawPolicyHarness ? 'needs_adapter' : 'needs_policy',
          manual: 'available',
        },
        approvalGates: {
          required: ['approve_scope', 'approve_file_access', 'approve_command_execution', 'approve_handoff', 'approve_merge_or_push'],
          approved: missionBridgeTruth?.pendingApproval === true ? [] : ['approve_scope'],
          blocked: hasOpenClawPolicyHarness ? [] : ['approve_handoff'],
        },
        taskConstraints: {
          requiredChecks: ['npm run stephanos:build', 'npm run stephanos:verify'],
          riskLevel: missionBridgeTruth?.pendingApproval ? 'high' : 'moderate',
        },
        handoff: {
          handoffTarget: 'codex',
          handoffMode: codexReadiness === 'ready' ? 'local_adapter' : 'manual_prompt',
          handoffReady: codexEventReady && missionBridgeTruth?.pendingApproval !== true,
          handoffBlockers: missionBridgeTruth?.pendingApproval === true ? ['Mission packet is approval-gated.'] : [],
          handoffPacketSummary: missionPacket?.missionSummary || missionPacket?.missionTitle || 'Use Prompt Builder output for manual Codex handoff packet.',
        },
        verification: {
          verificationRequired: true,
          verificationChecks: ['npm run stephanos:build', 'npm run stephanos:verify'],
          verificationStatus: missionEvents.some((entry) => entry?.type === 'mission-complete') ? 'passed' : 'not_started',
          lastVerificationResult: missionEvents.some((entry) => entry?.type === 'mission-complete')
            ? 'Mission bridge reached complete state; rerun build/verify gates before merge.'
            : 'Verification loop pending.',
        },
        evidence: {
          reasons: [displayAgentView?.operatorSummary, missionBridgeTruth?.nextRecommendedAction].filter(Boolean),
          blockers: [orchestrationSelectors?.blockageExplanation, openClawIntegration?.warnings?.[0]].filter(Boolean),
          warnings: openClawIntegration?.warnings || [],
          dependencies: ['Prompt Builder', 'Telemetry Feed', 'Mission Bridge'],
          sourceSignals: [
            `agentVisible:${displayAgentView?.visibleAgents?.length || 0}`,
            `pendingApprovals:${displayAgentView?.finalApprovalQueueView?.pendingCount || 0}`,
          ],
        },
        openClawPolicy: {
          integrationMode: hasOpenClawPolicyHarness ? 'policy_only' : 'policy_only',
          adapterPresent: true,
          localAdapterAvailable: true,
          directAdapterAvailable: false,
          requiredApprovals: ['approve_handoff'],
          satisfiedApprovals: missionBridgeTruth?.pendingApproval === true ? [] : ['approve_handoff'],
          killSwitchState: hasOpenClawPolicyHarness ? 'required' : 'missing',
          blockers: [
            ...(openClawIntegration?.warnings || []),
            'Policy-only harness active; direct OpenClaw automation is intentionally disabled.',
          ],
        },
        openClawAdapter: {
          adapterStub: {
            stubMode: 'disabled',
            stubStatus: 'present_disabled',
            stubConnectionState: 'not_connected',
            stubExecutionCapability: 'none',
            stubHealth: 'healthy',
            stubBlockers: [],
            stubWarnings: ['OpenClaw Local Adapter Stub v1 is status/health-only; live execution is intentionally disabled.'],
          },
          adapterMode: 'contract_defined',
          adapterConnectionState: 'not_connected',
          adapterExecutionMode: 'disabled',
          adapterBlockers: ['OpenClaw local adapter is not connected.'],
          adapterWarnings: ['No live OpenClaw automation is enabled.'],
          adapterConnection: {
            connectionConfig: {
              ...openClawEndpointDraft,
              endpointConfigured: Boolean((openClawEndpointDraft.endpointHost || '').trim() || (openClawEndpointDraft.endpointPort || '').trim()),
            },
            healthHandshake: openClawReadonlyValidation,
          },
        },
      },
      context: {
        agentTileProjectionConnected: true,
      },
    });
  }, [canonicalCurrentIntent?.operatorIntent?.label, displayAgentView?.actingAgentId, displayAgentView?.finalApprovalQueueView?.pendingCount, displayAgentView?.operatorSummary, displayAgentView?.visibleAgents?.length, hasAssignedTaskIntent, latestCommandPrompt, missionBridgeTruth, openClawEndpointDraft, openClawIntegration?.approvalRequired, openClawIntegration?.sandboxStatus, openClawIntegration?.warnings, openClawIntegration?.zeroCostGuardrailsStatus, openClawReadonlyValidation, orchestrationSelectors?.blockageExplanation]);


  const markPendingAppUpdateSource = (source) => {
    if (!source) return;
    lastAppUpdateSourceRef.current = source;
    pendingAppUpdateSourcesRef.current.push(source);
  };
  const openClawIntegrationExternalSigRef = useRef(stableJsonSignature(openClawIntegration));
  const intentToBuildExternalSigRef = useRef(stableJsonSignature(intentToBuildTruth));
  const missionBridgeExternalSigRef = useRef(stableJsonSignature(missionBridgeTruth));
  const trackedSetOpenClawIntegration = useCallback((nextValueOrUpdater) => {
    recordPerfCounter('hook.App.externalSetter.openClawIntegration.called', 'called');
    setOpenClawIntegration((previous) => {
      const next = typeof nextValueOrUpdater === 'function' ? nextValueOrUpdater(previous) : nextValueOrUpdater;
      const previousSig = openClawIntegrationExternalSigRef.current || stableJsonSignature(previous);
      const nextSig = stableJsonSignature(next);
      if (previousSig === nextSig) {
        recordPerfCounter('hook.App.externalSetter.openClawIntegration.skipped', 'unchanged');
        return previous;
      }
      openClawIntegrationExternalSigRef.current = nextSig;
      markPendingAppUpdateSource('setOpenClawIntegration.external');
      recordPerfCounter('hook.App.externalSetter.openClawIntegration.changed', 'changed');
      return next;
    });
  }, []);
  const trackedSetIntentToBuildTruth = useCallback((nextValueOrUpdater) => {
    recordPerfCounter('hook.App.externalSetter.intentToBuildTruth.called', 'called');
    setIntentToBuildTruth((previous) => {
      const next = typeof nextValueOrUpdater === 'function' ? nextValueOrUpdater(previous) : nextValueOrUpdater;
      const previousSig = intentToBuildExternalSigRef.current || stableJsonSignature(previous);
      const nextSig = stableJsonSignature(next);
      if (previousSig === nextSig) {
        recordPerfCounter('hook.App.externalSetter.intentToBuildTruth.skipped', 'unchanged');
        return previous;
      }
      intentToBuildExternalSigRef.current = nextSig;
      markPendingAppUpdateSource('setIntentToBuildTruth.external');
      recordPerfCounter('hook.App.externalSetter.intentToBuildTruth.changed', 'changed');
      return next;
    });
  }, []);
  const trackedSetMissionBridgeTruth = useCallback((nextValueOrUpdater) => {
    recordPerfCounter('hook.App.externalSetter.missionBridgeTruth.called', 'called');
    setMissionBridgeTruth((previous) => {
      const next = typeof nextValueOrUpdater === 'function' ? nextValueOrUpdater(previous) : nextValueOrUpdater;
      const previousSig = missionBridgeExternalSigRef.current || stableJsonSignature(previous);
      const nextSig = stableJsonSignature(next);
      if (previousSig === nextSig) {
        recordPerfCounter('hook.App.externalSetter.missionBridgeTruth.skipped', 'unchanged');
        return previous;
      }
      missionBridgeExternalSigRef.current = nextSig;
      markPendingAppUpdateSource('setMissionBridgeTruth.external');
      recordPerfCounter('hook.App.externalSetter.missionBridgeTruth.changed', 'changed');
      return next;
    });
  }, []);

  const openClawIntegrationSignatureRef = useRef('');
  const openClawIntegrationInputSignature = useMemo(() => buildOpenClawIntegrationInputSignature({
    routeTruthView,
    runtimeStatusModel,
    runtimeStatus,
  }), [routeTruthView?.backendExecutionContractStatus, routeTruthView?.backendReachableState, routeTruthView?.effectiveLaunchState, routeTruthView?.executedProvider, routeTruthView?.providerExecutionGateStatus, routeTruthView?.routeKind, routeTruthView?.routeLayerStatus, routeTruthView?.routeUsableState, routeTruthView?.selectedProvider, routeTruthView?.selectedRouteReachableState, runtimeStatus?.runtimeContext?.repoBranch, runtimeStatus?.runtimeTruth?.repoBranch, runtimeStatusModel?.runtimeContext]);

  useEffect(() => {
    recordPerfCounter('app_state.openClawIntegration.effect_called', 'routeTruth');
    if (signaturesEqual(openClawIntegrationSignatureRef.current, openClawIntegrationInputSignature)) {
      recordPerfCounter('app_state.openClawIntegration.effect_skipped_same_signature', 'routeTruth');
      return;
    }

    lastAppUpdateSourceRef.current = 'setOpenClawIntegration.routeTruth';
    recordPerfCounter('app_update_source.setOpenClawIntegration.routeTruth', 'called');
    setOpenClawIntegration((previous) => {
      if (previous && previous.currentActivity !== 'Standing by for bounded intent.') {
        recordPerfCounter('app_state.openClawIntegration.skipped', 'activity_locked');
        recordPerfCounter('app_update_source.setOpenClawIntegration.routeTruth', 'skipped');
        return previous;
      }
      const next = buildOpenClawIntegrationSnapshot({
        runtimeStatusModel,
        finalRouteTruth: routeTruthView,
        repoPath: '/workspace/stephan-os',
        branchName: runtimeStatus?.runtimeContext?.repoBranch || runtimeStatus?.runtimeTruth?.repoBranch || 'unknown',
      });
      const prevSig = buildOpenClawIntegrationSignature(previous);
      const nextSig = buildOpenClawIntegrationSignature(next);
      if (signaturesEqual(prevSig, nextSig)) {
        openClawIntegrationSignatureRef.current = openClawIntegrationInputSignature;
        recordPerfCounter('app_state.openClawIntegration.setter_skipped_same_semantic', 'routeTruth');
        recordPerfCounter('app_update_source.setOpenClawIntegration.routeTruth', 'skipped');
        return previous ?? next;
      }
      openClawIntegrationSignatureRef.current = openClawIntegrationInputSignature;
      recordPerfCounter('app_state.openClawIntegration.setter_changed', 'routeTruth');
      recordPerfCounter('app_state.openClawIntegration.effect_applied', 'routeTruth');
      recordPerfCounter('app_update_source.setOpenClawIntegration.routeTruth', 'changed');
      markPendingAppUpdateSource('setOpenClawIntegration.routeTruth');
      return next;
    });
  }, [openClawIntegrationInputSignature, routeTruthView?.routeKind, routeTruthView?.routeLayerStatus, routeTruthView?.selectedRouteReachableState, routeTruthView?.routeUsableState, routeTruthView?.backendReachableState, routeTruthView?.selectedProvider, routeTruthView?.executedProvider, routeTruthView?.providerExecutionGateStatus, routeTruthView?.backendExecutionContractStatus, routeTruthView?.effectiveLaunchState, runtimeStatus?.runtimeContext?.repoBranch, runtimeStatus?.runtimeTruth?.repoBranch]);
  markStartupStage('app-derived-agent-projection-ready', {
    surfaceMode,
    visibleAgentCount: agentSurfaceProjection?.visibleAgentCount ?? null,
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const TICK_VISIBLE_MS = 30_000;
    const TICK_HIDDEN_MS = 120_000;
    let tickId = null;
    const restartTick = () => {
      if (tickId != null) window.clearInterval(tickId);
      const nextIntervalMs = document.visibilityState === 'visible' ? TICK_VISIBLE_MS : TICK_HIDDEN_MS;
      recordPerfCounter('timers', 'app.metricsTick.restart');
      setPerfIdentityField('timers.metricsTick.cadenceMs', nextIntervalMs);
      tickId = window.setInterval(() => {
        recordPerfCounter('app_timer.metricsTick.tick', document.visibilityState === 'visible' ? 'visible' : 'hidden');
        setMetricsTick((previous) => {
          const next = Date.now();
          recordPerfCounter('app_state.metricsTick.called', 'timer');
          if (next <= previous) {
            recordPerfCounter('app_state.metricsTick.skipped', 'non_monotonic');
            recordPerfCounter('app_update_source.setMetricsTick.timer', 'skipped');
            return previous;
          }
          lastAppUpdateSourceRef.current = 'setMetricsTick.timer';
          markPendingAppUpdateSource('setMetricsTick.timer');
          recordPerfCounter('app_update_source.setMetricsTick.timer', 'changed');
          recordPerfCounter('app_state.metricsTick.changed', 'timer');
          return next;
        });
      }, nextIntervalMs);
    };
    const handleVisibilityChange = () => restartTick();
    restartTick();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      if (tickId != null) window.clearInterval(tickId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const runtimeDiagnostics = useMemo(() => {
    const totalPanels = Object.keys(safeUiLayout).filter((panelId) => panelId.endsWith('Panel')).length;
    const activePanels = Object.entries(safeUiLayout)
      .filter(([panelId, value]) => panelId.endsWith('Panel') && value !== false)
      .length;
    const tenSecondsAgo = metricsTick - 10_000;
    const eventRate = countTelemetryEventsSince(telemetryEntries, tenSecondsAgo) / 10;
    return {
      activeTimerCount: 2,
      activeListenerCount: 2,
      telemetryHistoryLength: telemetryEntries.length,
      continuityEventCount: continuitySnapshot.recentContinuityEvents.length,
      activePanels,
      totalPanels,
      animationActiveCount: continuitySnapshot.recentActivityActive ? 1 : 0,
      eventRatePerSecond: Number.isFinite(eventRate) ? Number(eventRate.toFixed(2)) : 0,
    };
  }, [continuitySnapshot.recentActivityActive, continuitySnapshot.recentContinuityEvents.length, metricsTick, safeUiLayout, telemetryEntries]);

  useEffect(() => {
    lastAppUpdateSourceRef.current = 'setUiDiagnostics.runtimeDiagnostics';
    recordPerfCounter('app_update_source.setUiDiagnostics.runtimeDiagnostics', 'called');
    setUiDiagnostics((prev) => {
      const previousDiagnostics = prev?.runtimeDiagnostics || null;
      const unchanged = previousDiagnostics
        && previousDiagnostics.activeTimerCount === runtimeDiagnostics.activeTimerCount
        && previousDiagnostics.activeListenerCount === runtimeDiagnostics.activeListenerCount
        && previousDiagnostics.telemetryHistoryLength === runtimeDiagnostics.telemetryHistoryLength
        && previousDiagnostics.continuityEventCount === runtimeDiagnostics.continuityEventCount
        && previousDiagnostics.activePanels === runtimeDiagnostics.activePanels
        && previousDiagnostics.totalPanels === runtimeDiagnostics.totalPanels
        && previousDiagnostics.animationActiveCount === runtimeDiagnostics.animationActiveCount
        && previousDiagnostics.eventRatePerSecond === runtimeDiagnostics.eventRatePerSecond;
      if (unchanged) {
        recordPerfCounter('app_state.uiDiagnostics.skipped', 'runtimeDiagnostics_same');
        recordPerfCounter('app_update_source.setUiDiagnostics.runtimeDiagnostics', 'skipped');
        return prev;
      }
      recordPerfCounter('app_state.uiDiagnostics.changed', 'runtimeDiagnostics_changed');
      recordPerfCounter('app_update_source.setUiDiagnostics.runtimeDiagnostics', 'changed');
      markPendingAppUpdateSource('setUiDiagnostics.runtimeDiagnostics');
      return { ...prev, runtimeDiagnostics };
    });
  }, [runtimeDiagnostics, setUiDiagnostics]);

  useEffect(() => {
    if (!finalRouteTruth) {
      lastAppUpdateSourceRef.current = 'setTelemetryEntries.finalRouteTruthReset';
      recordPerfCounter('app_update_source.setTelemetryEntries.finalRouteTruthReset', 'called');
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
      lastAppUpdateSourceRef.current = 'setTelemetryEntries.finalRouteTruthEvents';
      recordPerfCounter('app_update_source.setTelemetryEntries.finalRouteTruthEvents', 'called');
      setTelemetryEntries((previous) => appendTelemetryHistory(previous, incoming, TELEMETRY_MAX_HISTORY));
      markPendingAppUpdateSource('setTelemetryEntries.finalRouteTruthEvents');
      recordPerfCounter('app_update_source.setTelemetryEntries.finalRouteTruthEvents', 'changed');
    }

    previousTelemetryTruthRef.current = finalRouteTruth;
  }, [finalRouteTruth]);

  async function requestOpenClawReadonlyValidation(endpointDraft = {}) {
    const normalizedDraft = normalizeEndpointDraft(endpointDraft);
    const resolvedEndpoint = resolveReadonlyValidationEndpoint(normalizedDraft);
    setOpenClawReadonlyValidation((previous) => ({
      ...previous,
      validationStatus: 'running',
      validationStartedAt: new Date().toISOString(),
    }));
    try {
      const response = await fetch(OPENCLAW_READONLY_VALIDATION_ENDPOINT.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointHost: resolvedEndpoint.host,
          endpointPort: resolvedEndpoint.port,
          endpointScope: endpointDraft.endpointScope,
          expectedProtocolVersion: endpointDraft.expectedProtocolVersion,
          expectedAdapterIdentity: endpointDraft.expectedAdapterIdentity,
          allowedProbeTypes: endpointDraft.allowedProbeTypes,
        }),
      });
      const payload = await response.json();
      const nextValidation = {
        ...payload,
        validationMode: normalizedDraft.allowedProbeTypes || 'health_and_handshake',
        safeProbePathAvailable: true,
        readonlyValidationEndpoint: OPENCLAW_READONLY_VALIDATION_ENDPOINT,
        healthState: payload?.healthResult?.state || 'unknown',
        handshakeState: payload?.handshakeResult?.state || 'unknown',
        protocolCompatible: payload?.handshakeResult?.protocolCompatible === true || (payload?.validationStatus === 'succeeded' && payload?.handshakeResult?.state === 'compatible'),
        protocolVersion: payload?.handshakeResult?.protocolVersion || '',
        adapterIdentity: payload?.handshakeResult?.adapterIdentity || '',
        readonlyAssurance: payload?.handshakeResult?.readonlyAssurance || {},
        lastHealthCheckAt: payload?.healthResult?.checkedAt || '',
        lastHandshakeAt: payload?.handshakeResult?.checkedAt || '',
        healthLatencyMs: payload?.healthResult?.latencyMs ?? null,
        handshakeLatencyMs: payload?.handshakeResult?.latencyMs ?? null,
        openClawReadonlyValidationEndpointAvailable: OPENCLAW_READONLY_VALIDATION_ENDPOINT.available,
        openClawReadonlyValidationEndpointPath: OPENCLAW_READONLY_VALIDATION_ENDPOINT.path,
        openClawReadonlyValidationEndpointMode: OPENCLAW_READONLY_VALIDATION_ENDPOINT.mode,
        openClawReadonlyValidationEndpointCanExecute: OPENCLAW_READONLY_VALIDATION_ENDPOINT.canExecute,
        resolvedValidationHost: resolvedEndpoint.host,
        resolvedValidationPort: resolvedEndpoint.port,
        validationLastCheckedAt: payload?.handshakeResult?.checkedAt || payload?.healthResult?.checkedAt || new Date().toISOString(),
        validationFreshness: 'fresh',
        validationRestoredFromStorage: false,
      };
      setOpenClawReadonlyValidation(nextValidation);
      if (nextValidation.validationStatus === 'succeeded') {
        saveOpenClawReadonlyValidationEvidence({ evidence: {
          endpointHost: resolvedEndpoint.host,
          endpointPort: resolvedEndpoint.port,
          endpointScope: normalizedDraft.endpointScope,
          expectedProtocolVersion: normalizedDraft.expectedProtocolVersion,
          validationStatus: nextValidation.validationStatus,
          validationMode: nextValidation.validationMode,
          validationSource: nextValidation.validationSource,
          healthState: nextValidation.healthState,
          handshakeState: nextValidation.handshakeState,
          protocolCompatible: nextValidation.protocolCompatible,
          adapterIdentity: nextValidation.adapterIdentity,
          readonlyAssurance: nextValidation.readonlyAssurance,
          lastHealthCheckAt: nextValidation.lastHealthCheckAt,
          lastHandshakeAt: nextValidation.lastHandshakeAt,
          healthLatencyMs: nextValidation.healthLatencyMs,
          handshakeLatencyMs: nextValidation.handshakeLatencyMs,
          validationEvidence: nextValidation.validationEvidence,
          validationWarnings: nextValidation.validationWarnings,
          validationBlockers: nextValidation.validationBlockers,
          savedAt: new Date().toISOString(),
          sourceEndpointFingerprint: buildOpenClawValidationEndpointFingerprint({ endpointHost: resolvedEndpoint.host, endpointPort: resolvedEndpoint.port, endpointScope: normalizedDraft.endpointScope, expectedProtocolVersion: normalizedDraft.expectedProtocolVersion }),
        } });
      }
    } catch (error) {
      setOpenClawReadonlyValidation({
        validationStatus: 'unavailable',
        validationMode: normalizedDraft.allowedProbeTypes || 'health_and_handshake',
        validationSource: 'backend_readonly_probe',
        validationBlockers: [String(error?.message || 'Readonly validation request failed.')],
        validationEvidence: ['safe-probe-path:available'],
        safeProbePathAvailable: true,
        readonlyValidationEndpoint: OPENCLAW_READONLY_VALIDATION_ENDPOINT,
        openClawReadonlyValidationEndpointAvailable: OPENCLAW_READONLY_VALIDATION_ENDPOINT.available,
        openClawReadonlyValidationEndpointPath: OPENCLAW_READONLY_VALIDATION_ENDPOINT.path,
        openClawReadonlyValidationEndpointMode: OPENCLAW_READONLY_VALIDATION_ENDPOINT.mode,
        openClawReadonlyValidationEndpointCanExecute: OPENCLAW_READONLY_VALIDATION_ENDPOINT.canExecute,
        resolvedValidationHost: resolvedEndpoint.host,
        resolvedValidationPort: resolvedEndpoint.port,
        validationLastCheckedAt: new Date().toISOString(),
        validationFreshness: 'unknown',
        validationRestoredFromStorage: false,
      });
    }
  }




  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = loadOpenClawReadonlyValidationEvidence({ storage: window.localStorage });
    if (!stored || stored.validationStatus !== 'succeeded') return;
    const endpoint = normalizeEndpointDraft(openClawEndpointDraft);
    const resolved = resolveReadonlyValidationEndpoint(endpoint);
    const fingerprint = buildOpenClawValidationEndpointFingerprint({ endpointHost: resolved.host, endpointPort: resolved.port, endpointScope: endpoint.endpointScope, expectedProtocolVersion: endpoint.expectedProtocolVersion });
    if (stored.sourceEndpointFingerprint !== fingerprint) return;
    const freshness = classifyReadonlyValidationFreshness(stored);
    if (freshness === 'expired') return;
    setOpenClawReadonlyValidation((prev) => ({
      ...prev,
      ...stored,
      safeProbePathAvailable: true,
      readonlyValidationEndpoint: OPENCLAW_READONLY_VALIDATION_ENDPOINT,
      openClawReadonlyValidationEndpointAvailable: OPENCLAW_READONLY_VALIDATION_ENDPOINT.available,
      openClawReadonlyValidationEndpointPath: OPENCLAW_READONLY_VALIDATION_ENDPOINT.path,
      openClawReadonlyValidationEndpointMode: OPENCLAW_READONLY_VALIDATION_ENDPOINT.mode,
      openClawReadonlyValidationEndpointCanExecute: OPENCLAW_READONLY_VALIDATION_ENDPOINT.canExecute,
      validationFreshness: freshness,
      validationRestoredFromStorage: true,
      validationLastCheckedAt: stored.lastHandshakeAt || stored.lastHealthCheckAt || stored.savedAt,
      validationNextAction: freshness === 'stale' ? 'Re-check readonly health/handshake' : 'Validation restored from local evidence. Execution remains disabled.',
    }));
  }, [openClawEndpointDraft]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(OPENCLAW_ENDPOINT_STORAGE_KEY);
      if (!raw) return;
      const parsed = normalizeEndpointDraft(JSON.parse(raw));
      setOpenClawEndpointDraft((prev) => ({ ...prev, ...parsed }));
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const normalized = normalizeEndpointDraft(openClawEndpointDraft);
    const resolved = resolveReadonlyValidationEndpoint(normalized);
    const toPersist = { ...normalized, endpointHost: resolved.host, endpointPort: resolved.port };
    try { window.localStorage.setItem(OPENCLAW_ENDPOINT_STORAGE_KEY, JSON.stringify(toPersist)); } catch {}
  }, [openClawEndpointDraft]);

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
    { id: 'aiConsole', layoutKey: 'commandDeck', className: 'pane-span-2', render: () => (
      <div className="primary-stack">
        {startupDiagnosticsVisible ? (
          <div className="api-banner degraded" role="status" aria-live="polite">
            <strong>{runtimeStatus.headline || 'Diagnostics pending'}</strong>
            <span>{runtimeStatus.dependencySummary || safeApiStatus.detail || 'Stephanos is loading runtime diagnostics and route status.'}</span>
          </div>
        ) : null}
        <MissionConsoleTile
          uiLayout={safeUiLayout}
          togglePanel={togglePanel}
          forcePanelOpen
          runtimeStatusModel={runtimeStatusModel}
          finalRouteTruth={routeTruthView}
          finalAgentView={displayAgentView}
          branchName={runtimeStatus?.runtimeContext?.repoBranch || runtimeStatus?.runtimeTruth?.repoBranch || 'unknown'}
          onOpenClawIntegrationUpdate={trackedSetOpenClawIntegration}
          onIntentToBuildUpdate={trackedSetIntentToBuildTruth}
          onMissionBridgeUpdate={trackedSetMissionBridgeTruth}
          submitPrompt={submitPrompt}
          sharedConsoleInput={input}
          setSharedConsoleInput={setInput}
          sharedCommandHistory={commandHistory}
          cancelActivePrompt={cancelActivePrompt}
          emergencyReleaseOllamaLoad={emergencyReleaseOllamaLoad}
          orchestrationTruth={orchestrationTruth}
          agentTaskProjection={agentTaskProjection}
        />
        <PowerShellMergeConsolePanel />
      </div>
    ) },
    { id: 'statusPanel', title: 'Route Status', render: () => <StatusPanel finalAgentView={displayAgentView} intentToBuildTruth={intentToBuildTruth} missionBridgeTruth={missionBridgeTruth} /> },
    {
      id: 'toolsPanel',
      title: 'Tools',
      render: () => (
        <ToolsPanel
          commandHistory={commandHistory}
          runAiButlerAction={runAiButlerAction}
          aiActionState={aiActionState}
        />
      ),
    },
    { id: 'memoryPanel', title: 'Memory / Retrieval', render: () => <MemoryPanel commandHistory={commandHistory} /> },
    { id: 'knowledgeGraphPanel', render: () => <KnowledgeGraphPanel commandHistory={commandHistory} /> },
    { id: 'simulationListPanel', render: () => <SimulationListPanel commandHistory={commandHistory} /> },
    { id: 'simulationPanel', render: () => <SimulationPanel commandHistory={commandHistory} /> },
    { id: 'simulationHistoryPanel', render: () => <SimulationHistoryPanel commandHistory={commandHistory} /> },
    { id: 'proposalPanel', render: () => <ProposalPanel commandHistory={commandHistory} /> },
    { id: 'activityPanel', render: () => <ActivityPanel commandHistory={commandHistory} /> },
    { id: 'telemetryFeedPanel', title: 'Telemetry', render: () => <TelemetryFeed runtimeStatusModel={runtimeStatusModel} telemetryEntries={telemetryEntries} /> },
    { id: 'cockpitPanel', className: 'pane-span-2', render: () => <CockpitPanel telemetryEntries={telemetryEntries} finalAgentView={displayAgentView} /> },
    {
      id: 'agentsPanel',
      wideSurface: true,
      className: 'pane-span-2',
      render: () => {
        markStartupStage('app-agents-panel-render-start');
        const node = (
          <AgentsTile
            finalAgentView={displayAgentView}
            selectedAgentId={displayAgentView.selectedAgentId}
            onSelectAgent={setSelectedAgentId}
            uiLayout={safeUiLayout}
            togglePanel={togglePanel}
            debugVisibility={agentControls.debugVisibility}
            openClawIntegration={openClawIntegration}
            agentTaskProjection={agentTaskProjection}
            onApplyOpenClawEndpointConfig={setOpenClawEndpointDraft}
            onClearOpenClawEndpointConfig={() => setOpenClawEndpointDraft({
              endpointLabel: 'Local OpenClaw Adapter',
              endpointHost: '',
              endpointPort: '',
              endpointScope: 'local_only',
              expectedProtocolVersion: 'v1',
              expectedAdapterIdentity: '',
              allowedProbeTypes: 'health_and_handshake',
              configPersistenceMode: 'session_only',
              endpointMode: 'model_only',
            })}
            telemetryEntries={telemetryEntries}
            actionHints={actionHints}
          />
        );
        markStartupStage('app-agents-panel-render-complete');
        return node;
      },
    },
    { id: 'promptBuilderPanel', title: 'Prompt Builder', className: 'pane-span-2', render: () => (
      <PromptBuilder
        runtimeStatusModel={runtimeStatusModel}
        finalRouteTruth={finalRouteTruth}
        telemetryEntries={telemetryEntries}
        actionHints={actionHints}
        orchestrationTruth={orchestrationTruth}
        agentTaskProjection={agentTaskProjection}
      />
    ) },
    { id: 'roadmapPanel', render: () => <RoadmapPanel commandHistory={commandHistory} /> },
    {
      id: 'missionDashboardPanel',
      className: 'pane-span-2',
      render: () => {
        markStartupStage('app-mission-dashboard-render-start');
        const node = (
          <MissionDashboardPanel
            finalAgentView={displayAgentView}
            orchestrationSelectors={orchestrationSelectors}
            runtimeStatus={runtimeStatus}
            finalRouteTruth={finalRouteTruth}
            agentTaskProjection={agentTaskProjection}
            onApplyOpenClawEndpointConfig={setOpenClawEndpointDraft}
            onClearOpenClawEndpointConfig={() => setOpenClawEndpointDraft({
              endpointLabel: 'Local OpenClaw Adapter',
              endpointHost: '',
              endpointPort: '',
              endpointScope: 'local_only',
              expectedProtocolVersion: 'v1',
              expectedAdapterIdentity: '',
              allowedProbeTypes: 'health_and_handshake',
              configPersistenceMode: 'session_only',
              endpointMode: 'model_only',
            })}
            telemetryEntries={telemetryEntries}
            actionHints={actionHints}
            orchestrationTruth={orchestrationTruth}
          />
        );
        markStartupStage('app-mission-dashboard-render-complete');
        return node;
      },
    },
    {
      id: 'intentEnginePanel',
      className: 'pane-span-2',
      render: () => {
        markStartupStage('app-intent-engine-panel-render-start');
        const node = (
          <IntentEnginePanel
            canonicalCurrentIntent={canonicalCurrentIntent}
            canonicalMissionPacket={canonicalMissionPacket}
            orchestrationSelectors={orchestrationSelectors}
            runtimeStatus={runtimeStatus}
            finalRouteTruth={finalRouteTruth}
          />
        );
        markStartupStage('app-intent-engine-panel-render-complete');
        return node;
      },
    },
    { id: 'missionFingerprintPanel', render: () => <RuntimeFingerprintPanel runtimeFingerprint={runtimeFingerprint} /> },
    {
      id: 'missionPacketQueuePanel',
      className: 'pane-span-2',
      render: () => {
        markStartupStage('app-mission-packet-queue-render-start');
        const node = <MissionPacketQueuePanel />;
        markStartupStage('app-mission-packet-queue-render-complete');
        return node;
      },
    },
    {
      id: 'hostedIdeaStagingPanel',
      className: 'pane-span-2',
      render: () => <HostedIdeaStagingPanel />,
    },
    {
      id: 'missionConsolePanel',
      wideSurface: true,
      title: 'Mission Console',
      className: 'pane-span-2',
      render: () => (
        <MissionConsoleTile
          uiLayout={safeUiLayout}
          togglePanel={togglePanel}
          runtimeStatusModel={runtimeStatusModel}
          finalRouteTruth={routeTruthView}
          finalAgentView={displayAgentView}
          branchName={runtimeStatus?.runtimeContext?.repoBranch || runtimeStatus?.runtimeTruth?.repoBranch || 'unknown'}
          onOpenClawIntegrationUpdate={trackedSetOpenClawIntegration}
          onIntentToBuildUpdate={trackedSetIntentToBuildTruth}
          onMissionBridgeUpdate={trackedSetMissionBridgeTruth}
          submitPrompt={submitPrompt}
          sharedConsoleInput={input}
          setSharedConsoleInput={setInput}
          sharedCommandHistory={commandHistory}
          cancelActivePrompt={cancelActivePrompt}
          emergencyReleaseOllamaLoad={emergencyReleaseOllamaLoad}
          orchestrationTruth={orchestrationTruth}
          agentTaskProjection={agentTaskProjection}
        />
      ),
    },
    {
      id: 'capabilityRadarPanel',
      wideSurface: true,
      title: 'Capability Radar',
      className: 'pane-span-2',
      render: () => (
        <CapabilityRadarTile
          uiLayout={safeUiLayout}
          togglePanel={togglePanel}
          runtimeStatusModel={runtimeStatusModel}
        />
      ),
    },
    {
      id: 'skillForgePanel',
      wideSurface: true,
      title: 'Skill Forge',
      className: 'pane-span-2',
      render: () => <SkillForgeTile uiLayout={safeUiLayout} togglePanel={togglePanel} runtimeStatusModel={runtimeStatusModel} />,
    },
    {
      id: 'worldWorkspacePanel',
      wideSurface: true,
      title: 'World Workspace',
      className: 'pane-span-2',
      render: () => <WorldWorkspaceTile />,
    },
    {
      id: 'openClawPanel',
      wideSurface: true,
      title: 'OpenClaw Control',
      className: 'pane-span-2',
      render: () => (
        <OpenClawTile
          uiLayout={safeUiLayout}
          togglePanel={togglePanel}
          runtimeStatusModel={runtimeStatusModel}
          finalRouteTruth={routeTruthView}
          branchName={runtimeStatus?.runtimeContext?.repoBranch || runtimeStatus?.runtimeTruth?.repoBranch || 'unknown'}
          onIntegrationUpdate={trackedSetOpenClawIntegration}
          agentTaskProjection={agentTaskProjection}
          openClawEndpointDraft={openClawEndpointDraft}
          onApplyOpenClawEndpointConfig={setOpenClawEndpointDraft}
          onRequestReadonlyValidation={requestOpenClawReadonlyValidation}
          onClearOpenClawEndpointConfig={() => setOpenClawEndpointDraft({
            endpointLabel: 'Local OpenClaw Adapter',
            endpointHost: '',
            endpointPort: '',
            endpointScope: 'local_only',
            expectedProtocolVersion: 'v1',
            expectedAdapterIdentity: '',
            allowedProbeTypes: 'health_and_handshake',
            configPersistenceMode: 'session_only',
            endpointMode: 'model_only',
          })}
        />
      ),
    },
  ]), [
    aiActionState,
    commandHistory,
    input,
    runAiButlerAction,
    runtimeFingerprint,
    runtimeStatusModel,
    runtimeStatus.headline,
    telemetryEntries,
    finalAgentView,
    displayAgentView,
    openClawIntegration,
    intentToBuildTruth,
    agentControls.debugVisibility,
    actionHints,
    canonicalCurrentIntent,
    canonicalMissionPacket,
    orchestrationSelectors,
    orchestrationTruth,
    runtimeStatus,
    finalRouteTruth,
    runtimeStatus.dependencySummary,
    runtimeStatus.runtimeContext?.repoBranch,
    runtimeStatus.runtimeTruth?.repoBranch,
    safeApiStatus.detail,
    safeUiLayout,
    setInput,
    togglePanel,
    startupDiagnosticsVisible,
    submitPrompt,
    missionBridgeTruth,
    agentTaskProjection,
  ]);

  const canonicalPaneDefinitions = useMemo(() => paneDefinitions.map((pane) => ({
    title: pane.title || pane.id,
    layoutKey: pane.layoutKey || pane.id,
    usesCanonicalWrapper: true,
    usesCanonicalWorkspaceShell: pane.wideSurface === true ? true : pane.usesCanonicalWorkspaceShell,
    hasCollapseSupport: true,
    hasCanonicalDragHandle: true,
    bodyTextSelectable: true,
    supportsOrderPersistence: true,
    supportsCollapsePersistence: true,
    ...pane,
  })), [paneDefinitions]);

  const paneAudit = useMemo(() => auditStephanosTilePanes(canonicalPaneDefinitions), [canonicalPaneDefinitions]);

  const defaultPaneOrder = useMemo(() => paneDefinitions.map((pane) => pane.id), [paneDefinitions]);
  const safePaneOrder = useMemo(() => {
    const sessionOrder = Array.isArray(safePaneLayout.order) && safePaneLayout.order.length > 0
      ? safePaneLayout.order
      : [];
    const storedOrder = loadPaneOrder(STEPHANOS_TILE_PANE_ORDER_STORAGE_KEY, defaultPaneOrder);
    return sessionOrder.length > 0 ? reconcilePaneOrder(sessionOrder, defaultPaneOrder) : storedOrder;
  }, [defaultPaneOrder, safePaneLayout.order]);

  const paneMap = useMemo(() => new Map(canonicalPaneDefinitions.map((pane) => [pane.id, pane])), [canonicalPaneDefinitions]);
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
  }

  useEffect(() => {
    setUiDiagnostics((prev) => {
      if (prev?.appRootRendered === true && prev?.componentMarker === APP_COMPONENT_MARKER) {
        recordPerfCounter('render_reason.App', 'startupAudit_noop');
        return prev;
      }
      recordPerfCounter('render_reason.App', 'startupAudit');
      return { ...prev, appRootRendered: true, componentMarker: APP_COMPONENT_MARKER };
    });
  }, [setUiDiagnostics]);
  useEffect(() => {
    recordStartupRenderStage({
      stage: 'app-render-complete',
      status: 'ok',
      sourceModule: 'stephanos-ui/src/App.jsx',
      sourceFunction: 'App.useEffect',
    });
  }, []);

  useEffect(() => {
    savePaneOrder(STEPHANOS_TILE_PANE_ORDER_STORAGE_KEY, safePaneOrder);
  }, [safePaneOrder]);

  if (cockpitSurfaceMode) {
    markStartupStage('app-cockpit-surface-render-start');
    markStartupStage('app-cockpit-surface-render-complete');
    return (
      <main className="app-shell-root cockpit-surface-mode">
        <div className={`ignition-mode-banner ${ignitionModeBanner.tone}`} role="status" aria-live="polite">
          COCKPIT SURFACE · <strong>{ignitionModeBanner.mode}</strong> · origin <code>{runtimeFingerprint.currentOrigin}</code> · path <code>{runtimeFingerprint.currentPathname}</code>
        </div>
        <section className="cockpit-surface-stage">
          <CockpitPanel standalone telemetryEntries={telemetryEntries} finalAgentView={displayAgentView} />
        </section>
        <DebugConsole />
      </main>
    );
  }

  if (agentsSurfaceMode) {
    markStartupStage('app-agents-surface-render-start');
    markStartupStage('app-agents-surface-render-complete');
    return (
      <main className="app-shell-root agents-surface-mode">
        <div className={`ignition-mode-banner ${ignitionModeBanner.tone}`} role="status" aria-live="polite">
          AGENTS SURFACE · <strong>{ignitionModeBanner.mode}</strong> · {agentSurfaceProjection.launcherSummary.summaryLabel} · origin <code>{runtimeFingerprint.currentOrigin}</code> · path <code>{runtimeFingerprint.currentPathname}</code>
        </div>
        <AgentQuickControls
          controls={agentControls}
          registry={agentRegistry}
          onToggle={(field) => setAgentControls((prev) => ({ ...prev, [field]: !prev[field] }))}
          onSetAutonomy={(value) => setAgentControls((prev) => ({ ...prev, globalAutonomy: value }))}
          onToggleAgent={(agentId) => setAgentControls((prev) => ({
            ...prev,
            agentEnabledMap: {
              ...prev.agentEnabledMap,
              [agentId]: !(prev.agentEnabledMap?.[agentId] ?? agentRegistry.find((entry) => entry.agentId === agentId)?.enabledByDefault === true),
            },
          }))}
        />
        <section className="agents-surface-stage">
          <AgentsTile
            finalAgentView={displayAgentView}
            selectedAgentId={displayAgentView.selectedAgentId}
            onSelectAgent={setSelectedAgentId}
            uiLayout={safeUiLayout}
            togglePanel={togglePanel}
            debugVisibility={agentControls.debugVisibility}
            openClawIntegration={openClawIntegration}
            agentTaskProjection={agentTaskProjection}
            onApplyOpenClawEndpointConfig={setOpenClawEndpointDraft}
            onClearOpenClawEndpointConfig={() => setOpenClawEndpointDraft({
              endpointLabel: 'Local OpenClaw Adapter',
              endpointHost: '',
              endpointPort: '',
              endpointScope: 'local_only',
              expectedProtocolVersion: 'v1',
              expectedAdapterIdentity: '',
              allowedProbeTypes: 'health_and_handshake',
              configPersistenceMode: 'session_only',
              endpointMode: 'model_only',
            })}
            telemetryEntries={telemetryEntries}
            actionHints={actionHints}
          />
        </section>
        <DebugConsole />
      </main>
    );
  }

  if (missionConsoleSurfaceMode) {
    markStartupStage('app-mission-console-surface-render-start');
    markStartupStage('app-mission-console-surface-render-complete');
    return (
      <main className="app-shell-root mission-console-surface-mode">
        <div className={`ignition-mode-banner ${ignitionModeBanner.tone}`} role="status" aria-live="polite">
          MISSION CONSOLE SURFACE · <strong>{ignitionModeBanner.mode}</strong> · {agentSurfaceProjection.launcherSummary.summaryLabel} · origin <code>{runtimeFingerprint.currentOrigin}</code> · path <code>{runtimeFingerprint.currentPathname}</code>
        </div>
        <AgentQuickControls
          controls={agentControls}
          registry={agentRegistry}
          onToggle={(field) => setAgentControls((prev) => ({ ...prev, [field]: !prev[field] }))}
          onSetAutonomy={(value) => setAgentControls((prev) => ({ ...prev, globalAutonomy: value }))}
          onToggleAgent={(agentId) => setAgentControls((prev) => ({
            ...prev,
            agentEnabledMap: {
              ...prev.agentEnabledMap,
              [agentId]: !(prev.agentEnabledMap?.[agentId] ?? agentRegistry.find((entry) => entry.agentId === agentId)?.enabledByDefault === true),
            },
          }))}
        />
        <section className="mission-console-surface-stage">
          <MissionConsoleTile
            uiLayout={safeUiLayout}
            togglePanel={togglePanel}
            runtimeStatusModel={runtimeStatusModel}
            finalRouteTruth={routeTruthView}
            finalAgentView={displayAgentView}
            branchName={runtimeStatus?.runtimeContext?.repoBranch || runtimeStatus?.runtimeTruth?.repoBranch || 'unknown'}
            onOpenClawIntegrationUpdate={trackedSetOpenClawIntegration}
            onIntentToBuildUpdate={trackedSetIntentToBuildTruth}
            onMissionBridgeUpdate={trackedSetMissionBridgeTruth}
            submitPrompt={submitPrompt}
            sharedConsoleInput={input}
            setSharedConsoleInput={setInput}
            sharedCommandHistory={commandHistory}
            cancelActivePrompt={cancelActivePrompt}
            emergencyReleaseOllamaLoad={emergencyReleaseOllamaLoad}
            orchestrationTruth={orchestrationTruth}
            agentTaskProjection={agentTaskProjection}
            onApplyOpenClawEndpointConfig={setOpenClawEndpointDraft}
            onClearOpenClawEndpointConfig={() => setOpenClawEndpointDraft({
              endpointLabel: 'Local OpenClaw Adapter',
              endpointHost: '',
              endpointPort: '',
              endpointScope: 'local_only',
              expectedProtocolVersion: 'v1',
              expectedAdapterIdentity: '',
              allowedProbeTypes: 'health_and_handshake',
              configPersistenceMode: 'session_only',
              endpointMode: 'model_only',
            })}
            telemetryEntries={telemetryEntries}
            actionHints={actionHints}
          />
        </section>
        <DebugConsole />
      </main>
    );
  }

  if (capabilityRadarSurfaceMode) {
    return (
      <main className="app-shell-root mission-console-surface-mode">
        <div className={`ignition-mode-banner ${ignitionModeBanner.tone}`} role="status" aria-live="polite">
          CAPABILITY RADAR SURFACE · <strong>{ignitionModeBanner.mode}</strong> · origin <code>{runtimeFingerprint.currentOrigin}</code> · path <code>{runtimeFingerprint.currentPathname}</code>
        </div>
        <section className="mission-console-surface-stage">
          <CapabilityRadarTile uiLayout={safeUiLayout} togglePanel={togglePanel} runtimeStatusModel={runtimeStatusModel} />
        </section>
        <DebugConsole />
      </main>
    );
  }

  if (openClawSurfaceMode) {
    markStartupStage('app-openclaw-surface-render-start');
    markStartupStage('app-openclaw-surface-render-complete');
    return (
      <main className="app-shell-root mission-console-surface-mode">
        <div className={`ignition-mode-banner ${ignitionModeBanner.tone}`} role="status" aria-live="polite">
          OPENCLAW SURFACE · <strong>{ignitionModeBanner.mode}</strong> · {agentSurfaceProjection.launcherSummary.summaryLabel} · origin <code>{runtimeFingerprint.currentOrigin}</code> · path <code>{runtimeFingerprint.currentPathname}</code>
        </div>
        <section className="mission-console-surface-stage openclaw-landing-stage" data-workspace-shell="openclaw-landing">
          <header className="workspace-header workspace-header--compact">
            <p>OpenClaw + Mission Console workspace stage</p>
          </header>
          <OpenClawTile
            uiLayout={safeUiLayout}
            togglePanel={togglePanel}
            runtimeStatusModel={runtimeStatusModel}
            finalRouteTruth={routeTruthView}
            branchName={runtimeStatus?.runtimeContext?.repoBranch || runtimeStatus?.runtimeTruth?.repoBranch || 'unknown'}
            onIntegrationUpdate={trackedSetOpenClawIntegration}
            agentTaskProjection={agentTaskProjection}
            openClawEndpointDraft={openClawEndpointDraft}
            onApplyOpenClawEndpointConfig={setOpenClawEndpointDraft}
            onRequestReadonlyValidation={requestOpenClawReadonlyValidation}
            onClearOpenClawEndpointConfig={() => setOpenClawEndpointDraft({
              endpointLabel: 'Local OpenClaw Adapter',
              endpointHost: '',
              endpointPort: '',
              endpointScope: 'local_only',
              expectedProtocolVersion: 'v1',
              expectedAdapterIdentity: '',
              allowedProbeTypes: 'health_and_handshake',
              configPersistenceMode: 'session_only',
              endpointMode: 'model_only',
            })}
          />
          <MissionConsoleTile
            uiLayout={safeUiLayout}
            togglePanel={togglePanel}
            runtimeStatusModel={runtimeStatusModel}
            finalRouteTruth={routeTruthView}
            finalAgentView={displayAgentView}
            branchName={runtimeStatus?.runtimeContext?.repoBranch || runtimeStatus?.runtimeTruth?.repoBranch || 'unknown'}
            onOpenClawIntegrationUpdate={trackedSetOpenClawIntegration}
            onIntentToBuildUpdate={trackedSetIntentToBuildTruth}
            onMissionBridgeUpdate={trackedSetMissionBridgeTruth}
            submitPrompt={submitPrompt}
            sharedConsoleInput={input}
            setSharedConsoleInput={setInput}
            sharedCommandHistory={commandHistory}
            cancelActivePrompt={cancelActivePrompt}
            emergencyReleaseOllamaLoad={emergencyReleaseOllamaLoad}
            orchestrationTruth={orchestrationTruth}
            agentTaskProjection={agentTaskProjection}
          />
        </section>
        <DebugConsole />
      </main>
    );
  }
  markStartupStage('app-provider-controls-render-start');
  markStartupStage('app-provider-controls-render-complete');

  const missionConsoleWideShellMode = safeUiLayout.missionConsoleCommandDeckMode !== false;

  return (
    <main className={`app-shell-root ${missionConsoleWideShellMode ? 'mission-console-command-deck-mode' : ''}`.trim()}>
      <div className={`ignition-mode-banner ${ignitionModeBanner.tone}`} role="status" aria-live="polite">
        IGNITION MODE: <strong>{ignitionModeBanner.mode}</strong> · origin <code>{runtimeFingerprint.currentOrigin}</code> · path <code>{runtimeFingerprint.currentPathname}</code>
      </div>
      <AgentQuickControls
        controls={agentControls}
        registry={agentRegistry}
        onToggle={(field) => setAgentControls((prev) => ({ ...prev, [field]: !prev[field] }))}
        onSetAutonomy={(value) => setAgentControls((prev) => ({ ...prev, globalAutonomy: value }))}
        onToggleAgent={(agentId) => setAgentControls((prev) => ({
          ...prev,
          agentEnabledMap: {
            ...prev.agentEnabledMap,
            [agentId]: !(prev.agentEnabledMap?.[agentId] ?? agentRegistry.find((entry) => entry.agentId === agentId)?.enabledByDefault === true),
          },
        }))}
      />
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
        {heavyOllamaModelActive ? (
          <p className="provider-dock-status provider-dock-status-warning">
            <strong>Heavy local model may increase PC load.</strong>
          </p>
        ) : null}
        <ProviderToggle
          onTestConnection={refreshHealth}
          onSendTestPrompt={() => submitPrompt('Run a quick Stephanos provider self-test and explain what route is active right now.')}
        />
      </CollapsiblePanel>
      <HomeBridgePanel />

      <section className="stephanos-workspace-canvas stephanos-app-workspace-canvas" data-workspace-shell="canonical" onDragOver={(event) => event.preventDefault()}>
        <div className="stephanos-workspace-gutter stephanos-workspace-gutter--left" aria-hidden="true" />
        <div className="operator-pane-wall stephanos-workspace-lane" data-workspace-shell-role="lane">
          {orderedPanes.map((pane) => {
            const moveState = getPaneMoveAvailability(safePaneOrder, pane.id);
            return (
              <StephanosSurfacePane
                key={pane.id}
                pane={pane}
                uiLayout={safeUiLayout}
                dragPaneId={dragPaneId}
                shouldStartPaneDrag={shouldStartPaneDrag}
                onDragStart={() => setDragPaneId(pane.id)}
                onDragEnd={() => setDragPaneId('')}
                onDrop={() => {
                  reorderPanes(dragPaneId, pane.id);
                  setDragPaneId('');
                }}
                onMoveUp={() => nudgePane(pane.id, -1)}
                onMoveDown={() => nudgePane(pane.id, 1)}
                canMoveUp={moveState.canMoveUp}
                canMoveDown={moveState.canMoveDown}
              />
            );
          })}
        </div>
        <div className="stephanos-workspace-gutter stephanos-workspace-gutter--right" aria-hidden="true" />
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
