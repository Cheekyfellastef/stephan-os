import { PROVIDER_DEFINITIONS, normalizeFallbackOrder, normalizeProviderSelection } from '../../../../shared/ai/providerDefaults.mjs';

export function normalizeMessages(messages = [], prompt = '') {
  if (Array.isArray(messages) && messages.length > 0) return messages;
  return [{ role: 'user', content: prompt || '' }];
}

export function buildAIRequest({ prompt = '', messages = [], systemPrompt, model, temperature, maxTokens, stream = false } = {}) {
  return {
    messages: normalizeMessages(messages, prompt).map((message) => ({
      role: ['system', 'user', 'assistant'].includes(message?.role) ? message.role : 'user',
      content: String(message?.content ?? ''),
    })),
    systemPrompt: systemPrompt?.trim() || undefined,
    model: model?.trim() || undefined,
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : undefined,
    maxTokens: Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : undefined,
    stream: Boolean(stream),
  };
}

function getEnvBackedDefaults(provider) {
  const defaults = PROVIDER_DEFINITIONS[provider]?.defaults || {};
  const envMap = {
    groq: { apiKey: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL, baseURL: process.env.GROQ_BASE_URL },
    gemini: { apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL, baseURL: process.env.GEMINI_BASE_URL },
    ollama: { baseURL: process.env.OLLAMA_BASE_URL, model: process.env.OLLAMA_MODEL, timeoutMs: process.env.OLLAMA_TIMEOUT_MS },
    openrouter: { apiKey: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL, baseURL: process.env.OPENROUTER_BASE_URL },
  };

  return {
    ...defaults,
    ...Object.fromEntries(Object.entries(envMap[provider] || {}).filter(([, value]) => value != null && value !== '')),
  };
}

export function sanitizeProviderConfig(provider, config = {}) {
  const defaults = getEnvBackedDefaults(provider);
  const merged = { ...defaults, ...(config || {}) };

  if ('apiKey' in merged) merged.apiKey = String(merged.apiKey || '');
  if ('baseURL' in merged) merged.baseURL = String(merged.baseURL || '').trim();
  if ('model' in merged) merged.model = String(merged.model || '').trim();
  if ('latencyMs' in merged) merged.latencyMs = Math.max(0, Number(merged.latencyMs) || defaults.latencyMs || 0);
  if ('failRate' in merged) merged.failRate = Math.max(0, Math.min(1, Number(merged.failRate) || 0));
  if ('timeoutMs' in merged) merged.timeoutMs = Math.max(1000, Number(merged.timeoutMs) || defaults.timeoutMs || 8000);
  if ('enabled' in merged) merged.enabled = Boolean(merged.enabled);
  if ('mode' in merged && !['echo', 'canned', 'scenario'].includes(merged.mode)) merged.mode = defaults.mode;

  return merged;
}

export function redactSecrets(value) {
  return JSON.parse(JSON.stringify(value || {}, (_key, inner) => {
    if (typeof inner === 'string' && /sk-|AIza|gsk_/i.test(inner)) return '[redacted]';
    return inner;
  }));
}

export function buildProviderStatus(status, detail, extras = {}) {
  return { status, detail, ...extras };
}

export function buildRouterConfig(config = {}) {
  return {
    provider: normalizeProviderSelection(config.provider),
    devMode: config.devMode !== false,
    fallbackEnabled: config.fallbackEnabled !== false,
    fallbackOrder: normalizeFallbackOrder(config.fallbackOrder),
    providerConfigs: config.providerConfigs || {},
  };
}

export function extractLatestUserIntent(messages = []) {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user');
  return latestUser?.content?.trim() || 'Continue the mission.';
}
