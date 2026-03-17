import { createError, ERROR_CODES } from '../../errors.js';

const DEFAULT_OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);

export async function runOllamaProvider({ prompt, context }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${DEFAULT_OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: DEFAULT_OLLAMA_MODEL,
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
      model: payload.model || DEFAULT_OLLAMA_MODEL,
      raw: payload,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createError(ERROR_CODES.LLM_OLLAMA_UNREACHABLE, 'Local Ollama timed out. Start Ollama with: ollama serve', { status: 504 });
    }

    if (error?.code) {
      throw error;
    }

    throw createError(
      ERROR_CODES.LLM_OLLAMA_UNREACHABLE,
      `Local Ollama not reachable at ${DEFAULT_OLLAMA_BASE_URL}. Start Ollama with: ollama serve`,
      { status: 502, details: { reason: error?.message } },
    );
  } finally {
    clearTimeout(timeout);
  }
}
