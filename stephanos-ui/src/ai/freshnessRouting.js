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
  const aiPolicy = {
    aiPolicyMode: 'local-first-cloud-when-needed',
    localPreferred: true,
    cloudAllowedForFreshness: true,
    cloudReasonRequired: true,
  };
  const requested = String(requestedProvider || 'ollama');
  const backendReachable = String(routeTruthView?.backendReachableState || '').toLowerCase() === 'yes'
    || runtimeStatus?.backendReachable === true;
  const cloudRouteUsable = runtimeStatus?.cloudAvailable === true && backendReachable;
  const groqHealthy = providerHealthy(providerHealth, 'groq');
  const groqTransportReachable = providerTransportReachable(providerHealth, 'groq');
  const groqCapability = providerHealth?.groq?.providerCapability || {};
  const webCapabilityState = resolveWebCapabilityState(providerHealth, 'groq');
  const groqSupportsCurrentAnswers = resolveCurrentAnswerCapability(providerHealth, 'groq');
  const freshRouteAvailable = cloudRouteUsable
    && groqHealthy
    && groqTransportReachable
    && groqSupportsCurrentAnswers !== false
    && webCapabilityState !== 'unsupported';
  const localRouteAvailable = providerHealthy(providerHealth, 'ollama') || runtimeStatus?.localAvailable === true;
  const explicitFreshness = classification?.explicitFreshness === true;

  let selectedProvider = requested;
  let selectedAnswerMode = 'local-private';
  let freshnessWarning = null;
  let freshnessRouted = false;
  let fallbackReasonCode = null;
  let policyReason = 'Local-private default for low-freshness or private/system reasoning.';

  const freshRouteFailureReasons = [];
  if (!cloudRouteUsable) freshRouteFailureReasons.push('groq-cloud-route-unusable');
  if (!groqHealthy) freshRouteFailureReasons.push('groq-provider-unhealthy');
  if (!groqTransportReachable) freshRouteFailureReasons.push('groq-transport-unreachable');
  if (groqSupportsCurrentAnswers === false) freshRouteFailureReasons.push('groq-current-answers-unsupported');
  if (webCapabilityState === 'unsupported') freshRouteFailureReasons.push('groq-web-capability-unsupported');

  if (classification?.freshnessNeed === 'high') {
    if (freshRouteAvailable) {
      selectedProvider = 'groq';
      selectedAnswerMode = 'fresh-cloud';
      freshnessRouted = true;
      policyReason = 'Cloud routing allowed and selected because current real-world truth is required.';
    } else {
      selectedProvider = localRouteAvailable ? 'ollama' : requested;
      selectedAnswerMode = 'fallback-stale-risk';
      freshnessWarning = 'Fresh route unavailable; answer may be stale.';
      fallbackReasonCode = freshRouteFailureReasons[0] || 'fresh-route-unavailable';
      policyReason = 'Fresh cloud route was required but unavailable; using truthful stale-risk fallback.';
    }
  } else if (classification?.freshnessNeed === 'medium') {
    if (explicitFreshness && freshRouteAvailable) {
      selectedProvider = 'groq';
      selectedAnswerMode = 'fresh-cloud';
      freshnessRouted = true;
      policyReason = 'Prompt requested recency; cloud route selected for fresher truth.';
    } else if (explicitFreshness && !freshRouteAvailable) {
      selectedProvider = localRouteAvailable ? 'ollama' : requested;
      selectedAnswerMode = 'fallback-stale-risk';
      freshnessWarning = 'Answered without live web route; verify current facts.';
      fallbackReasonCode = freshRouteFailureReasons[0] || 'fresh-route-unavailable';
      policyReason = 'Prompt requested recency but fresh cloud route was unavailable.';
    } else if (!freshRouteAvailable && classification?.staleRisk !== 'low') {
      selectedProvider = localRouteAvailable ? 'ollama' : requested;
      selectedAnswerMode = 'fallback-stale-risk';
      freshnessWarning = 'Answered locally; current details may be stale.';
      fallbackReasonCode = freshRouteFailureReasons[0] || 'fresh-route-unavailable';
      policyReason = 'Medium freshness risk without fresh cloud path; local stale-risk fallback used.';
    }
  } else if (!localRouteAvailable && freshRouteAvailable) {
    selectedProvider = 'groq';
    selectedAnswerMode = 'fresh-cloud';
    freshnessRouted = true;
    policyReason = 'Local route unavailable; cloud route selected as safe execution path.';
  }

  const requestedProviderForRequest = selectedProvider;
  const overrideRequested = requestedProviderForRequest !== requested;
  const overrideDeniedReason = (
    classification?.freshnessNeed === 'high'
    && requestedProviderForRequest !== 'groq'
  )
    ? (fallbackReasonCode || 'fresh-route-unavailable')
    : null;

  return {
    freshnessRouted,
    selectedProvider,
    requestedProviderForRequest,
    selectedAnswerMode,
    freshnessWarning,
    aiPolicy,
    policyReason,
    overrideRequested,
    overrideDeniedReason,
    freshRouteAvailable,
    localRouteAvailable,
    fallbackReasonCode,
    freshRouteValidation: {
      cloudRouteUsable,
      providerHealthy: groqHealthy,
      providerTransportReachable: groqTransportReachable,
      providerCapability: groqCapability,
      providerSupportsCurrentAnswers: groqSupportsCurrentAnswers,
      webCapabilityState,
      failureReasons: freshRouteFailureReasons,
    },
  };
}
