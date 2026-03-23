import {
  CLOUD_FIRST_PROVIDER_KEYS,
  CLOUD_PROVIDER_KEYS,
  DEFAULT_ROUTE_MODE,
  FALLBACK_PROVIDER_KEYS,
  LOCAL_FIRST_PROVIDER_KEYS,
  LOCAL_PROVIDER_KEYS,
  PROVIDER_DEFINITIONS,
  normalizeFallbackOrder,
  normalizeProviderSelection,
  normalizeRouteMode,
} from '../../../../shared/ai/providerDefaults.mjs';
import {
  isLikelyLanHost,
  isLoopbackHost,
  normalizeStephanosHomeNode,
} from '../../../../shared/runtime/stephanosHomeNode.mjs';

const SERVER_ENV_ONLY_PROVIDER_KEYS = ['groq'];

export function normalizeMessages(messages = [], prompt = '') {
  if (Array.isArray(messages) && messages.length > 0) return messages;
  return [{ role: 'user', content: prompt || '' }];
}

export function buildAIRequest({ prompt = '', messages = [], systemPrompt, model, temperature, maxTokens, stream = false } = {}) {
  return {
    messages: normalizeMessages(messages, prompt).map((message) => ({
      role: ['system', 'user', 'assistant'].includes(message?.role) ? message.role : 'user',
      content: String(message?.content ?? ''),
    })),
    systemPrompt: systemPrompt?.trim() || undefined,
    model: model?.trim() || undefined,
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : undefined,
    maxTokens: Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : undefined,
    stream: Boolean(stream),
  };
}

function getEnvBackedDefaults(provider) {
  const defaults = PROVIDER_DEFINITIONS[provider]?.defaults || {};
  const envMap = {
    groq: { apiKey: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL, baseURL: process.env.GROQ_BASE_URL },
    gemini: { apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL, baseURL: process.env.GEMINI_BASE_URL },
    ollama: { baseURL: process.env.OLLAMA_BASE_URL, model: process.env.OLLAMA_MODEL, timeoutMs: process.env.OLLAMA_TIMEOUT_MS },
    openrouter: { apiKey: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL, baseURL: process.env.OPENROUTER_BASE_URL },
  };

  return {
    ...defaults,
    ...Object.fromEntries(Object.entries(envMap[provider] || {}).filter(([, value]) => value != null && value !== '')),
  };
}

function sanitizeInboundProviderConfig(provider, config = {}) {
  const draft = { ...(config || {}) };

  if (SERVER_ENV_ONLY_PROVIDER_KEYS.includes(provider) && 'apiKey' in draft) {
    delete draft.apiKey;
  }

  return draft;
}

export function sanitizeProviderConfig(provider, config = {}) {
  const defaults = getEnvBackedDefaults(provider);
  const merged = { ...defaults, ...sanitizeInboundProviderConfig(provider, config) };

  if ('apiKey' in merged) merged.apiKey = String(merged.apiKey || '');
  if ('baseURL' in merged) merged.baseURL = String(merged.baseURL || '').trim();
  if ('model' in merged) merged.model = String(merged.model || '').trim();
  if ('latencyMs' in merged) merged.latencyMs = Math.max(0, Number(merged.latencyMs) || defaults.latencyMs || 0);
  if ('failRate' in merged) merged.failRate = Math.max(0, Math.min(1, Number(merged.failRate) || 0));
  if ('timeoutMs' in merged) merged.timeoutMs = Math.max(1000, Number(merged.timeoutMs) || defaults.timeoutMs || 8000);
  if ('enabled' in merged) merged.enabled = Boolean(merged.enabled);
  if ('mode' in merged && !['echo', 'canned', 'scenario'].includes(merged.mode)) merged.mode = defaults.mode;

  return merged;
}

export function redactSecrets(value) {
  return JSON.parse(JSON.stringify(value || {}, (_key, inner) => {
    if (typeof inner === 'string' && /sk-|AIza|gsk_/i.test(inner)) return '[redacted]';
    return inner;
  }));
}

export function buildProviderStatus(status, detail, extras = {}) {
  return { status, detail, ...extras };
}

