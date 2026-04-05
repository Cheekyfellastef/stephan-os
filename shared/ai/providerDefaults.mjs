export const AI_SETTINGS_STORAGE_KEY = 'stephanos.ai.freeTierSettings';
export const DEFAULT_PROVIDER_KEY = 'ollama';
export const PROVIDER_KEYS = ['mock', 'groq', 'gemini', 'ollama', 'openrouter'];
export const LOCAL_PROVIDER_KEYS = ['ollama'];
export const CLOUD_PROVIDER_KEYS = ['groq', 'gemini', 'openrouter'];
export const ROUTE_MODE_KEYS = ['auto', 'local-first', 'cloud-first', 'explicit'];
export const DEFAULT_ROUTE_MODE = 'auto';
export const FALLBACK_PROVIDER_KEYS = ['groq', 'gemini', 'mock', 'ollama'];
export const LOCAL_FIRST_PROVIDER_KEYS = ['ollama', 'groq', 'gemini', 'mock'];
export const CLOUD_FIRST_PROVIDER_KEYS = ['groq', 'gemini', 'openrouter', 'mock', 'ollama'];

export const PROVIDER_DEFINITIONS = {
  mock: {
    key: 'mock',
    label: 'Mock (Free Dev Mode)',
    kind: 'mock',
    editable: true,
    paid: false,
    canAutoFallback: true,
    targetSummary: 'zero-cost local mock responses',
    defaults: {
      enabled: true,
      latencyMs: 500,
      failRate: 0,
      mode: 'echo',
      model: 'stephanos-mock-v1',
    },
  },
  groq: {
    key: 'groq',
    label: 'Groq',
    kind: 'cloud',
    editable: true,
    paid: false,
    canAutoFallback: true,
    targetSummary: 'cloud-backed Groq routed through the Stephanos backend',
    defaults: {
      baseURL: 'https://api.groq.com/openai/v1',
      model: 'openai/gpt-oss-20b',
      freshWebModel: null,
      freshWebModelCandidates: [],
      apiKey: '',
    },
  },
  gemini: {
    key: 'gemini',
    label: 'Gemini',
    kind: 'cloud',
    editable: true,
    paid: false,
    canAutoFallback: true,
    targetSummary: 'free-tier cloud via Gemini API',
    defaults: {
      model: 'gemini-2.5-flash',
      apiKey: '',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/models',
    },
  },
  ollama: {
    key: 'ollama',
    label: 'Ollama',
    kind: 'local',
    editable: true,
    paid: false,
    canAutoFallback: true,
    targetSummary: 'local/offline model engine',
    defaults: {
      baseURL: 'http://localhost:11434',
      model: 'qwen:14b',
      timeoutMs: 8000,
      defaultOllamaTimeoutMs: 8000,
      perModelTimeoutOverrides: {},
    },
  },
  openrouter: {
    key: 'openrouter',
    label: 'OpenRouter (Optional Paid)',
    kind: 'cloud',
    editable: true,
    paid: true,
    canAutoFallback: false,
    targetSummary: 'optional paid/fallback cloud routing',
    defaults: {
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-oss-20b',
      apiKey: '',
      enabled: false,
    },
  },
};

export function createDefaultSavedProviderConfigs() {
  return Object.fromEntries(
    PROVIDER_KEYS.map((key) => [key, { ...PROVIDER_DEFINITIONS[key].defaults }]),
  );
}

export function createDefaultRouterSettings() {
  return {
    provider: DEFAULT_PROVIDER_KEY,
    routeMode: DEFAULT_ROUTE_MODE,
    devMode: true,
    fallbackEnabled: true,
    disableHomeNodeForLocalSession: false,
    fallbackOrder: [...FALLBACK_PROVIDER_KEYS],
    providerConfigs: createDefaultSavedProviderConfigs(),
  };
}

export function normalizeProviderSelection(providerKey) {
  return PROVIDER_DEFINITIONS[providerKey] ? providerKey : DEFAULT_PROVIDER_KEY;
}

export function normalizeRouteMode(routeMode) {
  return ROUTE_MODE_KEYS.includes(routeMode) ? routeMode : DEFAULT_ROUTE_MODE;
}

export function normalizeFallbackOrder(order = []) {
  const filtered = Array.isArray(order)
    ? order.filter((key) => PROVIDER_KEYS.includes(key) && key !== 'openrouter')
    : [];

  return [...new Set([...filtered, ...FALLBACK_PROVIDER_KEYS])];
}

export function buildProviderDisplayLabel(providerKey, config) {
  if (providerKey === 'openrouter') return PROVIDER_DEFINITIONS.openrouter.label;
  return PROVIDER_DEFINITIONS[providerKey]?.label || providerKey;
}

export function buildProviderEndpoint(baseUrl = '', chatEndpoint = '') {
  if (!baseUrl) return chatEndpoint || 'n/a';
  if (!chatEndpoint) return baseUrl;
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const normalizedEndpoint = chatEndpoint.startsWith('/') ? chatEndpoint : `/${chatEndpoint}`;
  return `${normalizedBaseUrl}${normalizedEndpoint}`;
}
