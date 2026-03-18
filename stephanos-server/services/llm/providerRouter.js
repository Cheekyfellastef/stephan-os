import { createError, ERROR_CODES } from '../errors.js';
import { createLogger } from '../../utils/logger.js';
import {
  DEFAULT_PROVIDER_KEY,
  normalizeProviderSelection,
} from '../../../shared/ai/providerDefaults.mjs';
import { runOpenAIProvider } from './providers/openaiProvider.js';
import { runOllamaProvider } from './providers/ollamaProvider.js';
import { runCustomProvider } from './providers/customProvider.js';

const logger = createLogger('llm-provider-router');

const PROVIDER_MAP = {
  openai: runOpenAIProvider,
  ollama: runOllamaProvider,
  custom: runCustomProvider,
};

export function resolveProviderRequest(provider, providerConfig = {}) {
  const resolvedProvider = normalizeProviderSelection(provider);
  const handler = PROVIDER_MAP[resolvedProvider];

  return {
    requestedProvider: provider || DEFAULT_PROVIDER_KEY,
    resolvedProvider,
    fallbackApplied: resolvedProvider !== (provider || DEFAULT_PROVIDER_KEY),
    overrideKeys: Object.keys(providerConfig || {}).filter((key) => {
      const value = providerConfig?.[key];
      return typeof value === 'string' ? value.trim() !== '' : value != null;
    }),
    handler,
  };
}

export async function routeLLMRequest({ prompt, provider = DEFAULT_PROVIDER_KEY, providerConfig = {}, context = {} }) {
  const resolution = resolveProviderRequest(provider, providerConfig);
  const { resolvedProvider, handler } = resolution;

  if (!handler) {
    throw createError(ERROR_CODES.LLM_PROVIDER_INVALID, `Unsupported AI provider: ${provider}.`, { status: 400 });
  }

  logger.info('Routing LLM request', {
    requestedProvider: resolution.requestedProvider,
    resolvedProvider,
    fallbackApplied: resolution.fallbackApplied,
    overrideKeys: resolution.overrideKeys,
  });

  const result = await handler({ prompt, providerConfig, context });

  if (!result?.output_text || !result?.provider) {
    throw createError(ERROR_CODES.LLM_RESPONSE_UNSUPPORTED, 'Provider returned an invalid normalized response.', { status: 502 });
  }

  return {
    ...result,
    diagnostics: {
      requestedProvider: resolution.requestedProvider,
      resolvedProvider,
      fallbackApplied: resolution.fallbackApplied,
      overrideKeys: resolution.overrideKeys,
      ...(result.diagnostics || {}),
    },
  };
}
