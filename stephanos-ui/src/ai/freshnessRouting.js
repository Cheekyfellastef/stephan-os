const FRESHNESS_HIGH_PATTERNS = [
  /\b(uk|united kingdom|us|united states)\s+(prime minister|president)\b/i,
  /\b(who is|who's)\s+(the\s+)?(prime minister|president|ceo|governor|mayor)\b/i,
  /\b(latest|current|today|now|recent|breaking|update|news)\b/i,
  /\b(stock|price|weather|forecast|schedule|timetable|release date|regulation|law)\b/i,
  /\b(real[-\s]?time|live)\b/i,
  /\b(verify|check)\b.*\b(web|internet|online|source)\b/i,
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
  const currentAffairsLikely = includesAnyPattern(normalizedPrompt, FRESHNESS_HIGH_PATTERNS);
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
    return {
      freshnessNeed: explicitFreshness ? 'high' : 'medium',
      freshnessReason: explicitFreshness
        ? 'prompt requests current or latest information'
        : 'prompt appears current-affairs or frequently changing',
      currentAffairsLikely: true,
      webLookupRecommended: true,
      staleRisk: explicitFreshness ? 'high' : 'medium',
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

export function resolveFreshnessRoutingDecision({
  classification,
  requestedProvider = 'ollama',
  providerHealth = {},
  runtimeStatus = {},
  routeTruthView = {},
} = {}) {
  const requested = String(requestedProvider || 'ollama');
  const freshRouteAvailable = providerHealthy(providerHealth, 'groq')
    && runtimeStatus?.cloudAvailable === true
    && String(routeTruthView?.routeUsableState || '').toLowerCase() !== 'no';
  const localRouteAvailable = providerHealthy(providerHealth, 'ollama') || runtimeStatus?.localAvailable === true;
  const explicitFreshness = classification?.explicitFreshness === true;

  let selectedProvider = requested;
  let selectedAnswerMode = 'local-private';
  let freshnessWarning = null;
  let freshnessRouted = false;

  if (classification?.freshnessNeed === 'high') {
    if (freshRouteAvailable) {
      selectedProvider = 'groq';
      selectedAnswerMode = 'fresh-web';
      freshnessRouted = true;
    } else {
      selectedProvider = localRouteAvailable ? 'ollama' : requested;
      selectedAnswerMode = 'fallback-stale-risk';
      freshnessWarning = 'Fresh route unavailable; answer may be stale.';
    }
  } else if (classification?.freshnessNeed === 'medium') {
    if (explicitFreshness && freshRouteAvailable) {
      selectedProvider = 'groq';
      selectedAnswerMode = 'fresh-web';
      freshnessRouted = true;
    } else if (explicitFreshness && !freshRouteAvailable) {
      selectedProvider = localRouteAvailable ? 'ollama' : requested;
      selectedAnswerMode = 'fallback-stale-risk';
      freshnessWarning = 'Answered without live web route; verify current facts.';
    } else if (!freshRouteAvailable && classification?.staleRisk !== 'low') {
      selectedProvider = localRouteAvailable ? 'ollama' : requested;
      selectedAnswerMode = 'fallback-stale-risk';
      freshnessWarning = 'Answered locally; current details may be stale.';
    }
  } else if (!localRouteAvailable && freshRouteAvailable) {
    selectedProvider = 'groq';
    selectedAnswerMode = 'fresh-web';
    freshnessRouted = true;
  }

  return {
    freshnessRouted,
    selectedProvider,
    selectedAnswerMode,
    freshnessWarning,
    freshRouteAvailable,
    localRouteAvailable,
  };
}
