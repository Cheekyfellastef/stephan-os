import { queryStephanosAI, resolveStephanosAiBackendBaseUrl } from '../../../shared/ai/stephanosClient.mjs';

const CANONICAL_AI_ENDPOINT_PATH = '/api/ai/chat';

function parentRuntimeStatus() {
  const status = globalThis.parent?.runtimeStatusModel || globalThis.runtimeStatusModel || null;
  return status && typeof status === 'object' ? status : null;
}

function aiRouteContext() {
  const status = parentRuntimeStatus();
  return {
    finalRouteTruth: status?.finalRouteTruth || null,
    canonicalRouteRuntimeTruth: status?.canonicalRouteRuntimeTruth || null,
    runtimeTruth: status?.runtimeTruth || null,
    runtimeContext: status?.runtimeContext || null,
    timeoutPolicy: status?.timeoutPolicy || null,
  };
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function musicAiRouterSettings() {
  const status = parentRuntimeStatus() || {};
  const runtimeContext = status.runtimeContext || {};
  const runtimeTruth = status.runtimeTruth || {};
  const finalRouteTruth = status.finalRouteTruth || {};
  const preferences = firstValue(
    status.providerPreferences,
    runtimeContext.providerPreferences,
    runtimeTruth.providerPreferences,
    {},
  );
  const provider = String(firstValue(
    preferences.provider,
    finalRouteTruth.requestedProvider,
    finalRouteTruth.selectedProvider,
    status.provider,
    'ollama',
  )).toLowerCase();
  return {
    provider,
    routeMode: String(firstValue(preferences.routeMode, finalRouteTruth.requestedRouteMode, status.routeMode, 'auto')),
    fallbackEnabled: firstValue(preferences.fallbackEnabled, status.fallbackEnabled, true) !== false,
    fallbackOrder: firstValue(preferences.fallbackOrder, status.fallbackOrder, undefined),
    providerConfigs: firstValue(preferences.providerConfigs, runtimeContext.providerConfigs, runtimeTruth.providerConfigs, undefined),
  };
}

export function getMusicAiStatus() {
  const status = parentRuntimeStatus();
  const finalRouteTruth = status?.finalRouteTruth || {};
  const routeKind = String(finalRouteTruth.selectedRouteKind || finalRouteTruth.routeKind || status?.routeKind || 'unknown');
  const provider = String(finalRouteTruth.executedProvider || finalRouteTruth.selectedProvider || status?.executedProvider || 'unknown');
  const available = Boolean(routeKind && routeKind !== 'unavailable' && provider && provider !== 'unknown' && provider !== 'none');
  const freshnessUnavailable = /local|dist|ollama|mock|private/.test(`${routeKind} ${provider}`.toLowerCase());
  return {
    available,
    routeKind,
    provider,
    freshWeb: !freshnessUnavailable,
    modeLabel: /local|home-node|dist/.test(routeKind) ? 'Using local/private route' : 'Using hosted route',
  };
}

export function getMusicAiRuntimeDiagnostics() {
  const context = aiRouteContext();
  const status = getMusicAiStatus();
  const backendBaseUrl = resolveStephanosAiBackendBaseUrl(context);
  return {
    endpointPath: CANONICAL_AI_ENDPOINT_PATH,
    endpointUrl: `${backendBaseUrl.replace(/\/$/, '')}${CANONICAL_AI_ENDPOINT_PATH}`,
    backendBaseUrl,
    routeKind: status.routeKind,
    provider: status.provider,
    available: status.available,
    freshWeb: status.freshWeb,
    routeTruthAvailable: Boolean(context.finalRouteTruth),
  };
}

function classifyAiFailure(error = null) {
  if (!error) return 'request failed';
  if (error?.status === 404) return 'endpoint returned 404';
  if (error?.status === 405) return 'method mismatch (expected POST)';
  if (error?.status === 400) return 'payload invalid';
  if (error?.status >= 500) return 'backend/provider error';
  if (error?.code === 'backend-timeout') return 'backend unreachable';
  if (/fetch|network|failed to fetch|cors|origin/i.test(String(error?.message || ''))) return 'backend unreachable';
  return 'request failed';
}

function extractJsonFromCodeFence(text = '') {
  const match = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : '';
}

function extractFirstJsonObject(text = '') {
  const source = String(text || '');
  const start = source.indexOf('{');
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

export function parseAiJsonResponse(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return { parsed: null, mode: 'text-fallback' };
  try {
    return { parsed: JSON.parse(raw), mode: 'structured-json' };
  } catch {}
  const fenced = extractJsonFromCodeFence(raw);
  if (fenced) {
    try {
      return { parsed: JSON.parse(fenced), mode: 'structured-json' };
    } catch {}
  }
  const objectLike = extractFirstJsonObject(raw);
  if (objectLike) {
    try {
      return { parsed: JSON.parse(objectLike), mode: 'structured-json' };
    } catch {}
  }
  return { parsed: null, mode: 'text-fallback' };
}

export function normalizeMusicAiResponse(response = {}) {
  const data = response?.data && typeof response.data === 'object' ? response.data : {};
  const execution = data.execution_metadata && typeof data.execution_metadata === 'object'
    ? data.execution_metadata
    : {};
  const text = String(response?.output_text || data.reply || response?.reply || response?.text || '').trim();
  return {
    text,
    requestedProvider: String(firstValue(execution.requested_provider, data.requested_provider, 'unknown')),
    selectedProvider: String(firstValue(execution.selected_provider, data.selected_provider, 'unknown')),
    actualProvider: String(firstValue(execution.actual_provider_used, data.actual_provider_used, 'unknown')),
    actualModel: String(firstValue(execution.model_used, data.model_used, 'unknown')),
    fallbackUsed: firstValue(execution.fallback_used, data.fallback_used, false) === true,
    fallbackReason: String(firstValue(execution.fallback_reason, data.fallback_reason, 'none')),
  };
}

export async function askMusicAi(task, payload = {}) {
  const allowLiveVerification = payload.allowLiveVerification === true;
  const tasteDNA = payload.tasteDNA || null;
  const context = aiRouteContext();
  const routerSettings = musicAiRouterSettings();
  const diagnostics = getMusicAiRuntimeDiagnostics();
  try {
    const response = await queryStephanosAI({
      provider: routerSettings.provider,
      routeMode: routerSettings.routeMode,
      fallbackEnabled: routerSettings.fallbackEnabled,
      fallbackOrder: routerSettings.fallbackOrder,
      providerConfigs: routerSettings.providerConfigs,
      messages: [{ role: 'user', content: `Task: ${task}\n${payload.promptInstructions || 'Return strict JSON only.'}\nPayload:\n${JSON.stringify(payload, null, 2)}` }],
      context: { tile: 'music-tile', task, allowLiveVerification, tasteDNA, ...payload },
      runtimeContext: context,
    });
    const normalized = normalizeMusicAiResponse(response);
    const text = normalized.text;
    const parsedResponse = parseAiJsonResponse(text);
    return {
      ok: true,
      parsed: parsedResponse.parsed,
      text,
      diagnostics: {
        ...diagnostics,
        requestReachedBackend: true,
        backendResponded: true,
        responseKind: parsedResponse.mode,
        lastStatus: 200,
        requestedProvider: normalized.requestedProvider,
        selectedProvider: normalized.selectedProvider,
        actualProvider: normalized.actualProvider,
        actualModel: normalized.actualModel,
        fallbackUsed: normalized.fallbackUsed,
        fallbackReason: normalized.fallbackReason,
      },
    };
  } catch (error) {
    return { ok: false, message: classifyAiFailure(error), error: String(error?.message || 'Unknown AI error'), diagnostics: { ...diagnostics, requestReachedBackend: error?.status ? true : false, backendResponded: Boolean(error?.status), lastStatus: Number(error?.status || 0), lastError: String(error?.message || 'Unknown AI error') } };
  }
}



export async function testMusicAiRoute({ fetchImpl = globalThis.fetch } = {}) {
  const diagnostics = getMusicAiRuntimeDiagnostics();
  const routerSettings = musicAiRouterSettings();
  const payload = {
    prompt: 'Reply with: MUSIC_AI_ROUTE_OK',
    provider: routerSettings.provider,
    routeMode: routerSettings.routeMode,
    fallbackEnabled: routerSettings.fallbackEnabled,
    ...(Array.isArray(routerSettings.fallbackOrder) ? { fallbackOrder: routerSettings.fallbackOrder } : {}),
    providerConfig: routerSettings.providerConfigs?.[routerSettings.provider] || {},
    providerConfigs: routerSettings.providerConfigs || {},
    runtimeContext: { ...aiRouteContext(), tileContext: { tile: 'music-tile', task: 'echo-test' } },
  };
  try {
    const res = await fetchImpl(diagnostics.endpointUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    const snippet = String(text || '').slice(0, 180);
    let parsedText = '';
    let normalized = normalizeMusicAiResponse({});
    try { normalized = normalizeMusicAiResponse(JSON.parse(text)); parsedText = normalized.text; } catch {}
    return { ok: res.ok, status: res.status, snippet, parsedText, requestUrl: diagnostics.endpointUrl, method: 'POST', failureReason: res.ok ? '' : classifyAiFailure({ status: res.status }), diagnostics: { ...diagnostics, lastStatus: res.status, backendResponded: true, requestReachedBackend: true, responseKind: 'http-response', requestedProvider: normalized.requestedProvider, selectedProvider: normalized.selectedProvider, actualProvider: normalized.actualProvider, actualModel: normalized.actualModel, fallbackUsed: normalized.fallbackUsed, fallbackReason: normalized.fallbackReason } };
  } catch (error) {
    return { ok: false, status: 0, snippet: String(error?.message || 'fetch failed'), parsedText: '', requestUrl: diagnostics.endpointUrl, method: 'POST', failureReason: classifyAiFailure(error), diagnostics: { ...diagnostics, lastStatus: 0, backendResponded: false, requestReachedBackend: false, responseKind: 'network-failure', lastError: String(error?.message || 'fetch failed') } };
  }
}
