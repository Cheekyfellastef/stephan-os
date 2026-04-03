import {
  AI_SETTINGS_STORAGE_KEY,
  CLOUD_FIRST_PROVIDER_KEYS,
  CLOUD_PROVIDER_KEYS,
  DEFAULT_PROVIDER_KEY,
  DEFAULT_ROUTE_MODE,
  FALLBACK_PROVIDER_KEYS,
  LOCAL_FIRST_PROVIDER_KEYS,
  LOCAL_PROVIDER_KEYS,
  PROVIDER_DEFINITIONS,
  normalizeFallbackOrder,
  normalizeProviderSelection,
  normalizeRouteMode,
} from '../ai/providerDefaults.mjs';
import {
  isMalformedStephanosHost,
  isLikelyLanHost,
  isLoopbackHost,
  normalizeStephanosHomeNode,
} from './stephanosHomeNode.mjs';
import { readPersistedStephanosSessionMemory } from './stephanosSessionMemory.mjs';
import { STEPHANOS_PROVIDER_ROUTING_MARKER, STEPHANOS_ROUTE_ADOPTION_MARKER } from './stephanosRouteMarkers.mjs';
import { evaluateRuntimeGuardrails } from './runtimeGuardrails.mjs';
import { adjudicateRuntimeTruth } from './runtimeAdjudicator.mjs';

function isBrowserStorageAvailable(storage) {
  return storage && typeof storage.getItem === 'function';
}

function normalizeProviderHealth(providerHealth = {}) {
  return providerHealth && typeof providerHealth === 'object' ? providerHealth : {};
}

function parseHostname(value = '') {
  try {
    return new URL(value).hostname || '';
  } catch {
    return '';
  }
}

function resolveCompatibleUrl(candidate = '', fallback = '', { allowLoopback = false } = {}) {
  const candidateHost = parseHostname(candidate);
  if (candidate && !isMalformedStephanosHost(candidateHost) && (allowLoopback || !isLoopbackHost(candidateHost))) {
    return candidate;
  }

  const fallbackHost = parseHostname(fallback);
  if (fallback && !isMalformedStephanosHost(fallbackHost) && (allowLoopback || !isLoopbackHost(fallbackHost))) {
    return fallback;
  }

  return allowLoopback ? (candidate || fallback || '') : '';
}

export function normalizeRuntimeContext(runtimeContext = {}) {
  const frontendOrigin = String(runtimeContext.frontendOrigin || '');
  const apiBaseUrl = String(runtimeContext.apiBaseUrl || runtimeContext.backendBaseUrl || runtimeContext.baseUrl || '');
  const frontendHost = parseHostname(frontendOrigin);
  const backendHost = parseHostname(apiBaseUrl);
  const frontendLocal = isLoopbackHost(frontendHost) || !frontendHost;
  const backendLocal = isLoopbackHost(backendHost) || !backendHost;
  const launcherLocal = frontendLocal;
  const frontendReachability = frontendLocal ? 'local' : 'reachable';
  const backendReachability = backendLocal && launcherLocal ? 'local' : 'reachable';
  const homeNode = normalizeStephanosHomeNode(runtimeContext.homeNode || {}, {
    source: runtimeContext.homeNode?.source || 'manual',
  });
  const loopbackBackendMismatch = !launcherLocal && backendLocal;
  const localDesktopBackendSession = !launcherLocal
    && backendLocal
    && runtimeContext.routeDiagnostics?.['local-desktop']?.configured === true;
  const deviceContext = launcherLocal || localDesktopBackendSession
    ? 'pc-local-browser'
    : (homeNode.reachable || (homeNode.configured && isLikelyLanHost(homeNode.host)) || isLikelyLanHost(backendHost))
      ? 'lan-companion'
      : 'off-network';
  const sessionKind = launcherLocal || localDesktopBackendSession ? 'local-desktop' : 'hosted-web';
  const compatiblePreferredTarget = resolveCompatibleUrl(
    runtimeContext.preferredTarget,
    homeNode?.uiUrl || frontendOrigin || apiBaseUrl,
    { allowLoopback: launcherLocal },
  );
  const compatibleActualTarget = resolveCompatibleUrl(
    runtimeContext.actualTargetUsed,
    homeNode?.backendUrl || (!loopbackBackendMismatch ? apiBaseUrl : '') || frontendOrigin,
    { allowLoopback: launcherLocal },
  );

  return {
    frontendOrigin,
    apiBaseUrl,
    baseUrl: apiBaseUrl,
    frontendHost,
    backendHost,
    frontendReachability,
    backendReachability,
    frontendLocal,
    backendLocal,
    deviceContext,
    sessionKind,
    localNodeReachableFromSession: runtimeContext.localNodeReachableFromSession,
    homeNode,
    publishedClientRouteState: runtimeContext.publishedClientRouteState || 'unknown',
    preferredTarget: compatiblePreferredTarget,
    actualTargetUsed: compatibleActualTarget,
    nodeAddressSource: runtimeContext.nodeAddressSource || (homeNode?.configured ? homeNode.source : '') || (launcherLocal ? 'local-backend-session' : 'route-diagnostics'),
    restoreDecision: String(runtimeContext.restoreDecision || ''),
    routeDiagnostics: runtimeContext.routeDiagnostics && typeof runtimeContext.routeDiagnostics === 'object'
      ? runtimeContext.routeDiagnostics
      : {},
    memoryTruth: runtimeContext.memoryTruth && typeof runtimeContext.memoryTruth === 'object'
      ? runtimeContext.memoryTruth
      : {},
    tileTruth: runtimeContext.tileTruth && typeof runtimeContext.tileTruth === 'object'
      ? runtimeContext.tileTruth
      : {},
    homeNodeOperatorOverrideActive: runtimeContext.homeNodeOperatorOverrideActive === true,
    homeNodeOperatorOverrideNodeConfigured: runtimeContext.homeNodeOperatorOverrideNodeConfigured === true,
    loopbackBackendMismatch,
  };
}

function orderedProviders(primaryOrder = [], fallbackOrder = []) {
  return [...new Set([
    ...primaryOrder,
    ...normalizeFallbackOrder(fallbackOrder),
    ...Object.keys(PROVIDER_DEFINITIONS),
  ])].filter((providerKey) => PROVIDER_DEFINITIONS[providerKey]);
}

