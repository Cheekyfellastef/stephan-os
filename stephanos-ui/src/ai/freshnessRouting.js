const FRESHNESS_HIGH_PATTERNS = [
  /\b(uk|united kingdom|us|united states)\s+(prime minister|president)\b/i,
  /\b(who is|who's)\s+(the\s+)?(prime minister|president|ceo|governor|mayor)\b/i,
  /\b(latest|current|today|now|recent|breaking|update|news)\b/i,
  /\b(stock|price|weather|forecast|schedule|timetable|release date|regulation|law)\b/i,
  /\b(real[-\s]?time|live)\b/i,
  /\b(verify|check)\b.*\b(web|internet|online|source)\b/i,
];
const OFFICE_HOLDER_PATTERNS = [
  /\b(who is|who's)\s+(the\s+)?(uk|u\.?k\.?|united kingdom|us|u\.?s\.?|united states)\s+(prime minister|president)\b/i,
  /\b(who is|who's)\s+(the\s+)?(prime minister|president)\b/i,
];

const LOCAL_PRIVATE_PATTERNS = [
  /\bdebug\b.*\b(local|route|truth|stephanos|system)\b/i,
  /\b(local|private|internal)\s+(system|project|repo|reasoning)\b/i,
  /\b(code|design|architecture|refactor|test)\b/i,
  /\b(continuity|session memory|stephanos memory)\b/i,
];

function includesAnyPattern(prompt, patterns = []) {
  return patterns.some((pattern) => pattern.test(prompt));
}

function isKnownProvider(providerKey = '') {
  const normalized = String(providerKey || '').trim().toLowerCase();
  return normalized.length > 0 && !['unknown', 'none', 'n/a', 'pending', 'unavailable'].includes(normalized);
}

function hasExplicitFreshnessPhrase(prompt = '') {
  return /\b(latest|current|today|now|real[-\s]?time|recent|up-to-date)\b/i.test(prompt);
}

export function classifyPromptFreshness(prompt, context = {}) {
  const normalizedPrompt = String(prompt || '').trim();
  const explicitFreshness = hasExplicitFreshnessPhrase(normalizedPrompt);
  const officeHolderLikely = includesAnyPattern(normalizedPrompt, OFFICE_HOLDER_PATTERNS);
  const currentAffairsLikely = includesAnyPattern(normalizedPrompt, FRESHNESS_HIGH_PATTERNS) || officeHolderLikely;
  const localPrivateLikely = includesAnyPattern(normalizedPrompt, LOCAL_PRIVATE_PATTERNS)
    || context?.localPrivateHint === true;

  if (!normalizedPrompt) {
    return {
      freshnessNeed: 'low',
      freshnessReason: 'empty prompt',
      currentAffairsLikely: false,
      webLookupRecommended: false,
      staleRisk: 'low',
      explicitFreshness,
    };
  }

  if (currentAffairsLikely && !localPrivateLikely) {
    const officeHolderNeedsCurrentTruth = officeHolderLikely;
    const highFreshness = explicitFreshness || officeHolderNeedsCurrentTruth;
    return {
      freshnessNeed: highFreshness ? 'high' : 'medium',
      freshnessReason: highFreshness
        ? 'prompt requests current or latest information'
        : 'prompt appears current-affairs or frequently changing',
      currentAffairsLikely: true,
      webLookupRecommended: true,
      staleRisk: highFreshness ? 'high' : 'medium',
      explicitFreshness,
    };
  }

  if (localPrivateLikely) {
    return {
      freshnessNeed: 'low',
      freshnessReason: 'prompt appears local/private/system reasoning',
      currentAffairsLikely: false,
      webLookupRecommended: false,
      staleRisk: 'low',
      explicitFreshness,
    };
  }

  return {
    freshnessNeed: explicitFreshness ? 'medium' : 'low',
    freshnessReason: explicitFreshness
      ? 'prompt asks for recency without obvious current-affairs scope'
      : 'prompt appears timeless or analysis-oriented',
    currentAffairsLikely: false,
    webLookupRecommended: explicitFreshness,
    staleRisk: explicitFreshness ? 'medium' : 'low',
    explicitFreshness,
  };
}

function providerHealthy(providerHealth = {}, providerKey = '') {
  const health = providerHealth?.[providerKey];
  return health?.ok === true || String(health?.state || '').toLowerCase() === 'healthy';
}

function providerTransportReachable(providerHealth = {}, providerKey = '') {
  const health = providerHealth?.[providerKey] || {};
  const capabilityTruth = health?.providerCapability || {};
  if (typeof capabilityTruth.transportReachable === 'boolean') {
    return capabilityTruth.transportReachable;
  }
  const explicitReachability = [
    health?.transportReachable,
    health?.transport?.reachable,
    health?.network?.reachable,
    health?.connectivity?.reachable,
  ].find((value) => typeof value === 'boolean');

  if (typeof explicitReachability === 'boolean') {
    return explicitReachability;
  }

  return providerHealthy(providerHealth, providerKey);
}

function resolveWebCapabilityState(providerHealth = {}, providerKey = '') {
  const health = providerHealth?.[providerKey] || {};
  const capabilityTruth = health?.providerCapability || {};
  if (typeof capabilityTruth.supportsFreshWeb === 'boolean') {
    return capabilityTruth.supportsFreshWeb ? 'supported' : 'unsupported';
  }
  const explicitSignals = [
    health?.capabilities?.freshWeb,
    health?.capabilities?.webLookup,
    health?.capabilities?.webEnabled,
    health?.capabilities?.internetAccess,
    health?.config?.freshWeb,
    health?.config?.webLookup,
    health?.config?.webEnabled,
  ].filter((value) => typeof value === 'boolean');

  if (explicitSignals.some((value) => value === true)) {
    return 'supported';
  }
  if (explicitSignals.some((value) => value === false)) {
    return 'unsupported';
  }
  return 'unknown';
}

function resolveCurrentAnswerCapability(providerHealth = {}, providerKey = '') {
  const health = providerHealth?.[providerKey] || {};
  const capabilityTruth = health?.providerCapability || {};
  const explicitCurrentAnswerSupport = [
    capabilityTruth.supportsCurrentAnswers,
    health?.capabilities?.currentAnswers,
    health?.capabilities?.freshCurrentAnswers,
    health?.config?.supportsCurrentAnswers,
  ].find((value) => typeof value === 'boolean');
  if (typeof explicitCurrentAnswerSupport === 'boolean') {
    return explicitCurrentAnswerSupport;
  }

  const explicitFreshWebSupport = [
    capabilityTruth.supportsFreshWeb,
    capabilityTruth.supportsBrowserSearch,
    health?.capabilities?.freshWeb,
    health?.capabilities?.browserSearch,
    health?.capabilities?.webLookup,
    health?.capabilities?.webEnabled,
  ].find((value) => typeof value === 'boolean');
  if (typeof explicitFreshWebSupport === 'boolean') {
    return explicitFreshWebSupport;
  }

  return null;
}

export function resolveFreshnessRoutingDecision({
  classification,
  requestedProvider = 'ollama',
  providerHealth = {},
  runtimeStatus = {},
  routeTruthView = {},
} = {}) {
  const sessionKind = String(runtimeStatus?.sessionKind || routeTruthView?.sessionKind || '').trim().toLowerCase();
  const hostedSession = sessionKind === 'hosted-web' || sessionKind === 'hosted_web' || sessionKind === 'hosted';
  const aiPolicy = {
    aiPolicyMode: hostedSession ? 'hosted-cloud-first-for-freshness' : 'local-first-cloud-when-needed',
    localPreferred: hostedSession ? false : true,
    cloudAllowedForFreshness: true,
    cloudReasonRequired: true,
  };
  const requested = String(requestedProvider || 'ollama');
  const routeUsable = String(routeTruthView?.routeUsableState || '').toLowerCase() === 'yes'
    || runtimeStatus?.canonicalRouteRuntimeTruth?.routeUsable === true;
  const backendReachable = String(routeTruthView?.backendReachableState || '').toLowerCase() === 'yes'
    || runtimeStatus?.backendReachable === true
    || runtimeStatus?.canonicalRouteRuntimeTruth?.backendReachable === true;
  const backendTargetResolved = Boolean(
    String(routeTruthView?.actualTarget || routeTruthView?.preferredTarget || '').trim()
    || String(runtimeStatus?.canonicalRouteRuntimeTruth?.actualTarget || runtimeStatus?.canonicalRouteRuntimeTruth?.preferredTarget || '').trim(),
  );
  const requestedProviderHealth = providerHealth?.[requested];
  const requestedProviderHealthKnown = requestedProviderHealth && typeof requestedProviderHealth === 'object'
    && Object.keys(requestedProviderHealth).length > 0;
  const requestedProviderHealthy = providerHealthy(providerHealth, requested);
  const requestedProviderTransportReachable = providerTransportReachable(providerHealth, requested);
  const requestedProviderRouteViable = isKnownProvider(requested)
    && hostedSession
    && routeUsable
    && backendReachable
    && backendTargetResolved
    && (!requestedProviderHealthKnown || (requestedProviderHealthy && requestedProviderTransportReachable));
  const cloudRouteUsable = runtimeStatus?.cloudAvailable === true && backendReachable;
  const freshProviderPreference = ['gemini', 'groq', 'openrouter'];
  const primaryFreshProvider = freshProviderPreference.find((providerKey) => providerHealth?.[providerKey]) || 'groq';
  const primaryFreshProviderHealthy = providerHealthy(providerHealth, primaryFreshProvider);
  const primaryFreshProviderTransportReachable = providerTransportReachable(providerHealth, primaryFreshProvider);
  const primaryFreshProviderSupportsCurrentAnswers = resolveCurrentAnswerCapability(providerHealth, primaryFreshProvider);
  const primaryFreshProviderWebCapabilityState = resolveWebCapabilityState(providerHealth, primaryFreshProvider);
  const freshCandidates = freshProviderPreference
    .map((providerKey) => {
      const capability = providerHealth?.[providerKey]?.providerCapability || {};
      const transportReachable = providerTransportReachable(providerHealth, providerKey);
      const healthy = providerHealthy(providerHealth, providerKey);
      const webCapabilityState = resolveWebCapabilityState(providerHealth, providerKey);
      const supportsCurrentAnswers = resolveCurrentAnswerCapability(providerHealth, providerKey);
      return {
        providerKey,
        capability,
        transportReachable,
        healthy,
        webCapabilityState,
        supportsCurrentAnswers,
        freshCapable: cloudRouteUsable
          && healthy
          && transportReachable
          && supportsCurrentAnswers !== false
          && webCapabilityState !== 'unsupported',
      };
    });
  const selectedFreshCandidate = freshCandidates.find((candidate) => candidate.freshCapable) || null;
  const selectedFreshProvider = selectedFreshCandidate?.providerKey || '';
  const selectedFreshCapability = selectedFreshCandidate?.capability || {};
  const candidateFreshModel = String(selectedFreshCapability?.candidateFreshWebModel || '').trim();
  const candidateFreshPath = String(selectedFreshCapability?.freshWebPath || '').trim();
  const webCapabilityState = selectedFreshCandidate?.webCapabilityState || 'unknown';
  const selectedFreshProviderSupportsCurrentAnswers = selectedFreshCandidate?.supportsCurrentAnswers ?? null;
  const freshRouteAvailable = cloudRouteUsable
    && Boolean(selectedFreshProvider);
  const cloudRouteAvailable = (cloudRouteUsable && freshCandidates.some((candidate) => candidate.healthy && candidate.transportReachable))
    || requestedProviderRouteViable;
  const homeNodeUsable = String(routeTruthView?.homeNodeUsableState || '').toLowerCase() === 'yes'
    || runtimeStatus?.homeNodeAvailable === true;
  const localRouteCandidateAvailable = providerHealthy(providerHealth, 'ollama') || runtimeStatus?.localAvailable === true;
  const localRouteAvailable = hostedSession
    ? localRouteCandidateAvailable && homeNodeUsable
    : localRouteCandidateAvailable;
  const explicitFreshness = classification?.explicitFreshness === true;

  let selectedProvider = requested;
  let selectedAnswerMode = 'local-private';
  let freshnessWarning = null;
  let freshnessRouted = false;
  let fallbackReasonCode = null;
  let staleFallbackAttempted = false;
  const staleFallbackPermitted = false;
  let policyReason = 'Local-private default for low-freshness or private/system reasoning.';

  const freshRouteFailureReasons = [];
  if (!cloudRouteUsable) freshRouteFailureReasons.push(`${primaryFreshProvider}-cloud-route-unusable`);
  if (!primaryFreshProviderHealthy) freshRouteFailureReasons.push(`${primaryFreshProvider}-provider-unhealthy`);
  if (!primaryFreshProviderTransportReachable) freshRouteFailureReasons.push(`${primaryFreshProvider}-transport-unreachable`);
  if (primaryFreshProviderSupportsCurrentAnswers === false) freshRouteFailureReasons.push(`${primaryFreshProvider}-current-answers-unsupported`);
  if (primaryFreshProviderWebCapabilityState === 'unsupported') freshRouteFailureReasons.push(`${primaryFreshProvider}-web-capability-unsupported`);
  if (!selectedFreshProvider) freshRouteFailureReasons.push('no-fresh-capable-provider');

  if (classification?.freshnessNeed === 'high') {
    if (freshRouteAvailable) {
      selectedProvider = selectedFreshProvider;
      selectedAnswerMode = 'fresh-cloud';
      freshnessRouted = true;
      policyReason = hostedSession
        ? `Hosted high-freshness request pinned to ${selectedFreshProvider} fresh-cloud path.`
        : 'Cloud routing allowed and selected because current real-world truth is required.';
    } else {
      selectedProvider = hostedSession
        ? (primaryFreshProvider || 'gemini')
        : (localRouteAvailable ? 'ollama' : requested);
      selectedAnswerMode = hostedSession ? 'route-unavailable' : 'fallback-stale-risk';
      staleFallbackAttempted = hostedSession ? false : localRouteAvailable;
      freshnessWarning = hostedSession
        ? 'Fresh route unavailable for hosted high-freshness request; no local fallback was attempted.'
        : 'Fresh route unavailable; answer may be stale.';
      fallbackReasonCode = freshRouteFailureReasons[0] || 'fresh-route-unavailable';
      policyReason = hostedSession
        ? 'Hosted high-freshness requests do not inherit local/default-provider fallback when Groq fresh route is unavailable.'
        : 'Fresh cloud route was required but unavailable; using truthful stale-risk fallback.';
    }
  } else if (classification?.freshnessNeed === 'medium') {
    if (explicitFreshness && freshRouteAvailable) {
      selectedProvider = selectedFreshProvider;
      selectedAnswerMode = 'fresh-cloud';
      freshnessRouted = true;
      policyReason = 'Prompt requested recency; cloud route selected for fresher truth.';
    } else if (explicitFreshness && !freshRouteAvailable) {
      selectedProvider = localRouteAvailable ? 'ollama' : requested;
      selectedAnswerMode = 'fallback-stale-risk';
      staleFallbackAttempted = localRouteAvailable;
      freshnessWarning = 'Answered without live web route; verify current facts.';
      fallbackReasonCode = freshRouteFailureReasons[0] || 'fresh-route-unavailable';
      policyReason = 'Prompt requested recency but fresh cloud route was unavailable.';
    } else if (!freshRouteAvailable && classification?.staleRisk !== 'low') {
      selectedProvider = localRouteAvailable ? 'ollama' : requested;
      selectedAnswerMode = 'fallback-stale-risk';
      staleFallbackAttempted = localRouteAvailable;
      freshnessWarning = 'Answered locally; current details may be stale.';
      fallbackReasonCode = freshRouteFailureReasons[0] || 'fresh-route-unavailable';
      policyReason = 'Medium freshness risk without fresh cloud path; local stale-risk fallback used.';
    }
  } else if (classification?.freshnessNeed !== 'low' && !localRouteAvailable && freshRouteAvailable) {
    selectedProvider = selectedFreshProvider;
    selectedAnswerMode = 'fresh-cloud';
    freshnessRouted = true;
    policyReason = 'Local route unavailable; cloud route selected as safe execution path.';
  } else if (classification?.freshnessNeed === 'low' && hostedSession) {
    if (!localRouteAvailable && cloudRouteAvailable) {
      selectedProvider = requestedProviderRouteViable
        ? requested
        : (selectedFreshProvider || 'gemini');
      selectedAnswerMode = 'cloud-basic';
      freshnessRouted = true;
      policyReason = 'Hosted session using zero-cost cloud reasoning path for low-freshness request.';
    } else if (localRouteAvailable) {
      selectedProvider = requested === 'groq' && cloudRouteAvailable ? 'groq' : 'ollama';
      selectedAnswerMode = selectedProvider === 'ollama' ? 'local-private' : 'cloud-basic';
      policyReason = selectedProvider === 'ollama'
        ? 'Hosted session has a reachable home-node bridge; local-private remains policy-valid.'
        : 'Hosted session selected cloud-basic because requested provider is cloud-capable and reachable.';
    } else if (!cloudRouteAvailable) {
      selectedProvider = requested;
      selectedAnswerMode = 'route-unavailable';
      fallbackReasonCode = 'no-viable-execution-path';
      policyReason = 'Hosted low-freshness request has no reachable cloud or local execution path.';
    }
  }

  const shouldForceHostedCloudBasic = classification?.freshnessNeed === 'low'
    && hostedSession
    && !localRouteAvailable
    && cloudRouteAvailable
    && selectedProvider !== 'ollama'
    && selectedAnswerMode !== 'cloud-basic';

  if (shouldForceHostedCloudBasic) {
    selectedAnswerMode = 'cloud-basic';
    freshnessRouted = true;
    fallbackReasonCode = null;
    policyReason = 'Hosted session using zero-cost cloud reasoning path for low-freshness request.';
  }

  const requestedProviderForRequest = selectedProvider;
  const overrideRequested = requestedProviderForRequest !== requested;
  const overrideDeniedReason = (
    classification?.freshnessNeed === 'high'
    && !hostedSession
    && !freshRouteAvailable
  )
    ? (fallbackReasonCode || 'fresh-route-unavailable')
    : null;

  return {
    freshnessRouted,
    selectedProvider,
    requestedProviderForRequest,
    selectedAnswerMode,
    freshnessWarning,
    staleFallbackAttempted,
    staleFallbackPermitted,
    aiPolicy,
    policyReason,
    overrideRequested,
    overrideDeniedReason,
    freshRouteAvailable,
    cloudRouteAvailable,
    localRouteAvailable,
    fallbackReasonCode,
    candidateFreshModel: candidateFreshModel || null,
    candidateFreshPath: candidateFreshPath || null,
    freshRouteValidation: {
      cloudRouteUsable,
      providerHealthy: Boolean(selectedFreshCandidate?.healthy),
      providerTransportReachable: Boolean(selectedFreshCandidate?.transportReachable),
      providerCapability: selectedFreshCapability,
      providerSupportsCurrentAnswers: selectedFreshProviderSupportsCurrentAnswers ?? primaryFreshProviderSupportsCurrentAnswers,
      selectedFreshProvider,
      webCapabilityState,
      failureReasons: freshRouteFailureReasons,
    },
    freshnessCandidateProvider: selectedFreshProvider || null,
  };
}
