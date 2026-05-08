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

export async function askMusicAi(task, payload = {}) {
  const allowLiveVerification = payload.allowLiveVerification === true;
  const tasteDNA = payload.tasteDNA || null;
  const context = aiRouteContext();
  const status = getMusicAiStatus();
  const diagnostics = getMusicAiRuntimeDiagnostics();
  try {
    const response = await queryStephanosAI({
    messages: [{ role: 'user', content: `Return JSON only. Task: ${task}\nPayload:\n${JSON.stringify(payload, null, 2)}` }],
    context: { tile: 'music-tile', task, allowLiveVerification, tasteDNA, ...payload },
    runtimeContext: context,
  });
    const text = String(response?.data?.reply || response?.reply || response?.text || '').trim();
    try {
      const parsed = JSON.parse(text);
      return { ok: true, parsed, text, diagnostics: { ...diagnostics, requestReachedBackend: true, backendResponded: true, responseKind: 'structured-json', lastStatus: 200 } };
    } catch {
      return { ok: true, parsed: null, text, diagnostics: { ...diagnostics, requestReachedBackend: true, backendResponded: true, responseKind: 'text-fallback', lastStatus: 200 } };
    }
  } catch (error) {
    return { ok: false, message: classifyAiFailure(error), error: String(error?.message || 'Unknown AI error'), diagnostics: { ...diagnostics, requestReachedBackend: error?.status ? true : false, backendResponded: Boolean(error?.status), lastStatus: Number(error?.status || 0), lastError: String(error?.message || 'Unknown AI error') } };
  }
}



export async function testMusicAiRoute({ fetchImpl = globalThis.fetch } = {}) {
  const diagnostics = getMusicAiRuntimeDiagnostics();
  const payload = {
    prompt: 'Reply with: MUSIC_AI_ROUTE_OK',
    provider: diagnostics.provider === 'unknown' ? 'ollama' : diagnostics.provider,
    providerConfig: {},
    providerConfigs: {},
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
    try { const parsed = JSON.parse(text); parsedText = String(parsed?.reply || parsed?.text || parsed?.data?.reply || ''); } catch {}
    return { ok: res.ok, status: res.status, snippet, parsedText, requestUrl: diagnostics.endpointUrl, method: 'POST', failureReason: res.ok ? '' : classifyAiFailure({ status: res.status }), diagnostics: { ...diagnostics, lastStatus: res.status, backendResponded: true, requestReachedBackend: true, responseKind: 'http-response' } };
  } catch (error) {
    return { ok: false, status: 0, snippet: String(error?.message || 'fetch failed'), parsedText: '', requestUrl: diagnostics.endpointUrl, method: 'POST', failureReason: classifyAiFailure(error), diagnostics: { ...diagnostics, lastStatus: 0, backendResponded: false, requestReachedBackend: false, responseKind: 'network-failure', lastError: String(error?.message || 'fetch failed') } };
  }
}
