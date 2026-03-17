export const PROVIDER_KEYS = ['openai', 'ollama', 'custom'];

export const PROVIDER_DEFINITIONS = {
  openai: {
    key: 'openai',
    label: 'OpenAI Cloud',
    kind: 'cloud',
    editable: false,
    defaults: {
      label: 'OpenAI Cloud',
      baseUrl: '',
      chatEndpoint: '',
      model: '',
      apiKey: '',
      headersJson: '',
    },
  },
  ollama: {
    key: 'ollama',
    label: 'Local Ollama',
    kind: 'local',
    editable: false,
    defaults: {
      label: 'Local Ollama',
      baseUrl: 'http://localhost:11434',
      chatEndpoint: '/api/chat',
      model: 'llama3',
      apiKey: '',
      headersJson: '',
    },
  },
  custom: {
    key: 'custom',
    label: 'Custom LLM',
    kind: 'custom',
    editable: true,
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
  return {
    openai: { ...PROVIDER_DEFINITIONS.openai.defaults },
    ollama: { ...PROVIDER_DEFINITIONS.ollama.defaults },
    custom: { ...PROVIDER_DEFINITIONS.custom.defaults },
  };
}

export function validateProviderDraft(providerKey, draftConfig) {
  if (providerKey !== 'custom') {
    return { isValid: true, errors: {} };
  }

  const errors = {};
  const baseUrl = draftConfig.baseUrl?.trim();
  const chatEndpoint = draftConfig.chatEndpoint?.trim();

  if (!baseUrl) {
    errors.baseUrl = 'Base URL is required.';
  } else {
    try {
      const parsed = new URL(baseUrl);
      if (!parsed.protocol.startsWith('http')) {
        errors.baseUrl = 'Base URL must start with http:// or https://.';
      }
    } catch {
      errors.baseUrl = 'Base URL must be a valid URL (example: http://localhost:1234).';
    }
  }

  if (draftConfig.headersJson?.trim()) {
    try {
      const parsed = JSON.parse(draftConfig.headersJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        errors.headersJson = 'Headers JSON must be an object.';
      }
    } catch (error) {
      errors.headersJson = `Headers JSON is invalid: ${error.message}`;
    }
  }

  if (chatEndpoint && !chatEndpoint.startsWith('/')) {
    errors.chatEndpoint = 'Chat endpoint must start with / (example: /v1/chat/completions).';
  }

  if (!draftConfig.model?.trim()) {
    errors.model = 'Model name is required.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export function normalizeProviderDraft(providerKey, draftConfig) {
  if (providerKey !== 'custom') {
    return { ...draftConfig };
  }

  return {
    ...draftConfig,
    label: draftConfig.label?.trim() || PROVIDER_DEFINITIONS.custom.defaults.label,
    baseUrl: draftConfig.baseUrl?.trim() || '',
    chatEndpoint: draftConfig.chatEndpoint?.trim() || PROVIDER_DEFINITIONS.custom.defaults.chatEndpoint,
    model: draftConfig.model?.trim() || '',
    apiKey: draftConfig.apiKey || '',
    headersJson: draftConfig.headersJson?.trim() || '',
  };
}

export function buildProviderDisplayLabel(providerKey, config) {
  if (providerKey === 'custom') {
    return config?.label?.trim() || PROVIDER_DEFINITIONS.custom.label;
  }

  return PROVIDER_DEFINITIONS[providerKey]?.label || providerKey;
}
