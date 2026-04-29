import { useEffect, useMemo, useRef, useState } from 'react';
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

const APP_COMPONENT_MARKER = STEPHANOS_UI_RUNTIME_MARKER;
const HEAVY_OLLAMA_MODELS = new Set(['gpt-oss:20b', 'qwen:14b', 'qwen:32b']);

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

export function shouldStartPaneDrag(target) {
  if (!target || typeof target.closest !== 'function') {
    return true;
  }
  return !target.closest(PANE_DRAG_BLOCK_SELECTOR);
}

export default function App() {
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
  const surfaceMode = useMemo(() => {
    if (typeof window === 'undefined') {
      return 'mission-control';
    }

    const params = new URLSearchParams(window.location.search);
    return resolveAgentSurfaceMode(params.get('surface') || params.get('app'));
  }, []);
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
  const routeTruthView = buildFinalRouteTruthView(runtimeStatus);
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
    endpointHost: '127.0.0.1',
    endpointPort: '',
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
  });
  const telemetryBaselineAddedRef = useRef(false);
  const previousTelemetryTruthRef = useRef(null);
  const finalRouteTruth = runtimeStatusModel?.finalRouteTruth ?? null;
  const continuitySnapshot = useMemo(
    () => deriveContinuityLoopSnapshot({ runtimeStatus, commandHistory, telemetryEntries, now: metricsTick }),
    [runtimeStatus, commandHistory, telemetryEntries, metricsTick],
  );
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

  useEffect(() => {
    setOpenClawIntegration((previous) => (previous && previous.currentActivity !== 'Standing by for bounded intent.'
      ? previous
      : buildOpenClawIntegrationSnapshot({
        runtimeStatusModel,
        finalRouteTruth: routeTruthView,
        repoPath: '/workspace/stephan-os',
        branchName: runtimeStatus?.runtimeContext?.repoBranch || runtimeStatus?.runtimeTruth?.repoBranch || 'unknown',
      })));
  }, [routeTruthView, runtimeStatus?.runtimeContext?.repoBranch, runtimeStatus?.runtimeTruth?.repoBranch, runtimeStatusModel]);
  markStartupStage('app-derived-agent-projection-ready', {
    surfaceMode,
    visibleAgentCount: agentSurfaceProjection?.visibleAgentCount ?? null,
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const tickId = window.setInterval(() => setMetricsTick(Date.now()), 1000);
    return () => window.clearInterval(tickId);
  }, []);

  const runtimeDiagnostics = useMemo(() => {
    const totalPanels = Object.keys(safeUiLayout).filter((panelId) => panelId.endsWith('Panel')).length;
    const activePanels = Object.entries(safeUiLayout)
      .filter(([panelId, value]) => panelId.endsWith('Panel') && value !== false)
      .length;
    const tenSecondsAgo = metricsTick - 10_000;
    const eventRate = telemetryEntries.filter((entry) => Date.parse(entry.timestamp) >= tenSecondsAgo).length / 10;
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
    setUiDiagnostics((prev) => ({ ...prev, runtimeDiagnostics }));
  }, [runtimeDiagnostics, setUiDiagnostics]);

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

  async function requestOpenClawReadonlyValidation(endpointDraft = {}) {
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
          endpointHost: endpointDraft.endpointHost,
          endpointPort: endpointDraft.endpointPort,
          endpointScope: endpointDraft.endpointScope,
          expectedProtocolVersion: endpointDraft.expectedProtocolVersion,
          expectedAdapterIdentity: endpointDraft.expectedAdapterIdentity,
          allowedProbeTypes: endpointDraft.allowedProbeTypes,
        }),
      });
      const payload = await response.json();
      setOpenClawReadonlyValidation({
        ...payload,
        validationMode: endpointDraft.allowedProbeTypes || 'health_and_handshake',
        safeProbePathAvailable: true,
        readonlyValidationEndpoint: OPENCLAW_READONLY_VALIDATION_ENDPOINT,
        healthState: payload?.healthResult?.state || 'unknown',
        handshakeState: payload?.handshakeResult?.state || 'unknown',
        protocolCompatible: payload?.handshakeResult?.protocolCompatible === true,
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
      });
    } catch (error) {
      setOpenClawReadonlyValidation({
        validationStatus: 'unavailable',
        validationMode: endpointDraft.allowedProbeTypes || 'health_and_handshake',
        validationSource: 'backend_readonly_probe',
        validationBlockers: [String(error?.message || 'Readonly validation request failed.')],
        validationEvidence: ['safe-probe-path:available'],
        safeProbePathAvailable: true,
        readonlyValidationEndpoint: OPENCLAW_READONLY_VALIDATION_ENDPOINT,
        openClawReadonlyValidationEndpointAvailable: OPENCLAW_READONLY_VALIDATION_ENDPOINT.available,
        openClawReadonlyValidationEndpointPath: OPENCLAW_READONLY_VALIDATION_ENDPOINT.path,
        openClawReadonlyValidationEndpointMode: OPENCLAW_READONLY_VALIDATION_ENDPOINT.mode,
        openClawReadonlyValidationEndpointCanExecute: OPENCLAW_READONLY_VALIDATION_ENDPOINT.canExecute,
      });
    }
  }

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
        <AIConsole
          input={input}
          setInput={setInput}
          submitPrompt={(rawPrompt) => submitPrompt(rawPrompt, { telemetryEntries, orchestrationTruth })}
          cancelActivePrompt={cancelActivePrompt}
          emergencyReleaseOllamaLoad={emergencyReleaseOllamaLoad}
          commandHistory={commandHistory}
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
      className: 'pane-span-2',
      render: () => {
        markStartupStage('app-agents-panel-render-start');
        const node = (
          <AgentsTile
            finalAgentView={displayAgentView}
            selectedAgentId={displayAgentView.selectedAgentId}
            onSelectAgent={setSelectedAgentId}
            isOpen={safeUiLayout.agentsPanel !== false}
            onToggle={() => togglePanel('agentsPanel')}
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
          onOpenClawIntegrationUpdate={setOpenClawIntegration}
          onIntentToBuildUpdate={setIntentToBuildTruth}
          onMissionBridgeUpdate={setMissionBridgeTruth}
          submitPrompt={submitPrompt}
          orchestrationTruth={orchestrationTruth}
          agentTaskProjection={agentTaskProjection}
        />
      ),
    },
    {
      id: 'capabilityRadarPanel',
      title: 'Capability Radar',
      className: 'pane-span-2',
      render: () => (
        <CapabilityRadarTile
          uiLayout={safeUiLayout}
          togglePanel={togglePanel}
        />
      ),
    },
    {
      id: 'skillForgePanel',
      title: 'Skill Forge',
      className: 'pane-span-2',
      render: () => <SkillForgeTile uiLayout={safeUiLayout} togglePanel={togglePanel} />,
    },
    {
      id: 'openClawPanel',
      title: 'OpenClaw Control',
      className: 'pane-span-2',
      render: () => (
        <OpenClawTile
          uiLayout={safeUiLayout}
          togglePanel={togglePanel}
          runtimeStatusModel={runtimeStatusModel}
          finalRouteTruth={routeTruthView}
          branchName={runtimeStatus?.runtimeContext?.repoBranch || runtimeStatus?.runtimeTruth?.repoBranch || 'unknown'}
          onIntegrationUpdate={setOpenClawIntegration}
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
    setInput,
    togglePanel,
    startupDiagnosticsVisible,
    submitPrompt,
    missionBridgeTruth,
    agentTaskProjection,
  ]);

  const defaultPaneOrder = useMemo(() => paneDefinitions.map((pane) => pane.id), [paneDefinitions]);
  const safePaneOrder = useMemo(() => {
    const sessionOrder = Array.isArray(safePaneLayout.order) && safePaneLayout.order.length > 0
      ? safePaneLayout.order
      : [];
    const storedOrder = loadPaneOrder(STEPHANOS_TILE_PANE_ORDER_STORAGE_KEY, defaultPaneOrder);
    return sessionOrder.length > 0 ? reconcilePaneOrder(sessionOrder, defaultPaneOrder) : storedOrder;
  }, [defaultPaneOrder, safePaneLayout.order]);

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
    recordStartupRenderStage({
      stage: 'app-render-complete',
      status: 'ok',
      sourceModule: 'stephanos-ui/src/App.jsx',
      sourceFunction: 'App.useEffect',
    });
  }, []);

  useEffect(() => {
    console.info('[Stephanos Runtime Fingerprint] mission-control', runtimeFingerprint);
  }, [runtimeFingerprint]);

  useEffect(() => {
    console.info('[PANES] fingerprint pane registered', { paneId: 'missionFingerprintPanel' });
    console.info('[PANES] layout restored from memory', { order: safePaneOrder });
  }, [safePaneOrder]);

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
          <CockpitPanel forceOpen standalone telemetryEntries={telemetryEntries} finalAgentView={displayAgentView} />
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
            isOpen
            onToggle={() => {}}
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
            uiLayout={{ ...safeUiLayout, missionConsolePanel: true }}
            togglePanel={() => {}}
            runtimeStatusModel={runtimeStatusModel}
            finalRouteTruth={routeTruthView}
            finalAgentView={displayAgentView}
            branchName={runtimeStatus?.runtimeContext?.repoBranch || runtimeStatus?.runtimeTruth?.repoBranch || 'unknown'}
            onOpenClawIntegrationUpdate={setOpenClawIntegration}
            onIntentToBuildUpdate={setIntentToBuildTruth}
            onMissionBridgeUpdate={setMissionBridgeTruth}
            submitPrompt={submitPrompt}
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
          <CapabilityRadarTile uiLayout={{ ...safeUiLayout, capabilityRadarPanel: true }} togglePanel={() => {}} />
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
        <section className="mission-console-surface-stage mission-console-workspace">
          <OpenClawTile
            uiLayout={{ ...safeUiLayout, openClawPanel: true }}
            togglePanel={() => {}}
            runtimeStatusModel={runtimeStatusModel}
            finalRouteTruth={routeTruthView}
            branchName={runtimeStatus?.runtimeContext?.repoBranch || runtimeStatus?.runtimeTruth?.repoBranch || 'unknown'}
            onIntegrationUpdate={setOpenClawIntegration}
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
            uiLayout={{ ...safeUiLayout, missionConsolePanel: true }}
            togglePanel={() => {}}
            runtimeStatusModel={runtimeStatusModel}
            finalRouteTruth={routeTruthView}
            finalAgentView={displayAgentView}
            branchName={runtimeStatus?.runtimeContext?.repoBranch || runtimeStatus?.runtimeTruth?.repoBranch || 'unknown'}
            onOpenClawIntegrationUpdate={setOpenClawIntegration}
            onIntentToBuildUpdate={setIntentToBuildTruth}
            onMissionBridgeUpdate={setMissionBridgeTruth}
            submitPrompt={submitPrompt}
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
          <StatusPanel finalAgentView={displayAgentView} intentToBuildTruth={intentToBuildTruth} missionBridgeTruth={missionBridgeTruth} />
          <RuntimeFingerprintPanel runtimeFingerprint={runtimeFingerprint} />
        </section>
        <DebugConsole />
      </main>
    );
  }
  markStartupStage('app-provider-controls-render-start');
  markStartupStage('app-provider-controls-render-complete');

  return (
    <main className="app-shell-root">
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

      <section className="operator-pane-wall" onDragOver={(event) => event.preventDefault()}>
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
