import { EMPTY_RESPONSE } from './aiTypes';
import { buildApiUrl, getApiConfig, getApiRuntimeConfig, getApiTargetLabel } from './apiConfig';
import { DEFAULT_PROVIDER_KEY } from './providerConfig';

function normalizeResponse(json) {
  return { ...EMPTY_RESPONSE, ...(json && typeof json === 'object' ? json : {}) };
}

function createTransportError({ code, message, details }) {
  return { ok: false, code, message, details, isTransportError: true };
}

function stripSecretsFromProviderConfigs(providerConfigs = {}) {
  return Object.fromEntries(
    Object.entries(providerConfigs || {}).map(([provider, config]) => {
      const source = config && typeof config === 'object' ? config : {};
      const { apiKey, ...rest } = source;
      return [provider, rest];
    }),
  );
}

async function requestJson(path, options = {}, runtimeConfig = getApiRuntimeConfig()) {
  const apiConfig = getApiConfig();
  const timeoutMs = Number(runtimeConfig?.timeoutMs) || apiConfig.timeoutMs;
  const baseUrl = runtimeConfig?.baseUrl || apiConfig.baseUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildApiUrl(path, baseUrl), { ...options, signal: controller.signal });
    const raw = await response.text();
    let json = {};

    if (raw) {
      try { json = JSON.parse(raw); } catch {
        throw createTransportError({ code: 'INVALID_JSON', message: 'Backend returned malformed JSON.', details: { status: response.status, raw } });
      }
    }

    return { ok: response.ok, status: response.status, data: json };
  } catch (error) {
    if (error?.isTransportError) throw error;
    if (error?.name === 'AbortError') throw createTransportError({ code: 'TIMEOUT', message: `Request timed out after ${timeoutMs}ms.` });
    throw createTransportError({ code: 'BACKEND_OFFLINE', message: 'Unable to reach backend API. Check that the server is running and reachable.', details: { reason: error?.message } });
  } finally {
    clearTimeout(timeout);
  }
}

async function requestMemory(path, options = {}, runtimeConfig = getApiRuntimeConfig()) {
  const result = await requestJson(path, options, runtimeConfig);
  if (!result.ok) {
    const message = result.data?.error || `Memory request failed (${result.status}).`;
    throw new Error(message);
  }

  return result.data;
}

export async function sendPrompt({
  prompt,
  provider = DEFAULT_PROVIDER_KEY,
  routeMode = 'auto',
  providerConfigs = {},
  fallbackEnabled = true,
  fallbackOrder = [],
  devMode = true,
  runtimeConfig = getApiRuntimeConfig(),
  tileContext = null,
  continuityContext = null,
  continuityMode = '',
}) {
  const safeProviderConfigs = stripSecretsFromProviderConfigs(providerConfigs);
  const runtimeContext = {
    ...runtimeConfig,
    ...(tileContext && typeof tileContext === 'object' ? { tileContext } : {}),
  };
  const payload = {
    prompt,
    provider,
    routeMode,
    providerConfig: safeProviderConfigs?.[provider] || {},
    providerConfigs: safeProviderConfigs,
    fallbackEnabled,
    fallbackOrder,
    devMode,
    runtimeContext,
    continuityMode: String(continuityMode || '').trim() || 'recording-only',
    ...(continuityContext && typeof continuityContext === 'object' ? { continuityContext } : {}),
  };

  console.debug('[Stephanos UI] Dispatching /api/ai/chat request', {
    requestedProvider: payload.provider,
    fallbackEnabled: payload.fallbackEnabled,
    fallbackOrder: payload.fallbackOrder,
  });

  const result = await requestJson('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, runtimeContext);

  return {
    ok: result.ok,
    transportError: null,
    data: normalizeResponse(result.data),
    requestPayload: payload,
    status: result.status,
  };
}

export async function getProviderHealth(payload, runtimeConfig = getApiRuntimeConfig()) {
  const safePayload = {
    ...(payload || {}),
    providerConfigs: stripSecretsFromProviderConfigs(payload?.providerConfigs || {}),
  };
  const result = await requestJson('/api/ai/providers/health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(safePayload),
  }, runtimeConfig);

  return { ok: result.ok, status: result.status, data: result.data?.data || {} };
}

export async function checkApiHealth(runtimeConfig = getApiRuntimeConfig()) {
  const result = await requestJson('/api/health', {}, runtimeConfig);
  return { ok: result.ok, status: result.status, target: getApiTargetLabel(runtimeConfig.baseUrl), baseUrl: runtimeConfig.baseUrl, data: result.data };
}

export { getApiRuntimeConfig };

export async function getLocalProviderSecretStatus(runtimeConfig = getApiRuntimeConfig()) {
  const result = await requestJson('/api/ai-admin/provider-secrets', {}, runtimeConfig);
  return { ok: result.ok, status: result.status, data: result.data?.data || {} };
}

export async function setLocalProviderSecret(provider, apiKey, runtimeConfig = getApiRuntimeConfig()) {
  const result = await requestJson(`/api/ai-admin/provider-secrets/${encodeURIComponent(provider)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: String(apiKey || '') }),
  }, runtimeConfig);
  return { ok: result.ok, status: result.status, data: result.data?.data || null, error: result.data?.error || '' };
}

export async function clearLocalProviderSecret(provider, runtimeConfig = getApiRuntimeConfig()) {
  const result = await requestJson(`/api/ai-admin/provider-secrets/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
  }, runtimeConfig);
  return { ok: result.ok, status: result.status, data: result.data?.data || null, error: result.data?.error || '' };
}

export async function listMemoryItems(runtimeConfig = getApiRuntimeConfig()) {
  const result = await requestMemory('/api/memory', {}, runtimeConfig);
  return result.data?.items || [];
}

export async function searchMemoryItems(query, runtimeConfig = getApiRuntimeConfig()) {
  const result = await requestMemory(`/api/memory/search?q=${encodeURIComponent(query)}`, {}, runtimeConfig);
  return result.data?.items || [];
}

export async function createMemoryItem(payload, runtimeConfig = getApiRuntimeConfig()) {
  const normalizedPayload = {
    ...payload,
    tags: Array.isArray(payload.tags) ? payload.tags : String(payload.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean),
  };

  const result = await requestMemory('/api/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalizedPayload),
  }, runtimeConfig);

  return result.data?.item || null;
}
