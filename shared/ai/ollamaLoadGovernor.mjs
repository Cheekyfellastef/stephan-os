export const OLLAMA_HEAVY_MODELS = Object.freeze(['gpt-oss:20b', 'qwen:14b', 'qwen:32b']);
export const OLLAMA_LIGHTWEIGHT_MODEL = 'llama3.2:3b';

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
