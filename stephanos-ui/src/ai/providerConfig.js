import {
  DEFAULT_PROVIDER_KEY,
  PROVIDER_DEFINITIONS,
  PROVIDER_KEYS,
  buildProviderDisplayLabel,
  buildProviderEndpoint,
  createDefaultSavedProviderConfigs,
  normalizeProviderSelection,
} from '../../../shared/ai/providerDefaults.mjs';

export {
  DEFAULT_PROVIDER_KEY,
  PROVIDER_DEFINITIONS,
  PROVIDER_KEYS,
  buildProviderDisplayLabel,
  buildProviderEndpoint,
  createDefaultSavedProviderConfigs,
  normalizeProviderSelection,
};

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

export function normalizeProviderDraft(providerKey, draftConfig = {}) {
  const defaults = PROVIDER_DEFINITIONS[providerKey]?.defaults || {};

  if (providerKey !== 'custom') {
    return {
      ...defaults,
      ...draftConfig,
    };
  }

  return {
    ...defaults,
    ...draftConfig,
    label: draftConfig.label?.trim() || defaults.label,
    baseUrl: draftConfig.baseUrl?.trim() || '',
    chatEndpoint: draftConfig.chatEndpoint?.trim() || defaults.chatEndpoint,
    model: draftConfig.model?.trim() || '',
    apiKey: draftConfig.apiKey || '',
    headersJson: draftConfig.headersJson?.trim() || '',
  };
}

export function buildProviderStatusSummary(providerKey, config, apiBaseUrl) {
  const providerLabel = buildProviderDisplayLabel(providerKey, config);
  const providerDefinition = PROVIDER_DEFINITIONS[providerKey];
  const endpoint = buildProviderEndpoint(config?.baseUrl || '', config?.chatEndpoint || '');

  return {
    providerLabel,
    providerKey,
    providerTarget: providerDefinition?.targetSummary || 'routed via Stephanos backend',
    providerEndpoint: endpoint,
    apiBaseUrl: apiBaseUrl || 'n/a',
    model: config?.model || 'server default',
  };
}
