import { createError, ERROR_CODES } from '../../errors.js';
import { createLogger } from '../../../utils/logger.js';
import { buildProviderEndpoint } from '../../../../shared/ai/providerDefaults.mjs';

const logger = createLogger('custom-provider');
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);

function parseOptionalHeaders(headersJson) {
  if (!headersJson?.trim()) return {};

  try {
    const parsed = JSON.parse(headersJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Headers JSON must be an object map.');
    }
    return parsed;
  } catch (error) {
    throw createError(ERROR_CODES.LLM_CUSTOM_HEADERS_INVALID, `Invalid custom headers JSON: ${error.message}`, { status: 400 });
  }
}

function normalizeCustomOutput(payload) {
  const firstChoice = payload?.choices?.[0]?.message?.content;
  if (typeof firstChoice === 'string' && firstChoice.trim()) return firstChoice.trim();

  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();

  if (typeof payload?.message?.content === 'string' && payload.message.content.trim()) return payload.message.content.trim();

  if (typeof payload?.response === 'string' && payload.response.trim()) return payload.response.trim();

  throw createError(
    ERROR_CODES.LLM_RESPONSE_UNSUPPORTED,
    'Custom provider response format unsupported. Expected choices[0].message.content or output_text.',
    { status: 502 },
  );
}

export async function runCustomProvider({ prompt, context, providerConfig }) {
  const label = providerConfig?.label || 'Custom LLM';
  const baseUrl = providerConfig?.baseUrl?.trim();
  const chatEndpoint = providerConfig?.chatEndpoint?.trim();
  const model = providerConfig?.model?.trim();

  if (!baseUrl || !chatEndpoint || !model) {
    throw createError(
      ERROR_CODES.LLM_CUSTOM_MISCONFIGURED,
      `${label} is misconfigured. baseUrl, chatEndpoint, and model are required.`,
      { status: 400 },
    );
  }

  const endpoint = buildProviderEndpoint(baseUrl, chatEndpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  logger.info('Resolved custom provider config', {
    provider: 'custom',
    label,
    baseUrl,
    chatEndpoint,
    endpoint,
    model,
  });

  try {
    const optionalHeaders = parseOptionalHeaders(providerConfig?.headersJson || '');
    const headers = {
      'Content-Type': 'application/json',
      ...optionalHeaders,
    };

    if (providerConfig?.apiKey?.trim()) {
      headers.Authorization = `Bearer ${providerConfig.apiKey.trim()}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: JSON.stringify({ prompt, context }),
          },
        ],
      }),
    });

    const rawText = await response.text();
    let payload = {};
    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        throw createError(ERROR_CODES.LLM_RESPONSE_UNSUPPORTED, `${label} returned non-JSON response from ${endpoint}.`, { status: 502 });
      }
    }

    if (!response.ok) {
      throw createError(
        ERROR_CODES.LLM_CUSTOM_REQUEST_FAILED,
        `${label} request failed (${response.status}) at ${endpoint}.`,
        { status: 502, details: payload },
      );
    }

    return {
      output_text: normalizeCustomOutput(payload),
      provider: 'custom',
      model: payload?.model || model,
      raw: payload,
      diagnostics: {
        provider: 'custom',
        label,
        baseUrl,
        chatEndpoint,
        endpoint,
        model: payload?.model || model,
        configSource: 'request-config',
      },
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createError(ERROR_CODES.LLM_CUSTOM_REQUEST_FAILED, `${label} request timed out at ${endpoint}.`, { status: 504 });
    }

    if (error?.code) {
      throw error;
    }

    throw createError(
      ERROR_CODES.LLM_CUSTOM_REQUEST_FAILED,
      `${label} is unreachable at ${baseUrl}.`,
      { status: 502, details: { reason: error?.message } },
    );
  } finally {
    clearTimeout(timeout);
  }
}
