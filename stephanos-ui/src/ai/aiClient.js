import { EMPTY_RESPONSE } from './aiTypes';
import {
  buildApiUrl,
  getApiConfig,
  getApiRuntimeConfig,
  getApiTargetLabel,
  resolveAdminAuthorityUrl,
} from './apiConfig';
import { DEFAULT_PROVIDER_KEY } from './providerConfig';
import { resolveUiRequestTimeoutPolicy } from './timeoutPolicy';

const HOSTED_COGNITION_CONTRACT_VERSION = 'stephanos.hosted-cognition.v1';
const HOSTED_COGNITION_CHAT_PATH = '/api/ai/chat';
const HOSTED_COGNITION_PROVIDER_ORDER = ['groq', 'gemini'];

function normalizeResponse(json) {
  return { ...EMPTY_RESPONSE, ...(json && typeof json === 'object' ? json : {}) };
}

function createTransportError({ code, message, details }) {
  return { ok: false, code, message, details, isTransportError: true };
}

function stripSecretsFromProviderConfigs(providerConfigs = {}) {
  return Object.fromEntries(
    Object.entries(providerConfigs || {}).map(([provider, config]) => {
      const source = config && typeof config === 'object' ? config : {};
      const { apiKey, ...rest } = source;
      return [provider, rest];
    }),
  );
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function resolveHostedWorkerEndpoint(baseUrl = '', chatPath = HOSTED_COGNITION_CHAT_PATH) {
  const normalizedBaseUrl = String(baseUrl || '').trim();
  if (!normalizedBaseUrl) {
    return '';
  }
  try {
    const targetUrl = new URL(chatPath || HOSTED_COGNITION_CHAT_PATH, normalizedBaseUrl.endsWith('/') ? normalizedBaseUrl : `${normalizedBaseUrl}/`);
    return targetUrl.toString();
  } catch {
    return '';
  }
}

function resolveHostedCloudDispatch({
  routeDecision = {},
  runtimeConfig = {},
  requestedProvider = '',
} = {}) {
  const hostedConfig = runtimeConfig?.hostedCloudConfig || {};
  const configuredSelectedProvider = String(hostedConfig?.selectedProvider || '').trim().toLowerCase();
  const selectedProvider = configuredSelectedProvider || 'groq';
  const requestedProviderNormalized = String(
    configuredSelectedProvider
    || routeDecision?.requestedProviderForRequest
    || routeDecision?.selectedProvider
    || requestedProvider
    || '',
  ).trim().toLowerCase();
  const providerOrder = [
    requestedProviderNormalized || selectedProvider,
    ...HOSTED_COGNITION_PROVIDER_ORDER.filter((providerKey) => providerKey !== requestedProviderNormalized && providerKey !== selectedProvider),
  ];
  const providerCandidates = providerOrder.map((providerKey) => {
    const provider = String(providerKey || '').trim().toLowerCase();
    const providerProxy = String(
      hostedConfig?.providers?.[provider]?.baseURL
      || hostedConfig?.providerProxyUrls?.[provider]
      || '',
    ).trim();
    const sharedProxy = String(hostedConfig?.proxyUrl || '').trim();
    const targetBaseUrl = providerProxy || sharedProxy;
    let validTarget = false;
    try {
      if (targetBaseUrl) {
        const parsed = new URL(targetBaseUrl);
        validTarget = parsed.protocol === 'https:' || parsed.protocol === 'http:';
      }
    } catch {
      validTarget = false;
    }
    const providerEnabled = hostedConfig?.providers?.[provider]?.enabled !== false;
    const enabled = hostedConfig?.enabled === true && providerEnabled && validTarget;
    const providerHealth = hostedConfig?.lastHealth?.[provider] || {};
    const reachableNow = providerHealth.reachable === true;
    const explicitHealthHealthy = reachableNow || providerHealth.status === 'healthy' || providerHealth.ok === true;
    return {
      provider,
      targetBaseUrl,
      validTarget,
      providerEnabled,
      enabled,
      providerHealth,
      reachableNow,
      explicitHealthHealthy,
    };
  });
  const selectedAnswerMode = String(routeDecision?.selectedAnswerMode || '').trim().toLowerCase();
  const optimisticExecutionConditions = (
    routeDecision?.battleBridgeAuthorityAvailable === false
    || routeDecision?.executionDeferred === true
    || selectedAnswerMode === 'route-unavailable'
    || selectedAnswerMode === 'cloud-basic'
  );
  const providerSelection = providerCandidates.find((candidate) => candidate.provider === requestedProviderNormalized)
    || providerCandidates.find((candidate) => candidate.provider === selectedProvider)
    || providerCandidates[0]
    || {
      provider: requestedProviderNormalized || selectedProvider || 'groq',
      enabled: false,
      providerEnabled: false,
      validTarget: false,
      explicitHealthHealthy: false,
      reachableNow: false,
      targetBaseUrl: '',
      providerHealth: {},
    };
  const selectedProviderCandidate = providerCandidates.find((candidate) => candidate.provider === selectedProvider) || providerSelection;
  const optimisticExecutionAllowed = providerSelection.enabled
    && !providerSelection.explicitHealthHealthy
    && optimisticExecutionConditions;
  const executableNow = providerSelection.enabled && (providerSelection.explicitHealthHealthy || optimisticExecutionAllowed);
  const selectedProviderExecutableNow = selectedProviderCandidate.enabled && (
    selectedProviderCandidate.explicitHealthHealthy
    || optimisticExecutionAllowed
  );
  const fallbackCandidate = executableNow
    ? providerSelection
    : providerCandidates.find((candidate) => candidate.enabled && (
      candidate.explicitHealthHealthy
      || optimisticExecutionConditions
    ));
  const activeProvider = fallbackCandidate?.provider || providerSelection.provider;
  const providerSwitchApplied = Boolean(
    activeProvider
    && selectedProvider
    && activeProvider !== selectedProvider
    && fallbackCandidate?.enabled,
  );
  const activeCandidate = fallbackCandidate || providerSelection;
  const blockedReason = fallbackCandidate
    ? ''
    : (!selectedProviderCandidate.providerEnabled
      ? 'provider-disabled'
      : 'no-hosted-provider-executable');
  const operatorAction = fallbackCandidate
    ? ''
    : (!selectedProviderCandidate.providerEnabled
      ? `Selected provider (${selectedProvider}) is disabled for hosted cognition. Enable it or enable an alternate hosted provider with a healthy Worker endpoint.`
      : 'No hosted provider is executable now. Verify hosted provider enablement, Worker base URLs, and health probes.');
  const providerSelectionReason = providerSwitchApplied
    ? 'selected-provider-unavailable-switched-to-hosted-alternative'
    : (selectedProviderExecutableNow ? 'selected-provider-executable' : 'selected-provider-not-executable');

  return {
    enabled: Boolean(fallbackCandidate?.enabled),
    executableNow: Boolean(fallbackCandidate),
    reachableNow: activeCandidate.reachableNow === true,
    targetBaseUrl: activeCandidate.targetBaseUrl,
    chatPath: String(hostedConfig?.chatPath || HOSTED_COGNITION_CHAT_PATH).trim() || HOSTED_COGNITION_CHAT_PATH,
    provider: activeProvider,
    selectedProvider,
    requestedProvider: String(requestedProviderNormalized || requestedProvider || '').trim().toLowerCase(),
    providerSelectionReason,
    providerSwitchApplied,
    selectedProviderExecutableNow,
    selectedProviderReason: selectedProviderCandidate.providerEnabled ? 'provider-not-executable' : 'provider-disabled',
    blockedReason,
    operatorAction,
    hostedProviderStatus: providerCandidates.map((candidate) => ({
      provider: candidate.provider,
      enabled: candidate.enabled,
      providerEnabled: candidate.providerEnabled,
      executableNow: candidate.enabled && (candidate.explicitHealthHealthy || optimisticExecutionConditions),
      reachableNow: candidate.reachableNow === true,
      reason: candidate.providerEnabled ? 'provider-enabled' : 'provider-disabled',
    })),
    secretPathKind: String(routeDecision?.hostedCloudSecretPathKind || 'none'),
    authorityLevel: String(routeDecision?.hostedCloudAuthorityLevel || 'none'),
    providerPath: String(routeDecision?.hostedCloudExecutionProvider || 'hosted-cloud-worker'),
    actualProviderUsed: `${activeProvider}-hosted-cloud`,
    executionDeferred: routeDecision?.executionDeferred === true,
    battleBridgeAuthorityAvailable: routeDecision?.battleBridgeAuthorityAvailable === true,
    routeTruthAvailable: routeDecision?.hostedCloudPathAvailable === true,
    optimisticExecutionAllowed,
    validTarget: activeCandidate.validTarget === true,
  };
}

function shouldPreferHostedDispatch(hostedDispatch = {}, routeDecision = {}) {
  if (!hostedDispatch?.enabled) return false;
  if (hostedDispatch?.providerSwitchApplied === true && hostedDispatch?.executableNow === true) return true;
  if (hostedDispatch?.provider === hostedDispatch?.selectedProvider && hostedDispatch?.executableNow) return true;
  if (routeDecision?.battleBridgeAuthorityAvailable === false) return true;
  if (hostedDispatch?.battleBridgeAuthorityAvailable === false) return true;
  if (routeDecision?.executionDeferred === true || hostedDispatch?.executionDeferred === true) return true;
  const selectedAnswerMode = String(routeDecision?.selectedAnswerMode || '').trim().toLowerCase();
  return selectedAnswerMode === 'cloud-basic' || selectedAnswerMode === 'route-unavailable';
}

function normalizeHostedCloudResponseData(data = {}, fallbackProvider = '', selectedProvider = '') {
  const source = data && typeof data === 'object' ? data : {};
  const nestedData = source?.data && typeof source.data === 'object' ? source.data : {};
  const textOutput = String(
    source.output_text
    || nestedData.output_text
    || source.output
    || nestedData.output
    || source.response
    || nestedData.response
    || '',
  );
  const provider = String(source.provider || nestedData.provider || fallbackProvider || '').trim();
  const model = String(source.model || nestedData.model || '').trim();
  const executionMetadata = {
    ...((nestedData.execution_metadata && typeof nestedData.execution_metadata === 'object') ? nestedData.execution_metadata : {}),
    ...((source.execution_metadata && typeof source.execution_metadata === 'object') ? source.execution_metadata : {}),
    actual_provider_used: source.execution_metadata?.actual_provider_used
      || nestedData.execution_metadata?.actual_provider_used
      || provider
      || `${fallbackProvider}-hosted-cloud`,
    selected_provider: source.execution_metadata?.selected_provider
      || nestedData.execution_metadata?.selected_provider
      || selectedProvider
      || fallbackProvider,
    execution_selected_provider: source.execution_metadata?.execution_selected_provider
      || nestedData.execution_metadata?.execution_selected_provider
      || `${fallbackProvider}-hosted-cloud`,
    authority_level: source.execution_metadata?.authority_level
      || nestedData.execution_metadata?.authority_level
      || 'cloud-cognition-only',
    selected_provider_truth: source.execution_metadata?.selected_provider_truth
      || nestedData.execution_metadata?.selected_provider_truth
      || fallbackProvider,
    executable_provider_truth: source.execution_metadata?.executable_provider_truth
      || nestedData.execution_metadata?.executable_provider_truth
      || `${fallbackProvider}-hosted-cloud`,
    execution_deferred: true,
  };

  return {
    ...source,
    ok: source.ok !== false,
    data: {
      ...nestedData,
      output_text: textOutput || nestedData.output_text || '',
      provider: provider || nestedData.provider || `${fallbackProvider}-hosted-cloud`,
      actual_provider_used: nestedData.actual_provider_used || source.actual_provider_used || `${fallbackProvider}-hosted-cloud`,
      provider_model: nestedData.provider_model || model || null,
      model_used: nestedData.model_used || model || null,
      execution_metadata: executionMetadata,
    },
  };
}

function buildHostedCloudPayload({
  payload,
  hostedDispatch,
  requestedProvider,
  routeDecision,
}) {
  return {
    contractVersion: HOSTED_COGNITION_CONTRACT_VERSION,
    requestKind: 'hosted-cloud-cognition-chat',
    prompt: payload.prompt,
    provider: hostedDispatch.provider || requestedProvider,
    selectedProvider: hostedDispatch.selectedProvider || routeDecision?.selectedProvider || requestedProvider,
    executableProvider: `${hostedDispatch.provider || requestedProvider}-hosted-cloud`,
    actualProviderUsed: hostedDispatch.actualProviderUsed || `${requestedProvider}-hosted-cloud`,
    authorityLevel: hostedDispatch.authorityLevel || 'cloud-cognition-only',
    executionDeferred: true,
    model: payload.providerConfigs?.[hostedDispatch.provider || requestedProvider]?.model
      || payload.providerConfig?.model
      || '',
    routeMode: payload.routeMode,
    continuityMode: payload.continuityMode,
    runtimeContext: {
      ...(payload.runtimeContext || {}),
      hostedCloudExecutionPath: {
        active: true,
        secretPathKind: hostedDispatch.secretPathKind,
        authorityLevel: hostedDispatch.authorityLevel,
        providerPath: hostedDispatch.providerPath,
        battleBridgeAuthorityAvailable: false,
      },
    },
    contextAssemblyMetadata: payload.contextAssemblyMetadata || {},
    continuityContext: payload.continuityContext || null,
    freshnessContext: payload.freshnessContext || null,
    routeDecision: payload.routeDecision || routeDecision || null,
  };
}

async function requestHostedCloudChat({ hostedDispatch, hostedPayload, runtimeContext, timeoutPolicy }) {
  const hostedRuntimeContext = {
    ...runtimeContext,
    baseUrl: hostedDispatch.targetBaseUrl,
  };
  try {
    const hostedResult = await requestJson(hostedDispatch.chatPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hostedPayload),
    }, hostedRuntimeContext, timeoutPolicy);
    return {
      ...hostedResult,
      data: normalizeHostedCloudResponseData(
        hostedResult.data,
        hostedDispatch.provider,
        hostedDispatch.selectedProvider,
      ),
    };
  } catch (error) {
    const status = Number(error?.details?.status || 0);
    const mappedCode = error?.code === 'TIMEOUT'
      ? 'hosted-worker-timeout'
      : error?.code === 'INVALID_JSON'
        ? 'hosted-worker-invalid-response'
        : status === 401 || status === 403
          ? 'hosted-worker-provider-auth-failed'
          : status === 404
            ? 'hosted-worker-disabled'
            : status >= 400 && status < 500
              ? 'hosted-worker-misconfigured'
              : 'hosted-worker-unreachable';
    throw createTransportError({
      code: mappedCode,
      message: error?.message || 'Hosted Worker request failed.',
      details: {
        ...(error?.details || {}),
        hostedProvider: hostedDispatch.provider,
        hostedEndpoint: hostedDispatch.targetBaseUrl,
      },
    });
  }
}

