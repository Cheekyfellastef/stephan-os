import { ERROR_CODES } from '../../errors.js';
import { sanitizeProviderConfig } from '../utils/providerUtils.js';

function toGeminiContents(request) {
  const contents = request.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Hello from Stephanos.' }] });
  }

  return contents;
}

function extractGeminiText(raw) {
  const parts = raw?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part?.text || '').join('\n').trim();
}

export async function checkGeminiHealth(config = {}) {
  const resolved = sanitizeProviderConfig('gemini', config);
  return resolved.apiKey
    ? { ok: true, provider: 'gemini', badge: 'Ready', detail: 'Gemini API key configured.' }
    : { ok: false, provider: 'gemini', badge: 'Missing key', detail: 'Add a Gemini API key to enable Gemini.' };
}

export async function runGeminiProvider(request, config = {}) {
  const resolved = sanitizeProviderConfig('gemini', config);

  if (!resolved.apiKey) {
    return { ok: false, provider: 'gemini', model: resolved.model, outputText: '', error: { code: ERROR_CODES.LLM_GEMINI_MISSING_API_KEY, message: 'Gemini API key is missing.', retryable: false } };
  }

  try {
    const url = `${resolved.baseURL.replace(/\/$/, '')}/${request.model || resolved.model}:generateContent?key=${encodeURIComponent(resolved.apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: request.systemPrompt ? { parts: [{ text: request.systemPrompt }] } : undefined,
        contents: toGeminiContents(request),
        generationConfig: {
          temperature: request.temperature ?? 0.3,
          maxOutputTokens: request.maxTokens,
        },
      }),
    });

    const raw = await response.json().catch(() => ({}));
    const outputText = extractGeminiText(raw);

    if (!response.ok) {
      return { ok: false, provider: 'gemini', model: resolved.model, outputText: '', raw, error: { code: ERROR_CODES.LLM_GEMINI_REQUEST_FAILED, message: raw?.error?.message || `Gemini request failed with HTTP ${response.status}.`, retryable: response.status >= 500 } };
    }

    if (!outputText) {
      return { ok: false, provider: 'gemini', model: resolved.model, outputText: '', raw, error: { code: ERROR_CODES.LLM_GEMINI_BAD_RESPONSE, message: 'Gemini returned no usable text parts.', retryable: true } };
    }

    return { ok: true, provider: 'gemini', model: request.model || resolved.model, outputText, raw, usage: raw?.usageMetadata };
  } catch (error) {
    return { ok: false, provider: 'gemini', model: resolved.model, outputText: '', error: { code: ERROR_CODES.LLM_GEMINI_REQUEST_FAILED, message: `Gemini request failed: ${error.message}`, retryable: true } };
  }
}
