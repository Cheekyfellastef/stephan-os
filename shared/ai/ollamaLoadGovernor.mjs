export const OLLAMA_HEAVY_MODELS = Object.freeze(['gpt-oss:20b', 'qwen:14b', 'qwen3.5:27b', 'qwen:32b']);
export const OLLAMA_LIGHTWEIGHT_MODEL = 'llama3.2:3b';

// Resource permission is independent of whether a game is currently active.
// A fresh idle record can still retain an unresolved child or unknown probe.
export function projectVrGovernorExecutionPermissionsV1(state, nowMs = Date.now()) {
  const flags = ['active', 'flatGameActive', 'airLinkActive', 'realAirLinkActive',
    'virtualAirLinkTestActive', 'prepareLeaseActive'];
  const permissions = ['nativeProbeCustodyHeld', 'dependencyObservationKnown',
    'localModelAllowed', 'heavyModelAllowed', 'evictionHealthy'];
  const when = typeof state?.updatedAtUtc === 'string' ? Date.parse(state.updatedAtUtc) : NaN;
  const known = state !== null && typeof state === 'object' && !Array.isArray(state)
    && state.schemaVersion === 'stephanos.vr-resource-governor.v1' && state.governorVersion === 3
    && ['NORMAL', 'PREPARING', 'GAMING', 'COOLDOWN'].includes(state.phase)
    && Number.isFinite(nowMs) && Number.isFinite(when) && when <= nowMs && nowMs - when <= 15000
    && [...flags, ...permissions].every(key => typeof state[key] === 'boolean');
  if (!known) return Object.freeze({ observed: false, localModelAllowed: false,
    heavyModelAllowed: false, localCpuAllowed: false, reason: 'GOVERNOR_STATE_UNPROVEN' });
  const custodyHeld = state.nativeProbeCustodyHeld;
  const dependenciesKnown = state.dependencyObservationKnown && state.evictionHealthy;
  const localModelAllowed = !custodyHeld && dependenciesKnown && state.localModelAllowed;
  const activity = state.phase !== 'NORMAL' || flags.some(key => state[key]);
  // Model grants already include the governor's effective override/profile.
  // Observed activity independently excludes background CPU construction.
  const heavyModelAllowed = localModelAllowed && state.heavyModelAllowed;
  const reason = custodyHeld ? 'GOVERNOR_NATIVE_PROBE_CUSTODY_HELD'
    : !dependenciesKnown ? 'GOVERNOR_DEPENDENCY_OBSERVATION_UNKNOWN'
      : !localModelAllowed ? 'GOVERNOR_LOCAL_MODEL_DENIED'
        : !heavyModelAllowed ? 'GOVERNOR_HEAVY_MODEL_DENIED' : '';
  return Object.freeze({ observed: true, localModelAllowed, heavyModelAllowed,
    localCpuAllowed: heavyModelAllowed && !activity, reason });
}

function normalizeModel(value = '') {
  return String(value || '').trim().toLowerCase();
}

function determineComplexPrompt(prompt = '') {
  const text = String(prompt || '').trim();
  const normalized = text.toLowerCase();
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const identityPrompt = /\bwho am i talking to\b/i.test(normalized);
  const shortPrompt = words > 0 && words <= 18;
  const complexPrompt = (
    text.length >= 420
    || words >= 90
    || /(\n.*){6,}/.test(text)
    || /\b(system design|architecture|refactor|debug|root cause|multi[- ]step|deep reasoning)\b/i.test(normalized)
  );

  return {
    shortPrompt,
    identityPrompt,
    complexPrompt,
  };
}

export function resolveOllamaLoadGovernorPolicy({
  ollamaLoadMode = 'balanced',
  requestedModel = '',
  prompt = '',
  forceHeavyModel = false,
  availableModels = [],
} = {}) {
  const mode = String(ollamaLoadMode || 'balanced').trim().toLowerCase();
  const requested = normalizeModel(requestedModel);
  const heavyRequested = OLLAMA_HEAVY_MODELS.includes(requested);
  const available = [...new Set((Array.isArray(availableModels) ? availableModels : []).map((value) => String(value || '').trim()).filter(Boolean))];
  const lightweightAvailable = available.some((model) => normalizeModel(model) === OLLAMA_LIGHTWEIGHT_MODEL);
  const lightweightModel = lightweightAvailable ? available.find((model) => normalizeModel(model) === OLLAMA_LIGHTWEIGHT_MODEL) : OLLAMA_LIGHTWEIGHT_MODEL;
  const promptSignals = determineComplexPrompt(prompt);

  if (mode === 'performance') {
    return {
      ollamaLoadMode: 'performance',
      policyApplied: false,
      policyReason: 'performance-mode-allows-configured-model',
      heavyModelRequested: heavyRequested,
      heavyModelAllowed: true,
      modelBeforePolicy: requested,
      modelAfterPolicy: requested,
      forceHeavyModel,
      promptSignals,
    };
  }

  if (mode === 'balanced') {
    if (heavyRequested && forceHeavyModel) {
      return {
        ollamaLoadMode: 'balanced',
        policyApplied: false,
        policyReason: 'balanced-heavy-allowed-by-force',
        heavyModelRequested: true,
        heavyModelAllowed: true,
        modelBeforePolicy: requested,
        modelAfterPolicy: requested,
        forceHeavyModel,
        promptSignals,
      };
    }
    if (heavyRequested && !promptSignals.complexPrompt) {
      return {
        ollamaLoadMode: 'balanced',
        policyApplied: true,
        policyReason: 'balanced-short-prompt-prefer-lightweight',
        heavyModelRequested: true,
        heavyModelAllowed: false,
        modelBeforePolicy: requested,
        modelAfterPolicy: lightweightModel,
        forceHeavyModel,
        promptSignals,
      };
    }
    if (!heavyRequested && (promptSignals.shortPrompt || promptSignals.identityPrompt)) {
      return {
        ollamaLoadMode: 'balanced',
        policyApplied: normalizeModel(requested) !== OLLAMA_LIGHTWEIGHT_MODEL,
        policyReason: 'balanced-fast-lane-lightweight',
        heavyModelRequested: false,
        heavyModelAllowed: true,
        modelBeforePolicy: requested,
        modelAfterPolicy: lightweightModel,
        forceHeavyModel,
        promptSignals,
      };
    }
    return {
      ollamaLoadMode: 'balanced',
      policyApplied: false,
      policyReason: heavyRequested ? 'balanced-complex-prompt-allows-heavy' : 'balanced-default-preserve-model',
      heavyModelRequested: heavyRequested,
      heavyModelAllowed: true,
      modelBeforePolicy: requested,
      modelAfterPolicy: requested,
      forceHeavyModel,
      promptSignals,
    };
  }

  const heavyAllowed = !heavyRequested || forceHeavyModel;
  return {
    ollamaLoadMode: 'cool',
    policyApplied: heavyRequested && !heavyAllowed,
    policyReason: heavyRequested
      ? (heavyAllowed ? 'cool-heavy-allowed-by-operator-force' : 'cool-heavy-avoided-for-load-policy')
      : 'cool-default-lightweight-preferred',
    heavyModelRequested: heavyRequested,
    heavyModelAllowed: heavyAllowed,
    modelBeforePolicy: requested,
    modelAfterPolicy: heavyRequested && !heavyAllowed ? lightweightModel : (requested || lightweightModel),
    forceHeavyModel,
    promptSignals,
  };
}
