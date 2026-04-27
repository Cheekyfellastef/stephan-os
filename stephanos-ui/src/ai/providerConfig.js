import {
  AI_SETTINGS_STORAGE_KEY,
  DEFAULT_PROVIDER_KEY,
  DEFAULT_ROUTE_MODE,
  DEFAULT_STREAMING_MODE,
  DEFAULT_OLLAMA_LOAD_MODE,
  FALLBACK_PROVIDER_KEYS,
  PROVIDER_DEFINITIONS,
  PROVIDER_KEYS,
  buildProviderDisplayLabel,
  buildProviderEndpoint,
  createDefaultSavedProviderConfigs,
  createDefaultHostedCloudCognitionSettings,
  createDefaultRouterSettings,
  HOSTED_COGNITION_PROVIDER_KEYS,
  normalizeFallbackOrder,
  normalizeProviderSelection,
  normalizeRouteMode,
  ROUTE_MODE_KEYS,
  STREAMING_MODE_KEYS,
  OLLAMA_LOAD_MODE_KEYS,
  normalizeStreamingMode,
  normalizeOllamaLoadMode,
} from '../../../shared/ai/providerDefaults.mjs';

export {
  AI_SETTINGS_STORAGE_KEY,
  DEFAULT_PROVIDER_KEY,
  DEFAULT_ROUTE_MODE,
  DEFAULT_STREAMING_MODE,
  DEFAULT_OLLAMA_LOAD_MODE,
  FALLBACK_PROVIDER_KEYS,
  PROVIDER_DEFINITIONS,
  PROVIDER_KEYS,
  buildProviderDisplayLabel,
  buildProviderEndpoint,
  createDefaultSavedProviderConfigs,
  createDefaultHostedCloudCognitionSettings,
  createDefaultRouterSettings,
  HOSTED_COGNITION_PROVIDER_KEYS,
  normalizeFallbackOrder,
  normalizeProviderSelection,
  normalizeRouteMode,
  ROUTE_MODE_KEYS,
  STREAMING_MODE_KEYS,
  OLLAMA_LOAD_MODE_KEYS,
  normalizeStreamingMode,
  normalizeOllamaLoadMode,
};

export const NON_SECRET_PROVIDER_FIELDS = {
  mock: ['enabled', 'latencyMs', 'failRate', 'mode', 'model'],
  groq: ['baseURL', 'model', 'freshWebModel', 'freshWebModelCandidates'],
  gemini: ['baseURL', 'model'],
  ollama: ['baseURL', 'model', 'timeoutMs', 'defaultOllamaTimeoutMs', 'perModelTimeoutOverrides'],
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
  const sourceDraft = draftConfig && typeof draftConfig === 'object' ? draftConfig : {};
  const normalizedDraft = {
    ...defaults,
    ...sourceDraft,
  };
  if (providerKey === 'ollama') {
    const hasExplicitDefaultTimeout = Object.prototype.hasOwnProperty.call(sourceDraft, 'defaultOllamaTimeoutMs');
    const migratedDefaultTimeout = Number(
      hasExplicitDefaultTimeout
        ? sourceDraft.defaultOllamaTimeoutMs
        : (sourceDraft.timeoutMs ?? normalizedDraft.timeoutMs),
    );
    normalizedDraft.defaultOllamaTimeoutMs = Number.isFinite(migratedDefaultTimeout) && migratedDefaultTimeout > 0
      ? migratedDefaultTimeout
      : Number(defaults.defaultOllamaTimeoutMs ?? defaults.timeoutMs ?? 8000);
    normalizedDraft.timeoutMs = normalizedDraft.defaultOllamaTimeoutMs;
    normalizedDraft.perModelTimeoutOverrides = normalizedDraft.perModelTimeoutOverrides
      && typeof normalizedDraft.perModelTimeoutOverrides === 'object'
      ? { ...normalizedDraft.perModelTimeoutOverrides }
      : {};
  }
  return {
    ...normalizedDraft,
    apiKey: sourceDraft.apiKey || '',
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

  if (providerKey === 'ollama') {
    const defaultTimeout = Number(draft.defaultOllamaTimeoutMs ?? draft.timeoutMs);
    if (!Number.isFinite(defaultTimeout) || defaultTimeout < 1000) {
      errors.defaultOllamaTimeoutMs = 'Default timeout must be at least 1000ms.';
    }

    const overrides = draft.perModelTimeoutOverrides && typeof draft.perModelTimeoutOverrides === 'object'
      ? draft.perModelTimeoutOverrides
      : {};
    for (const [model, timeoutValue] of Object.entries(overrides)) {
      if (timeoutValue == null || timeoutValue === '') continue;
      const timeoutMs = Number(timeoutValue);
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
        errors[`perModelTimeoutOverrides.${model}`] = `${model} override must be at least 1000ms.`;
      }
    }
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
