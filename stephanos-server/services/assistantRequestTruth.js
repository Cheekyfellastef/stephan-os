function asProvider(value, fallback = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || fallback;
}

export function buildCanonicalProviderResolution({
  uiRequestedProvider = '',
  initialResolution = {},
  requestedProviderForRequest = '',
  selectedProvider = '',
  actualProviderUsed = '',
} = {}) {
  const intentProvider = asProvider(uiRequestedProvider, 'unknown');
  const requestProvider = asProvider(requestedProviderForRequest, asProvider(initialResolution.requestedProvider, intentProvider));
  const selectedExecutionProvider = asProvider(selectedProvider, requestProvider);
  const executedProvider = asProvider(actualProviderUsed, selectedExecutionProvider);

  return {
    source: 'canonical-execution-truth',
    intentProvider,
    requestProvider,
    selectedProvider: selectedExecutionProvider,
    executedProvider,
    requestProviderRewritten: requestProvider !== intentProvider,
    selectedProviderRewritten: selectedExecutionProvider !== requestProvider,
    executedProviderFallback: executedProvider !== selectedExecutionProvider,
    resolvedProvider: selectedExecutionProvider,
    initialResolution: {
      requestedProvider: asProvider(initialResolution.requestedProvider, intentProvider),
      resolvedProvider: asProvider(initialResolution.resolvedProvider, intentProvider),
      fallbackApplied: initialResolution.fallbackApplied === true,
    },
  };
}

export function buildCanonicalModelTruth({
  configuredModel = null,
  requestedModel = null,
  selectedModel = null,
  executedModel = null,
  selectionReason = null,
  overrideReason = null,
} = {}) {
  const normalizedConfigured = configuredModel ? String(configuredModel).trim() : null;
  const normalizedRequested = requestedModel ? String(requestedModel).trim() : null;
  const normalizedSelected = selectedModel ? String(selectedModel).trim() : null;
  const normalizedExecuted = executedModel ? String(executedModel).trim() : null;
  const modelPolicyOverrideApplied = Boolean(
    normalizedRequested
    && normalizedSelected
    && normalizedRequested !== normalizedSelected,
  );

  return {
    configuredModel: normalizedConfigured,
    requestedModel: normalizedRequested,
    selectedModel: normalizedSelected,
    executedModel: normalizedExecuted || normalizedSelected || normalizedRequested || normalizedConfigured,
    modelSelectionReason: selectionReason ? String(selectionReason).trim() : null,
    modelPolicyOverrideApplied,
    modelPolicyOverrideReason: modelPolicyOverrideApplied
      ? (overrideReason ? String(overrideReason).trim() : (selectionReason ? String(selectionReason).trim() : 'model-policy-override'))
      : null,
  };
}

export function buildGroundingTruth({
  executedProvider = '',
  freshProviderAttempted = '',
  freshProviderFailureReason = null,
  fallbackUsed = false,
  geminiGroundingEnabled = false,
  configGroundingEnabled = true,
} = {}) {
  const normalizedExecutedProvider = asProvider(executedProvider, 'unknown');
  const normalizedFreshProviderAttempted = asProvider(freshProviderAttempted, '');

  return {
    grounding_active_for_request: normalizedExecutedProvider === 'gemini'
      ? (geminiGroundingEnabled ? 'yes' : 'no')
      : (normalizedFreshProviderAttempted === 'gemini' && (freshProviderFailureReason || fallbackUsed) ? 'attempted' : 'no'),
    config_grounding_enabled: configGroundingEnabled !== false,
  };
}

export function buildRequestTraceResolutionTruth({
  canonicalProviderResolution = null,
  initialProviderResolution = null,
} = {}) {
  return {
    provider_resolution: canonicalProviderResolution,
    secondary_diagnostics: {
      provider_resolution_initial: initialProviderResolution,
    },
  };
}