export function readPersistedProviderPreferences(storage = globalThis?.localStorage) {
  const defaults = {
    selectedProvider: DEFAULT_PROVIDER_KEY,
    routeMode: DEFAULT_ROUTE_MODE,
    fallbackEnabled: true,
    fallbackOrder: [...FALLBACK_PROVIDER_KEYS],
  };

  if (!isBrowserStorageAvailable(storage)) {
    return defaults;
  }

  const persistedSession = readPersistedStephanosSessionMemory(storage);
  const persistedProviderPreferences = persistedSession?.session?.providerPreferences;
  if (persistedProviderPreferences) {
    return {
      selectedProvider: normalizeProviderSelection(persistedProviderPreferences.provider),
      routeMode: normalizeRouteMode(persistedProviderPreferences.routeMode),
      fallbackEnabled: persistedProviderPreferences.fallbackEnabled !== false,
      fallbackOrder: normalizeFallbackOrder(persistedProviderPreferences.fallbackOrder),
    };
  }

  try {
    const parsed = JSON.parse(storage.getItem(AI_SETTINGS_STORAGE_KEY) || '{}');
    return {
      selectedProvider: normalizeProviderSelection(parsed.provider),
      routeMode: normalizeRouteMode(parsed.routeMode),
      fallbackEnabled: parsed.fallbackEnabled !== false,
      fallbackOrder: normalizeFallbackOrder(parsed.fallbackOrder),
    };
  } catch {
    return defaults;
  }
}

export function getReadyCloudProviders(providerHealth = {}, fallbackOrder = FALLBACK_PROVIDER_KEYS) {
  const health = normalizeProviderHealth(providerHealth);
  return orderedProviders(CLOUD_FIRST_PROVIDER_KEYS, fallbackOrder)
    .filter((providerKey) => CLOUD_PROVIDER_KEYS.includes(providerKey))
    .filter((providerKey) => health[providerKey]?.ok);
}

function getReadyLocalProviders(providerHealth = {}) {
  const health = normalizeProviderHealth(providerHealth);
  return LOCAL_PROVIDER_KEYS.filter((providerKey) => health[providerKey]?.ok);
}

function chooseAutoRouteMode({ runtimeContext, localAvailable, cloudAvailable }) {
  if (runtimeContext.deviceContext === 'lan-companion') {
    if (localAvailable) return 'local-first';
    if (cloudAvailable) return 'cloud-first';
    return 'local-first';
  }

  if (runtimeContext.sessionKind === 'hosted-web') {
    if (cloudAvailable) return 'cloud-first';
    if (localAvailable) return 'local-first';
    return 'cloud-first';
  }

  if (localAvailable) return 'local-first';
  if (cloudAvailable) return 'cloud-first';
  return 'local-first';
}

function getPreferredLocalFailure(providerHealth = {}) {
  const health = normalizeProviderHealth(providerHealth);
  for (const providerKey of LOCAL_PROVIDER_KEYS) {
    const providerState = health[providerKey];
    if (!providerState || providerState.ok) {
      continue;
    }

    const detail = String(
      providerState.reason
      || providerState.detail
      || providerState.message
      || providerState.failureReason
      || '',
    ).trim();
    const label = PROVIDER_DEFINITIONS[providerKey]?.label || providerKey;
    return detail ? `${label} unavailable: ${detail}` : `${label} unavailable`;
  }

  return 'Local Ollama unavailable';
}

function deriveRoutePlan({
  selectedProvider = DEFAULT_PROVIDER_KEY,
  routeMode = DEFAULT_ROUTE_MODE,
  fallbackEnabled = true,
  fallbackOrder = FALLBACK_PROVIDER_KEYS,
  providerHealth = {},
  runtimeContext = {},
} = {}) {
  const normalizedProvider = normalizeProviderSelection(selectedProvider);
  const normalizedRouteMode = normalizeRouteMode(routeMode);
  const health = normalizeProviderHealth(providerHealth);
  const readyLocalProviders = getReadyLocalProviders(health);
  const readyCloudProviders = getReadyCloudProviders(health, fallbackOrder);
  const localAvailable = readyLocalProviders.length > 0;
  const cloudAvailable = readyCloudProviders.length > 0;
  const effectiveRouteMode = normalizedRouteMode === 'auto'
    ? chooseAutoRouteMode({ runtimeContext, localAvailable, cloudAvailable })
    : normalizedRouteMode;

  let preferredOrder;
  if (effectiveRouteMode === 'explicit') {
    preferredOrder = [normalizedProvider];
  } else if (effectiveRouteMode === 'cloud-first') {
    preferredOrder = CLOUD_FIRST_PROVIDER_KEYS;
  } else {
    preferredOrder = LOCAL_FIRST_PROVIDER_KEYS;
  }

  const attemptOrder = orderedProviders(preferredOrder, fallbackEnabled ? fallbackOrder : [])
    .filter((providerKey) => {
      if (providerKey === 'openrouter') {
        return Boolean(health.openrouter?.config?.enabled || health.openrouter?.ok);
      }
      return true;
    });

  const selectedFromHealth = effectiveRouteMode === 'explicit'
    ? normalizedProvider
    : attemptOrder.find((providerKey) => health[providerKey]?.ok) || attemptOrder[0] || normalizedProvider;

  return {
    requestedProvider: normalizedProvider,
    requestedRouteMode: normalizedRouteMode,
    effectiveRouteMode,
    selectedProvider: selectedFromHealth,
    attemptOrder: effectiveRouteMode === 'explicit' ? [normalizedProvider] : attemptOrder,
    readyLocalProviders,
    readyCloudProviders,
    localAvailable,
    cloudAvailable,
  };
}

function asTriState(value) {
  if (value === true) return 'reachable';
  if (value === false) return 'unreachable';
  return 'unknown';
}


function buildRoutePreference(runtimeContext = {}) {
  if (runtimeContext.deviceContext === 'pc-local-browser') {
    return ['local-desktop', 'home-node', 'cloud', 'dist'];
  }

  if (runtimeContext.routeDiagnostics?.['local-desktop']?.configured === true && runtimeContext.backendLocal) {
    return ['local-desktop', 'home-node', 'cloud', 'dist'];
  }

  if (runtimeContext.deviceContext === 'lan-companion') {
    return ['home-node', 'cloud', 'dist', 'local-desktop'];
  }

  return ['cloud', 'home-node', 'local-desktop', 'dist'];
}

