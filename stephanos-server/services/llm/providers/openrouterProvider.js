import { ERROR_CODES } from '../../errors.js';
import { sanitizeProviderConfig } from '../utils/providerUtils.js';

function buildMessages(request) {
  const messages = [];
  if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
  return [...messages, ...request.messages];
}

export async function checkOpenrouterHealth(config = {}) {
  const resolved = sanitizeProviderConfig('openrouter', config);
  if (!resolved.enabled) {
    return { ok: false, provider: 'openrouter', badge: 'Optional paid', detail: 'OpenRouter is disabled by default.' };
  }
  return resolved.apiKey
    ? { ok: true, provider: 'openrouter', badge: 'Ready', detail: 'OpenRouter is enabled and configured.' }
    : { ok: false, provider: 'openrouter', badge: 'Missing key', detail: 'OpenRouter is optional and requires an API key.' };
}

export async function runOpenrouterProvider(request, config = {}) {
  const resolved = sanitizeProviderConfig('openrouter', config);

  if (!resolved.enabled || !resolved.apiKey) {
    return { ok: false, provider: 'openrouter', model: resolved.model, outputText: '', error: { code: ERROR_CODES.LLM_OPENROUTER_MISSING_API_KEY, message: 'OpenRouter is optional/paid and not configured.', retryable: false } };
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
      }),
    });

    const raw = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, provider: 'openrouter', model: resolved.model, outputText: '', raw, error: { code: ERROR_CODES.LLM_OPENROUTER_REQUEST_FAILED, message: raw?.error?.message || `OpenRouter request failed with HTTP ${response.status}.`, retryable: response.status >= 500 } };
    }

    return { ok: true, provider: 'openrouter', model: raw?.model || resolved.model, outputText: raw?.choices?.[0]?.message?.content?.trim() || '', usage: raw?.usage, raw };
  } catch (error) {
    return { ok: false, provider: 'openrouter', model: resolved.model, outputText: '', error: { code: ERROR_CODES.LLM_OPENROUTER_REQUEST_FAILED, message: `OpenRouter request failed: ${error.message}`, retryable: true } };
  }
}
