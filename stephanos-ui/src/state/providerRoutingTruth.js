function normalizeProvider(value = '') {
  const provider = String(value || '').trim().toLowerCase();
  if (!provider || ['unknown', 'none', 'n/a', 'na', 'pending', 'unavailable'].includes(provider)) return '';
  return provider;
}

function normalizeFreshnessNeed(value = '') {
  const need = String(value || '').trim().toLowerCase();
  return need || 'low';
}

function boolFrom(value) {
  if (value === true) return true;
  if (value === false) return false;
  const normalized = String(value || '').trim().toLowerCase();
  if (['yes', 'true', '1'].includes(normalized)) return true;
  if (['no', 'false', '0'].includes(normalized)) return false;
  return false;
}

export function shouldPreserveLocalFirstExecution({
  uiSelectedProvider,
  uiDefaultProvider,
  requestedProviderIntent,
  freshnessRequiredForTruth = false,
  freshAnswerRequired = false,
  freshnessNeed = 'low',
  staleFallbackRequired = false,
  explicitProviderSelection = false,
} = {}) {
  const selected = normalizeProvider(uiSelectedProvider);
  const defaultProvider = normalizeProvider(uiDefaultProvider);
  const intent = normalizeProvider(requestedProviderIntent);
  const localProviderSelected = selected === 'ollama' || defaultProvider === 'ollama' || intent === 'ollama';
  return localProviderSelected
    && !boolFrom(freshnessRequiredForTruth)
    && !boolFrom(freshAnswerRequired)
    && normalizeFreshnessNeed(freshnessNeed) === 'low'
    && !boolFrom(staleFallbackRequired)
    && !boolFrom(explicitProviderSelection);
}

export function reconcileExecutionRequestedProvider({
  uiSelectedProvider,
  uiDefaultProvider,
  requestedProviderIntent,
  freshnessCandidateProvider,
  proposedExecutionProvider,
  freshnessRequiredForTruth = false,
  freshAnswerRequired = false,
  freshnessNeed = 'low',
  staleFallbackRequired = false,
  explicitProviderSelection = false,
  fallbackPermitted = false,
  localRouteAvailable = true,
} = {}) {
  const selected = normalizeProvider(uiSelectedProvider);
  const defaultProvider = normalizeProvider(uiDefaultProvider);
  const intent = normalizeProvider(requestedProviderIntent);
  const proposed = normalizeProvider(proposedExecutionProvider) || intent || defaultProvider || selected || 'ollama';
  const freshCandidate = normalizeProvider(freshnessCandidateProvider);
  const preserveLocal = shouldPreserveLocalFirstExecution({
    uiSelectedProvider: selected,
    uiDefaultProvider: defaultProvider,
    requestedProviderIntent: intent,
    freshnessRequiredForTruth,
    freshAnswerRequired,
    freshnessNeed,
    staleFallbackRequired,
    explicitProviderSelection,
  });
  const fallbackAllowed = boolFrom(fallbackPermitted);
  const localAvailable = boolFrom(localRouteAvailable);

  if (preserveLocal && proposed && proposed === freshCandidate && proposed !== 'ollama' && !fallbackAllowed) {
    return {
      executionRequestedProvider: 'ollama',
      preservedLocalFirst: true,
      policySource: 'local-first-freshness-guard',
      reason: 'freshness-candidate-crossed-into-execution-provider-without-freshness-requirement',
    };
  }

  if (preserveLocal && proposed !== 'ollama' && (localAvailable || !fallbackAllowed)) {
    return {
      executionRequestedProvider: 'ollama',
      preservedLocalFirst: true,
      policySource: 'local-first-freshness-guard',
      reason: localAvailable
        ? 'low-freshness-local-route-available'
        : 'low-freshness-cloud-fallback-not-permitted',
    };
  }

  return {
    executionRequestedProvider: proposed,
    preservedLocalFirst: false,
    policySource: 'freshness-routing-policy',
    reason: 'execution-provider-policy-unchanged',
  };
}

