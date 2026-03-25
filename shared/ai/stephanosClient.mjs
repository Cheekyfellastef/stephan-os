import {
  requestStephanosBackend,
  resolveStephanosBackendClientBaseUrl,
} from '../runtime/backendClient.mjs';

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
  const response = await requestStephanosBackend({
    path: '/api/ai/chat',
    method: 'POST',
    body: payload,
    runtimeContext,
    fetchImpl,
  });
  return response.json || {};
}

export { resolveBackendBaseUrl as resolveStephanosAiBackendBaseUrl };
