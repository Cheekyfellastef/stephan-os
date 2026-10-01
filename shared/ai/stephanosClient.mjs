import {
  requestStephanosBackend,
  resolveStephanosBackendClientBaseUrl,
} from '../runtime/backendClient.mjs';
import { readPersistedStephanosSessionMemory } from '../runtime/stephanosSessionMemory.mjs';
import { resolveOllamaTimeoutPolicy } from './ollamaTimeoutPolicy.mjs';

const DEFAULT_UI_REQUEST_TIMEOUT_MS = 30000;
const UI_TIMEOUT_GRACE_MS = 1500;
const NON_SECRET_PROVIDER_CONFIG_FIELDS = Object.freeze({
  mock: ['enabled', 'latencyMs', 'failRate', 'mode', 'model'],
  groq: ['baseURL', 'model', 'freshWebModel', 'freshWebModelCandidates'],
  gemini: ['baseURL', 'model'],
  ollama: ['baseURL', 'model', 'timeoutMs', 'defaultOllamaTimeoutMs', 'perModelTimeoutOverrides'],
  openrouter: ['baseURL', 'model', 'enabled'],
});

function safeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = safeString(value);
    if (normalized) return normalized;
  }
  return '';
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
  const sourceContext = asObject(runtimeContext);
  if (sourceContext.providerConfigs && typeof sourceContext.providerConfigs === 'object') {
    return sourceContext.providerConfigs;
  }
  const nestedRuntimeContext = asObject(sourceContext.runtimeContext);
  if (nestedRuntimeContext.providerConfigs && typeof nestedRuntimeContext.providerConfigs === 'object') {
    return nestedRuntimeContext.providerConfigs;
  }
  const runtimeTruth = asObject(sourceContext.runtimeTruth);
  if (runtimeTruth.providerConfigs && typeof runtimeTruth.providerConfigs === 'object') {
    return runtimeTruth.providerConfigs;
  }
  const storage = sourceContext.storage || globalThis?.localStorage;
  const sessionMemory = readPersistedStephanosSessionMemory(storage);
  return sessionMemory?.session?.providerPreferences?.providerConfigs || {};
}

function sanitizeProviderConfigsForTransport(providerConfigs = {}) {
  return Object.fromEntries(
    Object.entries(asObject(providerConfigs)).map(([provider, config]) => [
      provider,
      Object.fromEntries(
        (NON_SECRET_PROVIDER_CONFIG_FIELDS[provider] || [])
          .filter((field) => Object.hasOwn(asObject(config), field))
          .map((field) => [field, asObject(config)[field]]),
      ),
    ]),
  );
}

export function sanitizeStephanosProviderConfigsForTransport(providerConfigs = {}) {
  return sanitizeProviderConfigsForTransport(providerConfigs);
}

function resolveRuntimeTimeoutPolicy(runtimeContext = {}) {
  const sourceContext = asObject(runtimeContext);
  const nestedRuntimeContext = asObject(sourceContext.runtimeContext);
  const runtimeTruth = asObject(sourceContext.runtimeTruth);
  const finalRouteTruth = asObject(sourceContext.finalRouteTruth);
  const canonicalRouteRuntimeTruth = asObject(sourceContext.canonicalRouteRuntimeTruth);
  const candidates = [
    sourceContext.timeoutPolicy,
    nestedRuntimeContext.timeoutPolicy,
    runtimeTruth.timeoutPolicy,
    finalRouteTruth.timeoutPolicy,
    canonicalRouteRuntimeTruth.timeoutPolicy,
  ];
  return candidates.find((candidate) => candidate && typeof candidate === 'object') || {};
}