export function normalizeRuntimeContext(runtimeContext = {}) {
  const frontendOrigin = String(runtimeContext.frontendOrigin || '');
  const apiBaseUrl = String(runtimeContext.baseUrl || runtimeContext.apiBaseUrl || runtimeContext.backendBaseUrl || '');
  const parseHostname = (value) => {
    try {
      return new URL(value).hostname || '';
    } catch {
      return '';
    }
  };

  const frontendHost = parseHostname(frontendOrigin);
  const backendHost = parseHostname(apiBaseUrl);
  const frontendLocal = isLoopbackHost(frontendHost) || !frontendHost;
  const backendLocal = isLoopbackHost(backendHost) || !backendHost;
  const frontendReachability = frontendLocal ? 'local' : 'hosted';
  const backendReachability = backendLocal && frontendLocal ? 'local' : 'reachable';
  const homeNode = normalizeStephanosHomeNode(runtimeContext.homeNode || {}, {
    source: runtimeContext.homeNode?.source || runtimeContext.nodeAddressSource || 'manual',
  });
  const routeDiagnostics = runtimeContext.routeDiagnostics && typeof runtimeContext.routeDiagnostics === 'object'
    ? runtimeContext.routeDiagnostics
    : {};
  const localDesktopBackendSession = backendLocal && (
    runtimeContext.nodeAddressSource === 'local-backend-session'
    || runtimeContext.nodeAddressSource === 'local-browser-session'
    || routeDiagnostics['local-desktop']?.configured === true
  );
  const deviceContext = frontendLocal || localDesktopBackendSession
    ? 'pc-local-browser'
    : (homeNode.reachable || (homeNode.configured && isLikelyLanHost(homeNode.host)) || isLikelyLanHost(backendHost))
      ? 'lan-companion'
      : 'off-network';
  const sessionKind = frontendLocal || localDesktopBackendSession ? 'local-desktop' : 'hosted-web';

  return {
    frontendOrigin,
    apiBaseUrl,
    frontendHost,
    backendHost,
    frontendReachability,
    backendReachability,
    frontendLocal,
    backendLocal,
    deviceContext,
    sessionKind,
    homeNode,
    nodeAddressSource: runtimeContext.nodeAddressSource || (homeNode?.configured ? homeNode.source : '') || (frontendLocal ? 'local-backend-session' : 'route-diagnostics'),
    routeDiagnostics,
  };
}

function orderedProviders(primaryOrder = [], fallbackOrder = []) {
  return [...new Set([
    ...primaryOrder,
    ...normalizeFallbackOrder(fallbackOrder),
    ...Object.keys(PROVIDER_DEFINITIONS),
  ])].filter((providerKey) => PROVIDER_DEFINITIONS[providerKey]);
}

function getReadyProviders(providerHealthSnapshot = {}, providerKeys = []) {
  return providerKeys.filter((providerKey) => providerHealthSnapshot[providerKey]?.ok);
}

export function resolveRoutingPlan(routerConfig = {}, providerHealthSnapshot = {}) {
  const requestedProvider = normalizeProviderSelection(routerConfig.provider);
  const requestedRouteMode = normalizeRouteMode(routerConfig.routeMode);
  const runtimeContext = normalizeRuntimeContext(routerConfig.runtimeContext);
  const readyLocalProviders = getReadyProviders(providerHealthSnapshot, LOCAL_PROVIDER_KEYS);
  const readyCloudProviders = getReadyProviders(providerHealthSnapshot, CLOUD_FIRST_PROVIDER_KEYS.filter((providerKey) => CLOUD_PROVIDER_KEYS.includes(providerKey)));
  const localAvailable = readyLocalProviders.length > 0;
  const cloudAvailable = readyCloudProviders.length > 0;

  const effectiveRouteMode = requestedRouteMode === 'auto'
    ? runtimeContext.deviceContext === 'lan-companion'
      ? (localAvailable ? 'local-first' : (cloudAvailable ? 'cloud-first' : 'local-first'))
      : runtimeContext.sessionKind === 'hosted-web'
        ? (cloudAvailable ? 'cloud-first' : 'local-first')
        : (localAvailable ? 'local-first' : (cloudAvailable ? 'cloud-first' : 'local-first'))
    : requestedRouteMode;

  const preferredOrder = effectiveRouteMode === 'explicit'
    ? [requestedProvider]
    : effectiveRouteMode === 'cloud-first'
      ? CLOUD_FIRST_PROVIDER_KEYS
      : LOCAL_FIRST_PROVIDER_KEYS;

  const attemptOrder = orderedProviders(preferredOrder, routerConfig.fallbackEnabled === false ? [] : routerConfig.fallbackOrder)
    .filter((providerKey) => {
      if (providerKey === 'openrouter') {
        return Boolean(providerHealthSnapshot.openrouter?.config?.enabled || providerHealthSnapshot.openrouter?.ok);
      }
      return true;
    });

  const selectedProvider = effectiveRouteMode === 'explicit'
    ? requestedProvider
    : attemptOrder.find((providerKey) => providerHealthSnapshot[providerKey]?.ok) || attemptOrder[0] || requestedProvider;

  return {
    requestedProvider,
    requestedRouteMode,
    effectiveRouteMode,
    selectedProvider,
    attemptOrder: effectiveRouteMode === 'explicit' ? [requestedProvider] : attemptOrder,
    readyLocalProviders,
    readyCloudProviders,
    localAvailable,
    cloudAvailable,
    runtimeContext,
  };
}

export function buildRouterConfig(config = {}) {
  return {
    provider: normalizeProviderSelection(config.provider),
    routeMode: normalizeRouteMode(config.routeMode || DEFAULT_ROUTE_MODE),
    devMode: config.devMode !== false,
    fallbackEnabled: config.fallbackEnabled !== false,
    fallbackOrder: normalizeFallbackOrder(config.fallbackOrder || FALLBACK_PROVIDER_KEYS),
    providerConfigs: config.providerConfigs || {},
    runtimeContext: normalizeRuntimeContext(config.runtimeContext),
  };
}

export function extractLatestUserIntent(messages = []) {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user');
  return latestUser?.content?.trim() || 'Continue the mission.';
}