export async function testHostedCloudWorkerConnection({
  providerKey = 'gemini',
  hostedCloudConfig = {},
  providerConfigs = {},
  runtimeConfig = getApiRuntimeConfig(),
} = {}) {
  const provider = String(providerKey || '').trim().toLowerCase();
  const providerConfig = hostedCloudConfig?.providers?.[provider] || {};
  const baseURL = String(providerConfig?.baseURL || hostedCloudConfig?.providerProxyUrls?.[provider] || '').trim();
  const model = String(providerConfig?.model || providerConfigs?.[provider]?.model || '').trim();
  const chatPath = String(hostedCloudConfig?.chatPath || HOSTED_COGNITION_CHAT_PATH).trim() || HOSTED_COGNITION_CHAT_PATH;
  const checkedAt = new Date().toISOString();
  const endpoint = resolveHostedWorkerEndpoint(baseURL, chatPath);

  if (!baseURL || !endpoint) {
    return {
      ok: false,
      provider,
      reachable: false,
      status: 0,
      parseSuccess: false,
      checkedAt,
      reason: !baseURL ? 'missing-worker-base-url' : 'invalid-worker-url',
      detail: !baseURL ? 'Set a Worker/proxy base URL before testing.' : 'Worker URL or chat path is invalid.',
      model,
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Stephanos-Probe': 'health' },
      body: JSON.stringify({
        contractVersion: HOSTED_COGNITION_CONTRACT_VERSION,
        requestKind: 'hosted-cloud-cognition-health-probe',
        provider,
        model,
        authorityLevel: 'cloud-cognition-only',
      }),
    });
    const raw = await response.text();
    let parseSuccess = false;
    let parsed = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
        parseSuccess = true;
      } catch {
        parseSuccess = false;
      }
    }
    const normalized = parseSuccess ? normalizeHostedCloudResponseData(parsed, provider) : null;
    const reachable = response.ok;
    return {
      ok: reachable && parseSuccess,
      provider,
      reachable,
      status: response.status,
      parseSuccess,
      checkedAt,
      reason: reachable
        ? (parseSuccess ? 'probe-ok' : 'probe-parse-failed')
        : `probe-http-${response.status}`,
      detail: reachable
        ? (parseSuccess ? 'Hosted Worker reachable and parseable.' : 'Hosted Worker reachable but returned non-JSON payload.')
        : (normalized?.error || `Hosted Worker returned status ${response.status}.`),
      model: model || normalized?.data?.model_used || null,
      authorityLevel: 'cloud-cognition-only',
      executionPath: `${provider}-hosted-cloud`,
      endpoint,
      runtimeConfig,
    };
  } catch (error) {
    return {
      ok: false,
      provider,
      reachable: false,
      status: 0,
      parseSuccess: false,
      checkedAt,
      reason: 'probe-transport-error',
      detail: error?.message || 'Hosted Worker probe failed.',
      model,
      authorityLevel: 'cloud-cognition-only',
      executionPath: `${provider}-hosted-cloud`,
      endpoint,
    };
  }
}