function resolveTimeoutExecutionTruth({
  provider = '',
  model = '',
  runtimeContext = {},
} = {}) {
  const sourceContext = asObject(runtimeContext);
  const timeoutExecutionEnvelope = asObject(sourceContext.timeoutExecutionEnvelope);
  const runtimeTruth = asObject(sourceContext.runtimeTruth);
  const finalRouteTruth = asObject(sourceContext.finalRouteTruth || runtimeTruth.finalRouteTruth);
  const canonicalRouteRuntimeTruth = asObject(
    sourceContext.canonicalRouteRuntimeTruth || runtimeTruth.canonicalRouteRuntimeTruth,
  );
  const requestedProvider = safeString(provider).toLowerCase();
  const effectiveProvider = firstNonEmpty(
    timeoutExecutionEnvelope.effectiveProvider,
    timeoutExecutionEnvelope.timeoutProvider,
    finalRouteTruth.executedProvider,
    canonicalRouteRuntimeTruth.executedProvider,
    finalRouteTruth.selectedProvider,
    canonicalRouteRuntimeTruth.selectedProvider,
    requestedProvider,
  ).toLowerCase();
  const effectiveModel = firstNonEmpty(
    safeString(model),
    timeoutExecutionEnvelope.effectiveModel,
    timeoutExecutionEnvelope.timeoutModel,
    canonicalRouteRuntimeTruth.timeoutModel,
    finalRouteTruth.timeoutModel,
    resolveRuntimeProviderConfigs(sourceContext)?.[effectiveProvider]?.model,
  );
  return {
    requestedProvider,
    effectiveProvider: effectiveProvider || requestedProvider || '',
    effectiveModel: effectiveModel || '',
  };
}

function resolveUiRequestTimeoutMs({
  provider = 'ollama',
  model = '',
  providerConfigs = undefined,
  runtimeContext = {},
} = {}) {
  const timeoutPolicy = resolveRuntimeTimeoutPolicy(runtimeContext);
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

  const timeoutExecutionTruth = resolveTimeoutExecutionTruth({ provider, model, runtimeContext });
  if (timeoutExecutionTruth.effectiveProvider === 'ollama') {
    const effectiveProviderConfigs = providerConfigs && typeof providerConfigs === 'object'
      ? providerConfigs
      : resolveRuntimeProviderConfigs(runtimeContext);
    const providerPolicy = resolveOllamaTimeoutPolicy({
      providerConfig: effectiveProviderConfigs?.ollama || {},
      requestedModel: timeoutExecutionTruth.effectiveModel,
    });
    if (providerPolicy.backendRouteTimeoutMs) {
      const providerDrivenFloor = providerPolicy.backendRouteTimeoutMs + UI_TIMEOUT_GRACE_MS;
      return Math.max(baselineUiTimeoutMs, providerDrivenFloor);
    }
  }

  return baselineUiTimeoutMs;
}

function buildChatPayload({
  provider = 'ollama',
  messages = [],
  context = {},
  model = '',
  routeMode = 'auto',
  fallbackEnabled = true,
  fallbackOrder = undefined,
  providerConfigs = undefined,
  runtimeContext = {},
} = {}) {
  const prompt = resolvePromptFromMessages(messages);
  if (!prompt) {
    throw new Error('Stephanos AI request requires at least one non-empty message content value.');
  }

  const normalizedProvider = safeString(provider) || 'ollama';
  const normalizedModel = safeString(model);
  const runtimeProviderConfigs = resolveRuntimeProviderConfigs(runtimeContext);
  const suppliedProviderConfigs = sanitizeProviderConfigsForTransport(providerConfigs && typeof providerConfigs === 'object'
    ? providerConfigs
    : runtimeProviderConfigs);
  const savedProviderConfig = asObject(suppliedProviderConfigs?.[normalizedProvider]);
  const providerConfig = normalizedModel
    ? { ...savedProviderConfig, model: normalizedModel }
    : savedProviderConfig;

  return {
    prompt,
    provider: normalizedProvider,
    routeMode: safeString(routeMode) || 'auto',
    fallbackEnabled: fallbackEnabled !== false,
    ...(Array.isArray(fallbackOrder) ? { fallbackOrder } : {}),
    providerConfig,
    providerConfigs: {
      ...suppliedProviderConfigs,
      [normalizedProvider]: providerConfig,
    },
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
  routeMode = 'auto',
  fallbackEnabled = true,
  fallbackOrder = undefined,
  providerConfigs = undefined,
  runtimeContext = {},
  fetchImpl = globalThis.fetch,
} = {}) {
  const payload = buildChatPayload({
    provider,
    messages,
    context,
    model,
    routeMode,
    fallbackEnabled,
    fallbackOrder,
    providerConfigs,
    runtimeContext,
  });
  const timeoutMs = resolveUiRequestTimeoutMs({ provider, model, providerConfigs, runtimeContext });
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

export {
  resolveBackendBaseUrl as resolveStephanosAiBackendBaseUrl,
  resolveUiRequestTimeoutMs as resolveStephanosAiUiRequestTimeoutMs,
};
