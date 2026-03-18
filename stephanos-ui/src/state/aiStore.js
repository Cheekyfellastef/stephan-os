import { createContext, createElement, useContext, useMemo, useState } from 'react';
import {
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
const SETTINGS_STORAGE_KEY = 'stephanos.ai.freeTierSettings';

function getStoredSettings() {
  const defaults = createDefaultRouterSettings();
  if (typeof window === 'undefined') return defaults;

  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
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
    };
  } catch {
    return defaults;
  }
}

function persistSettings(state) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
    provider: state.provider,
    devMode: state.devMode,
    fallbackEnabled: state.fallbackEnabled,
    fallbackOrder: state.fallbackOrder,
    providerConfigs: sanitizeConfigForStorage(state.providerConfigs),
  }));
}

export function AIStoreProvider({ children }) {
  const initialSettings = getStoredSettings();
  const [commandHistory, setCommandHistory] = useState([]);
  const [status, setStatus] = useState('idle');
  const [isBusy, setIsBusy] = useState(false);
  const [lastRoute, setLastRoute] = useState('assistant');
  const [debugVisible, setDebugVisible] = useState(false);
  const [debugData, setDebugData] = useState({});
  const [provider, setProviderState] = useState(initialSettings.provider);
  const [providerSelectionSource, setProviderSelectionSource] = useState('default:free-tier');
  const [devMode, setDevModeState] = useState(initialSettings.devMode);
  const [fallbackEnabled, setFallbackEnabledState] = useState(initialSettings.fallbackEnabled);
  const [fallbackOrder, setFallbackOrderState] = useState(initialSettings.fallbackOrder);
  const [savedProviderConfigs, setSavedProviderConfigs] = useState(initialSettings.providerConfigs);
  const [draftProviderConfigs, setDraftProviderConfigs] = useState(initialSettings.providerConfigs);
  const [providerDraftStatus, setProviderDraftStatus] = useState(Object.fromEntries(PROVIDER_KEYS.map((key) => [key, { mode: 'saved', message: '', savedAt: null, errors: {} }])));
  const [providerHealth, setProviderHealth] = useState({});
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
    ...next,
  });

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

  const resetToFreeMode = () => {
    const defaults = createDefaultRouterSettings();
    const sessionSafe = Object.fromEntries(PROVIDER_KEYS.map((key) => [key, { ...defaults.providerConfigs[key], apiKey: '' }]));
    setProviderState(defaults.provider);
    setDevModeState(defaults.devMode);
    setFallbackEnabledState(defaults.fallbackEnabled);
    setFallbackOrderState(defaults.fallbackOrder);
    setSavedProviderConfigs(sessionSafe);
    setDraftProviderConfigs(sessionSafe);
    persistSettings({ ...defaults, providerConfigs: sessionSafe });
  };

  const getDraftProviderConfig = (providerKey) => draftProviderConfigs[providerKey];
  const getSavedProviderConfig = (providerKey) => savedProviderConfigs[providerKey];
  const getActiveProviderConfig = () => savedProviderConfigs[provider];
  const getActiveProviderConfigSource = () => 'saved:session';

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
    setSavedProviderConfigs(nextSaved);
    setDraftProviderConfigs((prev) => ({ ...prev, [providerKey]: draft }));
    const savedAt = new Date().toISOString();
    setProviderDraftStatus((prev) => ({ ...prev, [providerKey]: { mode: 'saved', message: `${PROVIDER_DEFINITIONS[providerKey].label} settings applied.`, savedAt, errors: {} } }));
    persistCurrentState({ providerConfigs: nextSaved });
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
    getDraftProviderConfig,
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
    provider,
    providerSelectionSource,
    devMode,
    fallbackEnabled,
    fallbackOrder,
    savedProviderConfigs,
    draftProviderConfigs,
    providerDraftStatus,
    providerHealth,
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
