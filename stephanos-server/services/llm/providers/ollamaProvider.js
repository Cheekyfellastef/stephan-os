import { ERROR_CODES } from '../../errors.js';
import { sanitizeProviderConfig } from '../utils/providerUtils.js';

const OLLAMA_STATE = {
  CONNECTED: 'CONNECTED',
  MISCONFIGURED: 'MISCONFIGURED',
  LOCALHOST_MISMATCH: 'LOCALHOST_MISMATCH',
  OFFLINE: 'OFFLINE',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
};
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const OLLAMA_ROUTE_NOTE_PREFIX = '[OLLAMA ROUTE]';
const OLLAMA_MODEL_POLICY = Object.freeze({
  lightweight: 'llama3.2:3b',
  defaultReasoning: 'qwen:14b',
  deepReasoning: 'qwen:32b',
  fallback: 'gpt-oss:20b',
});

function uniqueModels(list = []) {
  return [...new Set((Array.isArray(list) ? list : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function inferOllamaReasoningProfile(request = {}) {
  const routeDecision = request?.routeDecision && typeof request.routeDecision === 'object' ? request.routeDecision : {};
  const freshnessContext = request?.freshnessContext && typeof request.freshnessContext === 'object' ? request.freshnessContext : {};
  const latestUserMessage = [...(Array.isArray(request?.messages) ? request.messages : [])]
    .reverse()
    .find((message) => String(message?.role || '').toLowerCase() === 'user');
  const userText = String(latestUserMessage?.content || '').trim();
  const normalizedUserText = userText.toLowerCase();
  const explicitDeepReasoning = /\b(deep|hard|multi[- ]step|architecture|root cause|debug plan|escalate)\b/i.test(userText)
    || routeDecision?.selectedAnswerMode === 'deep-local'
    || routeDecision?.localReasoningTier === 'deep'
    || routeDecision?.operatorDeepReasoning === true;
  const explicitLightweight = /\b(quick|brief|tiny|short answer|minimal)\b/i.test(userText)
    || routeDecision?.localReasoningTier === 'lightweight';
  const complexitySignals = [
    userText.length >= 420,
    userText.split(/\s+/).filter(Boolean).length >= 90,
    /(\n.*){6,}/.test(userText),
    freshnessContext?.staleRisk === 'high',
  ].filter(Boolean).length;
  const autoEscalate = !explicitLightweight && (explicitDeepReasoning || complexitySignals >= 2);

  return {
    promptLength: userText.length,
    promptWordCount: userText ? userText.split(/\s+/).filter(Boolean).length : 0,
    explicitDeepReasoning,
    explicitLightweight,
    autoEscalate,
    preferredTier: explicitLightweight
      ? 'lightweight'
      : autoEscalate
        ? 'deep'
        : 'default',
    localReasoningMode: routeDecision?.localReasoningTier || (explicitLightweight ? 'lightweight' : (autoEscalate ? 'deep' : 'default')),
    userIntentPreview: normalizedUserText.slice(0, 160),
  };
}

function chooseOllamaModel({
  request = {},
  resolvedModel = '',
  availableModels = [],
} = {}) {
  const available = uniqueModels(availableModels);
  const requestedModel = String(request?.model || resolvedModel || '').trim();
  const profile = inferOllamaReasoningProfile(request);
  const preferredModelByTier = profile.preferredTier === 'lightweight'
    ? OLLAMA_MODEL_POLICY.lightweight
    : profile.preferredTier === 'deep'
      ? OLLAMA_MODEL_POLICY.deepReasoning
      : OLLAMA_MODEL_POLICY.defaultReasoning;

  const policyCandidates = uniqueModels([
    preferredModelByTier,
    OLLAMA_MODEL_POLICY.defaultReasoning,
    OLLAMA_MODEL_POLICY.fallback,
    OLLAMA_MODEL_POLICY.lightweight,
    requestedModel,
    resolvedModel,
    ...available,
  ]);

  const selectedModel = policyCandidates.find((candidate) => available.includes(candidate))
    || requestedModel
    || resolvedModel
    || available[0]
    || OLLAMA_MODEL_POLICY.fallback;
  const fallbackModelUsed = selectedModel === OLLAMA_MODEL_POLICY.fallback && selectedModel !== preferredModelByTier;
  const escalatedToDeepModel = selectedModel === OLLAMA_MODEL_POLICY.deepReasoning && preferredModelByTier === OLLAMA_MODEL_POLICY.deepReasoning;
  const policyReason = available.includes(preferredModelByTier)
    ? `Policy selected ${preferredModelByTier} for ${profile.preferredTier} local reasoning.`
    : available.includes(OLLAMA_MODEL_POLICY.defaultReasoning)
      ? `Preferred model unavailable; defaulted to ${OLLAMA_MODEL_POLICY.defaultReasoning}.`
      : available.includes(OLLAMA_MODEL_POLICY.fallback)
        ? `${preferredModelByTier} unavailable; used compatibility fallback ${OLLAMA_MODEL_POLICY.fallback}.`
        : `Policy model unavailable; used first reachable model ${selectedModel}.`;

  return {
    selectedModel,
    requestedModel,
    availableModels: available,
    preferredModel: preferredModelByTier,
    fallbackModel: OLLAMA_MODEL_POLICY.fallback,
    fallbackModelUsed,
    fallbackReason: fallbackModelUsed ? `${preferredModelByTier} unavailable in local Ollama catalog.` : '',
    escalatedToDeepModel,
    escalationReason: escalatedToDeepModel
      ? (profile.explicitDeepReasoning ? 'operator-or-prompt requested deep reasoning' : 'complexity heuristic triggered deep reasoning')
      : '',
    profile,
    policyReason,
    autoSelectedModel: selectedModel !== requestedModel,
  };
}

function parseAbsoluteUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname = '') {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '0.0.0.0' || normalized === '::1';
}

function parseHostnameFromUrl(value = '') {
  try {
    return new URL(String(value || '')).hostname || '';
  } catch {
    return '';
  }
}

function pushNonLoopbackHostCandidate(candidates, host = '', source = '') {
  const normalizedHost = String(host || '').trim();
  if (!normalizedHost || isLoopbackHostname(normalizedHost)) return;
  if (candidates.some((candidate) => candidate.host === normalizedHost)) return;
  candidates.push({ host: normalizedHost, source });
}

function buildRouteContext(runtimeContext = {}) {
  const source = runtimeContext && typeof runtimeContext === 'object' ? runtimeContext : {};
  const sessionKind = String(source.sessionKind || '').trim();
  const deviceContext = String(source.deviceContext || '').trim();
  const frontendOrigin = String(source.frontendOrigin || '').trim();
  const apiBaseUrl = String(source.apiBaseUrl || source.baseUrl || source.backendBaseUrl || '').trim();
  const frontendHost = source.frontendHost || parseHostnameFromUrl(frontendOrigin);
  const backendHost = source.backendHost || parseHostnameFromUrl(apiBaseUrl);
  const homeNodeHost = source?.homeNode?.host || '';
  const localDesktopSession = !sessionKind && !deviceContext
    ? true
    : (sessionKind === 'local-desktop' || deviceContext === 'pc-local-browser');
  const nonLocalSession = !localDesktopSession;
  const candidates = [];
  pushNonLoopbackHostCandidate(candidates, homeNodeHost, 'runtime-context-home-node');
  pushNonLoopbackHostCandidate(candidates, backendHost, 'runtime-context-backend-host');
  pushNonLoopbackHostCandidate(candidates, parseHostnameFromUrl(source?.homeNode?.backendUrl || ''), 'home-node-backend-url');
  pushNonLoopbackHostCandidate(candidates, parseHostnameFromUrl(source?.homeNode?.uiUrl || ''), 'home-node-ui-url');
  pushNonLoopbackHostCandidate(candidates, parseHostnameFromUrl(source?.routeDiagnostics?.['home-node']?.actualTarget || ''), 'route-diagnostics-home-node-actual-target');
  pushNonLoopbackHostCandidate(candidates, parseHostnameFromUrl(source?.routeDiagnostics?.['home-node']?.target || ''), 'route-diagnostics-home-node-target');

  return {
    sessionKind: sessionKind || 'unknown',
    deviceContext: deviceContext || 'unknown',
    localDesktopSession,
    nonLocalSession,
    candidates,
  };
}

function resolveOllamaRouteDecision(baseURL, runtimeContext = {}) {
  const parsedBaseUrl = parseAbsoluteUrl(baseURL);
  const routeContext = buildRouteContext(runtimeContext);
  const routeNotes = [];
  if (!parsedBaseUrl) {
    routeNotes.push(`${OLLAMA_ROUTE_NOTE_PREFIX} provider configured URL is invalid`);
    return {
      ok: false,
      usable: false,
      routeClass: 'invalid',
      configuredBaseURL: baseURL,
      effectiveBaseURL: baseURL,
      effectiveHost: '',
      source: 'invalid-config',
      routeNotes,
      routeContext,
    };
  }

  const configuredHost = parsedBaseUrl.hostname;
  const loopbackConfigured = isLoopbackHostname(configuredHost);
  if (!loopbackConfigured) {
    routeNotes.push(`${OLLAMA_ROUTE_NOTE_PREFIX} non-loopback endpoint preserved (${configuredHost})`);
    return {
      ok: true,
      usable: true,
      routeClass: 'lan-home-node',
      configuredBaseURL: baseURL,
      effectiveBaseURL: parsedBaseUrl.origin,
      effectiveHost: configuredHost,
      source: 'configured-non-loopback',
      routeNotes,
      routeContext,
    };
  }

  if (routeContext.localDesktopSession) {
    routeNotes.push(`${OLLAMA_ROUTE_NOTE_PREFIX} localhost endpoint allowed for local-desktop session`);
    return {
      ok: true,
      usable: true,
      routeClass: 'localhost',
      configuredBaseURL: baseURL,
      effectiveBaseURL: parsedBaseUrl.origin,
      effectiveHost: configuredHost,
      source: 'configured-localhost',
      routeNotes,
      routeContext,
    };
  }

  routeNotes.push(`${OLLAMA_ROUTE_NOTE_PREFIX} localhost endpoint rejected for non-local session`);
  const lanCandidate = routeContext.candidates[0] || null;
  if (!lanCandidate) {
    routeNotes.push(`${OLLAMA_ROUTE_NOTE_PREFIX} no usable non-loopback endpoint available`);
    return {
      ok: true,
      usable: false,
      routeClass: 'unusable-nonlocal-loopback',
      configuredBaseURL: baseURL,
      effectiveBaseURL: parsedBaseUrl.origin,
      effectiveHost: configuredHost,
      source: 'no-lan-candidate',
      routeNotes,
      routeContext,
    };
  }

  const nextUrl = new URL(parsedBaseUrl.toString());
  nextUrl.hostname = lanCandidate.host;
  routeNotes.push(`${OLLAMA_ROUTE_NOTE_PREFIX} LAN/home-node endpoint selected (${lanCandidate.host})`);
  routeNotes.push(`${OLLAMA_ROUTE_NOTE_PREFIX} home-node address source ${lanCandidate.source}`);
  return {
    ok: true,
    usable: true,
    routeClass: 'lan-home-node',
    configuredBaseURL: baseURL,
    effectiveBaseURL: nextUrl.origin,
    effectiveHost: nextUrl.hostname,
    source: lanCandidate.source,
    routeNotes,
    routeContext,
  };
}

function classifyOllamaFailure(error) {
  if (error?.name === 'AbortError') {
    return { failureType: 'timeout', reason: 'Ollama took too long to respond.' };
  }

  const causeCode = String(error?.cause?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();

  if (causeCode === 'ECONNREFUSED' || message.includes('econnrefused')) {
    return { failureType: 'connection_refused', reason: 'Nothing answered at that Ollama address.' };
  }

  if (
    causeCode === 'ETIMEDOUT'
    || causeCode === 'UND_ERR_CONNECT_TIMEOUT'
    || message.includes('timed out')
    || message.includes('timeout')
  ) {
    return { failureType: 'timeout', reason: 'Ollama took too long to respond.' };
  }

  if (
    causeCode === 'ENOTFOUND'
    || causeCode === 'EHOSTUNREACH'
    || causeCode === 'ENETUNREACH'
    || causeCode === 'ECONNRESET'
    || message.includes('network')
    || message.includes('fetch failed')
  ) {
    return { failureType: 'network_error', reason: 'Stephanos could not reach that device over the network.' };
  }

  return {
    failureType: 'unknown_error',
    reason: error?.message ? `Reason: ${error.message}.` : 'Reason unavailable.',
  };
}

function buildOllamaHealthState({ resolved, ok, responseStatus = null, failure = null }) {
  const baseURL = String(resolved?.effectiveBaseURL ?? resolved?.baseURL ?? '').trim();
  const configuredBaseURL = String(resolved?.configuredBaseURL ?? resolved?.baseURL ?? '').trim();
  const routeDecision = resolved?.routeDecision || {};
  if (!baseURL) {
    return {
      ok: false,
      provider: 'ollama',
      badge: 'Offline',
      state: OLLAMA_STATE.MISCONFIGURED,
      message: 'Ollama configuration is invalid',
      detail: 'Ollama base URL is missing or blank.',
      helpText: [
        'Set Ollama base URL to a valid http(s) URL (example: http://localhost:11434).',
        'Or switch to Mock Mode (free dev mode).',
      ],
      reason: 'Ollama base URL is missing or invalid',
      failureType: 'misconfigured',
      isLocalhost: false,
      likelyWrongDevice: false,
      suggestedUrl: 'http://192.168.1.42:11434',
      baseURL,
      configuredBaseURL,
      routeClass: routeDecision.routeClass || 'invalid',
      routeUsable: false,
      routeNotes: routeDecision.routeNotes || [],
      endpoint: resolved.healthEndpoint || '',
    };
  }

  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(baseURL);
  } catch {
    return {
      ok: false,
      provider: 'ollama',
      badge: 'Offline',
      state: OLLAMA_STATE.MISCONFIGURED,
      message: 'Ollama configuration is invalid',
      detail: 'Ollama base URL is missing or invalid.',
      helpText: [
        'Set Ollama base URL to a valid http(s) URL (example: http://localhost:11434).',
        'Or switch to Mock Mode (free dev mode).',
      ],
      reason: 'Ollama base URL is missing or invalid',
      failureType: 'misconfigured',
      isLocalhost: false,
      likelyWrongDevice: false,
      suggestedUrl: 'http://192.168.1.42:11434',
      baseURL,
      configuredBaseURL,
      routeClass: routeDecision.routeClass || 'invalid',
      routeUsable: false,
      routeNotes: routeDecision.routeNotes || [],
      endpoint: resolved.healthEndpoint || '',
    };
  }

  const isLocalhost = isLoopbackHostname(parsedBaseUrl.hostname);
  const suggestedUrl = `${parsedBaseUrl.protocol}//192.168.1.42:${parsedBaseUrl.port || '11434'}`;

  if (ok) {
    const connectedViaLan = routeDecision.routeClass === 'lan-home-node' && !isLocalhost;
    return {
      ok: true,
      provider: 'ollama',
      badge: 'Ready',
      state: OLLAMA_STATE.CONNECTED,
      message: connectedViaLan ? 'Connected to Ollama (LAN/Home Node)' : 'Connected to Ollama (Local Machine)',
      detail: connectedViaLan
        ? 'Stephanos reached your Ollama server through a LAN/home-node address.'
        : 'Stephanos reached your Ollama server successfully.',
      helpText: [],
      reason: null,
      failureType: null,
      isLocalhost,
      likelyWrongDevice: false,
      suggestedUrl,
      baseURL: resolved.effectiveBaseURL,
      configuredBaseURL,
      routeClass: routeDecision.routeClass || (isLocalhost ? 'localhost' : 'lan-home-node'),
      routeUsable: true,
      routeNotes: routeDecision.routeNotes || [],
      endpointClass: routeDecision.routeClass || (isLocalhost ? 'localhost' : 'lan-home-node'),
      endpoint: resolved.healthEndpoint,
    };
  }

  if (responseStatus != null) {
    return {
      ok: false,
      provider: 'ollama',
      badge: 'Offline',
      state: OLLAMA_STATE.UNKNOWN_ERROR,
      message: 'Ollama connection failed',
      detail: `Ollama responded, but Stephanos could not use it (HTTP ${responseStatus}).`,
      helpText: [
        'Make sure your Ollama app is fully started.',
        'If this keeps happening, switch to Mock Mode (free dev mode).',
      ],
      reason: `HTTP ${responseStatus}`,
      failureType: 'http_error',
      isLocalhost,
      likelyWrongDevice: false,
      suggestedUrl,
      baseURL: resolved.effectiveBaseURL,
      configuredBaseURL,
      routeClass: routeDecision.routeClass || (isLocalhost ? 'localhost' : 'lan-home-node'),
      routeUsable: true,
      routeNotes: routeDecision.routeNotes || [],
      endpointClass: routeDecision.routeClass || (isLocalhost ? 'localhost' : 'lan-home-node'),
      endpoint: resolved.healthEndpoint,
    };
  }

  if (isLocalhost) {
    return {
      ok: false,
      provider: 'ollama',
      badge: 'Offline',
      state: OLLAMA_STATE.OFFLINE,
      message: 'Cannot connect to Ollama',
      detail: 'Stephanos could not reach localhost.',
      helpText: [
        'Make sure Ollama is running on your PC.',
        'Or switch to Mock Mode (free dev mode).',
      ],
      reason: failure?.reason || 'Stephanos could not reach localhost.',
      failureType: failure?.failureType || 'unknown_error',
      isLocalhost,
      likelyWrongDevice: true,
      suggestedUrl,
      baseURL: resolved.effectiveBaseURL,
      configuredBaseURL,
      routeClass: routeDecision.routeClass || 'localhost',
      routeUsable: false,
      routeNotes: routeDecision.routeNotes || [],
      endpointClass: routeDecision.routeClass || 'localhost',
      endpoint: resolved.healthEndpoint,
    };
  }

  return {
    ok: false,
    provider: 'ollama',
    badge: 'Offline',
    state: OLLAMA_STATE.OFFLINE,
    message: 'Cannot connect to Ollama',
    detail: 'Stephanos could not reach your Ollama server.',
    helpText: [
      'Make sure Ollama is running on your PC.',
      'Or switch to Mock Mode (free dev mode).',
    ],
    reason: failure?.reason || 'Connection failed.',
    failureType: failure?.failureType || 'unknown_error',
    isLocalhost,
    likelyWrongDevice: false,
    suggestedUrl,
    baseURL: resolved.effectiveBaseURL,
    configuredBaseURL,
    routeClass: routeDecision.routeClass || 'lan-home-node',
    routeUsable: false,
    routeNotes: routeDecision.routeNotes || [],
    endpointClass: routeDecision.routeClass || 'lan-home-node',
    endpoint: resolved.healthEndpoint,
  };
}

export function resolveOllamaConfig(config = {}) {
  const resolved = sanitizeProviderConfig('ollama', config);
  const runtimeContext = resolved.runtimeContext && typeof resolved.runtimeContext === 'object' ? resolved.runtimeContext : {};
  const rawBaseURL = resolved.baseURL;
  const baseURL = String(rawBaseURL ?? '').trim() || DEFAULT_OLLAMA_BASE_URL;
  const routeDecision = resolveOllamaRouteDecision(baseURL, runtimeContext);
  const effectiveBaseURL = String(routeDecision.effectiveBaseURL || baseURL).trim();
  const trimmedBaseURL = effectiveBaseURL.replace(/\/$/, '');

  return {
    ...resolved,
    configuredBaseURL: baseURL,
    baseURL: effectiveBaseURL,
    effectiveBaseURL,
    routeDecision,
    endpoint: `${trimmedBaseURL}/api/chat`,
    healthEndpoint: `${trimmedBaseURL}/api/tags`,
  };
}

async function fetchOllamaTags(resolved) {
  const response = await fetchWithTimeout(resolved.healthEndpoint, { method: 'GET' }, resolved.timeoutMs);
  const raw = typeof response.json === 'function' ? await response.json().catch(() => ({})) : {};
  return {
    ok: response.ok,
    status: response.status,
    raw,
    models: Array.isArray(raw?.models) ? raw.models.map((item) => item?.name).filter(Boolean) : [],
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
  if (resolved.routeDecision?.routeClass === 'unusable-nonlocal-loopback') {
    return {
      ok: false,
      provider: 'ollama',
      badge: 'Unusable',
      state: OLLAMA_STATE.LOCALHOST_MISMATCH,
      message: 'Ollama is configured but unusable from this surface',
      detail: 'Stephanos rejected a localhost-only Ollama endpoint for a non-local session.',
      helpText: [
        'Use a trusted home-network LAN address for Ollama (for example http://192.168.x.x:11434).',
        'On Windows set OLLAMA_HOST (for example 0.0.0.0:11434), restart Ollama, and allow local-network firewall access to port 11434.',
        'Keep Ollama exposure on trusted LAN only (not public Internet).',
      ],
      reason: 'Provider configured but unusable from current surface.',
      failureType: 'localhost_mismatch',
      isLocalhost: true,
      likelyWrongDevice: true,
      suggestedUrl: 'http://192.168.1.42:11434',
      baseURL: resolved.baseURL,
      configuredBaseURL: resolved.configuredBaseURL,
      endpoint: resolved.healthEndpoint,
      endpointClass: resolved.routeDecision.routeClass,
      routeClass: resolved.routeDecision.routeClass,
      routeUsable: false,
      routeNotes: resolved.routeDecision.routeNotes || [],
      models: [],
      requestedModel: resolved.model,
    };
  }
  const parsedBaseUrl = parseAbsoluteUrl(resolved.baseURL);
  if (!parsedBaseUrl) {
    return {
      ...buildOllamaHealthState({ resolved, ok: false }),
      models: [],
      requestedModel: resolved.model,
    };
  }

  try {
    const tags = await fetchOllamaTags(resolved);
    return {
      ...buildOllamaHealthState({ resolved, ok: tags.ok, responseStatus: tags.ok ? null : tags.status }),
      models: tags.models,
      requestedModel: resolved.model,
    };
  } catch (error) {
    return buildOllamaHealthState({ resolved, ok: false, failure: classifyOllamaFailure(error) });
  }
}

export async function runOllamaProvider(request, config = {}) {
  const resolved = resolveOllamaConfig(config);
  if (!resolved.routeDecision?.usable) {
    return {
      ok: false,
      provider: 'ollama',
      model: resolved.model || '',
      outputText: '',
      error: {
        code: ERROR_CODES.LLM_OLLAMA_UNREACHABLE,
        message: 'Ollama is configured but unusable from this surface. Configure a LAN/home-node endpoint instead of localhost for non-local clients.',
        retryable: false,
      },
      diagnostics: {
        ollama: {
          routeClass: resolved.routeDecision.routeClass,
          configuredBaseURL: resolved.configuredBaseURL,
          effectiveBaseURL: resolved.effectiveBaseURL,
          routeNotes: resolved.routeDecision.routeNotes || [],
        },
      },
    };
  }
  if (!parseAbsoluteUrl(resolved.baseURL)) {
    return {
      ok: false,
      provider: 'ollama',
      model: resolved.model || '',
      outputText: '',
      error: {
        code: ERROR_CODES.LLM_OLLAMA_UNREACHABLE,
        message: 'Ollama base URL is missing or invalid.',
        retryable: false,
      },
    };
  }

  if (!resolved.model) {
    return { ok: false, provider: 'ollama', model: '', outputText: '', error: { code: ERROR_CODES.LLM_OLLAMA_MODEL_MISSING, message: 'Ollama model is required.', retryable: false } };
  }

  try {
    const tags = await fetchOllamaTags(resolved);
    const modelSelection = chooseOllamaModel({
      request,
      resolvedModel: resolved.model,
      availableModels: tags.models,
    });
    const availableModels = modelSelection.availableModels;
    const requestedModel = modelSelection.requestedModel;
    const modelToUse = modelSelection.selectedModel;

    console.log('[BACKEND LIVE] Ollama provider request starting', {
      baseURL: resolved.baseURL,
      configuredBaseURL: resolved.configuredBaseURL,
      requestedModel,
      selectedModel: modelToUse,
      autoSelectedModel: modelSelection.autoSelectedModel,
      preferredModel: modelSelection.preferredModel,
      escalationActive: modelSelection.escalatedToDeepModel,
      fallbackModelUsed: modelSelection.fallbackModelUsed,
      availableModels,
    });

    const response = await fetchWithTimeout(resolved.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelToUse,
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
      console.error('[BACKEND LIVE] Ollama provider request failed', {
        baseURL: resolved.baseURL,
        requestedModel,
        selectedModel: modelToUse,
        preferredModel: modelSelection.preferredModel,
        escalationActive: modelSelection.escalatedToDeepModel,
        fallbackModelUsed: modelSelection.fallbackModelUsed,
        availableModels,
        status: response.status,
        error: message,
      });
      return { ok: false, provider: 'ollama', model: resolved.model, outputText: '', raw, error: { code, message, retryable: code === ERROR_CODES.LLM_OLLAMA_UNREACHABLE } };
    }

    console.log('[BACKEND LIVE] Ollama provider request succeeded', {
      baseURL: resolved.baseURL,
      configuredBaseURL: resolved.configuredBaseURL,
      requestedModel,
      selectedModel: modelToUse,
      preferredModel: modelSelection.preferredModel,
      escalationActive: modelSelection.escalatedToDeepModel,
      fallbackModelUsed: modelSelection.fallbackModelUsed,
      availableModels,
      responseModel: raw?.model || modelToUse,
    });

    return {
      ok: true,
      provider: 'ollama',
      model: raw?.model || modelToUse,
      outputText: raw?.message?.content?.trim() || '',
      usage: raw?.prompt_eval_count ? { prompt_eval_count: raw.prompt_eval_count, eval_count: raw.eval_count } : undefined,
      raw,
      diagnostics: {
        ollama: {
          baseURL: resolved.baseURL,
          configuredBaseURL: resolved.configuredBaseURL,
          routeClass: resolved.routeDecision?.routeClass,
          routeNotes: resolved.routeDecision?.routeNotes || [],
          requestedModel,
          selectedModel: modelToUse,
          availableModels,
          autoSelectedModel: modelSelection.autoSelectedModel,
          defaultModel: OLLAMA_MODEL_POLICY.defaultReasoning,
          preferredModel: modelSelection.preferredModel,
          escalationModel: OLLAMA_MODEL_POLICY.deepReasoning,
          escalationActive: modelSelection.escalatedToDeepModel,
          escalationReason: modelSelection.escalationReason,
          localReasoningMode: modelSelection.profile.localReasoningMode,
          localReasoningProfile: modelSelection.profile,
          policyReason: modelSelection.policyReason,
          fallbackModel: modelSelection.fallbackModel,
          fallbackModelUsed: modelSelection.fallbackModelUsed,
          fallbackReason: modelSelection.fallbackReason,
        },
      },
    };
  } catch (error) {
    const failure = classifyOllamaFailure(error);
    const message = failure.failureType === 'timeout'
      ? 'Cannot connect to Ollama: it took too long to respond.'
      : failure.failureType === 'connection_refused'
        ? 'Cannot connect to Ollama: nothing answered at that address.'
        : failure.failureType === 'network_error'
          ? 'Cannot connect to Ollama: that device could not be reached.'
          : 'Ollama connection failed.';

    console.error('[BACKEND LIVE] Ollama provider request threw', {
      baseURL: resolved.baseURL,
      requestedModel: request.model || resolved.model,
      error: message,
      details: failure,
    });

    return {
      ok: false,
      provider: 'ollama',
      model: resolved.model,
      outputText: '',
      error: {
        code: ERROR_CODES.LLM_OLLAMA_UNREACHABLE,
        message,
        retryable: true,
        details: failure,
      },
    };
  }
}
