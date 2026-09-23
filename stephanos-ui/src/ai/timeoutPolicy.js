const DEFAULT_UI_REQUEST_TIMEOUT_MS = 30000;
const SAFE_OLLAMA_TIMEOUT_MS = 8000;
const UI_TIMEOUT_GRACE_MS = 1500;
const OLLAMA_WARMUP_RETRY_TIMEOUT_BUFFER_MS = 30000;
const OLLAMA_HEAVY_MODEL_TIMEOUT_BASELINES = Object.freeze({
  'qwen:14b': 75000,
  'gpt-oss:20b': 75000,
  'qwen:32b': 120000,
});

function asPositiveNumber(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeOverrides(overrides = {}) {
  if (!overrides || typeof overrides !== 'object') return {};
  return overrides;
}

function resolveOllamaBackendRouteTimeoutMs(providerTimeoutMs) {
  const initialAttemptTimeoutMs = asPositiveNumber(providerTimeoutMs);
  if (!initialAttemptTimeoutMs) return null;
  const warmupRetryTimeoutMs = Math.max(
    initialAttemptTimeoutMs + OLLAMA_WARMUP_RETRY_TIMEOUT_BUFFER_MS,
    initialAttemptTimeoutMs,
  );
  return initialAttemptTimeoutMs + warmupRetryTimeoutMs;
}

function readCanonicalTimeoutPolicy(runtimeConfig = {}) {
  const timeoutPolicy = runtimeConfig?.timeoutPolicy && typeof runtimeConfig.timeoutPolicy === 'object'
    ? runtimeConfig.timeoutPolicy
    : {};
  const providerTimeoutMs = asPositiveNumber(timeoutPolicy.providerTimeoutMs ?? timeoutPolicy.backendRouteTimeoutMs);
  const modelTimeoutMs = asPositiveNumber(timeoutPolicy.modelTimeoutMs);
  const backendRouteTimeoutMs = asPositiveNumber(timeoutPolicy.backendRouteTimeoutMs ?? providerTimeoutMs);
  const uiRequestTimeoutMs = asPositiveNumber(timeoutPolicy.uiRequestTimeoutMs);
  const timeoutPolicySource = String(timeoutPolicy.timeoutPolicySource || '').trim();
  const timeoutOverrideApplied = Boolean(timeoutPolicy.timeoutOverrideApplied);

  if (!providerTimeoutMs && !modelTimeoutMs && !backendRouteTimeoutMs) {
    return null;
  }

  return {
    uiRequestTimeoutMs,
    providerTimeoutMs,
    modelTimeoutMs,
    backendRouteTimeoutMs,
    timeoutPolicySource: timeoutPolicySource || 'runtime:timeout-policy',
    timeoutOverrideApplied,
    timeoutModel: String(timeoutPolicy.timeoutModel || '').trim() || null,
  };
}

function readCanonicalExecutionProvider(runtimeConfig = {}) {
  const finalRouteTruth = runtimeConfig?.finalRouteTruth && typeof runtimeConfig.finalRouteTruth === 'object'
    ? runtimeConfig.finalRouteTruth
    : {};
  const canonicalRouteTruth = runtimeConfig?.canonicalRouteRuntimeTruth && typeof runtimeConfig.canonicalRouteRuntimeTruth === 'object'
    ? runtimeConfig.canonicalRouteRuntimeTruth
    : {};
  const resolvedProvider = String(
    finalRouteTruth.executedProvider
    || canonicalRouteTruth.executedProvider
    || finalRouteTruth.selectedProvider
    || canonicalRouteTruth.selectedProvider
    || '',
  ).trim().toLowerCase();
  return resolvedProvider || null;
}

export function resolveOllamaTimeoutPolicy({ providerConfig = {}, requestedModel = '' } = {}) {
  const normalizedModel = String(requestedModel || providerConfig?.model || '').trim();
  const overrides = normalizeOverrides(providerConfig?.perModelTimeoutOverrides);
  const overrideTimeout = asPositiveNumber(normalizedModel ? overrides[normalizedModel] : null);
  if (overrideTimeout && overrideTimeout >= 1000) {
    const providerTimeoutMs = Math.max(1000, overrideTimeout);
    return {
      backendRouteTimeoutMs: resolveOllamaBackendRouteTimeoutMs(providerTimeoutMs),
      providerTimeoutMs,
      modelTimeoutMs: providerTimeoutMs,
      timeoutPolicySource: `provider:ollama:model-override:${normalizedModel}:warmup-retry-bound`,
      timeoutOverrideApplied: true,
      timeoutModel: normalizedModel,
    };
  }

  const defaultTimeout = asPositiveNumber(providerConfig?.defaultOllamaTimeoutMs ?? providerConfig?.timeoutMs);
  const heavyModelBaseline = asPositiveNumber(OLLAMA_HEAVY_MODEL_TIMEOUT_BASELINES[normalizedModel]);
  if (defaultTimeout && defaultTimeout >= 1000) {
    const providerTimeoutMs = heavyModelBaseline
      ? Math.max(1000, defaultTimeout, heavyModelBaseline)
      : Math.max(1000, defaultTimeout);
    const modelBaselineApplied = Boolean(heavyModelBaseline && providerTimeoutMs > defaultTimeout);
    return {
      backendRouteTimeoutMs: resolveOllamaBackendRouteTimeoutMs(providerTimeoutMs),
      providerTimeoutMs,
      modelTimeoutMs: modelBaselineApplied ? providerTimeoutMs : null,
      timeoutPolicySource: modelBaselineApplied
        ? `provider:ollama:model-baseline:${normalizedModel}:warmup-retry-bound`
        : 'provider:ollama:default-timeout:warmup-retry-bound',
      timeoutOverrideApplied: false,
      timeoutModel: normalizedModel || null,
    };
  }

  if (heavyModelBaseline) {
    const providerTimeoutMs = Math.max(1000, heavyModelBaseline);
    return {
      backendRouteTimeoutMs: resolveOllamaBackendRouteTimeoutMs(providerTimeoutMs),
      providerTimeoutMs,
      modelTimeoutMs: providerTimeoutMs,
      timeoutPolicySource: `provider:ollama:model-baseline:${normalizedModel}:warmup-retry-bound`,
      timeoutOverrideApplied: false,
      timeoutModel: normalizedModel,
    };
  }

  return {
    backendRouteTimeoutMs: resolveOllamaBackendRouteTimeoutMs(SAFE_OLLAMA_TIMEOUT_MS),
    providerTimeoutMs: SAFE_OLLAMA_TIMEOUT_MS,
    modelTimeoutMs: null,
    timeoutPolicySource: 'provider:ollama:safe-fallback:warmup-retry-bound',
    timeoutOverrideApplied: false,
    timeoutModel: normalizedModel || null,
  };
}

export function resolveUiRequestTimeoutPolicy({
  runtimeConfig = {},
  provider = '',
  providerConfigs = {},
  requestedModel = '',
} = {}) {
  const baselineUiTimeoutMs = asPositiveNumber(runtimeConfig?.timeoutMs, DEFAULT_UI_REQUEST_TIMEOUT_MS);
  const runtimeTimeoutSource = String(runtimeConfig?.timeoutSource || '').trim() || 'frontend:api-runtime';
  const canonicalRuntimePolicy = readCanonicalTimeoutPolicy(runtimeConfig);
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const canonicalExecutionProvider = readCanonicalExecutionProvider(runtimeConfig);
  const canonicalExecutionProviderMatches = Boolean(
    canonicalExecutionProvider
    && normalizedProvider
    && canonicalExecutionProvider === normalizedProvider,
  );

  const providerPolicy = normalizedProvider === 'ollama'
    ? resolveOllamaTimeoutPolicy({ providerConfig: providerConfigs?.ollama || {}, requestedModel })
    : {
      backendRouteTimeoutMs: null,
      providerTimeoutMs: null,
      modelTimeoutMs: null,
      timeoutPolicySource: `provider:${normalizedProvider || 'unknown'}:none`,
      timeoutOverrideApplied: false,
      timeoutModel: null,
    };

  const backendRouteTimeoutMs = asPositiveNumber(
    canonicalRuntimePolicy?.backendRouteTimeoutMs
    ?? providerPolicy.backendRouteTimeoutMs
    ?? providerPolicy.providerTimeoutMs,
  );
  const providerTimeoutMs = asPositiveNumber(
    canonicalRuntimePolicy?.providerTimeoutMs ?? providerPolicy.providerTimeoutMs,
  );
  const modelTimeoutMs = asPositiveNumber(
    canonicalRuntimePolicy?.modelTimeoutMs ?? providerPolicy.modelTimeoutMs,
  );
  const providerDrivenUiFloor = backendRouteTimeoutMs
    ? backendRouteTimeoutMs + UI_TIMEOUT_GRACE_MS
    : null;
  const canonicalUiRequestTimeoutMs = asPositiveNumber(canonicalRuntimePolicy?.uiRequestTimeoutMs);
  const baselineIsFrontendFallback = runtimeTimeoutSource === 'frontend:api-runtime'
    || runtimeTimeoutSource === 'default:30000ms';
  const uiRequestTimeoutMs = canonicalUiRequestTimeoutMs
    || (
      providerDrivenUiFloor
        ? (baselineIsFrontendFallback
          ? providerDrivenUiFloor
          : Math.max(baselineUiTimeoutMs, providerDrivenUiFloor))
        : baselineUiTimeoutMs
    );

  const policySourceBase = canonicalRuntimePolicy?.timeoutPolicySource || providerPolicy.timeoutPolicySource || runtimeTimeoutSource;
  const canonicalizedPolicySourceBase = canonicalExecutionProviderMatches
    && !canonicalRuntimePolicy
    ? `canonical-runtime-execution-truth:${policySourceBase}`
    : policySourceBase;
  const timeoutPolicySource = providerDrivenUiFloor && (
    uiRequestTimeoutMs === providerDrivenUiFloor
    || uiRequestTimeoutMs === canonicalUiRequestTimeoutMs
  )
    ? `${canonicalizedPolicySourceBase}:ui-grace`
    : canonicalizedPolicySourceBase;

  return {
    uiRequestTimeoutMs,
    uiTimeoutBaselineMs: baselineUiTimeoutMs,
    backendRouteTimeoutMs,
    providerTimeoutMs,
    modelTimeoutMs,
    timeoutPolicySource,
    timeoutOverrideApplied: Boolean(
      canonicalRuntimePolicy?.timeoutOverrideApplied
      || providerPolicy.timeoutOverrideApplied
      || uiRequestTimeoutMs !== baselineUiTimeoutMs,
    ),
    timeoutModel: canonicalRuntimePolicy?.timeoutModel || providerPolicy.timeoutModel,
  };
}

export { DEFAULT_UI_REQUEST_TIMEOUT_MS };