function createRouteEvaluation(routeKey, defaults = {}, override = {}) {
  const merged = { ...defaults, ...(override && typeof override === 'object' ? override : {}) };
  return {
    kind: routeKey,
    available: Boolean(merged.available),
    configured: merged.configured !== false,
    misconfigured: Boolean(merged.misconfigured),
    optional: Boolean(merged.optional),
    target: typeof merged.target === 'string' ? merged.target : '',
    actualTarget: typeof merged.actualTarget === 'string' ? merged.actualTarget : '',
    source: String(merged.source || 'route-diagnostics'),
    reason: String(merged.reason || ''),
    blockedReason: String(merged.blockedReason || ''),
    backendReachable: merged.backendReachable === true ? true : (merged.backendReachable === false ? false : null),
    uiReachable: merged.uiReachable === true ? true : (merged.uiReachable === false ? false : null),
    usable: merged.usable !== false && Boolean(merged.available),
    backendTargetResolutionSource: String(merged.backendTargetResolutionSource || ''),
    backendTargetResolvedUrl: String(merged.backendTargetResolvedUrl || ''),
    backendTargetFallbackUsed: merged.backendTargetFallbackUsed === true,
    backendTargetInvalidReason: String(merged.backendTargetInvalidReason || ''),
  };
}

function deriveFallbackSuppressionReason(routeKey, evaluations, preferenceOrder = []) {
  const preferredLiveRoutes = preferenceOrder
    .filter((candidate) => candidate !== routeKey && candidate !== 'dist');

  for (const candidate of preferredLiveRoutes) {
    const evaluation = evaluations[candidate];
    if (!evaluation?.configured) {
      continue;
    }

    if (evaluation.available) {
      return `${candidate} is a valid live route and outranks ${routeKey}`;
    }

    if (evaluation.blockedReason) {
      return `${candidate} unavailable: ${evaluation.blockedReason}`;
    }

    if (evaluation.reason) {
      return `${candidate} unavailable: ${evaluation.reason}`;
    }
  }

  return '';
}

