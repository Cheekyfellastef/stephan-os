// LIVE SOURCE OF TRUTH: this store backs the served Stephanos AI router/settings UI.
// Update provider state here, then rebuild stephanos-ui to refresh apps/stephanos/dist.
import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';
import {
  AI_SETTINGS_STORAGE_KEY,
  DEFAULT_PROVIDER_KEY,
  PROVIDER_DEFINITIONS,
  PROVIDER_KEYS,
  createDefaultRouterSettings,
  normalizeFallbackOrder,
  normalizeProviderDraft,
  normalizeProviderSelection,
  sanitizeConfigForStorage,
  validateProviderDraft,
} from '../ai/providerConfig';

const AIStoreContext = createContext(null);
const STEPHANOS_UI_LAYOUT_STORAGE_KEY = 'stephanos_ui_layout';
const DEFAULT_UI_LAYOUT = {
  memoryPanel: true,
  statusPanel: true,
  debugConsole: false,
  commandDeck: true,
};
const DEFAULT_OLLAMA_CONNECTION = {
  lastSuccessfulBaseURL: '',
  lastSuccessfulHost: '',
  recentHosts: [],
  pcAddressHint: '',
  lastSelectedModel: '',
};

function normalizeUiLayout(value = {}) {
  return {
    memoryPanel: value.memoryPanel !== false,
    statusPanel: value.statusPanel !== false,
    debugConsole: value.debugConsole === true,
    commandDeck: value.commandDeck !== false,
  };
}

function readLocalStorageJson(key, fallback) {
  if (typeof window === 'undefined') return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeLocalStorageJson(key, value) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures so the UI remains usable in restricted contexts.
  }
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

function getStoredSettings() {
  const defaults = createDefaultRouterSettings();
  if (typeof window === 'undefined') return { ...defaults, ollamaConnection: DEFAULT_OLLAMA_CONNECTION };

  try {
    const parsed = JSON.parse(localStorage.getItem(AI_SETTINGS_STORAGE_KEY) || '{}');
    return {
      ...defaults,
      provider: normalizeProviderSelection(parsed.provider),
      devMode: parsed.devMode !== false,
      fallbackEnabled: parsed.fallbackEnabled !== false,
      fallbackOrder: normalizeFallbackOrder(parsed.fallbackOrder),
      providerConfigs: Object.fromEntries(
        PROVIDER_KEYS.map((key) => [key, normalizeProviderDraft(key, {
          ...defaults.providerConfigs[key],
          ...(parsed.providerConfigs?.[key] || {}),
          apiKey: '',
        })]),
      ),
      ollamaConnection: normalizeOllamaConnection(parsed.ollamaConnection || {}),
    };
  } catch {
    return { ...defaults, ollamaConnection: DEFAULT_OLLAMA_CONNECTION };
  }
}

function getStoredUiLayout() {
  return normalizeUiLayout(readLocalStorageJson(STEPHANOS_UI_LAYOUT_STORAGE_KEY, DEFAULT_UI_LAYOUT));
}

function persistSettings(state) {
  writeLocalStorageJson(AI_SETTINGS_STORAGE_KEY, {
    provider: state.provider,
    devMode: state.devMode,
    fallbackEnabled: state.fallbackEnabled,
    fallbackOrder: state.fallbackOrder,
    providerConfigs: sanitizeConfigForStorage(state.providerConfigs),
    ollamaConnection: normalizeOllamaConnection(state.ollamaConnection),
  });
}

function persistUiLayout(uiLayout) {
  writeLocalStorageJson(STEPHANOS_UI_LAYOUT_STORAGE_KEY, normalizeUiLayout(uiLayout));
}

