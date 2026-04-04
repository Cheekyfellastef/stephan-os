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

function parseFreshWebModelCandidates(resolved = {}) {
  const configuredCandidates = Array.isArray(resolved?.freshWebModelCandidates)
    ? resolved.freshWebModelCandidates
    : [];
  const configuredFreshModel = String(resolved?.freshWebModel || '').trim();
  const configuredModel = String(resolved?.model || '').trim();
  return [...new Set([
    configuredFreshModel,
    ...configuredCandidates,
    configuredModel,
  ].map((candidate) => String(candidate || '').trim()).filter(Boolean))];
}

function resolveFreshWebExecutionPlan(resolved = {}) {
  const configuredModel = String(resolved?.model || '').trim();
  const candidates = parseFreshWebModelCandidates(resolved);
  const freshCapableModel = candidates.find((model) => modelSupportsFreshWeb(model)) || '';
  const configuredModelSupportsFreshWeb = modelSupportsFreshWeb(configuredModel);
  const candidateFreshRouteAvailable = Boolean(freshCapableModel);

  return {
    configuredModel,
    configuredModelSupportsFreshWeb,
    candidateFreshRouteAvailable,
    selectedFreshWebModel: freshCapableModel || configuredModel,
    selectedFreshWebSource: freshCapableModel
      ? (freshCapableModel === configuredModel ? 'configured-model' : 'configured-fresh-candidate')
      : 'none',
    selectedFreshWebPath: freshCapableModel ? '/responses:web_search' : '',
  };
}

function buildGroqCapabilityTruth({ resolved, hasApiKey }) {
  const executionPlan = resolveFreshWebExecutionPlan(resolved);
  const supportsFreshWeb = hasApiKey && executionPlan.candidateFreshRouteAvailable;
  const zeroCostPolicy = true;
  const paidFreshRoutesEnabled = false;
  const freshCapabilityMode = 'zero-cost-only';
  return {
    provider: 'groq',
    available: hasApiKey,
    transportReachable: hasApiKey,
    configuredModel: executionPlan.configuredModel || 'n/a',
    configuredModelSupportsFreshWeb: executionPlan.configuredModelSupportsFreshWeb,
    configuredModelSupportsCurrentAnswers: executionPlan.configuredModelSupportsFreshWeb,
    candidateFreshRouteAvailable: executionPlan.candidateFreshRouteAvailable,
    candidateFreshWebModel: executionPlan.candidateFreshRouteAvailable ? executionPlan.selectedFreshWebModel : '',
    freshWebPath: executionPlan.selectedFreshWebPath || '',
    supportsFreshWeb,
    supportsBrowserSearch: supportsFreshWeb,
    supportsCurrentAnswers: supportsFreshWeb,
    zeroCostPolicy,
    paidFreshRoutesEnabled,
    freshCapabilityMode,
    capabilityReason: supportsFreshWeb
      ? `Groq fresh-web route enabled via model "${executionPlan.selectedFreshWebModel}" (${executionPlan.selectedFreshWebSource}) on /responses with web_search.`
      : hasApiKey
        ? `Groq is configured with zero-cost-only policy and no zero-cost fresh route configured. Configured model "${executionPlan.configuredModel || 'n/a'}" is not marked fresh-web capable (requires explicit opt-in compound/search model).`
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
  const freshWebPlan = resolveFreshWebExecutionPlan(resolved);
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
  const shouldUseFreshWebRoute = freshnessNeed === 'high' && freshWebPlan.candidateFreshRouteAvailable;
  const routeDecisionFreshModel = String(request?.routeDecision?.candidateFreshModel || '').trim();
  const selectedModel = shouldUseFreshWebRoute
    ? (routeDecisionFreshModel || freshWebPlan.selectedFreshWebModel || resolved.freshWebModel || request.model || resolved.model)
    : (request.model || resolved.model);

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
          model: selectedModel,
          input: buildResponsesInput(request),
          instructions: request.systemPrompt || undefined,
          tools: [{ type: 'web_search' }],
          tool_choice: 'auto',
          temperature: request.temperature ?? 0.2,
        }
        : {
          model: selectedModel,
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
        model: selectedModel || resolved.model,
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
            freshWebActive: shouldUseFreshWebRoute,
            selectedModel,
            freshWebModelCandidateAvailable: freshWebPlan.candidateFreshRouteAvailable,
            freshWebModelCandidate: routeDecisionFreshModel || freshWebPlan.selectedFreshWebModel || '',
            freshWebPath: shouldUseFreshWebRoute ? '/responses:web_search' : '',
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
      model: raw?.model || selectedModel || resolved.model,
      outputText: responseOutputText,
      usage: raw?.usage,
      raw,
      diagnostics: {
        groq: {
          baseURL: resolved.baseURL,
          model: raw?.model || selectedModel || resolved.model,
          configuredVia,
          endpoint,
          freshWebAttempted: shouldUseFreshWebRoute,
          freshWebActive: shouldUseFreshWebRoute,
          selectedModel: raw?.model || selectedModel || resolved.model,
          freshWebModelCandidateAvailable: freshWebPlan.candidateFreshRouteAvailable,
          freshWebModelCandidate: routeDecisionFreshModel || freshWebPlan.selectedFreshWebModel || '',
          freshWebPath: shouldUseFreshWebRoute ? '/responses:web_search' : '',
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
          freshWebActive: shouldUseFreshWebRoute,
          selectedModel,
          freshWebModelCandidateAvailable: freshWebPlan.candidateFreshRouteAvailable,
          freshWebModelCandidate: routeDecisionFreshModel || freshWebPlan.selectedFreshWebModel || '',
          freshWebPath: shouldUseFreshWebRoute ? '/responses:web_search' : '',
        },
      },
    };
  }
}
