import { ERROR_CODES } from '../../errors.js';
import { sanitizeProviderConfig } from '../utils/providerUtils.js';

function buildMessages(request) {
  const messages = [];
  if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
  return [...messages, ...request.messages];
}

function normalizeFreshnessNeed(request = {}) {
  return String(request?.freshnessContext?.freshnessNeed || '').trim().toLowerCase();
}

function modelSupportsFreshWeb(model = '') {
  const normalized = String(model || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes('compound') || normalized.includes('search');
}

function buildGroqCapabilityTruth({ resolved, hasApiKey }) {
  const freshWebModel = String(resolved?.freshWebModel || resolved?.model || '').trim();
  const supportsFreshWeb = hasApiKey && modelSupportsFreshWeb(freshWebModel);
  return {
    provider: 'groq',
    available: hasApiKey,
    transportReachable: hasApiKey,
    supportsFreshWeb,
    supportsBrowserSearch: supportsFreshWeb,
    supportsCurrentAnswers: supportsFreshWeb,
    capabilityReason: supportsFreshWeb
      ? `Groq fresh-web route enabled via model "${freshWebModel}".`
      : hasApiKey
        ? `Groq is configured but model "${freshWebModel || 'n/a'}" is not marked fresh-web capable (requires a compound/search model).`
        : 'Groq API key is missing.',
  };
}

function buildResponsesInput(request = {}) {
  const userMessages = Array.isArray(request.messages)
    ? request.messages.filter((message) => String(message?.role || 'user') === 'user')
    : [];
  const latestPrompt = userMessages.length > 0
    ? String(userMessages[userMessages.length - 1]?.content || '')
    : '';
  return [
    {
      role: 'user',
      content: [{ type: 'input_text', text: latestPrompt }],
    },
  ];
}

export async function checkGroqHealth(config = {}) {
  const resolved = sanitizeProviderConfig('groq', config);
  const hasApiKey = Boolean(resolved.apiKey);
  const providerCapability = buildGroqCapabilityTruth({ resolved, hasApiKey });
  const configuredVia = String(config?.apiKey || '').trim()
    ? (config?.secretAuthority === 'backend-local-secret-store'
      ? 'backend local secret store'
      : 'runtime provider config')
    : 'GROQ_API_KEY';
  return resolved.apiKey
    ? {
      ok: true,
      provider: 'groq',
      badge: 'Ready',
      detail: configuredVia === 'backend local secret store'
        ? 'Groq is ready from backend local secret store authority.'
        : configuredVia === 'runtime provider config'
        ? 'Groq is ready from backend-routed provider configuration.'
        : 'Groq backend environment is configured.',
      state: 'READY',
      configuredVia,
      model: resolved.model,
      baseURL: resolved.baseURL,
      transportReachable: providerCapability.transportReachable,
      capabilities: {
        freshWeb: providerCapability.supportsFreshWeb,
        browserSearch: providerCapability.supportsBrowserSearch,
        currentAnswers: providerCapability.supportsCurrentAnswers,
      },
      providerCapability,
    }
    : {
      ok: false,
      provider: 'groq',
      badge: 'Missing key',
      detail: 'Provide a Groq API key in the UI for this session or set GROQ_API_KEY on the backend.',
      state: 'MISSING_KEY',
      configuredVia: 'missing',
      model: resolved.model,
      baseURL: resolved.baseURL,
      transportReachable: providerCapability.transportReachable,
      capabilities: {
        freshWeb: providerCapability.supportsFreshWeb,
        browserSearch: providerCapability.supportsBrowserSearch,
        currentAnswers: providerCapability.supportsCurrentAnswers,
      },
      providerCapability,
    };
}

export async function runGroqProvider(request, config = {}) {
  const resolved = sanitizeProviderConfig('groq', config);
  const providerCapability = buildGroqCapabilityTruth({ resolved, hasApiKey: Boolean(resolved.apiKey) });
  const configuredVia = String(config?.apiKey || '').trim()
    ? (config?.secretAuthority === 'backend-local-secret-store'
      ? 'backend local secret store'
      : 'runtime provider config')
    : 'backend env';

  if (!resolved.apiKey) {
    return {
      ok: false,
      provider: 'groq',
      model: resolved.model,
      outputText: '',
      error: {
        code: ERROR_CODES.LLM_GROQ_MISSING_API_KEY,
        message: 'Groq API key is missing from the backend environment.',
        retryable: false,
      },
      diagnostics: {
        groq: {
          providerCapability,
        },
      },
    };
  }

  const freshnessNeed = normalizeFreshnessNeed(request);
  const shouldUseFreshWebRoute = freshnessNeed === 'high' && providerCapability.supportsFreshWeb;

  try {
    const endpoint = shouldUseFreshWebRoute ? '/responses' : '/chat/completions';
    const response = await fetch(`${resolved.baseURL.replace(/\/$/, '')}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolved.apiKey}`,
      },
      body: JSON.stringify(shouldUseFreshWebRoute
        ? {
          model: request.model || resolved.freshWebModel || resolved.model,
          input: buildResponsesInput(request),
          instructions: request.systemPrompt || undefined,
          tools: [{ type: 'web_search' }],
          tool_choice: 'auto',
          temperature: request.temperature ?? 0.2,
        }
        : {
          model: request.model || resolved.model,
          messages: buildMessages(request),
          temperature: request.temperature ?? 0.3,
          max_tokens: request.maxTokens,
          stream: false,
        }),
    });

    const raw = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        provider: 'groq',
        model: resolved.model,
        outputText: '',
        raw,
        error: {
          code: ERROR_CODES.LLM_GROQ_REQUEST_FAILED,
          message: raw?.error?.message || `Groq request failed with HTTP ${response.status}.`,
          retryable: response.status >= 500,
        },
        diagnostics: {
          groq: {
            endpoint,
            providerCapability,
            freshWebAttempted: shouldUseFreshWebRoute,
          },
        },
      };
    }

    const responseOutputText = shouldUseFreshWebRoute
      ? (Array.isArray(raw?.output_text) ? raw.output_text.join('\n').trim() : String(raw?.output_text || '').trim())
        || String(raw?.output?.find?.((item) => item?.type === 'message')?.content?.[0]?.text || '').trim()
      : raw?.choices?.[0]?.message?.content?.trim() || '';

    return {
      ok: true,
      provider: 'groq',
      model: raw?.model || resolved.model,
      outputText: responseOutputText,
      usage: raw?.usage,
      raw,
      diagnostics: {
        groq: {
          baseURL: resolved.baseURL,
          model: raw?.model || resolved.model,
          configuredVia,
          endpoint,
          freshWebAttempted: shouldUseFreshWebRoute,
          providerCapability,
        },
      },
    };
  } catch (error) {
    return {
      ok: false,
      provider: 'groq',
      model: resolved.model,
      outputText: '',
      error: {
        code: ERROR_CODES.LLM_GROQ_REQUEST_FAILED,
        message: `Groq request failed: ${error.message}`,
        retryable: true,
      },
      diagnostics: {
        groq: {
          providerCapability,
          freshWebAttempted: shouldUseFreshWebRoute,
        },
      },
    };
  }
}
