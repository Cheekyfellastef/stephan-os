import { EMPTY_RESPONSE } from './aiTypes';
import { API_CONFIG, buildApiUrl, getApiRuntimeConfig, getApiTargetLabel } from './apiConfig';
import { DEFAULT_PROVIDER_KEY } from './providerConfig';

function normalizeResponse(json) {
  return { ...EMPTY_RESPONSE, ...(json && typeof json === 'object' ? json : {}) };
}

function createTransportError({ code, message, details }) {
  return { ok: false, code, message, details, isTransportError: true };
}

async function requestJson(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_CONFIG.timeoutMs);

  try {
    const response = await fetch(buildApiUrl(path), { ...options, signal: controller.signal });
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
    if (error?.name === 'AbortError') throw createTransportError({ code: 'TIMEOUT', message: `Request timed out after ${API_CONFIG.timeoutMs}ms.` });
    throw createTransportError({ code: 'BACKEND_OFFLINE', message: 'Unable to reach backend API. Check that the server is running and reachable.', details: { reason: error?.message } });
  } finally {
    clearTimeout(timeout);
  }
}


async function requestMemory(path, options = {}) {
  const result = await requestJson(path, options);
  if (!result.ok) {
    const message = result.data?.error || `Memory request failed (${result.status}).`;
    throw new Error(message);
  }

  return result.data;
}

export async function sendPrompt({ prompt, provider = DEFAULT_PROVIDER_KEY, providerConfigs = {}, fallbackEnabled = true, fallbackOrder = [], devMode = true }) {
  const payload = {
    prompt,
    provider,
    providerConfig: providerConfigs?.[provider] || {},
    providerConfigs,
    fallbackEnabled,
    fallbackOrder,
    devMode,
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
  });

  return {
    ok: result.ok,
    transportError: null,
    data: normalizeResponse(result.data),
    requestPayload: payload,
    status: result.status,
  };
}


export async function getProviderHealth(payload) {
  const result = await requestJson('/api/ai/providers/health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return { ok: result.ok, status: result.status, data: result.data?.data || {} };
}

export async function checkApiHealth() {
  const result = await requestJson('/api/health');
  return { ok: result.ok, status: result.status, target: getApiTargetLabel(), baseUrl: API_CONFIG.baseUrl, data: result.data };
}

export { getApiRuntimeConfig };

export async function listMemoryItems() {
  const result = await requestMemory('/api/memory');
  return result.data?.items || [];
}

export async function searchMemoryItems(query) {
  const result = await requestMemory(`/api/memory/search?q=${encodeURIComponent(query)}`);
  return result.data?.items || [];
}

export async function createMemoryItem(payload) {
  const normalizedPayload = {
    ...payload,
    tags: Array.isArray(payload.tags) ? payload.tags : String(payload.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean),
  };

  const result = await requestMemory('/api/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalizedPayload),
  });

  return result.data?.item || null;
}