export function reconcileFinalProviderDispatch({
  uiSelectedProvider,
  uiDefaultProvider,
  requestedProviderIntent,
  freshnessCandidateProvider,
  executionRequestedProvider,
  freshnessRequiredForTruth = false,
  freshAnswerRequired = false,
  freshnessNeed = 'low',
  explicitProviderOverrideForRequest = false,
  fallbackPolicyTriggered = false,
  localRouteAvailable = true,
} = {}) {
  return reconcileExecutionRequestedProvider({
    uiSelectedProvider,
    uiDefaultProvider,
    requestedProviderIntent,
    freshnessCandidateProvider,
    proposedExecutionProvider: executionRequestedProvider,
    freshnessRequiredForTruth,
    freshAnswerRequired,
    freshnessNeed,
    staleFallbackRequired: false,
    explicitProviderSelection: explicitProviderOverrideForRequest,
    fallbackPermitted: fallbackPolicyTriggered,
    localRouteAvailable,
  });
}

export function diagnoseProviderDrift({
  uiSelectedProvider,
  uiDefaultProvider,
  requestedProviderIntent,
  freshnessCandidateProvider,
  executionRequestedProvider,
  routerSelectedProvider,
  executableProvider,
  actualProviderUsed,
  freshnessRequiredForTruth = false,
  freshAnswerRequired = false,
  freshnessNeed = 'low',
  fallbackPermitted = false,
  explicitProviderOverrideForRequest = false,
  providerOverrideReason = '',
  fallbackUsed = false,
  policySource = '',
} = {}) {
  const selected = normalizeProvider(uiSelectedProvider);
  const defaultProvider = normalizeProvider(uiDefaultProvider);
  const intent = normalizeProvider(requestedProviderIntent);
  const baseline = selected || intent || defaultProvider;
  const executionCheckpoints = [
    ['execution-requested-provider', normalizeProvider(executionRequestedProvider)],
    ['router-selected-provider', normalizeProvider(routerSelectedProvider)],
    ['executable-provider', normalizeProvider(executableProvider)],
    ['actual-provider-used', normalizeProvider(actualProviderUsed)],
  ].filter(([, provider]) => Boolean(provider));
  let boundary = 'none';
  let driftProvider = '';
  for (const [label, provider] of executionCheckpoints) {
    if (baseline && provider && provider !== baseline) {
      boundary = (!boolFrom(explicitProviderOverrideForRequest) && defaultProvider && provider === defaultProvider && defaultProvider !== baseline)
        ? 'ui-default-provider'
        : label;
      driftProvider = provider;
      break;
    }
  }
  const mismatch = Boolean(boundary !== 'none');
  const freshAllowed = boolFrom(freshnessRequiredForTruth) || boolFrom(freshAnswerRequired) || normalizeFreshnessNeed(freshnessNeed) === 'high';
  const fallbackAllowed = boolFrom(fallbackPermitted) && boolFrom(fallbackUsed);
  const explicitOverrideAllowed = boolFrom(explicitProviderOverrideForRequest);
  const freshCandidate = normalizeProvider(freshnessCandidateProvider);
  const freshnessCandidateCrossed = mismatch && freshCandidate && driftProvider === freshCandidate && !freshAllowed;
  const driftAllowed = mismatch
    ? (!freshnessCandidateCrossed && (freshAllowed || fallbackAllowed || explicitOverrideAllowed))
    : false;
  const reason = !mismatch
    ? 'none'
    : (freshnessCandidateCrossed
      ? 'freshness-candidate-crossed-into-execution-provider-without-freshness-requirement'
      : (explicitOverrideAllowed
        ? 'explicit-provider-override-for-request'
        : (fallbackAllowed ? 'fallback-policy-permitted-provider-drift' : (providerOverrideReason || 'provider-chain-changed-before-actual-execution'))));
  const deniedLocalFirstDrift = mismatch && !driftAllowed && !freshAllowed && !fallbackAllowed && !explicitOverrideAllowed;
  return {
    providerMismatch: mismatch ? 'yes' : 'no',
    providerDriftBoundary: boundary,
    providerDriftReason: reason,
    providerDriftAllowed: mismatch ? (driftAllowed ? 'yes' : 'no') : 'n/a',
    providerDriftPolicySource: deniedLocalFirstDrift
      ? 'local-first-freshness-guard'
      : (policySource || (freshAllowed ? 'freshness-required-policy' : fallbackAllowed ? 'fallback-policy' : 'local-first-low-freshness-policy')),
  };
}
