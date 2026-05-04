const DEFAULT_TOOL_ACCESS = 'none';
const EXTERNAL_CONNECTION_STATES = ['not_connected','pending_key','connected','sandboxed','approved','blocked','error'];
const EXTERNAL_APPROVAL_STATES = ['discovered','recommended','approved','blocked'];
const EXTERNAL_SETUP_MODES = ['manual','guided','assisted','delegated'];
const EXTERNAL_WORKFLOW_STATES = ['discovered','recommended','operator_approved_setup','setup_in_progress','awaiting_login_or_terms','awaiting_secret_input','key_stored','sandbox_test_running','sandboxed','approved_for_roles','blocked','error'];
const EXTERNAL_PROVIDER_TYPES = ['google-ai-studio','hugging-face','github-models','ollama','lm-studio','openai-compatible','unknown'];

function asText(v=''){return String(v||'').trim();}
function asList(v){return Array.isArray(v)?v.map((x)=>asText(x)).filter(Boolean):[];}
function normalizeEnum(value, allowed, fallback='unknown'){ const n=asText(value).toLowerCase(); return allowed.includes(n)?n:fallback; }
function asIso(value=''){ const text=asText(value); return text||''; }
function maskSecretStatus(ref=''){ return asText(ref) ? 'configured' : 'missing'; }

export const DEFAULT_EXTERNAL_MIND_SOURCE_PROFILES = Object.freeze([
  { sourceId: 'google-ai-studio-gemini', displayName: 'Google AI Studio / Gemini', providerType: 'google-ai-studio', providerUrl: 'https://aistudio.google.com/', accountRequired: true, apiKeyRequired: true, costClass: 'free-tier', privacyClass: 'cloud', freshnessCapability: 'fresh-capable', recommendedRoles: ['research', 'general-assistant'], setupMode: 'guided' },
  { sourceId: 'hugging-face', displayName: 'Hugging Face', providerType: 'hugging-face', providerUrl: 'https://huggingface.co/', accountRequired: true, apiKeyRequired: true, costClass: 'free-tier', privacyClass: 'cloud', freshnessCapability: 'requires-grounding', recommendedRoles: ['model-discovery', 'evaluation'], setupMode: 'manual' },
  { sourceId: 'github-models', displayName: 'GitHub Models', providerType: 'github-models', providerUrl: 'https://github.com/marketplace/models', accountRequired: true, apiKeyRequired: true, costClass: 'free-tier', privacyClass: 'cloud', freshnessCapability: 'requires-grounding', recommendedRoles: ['dev-assistant', 'evals'], setupMode: 'guided' },
  { sourceId: 'ollama-local', displayName: 'Ollama local models', providerType: 'ollama', providerUrl: 'http://localhost:11434', accountRequired: false, apiKeyRequired: false, costClass: 'zero', privacyClass: 'local', freshnessCapability: 'requires-grounding', recommendedRoles: ['local-private', 'drafting'], setupMode: 'assisted' },
  { sourceId: 'lm-studio-local', displayName: 'LM Studio / local OpenAI-compatible endpoint', providerType: 'lm-studio', providerUrl: 'http://localhost:1234/v1', accountRequired: false, apiKeyRequired: false, costClass: 'zero', privacyClass: 'local', freshnessCapability: 'requires-grounding', recommendedRoles: ['local-private', 'sandbox-testing'], setupMode: 'assisted' },
  { sourceId: 'generic-openai-compatible', displayName: 'Generic OpenAI-compatible endpoint', providerType: 'openai-compatible', providerUrl: '', accountRequired: true, apiKeyRequired: true, costClass: 'unknown', privacyClass: 'unknown', freshnessCapability: 'unknown', recommendedRoles: ['integration'], setupMode: 'manual' },
]);

