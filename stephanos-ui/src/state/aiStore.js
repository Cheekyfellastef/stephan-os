import { createContext, createElement, useContext, useMemo, useState } from 'react';

const AIStoreContext = createContext(null);

const PROVIDER_STORAGE_KEY = 'stephanos.ai.provider';
const CUSTOM_PROVIDER_STORAGE_KEY = 'stephanos.ai.customConfig';

const DEFAULT_CUSTOM_PROVIDER_CONFIG = {
  label: 'Custom LLM',
  baseUrl: '',
  chatEndpoint: '/v1/chat/completions',
  model: '',
  apiKey: '',
  headersJson: '',
};

function getStoredProvider() {
  if (typeof window === 'undefined') return 'openai';
  const stored = localStorage.getItem(PROVIDER_STORAGE_KEY);
  return ['openai', 'ollama', 'custom'].includes(stored) ? stored : 'openai';
}

function getStoredCustomConfig() {
  if (typeof window === 'undefined') return DEFAULT_CUSTOM_PROVIDER_CONFIG;

  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_PROVIDER_STORAGE_KEY) || '{}');
    return {
      ...DEFAULT_CUSTOM_PROVIDER_CONFIG,
      ...parsed,
      apiKey: '',
    };
  } catch {
    return DEFAULT_CUSTOM_PROVIDER_CONFIG;
  }
}

export function AIStoreProvider({ children }) {
  const [commandHistory, setCommandHistory] = useState([]);
  const [status, setStatus] = useState('idle');
  const [isBusy, setIsBusy] = useState(false);
  const [lastRoute, setLastRoute] = useState('assistant');
  const [debugVisible, setDebugVisible] = useState(false);
  const [debugData, setDebugData] = useState({});
  const [provider, setProviderState] = useState(getStoredProvider);
  const [customProviderConfig, setCustomProviderConfig] = useState(getStoredCustomConfig);
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
  });

  const setProvider = (nextProvider) => {
    setProviderState(nextProvider);
    if (typeof window !== 'undefined') {
      localStorage.setItem(PROVIDER_STORAGE_KEY, nextProvider);
    }
  };

  const updateCustomProviderConfig = (patch) => {
    setCustomProviderConfig((prev) => {
      const next = { ...prev, ...patch };
      if (typeof window !== 'undefined') {
        const { apiKey: _apiKey, ...safeToPersist } = next;
        localStorage.setItem(CUSTOM_PROVIDER_STORAGE_KEY, JSON.stringify(safeToPersist));
      }
      return next;
    });
  };

  const resetCustomProviderConfig = () => {
    setCustomProviderConfig(DEFAULT_CUSTOM_PROVIDER_CONFIG);
    if (typeof window !== 'undefined') {
      const { apiKey: _apiKey, ...safeToPersist } = DEFAULT_CUSTOM_PROVIDER_CONFIG;
      localStorage.setItem(CUSTOM_PROVIDER_STORAGE_KEY, JSON.stringify(safeToPersist));
    }
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
      customProviderConfig,
      updateCustomProviderConfig,
      resetCustomProviderConfig,
      apiStatus,
      setApiStatus,
      uiDiagnostics,
      setUiDiagnostics,
    }),
    [commandHistory, status, isBusy, lastRoute, debugVisible, debugData, provider, customProviderConfig, apiStatus, uiDiagnostics],
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
