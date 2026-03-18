import { ERROR_CODES } from '../../errors.js';
import { sanitizeProviderConfig } from '../utils/providerUtils.js';

function buildMessages(request) {
  const messages = [];
  if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
  return [...messages, ...request.messages];
}

export async function checkGroqHealth(config = {}) {
  const resolved = sanitizeProviderConfig('groq', config);
  return resolved.apiKey
    ? { ok: true, provider: 'groq', badge: 'Ready', detail: 'Groq API key configured.' }
    : { ok: false, provider: 'groq', badge: 'Missing key', detail: 'Add a Groq API key to enable Groq.' };
}

export async function runGroqProvider(request, config = {}) {
  const resolved = sanitizeProviderConfig('groq', config);

  if (!resolved.apiKey) {
    return { ok: false, provider: 'groq', model: resolved.model, outputText: '', error: { code: ERROR_CODES.LLM_GROQ_MISSING_API_KEY, message: 'Groq API key is missing.', retryable: false } };
  }

  try {
    const response = await fetch(`${resolved.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolved.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || resolved.model,
        messages: buildMessages(request),
        temperature: request.temperature ?? 0.3,
        max_tokens: request.maxTokens,
        stream: false,
      }),
    });

    const raw = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, provider: 'groq', model: resolved.model, outputText: '', raw, error: { code: ERROR_CODES.LLM_GROQ_REQUEST_FAILED, message: raw?.error?.message || `Groq request failed with HTTP ${response.status}.`, retryable: response.status >= 500 } };
    }

    return {
      ok: true,
      provider: 'groq',
      model: raw?.model || resolved.model,
      outputText: raw?.choices?.[0]?.message?.content?.trim() || '',
      usage: raw?.usage,
      raw,
    };
  } catch (error) {
    return { ok: false, provider: 'groq', model: resolved.model, outputText: '', error: { code: ERROR_CODES.LLM_GROQ_REQUEST_FAILED, message: `Groq request failed: ${error.message}`, retryable: true } };
  }
}
