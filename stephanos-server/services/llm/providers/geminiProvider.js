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

function resolveGeminiGrounding(resolved = {}) {
  const groundingMode = String(resolved?.groundingMode || '').trim().toLowerCase();
  const groundingEnabled = resolved?.groundingEnabled !== false && groundingMode !== 'none';
  const requiresGrounding = true;
  const supportsFreshWeb = groundingEnabled && groundingMode === 'google_search';
  const groundingTool = groundingMode === 'google_search'
    ? { google_search: {} }
    : null;
  return {
    groundingEnabled,
    groundingMode: groundingMode || 'none',
    requiresGrounding,
    supportsFreshWeb,
    supportsCurrentAnswers: supportsFreshWeb,
    groundingTool,
  };
}

function extractGroundingMetadata(raw = {}) {
  const metadata = raw?.candidates?.[0]?.groundingMetadata || raw?.groundingMetadata || {};
  const webSearchQueries = Array.isArray(metadata?.webSearchQueries) ? metadata.webSearchQueries : [];
  const groundingChunks = Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : [];
  const sources = groundingChunks
    .map((chunk) => chunk?.web || {})
    .map((web) => ({
      uri: web?.uri || '',
      title: web?.title || '',
    }))
    .filter((source) => source.uri);
  return {
    searchQueries: webSearchQueries,
    sources,
    citations: Array.isArray(metadata?.groundingSupports) ? metadata.groundingSupports : [],
  };
}

export async function checkGeminiHealth(config = {}) {
  const resolved = sanitizeProviderConfig('gemini', config);
  const grounding = resolveGeminiGrounding(resolved);
  const configuredVia = String(config?.apiKey || '').trim()
    ? (config?.secretAuthority === 'backend-local-secret-store'
      ? 'backend local secret store'
      : 'runtime provider config')
    : 'GEMINI_API_KEY';
  const providerCapability = {
    provider: 'gemini',
    available: Boolean(resolved.apiKey),
    transportReachable: Boolean(resolved.apiKey),
    supportsFreshWeb: grounding.supportsFreshWeb,
    supportsBrowserSearch: grounding.supportsFreshWeb,
    supportsCurrentAnswers: grounding.supportsCurrentAnswers,
    requiresGrounding: grounding.requiresGrounding,
    groundingMode: grounding.groundingMode,
    groundingEnabled: grounding.groundingEnabled,
    configuredModel: resolved.model || '',
    configuredModelSupportsFreshWeb: grounding.supportsFreshWeb,
    configuredModelSupportsCurrentAnswers: grounding.supportsCurrentAnswers,
    candidateFreshRouteAvailable: grounding.supportsFreshWeb,
    candidateFreshWebModel: grounding.supportsFreshWeb ? (resolved.model || '') : '',
    freshWebPath: grounding.supportsFreshWeb ? '/models:generateContent+google_search' : '',
    capabilityReason: resolved.apiKey
      ? (grounding.supportsFreshWeb
        ? 'Gemini fresh-web route is available because Google Search grounding is enabled.'
        : 'Gemini is configured but fresh-web capability requires Google Search grounding.')
      : 'Gemini API key is missing.',
  };
  return resolved.apiKey
    ? {
      ok: true,
      provider: 'gemini',
      badge: 'Ready',
      detail: configuredVia === 'backend local secret store'
        ? 'Gemini is ready from backend local secret store authority.'
        : configuredVia === 'runtime provider config'
          ? 'Gemini is ready from backend-routed provider configuration.'
          : 'Gemini backend environment is configured.',
      state: 'READY',
      configuredVia,
      model: resolved.model,
      baseURL: resolved.baseURL,
      reason: '',
      transportReachable: true,
      providerCapability,
    }
    : {
      ok: false,
      provider: 'gemini',
      badge: 'Missing key',
      detail: 'Add a Gemini API key to enable Gemini.',
      state: 'MISSING_KEY',
      configuredVia: 'missing',
      model: resolved.model,
      baseURL: resolved.baseURL,
      reason: 'Missing key',
      transportReachable: false,
      providerCapability,
    };
}

export async function runGeminiProvider(request, config = {}) {
  const resolved = sanitizeProviderConfig('gemini', config);
  const grounding = resolveGeminiGrounding(resolved);

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
        config: grounding.groundingTool ? { tools: [grounding.groundingTool] } : undefined,
        tools: grounding.groundingTool ? [grounding.groundingTool] : undefined,
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

    return {
      ok: true,
      provider: 'gemini',
      model: request.model || resolved.model,
      outputText,
      raw,
      usage: raw?.usageMetadata,
      diagnostics: {
        gemini: {
          groundingEnabled: grounding.groundingEnabled,
          groundingMode: grounding.groundingMode,
          supportsFreshWeb: grounding.supportsFreshWeb,
          groundingMetadata: extractGroundingMetadata(raw),
        },
      },
    };
  } catch (error) {
    return { ok: false, provider: 'gemini', model: resolved.model, outputText: '', error: { code: ERROR_CODES.LLM_GEMINI_REQUEST_FAILED, message: `Gemini request failed: ${error.message}`, retryable: true } };
  }
}
