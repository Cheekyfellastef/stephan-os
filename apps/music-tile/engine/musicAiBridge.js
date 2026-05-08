import { queryStephanosAI } from '../../../shared/ai/stephanosClient.mjs';

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

export async function askMusicAi(task, payload = {}) {
  const allowLiveVerification = payload.allowLiveVerification === true;
  const tasteDNA = payload.tasteDNA || null;
  const context = aiRouteContext();
  const status = getMusicAiStatus();
  if (!status.available) {
    return { ok: false, unavailable: true, message: 'AI router unavailable; rule-based interpretation active.' };
  }
  const response = await queryStephanosAI({
    messages: [{ role: 'user', content: `Return JSON only. Task: ${task}\nPayload:\n${JSON.stringify(payload, null, 2)}` }],
    context: { tile: 'music-tile', task, allowLiveVerification, tasteDNA, ...payload },
    runtimeContext: context,
  });
  const text = String(response?.data?.reply || response?.reply || response?.text || '').trim();
  try {
    const parsed = JSON.parse(text);
    return { ok: true, parsed, text };
  } catch {
    return { ok: true, parsed: null, text };
  }
}
