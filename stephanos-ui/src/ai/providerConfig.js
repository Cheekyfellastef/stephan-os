import {
  AI_SETTINGS_STORAGE_KEY,
  DEFAULT_PROVIDER_KEY,
  DEFAULT_ROUTE_MODE,
  FALLBACK_PROVIDER_KEYS,
  PROVIDER_DEFINITIONS,
  PROVIDER_KEYS,
  buildProviderDisplayLabel,
  buildProviderEndpoint,
  createDefaultSavedProviderConfigs,
  createDefaultRouterSettings,
  normalizeFallbackOrder,
  normalizeProviderSelection,
  normalizeRouteMode,
  ROUTE_MODE_KEYS,
} from '../../../shared/ai/providerDefaults.mjs';

export {
  AI_SETTINGS_STORAGE_KEY,
  DEFAULT_PROVIDER_KEY,
  DEFAULT_ROUTE_MODE,
  FALLBACK_PROVIDER_KEYS,
  PROVIDER_DEFINITIONS,
  PROVIDER_KEYS,
  buildProviderDisplayLabel,
  buildProviderEndpoint,
  createDefaultSavedProviderConfigs,
  createDefaultRouterSettings,
  normalizeFallbackOrder,
  normalizeProviderSelection,
  normalizeRouteMode,
  ROUTE_MODE_KEYS,
};

export const NON_SECRET_PROVIDER_FIELDS = {
  mock: ['enabled', 'latencyMs', 'failRate', 'mode', 'model'],
  groq: ['baseURL', 'model'],
  gemini: ['baseURL', 'model'],
  ollama: ['baseURL', 'model', 'timeoutMs'],
  openrouter: ['baseURL', 'model', 'enabled'],
};

export function sanitizeConfigForStorage(providerConfigs = {}) {
  return Object.fromEntries(
    Object.entries(providerConfigs).map(([provider, config]) => [
      provider,
      Object.fromEntries(
        (NON_SECRET_PROVIDER_FIELDS[provider] || []).map((field) => [field, config?.[field] ?? PROVIDER_DEFINITIONS[provider]?.defaults?.[field]]),
      ),
    ]),
  );
}

export function normalizeProviderDraft(providerKey, draftConfig = {}) {
  const defaults = PROVIDER_DEFINITIONS[providerKey]?.defaults || {};
  return {
    ...defaults,
    ...draftConfig,
    apiKey: draftConfig.apiKey || '',
  };
}

export function validateProviderDraft(providerKey, draftConfig = {}) {
  const errors = {};
  const draft = normalizeProviderDraft(providerKey, draftConfig);

  if (['groq', 'ollama', 'openrouter'].includes(providerKey) && draft.baseURL) {
    try { new URL(draft.baseURL); } catch { errors.baseURL = 'Base URL must be a valid URL.'; }
  }

  if (providerKey === 'gemini' && draft.baseURL) {
    try { new URL(draft.baseURL); } catch { errors.baseURL = 'Gemini base URL must be a valid URL.'; }
  }

  if (providerKey === 'mock') {
    if (draft.failRate < 0 || draft.failRate > 1) errors.failRate = 'Fail rate must be between 0 and 1.';
    if (draft.latencyMs < 0) errors.latencyMs = 'Latency must be 0 or higher.';
  }

  if (['groq', 'gemini', 'ollama', 'openrouter'].includes(providerKey) && !String(draft.model || '').trim()) {
    errors.model = 'Model is required.';
  }

  return { isValid: Object.keys(errors).length === 0, errors };
}

export function buildProviderStatusSummary(providerKey, config, apiBaseUrl, health = null) {
  const providerDefinition = PROVIDER_DEFINITIONS[providerKey];
  return {
    providerLabel: buildProviderDisplayLabel(providerKey, config),
    providerKey,
    providerTarget: providerDefinition?.targetSummary || 'routed via Stephanos backend',
    providerEndpoint: config?.baseURL || 'Handled by Stephanos backend',
    apiBaseUrl: apiBaseUrl || 'n/a',
    model: config?.model || providerDefinition?.defaults?.model || 'default',
    healthBadge: health?.badge || 'Unknown',
    healthDetail: health?.message || health?.detail || 'Health not checked yet.',
    healthReason: health?.reason || '',
    healthState: health?.state || 'UNKNOWN',
    providerCapability: health?.providerCapability || null,
  };
}

function isLoopbackHostname(hostname = '') {
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(String(hostname || '').trim().toLowerCase());
}

function extractHostname(value = '') {
  try {
    return new URL(String(value || '')).hostname || '';
  } catch {
    return '';
  }
}

export function resolveProviderEndpointForDisplay({ providerKey, config, runtimeContext = {}, sessionRestoreDiagnostics = null } = {}) {
  const endpoint = String(config?.baseURL || '').trim();
  if (!endpoint) {
    return 'Handled by Stephanos backend';
  }

  const remoteSession = runtimeContext?.sessionKind === 'hosted-web' || runtimeContext?.frontendLocal === false;
  if (remoteSession && isLoopbackHostname(extractHostname(endpoint))) {
    if (sessionRestoreDiagnostics?.ignoredFields?.includes(`providerConfigs.${providerKey}.baseURL`)) {
      return 'Handled by Stephanos backend (saved localhost endpoint ignored on this device)';
    }

    return 'Handled by Stephanos backend (localhost kept server-internal)';
  }

  return endpoint;
}
