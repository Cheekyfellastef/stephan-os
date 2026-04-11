// LIVE SOURCE OF TRUTH: this store backs the served Stephanos AI router/settings UI.
// Update provider state here, then rebuild stephanos-ui to refresh apps/stephanos/dist.
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PROVIDER_KEY,
  DEFAULT_ROUTE_MODE,
  PROVIDER_DEFINITIONS,
  PROVIDER_KEYS,
  createDefaultRouterSettings,
  normalizeProviderDraft,
  normalizeProviderSelection,
  normalizeRouteMode,
  sanitizeConfigForStorage,
  validateProviderDraft,
} from '../ai/providerConfig';
import {
  clearPersistedStephanosHomeBridgeUrl,
  clearPersistedStephanosHomeNode,
  isValidStephanosHomeNode,
  normalizeStephanosHomeNode,
  persistStephanosHomeBridgeUrl,
  persistStephanosHomeNodePreference,
  persistStephanosLastKnownNode,
  readPersistedStephanosHomeBridgeUrl,
  readPersistedStephanosHomeNode,
  readPersistedStephanosLastKnownNode,
  setStephanosHomeBridgeGlobal,
  validateStephanosHomeBridgeUrl,
} from '../../../shared/runtime/stephanosHomeNode.mjs';
import {
  STEPHANOS_ACTIVE_SUBVIEW,
  STEPHANOS_ACTIVE_WORKSPACE,
  clearPersistedStephanosSessionMemory,
  createDefaultStephanosSessionMemory,
  persistStephanosSessionMemory,
  readPortableStephanosHomeNodePreference,
  restoreStephanosSessionMemoryForDevice,
} from '../../../shared/runtime/stephanosSessionMemory.mjs';
import { createRuntimeStatusModel } from '../../../shared/runtime/runtimeStatusModel.mjs';
import { createDefaultMissionDashboardUiState, normalizeMissionDashboardUiState } from './missionDashboardUiState';
import { getApiRuntimeConfig } from '../ai/apiConfig';
import { checkApiHealth } from '../ai/aiClient';
import { ensureRuntimeStatusModel } from './runtimeStatusDefaults';
import {
  createDefaultBridgeTransportPreferences,
  deriveBridgeMemoryFromPreferences,
  listBridgeTransportDefinitions,
  normalizeHomeBridgeMemory,
  normalizeBridgeTransportPreferences,
  normalizeBridgeTransportSelection,
  projectHomeBridgeTransportTruth,
  resolveAutoBridgeRevalidationPlan,
  resolveBridgeValidationTruth,
  resolveBridgeUrlRequireHttps,
} from '../../../shared/runtime/homeBridgeTransport.mjs';
import {
  applyMissionPacketAction,
  createDefaultMissionPacketWorkflow,
  normalizeMissionPacketWorkflow,
} from './missionPacketWorkflow';
import {
  applyMissionLineageUpdate,
  createDefaultMissionLineageStore,
  normalizeMissionLineageStore,
} from './missionLineage.js';
import {
  normalizeSurfaceOverride,
  resolveSurfaceAwareness,
  resolveSurfaceUiLayoutDefaults,
} from '../system/surface/surfaceAwareness';
import {
  acceptSurfaceProtocolRecommendation,
  appendAcceptedSurfaceRule,
  appendFrictionEvent,
  createFrictionEvent,
  detectSurfaceFrictionPatterns,
  generateSurfaceProtocolRecommendations,
  revertAcceptedSurfaceRule,
} from '../system/friction/frictionPipeline.js';
import { explainStephanosMemory } from '../system/friction/memoryExplanation.js';

const AIStoreContext = createContext(null);
const DEFAULT_UI_LAYOUT = {
  providerControlsPanel: true,
  homeBridgePanel: true,
  commandDeck: true,
  powerShellMergeConsolePanel: true,
  statusPanel: true,
  toolsPanel: true,
  memoryPanel: true,
  knowledgeGraphPanel: true,
  simulationListPanel: true,
  simulationPanel: true,
  simulationHistoryPanel: true,
  proposalPanel: true,
  activityPanel: true,
  telemetryFeedPanel: true,
  cockpitPanel: true,
  promptBuilderPanel: true,
  roadmapPanel: true,
  missionDashboardPanel: true,
  missionFingerprintPanel: true,
  missionPacketQueuePanel: true,
  debugConsole: false,
};
const DEFAULT_OPERATOR_PANE_ORDER = [
  'aiConsole',
  'statusPanel',
  'toolsPanel',
  'memoryPanel',
  'knowledgeGraphPanel',
  'simulationListPanel',
  'simulationPanel',
  'simulationHistoryPanel',
  'proposalPanel',
  'activityPanel',
  'telemetryFeedPanel',
  'cockpitPanel',
  'promptBuilderPanel',
  'roadmapPanel',
  'missionDashboardPanel',
  'missionFingerprintPanel',
  'missionPacketQueuePanel',
];
const DEFAULT_OLLAMA_CONNECTION = {
  lastSuccessfulBaseURL: '',
  lastSuccessfulHost: '',
  recentHosts: [],
  pcAddressHint: '',
  lastSelectedModel: '',
};
const DEFAULT_HOME_NODE_STATUS = {
  state: 'idle',
  detail: 'Home node not checked yet.',
  attempts: [],
};
const DEFAULT_SURFACE_OVERRIDE = 'auto';
const MAX_PERSISTED_COMMANDS = 10;
const MAX_PERSISTED_OUTPUT_LENGTH = 4000;
const MAX_FRICTION_EVENTS = 10;
const BRIDGE_MEMORY_RECORD_NAMESPACE = 'continuity';
const BRIDGE_MEMORY_RECORD_ID = 'home-bridge.transport-memory';
const DEFAULT_BRIDGE_AUTO_REVALIDATION = Object.freeze({
  state: 'idle',
  reason: '',
  attemptedAt: '',
  attemptedConfigKey: '',
});

function getStephanosMemoryRuntime() {
  return globalThis.stephanosMemory || globalThis.parent?.stephanosMemory || null;
}

function readPersistedBridgeMemory() {
  const memory = getStephanosMemoryRuntime();
  if (!memory?.getRecord) return normalizeHomeBridgeMemory();
  try {
    const record = memory.getRecord({
      namespace: BRIDGE_MEMORY_RECORD_NAMESPACE,
      id: BRIDGE_MEMORY_RECORD_ID,
    });
    return normalizeHomeBridgeMemory(record?.payload?.bridgeMemory || {});
  } catch {
    return normalizeHomeBridgeMemory();
  }
}

function persistBridgeMemoryToDurableStore(bridgeMemory) {
  const memory = getStephanosMemoryRuntime();
  if (!memory?.saveRecord) return false;
  try {
    memory.saveRecord({
      namespace: BRIDGE_MEMORY_RECORD_NAMESPACE,
      id: BRIDGE_MEMORY_RECORD_ID,
      type: 'workspace.state',
      summary: 'Home Bridge transport memory',
      scope: 'runtime',
      tags: ['home-bridge', 'bridge-memory'],
      importance: 'normal',
      payload: { bridgeMemory: normalizeHomeBridgeMemory(bridgeMemory) },
    });
    return true;
  } catch {
    return false;
  }
}

function normalizeUiLayout(value = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_UI_LAYOUT).map(([key, defaultValue]) => [
      key,
      defaultValue ? value[key] !== false : value[key] === true,
    ]),
  );
}

function normalizeOperatorPaneOrder(value = []) {
  const seen = new Set();
  const normalized = [];
  (Array.isArray(value) ? value : []).forEach((paneId) => {
    const normalizedPaneId = String(paneId || '');
    if (!DEFAULT_OPERATOR_PANE_ORDER.includes(normalizedPaneId) || seen.has(normalizedPaneId)) {
      return;
    }
    seen.add(normalizedPaneId);
    normalized.push(normalizedPaneId);
  });
  DEFAULT_OPERATOR_PANE_ORDER.forEach((paneId) => {
    if (!seen.has(paneId)) {
      normalized.push(paneId);
    }
  });
  return normalized;
}