function deriveRouteEvaluations({ runtimeContext, backendAvailable, cloudAvailable, validationState }) {
  const diagnostics = runtimeContext.routeDiagnostics || {};
  const localDesktopDiagnosticEligible = diagnostics['local-desktop']?.configured === true
    && runtimeContext.backendLocal;
  const localDesktopSession = runtimeContext.deviceContext === 'pc-local-browser'
    || runtimeContext.sessionKind === 'local-desktop'
    || localDesktopDiagnosticEligible;
  const hostedCloudSession = runtimeContext.sessionKind === 'hosted-web' && backendAvailable && cloudAvailable;
  const homeNodeConfigured = Boolean(runtimeContext.homeNode?.configured);
  const homeNodeReachable = Boolean(runtimeContext.homeNode?.reachable);
  const homeNodeOverrideActive = runtimeContext.homeNodeOperatorOverrideActive === true && localDesktopSession;
  const homeNodeConfiguredOverride = diagnostics['home-node'] && typeof diagnostics['home-node'].configured === 'boolean'
    ? diagnostics['home-node'].configured
    : undefined;
  const effectiveHomeNodeConfigured = homeNodeOverrideActive
    ? false
    : (homeNodeConfiguredOverride ?? homeNodeConfigured);
  const effectiveHomeNodeReachable = effectiveHomeNodeConfigured && homeNodeReachable;
  const homeNodeMisconfigured = homeNodeReachable && runtimeContext.publishedClientRouteState === 'misconfigured';
  const localDesktopProbe = diagnostics['local-desktop'] || {};
  const homeNodeProbe = diagnostics['home-node'] || {};
  const distProbe = diagnostics.dist || {};
  const localDesktopAvailable = localDesktopSession && backendAvailable;
  const localDesktopProbeAvailable = localDesktopProbe.available === true;
  const localDesktopClassificationFailed = localDesktopSession && backendAvailable && localDesktopProbe.available === false;
  const localDesktopSource = localDesktopProbe.source && localDesktopProbe.source !== 'not-applicable'
    ? localDesktopProbe.source
    : (runtimeContext.backendLocal ? 'local-backend-session' : 'local-browser-session');
  const localDesktopReadyReason = localDesktopProbeAvailable
    ? 'Backend online and local desktop route probe succeeded'
    : (runtimeContext.backendLocal
      ? 'Backend online locally; local-desktop stays valid and will use bundled dist UI until a live UI probe is available'
      : 'Backend online from local desktop session; using bundled dist UI until a live UI probe is published');
  const localDesktopBlockedReason = localDesktopProbeAvailable
    ? ''
    : 'backend is online locally, but no explicit live UI route was published';

  const evaluations = {
    'local-desktop': createRouteEvaluation('local-desktop', {
      configured: localDesktopSession,
      available: localDesktopAvailable,
      misconfigured: localDesktopClassificationFailed,
      optional: runtimeContext.deviceContext !== 'pc-local-browser',
      source: localDesktopSession ? localDesktopSource : 'not-applicable',
      reason: localDesktopSession
        ? (backendAvailable
          ? localDesktopReadyReason
          : 'Local desktop browser detected, but the backend is offline')
        : 'Current session is not a local desktop browser',
      blockedReason: localDesktopSession
        ? (backendAvailable
          ? (localDesktopProbe.blockedReason || localDesktopBlockedReason)
          : 'backend is offline')
        : 'not a local desktop session',
    }, {
      ...localDesktopProbe,
      available: localDesktopAvailable,
      misconfigured: localDesktopClassificationFailed || Boolean(localDesktopProbe.misconfigured),
      source: localDesktopSession ? localDesktopSource : 'not-applicable',
      reason: localDesktopProbe.reason || (localDesktopSession
        ? (backendAvailable
          ? localDesktopReadyReason
          : 'Local desktop browser detected, but the backend is offline')
        : 'Current session is not a local desktop browser'),
      blockedReason: localDesktopProbe.blockedReason || (localDesktopSession
        ? (backendAvailable
          ? localDesktopBlockedReason
          : 'backend is offline')
        : 'not a local desktop session'),
    }),
    'home-node': createRouteEvaluation('home-node', {
      configured: effectiveHomeNodeConfigured,
      available: effectiveHomeNodeReachable,
      misconfigured: effectiveHomeNodeReachable && homeNodeMisconfigured,
      optional: runtimeContext.deviceContext === 'pc-local-browser',
      source: homeNodeOverrideActive
        ? 'local-operator-override'
        : (runtimeContext.homeNode?.source || (effectiveHomeNodeConfigured ? 'configured-home-node' : 'not-configured')),
      reason: homeNodeOverrideActive
        ? 'Home-node/manual route source ignored for this local browser session by operator override.'
        : effectiveHomeNodeReachable
        ? (homeNodeMisconfigured
          ? 'Home PC node is reachable, but the published client route is misconfigured'
          : 'Home PC node is reachable on the LAN')
        : (effectiveHomeNodeConfigured
          ? 'Home PC node is configured but currently unreachable'
          : 'Home PC node is not configured'),
      blockedReason: homeNodeOverrideActive
        ? 'home-node/manual route source ignored by local operator override'
        : effectiveHomeNodeConfigured
        ? (homeNodeProbe.blockedReason || (effectiveHomeNodeReachable ? '' : 'health probe could not confirm the home-node route'))
        : 'home node is not configured',
    }, {
      ...homeNodeProbe,
      configured: effectiveHomeNodeConfigured,
      available: effectiveHomeNodeReachable,
      misconfigured: effectiveHomeNodeReachable && (homeNodeMisconfigured || Boolean(homeNodeProbe.misconfigured)),
      source: homeNodeOverrideActive
        ? 'local-operator-override'
        : (homeNodeProbe.source || runtimeContext.homeNode?.source || (effectiveHomeNodeConfigured ? 'configured-home-node' : 'not-configured')),
      reason: homeNodeOverrideActive
        ? 'Home-node/manual route source ignored for this local browser session by operator override.'
        : homeNodeProbe.reason || (effectiveHomeNodeReachable
        ? (homeNodeMisconfigured
          ? 'Home PC node is reachable, but the published client route is misconfigured'
          : 'Home PC node is reachable on the LAN')
        : (effectiveHomeNodeConfigured
          ? 'Home PC node is configured but currently unreachable'
          : 'Home PC node is not configured')),
      blockedReason: homeNodeOverrideActive
        ? 'home-node/manual route source ignored by local operator override'
        : homeNodeProbe.blockedReason || (effectiveHomeNodeConfigured
        ? (effectiveHomeNodeReachable ? '' : 'health probe could not confirm the home-node route')
        : 'home node is not configured'),
    }),
    dist: createRouteEvaluation('dist', {
      configured: Boolean(distProbe.configured),
      available: Boolean(distProbe.available),
      misconfigured: false,
      optional: false,
      target: typeof distProbe.target === 'string' ? distProbe.target : '',
      actualTarget: typeof distProbe.actualTarget === 'string' ? distProbe.actualTarget : '',
      source: distProbe.source || 'dist-entry',
      reason: distProbe.reason || 'Bundled dist runtime is not the active route',
      blockedReason: '',
    }, distProbe),
    cloud: createRouteEvaluation('cloud', {
      configured: diagnostics.cloud?.configured === true || hostedCloudSession,
      available: diagnostics.cloud?.available === true || hostedCloudSession,
      misconfigured: false,
      optional: false,
      target: typeof diagnostics.cloud?.target === 'string' ? diagnostics.cloud.target : '',
      actualTarget: typeof diagnostics.cloud?.actualTarget === 'string' ? diagnostics.cloud.actualTarget : '',
      source: diagnostics.cloud?.source || (hostedCloudSession ? 'backend-cloud-session' : 'cloud-route-unavailable'),
      reason: hostedCloudSession
        ? 'A cloud-backed Stephanos route is ready'
        : 'No cloud-backed Stephanos route is currently ready',
      blockedReason: hostedCloudSession ? '' : 'no cloud-backed route is currently ready',
      backendTargetResolutionSource: diagnostics.backendTargetResolutionSource || '',
      backendTargetResolvedUrl: diagnostics.backendTargetResolvedUrl || '',
      backendTargetFallbackUsed: diagnostics.backendTargetFallbackUsed === true,
      backendTargetInvalidReason: diagnostics.backendTargetInvalidReason || '',
    }, diagnostics.cloud),
  };

  const preferenceOrder = buildRoutePreference(runtimeContext);
  if (evaluations.dist.available && !evaluations.dist.reason) {
    evaluations.dist.reason = 'Bundled dist runtime is reachable';
  }
  if (evaluations.dist.available) {
    const suppressionReason = deriveFallbackSuppressionReason('dist', evaluations, preferenceOrder);
    if (suppressionReason) {
      evaluations.dist.blockedReason = suppressionReason;
      evaluations.dist.reason = `${evaluations.dist.reason || 'Bundled dist runtime is reachable'} · fallback only because ${suppressionReason}`;
    }
  }

  const preferredRoute = preferenceOrder.find((routeKey) => evaluations[routeKey]?.available && evaluations[routeKey]?.usable !== false)
    || preferenceOrder.find((routeKey) => evaluations[routeKey]?.available)
    || null;

  return {
    evaluations,
    preferenceOrder,
    preferredRoute,
    localDesktopClassificationFailed,
  };
}

