const DEFAULT_TOOL_ACCESS = 'none';

function asText(v=''){return String(v||'').trim();}
function asList(v){return Array.isArray(v)?v.map((x)=>asText(x)).filter(Boolean):[];}
function normalizeEnum(value, allowed, fallback='unknown'){ const n=asText(value).toLowerCase(); return allowed.includes(n)?n:fallback; }

export function normalizeMindRecord(input = {}) {
  const mind = input && typeof input === 'object' ? input : {};
  const approvalState = normalizeEnum(mind.approvalState, ['discovered','profiled','tested','sandboxed','recommended','approved','blocked'], 'discovered');
  const blocked = approvalState === 'blocked';
  const routeEligibility = mind.routeEligibility === true && !blocked;
  return {
    mindId: asText(mind.mindId) || 'unknown-mind',
    displayName: asText(mind.displayName) || asText(mind.mindId) || 'Unknown Mind',
    providerId: asText(mind.providerId).toLowerCase() || 'unknown',
    modelId: asText(mind.modelId) || 'unknown',
    location: normalizeEnum(mind.location, ['local','cloud','hybrid','unknown']),
    costClass: normalizeEnum(mind.costClass, ['zero','free','paid','unknown']),
    privacyClass: normalizeEnum(mind.privacyClass, ['local-private','cloud','unknown']),
    freshnessCapability: normalizeEnum(mind.freshnessCapability, ['none','fresh-capable','requires-grounding','unknown']),
    strengths: asList(mind.strengths),
    weaknesses: asList(mind.weaknesses),
    recommendedRoles: asList(mind.recommendedRoles),
    toolAccessLevel: normalizeEnum(mind.toolAccessLevel, ['none','read-only','propose','write','shell','browser','deploy'], DEFAULT_TOOL_ACCESS),
    approvalState,
    evaluationScore: Number.isFinite(Number(mind.evaluationScore)) ? Number(mind.evaluationScore) : 0,
    lastEvaluatedAt: asText(mind.lastEvaluatedAt),
    riskFlags: asList(mind.riskFlags),
    routeEligibility,
  };
}

export function discoverLocalOllamaMinds({ providerHealth = {} } = {}) {
  const ollama = providerHealth?.ollama || {};
  const rawModels = Array.isArray(ollama.models) ? ollama.models : Array.isArray(ollama.catalog) ? ollama.catalog : [];
  return rawModels.map((model) => {
    const modelId = asText(model?.name || model?.model || model?.id);
    if (!modelId) return null;
    return normalizeMindRecord({
      mindId: `ollama:${modelId}`,
      displayName: modelId,
      providerId: 'ollama',
      modelId,
      location: 'local',
      costClass: 'zero',
      privacyClass: 'local-private',
      freshnessCapability: 'requires-grounding',
      strengths: ['local execution', 'privacy-preserving'],
      weaknesses: ['freshness depends on grounding'],
      recommendedRoles: ['local-private', 'drafting'],
      toolAccessLevel: 'none',
      approvalState: 'discovered',
      routeEligibility: false,
      riskFlags: [],
    });
  }).filter(Boolean);
}

export function buildAIMindRegistry({ providerHealth = {}, runtimeContext = {}, registry = [] } = {}) {
  const discovered = discoverLocalOllamaMinds({ providerHealth });
  const merged = [...registry.map(normalizeMindRecord), ...discovered].reduce((acc, mind) => {
    acc.set(mind.mindId, mind);
    return acc;
  }, new Map());
  const minds = [...merged.values()];
  const missionPrivacy = asText(runtimeContext?.providerExecutionIntent?.answerMode).toLowerCase();
  const privateMission = missionPrivacy === 'local-private';
  const filteredEligible = minds.filter((mind) => mind.routeEligibility && !(privateMission && mind.privacyClass === 'cloud'));
  const recommended = minds.find((m) => m.approvalState === 'recommended') || minds.find((m) => m.approvalState === 'sandboxed') || minds[0] || null;
  const counts = {
    discoveredMindCount: minds.length,
    approvedMindCount: minds.filter((m) => m.approvalState === 'approved').length,
    sandboxedMindCount: minds.filter((m) => m.approvalState === 'sandboxed').length,
    blockedMindCount: minds.filter((m) => m.approvalState === 'blocked').length,
  };
  return {
    minds,
    routeEligibleMindIds: filteredEligible.map((m) => m.mindId),
    currentMissionRecommendedMinds: filteredEligible.slice(0, 3).map((m) => m.mindId),
    recommendedNextMindAction: recommended ? `Review ${recommended.displayName} for operator approval.` : 'Discover local minds via Ollama read-only catalog.',
    supportSnapshot: counts,
    openClawApprovalGate: minds.every((m) => m.approvalState !== 'approved') ? 'unapproved' : 'approved-minds-available',
  };
}
