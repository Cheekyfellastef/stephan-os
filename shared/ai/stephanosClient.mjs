import {
  requestStephanosBackend,
  resolveStephanosBackendClientBaseUrl,
} from '../runtime/backendClient.mjs';
import { readPersistedStephanosSessionMemory } from '../runtime/stephanosSessionMemory.mjs';

const DEFAULT_UI_REQUEST_TIMEOUT_MS = 30000;
const UI_TIMEOUT_GRACE_MS = 1500;

function safeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function resolvePromptFromMessages(messages = []) {
  const normalized = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && typeof message === 'object')
    .map((message) => ({
      role: safeString(message.role),
      content: safeString(message.content),
    }))
    .filter((message) => message.content);

  const latestUser = [...normalized].reverse().find((message) => message.role === 'user');
  if (latestUser?.content) {
    return latestUser.content;
  }

  return normalized[normalized.length - 1]?.content || '';
}

function resolveBackendBaseUrl(runtimeContext = {}) {
  return resolveStephanosBackendClientBaseUrl(runtimeContext) || 'http://localhost:8787';
}

function asPositiveNumber(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveRuntimeProviderConfigs(runtimeContext = {}) {
  if (runtimeContext.providerConfigs && typeof runtimeContext.providerConfigs === 'object') {
    return runtimeContext.providerConfigs;
  }
  const storage = runtimeContext.storage || globalThis?.localStorage;
  const sessionMemory = readPersistedStephanosSessionMemory(storage);
  return sessionMemory?.session?.providerPreferences?.providerConfigs || {};
}

function resolveOllamaProviderTimeout({ providerConfig = {}, model = '' } = {}) {
  const normalizedModel = safeString(model);
  const overrides = providerConfig?.perModelTimeoutOverrides && typeof providerConfig.perModelTimeoutOverrides === 'object'
    ? providerConfig.perModelTimeoutOverrides
    : {};
  const modelTimeout = normalizedModel ? asPositiveNumber(overrides[normalizedModel]) : null;
  if (modelTimeout && modelTimeout >= 1000) {
    return modelTimeout;
  }
  const defaultTimeout = asPositiveNumber(providerConfig?.defaultOllamaTimeoutMs ?? providerConfig?.timeoutMs);
  if (defaultTimeout && defaultTimeout >= 1000) {
    return defaultTimeout;
  }
  return null;
}

function resolveUiRequestTimeoutMs({
  provider = 'ollama',
  model = '',
  runtimeContext = {},
} = {}) {
  const timeoutPolicy = runtimeContext?.timeoutPolicy && typeof runtimeContext.timeoutPolicy === 'object'
    ? runtimeContext.timeoutPolicy
    : {};
  const baselineUiTimeoutMs = asPositiveNumber(runtimeContext?.timeoutMs, DEFAULT_UI_REQUEST_TIMEOUT_MS);
  const canonicalUiTimeoutMs = asPositiveNumber(timeoutPolicy.uiRequestTimeoutMs);
  const canonicalBackendRouteTimeoutMs = asPositiveNumber(
    timeoutPolicy.backendRouteTimeoutMs ?? timeoutPolicy.providerTimeoutMs,
  );

  if (canonicalUiTimeoutMs) {
    return canonicalUiTimeoutMs;
  }

  if (canonicalBackendRouteTimeoutMs) {
    const backendFloor = canonicalBackendRouteTimeoutMs + UI_TIMEOUT_GRACE_MS;
    return Math.max(baselineUiTimeoutMs, backendFloor);
  }

  const normalizedProvider = safeString(provider).toLowerCase();
  if (normalizedProvider === 'ollama') {
    const providerConfigs = resolveRuntimeProviderConfigs(runtimeContext);
    const providerTimeout = resolveOllamaProviderTimeout({
      providerConfig: providerConfigs?.ollama || {},
      model,
    });
    if (providerTimeout) {
      const providerDrivenFloor = providerTimeout + UI_TIMEOUT_GRACE_MS;
      return Math.max(baselineUiTimeoutMs, providerDrivenFloor);
    }
  }

  return baselineUiTimeoutMs;
}

function buildChatPayload({ provider = 'ollama', messages = [], context = {}, model = '', runtimeContext = {} } = {}) {
  const prompt = resolvePromptFromMessages(messages);
  if (!prompt) {
    throw new Error('Stephanos AI request requires at least one non-empty message content value.');
  }

  const normalizedProvider = safeString(provider) || 'ollama';
  const normalizedModel = safeString(model);
  const providerConfig = normalizedModel ? { model: normalizedModel } : {};

  return {
    prompt,
    provider: normalizedProvider,
    providerConfig,
    providerConfigs: normalizedModel ? { [normalizedProvider]: providerConfig } : {},
    runtimeContext: {
      ...runtimeContext,
      frontendOrigin: safeString(runtimeContext.frontendOrigin)
        || (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''),
      tileContext: {
        ...(context && typeof context === 'object' ? context : {}),
      },
    },
  };
}

export async function queryStephanosAI({
  provider = 'ollama',
  messages = [],
  context = {},
  model = '',
  runtimeContext = {},
  fetchImpl = globalThis.fetch,
} = {}) {
  const payload = buildChatPayload({ provider, messages, context, model, runtimeContext });
  const timeoutMs = resolveUiRequestTimeoutMs({ provider, model, runtimeContext });
  const response = await requestStephanosBackend({
    path: '/api/ai/chat',
    method: 'POST',
    body: payload,
    runtimeContext,
    fetchImpl,
    timeoutMs,
  });
  return response.json || {};
}

export { resolveBackendBaseUrl as resolveStephanosAiBackendBaseUrl };