function summarizeSelectedRoute(routeKey, route, runtimeContext, backendAvailable, validationState) {
  const backendTargetInvalidReason = String(runtimeContext.routeDiagnostics?.backendTargetInvalidReason || '').trim();
  if (!routeKey || !route) {
    if (runtimeContext.sessionKind === 'hosted-web' && backendTargetInvalidReason) {
      return {
        headline: 'Hosted backend target unresolved',
        summary: `Hosted session has no valid backend target; ${backendTargetInvalidReason}.`,
      };
    }

    if (backendAvailable && runtimeContext.frontendLocal) {
      return {
        headline: 'Backend online but route classification failed',
        summary: 'Backend online, but Stephanos could not classify a valid route explicitly',
      };
    }

    const homeNodeBlockedReason = runtimeContext.routeDiagnostics?.['home-node']?.blockedReason || runtimeContext.routeDiagnostics?.['home-node']?.reason || '';
    if (runtimeContext.homeNode?.configured && homeNodeBlockedReason) {
      return {
        headline: 'Home PC node unavailable',
        summary: `Home PC node unavailable: ${homeNodeBlockedReason}`,
      };
    }

    return {
      headline: 'No reachable Stephanos route',
      summary: 'No reachable Stephanos route',
    };
  }

  if (routeKey === 'local-desktop') {
    return {
      headline: 'Local desktop runtime ready',
      summary: !backendAvailable
        ? 'Local desktop runtime reachable, but backend is offline'
        : route.reason || 'Local desktop runtime ready',
    };
  }

  if (routeKey === 'home-node') {
    return {
      headline: route.misconfigured ? 'Home PC node reachable with route issues' : 'Home PC node ready',
      summary: route.reason || 'Home PC node ready',
    };
  }

  if (routeKey === 'dist') {
    return {
      headline: 'Bundled dist route ready',
      summary: route.reason || 'Bundled dist runtime is reachable',
    };
  }

  if (routeKey === 'cloud') {
    return {
      headline: 'Cloud route ready',
      summary: route.reason || 'Cloud route ready',
    };
  }

  if (validationState === 'launching') {
    return {
      headline: 'Checking reachable Stephanos route',
      summary: 'Checking reachable Stephanos route',
    };
  }

  return {
    headline: 'No reachable Stephanos route',
    summary: route.reason || 'No reachable Stephanos route',
  };
}

function deriveNodeRoute({ runtimeContext, backendAvailable, cloudAvailable, validationState }) {
  const routeSelection = deriveRouteEvaluations({ runtimeContext, backendAvailable, cloudAvailable, validationState });
  const selectedRouteKey = routeSelection.preferredRoute;
  const selectedRoute = selectedRouteKey ? routeSelection.evaluations[selectedRouteKey] : null;
  const selectedSummary = summarizeSelectedRoute(
    selectedRouteKey,
    selectedRoute,
    runtimeContext,
    backendAvailable,
    validationState,
  );
  const localDesktop = routeSelection.evaluations['local-desktop'];
  const homeNode = routeSelection.evaluations['home-node'];
  const cloud = routeSelection.evaluations.cloud;
  let preferredTarget = runtimeContext.preferredTarget;
  let actualTargetUsed = runtimeContext.actualTargetUsed;

  if (selectedRouteKey === 'local-desktop') {
    preferredTarget = selectedRoute?.target || runtimeContext.actualTargetUsed || runtimeContext.apiBaseUrl || runtimeContext.preferredTarget;
    actualTargetUsed = selectedRoute?.actualTarget || runtimeContext.actualTargetUsed || runtimeContext.apiBaseUrl || preferredTarget;
  } else if (selectedRouteKey === 'home-node') {
    preferredTarget = selectedRoute?.target || runtimeContext.homeNode?.backendUrl || runtimeContext.preferredTarget;
    actualTargetUsed = selectedRoute?.actualTarget || runtimeContext.homeNode?.backendUrl || runtimeContext.actualTargetUsed || preferredTarget;
  } else if (selectedRouteKey === 'dist') {
    preferredTarget = selectedRoute?.target || runtimeContext.preferredTarget;
    actualTargetUsed = selectedRoute?.actualTarget || selectedRoute?.target || runtimeContext.actualTargetUsed || preferredTarget;
  } else if (selectedRouteKey === 'cloud') {
    preferredTarget = selectedRoute?.target || runtimeContext.preferredTarget;
    actualTargetUsed = selectedRoute?.actualTarget || selectedRoute?.target || runtimeContext.actualTargetUsed || preferredTarget;
  }

  const nodeAddressSource = selectedRoute?.kind === 'local-desktop'
    ? (selectedRoute.source || runtimeContext.nodeAddressSource || (runtimeContext.frontendLocal ? 'local-browser-session' : 'route-diagnostics'))
    : (runtimeContext.homeNode?.configured || runtimeContext.nodeAddressSource)
      ? ((runtimeContext.nodeAddressSource && runtimeContext.nodeAddressSource !== 'route-diagnostics')
        || (runtimeContext.homeNode?.configured && runtimeContext.homeNode?.source)
        ? (runtimeContext.nodeAddressSource || runtimeContext.homeNode?.source || selectedRoute?.source || (runtimeContext.frontendLocal ? 'local-browser-session' : 'route-diagnostics'))
        : (selectedRoute?.source || runtimeContext.nodeAddressSource || (runtimeContext.frontendLocal ? 'local-browser-session' : 'route-diagnostics')))
      : (selectedRoute?.source || (runtimeContext.frontendLocal ? 'local-browser-session' : 'route-diagnostics'));

  return {
    routeKind: selectedRouteKey || 'unavailable',
    preferredTarget,
    actualTargetUsed,
    localNodeReachable: Boolean(localDesktop.available || homeNode.available || runtimeContext.localNodeReachableFromSession === true),
    homeNodeReachable: Boolean(homeNode.available),
    cloudRouteReachable: Boolean(cloud.available),
    routeSummary: selectedSummary.summary,
    routeHeadline: selectedSummary.headline,
    nodeAddressSource,
    routeEvaluations: routeSelection.evaluations,
    routePreferenceOrder: routeSelection.preferenceOrder,
    preferredRoute: selectedRouteKey,
    winnerReason: selectedRoute?.reason || '',
    classificationFailed: Boolean(routeSelection.localDesktopClassificationFailed || (backendAvailable && !selectedRouteKey)),
  };
}