function normalizeOllamaConnection(value = {}) {
  return {
    lastSuccessfulBaseURL: String(value.lastSuccessfulBaseURL || ''),
    lastSuccessfulHost: String(value.lastSuccessfulHost || ''),
    recentHosts: Array.isArray(value.recentHosts)
      ? [...new Set(value.recentHosts.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 5)
      : [],
    pcAddressHint: String(value.pcAddressHint || ''),
    lastSelectedModel: String(value.lastSelectedModel || ''),
  };
}

function extractHostname(value = '') {
  try {
    return new URL(String(value || '')).hostname || '';
  } catch {
    return '';
  }
}

function isLoopbackHostname(hostname = '') {
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(String(hostname || '').trim().toLowerCase());
}

function resolveCompatibleTarget(candidate = '', fallback = '', { allowLoopback = false } = {}) {
  const candidateHost = extractHostname(candidate);
  if (candidate && (allowLoopback || !isLoopbackHostname(candidateHost))) {
    return candidate;
  }

  const fallbackHost = extractHostname(fallback);
  if (fallback && (allowLoopback || !isLoopbackHostname(fallbackHost))) {
    return fallback;
  }

  return allowLoopback ? (candidate || fallback || '') : '';
}

function truncateText(value, limit = MAX_PERSISTED_OUTPUT_LENGTH) {
  return String(value || '').slice(0, limit);
}

function sanitizePersistedCommandHistory(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === 'object')
    .slice(-MAX_PERSISTED_COMMANDS)
    .map((entry, index) => ({
      id: String(entry.id || `restored_cmd_${index + 1}`),
      raw_input: String(entry.raw_input || ''),
      parsed_command: entry.parsed_command && typeof entry.parsed_command === 'object' ? entry.parsed_command : null,
      route: String(entry.route || STEPHANOS_ACTIVE_SUBVIEW),
      tool_used: entry.tool_used ?? null,
      success: entry.success !== false,
      output_text: truncateText(entry.output_text),
      data_payload: entry.data_payload && typeof entry.data_payload === 'object' ? entry.data_payload : null,
      timing_ms: Number.isFinite(Number(entry.timing_ms)) ? Number(entry.timing_ms) : null,
      timestamp: String(entry.timestamp || ''),
      error: String(entry.error || ''),
      error_code: entry.error_code ?? null,
      response: entry.response && typeof entry.response === 'object'
        ? {
          type: entry.response.type,
          route: entry.response.route,
          success: entry.response.success,
          output_text: truncateText(entry.response.output_text),
          error: entry.response.error,
          error_code: entry.response.error_code,
          debug: entry.response.debug && typeof entry.response.debug === 'object'
            ? { selected_subsystem: entry.response.debug.selected_subsystem || null }
            : undefined,
        }
        : null,
    }));
}

function sanitizeSurfaceFrictionEvents(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === 'object')
    .slice(-MAX_FRICTION_EVENTS);
}

function sanitizeObjectList(entries = [], max = 12) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === 'object')
    .slice(-max);
}

function normalizeStoredSettings(persistedSession) {
  const defaults = createDefaultRouterSettings();
  const persistedSettings = persistedSession?.session?.providerPreferences || {};

  return {
    ...defaults,
    provider: normalizeProviderSelection(persistedSettings.provider),
    routeMode: normalizeRouteMode(persistedSettings.routeMode),
    devMode: persistedSettings.devMode !== false,
    fallbackEnabled: persistedSettings.fallbackEnabled !== false,
    disableHomeNodeForLocalSession: persistedSettings.disableHomeNodeForLocalSession === true,
    fallbackOrder: Array.isArray(persistedSettings.fallbackOrder)
      ? persistedSettings.fallbackOrder
      : defaults.fallbackOrder,
    providerConfigs: Object.fromEntries(
      PROVIDER_KEYS.map((key) => [key, normalizeProviderDraft(key, {
        ...defaults.providerConfigs[key],
        ...(persistedSettings.providerConfigs?.[key] || {}),
        apiKey: '',
      })]),
    ),
    ollamaConnection: normalizeOllamaConnection(persistedSettings.ollamaConnection || {}),
    surfaceOverride: normalizeSurfaceOverride(persistedSettings.surfaceOverride || DEFAULT_SURFACE_OVERRIDE),
  };
}

function buildInitialRuntimeContext(initialApiRuntimeConfig, { sessionRestoreDiagnostics, homeNodePreference, homeNodeLastKnown }) {
  const frontendOrigin = initialApiRuntimeConfig?.frontendOrigin || '';
  const frontendHost = typeof window !== 'undefined' && window.location?.hostname
    ? String(window.location.hostname || '')
    : '';
  const localDesktopSession = frontendHost === 'localhost' || frontendHost === '127.0.0.1';
  const homeNode = initialApiRuntimeConfig?.homeNode || homeNodePreference || homeNodeLastKnown || null;
  const preferredTarget = localDesktopSession
    ? (initialApiRuntimeConfig?.baseUrl || '')
    : resolveCompatibleTarget(homeNode?.uiUrl || '', frontendOrigin || '', { allowLoopback: false });
  const actualTargetUsed = localDesktopSession
    ? (initialApiRuntimeConfig?.baseUrl || '')
    : resolveCompatibleTarget(homeNode?.backendUrl || '', initialApiRuntimeConfig?.baseUrl || '', { allowLoopback: false });

  return {
    ...initialApiRuntimeConfig,
    apiBaseUrl: initialApiRuntimeConfig?.baseUrl || '',
    backendBaseUrl: initialApiRuntimeConfig?.baseUrl || '',
    preferredTarget,
    actualTargetUsed,
    nodeAddressSource: localDesktopSession
      ? 'local-backend-session'
      : (homeNode?.source || 'route-diagnostics'),
    restoreDecision: sessionRestoreDiagnostics?.reasons?.[0] || '',
    homeNode,
  };
}