export function normalizeExternalMindSource(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const approvalState = normalizeEnum(source.approvalState, EXTERNAL_APPROVAL_STATES, 'discovered');
  const blocked = approvalState === 'blocked';
  const connectionStatus = blocked
    ? 'blocked'
    : normalizeEnum(source.connectionStatus, EXTERNAL_CONNECTION_STATES, source.apiKeyRequired !== false ? 'pending_key' : 'not_connected');
  const workflowState = blocked
    ? 'blocked'
    : normalizeEnum(source.onboardingWorkflowState, EXTERNAL_WORKFLOW_STATES, connectionStatus === 'pending_key' ? 'awaiting_secret_input' : 'discovered');
  const secretReference = asText(source.secretReference || source.secretRef);
  const sandboxPassed = source.sandboxPassed === true || connectionStatus === 'sandboxed' || connectionStatus === 'approved';
  const operatorApproved = approvalState === 'approved';
  return {
    sourceId: asText(source.sourceId) || 'unknown-source',
    displayName: asText(source.displayName) || 'Unknown External Mind Source',
    providerType: normalizeEnum(source.providerType, EXTERNAL_PROVIDER_TYPES, 'unknown'),
    providerUrl: asText(source.providerUrl),
    accountRequired: source.accountRequired !== false,
    apiKeyRequired: source.apiKeyRequired !== false,
    costClass: normalizeEnum(source.costClass, ['zero','free-tier','paid','unknown']),
    privacyClass: normalizeEnum(source.privacyClass, ['local','cloud','hybrid','unknown']),
    freshnessCapability: normalizeEnum(source.freshnessCapability, ['none','fresh-capable','requires-grounding','unknown']),
    recommendedRoles: asList(source.recommendedRoles),
    setupMode: normalizeEnum(source.setupMode, EXTERNAL_SETUP_MODES, 'manual'),
    connectionStatus,
    approvalState,
    riskLevel: normalizeEnum(source.riskLevel, ['low','medium','high','unknown']),
    riskFlags: asList(source.riskFlags),
    nextRecommendedAction: asText(source.nextRecommendedAction) || (blocked ? 'Source is blocked.' : 'View setup steps'),
    lastCheckedAt: asIso(source.lastCheckedAt),
    lastTestedAt: asIso(source.lastTestedAt),
    onboardingWorkflowState: workflowState,
    secretReference,
    secretStatus: source.apiKeyRequired === false ? 'n/a' : maskSecretStatus(secretReference),
    sandboxPassed,
    operatorApproved,
    routeEligible: source.routeEligible === true && sandboxPassed && operatorApproved && !blocked,
    openClawAllowed: source.openClawAllowed === true && operatorApproved && !blocked,
  };
}

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
  const configuredSources = Array.isArray(runtimeContext?.externalMindSources) ? runtimeContext.externalMindSources : [];
  const mergedSources = [...DEFAULT_EXTERNAL_MIND_SOURCE_PROFILES, ...configuredSources]
    .reduce((acc, source) => { const normalized = normalizeExternalMindSource(source); acc.set(normalized.sourceId, { ...normalized, ...normalizeExternalMindSource({ ...normalized, ...source }) }); return acc; }, new Map());
  const externalMindSources = [...mergedSources.values()];
  const externalSupport = {
    externalMindSourceCount: externalMindSources.length,
    connectedExternalMindSourceCount: externalMindSources.filter((s) => ['connected','sandboxed','approved'].includes(s.connectionStatus)).length,
    sandboxedExternalMindSourceCount: externalMindSources.filter((s) => s.connectionStatus === 'sandboxed').length,
    approvedExternalMindSourceCount: externalMindSources.filter((s) => s.approvalState === 'approved').length,
    blockedExternalMindSourceCount: externalMindSources.filter((s) => s.approvalState === 'blocked').length,
    pendingOperatorApprovalCount: externalMindSources.filter((s) => ['recommended','sandboxed'].includes(s.approvalState) || s.onboardingWorkflowState === 'operator_approved_setup').length,
    recommendedNextMindSourceAction: (externalMindSources.find((s) => s.approvalState !== 'approved' && s.approvalState !== 'blocked')?.nextRecommendedAction) || 'Review recommended external source.',
    externalMindSourceRiskSummary: externalMindSources.map((s) => `${s.sourceId}:${s.riskLevel}`).join(', ') || 'none',
    configuredSecretReferenceCount: externalMindSources.filter((s) => s.secretStatus === 'configured').length,
    missingSecretReferenceCount: externalMindSources.filter((s) => s.apiKeyRequired && s.secretStatus !== 'configured').length,
  };
  return {
    minds,
    routeEligibleMindIds: filteredEligible.map((m) => m.mindId),
    currentMissionRecommendedMinds: filteredEligible.slice(0, 3).map((m) => m.mindId),
    recommendedNextMindAction: recommended ? `Review ${recommended.displayName} for operator approval.` : 'Discover local minds via Ollama read-only catalog.',
    supportSnapshot: { ...counts, ...externalSupport },
    externalMindSources,
    externalMindSourcesProjection: externalMindSources.map((source) => ({ ...source, secretReference: source.secretReference ? '***' : '' })),
    capabilityRadarSummary: {
      discoveredSources: externalSupport.externalMindSourceCount,
      connectedSources: externalSupport.connectedExternalMindSourceCount,
      sandboxedSources: externalSupport.sandboxedExternalMindSourceCount,
      pendingApprovals: externalSupport.pendingOperatorApprovalCount,
      recommendedNextAction: externalSupport.recommendedNextMindSourceAction,
    },
    openClawApprovalGate: minds.every((m) => m.approvalState !== 'approved') || externalMindSources.every((source) => source.openClawAllowed !== true) ? 'unapproved' : 'approved-minds-available',
  };
}