function buildProviderEligibility({
  routeKind,
  routeEvaluations,
  backendAvailable,
  localAvailable,
  cloudAvailable,
} = {}) {
  const selectedRoute = routeKind ? routeEvaluations?.[routeKind] : null;
  const truthfulBackendReachable = routeKind === 'local-desktop' || routeKind === 'home-node';
  const fallbackOnlyRoute = routeKind === 'dist' || routeKind === 'unavailable';

  return {
    truthfulBackendRoute: truthfulBackendReachable,
    backendMediatedProviders: truthfulBackendReachable && backendAvailable,
    localProviders: truthfulBackendReachable && backendAvailable && localAvailable,
    cloudProviders: (truthfulBackendReachable || routeKind === 'cloud') && (backendAvailable || routeKind === 'cloud') && cloudAvailable,
    distFallbackOnly: routeKind === 'dist',
    mockFallbackOnly: fallbackOnlyRoute,
    selectedRouteAvailable: Boolean(selectedRoute?.available),
  };
}

export function finalizeRuntimeRouteResolution({
  runtimeContext,
  nodeRoute,
  backendAvailable,
  localAvailable,
  cloudAvailable,
} = {}) {
  const selectedRoute = nodeRoute?.preferredRoute ? nodeRoute.routeEvaluations?.[nodeRoute.preferredRoute] : null;
  const actualTarget = nodeRoute?.actualTargetUsed || '';
  const finalRoute = {
    routeKind: nodeRoute?.routeKind || 'unavailable',
    preferredTarget: nodeRoute?.preferredTarget || '',
    actualTarget,
    source: nodeRoute?.nodeAddressSource || runtimeContext?.nodeAddressSource || (runtimeContext?.frontendLocal ? 'local-browser-session' : 'route-diagnostics'),
    reachability: {
      backendAvailable: Boolean(backendAvailable),
      localNodeReachable: Boolean(nodeRoute?.localNodeReachable),
      homeNodeReachable: Boolean(nodeRoute?.homeNodeReachable),
      cloudRouteReachable: Boolean(nodeRoute?.cloudRouteReachable),
      selectedRouteReachable: Boolean(selectedRoute?.available),
    },
    providerEligibility: buildProviderEligibility({
      routeKind: nodeRoute?.routeKind || 'unavailable',
      routeEvaluations: nodeRoute?.routeEvaluations || {},
      backendAvailable,
      localAvailable,
      cloudAvailable,
    }),
    summary: nodeRoute?.routeSummary || '',
    headline: nodeRoute?.routeHeadline || '',
    winnerReason: nodeRoute?.winnerReason || '',
  };

  return finalRoute;
}

export function buildFinalRouteTruth({
  runtimeContext = {},
  nodeRoute = {},
  finalRoute = {},
  routePlan = {},
  backendAvailable = false,
  activeProvider = '',
  routeSelectedProvider = '',
  fallbackActive = false,
  validationState = 'healthy',
  appLaunchState = 'ready',
} = {}) {
  const selectedEvaluation = nodeRoute?.preferredRoute ? nodeRoute.routeEvaluations?.[nodeRoute.preferredRoute] : null;
  const homeNodeEvaluation = nodeRoute?.routeEvaluations?.['home-node'] || {};
  const localEvaluation = nodeRoute?.routeEvaluations?.['local-desktop'] || {};
  const routeKnown = appLaunchState !== 'pending' && (nodeRoute?.routeKind || 'unavailable') !== 'unavailable';
  const uiReachabilityState = routeKnown ? asTriState(selectedEvaluation?.uiReachable) : 'unknown';

  return {
    sessionKind: runtimeContext.sessionKind || 'unknown',
    deviceContext: runtimeContext.deviceContext || 'unknown',
    runtimeModeLabel: nodeRoute?.routeKind === 'home-node'
      ? 'home node/lan'
      : (runtimeContext.sessionKind === 'hosted-web' ? 'hosted/web' : 'local desktop/dev'),
    requestedRouteMode: routePlan.requestedRouteMode || DEFAULT_ROUTE_MODE,
    effectiveRouteMode: routePlan.effectiveRouteMode || DEFAULT_ROUTE_MODE,
    preferredRoute: nodeRoute?.preferredRoute || 'unavailable',
    routeKind: nodeRoute?.routeKind || 'unavailable',
    winnerReason: finalRoute?.winnerReason || selectedEvaluation?.reason || '',
    preferredTarget: finalRoute?.preferredTarget || '',
    actualTarget: finalRoute?.actualTarget || '',
    source: finalRoute?.source || runtimeContext.nodeAddressSource || 'route-diagnostics',
    backendReachable: Boolean(backendAvailable),
    uiReachabilityState,
    uiReachable: uiReachabilityState === 'reachable',
    routeUsable: selectedEvaluation?.usable === true,
    homeNodeUsable: homeNodeEvaluation?.usable === true,
    localRouteUsable: localEvaluation?.usable === true,
    cloudRouteReachable: finalRoute?.reachability?.cloudRouteReachable === true,
    fallbackActive: Boolean(fallbackActive),
    fallbackRouteActive: nodeRoute?.routeKind === 'dist',
    requestedProvider: routePlan.requestedProvider || DEFAULT_PROVIDER_KEY,
    selectedProvider: routeSelectedProvider || routePlan.selectedProvider || DEFAULT_PROVIDER_KEY,
    executedProvider: activeProvider || '',
    validationState,
    appLaunchState,
    operatorAction: selectedEvaluation?.blockedReason || nodeRoute?.routeSummary || '',
  };
}

