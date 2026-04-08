const DEFAULT_UI_REQUEST_TIMEOUT_MS = 30000;
const SAFE_OLLAMA_TIMEOUT_MS = 8000;
const UI_TIMEOUT_GRACE_MS = 1500;

function asPositiveNumber(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeOverrides(overrides = {}) {
  if (!overrides || typeof overrides !== 'object') return {};
  return overrides;
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

export function resolveOllamaTimeoutPolicy({ providerConfig = {}, requestedModel = '' } = {}) {
  const normalizedModel = String(requestedModel || providerConfig?.model || '').trim();
  const overrides = normalizeOverrides(providerConfig?.perModelTimeoutOverrides);
  const overrideTimeout = asPositiveNumber(normalizedModel ? overrides[normalizedModel] : null);
  if (overrideTimeout && overrideTimeout >= 1000) {
    return {
      providerTimeoutMs: Math.max(1000, overrideTimeout),
      modelTimeoutMs: Math.max(1000, overrideTimeout),
      timeoutPolicySource: `provider:ollama:model-override:${normalizedModel}`,
      timeoutOverrideApplied: true,
      timeoutModel: normalizedModel,
    };
  }

  const defaultTimeout = asPositiveNumber(providerConfig?.defaultOllamaTimeoutMs ?? providerConfig?.timeoutMs);
  if (defaultTimeout && defaultTimeout >= 1000) {
    return {
      providerTimeoutMs: Math.max(1000, defaultTimeout),
      modelTimeoutMs: null,
      timeoutPolicySource: 'provider:ollama:default-timeout',
      timeoutOverrideApplied: false,
      timeoutModel: normalizedModel || null,
    };
  }

  return {
    providerTimeoutMs: SAFE_OLLAMA_TIMEOUT_MS,
    modelTimeoutMs: null,
    timeoutPolicySource: 'provider:ollama:safe-fallback',
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

  const providerPolicy = normalizedProvider === 'ollama'
    ? resolveOllamaTimeoutPolicy({ providerConfig: providerConfigs?.ollama || {}, requestedModel })
    : {
      providerTimeoutMs: null,
      modelTimeoutMs: null,
      timeoutPolicySource: `provider:${normalizedProvider || 'unknown'}:none`,
      timeoutOverrideApplied: false,
      timeoutModel: null,
    };

  const backendRouteTimeoutMs = asPositiveNumber(
    canonicalRuntimePolicy?.backendRouteTimeoutMs ?? providerPolicy.providerTimeoutMs,
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

  const timeoutPolicySource = providerDrivenUiFloor && (
    uiRequestTimeoutMs === providerDrivenUiFloor
    || uiRequestTimeoutMs === canonicalUiRequestTimeoutMs
  )
    ? `${canonicalRuntimePolicy?.timeoutPolicySource || providerPolicy.timeoutPolicySource}:ui-grace`
    : (canonicalRuntimePolicy?.timeoutPolicySource || runtimeTimeoutSource);

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
