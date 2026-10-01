import { resolveOllamaTimeoutPolicy as resolveSharedOllamaTimeoutPolicy } from '../../../shared/ai/ollamaTimeoutPolicy.mjs';

const DEFAULT_UI_REQUEST_TIMEOUT_MS = 30000;
const UI_TIMEOUT_GRACE_MS = 1500;
function asPositiveNumber(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
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
  return resolveSharedOllamaTimeoutPolicy({ providerConfig, requestedModel });
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