function buildDependencySummary({
  backendAvailable,
  localAvailable,
  localPending,
  cloudAvailable,
  effectiveRouteMode,
  fallbackActive,
  activeProvider,
  finalRouteTruth,
  nodeRoute,
  providerHealth,
}) {
  const selectedRouteKind = finalRouteTruth?.routeKind || nodeRoute?.preferredRoute || 'unavailable';
  const selectedRoute = nodeRoute.routeEvaluations[selectedRouteKind] || null;
  const explicitBackendTargetInvalidReason = String(
    nodeRoute?.routeEvaluations?.cloud?.backendTargetInvalidReason
    || '',
  ).trim();
  const localFailureSummary = getPreferredLocalFailure(providerHealth);
  const routeUsable = finalRouteTruth?.routeUsable === true || selectedRoute?.usable === true;
  const executedProvider = finalRouteTruth?.executedProvider || activeProvider || '';
  const selectedProvider = finalRouteTruth?.selectedProvider || '';

  if (!selectedRoute) {
    if (finalRouteTruth?.sessionKind === 'hosted-web' && explicitBackendTargetInvalidReason) {
      return `Hosted session has no valid backend target; ${explicitBackendTargetInvalidReason}.`;
    }

    if (backendAvailable && finalRouteTruth?.sessionKind === 'local-desktop') {
      return 'Backend online, but Stephanos could not classify a valid route explicitly';
    }

    if (localPending && !localAvailable && effectiveRouteMode !== 'cloud-first') {
      return 'Checking local Ollama readiness';
    }

    const homeNodeEvaluation = nodeRoute.routeEvaluations['home-node'];
    if (homeNodeEvaluation?.configured && homeNodeEvaluation?.blockedReason) {
      return `Home PC node unavailable: ${homeNodeEvaluation.blockedReason}`;
    }

    return cloudAvailable ? 'Cloud route ready' : 'No reachable Stephanos route';
  }

  if (selectedRoute.kind === 'home-node') {
    if (selectedRoute.misconfigured) {
      return 'Home PC node reachable · published client route misconfigured';
    }

    if (selectedRoute.optional && nodeRoute.routeEvaluations['local-desktop']?.available) {
      return 'Home PC node optional on this device · local desktop route is valid';
    }

    if (localPending && !localAvailable && effectiveRouteMode !== 'cloud-first') {
      return 'Home PC node ready · checking local Ollama readiness';
    }

    if (cloudAvailable && !localAvailable) {
      return `Home PC node ready · ${localFailureSummary} · cloud route ready`;
    }

    return selectedRoute.reason || 'Home PC node ready';
  }

  if (selectedRoute.kind === 'local-desktop') {
    if (!backendAvailable) {
      return 'Local desktop runtime reachable, but backend is offline';
    }

    if (nodeRoute.routeEvaluations['home-node']?.configured && !nodeRoute.routeEvaluations['home-node']?.available) {
      return 'Local desktop runtime ready · optional home-node is unavailable';
    }

    if (localPending && !localAvailable && effectiveRouteMode !== 'cloud-first') {
      return 'Checking local Ollama readiness';
    }

    if (effectiveRouteMode === 'explicit') {
      return `${PROVIDER_DEFINITIONS[activeProvider]?.label || activeProvider} explicitly selected`;
    }

    if (routeUsable && selectedProvider && executedProvider === 'mock' && selectedProvider !== 'mock') {
      return 'Local desktop route valid; using mock provider fallback';
    }

    if (localAvailable && !fallbackActive) {
      return 'Local Ollama ready';
    }

    if (!localAvailable && cloudAvailable) {
      return `${localFailureSummary} · cloud active because local Ollama is unavailable`;
    }

    if (effectiveRouteMode === 'cloud-first' && cloudAvailable) {
      return `${PROVIDER_DEFINITIONS[activeProvider]?.label || activeProvider} active for cloud routing`;
    }

    if (fallbackActive) {
      return `${PROVIDER_DEFINITIONS[activeProvider]?.label || activeProvider} handling requests after fallback`;
    }

    if (!localAvailable && !cloudAvailable) {
      return `Local desktop route valid, but ${localFailureSummary.toLowerCase()}; cloud routing is unavailable`;
    }

    return selectedRoute.reason || 'Local desktop runtime ready';
  }

  if (selectedRoute.kind === 'dist') {
    if (selectedRoute.blockedReason) {
      return selectedRoute.reason || `Bundled dist runtime is reachable · fallback only because ${selectedRoute.blockedReason}`;
    }

    return selectedRoute.reason || 'Bundled dist runtime is reachable';
  }

  if (selectedRoute.kind === 'cloud') {
    if (fallbackActive) {
      return `${PROVIDER_DEFINITIONS[activeProvider]?.label || activeProvider} handling requests after fallback`;
    }

    return selectedRoute.reason || 'Cloud route ready';
  }

  return selectedRoute.reason || 'No reachable Stephanos route';
}

