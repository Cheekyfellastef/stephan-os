import { ERROR_CODES } from '../../errors.js';
import { sanitizeProviderConfig } from '../utils/providerUtils.js';

export function resolveOllamaConfig(config = {}) {
  const resolved = sanitizeProviderConfig('ollama', config);
  return {
    ...resolved,
    endpoint: `${resolved.baseURL.replace(/\/$/, '')}/api/chat`,
    healthEndpoint: `${resolved.baseURL.replace(/\/$/, '')}/api/tags`,
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkOllamaHealth(config = {}) {
  const resolved = resolveOllamaConfig(config);
  try {
    const response = await fetchWithTimeout(resolved.healthEndpoint, { method: 'GET' }, resolved.timeoutMs);
    return response.ok
      ? { ok: true, provider: 'ollama', badge: 'Ready', detail: 'Local Ollama engine responded.' }
      : { ok: false, provider: 'ollama', badge: 'Offline', detail: `Ollama returned HTTP ${response.status}.` };
  } catch {
    return { ok: false, provider: 'ollama', badge: 'Offline', detail: 'Local engine offline.' };
  }
}

export async function runOllamaProvider(request, config = {}) {
  const resolved = resolveOllamaConfig(config);

  if (!resolved.model) {
    return { ok: false, provider: 'ollama', model: '', outputText: '', error: { code: ERROR_CODES.LLM_OLLAMA_MODEL_MISSING, message: 'Ollama model is required.', retryable: false } };
  }

  try {
    const response = await fetchWithTimeout(resolved.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model || resolved.model,
        stream: false,
        messages: [
          ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
          ...request.messages,
        ],
      }),
    }, resolved.timeoutMs);

    const raw = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = raw?.error || `Ollama request failed with HTTP ${response.status}.`;
      const code = /model/i.test(message) ? ERROR_CODES.LLM_OLLAMA_MODEL_MISSING : ERROR_CODES.LLM_OLLAMA_UNREACHABLE;
      return { ok: false, provider: 'ollama', model: resolved.model, outputText: '', raw, error: { code, message, retryable: code === ERROR_CODES.LLM_OLLAMA_UNREACHABLE } };
    }

    return {
      ok: true,
      provider: 'ollama',
      model: raw?.model || resolved.model,
      outputText: raw?.message?.content?.trim() || '',
      usage: raw?.prompt_eval_count ? { prompt_eval_count: raw.prompt_eval_count, eval_count: raw.eval_count } : undefined,
      raw,
    };
  } catch (error) {
    return { ok: false, provider: 'ollama', model: resolved.model, outputText: '', error: { code: ERROR_CODES.LLM_OLLAMA_UNREACHABLE, message: 'Local engine offline.', retryable: true } };
  }
}