function createInitialMemorySnapshot() {
  const currentOrigin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : '';
  const portableHomeNodePreference = readPortableStephanosHomeNodePreference() || null;
  const homeNodePreference = readPersistedStephanosHomeNode() || portableHomeNodePreference || null;
  const homeNodeLastKnown = readPersistedStephanosLastKnownNode() || null;
  const currentHostname = typeof window !== 'undefined' && window.location?.hostname
    ? String(window.location.hostname || '').trim().toLowerCase()
    : '';
  const initialSessionKind = currentHostname === 'localhost' || currentHostname === '127.0.0.1'
    ? 'local-desktop'
    : 'hosted-web';
  const homeBridgeUrl = readPersistedStephanosHomeBridgeUrl(undefined, {
    frontendOrigin: currentOrigin,
    requireHttps: resolveBridgeUrlRequireHttps({ sessionKind: initialSessionKind, selectedTransport: 'manual' }),
  }) || '';
  setStephanosHomeBridgeGlobal(homeBridgeUrl);
  const bridgeMemory = readPersistedBridgeMemory();
  const restoredSession = restoreStephanosSessionMemoryForDevice({
    currentOrigin,
    manualNode: homeNodePreference,
    lastKnownNode: homeNodeLastKnown,
  });
  const persistedSession = restoredSession.memory;
  const defaults = createDefaultStephanosSessionMemory();
  const initialApiRuntimeConfig = getApiRuntimeConfig();
  const restoredVisibilityEntries = Object.entries(persistedSession?.session?.ui?.uiLayout || {})
    .filter(([, value]) => typeof value === 'boolean');
  console.info('[WORKSPACE] restored pane visibility state from session memory', {
    panes: restoredVisibilityEntries.length,
    open: restoredVisibilityEntries.filter(([, value]) => value === true).length,
    closed: restoredVisibilityEntries.filter(([, value]) => value === false).length,
  });
  const surfaceOverride = normalizeSurfaceOverride(persistedSession?.session?.providerPreferences?.surfaceOverride || DEFAULT_SURFACE_OVERRIDE);
  const surfaceAwareness = resolveSurfaceAwareness({
    runtimeContext: initialApiRuntimeConfig || {},
    operatorSurfaceOverrides: { mode: surfaceOverride },
  });
  const hasPersistedUiLayout = restoredVisibilityEntries.length > 0;
  const normalizedUiLayout = normalizeUiLayout(persistedSession?.session?.ui?.uiLayout || DEFAULT_UI_LAYOUT);
  const effectiveUiLayout = hasPersistedUiLayout
    ? normalizedUiLayout
    : normalizeUiLayout(resolveSurfaceUiLayoutDefaults(normalizedUiLayout, surfaceAwareness.effectiveSurfaceExperience));

  const initialBridgeTransportPreferences = normalizeBridgeTransportPreferences(
    persistedSession?.session?.bridgeTransportPreferences,
    {
      homeBridgeUrl,
      frontendOrigin: initialApiRuntimeConfig?.frontendOrigin || '',
      manualRequireHttps: resolveBridgeUrlRequireHttps({ sessionKind: initialSessionKind, selectedTransport: 'manual' }),
      tailscaleRequireHttps: resolveBridgeUrlRequireHttps({ sessionKind: initialSessionKind, selectedTransport: 'tailscale' }),
    },
  );
  const rehydratedBridgeTransportPreferences = bridgeMemory.transport !== 'none' && bridgeMemory.backendUrl
    ? normalizeBridgeTransportPreferences({
      ...initialBridgeTransportPreferences,
      selectedTransport: bridgeMemory.transport,
      transports: {
        ...initialBridgeTransportPreferences.transports,
        [bridgeMemory.transport]: {
          ...(initialBridgeTransportPreferences.transports?.[bridgeMemory.transport] || {}),
          backendUrl: bridgeMemory.backendUrl,
          accepted: false,
          active: false,
          usable: false,
          reachability: 'unknown',
          ...(bridgeMemory.transport === 'tailscale'
            ? {
              enabled: true,
              deviceName: bridgeMemory.tailscaleDeviceName,
              hostOverride: bridgeMemory.tailscaleHostnameOverride,
              tailnetIp: bridgeMemory.tailscaleIp,
            }
            : {}),
          reason: 'Remembered from shared memory; validation pending on this surface.',
        },
      },
    }, {
      homeBridgeUrl: bridgeMemory.transport === 'manual' ? bridgeMemory.backendUrl : homeBridgeUrl,
      frontendOrigin: initialApiRuntimeConfig?.frontendOrigin || '',
      manualRequireHttps: resolveBridgeUrlRequireHttps({ sessionKind: initialSessionKind, selectedTransport: 'manual' }),
      tailscaleRequireHttps: resolveBridgeUrlRequireHttps({ sessionKind: initialSessionKind, selectedTransport: 'tailscale' }),
    })
    : initialBridgeTransportPreferences;

  return {
    persistedSession,
    sessionRestoreDiagnostics: restoredSession.diagnostics,
    initialApiRuntimeContext: buildInitialRuntimeContext(initialApiRuntimeConfig, {
      sessionRestoreDiagnostics: restoredSession.diagnostics,
      homeNodePreference,
      homeNodeLastKnown,
    }),
    settings: normalizeStoredSettings(persistedSession),
    uiLayout: effectiveUiLayout,
    paneLayout: {
      order: normalizeOperatorPaneOrder(persistedSession?.session?.ui?.operatorPaneLayout?.order),
    },
    lastRoute: String(persistedSession?.session?.ui?.recentRoute || STEPHANOS_ACTIVE_SUBVIEW),
    commandHistory: sanitizePersistedCommandHistory(
      persistedSession?.working?.recentCommands || defaults.working.recentCommands,
    ),
    workingMemory: {
      ...defaults.working,
      ...(persistedSession?.working || {}),
      recentCommands: sanitizePersistedCommandHistory(persistedSession?.working?.recentCommands || []),
      surfaceFrictionEvents: sanitizeSurfaceFrictionEvents(persistedSession?.working?.surfaceFrictionEvents || []),
      surfaceFrictionPatterns: sanitizeObjectList(persistedSession?.working?.surfaceFrictionPatterns || [], 12),
      surfaceProtocolRecommendations: sanitizeObjectList(persistedSession?.working?.surfaceProtocolRecommendations || [], 12),
      acceptedSurfaceRules: sanitizeObjectList(persistedSession?.working?.acceptedSurfaceRules || [], 24),
      missionPacketWorkflow: normalizeMissionPacketWorkflow(
        persistedSession?.working?.missionPacketWorkflow || createDefaultMissionPacketWorkflow(),
      ),
      missionLineage: normalizeMissionLineageStore(
        persistedSession?.working?.missionLineage || createDefaultMissionLineageStore(),
      ),
    },
    projectMemory: {
      ...defaults.project,
      ...(persistedSession?.project || {}),
    },
    homeNodePreference,
    homeNodeLastKnown,
    homeBridgeUrl,
    bridgeTransportPreferences: rehydratedBridgeTransportPreferences,
    bridgeMemory,
    bridgeMemoryRehydrated: bridgeMemory.transport !== 'none' && bridgeMemory.backendUrl
      ? rehydratedBridgeTransportPreferences.transports?.[bridgeMemory.transport]?.accepted !== true
      : false,
    surfaceAwareness,
    surfaceOverride,
  };
}