async function probeHostedProviderHealth({
  providerKey,
  hostedCloudConfig,
  providerConfigs,
  runtimeConfig,
  timeoutPolicy,
}) {
  const provider = String(providerKey || '').trim().toLowerCase();
  const providerConfig = hostedCloudConfig?.providers?.[provider] || {};
  const enabled = hostedCloudConfig?.enabled === true && providerConfig?.enabled !== false;
  const baseUrl = String(providerConfig?.baseURL || hostedCloudConfig?.providerProxyUrls?.[provider] || hostedCloudConfig?.proxyUrl || '').trim();
  const model = String(providerConfig?.model || providerConfigs?.[provider]?.model || '').trim();
  const chatPath = String(hostedCloudConfig?.chatPath || '/api/ai/chat').trim() || '/api/ai/chat';
  const checkedAt = new Date().toISOString();
  if (!enabled || !baseUrl) {
    return {
      ok: false,
      status: 0,
      detail: enabled ? 'Hosted Worker base URL is not configured.' : 'Hosted cognition is disabled for this provider.',
      reachable: false,
      transportReachable: false,
      executableNow: false,
      authorityLevel: 'cloud-cognition-only',
      executionPath: `${provider}-hosted-cloud`,
      reason: enabled ? 'missing-worker-base-url' : 'provider-disabled',
      checkedAt,
      model,
    };
  }

  const hostedRuntimeContext = { ...runtimeConfig, baseUrl };
  const probePayload = {
    contractVersion: HOSTED_COGNITION_CONTRACT_VERSION,
    requestKind: 'hosted-cloud-cognition-health-probe',
    provider,
    model,
    authorityLevel: 'cloud-cognition-only',
  };

  try {
    const result = await requestJson(chatPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Stephanos-Probe': 'health' },
      body: JSON.stringify(probePayload),
    }, hostedRuntimeContext, timeoutPolicy);
    const responseData = normalizeHostedCloudResponseData(result.data, provider);
    const reachable = result.ok;
    return {
      ok: reachable,
      status: result.status,
      detail: reachable
        ? 'Hosted Worker reached via chat-path probe.'
        : (responseData?.error || `Hosted Worker returned status ${result.status}.`),
      reachable,
      transportReachable: reachable,
      executableNow: reachable,
      authorityLevel: 'cloud-cognition-only',
      executionPath: `${provider}-hosted-cloud`,
      reason: reachable ? 'probe-ok' : 'probe-failed',
      checkedAt,
      model: model || responseData?.data?.model_used || null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      detail: error?.message || 'Hosted Worker probe request failed.',
      reachable: false,
      transportReachable: false,
      executableNow: false,
      authorityLevel: 'cloud-cognition-only',
      executionPath: `${provider}-hosted-cloud`,
      reason: error?.code || 'probe-transport-error',
      checkedAt,
      model,
      errorCode: error?.code || '',
    };
  }
}

