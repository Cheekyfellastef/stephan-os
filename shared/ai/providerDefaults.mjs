export const DEFAULT_PROVIDER_KEY = 'ollama';
export const PROVIDER_KEYS = ['ollama', 'openai', 'custom'];

export const PROVIDER_DEFINITIONS = {
  ollama: {
    key: 'ollama',
    label: 'Local Ollama',
    kind: 'local',
    editable: false,
    targetSummary: 'routed via Stephanos backend',
    defaults: {
      label: 'Local Ollama',
      baseUrl: 'http://127.0.0.1:11434',
      chatEndpoint: '/api/chat',
      model: 'llama3',
      apiKey: '',
      headersJson: '',
    },
  },
  openai: {
    key: 'openai',
    label: 'OpenAI Cloud',
    kind: 'cloud',
    editable: false,
    targetSummary: 'routed via Stephanos backend',
    defaults: {
      label: 'OpenAI Cloud',
      baseUrl: '',
      chatEndpoint: '',
      model: '',
      apiKey: '',
      headersJson: '',
    },
  },
  custom: {
    key: 'custom',
    label: 'Custom LLM',
    kind: 'custom',
    editable: true,
    targetSummary: 'routed via Stephanos backend',
    defaults: {
      label: 'Custom LLM',
      baseUrl: '',
      chatEndpoint: '/v1/chat/completions',
      model: '',
      apiKey: '',
      headersJson: '',
    },
  },
};

export function createDefaultSavedProviderConfigs() {
  return Object.fromEntries(
    PROVIDER_KEYS.map((key) => [key, { ...PROVIDER_DEFINITIONS[key].defaults }]),
  );
}

export function normalizeProviderSelection(providerKey) {
  return PROVIDER_DEFINITIONS[providerKey] ? providerKey : DEFAULT_PROVIDER_KEY;
}

export function buildProviderDisplayLabel(providerKey, config) {
  if (providerKey === 'custom') {
    return config?.label?.trim() || PROVIDER_DEFINITIONS.custom.label;
  }

  return PROVIDER_DEFINITIONS[providerKey]?.label || providerKey;
}

export function buildProviderEndpoint(baseUrl = '', chatEndpoint = '') {
  if (!baseUrl) return chatEndpoint || 'n/a';
  if (!chatEndpoint) return baseUrl;
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const normalizedEndpoint = chatEndpoint.startsWith('/') ? chatEndpoint : `/${chatEndpoint}`;
  return `${normalizedBaseUrl}${normalizedEndpoint}`;
}
