import { createContext, createElement, useContext, useMemo, useState } from 'react';
import {
  DEFAULT_PROVIDER_KEY,
  PROVIDER_DEFINITIONS,
  PROVIDER_KEYS,
  createDefaultSavedProviderConfigs,
  normalizeProviderDraft,
  normalizeProviderSelection,
  validateProviderDraft,
} from '../ai/providerConfig';

const AIStoreContext = createContext(null);

const PROVIDER_STORAGE_KEY = 'stephanos.ai.provider';
const CUSTOM_PROVIDER_STORAGE_KEY = 'stephanos.ai.customConfig';

function getStoredProviderState() {
  if (typeof window === 'undefined') {
    return {
      provider: DEFAULT_PROVIDER_KEY,
      source: 'default:ssr',
    };
  }

  const stored = localStorage.getItem(PROVIDER_STORAGE_KEY);
  if (PROVIDER_KEYS.includes(stored)) {
    return {
      provider: stored,
      source: 'saved:localStorage',
    };
  }

  return {
    provider: DEFAULT_PROVIDER_KEY,
    source: 'default:fresh-start',
  };
}

function getStoredSavedProviderConfigs() {
  const defaults = createDefaultSavedProviderConfigs();
  if (typeof window === 'undefined') {
    return {
      savedProviderConfigs: defaults,
      customConfigSource: 'default:ssr',
    };
  }

  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_PROVIDER_STORAGE_KEY) || '{}');
    const hasCustomOverrides = Object.keys(parsed || {}).length > 0;

    return {
      savedProviderConfigs: {
        ...defaults,
        custom: {
          ...defaults.custom,
          ...parsed,
          apiKey: '',
        },
      },
      customConfigSource: hasCustomOverrides ? 'saved:localStorage' : 'default:fresh-start',
    };
  } catch {
    return {
      savedProviderConfigs: defaults,
      customConfigSource: 'default:parse-fallback',
    };
  }
}

function persistCustomSavedConfig(savedConfig) {
  if (typeof window === 'undefined') return;
  const { apiKey: _apiKey, ...safeToPersist } = savedConfig;
  localStorage.setItem(CUSTOM_PROVIDER_STORAGE_KEY, JSON.stringify(safeToPersist));
}