export function resolveTimeoutExecutionTruth({
  requestedProvider = '',
  routeDecision = null,
  runtimeConfig = {},
  providerConfigs = {},
  timeoutExecutionEnvelope = null,
} = {}) {
  const runtimeFinalRouteTruth = runtimeConfig?.finalRouteTruth || runtimeConfig?.runtimeTruth?.finalRouteTruth || {};
  const canonicalRouteTruth = runtimeConfig?.canonicalRouteRuntimeTruth || runtimeConfig?.runtimeTruth?.canonicalRouteRuntimeTruth || {};
  const requestedProviderNormalized = String(requestedProvider || '').trim().toLowerCase();
  const hydratedEnvelope = timeoutExecutionEnvelope && typeof timeoutExecutionEnvelope === 'object'
    ? timeoutExecutionEnvelope
    : (runtimeConfig?.timeoutExecutionEnvelope && typeof runtimeConfig.timeoutExecutionEnvelope === 'object'
      ? runtimeConfig.timeoutExecutionEnvelope
      : {});
  const localRouteViable = routeDecision?.requestDispatchGate?.localRouteViable ?? routeDecision?.localRouteAvailable ?? null;
  const selectedAnswerMode = String(
    routeDecision?.requestDispatchGate?.selectedAnswerMode
    || routeDecision?.selectedAnswerMode
    || '',
  ).trim().toLowerCase();
  const providerModeReconciled = (selectedAnswerMode === 'local-private' || selectedAnswerMode === 'fallback-stale-risk')
    && localRouteViable === true
    ? 'ollama'
    : '';
  const effectiveProvider = firstNonEmpty(
    runtimeFinalRouteTruth?.executedProvider,
    runtimeFinalRouteTruth?.selectedProvider,
    canonicalRouteTruth?.executedProvider,
    canonicalRouteTruth?.selectedProvider,
    hydratedEnvelope?.effectiveProvider,
    hydratedEnvelope?.timeoutProvider,
    providerModeReconciled,
    routeDecision?.requestedProviderForRequest,
    routeDecision?.selectedProvider,
    requestedProviderNormalized,
  ).toLowerCase();
  const effectiveModel = firstNonEmpty(
    hydratedEnvelope?.effectiveModel,
    hydratedEnvelope?.timeoutModel,
    providerConfigs?.[effectiveProvider]?.model,
  );
  return {
    requestedProvider: requestedProviderNormalized || '',
    effectiveProvider: effectiveProvider || requestedProviderNormalized || '',
    effectiveModel: String(effectiveModel || '').trim(),
  };
}

