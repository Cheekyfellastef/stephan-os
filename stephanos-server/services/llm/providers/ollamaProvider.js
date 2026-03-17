import { createError, ERROR_CODES } from '../../errors.js';

const DEFAULT_OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const DEFAULT_OLLAMA_CHAT_ENDPOINT = process.env.OLLAMA_CHAT_ENDPOINT || '/api/chat';
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);

function normalizeEndpoint(baseUrl, chatEndpoint) {
  const normalizedBaseUrl = (baseUrl || DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, '');
  const normalizedChatEndpoint = (chatEndpoint || DEFAULT_OLLAMA_CHAT_ENDPOINT).trim();
  const endpointPath = normalizedChatEndpoint.startsWith('/') ? normalizedChatEndpoint : `/${normalizedChatEndpoint}`;

  return `${normalizedBaseUrl}${endpointPath}`;
}

export async function runOllamaProvider({ prompt, context, providerConfig = {} }) {
  const baseUrl = providerConfig?.baseUrl?.trim() || DEFAULT_OLLAMA_BASE_URL;
  const chatEndpoint = providerConfig?.chatEndpoint?.trim() || DEFAULT_OLLAMA_CHAT_ENDPOINT;
  const model = providerConfig?.model?.trim() || DEFAULT_OLLAMA_MODEL;
  const endpoint = normalizeEndpoint(baseUrl, chatEndpoint);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
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
      model: payload.model || model,
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
      `Local Ollama not reachable at ${baseUrl}. Start Ollama with: ollama serve`,
      { status: 502, details: { reason: error?.message } },
    );
  } finally {
    clearTimeout(timeout);
  }
}