export function AIStoreProvider({ children }) {
  const initialProviderState = getStoredProviderState();
  const initialSavedConfigState = getStoredSavedProviderConfigs();

  const [commandHistory, setCommandHistory] = useState([]);
  const [status, setStatus] = useState('idle');
  const [isBusy, setIsBusy] = useState(false);
  const [lastRoute, setLastRoute] = useState('assistant');
  const [debugVisible, setDebugVisible] = useState(false);
  const [debugData, setDebugData] = useState({});
  const [provider, setProviderState] = useState(initialProviderState.provider);
  const [providerSelectionSource, setProviderSelectionSource] = useState(initialProviderState.source);
  const [savedProviderConfigs, setSavedProviderConfigs] = useState(initialSavedConfigState.savedProviderConfigs);
  const [customConfigSource, setCustomConfigSource] = useState(initialSavedConfigState.customConfigSource);
  const [draftProviderConfigs, setDraftProviderConfigs] = useState(() => ({
    custom: { ...initialSavedConfigState.savedProviderConfigs.custom },
  }));
  const [providerDraftStatus, setProviderDraftStatus] = useState({
    custom: {
      mode: 'saved',
      message: '',
      savedAt: null,
      errors: {},
    },
  });
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
    lastCheckedAt: null,
    meta: null,
  });

  const setProvider = (nextProvider) => {
    const resolvedProvider = normalizeProviderSelection(nextProvider);
    if (!PROVIDER_DEFINITIONS[resolvedProvider]) return;

    setProviderState(resolvedProvider);
    setProviderSelectionSource('saved:user-selection');
    if (typeof window !== 'undefined') {
      localStorage.setItem(PROVIDER_STORAGE_KEY, resolvedProvider);
    }
  };

  const getDraftProviderConfig = (providerKey) => {
    if (PROVIDER_DEFINITIONS[providerKey]?.editable) {
      return draftProviderConfigs[providerKey] || { ...savedProviderConfigs[providerKey] };
    }
    return savedProviderConfigs[providerKey];
  };

  const getActiveProviderConfig = () => {
    const providerConfig = savedProviderConfigs[provider];
    return normalizeProviderDraft(provider, providerConfig);
  };

  const getSavedProviderConfig = (providerKey) => normalizeProviderDraft(
    providerKey,
    savedProviderConfigs[providerKey],
  );

  const getActiveProviderConfigSource = () => {
    if (provider === 'custom') {
      return customConfigSource;
    }

    return 'default:canonical';
  };

  const updateDraftProviderConfig = (providerKey, patch) => {
    if (!PROVIDER_DEFINITIONS[providerKey]?.editable) return;

    setDraftProviderConfigs((prev) => ({
      ...prev,
      [providerKey]: {
        ...getDraftProviderConfig(providerKey),
        ...patch,
      },
    }));

    setProviderDraftStatus((prev) => ({
      ...prev,
      [providerKey]: {
        ...prev[providerKey],
        mode: 'draft',
        message: '',
        errors: {},
      },
    }));
  };

  const saveDraftProviderConfig = (providerKey) => {
    if (!PROVIDER_DEFINITIONS[providerKey]?.editable) {
      return { ok: true };
    }

    const normalizedDraft = normalizeProviderDraft(providerKey, getDraftProviderConfig(providerKey));
    const validation = validateProviderDraft(providerKey, normalizedDraft);
    if (!validation.isValid) {
      setProviderDraftStatus((prev) => ({
        ...prev,
        [providerKey]: {
          ...prev[providerKey],
          mode: 'draft',
          message: 'Fix validation errors before saving.',
          errors: validation.errors,
        },
      }));
      return { ok: false, errors: validation.errors };
    }

    const savedAt = new Date().toISOString();
    setSavedProviderConfigs((prev) => ({
      ...prev,
      [providerKey]: normalizedDraft,
    }));
    setDraftProviderConfigs((prev) => ({
      ...prev,
      [providerKey]: normalizedDraft,
    }));

    if (providerKey === 'custom') {
      persistCustomSavedConfig(normalizedDraft);
      setCustomConfigSource('saved:user-config');
    }

    setProviderDraftStatus((prev) => ({
      ...prev,
      [providerKey]: {
        mode: 'saved',
        message: 'Custom provider settings saved.',
        savedAt,
        errors: {},
      },
    }));

    return { ok: true, savedAt };
  };

  const revertDraftProviderConfig = (providerKey) => {
    if (!PROVIDER_DEFINITIONS[providerKey]?.editable) return;
    const savedConfig = savedProviderConfigs[providerKey];
    setDraftProviderConfigs((prev) => ({
      ...prev,
      [providerKey]: { ...savedConfig, apiKey: '' },
    }));
    setProviderDraftStatus((prev) => ({
      ...prev,
      [providerKey]: {
        ...prev[providerKey],
        mode: 'saved',
        message: 'Draft reverted to last saved values.',
        errors: {},
      },
    }));
  };

  const resetProviderConfig = (providerKey) => {
    const defaultConfig = { ...PROVIDER_DEFINITIONS[providerKey].defaults, apiKey: '' };

    setSavedProviderConfigs((prev) => ({
      ...prev,
      [providerKey]: defaultConfig,
    }));

    if (PROVIDER_DEFINITIONS[providerKey]?.editable) {
      setDraftProviderConfigs((prev) => ({
        ...prev,
        [providerKey]: defaultConfig,
      }));
    }

    if (providerKey === 'custom') {
      persistCustomSavedConfig(defaultConfig);
      setCustomConfigSource('default:reset');
    }

    setProviderDraftStatus((prev) => ({
      ...prev,
      [providerKey]: {
        ...prev[providerKey],
        mode: 'saved',
        message: `${PROVIDER_DEFINITIONS[providerKey].label} settings reset to defaults.`,
        errors: {},
      },
    }));
  };

  const isDraftDirty = (providerKey) => {
    if (!PROVIDER_DEFINITIONS[providerKey]?.editable) return false;
    return JSON.stringify(getDraftProviderConfig(providerKey)) !== JSON.stringify(savedProviderConfigs[providerKey]);
  };

  const value = useMemo(
    () => ({
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
      savedProviderConfigs,
      draftProviderConfigs,
      providerDraftStatus,
      customConfigSource,
      getDraftProviderConfig,
      getActiveProviderConfig,
      getSavedProviderConfig,
      getActiveProviderConfigSource,
      updateDraftProviderConfig,
      saveDraftProviderConfig,
      revertDraftProviderConfig,
      resetProviderConfig,
      isDraftDirty,
      apiStatus,
      setApiStatus,
      uiDiagnostics,
      setUiDiagnostics,
    }),
    [
      commandHistory,
      status,
      isBusy,
      lastRoute,
      debugVisible,
      debugData,
      provider,
      providerSelectionSource,
      savedProviderConfigs,
      draftProviderConfigs,
      providerDraftStatus,
      customConfigSource,
      apiStatus,
      uiDiagnostics,
    ],
  );

  return createElement(AIStoreContext.Provider, { value }, children);
}

export function useAIStore() {
  const context = useContext(AIStoreContext);
  if (!context) {
    throw new Error('useAIStore must be used inside AIStoreProvider');
  }
  return context;
}
