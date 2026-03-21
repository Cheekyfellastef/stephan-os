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
  isLikelyLanHost,
  isLoopbackHost,
  normalizeStephanosHomeNode,
} from './stephanosHomeNode.mjs';

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

function normalizeRuntimeContext(runtimeContext = {}) {
  const frontendOrigin = String(runtimeContext.frontendOrigin || '');
  const apiBaseUrl = String(runtimeContext.apiBaseUrl || runtimeContext.backendBaseUrl || '');
  const frontendHost = parseHostname(frontendOrigin);
  const backendHost = parseHostname(apiBaseUrl);
  const frontendLocal = isLoopbackHost(frontendHost) || !frontendHost;
  const backendLocal = isLoopbackHost(backendHost) || !backendHost;
  const frontendReachability = frontendLocal ? 'local' : 'reachable';
  const backendReachability = backendLocal ? 'local' : 'reachable';
  const homeNode = normalizeStephanosHomeNode(runtimeContext.homeNode || {}, {
    source: runtimeContext.homeNode?.source || 'manual',
  });
  const deviceContext = frontendLocal
    ? 'pc-local-browser'
    : (homeNode.reachable || (homeNode.configured && isLikelyLanHost(homeNode.host)) || isLikelyLanHost(backendHost))
      ? 'lan-companion'
      : 'off-network';
  const sessionKind = frontendLocal ? 'local-desktop' : 'hosted-web';

  return {
    frontendOrigin,
    apiBaseUrl,
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
    preferredTarget: runtimeContext.preferredTarget || homeNode?.uiUrl || frontendOrigin || apiBaseUrl,
    actualTargetUsed: runtimeContext.actualTargetUsed || apiBaseUrl || homeNode?.backendUrl || frontendOrigin,
    nodeAddressSource: runtimeContext.nodeAddressSource || homeNode?.source || (frontendLocal ? 'local-browser-session' : 'route-diagnostics'),
    routeDiagnostics: runtimeContext.routeDiagnostics && typeof runtimeContext.routeDiagnostics === 'object'
      ? runtimeContext.routeDiagnostics
      : {},
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
  if (runtimeContext.sessionKind === 'hosted-web') {
    if (cloudAvailable) return 'cloud-first';
    if (localAvailable) return 'local-first';
    return 'cloud-first';
  }

  if (localAvailable) return 'local-first';
  if (cloudAvailable) return 'cloud-first';
  return 'local-first';
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


function buildRoutePreference(runtimeContext = {}) {
  if (runtimeContext.deviceContext === 'pc-local-browser') {
    return ['local-desktop', 'home-node', 'dist', 'cloud'];
  }

  if (runtimeContext.deviceContext === 'lan-companion') {
    return ['home-node', 'local-desktop', 'dist', 'cloud'];
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
    source: String(merged.source || 'route-diagnostics'),
    reason: String(merged.reason || ''),
    blockedReason: String(merged.blockedReason || ''),
  };
}

function deriveFallbackSuppressionReason(routeKey, evaluations, preferenceOrder = []) {
  const preferredLiveRoutes = preferenceOrder
    .filter((candidate) => candidate !== routeKey && candidate !== 'dist' && candidate !== 'cloud');

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
  const frontendLocal = runtimeContext.frontendLocal === true;
  const homeNodeConfigured = Boolean(runtimeContext.homeNode?.configured);
  const homeNodeReachable = Boolean(runtimeContext.homeNode?.reachable);
  const homeNodeMisconfigured = homeNodeReachable && runtimeContext.publishedClientRouteState === 'misconfigured';
  const localDesktopProbe = diagnostics['local-desktop'] || {};
  const homeNodeProbe = diagnostics['home-node'] || {};
  const distProbe = diagnostics.dist || {};
  const localDesktopAvailable = frontendLocal && backendAvailable;
  const localDesktopProbeAvailable = localDesktopProbe.available === true;
  const localDesktopClassificationFailed = frontendLocal && backendAvailable && localDesktopProbe.available === false;

  const evaluations = {
    'local-desktop': createRouteEvaluation('local-desktop', {
      configured: frontendLocal,
      available: localDesktopAvailable,
      misconfigured: localDesktopClassificationFailed,
      optional: runtimeContext.deviceContext !== 'pc-local-browser',
      source: frontendLocal ? 'local-browser-session' : 'not-applicable',
      reason: frontendLocal
        ? (backendAvailable
          ? (localDesktopProbeAvailable
            ? 'Backend online and local desktop route probe succeeded'
            : 'Backend online from local desktop session; using bundled dist UI until a live UI probe is published')
          : 'Local desktop browser detected, but the backend is offline')
        : 'Current session is not a local desktop browser',
      blockedReason: frontendLocal
        ? (backendAvailable
          ? (localDesktopProbe.blockedReason || (localDesktopProbeAvailable
            ? ''
            : 'backend is online locally, but no explicit live UI route was published'))
          : 'backend is offline')
        : 'not a local desktop session',
    }, {
      ...localDesktopProbe,
      available: localDesktopAvailable,
      misconfigured: localDesktopClassificationFailed || Boolean(localDesktopProbe.misconfigured),
      source: localDesktopProbe.source || (frontendLocal ? 'local-browser-session' : 'not-applicable'),
      reason: localDesktopProbe.reason || (frontendLocal
        ? (backendAvailable
          ? (localDesktopProbeAvailable
            ? 'Backend online and local desktop route probe succeeded'
            : 'Backend online from local desktop session; using bundled dist UI until a live UI probe is published')
          : 'Local desktop browser detected, but the backend is offline')
        : 'Current session is not a local desktop browser'),
      blockedReason: localDesktopProbe.blockedReason || (frontendLocal
        ? (backendAvailable
          ? (localDesktopProbeAvailable ? '' : 'backend is online locally, but no explicit live UI route was published')
          : 'backend is offline')
        : 'not a local desktop session'),
    }),
    'home-node': createRouteEvaluation('home-node', {
      configured: homeNodeConfigured,
      available: homeNodeReachable,
      misconfigured: homeNodeMisconfigured,
      optional: runtimeContext.deviceContext === 'pc-local-browser',
      source: runtimeContext.homeNode?.source || (homeNodeConfigured ? 'configured-home-node' : 'not-configured'),
      reason: homeNodeReachable
        ? (homeNodeMisconfigured
          ? 'Home PC node is reachable, but the published client route is misconfigured'
          : 'Home PC node is reachable on the LAN')
        : (homeNodeConfigured
          ? 'Home PC node is configured but currently unreachable'
          : 'Home PC node is not configured'),
      blockedReason: homeNodeConfigured
        ? (homeNodeProbe.blockedReason || (homeNodeReachable ? '' : 'health probe could not confirm the home-node route'))
        : 'home node is not configured',
    }, {
      ...homeNodeProbe,
      available: homeNodeReachable,
      misconfigured: homeNodeMisconfigured || Boolean(homeNodeProbe.misconfigured),
      source: homeNodeProbe.source || runtimeContext.homeNode?.source || (homeNodeConfigured ? 'configured-home-node' : 'not-configured'),
      reason: homeNodeProbe.reason || (homeNodeReachable
        ? (homeNodeMisconfigured
          ? 'Home PC node is reachable, but the published client route is misconfigured'
          : 'Home PC node is reachable on the LAN')
        : (homeNodeConfigured
          ? 'Home PC node is configured but currently unreachable'
          : 'Home PC node is not configured')),
      blockedReason: homeNodeProbe.blockedReason || (homeNodeConfigured
        ? (homeNodeReachable ? '' : 'health probe could not confirm the home-node route')
        : 'home node is not configured'),
    }),
    dist: createRouteEvaluation('dist', {
      configured: Boolean(runtimeContext.preferredTarget || distProbe.configured),
      available: Boolean(String(runtimeContext.preferredTarget || '').includes('/apps/stephanos/dist/')),
      misconfigured: false,
      optional: false,
      source: String(runtimeContext.preferredTarget || '').includes('/apps/stephanos/dist/') ? 'dist-runtime' : 'dist-entry',
      reason: String(runtimeContext.preferredTarget || '').includes('/apps/stephanos/dist/')
        ? 'Bundled dist runtime is reachable'
        : 'Bundled dist runtime is not the active route',
      blockedReason: '',
    }, distProbe),
    cloud: createRouteEvaluation('cloud', {
      configured: cloudAvailable || diagnostics.cloud?.configured === true,
      available: cloudAvailable,
      misconfigured: false,
      optional: false,
      source: cloudAvailable ? 'cloud-provider-health' : 'cloud-provider-unavailable',
      reason: cloudAvailable
        ? 'A cloud-backed Stephanos route is ready'
        : 'No cloud-backed Stephanos route is currently ready',
      blockedReason: cloudAvailable ? '' : 'no cloud-backed route is currently ready',
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

  const preferredRoute = preferenceOrder.find((routeKey) => evaluations[routeKey]?.available) || null;

  return {
    evaluations,
    preferenceOrder,
    preferredRoute,
    localDesktopClassificationFailed,
  };
}

function summarizeSelectedRoute(routeKey, route, runtimeContext, backendAvailable, validationState) {
  if (!routeKey || !route) {
    if (backendAvailable && runtimeContext.frontendLocal) {
      return {
        headline: 'Backend online but route classification failed',
        summary: 'Backend online, but Stephanos could not classify a valid route explicitly',
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

  return {
    routeKind: selectedRouteKey || 'unavailable',
    preferredTarget: selectedRouteKey === 'home-node'
      ? runtimeContext.homeNode?.uiUrl || runtimeContext.preferredTarget
      : runtimeContext.preferredTarget,
    actualTargetUsed: selectedRouteKey === 'home-node'
      ? runtimeContext.homeNode?.backendUrl || runtimeContext.actualTargetUsed
      : runtimeContext.actualTargetUsed,
    localNodeReachable: Boolean(localDesktop.available || homeNode.available || runtimeContext.localNodeReachableFromSession === true),
    homeNodeReachable: Boolean(homeNode.available),
    cloudRouteReachable: Boolean(cloud.available),
    routeSummary: selectedSummary.summary,
    routeHeadline: selectedSummary.headline,
    nodeAddressSource: selectedRoute?.source || runtimeContext.nodeAddressSource || (runtimeContext.frontendLocal ? 'local-browser-session' : 'route-diagnostics'),
    routeEvaluations: routeSelection.evaluations,
    routePreferenceOrder: routeSelection.preferenceOrder,
    preferredRoute: selectedRouteKey,
    classificationFailed: Boolean(routeSelection.localDesktopClassificationFailed || (backendAvailable && !selectedRouteKey)),
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
  runtimeContext,
  nodeRoute,
}) {
  const selectedRoute = nodeRoute.preferredRoute ? nodeRoute.routeEvaluations[nodeRoute.preferredRoute] : null;

  if (!selectedRoute) {
    if (backendAvailable && runtimeContext.frontendLocal) {
      return 'Backend online, but Stephanos could not classify a valid route explicitly';
    }

    if (localPending && !localAvailable && effectiveRouteMode !== 'cloud-first') {
      return 'Checking local Ollama readiness';
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
      return 'Home PC node ready · cloud route ready';
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

    if (effectiveRouteMode === 'cloud-first' && cloudAvailable) {
      return `${PROVIDER_DEFINITIONS[activeProvider]?.label || activeProvider} active for cloud routing`;
    }

    if (effectiveRouteMode === 'explicit') {
      return `${PROVIDER_DEFINITIONS[activeProvider]?.label || activeProvider} explicitly selected`;
    }

    if (localAvailable && !fallbackActive) {
      return 'Local Ollama ready';
    }

    if (!localAvailable && cloudAvailable) {
      return 'Cloud active because local Ollama is unavailable';
    }

    if (!localAvailable && !cloudAvailable) {
      return 'Local desktop route valid, but both local Ollama and cloud routing are unavailable';
    }

    if (fallbackActive) {
      return `${PROVIDER_DEFINITIONS[activeProvider]?.label || activeProvider} handling requests after fallback`;
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

  let activeProvider = normalizeProviderSelection(activeProviderHint || routePlan.selectedProvider);
  if (activeProvider === DEFAULT_PROVIDER_KEY && !health[activeProvider] && routePlan.selectedProvider) {
    activeProvider = routePlan.selectedProvider;
  }

  const fallbackActive = Boolean(
    activeProvider
    && activeProvider !== routePlan.selectedProvider
    && providerMode !== 'explicit'
  );

  const activeRouteKind = LOCAL_PROVIDER_KEYS.includes(activeProvider)
    ? 'local'
    : CLOUD_PROVIDER_KEYS.includes(activeProvider)
      ? 'cloud'
      : 'dev';

  const nodeRoute = deriveNodeRoute({
    runtimeContext: normalizedRuntimeContext,
    backendAvailable,
    cloudAvailable: routePlan.cloudAvailable,
    validationState,
  });

  const dependencySummary = buildDependencySummary({
    backendAvailable,
    localAvailable: routePlan.localAvailable,
    localPending,
    cloudAvailable: routePlan.cloudAvailable,
    effectiveRouteMode: routePlan.effectiveRouteMode,
    fallbackActive,
    activeProvider,
    runtimeContext: normalizedRuntimeContext,
    nodeRoute,
  });

  const launchUnavailable = validationState === 'error' && nodeRoute.routeKind === 'unavailable';
  const launchDegraded = !launchUnavailable && (
    validationState === 'launching'
    || (nodeRoute.routeKind === 'unavailable' && !routePlan.cloudAvailable)
    || (nodeRoute.routeKind !== 'cloud' && !backendAvailable)
    || (localPending && routePlan.effectiveRouteMode !== 'cloud-first')
    || (routePlan.effectiveRouteMode === 'local-first' && !routePlan.localAvailable && nodeRoute.routeKind === 'local-desktop')
    || (routePlan.effectiveRouteMode === 'cloud-first' && !routePlan.cloudAvailable)
    || fallbackActive
  );
  const appLaunchState = launchUnavailable ? 'unavailable' : (launchDegraded ? 'degraded' : 'ready');

  const headline = appLaunchState === 'unavailable'
    ? (nodeRoute.classificationFailed ? 'Backend online but route classification failed' : 'No reachable Stephanos route')
    : nodeRoute.routeHeadline || `${appName} ready with degraded dependencies`;

  return {
    appId,
    appName,
    routeMode: routePlan.requestedRouteMode,
    requestedRouteMode: routePlan.requestedRouteMode,
    effectiveRouteMode: routePlan.effectiveRouteMode,
    providerMode: routePlan.effectiveRouteMode,
    selectedProvider: normalizedProvider,
    routeSelectedProvider: routePlan.selectedProvider,
    activeProvider,
    activeRouteKind,
    localAvailable: routePlan.localAvailable,
    localPending,
    cloudAvailable: routePlan.cloudAvailable,
    backendAvailable,
    fallbackActive,
    appLaunchState,
    readyCloudProviders: routePlan.readyCloudProviders,
    readyLocalProviders: routePlan.readyLocalProviders,
    attemptOrder: routePlan.attemptOrder,
    runtimeContext: normalizedRuntimeContext,
    runtimeModeLabel: normalizedRuntimeContext.sessionKind === 'hosted-web' ? 'hosted/web' : 'local desktop/dev',
    dependencySummary,
    headline,
    statusTone: appLaunchState === 'unavailable' ? 'unavailable' : appLaunchState === 'degraded' ? 'degraded' : 'ready',
    routeKind: nodeRoute.routeKind,
    preferredTarget: nodeRoute.preferredTarget,
    actualTargetUsed: nodeRoute.actualTargetUsed,
    localNodeReachable: nodeRoute.localNodeReachable,
    homeNodeReachable: nodeRoute.homeNodeReachable,
    cloudRouteReachable: nodeRoute.cloudRouteReachable,
    nodeAddressSource: nodeRoute.nodeAddressSource,
    routeSummary: nodeRoute.routeSummary,
    routeEvaluations: nodeRoute.routeEvaluations,
    routePreferenceOrder: nodeRoute.routePreferenceOrder,
    preferredRoute: nodeRoute.preferredRoute,
    classificationFailed: nodeRoute.classificationFailed,
  };
}
