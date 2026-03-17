import { createError, ERROR_CODES } from '../errors.js';
import { runOpenAIProvider } from './providers/openaiProvider.js';
import { runOllamaProvider } from './providers/ollamaProvider.js';
import { runCustomProvider } from './providers/customProvider.js';

const PROVIDER_MAP = {
  openai: runOpenAIProvider,
  ollama: runOllamaProvider,
  custom: runCustomProvider,
};

export async function routeLLMRequest({ prompt, provider = 'openai', providerConfig = {}, context = {} }) {
  const resolvedProvider = PROVIDER_MAP[provider] ? provider : 'openai';
  const handler = PROVIDER_MAP[resolvedProvider];

  if (!handler) {
    throw createError(ERROR_CODES.LLM_PROVIDER_INVALID, `Unsupported AI provider: ${provider}.`, { status: 400 });
  }

  const result = await handler({ prompt, providerConfig, context });

  if (!result?.output_text || !result?.provider) {
    throw createError(ERROR_CODES.LLM_RESPONSE_UNSUPPORTED, 'Provider returned an invalid normalized response.', { status: 502 });
  }

  return result;
}
