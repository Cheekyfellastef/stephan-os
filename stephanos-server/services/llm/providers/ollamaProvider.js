import { createError, ERROR_CODES } from '../../errors.js';
import { createLogger } from '../../../utils/logger.js';
import { PROVIDER_DEFINITIONS, buildProviderEndpoint } from '../../../../shared/ai/providerDefaults.mjs';

const logger = createLogger('ollama-provider');
const OLLAMA_DEFAULTS = PROVIDER_DEFINITIONS.ollama.defaults;
const DEFAULT_OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || OLLAMA_DEFAULTS.baseUrl;
const DEFAULT_OLLAMA_CHAT_ENDPOINT = process.env.OLLAMA_CHAT_ENDPOINT || OLLAMA_DEFAULTS.chatEndpoint;
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL || OLLAMA_DEFAULTS.model;
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);

function resolveOllamaConfig(providerConfig = {}) {
  const baseUrlOverride = providerConfig?.baseUrl?.trim();
  const chatEndpointOverride = providerConfig?.chatEndpoint?.trim();
  const modelOverride = providerConfig?.model?.trim();

  return {
    baseUrl: baseUrlOverride || DEFAULT_OLLAMA_BASE_URL,
    chatEndpoint: chatEndpointOverride || DEFAULT_OLLAMA_CHAT_ENDPOINT,
    model: modelOverride || DEFAULT_OLLAMA_MODEL,
    endpoint: buildProviderEndpoint(
      baseUrlOverride || DEFAULT_OLLAMA_BASE_URL,
      chatEndpointOverride || DEFAULT_OLLAMA_CHAT_ENDPOINT,
    ),
    configSource: {
      baseUrl: baseUrlOverride ? 'request-override' : process.env.OLLAMA_BASE_URL ? 'env-default' : 'canonical-default',
      chatEndpoint: chatEndpointOverride ? 'request-override' : process.env.OLLAMA_CHAT_ENDPOINT ? 'env-default' : 'canonical-default',
      model: modelOverride ? 'request-override' : process.env.OLLAMA_MODEL ? 'env-default' : 'canonical-default',
    },
  };
}

export async function runOllamaProvider({ prompt, context, providerConfig = {} }) {
  const resolved = resolveOllamaConfig(providerConfig);

  logger.info('Resolved Ollama provider config', {
    provider: 'ollama',
    baseUrl: resolved.baseUrl,
    chatEndpoint: resolved.chatEndpoint,
    endpoint: resolved.endpoint,
    model: resolved.model,
    configSource: resolved.configSource,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(resolved.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: resolved.model,
        stream: false,
        messages: [
          {
            role: 'user',
            content: JSON.stringify({
              prompt,
              context,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw createError(
        ERROR_CODES.LLM_OLLAMA_UNREACHABLE,
        `Local Ollama returned HTTP ${response.status}. ${body || 'Start Ollama with: ollama serve'}`,
        { status: 502 },
      );
    }

    const payload = await response.json();
    const outputText = payload?.message?.content?.trim();
    if (!outputText) {
      throw createError(
        ERROR_CODES.LLM_RESPONSE_UNSUPPORTED,
        'Ollama response missing message.content text.',
        { status: 502 },
      );
    }

    return {
      output_text: outputText,
      provider: 'ollama',
      model: payload.model || resolved.model,
      raw: payload,
      diagnostics: {
        provider: 'ollama',
        baseUrl: resolved.baseUrl,
        chatEndpoint: resolved.chatEndpoint,
        endpoint: resolved.endpoint,
        model: payload.model || resolved.model,
        configSource: resolved.configSource,
      },
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createError(ERROR_CODES.LLM_OLLAMA_UNREACHABLE, `Local Ollama timed out at ${resolved.endpoint}. Start Ollama with: ollama serve`, { status: 504 });
    }

    if (error?.code) {
      throw error;
    }

    throw createError(
      ERROR_CODES.LLM_OLLAMA_UNREACHABLE,
      `Local Ollama not reachable at ${resolved.endpoint}. Start Ollama with: ollama serve`,
      { status: 502, details: { reason: error?.message } },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export { resolveOllamaConfig };