async function requestJson(path, options = {}, runtimeConfig = getApiRuntimeConfig(), timeoutPolicy = null) {
  const apiConfig = getApiConfig();
  const resolvedTimeoutMs = Number(timeoutPolicy?.uiRequestTimeoutMs) || Number(runtimeConfig?.timeoutMs) || apiConfig.timeoutMs;
  const timeoutMs = Number.isFinite(resolvedTimeoutMs) && resolvedTimeoutMs > 0 ? resolvedTimeoutMs : apiConfig.timeoutMs;
  const baseUrl = runtimeConfig?.baseUrl || apiConfig.baseUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildApiUrl(path, baseUrl), { ...options, signal: controller.signal });
    const raw = await response.text();
    let json = {};

    if (raw) {
      try { json = JSON.parse(raw); } catch {
        throw createTransportError({ code: 'INVALID_JSON', message: 'Backend returned malformed JSON.', details: { status: response.status, raw } });
      }
    }

    return { ok: response.ok, status: response.status, data: json };
  } catch (error) {
    if (error?.isTransportError) throw error;
    if (error?.name === 'AbortError') {
      throw createTransportError({
        code: 'TIMEOUT',
        message: `Request timed out after ${timeoutMs}ms.`,
        details: {
          timeoutFailureLayer: 'ui',
          timeoutLabel: 'ui_request_timeout_ms',
          timeoutMs,
          timeoutPolicySource: timeoutPolicy?.timeoutPolicySource || runtimeConfig?.timeoutSource || apiConfig.timeoutSource || 'frontend:api-runtime',
          uiRequestTimeoutMs: timeoutPolicy?.uiRequestTimeoutMs || timeoutMs,
          backendRouteTimeoutMs: timeoutPolicy?.backendRouteTimeoutMs || null,
          providerTimeoutMs: timeoutPolicy?.providerTimeoutMs || null,
          modelTimeoutMs: timeoutPolicy?.modelTimeoutMs || null,
          timeoutProvider: timeoutPolicy?.timeoutProvider || null,
          timeoutRequestedProvider: timeoutPolicy?.timeoutRequestedProvider || null,
          timeoutModel: timeoutPolicy?.timeoutModel || null,
          timeoutOverrideApplied: Boolean(timeoutPolicy?.timeoutOverrideApplied),
        },
      });
    }
    const networkLikeFailure = error instanceof TypeError || /network|failed to fetch|load failed|cors/i.test(String(error?.message || ''));
    throw createTransportError({
      code: networkLikeFailure ? 'NETWORK_TRANSPORT_UNREACHABLE' : 'BACKEND_OFFLINE',
      message: networkLikeFailure
        ? 'Backend transport request failed before a response was received. Check network/CORS/reachability from this frontend origin.'
        : 'Unable to reach backend API. Check that the server is running and reachable.',
      details: { reason: error?.message },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function requestEventStream(path, options = {}, runtimeConfig = getApiRuntimeConfig(), timeoutPolicy = null, { onEvent } = {}) {
  const apiConfig = getApiConfig();
  const resolvedTimeoutMs = Number(timeoutPolicy?.uiRequestTimeoutMs) || Number(runtimeConfig?.timeoutMs) || apiConfig.timeoutMs;
  const timeoutMs = Number.isFinite(resolvedTimeoutMs) && resolvedTimeoutMs > 0 ? resolvedTimeoutMs : apiConfig.timeoutMs;
  const baseUrl = runtimeConfig?.baseUrl || apiConfig.baseUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(buildApiUrl(path, baseUrl), {
      ...options,
      headers: {
        ...(options.headers || {}),
        Accept: 'text/event-stream',
      },
      signal: controller.signal,
    });
    if (!response.ok || !response.body?.getReader) {
      const fallback = await response.text();
      return { ok: response.ok, status: response.status, data: fallback ? JSON.parse(fallback) : {} };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventName = '';
    let finalPayload = null;
    let finalText = '';
    let sawToken = false;
    let sawCompletion = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';
      chunks.forEach((chunk) => {
        const lines = chunk.split('\n');
        let dataLine = '';
        eventName = '';
        lines.forEach((line) => {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          if (line.startsWith('data:')) dataLine += line.slice(5).trim();
        });
        if (!dataLine) return;
        let parsed = {};
        try {
          parsed = JSON.parse(dataLine);
        } catch {
          return;
        }
        onEvent?.(eventName || parsed?.type || 'message', parsed);
        if ((eventName === 'token' || parsed.type === 'token') && typeof parsed.content === 'string') {
          sawToken = true;
          finalText += parsed.content;
        }
        if ((eventName === 'final' || parsed.type === 'final') && typeof parsed.content === 'string') {
          finalText = parsed.content;
        }
        if ((eventName === 'metadata' || parsed.type === 'metadata') && parsed?.data) {
          finalPayload = parsed.data;
        }
        if (eventName === 'complete' || parsed.type === 'complete') {
          sawCompletion = true;
        }
      });
    }
    if (finalPayload && typeof finalPayload === 'object') {
      return {
        ok: true,
        status: response.status,
        data: {
          ...finalPayload,
          __stream: {
            used: true,
            finalized: sawCompletion === true,
            metadataReceived: true,
          },
        },
      };
    }
    if (sawToken && finalText) {
      return {
        ok: true,
        status: response.status,
        data: {
          success: true,
          type: 'assistant_response',
          route: 'assistant',
          output_text: finalText,
          data: {
            execution_metadata: {
              streaming_used: true,
              streaming_finalized: false,
            },
            request_trace: {
              streaming_used: true,
              streaming_finalized: false,
            },
          },
          __stream: {
            used: true,
            finalized: false,
            metadataReceived: false,
            warning: 'stream-metadata-missing',
          },
        },
      };
    }
    throw createTransportError({
      code: 'STREAM_FINALIZATION_MISSING',
      message: 'Streaming response ended without final metadata.',
      details: { sawToken, sawCompletion },
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createTransportError({ code: 'TIMEOUT', message: `Request timed out after ${timeoutMs}ms.` });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestMemory(path, options = {}, runtimeConfig = getApiRuntimeConfig()) {
  const result = await requestJson(path, options, runtimeConfig);
  if (!result.ok) {
    const message = result.data?.error || `Memory request failed (${result.status}).`;
    throw new Error(message);
  }

  return result.data;
}

export async function sendPrompt({
  prompt,
  provider = DEFAULT_PROVIDER_KEY,
  routeMode = 'auto',
  providerConfigs = {},
  fallbackEnabled = true,
  fallbackOrder = [],
  devMode = true,
  runtimeConfig = getApiRuntimeConfig(),
  tileContext = null,
  continuityContext = null,
  continuityMode = '',
  freshnessContext = null,
  routeDecision = null,
  contextAssembly = null,
  streamingMode = 'off',
  onStreamEvent = null,
}) {
  const safeProviderConfigs = stripSecretsFromProviderConfigs(providerConfigs);
  const timeoutExecutionTruth = resolveTimeoutExecutionTruth({
    requestedProvider: provider,
    routeDecision,
    runtimeConfig,
    providerConfigs: safeProviderConfigs,
    timeoutExecutionEnvelope: runtimeConfig?.timeoutExecutionEnvelope || null,
  });
  const timeoutPolicy = resolveUiRequestTimeoutPolicy({
    runtimeConfig,
    provider: timeoutExecutionTruth.effectiveProvider,
    providerConfigs: safeProviderConfigs,
    requestedModel: timeoutExecutionTruth.effectiveModel,
  });
  const timeoutPolicyWithExecution = {
    ...timeoutPolicy,
    timeoutProvider: timeoutExecutionTruth.effectiveProvider,
    timeoutRequestedProvider: timeoutExecutionTruth.requestedProvider || provider,
    timeoutModel: timeoutExecutionTruth.effectiveModel || timeoutPolicy.timeoutModel || null,
  };
  const runtimeContext = {
    ...runtimeConfig,
    timeoutMs: timeoutPolicyWithExecution.uiRequestTimeoutMs,
    timeoutExecutionEnvelope: {
      requestedProvider: timeoutExecutionTruth.requestedProvider || provider,
      effectiveProvider: timeoutExecutionTruth.effectiveProvider || provider,
      effectiveModel: timeoutExecutionTruth.effectiveModel || null,
    },
    timeoutPolicy: {
      uiRequestTimeoutMs: timeoutPolicyWithExecution.uiRequestTimeoutMs,
      backendRouteTimeoutMs: timeoutPolicyWithExecution.backendRouteTimeoutMs,
      providerTimeoutMs: timeoutPolicyWithExecution.providerTimeoutMs,
      modelTimeoutMs: timeoutPolicyWithExecution.modelTimeoutMs,
      timeoutPolicySource: timeoutPolicyWithExecution.timeoutPolicySource,
      timeoutOverrideApplied: timeoutPolicyWithExecution.timeoutOverrideApplied,
      timeoutProvider: timeoutExecutionTruth.effectiveProvider,
      timeoutModel: timeoutExecutionTruth.effectiveModel || null,
      timeoutRequestedProvider: timeoutExecutionTruth.requestedProvider || null,
    },
    ...(tileContext && typeof tileContext === 'object' ? { tileContext } : {}),
    ...(contextAssembly && typeof contextAssembly === 'object' ? { contextAssembly } : {}),
  };
  const payload = {
    prompt,
    provider,
    routeMode,
    providerConfig: safeProviderConfigs?.[provider] || {},
    providerConfigs: safeProviderConfigs,
    fallbackEnabled,
    fallbackOrder,
    devMode,
    runtimeContext,
    continuityMode: String(continuityMode || '').trim() || 'recording-only',
    ...(continuityContext && typeof continuityContext === 'object' ? { continuityContext } : {}),
    ...(freshnessContext && typeof freshnessContext === 'object' ? { freshnessContext } : {}),
    ...(routeDecision && typeof routeDecision === 'object' ? { routeDecision } : {}),
    ...(contextAssembly?.truthMetadata && typeof contextAssembly.truthMetadata === 'object'
      ? { contextAssemblyMetadata: contextAssembly.truthMetadata }
      : {}),
  };

  const hostedDispatch = resolveHostedCloudDispatch({
    routeDecision,
    runtimeConfig: runtimeContext,
    requestedProvider: provider,
  });
  const hostedPayload = buildHostedCloudPayload({
    payload,
    hostedDispatch,
    requestedProvider: provider,
    routeDecision,
  });
  if (shouldPreferHostedDispatch(hostedDispatch, routeDecision)) {
    const hostedResult = await requestHostedCloudChat({
      hostedDispatch,
      hostedPayload,
      runtimeContext,
      timeoutPolicy: timeoutPolicyWithExecution,
    });
    return {
      ok: hostedResult.ok,
      transportError: null,
      data: normalizeResponse(hostedResult.data),
      requestPayload: payload,
      status: hostedResult.status,
    };
  }

  console.debug('[Stephanos UI] Dispatching /api/ai/chat request', {
    requestedProvider: payload.provider,
    fallbackEnabled: payload.fallbackEnabled,
    fallbackOrder: payload.fallbackOrder,
  });

  let result;
  const normalizedStreamingMode = String(streamingMode || 'off').trim().toLowerCase();
  const streamingRequestedByMode = normalizedStreamingMode === 'on'
    || (normalizedStreamingMode === 'auto' && String(payload.provider || '').toLowerCase() === 'ollama');
  const explicitStreamingRequest = streamingRequestedByMode
    && typeof onStreamEvent === 'function'
    && String(payload.provider || '').toLowerCase() === 'ollama';
  payload.streamingMode = normalizedStreamingMode;
  try {
    if (explicitStreamingRequest) {
      result = await requestEventStream('/api/ai/chat?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, stream: true }),
      }, runtimeContext, timeoutPolicyWithExecution, {
        onEvent: (eventName, eventData) => {
          if (typeof onStreamEvent !== 'function') return;
          onStreamEvent({
            event: eventName,
            ...eventData,
          });
        },
      });
      if (!result?.data?.success) {
        result = await requestJson('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }, runtimeContext, timeoutPolicyWithExecution);
      }
    } else {
      result = await requestJson('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, runtimeContext, timeoutPolicyWithExecution);
    }
  } catch (error) {
    if (explicitStreamingRequest) {
      result = await requestJson('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, runtimeContext, timeoutPolicyWithExecution);
    } else if (!hostedDispatch.enabled) {
      throw error;
    } else {
      result = await requestHostedCloudChat({
        hostedDispatch,
        hostedPayload,
        runtimeContext,
        timeoutPolicy: timeoutPolicyWithExecution,
      });
    }
  }

  return {
    ok: result.ok,
    transportError: null,
    data: normalizeResponse(result.data),
    requestPayload: payload,
    status: result.status,
  };
}

export async function getProviderHealth(payload, runtimeConfig = getApiRuntimeConfig()) {
  const safePayload = {
    ...(payload || {}),
    providerConfigs: stripSecretsFromProviderConfigs(payload?.providerConfigs || {}),
  };
  const requestedProvider = String(safePayload?.provider || DEFAULT_PROVIDER_KEY);
  const requestedModel = safePayload?.providerConfigs?.[requestedProvider]?.model || '';
  const timeoutPolicy = resolveUiRequestTimeoutPolicy({
    runtimeConfig,
    provider: requestedProvider,
    providerConfigs: safePayload.providerConfigs,
    requestedModel,
  });
  try {
    const result = await requestJson('/api/ai/providers/health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(safePayload),
    }, runtimeConfig, timeoutPolicy);
    return { ok: result.ok, status: result.status, data: result.data?.data || {} };
  } catch (error) {
    const hostedCloudConfig = runtimeConfig?.hostedCloudConfig || {};
    if (hostedCloudConfig?.enabled !== true) {
      throw error;
    }

    const [groqHealth, geminiHealth] = await Promise.all([
      probeHostedProviderHealth({
        providerKey: 'groq',
        hostedCloudConfig,
        providerConfigs: safePayload.providerConfigs,
        runtimeConfig,
        timeoutPolicy,
      }),
      probeHostedProviderHealth({
        providerKey: 'gemini',
        hostedCloudConfig,
        providerConfigs: safePayload.providerConfigs,
        runtimeConfig,
        timeoutPolicy,
      }),
    ]);

    return {
      ok: groqHealth.ok || geminiHealth.ok,
      status: 207,
      data: {
        groq: groqHealth,
        gemini: geminiHealth,
      },
    };
  }
}

export {
  normalizeHostedCloudResponseData,
  shouldPreferHostedDispatch,
  buildHostedCloudPayload,
  resolveHostedCloudDispatch,
};

export async function checkApiHealth(runtimeConfig = getApiRuntimeConfig()) {
  const result = await requestJson('/api/health', {}, runtimeConfig);
  return { ok: result.ok, status: result.status, target: getApiTargetLabel(runtimeConfig.baseUrl), baseUrl: runtimeConfig.baseUrl, data: result.data };
}

export { getApiRuntimeConfig };

export async function getLocalProviderSecretStatus(runtimeConfig = getApiRuntimeConfig()) {
  const authority = resolveAdminAuthorityUrl(runtimeConfig);
  if (!authority.ok) {
    console.warn('[SECRET AUTHORITY] denied', {
      sessionKind: authority.sessionKind,
      target: authority.target,
      reason: authority.reason,
      source: authority.source,
    });
    return {
      ok: false,
      status: 403,
      data: {},
      error: 'Local admin secret authority is unavailable for this session.',
      authority,
    };
  }
  console.info('[SECRET AUTHORITY]', {
    sessionKind: authority.sessionKind,
    target: authority.target,
    source: authority.source,
  });
  const result = await requestJson('/api/ai-admin/provider-secrets', {}, { ...runtimeConfig, baseUrl: authority.target });
  return { ok: result.ok, status: result.status, data: result.data?.data || {} };
}

export async function setLocalProviderSecret(provider, apiKey, runtimeConfig = getApiRuntimeConfig()) {
  const authority = resolveAdminAuthorityUrl(runtimeConfig);
  if (!authority.ok) {
    console.warn('[SECRET AUTHORITY] denied', {
      sessionKind: authority.sessionKind,
      target: authority.target,
      reason: authority.reason,
      source: authority.source,
    });
    return {
      ok: false,
      status: 403,
      data: null,
      error: 'Local admin access required. This session cannot write backend local secrets.',
      authority,
    };
  }
  console.info('[SECRET AUTHORITY]', {
    sessionKind: authority.sessionKind,
    target: authority.target,
    source: authority.source,
  });
  const result = await requestJson(`/api/ai-admin/provider-secrets/${encodeURIComponent(provider)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: String(apiKey || '') }),
  }, { ...runtimeConfig, baseUrl: authority.target });
  const response = { ok: result.ok, status: result.status, data: result.data?.data || null, error: result.data?.error || '', authority };
  console.info('[PROVIDER SAVE]', { provider, outcome: response.ok ? 'accepted' : 'rejected' });
  return response;
}

export async function clearLocalProviderSecret(provider, runtimeConfig = getApiRuntimeConfig()) {
  const authority = resolveAdminAuthorityUrl(runtimeConfig);
  if (!authority.ok) {
    console.warn('[SECRET AUTHORITY] denied', {
      sessionKind: authority.sessionKind,
      target: authority.target,
      reason: authority.reason,
      source: authority.source,
    });
    return {
      ok: false,
      status: 403,
      data: null,
      error: 'Local admin access required. This session cannot clear backend local secrets.',
      authority,
    };
  }
  console.info('[SECRET AUTHORITY]', {
    sessionKind: authority.sessionKind,
    target: authority.target,
    source: authority.source,
  });
  const result = await requestJson(`/api/ai-admin/provider-secrets/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
  }, { ...runtimeConfig, baseUrl: authority.target });
  return { ok: result.ok, status: result.status, data: result.data?.data || null, error: result.data?.error || '', authority };
}


export async function getLocalRepoShellConfig(runtimeConfig = getApiRuntimeConfig()) {
  const result = await requestJson('/api/local/repo-shell-config', {}, runtimeConfig);
  return {
    ok: result.ok,
    status: result.status,
    repoPath: String(result.data?.repoPath || ''),
    source: String(result.data?.source || ''),
    windowsOnly: result.data?.windowsOnly !== false,
    reason: String(result.data?.reason || result.data?.error || ''),
  };
}


export async function getLocalGitRitualState(runtimeConfig = getApiRuntimeConfig()) {
  const result = await requestJson('/api/local/git-ritual-state', {}, runtimeConfig);
  return {
    ok: result.ok,
    status: result.status,
    data: result.data && typeof result.data === 'object' ? result.data : {},
    reason: String(result.data?.reason || result.data?.error || ''),
  };
}

export async function openRepoPowerShell(runtimeConfig = getApiRuntimeConfig()) {
  const result = await requestJson('/api/local/open-repo-powershell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }, runtimeConfig);

  return {
    ok: result.ok,
    status: result.status,
    launched: result.data?.launched === true,
    pid: Number.isFinite(Number(result.data?.pid)) ? Number(result.data?.pid) : null,
    repoPath: String(result.data?.repoPath || ''),
    reason: String(result.data?.reason || result.data?.error || ''),
    focusApplied: result.data?.focusApplied === true,
    topmostApplied: result.data?.topmostApplied === true,
  };
}

export async function focusRepoPowerShell(runtimeConfig = getApiRuntimeConfig()) {
  const result = await requestJson('/api/local/focus-repo-powershell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }, runtimeConfig);

  return {
    ok: result.ok,
    status: result.status,
    focused: result.data?.focused === true,
    pid: Number.isFinite(Number(result.data?.pid)) ? Number(result.data?.pid) : null,
    repoPath: String(result.data?.repoPath || ''),
    reason: String(result.data?.reason || result.data?.error || ''),
    focusApplied: result.data?.focusApplied === true,
    topmostApplied: result.data?.topmostApplied === true,
  };
}

export async function listMemoryItems(runtimeConfig = getApiRuntimeConfig()) {
  const result = await requestMemory('/api/memory', {}, runtimeConfig);
  return result.data?.items || [];
}

export async function searchMemoryItems(query, runtimeConfig = getApiRuntimeConfig()) {
  const result = await requestMemory(`/api/memory/search?q=${encodeURIComponent(query)}`, {}, runtimeConfig);
  return result.data?.items || [];
}

export async function createMemoryItem(payload, runtimeConfig = getApiRuntimeConfig()) {
  const normalizedPayload = {
    ...payload,
    tags: Array.isArray(payload.tags) ? payload.tags : String(payload.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean),
  };

  const result = await requestMemory('/api/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalizedPayload),
  }, runtimeConfig);

  return result.data?.item || null;
}