export function AIStoreProvider({ children }) {
  const initialSnapshot = useMemo(() => createInitialMemorySnapshot(), []);
  const initialSettings = initialSnapshot.settings;
  const [commandHistory, setCommandHistory] = useState(initialSnapshot.commandHistory);
  const [status, setStatus] = useState('idle');
  const [isBusy, setIsBusy] = useState(false);
  const [lastRoute, setLastRoute] = useState(initialSnapshot.lastRoute);
  const [uiLayout, setUiLayout] = useState(initialSnapshot.uiLayout);
  const [paneLayout, setPaneLayout] = useState(initialSnapshot.paneLayout);
  const [missionDashboardUiState, setMissionDashboardUiStateState] = useState(normalizeMissionDashboardUiState(initialSnapshot.persistedSession?.session?.ui?.missionDashboard || createDefaultMissionDashboardUiState()));
  const [debugData, setDebugData] = useState({});
  const [provider, setProviderState] = useState(initialSettings.provider);
  const [providerSelectionSource, setProviderSelectionSource] = useState('default:free-tier');
  const [routeMode, setRouteModeState] = useState(initialSettings.routeMode || DEFAULT_ROUTE_MODE);
  const [devMode, setDevModeState] = useState(initialSettings.devMode);
  const [fallbackEnabled, setFallbackEnabledState] = useState(initialSettings.fallbackEnabled);
  const [disableHomeNodeForLocalSession, setDisableHomeNodeForLocalSessionState] = useState(initialSettings.disableHomeNodeForLocalSession === true);
  const [fallbackOrder, setFallbackOrderState] = useState(initialSettings.fallbackOrder);
  const [savedProviderConfigs, setSavedProviderConfigs] = useState(initialSettings.providerConfigs);
  const [draftProviderConfigs, setDraftProviderConfigs] = useState(initialSettings.providerConfigs);
  const [providerDraftStatus, setProviderDraftStatus] = useState(Object.fromEntries(PROVIDER_KEYS.map((key) => [key, { mode: 'saved', message: '', savedAt: null, errors: {} }] )));
  const [providerHealth, setProviderHealth] = useState({});
  const [ollamaConnection, setOllamaConnectionState] = useState(initialSettings.ollamaConnection || DEFAULT_OLLAMA_CONNECTION);
  const [surfaceOverride, setSurfaceOverrideState] = useState(initialSettings.surfaceOverride || DEFAULT_SURFACE_OVERRIDE);
  const [workingMemory, setWorkingMemory] = useState(initialSnapshot.workingMemory);
  const [surfaceFrictionEvents, setSurfaceFrictionEvents] = useState(
    sanitizeSurfaceFrictionEvents(initialSnapshot.workingMemory?.surfaceFrictionEvents || []),
  );
  const [surfaceFrictionPatterns, setSurfaceFrictionPatterns] = useState(
    sanitizeObjectList(initialSnapshot.workingMemory?.surfaceFrictionPatterns || [], 12),
  );
  const [surfaceProtocolRecommendations, setSurfaceProtocolRecommendations] = useState(
    sanitizeObjectList(initialSnapshot.workingMemory?.surfaceProtocolRecommendations || [], 12),
  );
  const [acceptedSurfaceRules, setAcceptedSurfaceRules] = useState(
    sanitizeObjectList(initialSnapshot.workingMemory?.acceptedSurfaceRules || [], 24),
  );
  const [missionPacketWorkflow, setMissionPacketWorkflow] = useState(
    normalizeMissionPacketWorkflow(initialSnapshot.workingMemory?.missionPacketWorkflow || createDefaultMissionPacketWorkflow()),
  );
  const [missionLineage, setMissionLineage] = useState(
    normalizeMissionLineageStore(initialSnapshot.workingMemory?.missionLineage || createDefaultMissionLineageStore()),
  );
  const [projectMemory] = useState(initialSnapshot.projectMemory);
  const [homeNodePreference, setHomeNodePreferenceState] = useState(initialSnapshot.homeNodePreference);
  const [homeNodeLastKnown, setHomeNodeLastKnownState] = useState(initialSnapshot.homeNodeLastKnown);
  const [homeBridgeUrl, setHomeBridgeUrlState] = useState(initialSnapshot.homeBridgeUrl || '');
  const [bridgeTransportPreferences, setBridgeTransportPreferencesState] = useState(
    initialSnapshot.bridgeTransportPreferences || createDefaultBridgeTransportPreferences(),
  );
  const [bridgeMemory, setBridgeMemoryState] = useState(initialSnapshot.bridgeMemory || normalizeHomeBridgeMemory());
  const [bridgeMemoryRehydrated, setBridgeMemoryRehydrated] = useState(initialSnapshot.bridgeMemoryRehydrated === true);
  const [bridgeAutoRevalidation, setBridgeAutoRevalidation] = useState(DEFAULT_BRIDGE_AUTO_REVALIDATION);
  const [homeNodeStatus, setHomeNodeStatusState] = useState(DEFAULT_HOME_NODE_STATUS);
  const [sessionRestoreDiagnostics] = useState(initialSnapshot.sessionRestoreDiagnostics || {
    nonLocalSession: false,
    localDesktopSession: true,
    currentHost: '',
    homeNodeHost: '',
    ignoredFields: [],
    reasons: [],
    message: 'Portable session state restored.',
    activeProvider: initialSettings.provider,
    activeProviderConfigAdjusted: false,
  });
  const [lastExecutionMetadata, setLastExecutionMetadata] = useState(null);
  const [uiDiagnostics, setUiDiagnostics] = useState({
    appRootRendered: false,
    aiConsoleRendered: false,
    providerToggleMounted: false,
    componentMarker: 'uninitialized',
    aiConsoleMarker: 'uninitialized',
    providerToggleMarker: 'uninitialized',
  });
  const [apiStatus, setApiStatus] = useState({
    state: 'checking',
    label: 'Checking backend...',
    detail: 'Waiting for health check.',
    target: initialSnapshot.initialApiRuntimeContext?.target || 'local',
    baseUrl: initialSnapshot.initialApiRuntimeContext?.baseUrl || '',
    frontendOrigin: initialSnapshot.initialApiRuntimeContext?.frontendOrigin || '',
    strategy: initialSnapshot.initialApiRuntimeContext?.strategy || 'default:local-stephanos-backend',
    backendTargetEndpoint: initialSnapshot.initialApiRuntimeContext?.backendTargetEndpoint || '',
    healthEndpoint: initialSnapshot.initialApiRuntimeContext?.healthEndpoint || '',
    backendReachable: false,
    backendDefaultProvider: DEFAULT_PROVIDER_KEY,
    runtimeContext: initialSnapshot.initialApiRuntimeContext || null,
    lastCheckedAt: null,
    meta: null,
  });
  const surfaceAwareness = useMemo(() => resolveSurfaceAwareness({
    runtimeContext: apiStatus.runtimeContext || initialSnapshot.initialApiRuntimeContext || {},
    operatorSurfaceOverrides: { mode: surfaceOverride, protocolIds: [] },
  }), [apiStatus.runtimeContext, initialSnapshot.initialApiRuntimeContext, surfaceOverride]);
  const bridgeTransportTruth = useMemo(() => projectHomeBridgeTransportTruth(bridgeTransportPreferences, {
    runtimeBridge: apiStatus?.runtimeContext?.homeNodeBridge || {},
    bridgeMemory,
    bridgeMemoryRehydrated,
    autoRevalidation: bridgeAutoRevalidation,
  }), [apiStatus?.runtimeContext?.homeNodeBridge, bridgeMemory, bridgeMemoryRehydrated, bridgeTransportPreferences, bridgeAutoRevalidation]);
  const runtimeStatusModel = useMemo(() => ensureRuntimeStatusModel(createRuntimeStatusModel({
    appId: 'stephanos',
    appName: 'Stephanos Mission Console',
    validationState: apiStatus.state === 'offline'
      ? 'error'
      : (apiStatus.state === 'checking' ? 'launching' : 'healthy'),
    selectedProvider: provider,
    routeMode,
    fallbackEnabled,
    fallbackOrder,
    providerHealth,
    backendAvailable: apiStatus.backendReachable,
    runtimeContext: {
      ...(apiStatus.runtimeContext || {
        frontendOrigin: apiStatus.frontendOrigin,
        apiBaseUrl: apiStatus.baseUrl,
        homeNode: apiStatus.runtimeContext?.homeNode || null,
      }),
      surfaceAwareness: {
        ...surfaceAwareness,
        recentFrictionEvents: surfaceFrictionEvents,
        frictionPatterns: surfaceFrictionPatterns,
        surfaceProtocolRecommendations,
        acceptedSurfaceRules,
      },
      bridgeTransportTruth,
    },
    activeProviderHint: lastExecutionMetadata?.actual_provider_used || '',
  })), [
    apiStatus.backendReachable,
    apiStatus.baseUrl,
    apiStatus.frontendOrigin,
    apiStatus.runtimeContext,
    apiStatus.state,
    fallbackEnabled,
    fallbackOrder,
    lastExecutionMetadata?.actual_provider_used,
    provider,
    providerHealth,
    routeMode,
    surfaceAwareness,
    surfaceFrictionEvents,
    surfaceFrictionPatterns,
    surfaceProtocolRecommendations,
    acceptedSurfaceRules,
    bridgeTransportTruth,
  ]);
  const bridgeValidationTruth = useMemo(() => resolveBridgeValidationTruth({
    runtimeStatusModel,
    selectedTransport: bridgeTransportPreferences?.selectedTransport || 'manual',
  }), [runtimeStatusModel, bridgeTransportPreferences?.selectedTransport]);

  const debugVisible = uiLayout.debugConsole === true;

  useEffect(() => {
    if (!devMode || typeof console?.warn !== 'function') {
      return;
    }

    if (!runtimeStatusModel?.guardrails?.summary?.total) {
      return;
    }

    const issues = [
      ...(runtimeStatusModel.guardrails.errors || []),
      ...(runtimeStatusModel.guardrails.warnings || []),
    ].map((issue) => `${issue.severity.toUpperCase()}: ${issue.message}`);

    if (issues.length > 0) {
      console.warn('[Stephanos Routing Guardrails]', {
        summary: runtimeStatusModel.guardrails.summary,
        issues,
        finalRoute: runtimeStatusModel.finalRoute,
      });
    }
  }, [devMode, runtimeStatusModel]);

  useEffect(() => {
    const rememberedAt = bridgeMemory?.rememberedAt || new Date().toISOString();
    const nextBridgeMemory = deriveBridgeMemoryFromPreferences(bridgeTransportPreferences, {
      rememberedAt,
      savedBySurface: surfaceAwareness?.surfaceIdentity?.surfaceId || 'unknown-surface',
      savedBySession: sessionRestoreDiagnostics?.currentHost || 'unknown-session',
      reason: bridgeMemoryRehydrated
        ? 'Remembered Home Bridge loaded from shared memory and awaiting validation on this surface.'
        : 'Home Bridge configuration saved by operator.',
    });
    setBridgeMemoryState(nextBridgeMemory);
    persistBridgeMemoryToDurableStore(nextBridgeMemory);
  }, [
    bridgeMemory?.rememberedAt,
    bridgeMemoryRehydrated,
    bridgeTransportPreferences,
    sessionRestoreDiagnostics?.currentHost,
    surfaceAwareness?.surfaceIdentity?.surfaceId,
  ]);

  useEffect(() => {
    persistStephanosSessionMemory({
      session: {
        providerPreferences: {
          provider,
          routeMode,
          devMode,
          fallbackEnabled,
          disableHomeNodeForLocalSession,
          fallbackOrder,
          providerConfigs: sanitizeConfigForStorage(savedProviderConfigs),
          ollamaConnection: normalizeOllamaConnection(ollamaConnection),
          surfaceOverride: normalizeSurfaceOverride(surfaceOverride),
        },
        bridgeTransportPreferences: normalizeBridgeTransportPreferences(bridgeTransportPreferences, {
          homeBridgeUrl,
          manualRequireHttps: resolveBridgeUrlRequireHttps({
            sessionKind: bridgeValidationTruth.sessionKind,
            selectedTransport: 'manual',
            fallbackRequireHttps: bridgeValidationTruth.requireHttps,
          }),
          tailscaleRequireHttps: resolveBridgeUrlRequireHttps({
            sessionKind: bridgeValidationTruth.sessionKind,
            selectedTransport: 'tailscale',
          }),
        }),
        ui: {
          activeWorkspace: STEPHANOS_ACTIVE_WORKSPACE,
          activeSubview: lastRoute || STEPHANOS_ACTIVE_SUBVIEW,
          recentRoute: lastRoute || STEPHANOS_ACTIVE_SUBVIEW,
          uiLayout: normalizeUiLayout(uiLayout),
          operatorPaneLayout: {
            order: normalizeOperatorPaneOrder(paneLayout.order),
          },
          debugConsoleVisible: debugVisible,
          missionDashboard: normalizeMissionDashboardUiState(missionDashboardUiState),
        },
        homeNodePreference,
      },
      working: {
        ...workingMemory,
        missionPacketWorkflow,
        missionLineage,
        surfaceFrictionEvents: sanitizeSurfaceFrictionEvents(surfaceFrictionEvents),
        surfaceFrictionPatterns: sanitizeObjectList(surfaceFrictionPatterns, 12),
        surfaceProtocolRecommendations: sanitizeObjectList(surfaceProtocolRecommendations, 12),
        acceptedSurfaceRules: sanitizeObjectList(acceptedSurfaceRules, 24),
        recentCommands: sanitizePersistedCommandHistory(commandHistory),
      },
      project: projectMemory,
    });
  }, [
    provider,
    routeMode,
    devMode,
    fallbackEnabled,
    disableHomeNodeForLocalSession,
    fallbackOrder,
    savedProviderConfigs,
    ollamaConnection,
    surfaceOverride,
    bridgeTransportPreferences,
    homeBridgeUrl,
    uiLayout,
    missionDashboardUiState,
    paneLayout,
    lastRoute,
    commandHistory,
    workingMemory,
    missionPacketWorkflow,
    missionLineage,
    surfaceFrictionEvents,
    surfaceFrictionPatterns,
    surfaceProtocolRecommendations,
    acceptedSurfaceRules,
    projectMemory,
    debugVisible,
  ]);


  const setMissionDashboardUiState = useCallback((nextState) => {
    setMissionDashboardUiStateState((prev) => normalizeMissionDashboardUiState(
      typeof nextState === 'function' ? nextState(prev) : nextState,
    ));
  }, []);

  const setPaneOrder = useCallback((nextOrder) => {
    setPaneLayout((prev) => {
      const resolvedOrder = normalizeOperatorPaneOrder(typeof nextOrder === 'function' ? nextOrder(prev.order) : nextOrder);
      console.info('[PANES] pane order updated', { order: resolvedOrder });
      return { ...prev, order: resolvedOrder };
    });
  }, []);

  const updateUiLayout = useCallback((updater) => {
    setUiLayout((prev) => {
      const candidate = typeof updater === 'function' ? updater(prev) : updater;
      return normalizeUiLayout(candidate);
    });
  }, []);

  const setDebugVisible = useCallback((nextVisible) => {
    updateUiLayout((prev) => ({
      ...prev,
      debugConsole: typeof nextVisible === 'function' ? nextVisible(prev.debugConsole) : nextVisible,
    }));
  }, [updateUiLayout]);

  const setPanelState = useCallback((panelId, isOpen) => {
    if (!(panelId in DEFAULT_UI_LAYOUT)) return;

    setUiLayout((prev) => {
      const resolvedOpen = typeof isOpen === 'function' ? isOpen(prev[panelId]) : isOpen;
      const nextLayout = normalizeUiLayout({
        ...prev,
        [panelId]: resolvedOpen,
      });
      console.info(
        resolvedOpen === true
          ? '[WORKSPACE] persisted open action for pane'
          : '[WORKSPACE] persisted close action for pane',
        { paneId: panelId },
      );
      return nextLayout;
    });
  }, []);

  const togglePanel = useCallback((panelId) => {
    if (!(panelId in DEFAULT_UI_LAYOUT)) return;
    setPanelState(panelId, (prev) => !prev);
  }, [setPanelState]);

  const setProvider = useCallback((nextProvider) => {
    const resolved = normalizeProviderSelection(nextProvider);
    setProviderState(resolved);
    setProviderSelectionSource('saved:user-selection');
  }, []);

  const setRouteMode = useCallback((nextRouteMode) => {
    setRouteModeState(normalizeRouteMode(nextRouteMode));
  }, []);

  const setDevMode = useCallback((next) => {
    setDevModeState(Boolean(next));
  }, []);

  const setFallbackEnabled = useCallback((next) => {
    setFallbackEnabledState(Boolean(next));
  }, []);

  const setDisableHomeNodeForLocalSession = useCallback((next) => {
    setDisableHomeNodeForLocalSessionState(Boolean(next));
  }, []);

  const setOllamaConnection = useCallback((patch = {}) => {
    const nextConnection = normalizeOllamaConnection({ ...ollamaConnection, ...patch });
    setOllamaConnectionState(nextConnection);
    return nextConnection;
  }, [ollamaConnection]);

  const setSurfaceOverride = useCallback((nextMode) => {
    setSurfaceOverrideState(normalizeSurfaceOverride(nextMode));
  }, []);

  const reportSurfaceFriction = useCallback(({ userText = '', source = 'operator-text', now = new Date() } = {}) => {
    const frictionEvent = createFrictionEvent({
      userText,
      source,
      now,
      sessionId: `route:${lastRoute || 'assistant'}`,
      surfaceProfileId: surfaceAwareness.effectiveSurfaceExperience?.selectedProfileId || 'generic-surface',
      activeProtocolIds: surfaceAwareness.effectiveSurfaceExperience?.activeProtocolIds || [],
    });
    setSurfaceFrictionEvents((prev) => {
      const nextEvents = appendFrictionEvent(prev, frictionEvent);
      const nextPatterns = detectSurfaceFrictionPatterns({ events: nextEvents, existingPatterns: surfaceFrictionPatterns });
      setSurfaceFrictionPatterns(nextPatterns);
      const nextRecommendations = generateSurfaceProtocolRecommendations({
        patterns: nextPatterns,
        existingRecommendations: surfaceProtocolRecommendations,
      });
      setSurfaceProtocolRecommendations(nextRecommendations);
      return nextEvents;
    });
    return frictionEvent;
  }, [lastRoute, surfaceAwareness, surfaceFrictionPatterns, surfaceProtocolRecommendations]);

  const clearSurfaceFrictionEvents = useCallback(() => {
    setSurfaceFrictionEvents([]);
    setSurfaceFrictionPatterns([]);
    setSurfaceProtocolRecommendations([]);
    setAcceptedSurfaceRules((prev) => prev.filter((rule) => rule.scope !== 'session'));
  }, []);

  const acceptSurfaceRecommendation = useCallback(({ recommendationId = '', scope = 'session', operatorId = 'operator' } = {}) => {
    const recommendation = surfaceProtocolRecommendations.find((entry) => entry.id === recommendationId);
    if (!recommendation) {
      return null;
    }
    const acceptedRule = acceptSurfaceProtocolRecommendation({
      recommendation,
      scope,
      operatorId,
      now: new Date(),
    });
    setAcceptedSurfaceRules((prev) => appendAcceptedSurfaceRule(prev, acceptedRule));
    setSurfaceProtocolRecommendations((prev) => prev.map((entry) => (
      entry.id === recommendationId ? { ...entry, status: 'accepted', acceptedAt: new Date().toISOString() } : entry
    )));
    return acceptedRule;
  }, [surfaceProtocolRecommendations]);

  const rejectSurfaceRecommendation = useCallback(({ recommendationId = '', operatorId = 'operator' } = {}) => {
    const timestamp = new Date().toISOString();
    setSurfaceProtocolRecommendations((prev) => prev.map((entry) => (
      entry.id === recommendationId
        ? { ...entry, status: 'rejected', rejectedAt: timestamp, rejectionReason: `Rejected by ${operatorId}` }
        : entry
    )));
  }, []);

  const revertSurfaceRule = useCallback(({ ruleId = '', operatorId = 'operator' } = {}) => {
    setAcceptedSurfaceRules((prev) => revertAcceptedSurfaceRule(prev, ruleId, { now: new Date(), operatorId }));
  }, []);

  const explainMemoryToOperator = useCallback(({ mode = 'summary' } = {}) => explainStephanosMemory({
    acceptedSurfaceRules,
    surfaceFrictionPatterns,
    surfaceProtocolRecommendations,
    elevatedMemories: [
      ...(Array.isArray(projectMemory?.lessonsLearned) ? projectMemory.lessonsLearned.map((entry, index) => ({
        id: `lesson_${index + 1}`,
        summary: String(entry || ''),
        confidence: 0.74,
        sourceType: 'project.lessonsLearned',
        memoryClass: 'high-confidence-elevated-memory',
      })) : []),
      ...(Array.isArray(projectMemory?.knownConstraints) ? projectMemory.knownConstraints.map((entry, index) => ({
        id: `constraint_${index + 1}`,
        summary: String(entry || ''),
        confidence: 0.71,
        sourceType: 'project.knownConstraints',
        memoryClass: 'high-confidence-elevated-memory',
      })) : []),
    ],
  }, { mode }), [
    acceptedSurfaceRules,
    surfaceFrictionPatterns,
    surfaceProtocolRecommendations,
    projectMemory,
  ]);

  const rememberSuccessfulOllamaConnection = useCallback(({ baseURL = '', host = '', model = '' } = {}) => {
    const normalizedHost = String(host || '').trim();
    const nextConnection = normalizeOllamaConnection({
      ...ollamaConnection,
      lastSuccessfulBaseURL: baseURL || ollamaConnection.lastSuccessfulBaseURL,
      lastSuccessfulHost: normalizedHost || ollamaConnection.lastSuccessfulHost,
      lastSelectedModel: model || ollamaConnection.lastSelectedModel,
      recentHosts: [normalizedHost, ...(ollamaConnection.recentHosts || [])].filter(Boolean),
    });
    setOllamaConnectionState(nextConnection);
    return nextConnection;
  }, [ollamaConnection]);

  const resetToFreeMode = () => {
    const defaults = createDefaultRouterSettings();
    const sessionSafe = Object.fromEntries(PROVIDER_KEYS.map((key) => [key, { ...defaults.providerConfigs[key], apiKey: '' }]));
    const nextUiLayout = { ...DEFAULT_UI_LAYOUT };
    const nextWorkingMemory = createDefaultStephanosSessionMemory().working;
    setProviderState(defaults.provider);
    setRouteModeState(defaults.routeMode);
    setDevModeState(defaults.devMode);
    setFallbackEnabledState(defaults.fallbackEnabled);
    setDisableHomeNodeForLocalSessionState(defaults.disableHomeNodeForLocalSession === true);
    setFallbackOrderState(defaults.fallbackOrder);
    setSavedProviderConfigs(sessionSafe);
    setDraftProviderConfigs(sessionSafe);
    setSurfaceOverrideState(DEFAULT_SURFACE_OVERRIDE);
    setOllamaConnectionState(DEFAULT_OLLAMA_CONNECTION);
    setWorkingMemory(nextWorkingMemory);
    setMissionPacketWorkflow(normalizeMissionPacketWorkflow(nextWorkingMemory.missionPacketWorkflow || createDefaultMissionPacketWorkflow()));
    setCommandHistory([]);
    setLastRoute(STEPHANOS_ACTIVE_SUBVIEW);
    setHomeNodePreferenceState(null);
    setHomeNodeLastKnownState(null);
    setHomeBridgeUrlState('');
    setBridgeTransportPreferencesState(createDefaultBridgeTransportPreferences());
    setBridgeAutoRevalidation(DEFAULT_BRIDGE_AUTO_REVALIDATION);
    setHomeNodeStatusState(DEFAULT_HOME_NODE_STATUS);
    setProviderSelectionSource('default:free-tier');
    setUiLayout(nextUiLayout);
    setPaneLayout({ order: [...DEFAULT_OPERATOR_PANE_ORDER] });
    clearPersistedStephanosSessionMemory();
    clearPersistedStephanosHomeNode();
    clearPersistedStephanosHomeBridgeUrl();
    persistStephanosLastKnownNode(null);
    setStephanosHomeBridgeGlobal('');
  };

  const getDraftProviderConfig = useCallback((providerKey) => draftProviderConfigs[providerKey], [draftProviderConfigs]);
  const getSavedProviderConfig = useCallback((providerKey) => savedProviderConfigs[providerKey], [savedProviderConfigs]);
  const getEffectiveProviderConfig = useCallback((providerKey) => (
    isDraftDirty(providerKey) ? draftProviderConfigs[providerKey] : savedProviderConfigs[providerKey]
  ), [draftProviderConfigs, savedProviderConfigs]);
  const getEffectiveProviderConfigs = useCallback(() => Object.fromEntries(
    PROVIDER_KEYS.map((key) => [key, getEffectiveProviderConfig(key)]),
  ), [getEffectiveProviderConfig]);
  const getActiveProviderConfig = useCallback(() => getEffectiveProviderConfig(provider), [getEffectiveProviderConfig, provider]);
  const getActiveProviderConfigSource = useCallback(() => {
    if (isDraftDirty(provider)) {
      return 'draft:unsaved';
    }

    if (sessionRestoreDiagnostics.activeProvider === provider && sessionRestoreDiagnostics.activeProviderConfigAdjusted) {
      return 'saved:portable-session';
    }

    if (sessionRestoreDiagnostics.ignoredFields?.includes(`providerConfigs.${provider}.baseURL`)) {
      return 'saved:portable-session';
    }

    return 'saved:session';
  }, [provider, draftProviderConfigs, savedProviderConfigs, sessionRestoreDiagnostics]);

  const updateDraftProviderConfig = useCallback((providerKey, patch) => {
    const sanitizedPatch = patch && typeof patch === 'object'
      ? Object.fromEntries(Object.entries(patch).filter(([key]) => key !== 'apiKey'))
      : {};
    setDraftProviderConfigs((prev) => ({
      ...prev,
      [providerKey]: normalizeProviderDraft(providerKey, { ...prev[providerKey], ...sanitizedPatch, apiKey: '' }),
    }));
    setProviderDraftStatus((prev) => ({ ...prev, [providerKey]: { ...prev[providerKey], mode: 'draft', message: '', errors: {} } }));
  }, []);

  const saveDraftProviderConfig = useCallback((providerKey) => {
    const draft = normalizeProviderDraft(providerKey, { ...draftProviderConfigs[providerKey], apiKey: '' });
    const validation = validateProviderDraft(providerKey, draft);
    if (!validation.isValid) {
      setProviderDraftStatus((prev) => ({ ...prev, [providerKey]: { ...prev[providerKey], mode: 'draft', message: 'Fix validation errors before saving.', errors: validation.errors } }));
      return { ok: false, errors: validation.errors };
    }

    const nextSaved = { ...savedProviderConfigs, [providerKey]: draft };
    const nextConnection = providerKey === 'ollama'
      ? normalizeOllamaConnection({
        ...ollamaConnection,
        lastSelectedModel: draft.model || ollamaConnection.lastSelectedModel,
      })
      : ollamaConnection;

    setSavedProviderConfigs(nextSaved);
    setDraftProviderConfigs((prev) => ({ ...prev, [providerKey]: draft }));
    if (providerKey === 'ollama') {
      setOllamaConnectionState(nextConnection);
    }
    const savedAt = new Date().toISOString();
    setProviderDraftStatus((prev) => ({ ...prev, [providerKey]: { mode: 'saved', message: `${PROVIDER_DEFINITIONS[providerKey].label} settings applied.`, savedAt, errors: {} } }));
    return { ok: true, savedAt };
  }, [draftProviderConfigs, savedProviderConfigs, ollamaConnection]);

  const revertDraftProviderConfig = useCallback((providerKey) => {
    setDraftProviderConfigs((prev) => ({ ...prev, [providerKey]: savedProviderConfigs[providerKey] }));
    setProviderDraftStatus((prev) => ({ ...prev, [providerKey]: { ...prev[providerKey], mode: 'saved', message: 'Draft reverted.', errors: {} } }));
  }, [savedProviderConfigs]);

  const resetProviderConfig = useCallback((providerKey) => {
    const nextConfig = { ...PROVIDER_DEFINITIONS[providerKey].defaults, apiKey: '' };
    const nextSaved = { ...savedProviderConfigs, [providerKey]: nextConfig };
    setSavedProviderConfigs(nextSaved);
    setDraftProviderConfigs((prev) => ({ ...prev, [providerKey]: nextConfig }));
    setProviderDraftStatus((prev) => ({ ...prev, [providerKey]: { ...prev[providerKey], mode: 'saved', message: `${PROVIDER_DEFINITIONS[providerKey].label} reset.`, errors: {} } }));
  }, [savedProviderConfigs]);

  const isDraftDirty = (providerKey) => JSON.stringify(draftProviderConfigs[providerKey]) !== JSON.stringify(savedProviderConfigs[providerKey]);

  const setHomeNodePreference = useCallback((patch = {}) => {
    const normalizedPreference = patch === null
      ? null
      : normalizeStephanosHomeNode({ ...(homeNodePreference || {}), ...patch }, { source: 'manual' });
    const nextPreference = normalizedPreference && isValidStephanosHomeNode(normalizedPreference)
      ? normalizedPreference
      : null;
    setHomeNodePreferenceState(nextPreference);
    if (nextPreference) {
      persistStephanosHomeNodePreference(nextPreference);
    } else {
      clearPersistedStephanosHomeNode();
    }
    return nextPreference;
  }, [homeNodePreference]);

  const setHomeNodeLastKnown = useCallback((node = null) => {
    const nextNode = node ? normalizeStephanosHomeNode(node, { source: node.source || 'lastKnown' }) : null;
    setHomeNodeLastKnownState(nextNode);
    persistStephanosLastKnownNode(nextNode);
    return nextNode;
  }, []);

  const setHomeNodeStatus = useCallback((nextStatus = DEFAULT_HOME_NODE_STATUS) => {
    setHomeNodeStatusState({
      ...DEFAULT_HOME_NODE_STATUS,
      ...(nextStatus || {}),
      attempts: Array.isArray(nextStatus?.attempts) ? nextStatus.attempts : [],
    });
  }, []);

  const saveHomeBridgeUrl = useCallback((candidateUrl = '') => {
    const frontendOrigin = typeof window !== 'undefined' ? window.location?.origin || '' : '';
    const requireHttps = resolveBridgeUrlRequireHttps({
      sessionKind: bridgeValidationTruth.sessionKind,
      selectedTransport: 'manual',
      fallbackRequireHttps: bridgeValidationTruth.requireHttps,
    });
    const validation = validateStephanosHomeBridgeUrl(candidateUrl, { frontendOrigin, requireHttps });
    if (!validation.ok) {
      return { ok: false, reason: validation.reason, normalizedUrl: '' };
    }
    const persisted = persistStephanosHomeBridgeUrl(validation.normalizedUrl, undefined, {
      frontendOrigin,
      requireHttps,
    });
    if (!persisted.ok) {
      return { ok: false, reason: persisted.reason || 'Failed to persist bridge URL.', normalizedUrl: '' };
    }
    setStephanosHomeBridgeGlobal(validation.normalizedUrl);
    setHomeBridgeUrlState(validation.normalizedUrl);
    setBridgeAutoRevalidation(DEFAULT_BRIDGE_AUTO_REVALIDATION);
    setBridgeMemoryRehydrated(false);
    setBridgeTransportPreferencesState((prev) => normalizeBridgeTransportPreferences({
      ...prev,
      transports: {
        ...(prev?.transports || {}),
        manual: {
          ...(prev?.transports?.manual || {}),
          enabled: true,
          backendUrl: validation.normalizedUrl,
          accepted: true,
        },
      },
    }, {
      homeBridgeUrl: validation.normalizedUrl,
      frontendOrigin,
      manualRequireHttps: requireHttps,
      tailscaleRequireHttps: resolveBridgeUrlRequireHttps({
        sessionKind: bridgeValidationTruth.sessionKind,
        selectedTransport: 'tailscale',
      }),
    }));
    return { ok: true, reason: '', normalizedUrl: validation.normalizedUrl };
  }, [bridgeValidationTruth.requireHttps, bridgeValidationTruth.sessionKind]);

  const clearHomeBridgeUrl = useCallback(() => {
    clearPersistedStephanosHomeBridgeUrl();
    setStephanosHomeBridgeGlobal('');
    setHomeBridgeUrlState('');
    const clearedBridgeMemory = normalizeHomeBridgeMemory();
    setBridgeMemoryState(clearedBridgeMemory);
    setBridgeMemoryRehydrated(false);
    setBridgeAutoRevalidation(DEFAULT_BRIDGE_AUTO_REVALIDATION);
    persistBridgeMemoryToDurableStore(clearedBridgeMemory);
    setBridgeTransportPreferencesState((prev) => normalizeBridgeTransportPreferences({
      ...prev,
      transports: {
        ...(prev?.transports || {}),
        manual: {
          ...(prev?.transports?.manual || {}),
          backendUrl: '',
          accepted: false,
          reachability: 'unknown',
          reason: 'Manual/LAN bridge not configured.',
        },
      },
    }, {
      homeBridgeUrl: '',
      manualRequireHttps: resolveBridgeUrlRequireHttps({
        sessionKind: bridgeValidationTruth.sessionKind,
        selectedTransport: 'manual',
        fallbackRequireHttps: bridgeValidationTruth.requireHttps,
      }),
      tailscaleRequireHttps: resolveBridgeUrlRequireHttps({
        sessionKind: bridgeValidationTruth.sessionKind,
        selectedTransport: 'tailscale',
      }),
    }));
    return { ok: true };
  }, [bridgeValidationTruth.requireHttps, bridgeValidationTruth.sessionKind]);



  const setBridgeTransportSelection = useCallback((transportKey) => {
    const selectedTransport = normalizeBridgeTransportSelection(transportKey);
    setBridgeTransportPreferencesState((prev) => normalizeBridgeTransportPreferences({
      ...prev,
      selectedTransport,
    }, {
      homeBridgeUrl,
      manualRequireHttps: resolveBridgeUrlRequireHttps({
        sessionKind: bridgeValidationTruth.sessionKind,
        selectedTransport: 'manual',
        fallbackRequireHttps: bridgeValidationTruth.requireHttps,
      }),
      tailscaleRequireHttps: resolveBridgeUrlRequireHttps({
        sessionKind: bridgeValidationTruth.sessionKind,
        selectedTransport: 'tailscale',
      }),
    }));
    return selectedTransport;
  }, [bridgeValidationTruth.requireHttps, bridgeValidationTruth.sessionKind, homeBridgeUrl]);

  const updateBridgeTransportConfig = useCallback((transportKey, patch = {}) => {
    const normalizedTransport = normalizeBridgeTransportSelection(transportKey);
    setBridgeTransportPreferencesState((prev) => normalizeBridgeTransportPreferences({
      ...prev,
      transports: {
        ...(prev?.transports || {}),
        [normalizedTransport]: {
          ...(prev?.transports?.[normalizedTransport] || {}),
          ...(patch && typeof patch === 'object' ? patch : {}),
        },
      },
    }, {
      homeBridgeUrl,
      manualRequireHttps: resolveBridgeUrlRequireHttps({
        sessionKind: bridgeValidationTruth.sessionKind,
        selectedTransport: 'manual',
        fallbackRequireHttps: bridgeValidationTruth.requireHttps,
      }),
      tailscaleRequireHttps: resolveBridgeUrlRequireHttps({
        sessionKind: bridgeValidationTruth.sessionKind,
        selectedTransport: 'tailscale',
      }),
    }));
    if (patch?.accepted === true || patch?.backendUrl === '') {
      setBridgeMemoryRehydrated(false);
    }
  }, [bridgeValidationTruth.requireHttps, bridgeValidationTruth.sessionKind, homeBridgeUrl]);

  useEffect(() => {
    let cancelled = false;
    const sessionKind = bridgeValidationTruth?.sessionKind || 'unknown';
    const hostedSession = sessionKind === 'hosted-web';
    const plan = resolveAutoBridgeRevalidationPlan({
      bridgeMemory,
      preferences: bridgeTransportPreferences,
      bridgeValidationTruth,
    });
    const attemptedConfigKey = `${plan.transport || 'none'}::${plan.candidateUrl || ''}::${bridgeMemory?.rememberedAt || ''}`;
    const terminalStates = new Set(['skipped', 'validation-failed', 'unreachable', 'revalidated']);
    if (bridgeAutoRevalidation.attemptedConfigKey === attemptedConfigKey && terminalStates.has(bridgeAutoRevalidation.state)) {
      return () => {
        cancelled = true;
      };
    }
    if (!hostedSession || !plan.shouldAttempt || !plan.transport || !plan.candidateUrl) {
      setBridgeAutoRevalidation((prev) => (
        prev.state === 'revalidated'
          ? prev
          : {
            state: 'skipped',
            reason: !hostedSession
              ? 'Auto-revalidation only runs on hosted surfaces.'
              : (plan.reason || 'Remembered bridge not eligible for auto-revalidation.'),
            attemptedAt: prev.attemptedAt || new Date().toISOString(),
            attemptedConfigKey,
          }
      ));
      return () => {
        cancelled = true;
      };
    }
    if (bridgeAutoRevalidation.state === 'revalidated' && bridgeAutoRevalidation.attemptedAt) {
      return () => {
        cancelled = true;
      };
    }

    const frontendOrigin = typeof window !== 'undefined' ? window.location?.origin || '' : '';
    const executeAutoRevalidation = async () => {
      setBridgeAutoRevalidation({
        state: 'validating',
        reason: `Auto-validating remembered ${plan.transport} bridge for this hosted surface.`,
        attemptedAt: new Date().toISOString(),
        attemptedConfigKey,
      });
      const validation = validateStephanosHomeBridgeUrl(plan.candidateUrl, {
        frontendOrigin,
        requireHttps: plan.requireHttps !== false,
      });
      if (!validation.ok) {
        if (cancelled) return;
        updateBridgeTransportConfig(plan.transport, {
          accepted: false,
          active: false,
          usable: false,
          reachability: 'invalid',
          reason: validation.reason || 'Remembered bridge failed canonical validation on this surface.',
        });
        setBridgeAutoRevalidation({
          state: 'validation-failed',
          reason: validation.reason || 'Remembered bridge failed canonical validation on this surface.',
          attemptedAt: new Date().toISOString(),
          attemptedConfigKey,
        });
        return;
      }
      if (plan.transport === 'manual') {
        setHomeBridgeUrlState(validation.normalizedUrl);
        setStephanosHomeBridgeGlobal(validation.normalizedUrl);
      }
      updateBridgeTransportConfig(plan.transport, {
        backendUrl: validation.normalizedUrl,
        accepted: false,
        active: false,
        usable: false,
        reachability: 'pending',
        reason: 'Remembered bridge passed validation; probing current-surface reachability.',
      });
      setBridgeAutoRevalidation({
        state: 'probing',
        reason: 'Remembered bridge validated; probing reachability from this surface.',
        attemptedAt: new Date().toISOString(),
        attemptedConfigKey,
      });
      try {
        const probe = await checkApiHealth({ baseUrl: validation.normalizedUrl, timeoutMs: 12000 });
        if (cancelled) return;
        const serviceOk = probe.ok && probe.data?.service === 'stephanos-server';
        const nextReachability = serviceOk ? 'reachable' : 'unreachable';
        updateBridgeTransportConfig(plan.transport, {
          backendUrl: validation.normalizedUrl,
          accepted: serviceOk,
          active: serviceOk,
          usable: serviceOk,
          reachability: nextReachability,
          reason: serviceOk
            ? 'Remembered bridge revalidated and reachable on this hosted surface.'
            : (probe.data?.error || 'Remembered bridge probe failed from this hosted surface.'),
        });
        setApiStatus((prev) => ({
          ...prev,
          runtimeContext: {
            ...(prev?.runtimeContext || {}),
            homeNodeBridge: {
              ...(prev?.runtimeContext?.homeNodeBridge || {}),
              configured: true,
              accepted: serviceOk,
              backendUrl: validation.normalizedUrl,
              reachability: nextReachability,
              reason: serviceOk
                ? 'Remembered bridge revalidated and promoted to live route truth.'
                : (probe.data?.error || 'Remembered bridge unreachable from this hosted surface.'),
              source: `bridge-memory:auto-revalidation:${plan.transport}`,
              lastCheckedAt: new Date().toISOString(),
            },
          },
        }));
        setBridgeAutoRevalidation({
          state: serviceOk ? 'revalidated' : 'unreachable',
          reason: serviceOk
            ? 'Remembered Home Bridge revalidated successfully.'
            : (probe.data?.error || 'Remembered Home Bridge is unreachable from this surface.'),
          attemptedAt: new Date().toISOString(),
          attemptedConfigKey,
        });
        if (serviceOk) {
          setBridgeMemoryRehydrated(false);
        }
      } catch (error) {
        if (cancelled) return;
        updateBridgeTransportConfig(plan.transport, {
          accepted: false,
          active: false,
          usable: false,
          reachability: 'unreachable',
          reason: error?.message || 'Remembered bridge probe failed before receiving a response.',
        });
        setBridgeAutoRevalidation({
          state: 'unreachable',
          reason: error?.message || 'Remembered Home Bridge probe failed from this surface.',
          attemptedAt: new Date().toISOString(),
          attemptedConfigKey,
        });
      }
    };
    void executeAutoRevalidation();
    return () => {
      cancelled = true;
    };
  }, [
    bridgeMemory,
    bridgeTransportPreferences,
    bridgeValidationTruth,
    bridgeAutoRevalidation.attemptedAt,
    bridgeAutoRevalidation.state,
    setApiStatus,
    updateBridgeTransportConfig,
  ]);
  const value = useMemo(() => ({
    commandHistory,
    setCommandHistory,
    status,
    setStatus,
    isBusy,
    setIsBusy,
    lastRoute,
    setLastRoute,
    debugVisible,
    setDebugVisible,
    debugData,
    setDebugData,
    uiLayout,
    paneLayout,
    missionDashboardUiState,
    togglePanel,
    setPanelState,
    setPaneOrder,
    setMissionDashboardUiState,
    provider,
    setProvider,
    providerSelectionSource,
    routeMode,
    setRouteMode,
    devMode,
    setDevMode,
    fallbackEnabled,
    setFallbackEnabled,
    disableHomeNodeForLocalSession,
    setDisableHomeNodeForLocalSession,
    fallbackOrder,
    setFallbackOrderState,
    savedProviderConfigs,
    draftProviderConfigs,
    providerDraftStatus,
    providerHealth,
    setProviderHealth,
    ollamaConnection,
    setOllamaConnection,
    surfaceAwareness,
    surfaceFrictionEvents,
    surfaceFrictionPatterns,
    surfaceProtocolRecommendations,
    acceptedSurfaceRules,
    surfaceOverride,
    setSurfaceOverride,
    reportSurfaceFriction,
    clearSurfaceFrictionEvents,
    acceptSurfaceRecommendation,
    rejectSurfaceRecommendation,
    revertSurfaceRule,
    explainMemoryToOperator,
    workingMemory,
    setWorkingMemory,
    missionPacketWorkflow,
    setMissionPacketWorkflow,
    missionLineage,
    setMissionLineage,
    projectMemory,
    homeNodePreference,
    setHomeNodePreference,
    homeNodeLastKnown,
    setHomeNodeLastKnown,
    homeBridgeUrl,
    bridgeTransportDefinitions: listBridgeTransportDefinitions(),
    bridgeTransportPreferences,
    bridgeTransportTruth,
    bridgeMemory,
    bridgeMemoryRehydrated,
    bridgeAutoRevalidation,
    setBridgeTransportSelection,
    updateBridgeTransportConfig,
    saveHomeBridgeUrl,
    clearHomeBridgeUrl,
    homeNodeStatus,
    setHomeNodeStatus,
    sessionRestoreDiagnostics,
    lastExecutionMetadata,
    setLastExecutionMetadata,
    rememberSuccessfulOllamaConnection,
    getDraftProviderConfig,
    getEffectiveProviderConfig,
    getEffectiveProviderConfigs,
    getActiveProviderConfig,
    getSavedProviderConfig,
    getActiveProviderConfigSource,
    updateDraftProviderConfig,
    saveDraftProviderConfig,
    revertDraftProviderConfig,
    resetProviderConfig,
    resetToFreeMode,
    isDraftDirty,
    apiStatus,
    setApiStatus,
    runtimeStatusModel,
    uiDiagnostics,
    setUiDiagnostics,
    applyMissionPacketWorkflowAction: (action, packetTruth, now) => {
      setMissionPacketWorkflow((prev) => applyMissionPacketAction(prev, { action, packetTruth, now }));
    },
    applyMissionLineageAction: ({ packetTruth, selectors, envelope, now }) => {
      setMissionLineage((prev) => applyMissionLineageUpdate(prev, { packetTruth, selectors, envelope, now }));
    },
  }), [
    commandHistory,
    status,
    isBusy,
    lastRoute,
    debugVisible,
    debugData,
    uiLayout,
    paneLayout,
    missionDashboardUiState,
    provider,
    providerSelectionSource,
    routeMode,
    devMode,
    fallbackEnabled,
    disableHomeNodeForLocalSession,
    fallbackOrder,
    savedProviderConfigs,
    draftProviderConfigs,
    providerDraftStatus,
    providerHealth,
    ollamaConnection,
    surfaceAwareness,
    surfaceFrictionEvents,
    surfaceFrictionPatterns,
    surfaceProtocolRecommendations,
    acceptedSurfaceRules,
    surfaceOverride,
    workingMemory,
    missionPacketWorkflow,
    missionLineage,
    projectMemory,
    homeNodePreference,
    homeNodeLastKnown,
    homeBridgeUrl,
    bridgeTransportPreferences,
    bridgeTransportTruth,
    bridgeMemory,
    bridgeMemoryRehydrated,
    bridgeAutoRevalidation,
    homeNodeStatus,
    sessionRestoreDiagnostics,
    lastExecutionMetadata,
    apiStatus,
    runtimeStatusModel,
    uiDiagnostics,
    setDebugVisible,
    togglePanel,
    setPanelState,
    setPaneOrder,
    setMissionDashboardUiState,
    setProvider,
    setRouteMode,
    setDevMode,
    setFallbackEnabled,
    setDisableHomeNodeForLocalSession,
    setOllamaConnection,
    setSurfaceOverride,
    reportSurfaceFriction,
    clearSurfaceFrictionEvents,
    acceptSurfaceRecommendation,
    rejectSurfaceRecommendation,
    revertSurfaceRule,
    explainMemoryToOperator,
    setHomeNodePreference,
    setHomeNodeLastKnown,
    saveHomeBridgeUrl,
    clearHomeBridgeUrl,
    setHomeNodeStatus,
    setBridgeTransportSelection,
    updateBridgeTransportConfig,
    rememberSuccessfulOllamaConnection,
    getDraftProviderConfig,
    getEffectiveProviderConfig,
    getEffectiveProviderConfigs,
    getActiveProviderConfig,
    getSavedProviderConfig,
    getActiveProviderConfigSource,
    updateDraftProviderConfig,
    saveDraftProviderConfig,
    revertDraftProviderConfig,
    resetProviderConfig,
    setMissionPacketWorkflow,
  ]);

  return createElement(AIStoreContext.Provider, { value }, children);
}

export function useAIStore() {
  const context = useContext(AIStoreContext);
  if (!context) throw new Error('useAIStore must be used inside AIStoreProvider');
  return context;
}