export function createRuntimeStatusModel({
  appId = 'stephanos',
  appName = 'Stephanos OS',
  validationState = 'healthy',
  selectedProvider = DEFAULT_PROVIDER_KEY,
  routeMode = DEFAULT_ROUTE_MODE,
  fallbackEnabled = true,
  fallbackOrder = FALLBACK_PROVIDER_KEYS,
  providerHealth = {},
  backendAvailable = false,
  runtimeContext = {},
  activeProviderHint = '',
  providerMode = undefined,
} = {}) {
  const normalizedProvider = normalizeProviderSelection(selectedProvider);
  const health = normalizeProviderHealth(providerHealth);
  const localPending = LOCAL_PROVIDER_KEYS.some((providerKey) => health[providerKey]?.state === 'SEARCHING');
  const normalizedRuntimeContext = normalizeRuntimeContext(runtimeContext);
  const routePlan = deriveRoutePlan({
    selectedProvider: normalizedProvider,
    routeMode,
    fallbackEnabled,
    fallbackOrder,
    providerHealth: health,
    runtimeContext: normalizedRuntimeContext,
  });

  const nodeRoute = deriveNodeRoute({
    runtimeContext: normalizedRuntimeContext,
    backendAvailable,
    cloudAvailable: routePlan.cloudAvailable,
    validationState,
  });
  const liveRouteAvailable = nodeRoute.routeKind !== 'unavailable';
  const preferredLiveProvider = routePlan.attemptOrder.find((providerKey) => providerKey !== 'mock' && health[providerKey]?.ok)
    || (normalizedProvider !== 'mock' ? normalizedProvider : routePlan.selectedProvider);
  const routeSelectedProvider = routePlan.selectedProvider === 'mock' && normalizedProvider !== 'mock' && liveRouteAvailable
    ? preferredLiveProvider
    : routePlan.selectedProvider;
  const hintedProvider = normalizeProviderSelection(activeProviderHint || routeSelectedProvider);
  const executableProviderHealthy = Boolean(hintedProvider && health[hintedProvider]?.ok === true);
  const activeProvider = executableProviderHealthy ? hintedProvider : '';

  const fallbackActive = Boolean(
    activeProviderHint
    && activeProvider
    && activeProvider !== routeSelectedProvider
    && providerMode !== 'explicit'
  );

  const activeRouteKind = LOCAL_PROVIDER_KEYS.includes(activeProvider)
    ? 'local'
    : CLOUD_PROVIDER_KEYS.includes(activeProvider)
      ? 'cloud'
      : 'dev';

  const finalRoute = finalizeRuntimeRouteResolution({
    runtimeContext: normalizedRuntimeContext,
    nodeRoute,
    backendAvailable,
    localAvailable: routePlan.localAvailable,
    cloudAvailable: routePlan.cloudAvailable,
  });
  const selectedEvaluation = nodeRoute?.preferredRoute ? nodeRoute.routeEvaluations?.[nodeRoute.preferredRoute] : null;
  const selectedRouteReachable = selectedEvaluation?.available === true;
  const selectedRouteUsable = selectedEvaluation?.usable === true;
  const tileExecutionReady = normalizedRuntimeContext?.tileTruth?.ready === true
    || normalizedRuntimeContext?.tileTruth?.executionReady === true;

  const launchUnavailable = validationState === 'error' && nodeRoute.routeKind === 'unavailable';
  const launchDegraded = !launchUnavailable && (
    validationState === 'launching'
    || (nodeRoute.routeKind === 'unavailable' && !routePlan.cloudAvailable)
    || (nodeRoute.routeKind !== 'cloud' && !backendAvailable)
    || !selectedRouteReachable
    || !selectedRouteUsable
    || !tileExecutionReady
    || (localPending && routePlan.effectiveRouteMode !== 'cloud-first')
    || (routePlan.effectiveRouteMode === 'local-first' && !routePlan.localAvailable && nodeRoute.routeKind === 'local-desktop')
    || (routePlan.effectiveRouteMode === 'cloud-first' && !routePlan.cloudAvailable)
    || fallbackActive
  );
  const appLaunchState = launchUnavailable ? 'unavailable' : (launchDegraded ? 'degraded' : 'ready');

  const headline = appLaunchState === 'unavailable'
    ? (nodeRoute.classificationFailed ? 'Backend online but route classification failed' : 'No reachable Stephanos route')
    : nodeRoute.routeHeadline || `${appName} ready with degraded dependencies`;

  const model = {
    appId,
    appName,
    routeMode: routePlan.requestedRouteMode,
    requestedRouteMode: routePlan.requestedRouteMode,
    effectiveRouteMode: routePlan.effectiveRouteMode,
    providerMode: routePlan.effectiveRouteMode,
    selectedProvider: normalizedProvider,
    routeSelectedProvider,
    activeProvider,
    activeRouteKind,
    localAvailable: routePlan.localAvailable,
    localPending,
    cloudAvailable: routePlan.cloudAvailable,
    backendAvailable,
    fallbackActive,
    appLaunchState,
    validationState,
    readyCloudProviders: routePlan.readyCloudProviders,
    readyLocalProviders: routePlan.readyLocalProviders,
    attemptOrder: routePlan.attemptOrder,
    runtimeContext: {
      ...normalizedRuntimeContext,
      finalRoute,
    },
    runtimeModeLabel: nodeRoute.routeKind === 'home-node'
      ? 'home node/lan'
      : (normalizedRuntimeContext.sessionKind === 'hosted-web' ? 'hosted/web' : 'local desktop/dev'),
    routeAdoptionMarker: STEPHANOS_ROUTE_ADOPTION_MARKER,
    providerRoutingMarker: STEPHANOS_PROVIDER_ROUTING_MARKER,
    dependencySummary: '',
    headline,
    statusTone: appLaunchState === 'unavailable' ? 'unavailable' : appLaunchState === 'degraded' ? 'degraded' : 'ready',
    finalRoute,
    routeKind: finalRoute.routeKind,
    preferredTarget: finalRoute.preferredTarget,
    actualTargetUsed: finalRoute.actualTarget,
    localNodeReachable: nodeRoute.localNodeReachable,
    homeNodeReachable: nodeRoute.homeNodeReachable,
    cloudRouteReachable: nodeRoute.cloudRouteReachable,
    nodeAddressSource: finalRoute.source,
    routeSummary: nodeRoute.routeSummary,
    routeEvaluations: nodeRoute.routeEvaluations,
    routePreferenceOrder: nodeRoute.routePreferenceOrder,
    preferredRoute: nodeRoute.preferredRoute,
    classificationFailed: nodeRoute.classificationFailed,
  };
  const finalRouteTruth = buildFinalRouteTruth({
    runtimeContext: normalizedRuntimeContext,
    nodeRoute,
    finalRoute,
    routePlan,
    backendAvailable,
    activeProvider,
    routeSelectedProvider,
    fallbackActive,
    validationState,
    appLaunchState,
  });
  const dependencySummary = buildDependencySummary({
    backendAvailable,
    localAvailable: routePlan.localAvailable,
    localPending,
    cloudAvailable: routePlan.cloudAvailable,
    effectiveRouteMode: routePlan.effectiveRouteMode,
    fallbackActive,
    activeProvider,
    finalRouteTruth,
    nodeRoute,
    providerHealth: health,
  });
  const preliminaryModel = { ...model, finalRouteTruth, dependencySummary };
  const guardrails = evaluateRuntimeGuardrails(preliminaryModel);
  const runtimeAdjudication = adjudicateRuntimeTruth({
    runtimeContext: normalizedRuntimeContext,
    finalRoute,
    finalRouteTruth,
    routePlan,
    routeEvaluations: nodeRoute.routeEvaluations,
    routePreferenceOrder: nodeRoute.routePreferenceOrder,
    selectedProvider: normalizedProvider,
    routeSelectedProvider,
    activeProvider,
    providerHealth: health,
    fallbackActive,
    validationState,
    appLaunchState,
    guardrails,
  });

  return {
    ...model,
    dependencySummary,
    finalRouteTruth,
    canonicalRouteRuntimeTruth: runtimeAdjudication.canonicalRouteRuntimeTruth,
    runtimeTruth: runtimeAdjudication.runtimeTruth,
    runtimeTruthSnapshot: runtimeAdjudication.runtimeTruthSnapshot,
    compatibilityRuntimeTruthSnapshot: runtimeAdjudication.compatibilityRuntimeTruthSnapshot,
    runtimeAdjudication: {
      issues: runtimeAdjudication.issues,
      computedFromPersistence: false,
    },
    guardrails,
  };
}
