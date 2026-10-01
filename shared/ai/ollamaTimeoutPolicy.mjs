export const SAFE_OLLAMA_TIMEOUT_MS = 8000;
export const OLLAMA_WARMUP_RETRY_TIMEOUT_BUFFER_MS = 30000;
export const OLLAMA_HEAVY_MODEL_TIMEOUT_BASELINES = Object.freeze({
  'qwen:14b': 75000,
  'gpt-oss:20b': 75000,
  'qwen3.5:27b': 120000,
  'qwen:32b': 120000,
});

function asPositiveNumber(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveBackendRouteTimeoutMs(providerTimeoutMs, warmupRetryBufferMs) {
  const initialAttemptTimeoutMs = asPositiveNumber(providerTimeoutMs);
  if (!initialAttemptTimeoutMs) return null;
  const bufferMs = asPositiveNumber(
    warmupRetryBufferMs,
    OLLAMA_WARMUP_RETRY_TIMEOUT_BUFFER_MS,
  );
  const warmupRetryTimeoutMs = Math.max(
    initialAttemptTimeoutMs + bufferMs,
    initialAttemptTimeoutMs,
  );
  return initialAttemptTimeoutMs + warmupRetryTimeoutMs;
}

export function resolveOllamaTimeoutPolicy({
  providerConfig = {},
  requestedModel = '',
  safeFallbackTimeoutMs = SAFE_OLLAMA_TIMEOUT_MS,
  warmupRetryBufferMs = OLLAMA_WARMUP_RETRY_TIMEOUT_BUFFER_MS,
} = {}) {
  const normalizedModel = String(requestedModel || providerConfig?.model || '').trim();
  const overrides = providerConfig?.perModelTimeoutOverrides && typeof providerConfig.perModelTimeoutOverrides === 'object'
    ? providerConfig.perModelTimeoutOverrides
    : {};
  const overrideTimeout = asPositiveNumber(normalizedModel ? overrides[normalizedModel] : null);
  if (overrideTimeout && overrideTimeout >= 1000) {
    const providerTimeoutMs = Math.max(1000, overrideTimeout);
    return {
      backendRouteTimeoutMs: resolveBackendRouteTimeoutMs(providerTimeoutMs, warmupRetryBufferMs),
      providerTimeoutMs,
      modelTimeoutMs: providerTimeoutMs,
      timeoutSource: 'model-override',
      timeoutPolicySource: `provider:ollama:model-override:${normalizedModel}:warmup-retry-bound`,
      timeoutOverrideApplied: true,
      timeoutModel: normalizedModel,
    };
  }

  const configuredDefaultTimeout = asPositiveNumber(
    providerConfig?.defaultOllamaTimeoutMs ?? providerConfig?.timeoutMs,
  );
  const fallbackTimeout = Math.max(
    1000,
    asPositiveNumber(safeFallbackTimeoutMs, SAFE_OLLAMA_TIMEOUT_MS),
  );
  const defaultTimeout = configuredDefaultTimeout
    ? Math.max(1000, configuredDefaultTimeout)
    : fallbackTimeout;
  const heavyModelBaseline = asPositiveNumber(
    OLLAMA_HEAVY_MODEL_TIMEOUT_BASELINES[normalizedModel],
  );
  const providerTimeoutMs = heavyModelBaseline
    ? Math.max(defaultTimeout, heavyModelBaseline)
    : defaultTimeout;
  const modelBaselineApplied = Boolean(
    heavyModelBaseline && providerTimeoutMs > defaultTimeout,
  );
  const timeoutSource = modelBaselineApplied
    ? 'model-baseline'
    : (configuredDefaultTimeout ? 'default' : 'safe-fallback');

  return {
    backendRouteTimeoutMs: resolveBackendRouteTimeoutMs(providerTimeoutMs, warmupRetryBufferMs),
    providerTimeoutMs,
    modelTimeoutMs: modelBaselineApplied || overrideTimeout ? providerTimeoutMs : null,
    timeoutSource,
    timeoutPolicySource: modelBaselineApplied
      ? `provider:ollama:model-baseline:${normalizedModel}:warmup-retry-bound`
      : configuredDefaultTimeout
        ? 'provider:ollama:default-timeout:warmup-retry-bound'
        : 'provider:ollama:safe-fallback:warmup-retry-bound',
    timeoutOverrideApplied: false,
    timeoutModel: normalizedModel || null,
  };
}