export function AIStoreProvider({ children }) {
  const initialSettings = getStoredSettings();
  const [commandHistory, setCommandHistory] = useState([]);
  const [status, setStatus] = useState('idle');
  const [isBusy, setIsBusy] = useState(false);
  const [lastRoute, setLastRoute] = useState('assistant');
  const [uiLayout, setUiLayout] = useState(() => getStoredUiLayout());
  const [debugVisible, setDebugVisibleState] = useState(() => getStoredUiLayout().debugConsole);
  const [debugData, setDebugData] = useState({});
  const [provider, setProviderState] = useState(initialSettings.provider);
  const [providerSelectionSource, setProviderSelectionSource] = useState('default:free-tier');
  const [devMode, setDevModeState] = useState(initialSettings.devMode);
  const [fallbackEnabled, setFallbackEnabledState] = useState(initialSettings.fallbackEnabled);
  const [fallbackOrder, setFallbackOrderState] = useState(initialSettings.fallbackOrder);
  const [savedProviderConfigs, setSavedProviderConfigs] = useState(initialSettings.providerConfigs);
  const [draftProviderConfigs, setDraftProviderConfigs] = useState(initialSettings.providerConfigs);
  const [providerDraftStatus, setProviderDraftStatus] = useState(Object.fromEntries(PROVIDER_KEYS.map((key) => [key, { mode: 'saved', message: '', savedAt: null, errors: {} }] )));
  const [providerHealth, setProviderHealth] = useState({});
  const [ollamaConnection, setOllamaConnectionState] = useState(initialSettings.ollamaConnection || DEFAULT_OLLAMA_CONNECTION);
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
    target: 'local',
    baseUrl: '',
    frontendOrigin: '',
    strategy: 'default:local-stephanos-backend',
    backendTargetEndpoint: '',
    healthEndpoint: '',
    backendReachable: false,
    backendDefaultProvider: DEFAULT_PROVIDER_KEY,
    lastCheckedAt: null,
    meta: null,
  });

  const persistCurrentState = (next = {}) => persistSettings({
    provider,
    devMode,
    fallbackEnabled,
    fallbackOrder,
    providerConfigs: savedProviderConfigs,
    ollamaConnection,
    ...next,
  });

  useEffect(() => {
    persistUiLayout(uiLayout);
    setDebugVisibleState(uiLayout.debugConsole);
  }, [uiLayout]);

  const updateUiLayout = (updater) => {
    setUiLayout((prev) => {
      const candidate = typeof updater === 'function' ? updater(prev) : updater;
      return normalizeUiLayout(candidate);
    });
  };

  const setDebugVisible = (nextVisible) => {
    updateUiLayout((prev) => ({
      ...prev,
      debugConsole: typeof nextVisible === 'function' ? nextVisible(prev.debugConsole) : nextVisible,
    }));
  };

  const setPanelState = (panelId, isOpen) => {
    if (!(panelId in DEFAULT_UI_LAYOUT)) return;

    updateUiLayout((prev) => ({
      ...prev,
      [panelId]: typeof isOpen === 'function' ? isOpen(prev[panelId]) : isOpen,
    }));
  };

  const togglePanel = (panelId) => {
    if (!(panelId in DEFAULT_UI_LAYOUT)) return;
    setPanelState(panelId, (prev) => !prev);
  };

  const setProvider = (nextProvider) => {
    const resolved = normalizeProviderSelection(nextProvider);
    setProviderState(resolved);
    setProviderSelectionSource('saved:user-selection');
    persistCurrentState({ provider: resolved });
  };

  const setDevMode = (next) => {
    setDevModeState(Boolean(next));
    persistCurrentState({ devMode: Boolean(next) });
  };

  const setFallbackEnabled = (next) => {
    setFallbackEnabledState(Boolean(next));
    persistCurrentState({ fallbackEnabled: Boolean(next) });
  };

  const setOllamaConnection = (patch = {}) => {
    const nextConnection = normalizeOllamaConnection({ ...ollamaConnection, ...patch });
    setOllamaConnectionState(nextConnection);
    persistCurrentState({ ollamaConnection: nextConnection });
    return nextConnection;
  };

  const rememberSuccessfulOllamaConnection = ({ baseURL = '', host = '', model = '' } = {}) => {
    const normalizedHost = String(host || '').trim();
    const nextConnection = normalizeOllamaConnection({
      ...ollamaConnection,
      lastSuccessfulBaseURL: baseURL || ollamaConnection.lastSuccessfulBaseURL,
      lastSuccessfulHost: normalizedHost || ollamaConnection.lastSuccessfulHost,
      lastSelectedModel: model || ollamaConnection.lastSelectedModel,
      recentHosts: [normalizedHost, ...(ollamaConnection.recentHosts || [])].filter(Boolean),
    });
    setOllamaConnectionState(nextConnection);
    persistCurrentState({ ollamaConnection: nextConnection });
    return nextConnection;
  };

  const resetToFreeMode = () => {
    const defaults = createDefaultRouterSettings();
    const sessionSafe = Object.fromEntries(PROVIDER_KEYS.map((key) => [key, { ...defaults.providerConfigs[key], apiKey: '' }]));
    const nextUiLayout = { ...DEFAULT_UI_LAYOUT };
    setProviderState(defaults.provider);
    setDevModeState(defaults.devMode);
    setFallbackEnabledState(defaults.fallbackEnabled);
    setFallbackOrderState(defaults.fallbackOrder);
    setSavedProviderConfigs(sessionSafe);
    setDraftProviderConfigs(sessionSafe);
    setOllamaConnectionState(DEFAULT_OLLAMA_CONNECTION);
    setProviderSelectionSource('default:free-tier');
    setUiLayout(nextUiLayout);
    setDebugVisibleState(nextUiLayout.debugConsole);
    persistSettings({ ...defaults, providerConfigs: sessionSafe, ollamaConnection: DEFAULT_OLLAMA_CONNECTION });
    persistUiLayout(nextUiLayout);
  };

  const getDraftProviderConfig = (providerKey) => draftProviderConfigs[providerKey];
  const getSavedProviderConfig = (providerKey) => savedProviderConfigs[providerKey];
  const getEffectiveProviderConfig = (providerKey) => (
    isDraftDirty(providerKey) ? draftProviderConfigs[providerKey] : savedProviderConfigs[providerKey]
  );
  const getEffectiveProviderConfigs = () => Object.fromEntries(
    PROVIDER_KEYS.map((key) => [key, getEffectiveProviderConfig(key)]),
  );
  const getActiveProviderConfig = () => getEffectiveProviderConfig(provider);
  const getActiveProviderConfigSource = () => (isDraftDirty(provider) ? 'draft:unsaved' : 'saved:session');

  const updateDraftProviderConfig = (providerKey, patch) => {
    setDraftProviderConfigs((prev) => ({
      ...prev,
      [providerKey]: normalizeProviderDraft(providerKey, { ...prev[providerKey], ...patch }),
    }));
    setProviderDraftStatus((prev) => ({ ...prev, [providerKey]: { ...prev[providerKey], mode: 'draft', message: '', errors: {} } }));
  };

  const saveDraftProviderConfig = (providerKey) => {
    const draft = normalizeProviderDraft(providerKey, draftProviderConfigs[providerKey]);
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
    persistCurrentState({ providerConfigs: nextSaved, ollamaConnection: nextConnection });
    return { ok: true, savedAt };
  };

  const revertDraftProviderConfig = (providerKey) => {
    setDraftProviderConfigs((prev) => ({ ...prev, [providerKey]: savedProviderConfigs[providerKey] }));
    setProviderDraftStatus((prev) => ({ ...prev, [providerKey]: { ...prev[providerKey], mode: 'saved', message: 'Draft reverted.', errors: {} } }));
  };

  const resetProviderConfig = (providerKey) => {
    const nextConfig = { ...PROVIDER_DEFINITIONS[providerKey].defaults, apiKey: '' };
    const nextSaved = { ...savedProviderConfigs, [providerKey]: nextConfig };
    setSavedProviderConfigs(nextSaved);
    setDraftProviderConfigs((prev) => ({ ...prev, [providerKey]: nextConfig }));
    setProviderDraftStatus((prev) => ({ ...prev, [providerKey]: { ...prev[providerKey], mode: 'saved', message: `${PROVIDER_DEFINITIONS[providerKey].label} reset.`, errors: {} } }));
    persistCurrentState({ providerConfigs: nextSaved });
  };

  const isDraftDirty = (providerKey) => JSON.stringify(draftProviderConfigs[providerKey]) !== JSON.stringify(savedProviderConfigs[providerKey]);

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
    togglePanel,
    setPanelState,
    provider,
    setProvider,
    providerSelectionSource,
    devMode,
    setDevMode,
    fallbackEnabled,
    setFallbackEnabled,
    fallbackOrder,
    setFallbackOrderState,
    savedProviderConfigs,
    draftProviderConfigs,
    providerDraftStatus,
    providerHealth,
    setProviderHealth,
    ollamaConnection,
    setOllamaConnection,
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
    provider,
    providerSelectionSource,
    devMode,
    fallbackEnabled,
    fallbackOrder,
    savedProviderConfigs,
    draftProviderConfigs,
    providerDraftStatus,
    providerHealth,
    ollamaConnection,
    lastExecutionMetadata,
    apiStatus,
    uiDiagnostics,
  ]);

  return createElement(AIStoreContext.Provider, { value }, children);
}

export function useAIStore() {
  const context = useContext(AIStoreContext);
  if (!context) throw new Error('useAIStore must be used inside AIStoreProvider');
  return context;
}
