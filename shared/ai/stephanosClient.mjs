import {
  readPersistedStephanosHomeNode,
  readPersistedStephanosLastKnownNode,
  resolveStephanosBackendBaseUrl,
} from '../runtime/stephanosHomeNode.mjs';

const DEFAULT_BACKEND_BASE_URL = 'http://localhost:8787';

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

function resolveFrontendOrigin(runtimeContext = {}) {
  if (safeString(runtimeContext.frontendOrigin)) {
    return safeString(runtimeContext.frontendOrigin);
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return '';
}

function resolveBackendBaseUrl(runtimeContext = {}) {
  const storage = runtimeContext.storage || globalThis?.localStorage;
  const manualNode = runtimeContext.manualNode || readPersistedStephanosHomeNode(storage);
  const lastKnownNode = runtimeContext.lastKnownNode || readPersistedStephanosLastKnownNode(storage);

  return resolveStephanosBackendBaseUrl({
    currentOrigin: resolveFrontendOrigin(runtimeContext),
    manualNode,
    lastKnownNode,
    explicitBaseUrl: runtimeContext.baseUrl,
  }) || DEFAULT_BACKEND_BASE_URL;
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
      frontendOrigin: resolveFrontendOrigin(runtimeContext),
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
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch is unavailable; cannot contact Stephanos backend AI route.');
  }

  const baseUrl = resolveBackendBaseUrl(runtimeContext);
  const endpoint = `${baseUrl.replace(/\/$/, '')}/api/ai/chat`;
  const payload = buildChatPayload({ provider, messages, context, model, runtimeContext });

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let json = {};

  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('Stephanos backend returned malformed JSON from /api/ai/chat.');
    }
  }

  if (!response.ok) {
    const error = new Error(json?.error || `Stephanos AI request failed with HTTP ${response.status}.`);
    error.status = response.status;
    error.payload = json;
    throw error;
  }

  return json;
}

export { resolveBackendBaseUrl as resolveStephanosAiBackendBaseUrl };
