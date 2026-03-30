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
  clearPersistedStephanosHomeNode,
  isValidStephanosHomeNode,
  normalizeStephanosHomeNode,
  persistStephanosHomeNodePreference,
  persistStephanosLastKnownNode,
  readPersistedStephanosHomeNode,
  readPersistedStephanosLastKnownNode,
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
import { ensureRuntimeStatusModel } from './runtimeStatusDefaults';

const AIStoreContext = createContext(null);
const DEFAULT_UI_LAYOUT = {
  providerControlsPanel: true,
  commandDeck: true,
  statusPanel: true,
  toolsPanel: true,
  memoryPanel: true,
  knowledgeGraphPanel: true,
  simulationListPanel: true,
  simulationPanel: true,
  simulationHistoryPanel: true,
  proposalPanel: true,
  activityPanel: true,
  roadmapPanel: true,
  missionDashboardPanel: true,
  missionFingerprintPanel: true,
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
  'roadmapPanel',
  'missionDashboardPanel',
  'missionFingerprintPanel',
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
const MAX_PERSISTED_COMMANDS = 10;
const MAX_PERSISTED_OUTPUT_LENGTH = 4000;

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

  return {
    persistedSession,
    sessionRestoreDiagnostics: restoredSession.diagnostics,
    initialApiRuntimeContext: buildInitialRuntimeContext(initialApiRuntimeConfig, {
      sessionRestoreDiagnostics: restoredSession.diagnostics,
      homeNodePreference,
      homeNodeLastKnown,
    }),
    settings: normalizeStoredSettings(persistedSession),
    uiLayout: normalizeUiLayout(persistedSession?.session?.ui?.uiLayout || DEFAULT_UI_LAYOUT),
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
    },
    projectMemory: {
      ...defaults.project,
      ...(persistedSession?.project || {}),
    },
    homeNodePreference,
    homeNodeLastKnown,
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
  const [workingMemory, setWorkingMemory] = useState(initialSnapshot.workingMemory);
  const [projectMemory] = useState(initialSnapshot.projectMemory);
  const [homeNodePreference, setHomeNodePreferenceState] = useState(initialSnapshot.homeNodePreference);
  const [homeNodeLastKnown, setHomeNodeLastKnownState] = useState(initialSnapshot.homeNodeLastKnown);
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
    runtimeContext: apiStatus.runtimeContext || {
      frontendOrigin: apiStatus.frontendOrigin,
      apiBaseUrl: apiStatus.baseUrl,
      homeNode: apiStatus.runtimeContext?.homeNode || null,
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
  ]);

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
        },
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
    uiLayout,
    missionDashboardUiState,
    paneLayout,
    lastRoute,
    commandHistory,
    workingMemory,
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
    setOllamaConnectionState(DEFAULT_OLLAMA_CONNECTION);
    setWorkingMemory(nextWorkingMemory);
    setCommandHistory([]);
    setLastRoute(STEPHANOS_ACTIVE_SUBVIEW);
    setHomeNodePreferenceState(null);
    setHomeNodeLastKnownState(null);
    setHomeNodeStatusState(DEFAULT_HOME_NODE_STATUS);
    setProviderSelectionSource('default:free-tier');
    setUiLayout(nextUiLayout);
    setPaneLayout({ order: [...DEFAULT_OPERATOR_PANE_ORDER] });
    clearPersistedStephanosSessionMemory();
    clearPersistedStephanosHomeNode();
    persistStephanosLastKnownNode(null);
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
    workingMemory,
    setWorkingMemory,
    projectMemory,
    homeNodePreference,
    setHomeNodePreference,
    homeNodeLastKnown,
    setHomeNodeLastKnown,
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
    workingMemory,
    projectMemory,
    homeNodePreference,
    homeNodeLastKnown,
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
    setHomeNodePreference,
    setHomeNodeLastKnown,
    setHomeNodeStatus,
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
  ]);

  return createElement(AIStoreContext.Provider, { value }, children);
}

export function useAIStore() {
  const context = useContext(AIStoreContext);
  if (!context) throw new Error('useAIStore must be used inside AIStoreProvider');
  return context;
}
