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
  const frontendReachability = isLoopbackHost(frontendHost) || !frontendHost
    ? 'local'
    : 'reachable';
  const backendReachability = isLoopbackHost(backendHost) || !backendHost
    ? 'local'
    : 'reachable';
  const sessionKind = frontendReachability === 'local' && backendReachability === 'local'
    ? 'local-desktop'
    : 'hosted-web';
  const homeNode = normalizeStephanosHomeNode(runtimeContext.homeNode || {}, {
    source: runtimeContext.homeNode?.source || 'manual',
  });

  return {
    frontendOrigin,
    apiBaseUrl,
    frontendHost,
    backendHost,
    frontendReachability,
    backendReachability,
    sessionKind,
    localNodeReachableFromSession: runtimeContext.localNodeReachableFromSession,
    homeNode,
    preferredTarget: runtimeContext.preferredTarget || homeNode?.uiUrl || frontendOrigin || apiBaseUrl,
    actualTargetUsed: runtimeContext.actualTargetUsed || apiBaseUrl || homeNode?.backendUrl || frontendOrigin,
    nodeAddressSource: runtimeContext.nodeAddressSource || homeNode?.source || 'unknown',
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

function deriveNodeRoute({ runtimeContext, backendAvailable, cloudAvailable, validationState }) {
  const homeNodeReachable = Boolean(runtimeContext.homeNode?.reachable);
  const localDesktopRuntime = runtimeContext.sessionKind === 'local-desktop';
  const localNodeReachable = localDesktopRuntime || homeNodeReachable || runtimeContext.localNodeReachableFromSession === true;

  let routeKind = 'unavailable';
  if (localDesktopRuntime) {
    routeKind = 'local-desktop';
  } else if (homeNodeReachable) {
    routeKind = 'home-node';
  } else if (cloudAvailable) {
    routeKind = 'cloud';
  }

  const preferredTarget = routeKind === 'home-node'
    ? runtimeContext.homeNode?.uiUrl || runtimeContext.preferredTarget
    : runtimeContext.preferredTarget;
  const actualTargetUsed = routeKind === 'home-node'
    ? runtimeContext.homeNode?.backendUrl || runtimeContext.actualTargetUsed
    : runtimeContext.actualTargetUsed;

  let routeSummary = 'No reachable Stephanos route';
  if (routeKind === 'local-desktop') {
    routeSummary = backendAvailable
      ? 'Local desktop runtime ready'
      : 'Local desktop runtime reachable, but backend is offline';
  } else if (routeKind === 'home-node') {
    routeSummary = backendAvailable
      ? 'Home PC node ready'
      : 'Home PC node reachable, but backend is offline';
  } else if (routeKind === 'cloud') {
    routeSummary = cloudAvailable
      ? 'Cloud route ready'
      : 'Cloud route unavailable';
  }

  if (validationState === 'launching' && routeKind !== 'home-node') {
    routeSummary = routeKind === 'local-desktop'
      ? 'Local desktop runtime starting'
      : 'Checking reachable Stephanos route';
  }

  return {
    routeKind,
    preferredTarget,
    actualTargetUsed,
    localNodeReachable,
    homeNodeReachable,
    cloudRouteReachable: cloudAvailable,
    routeSummary,
    nodeAddressSource: runtimeContext.nodeAddressSource || runtimeContext.homeNode?.source || 'unknown',
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
  if (!backendAvailable && nodeRoute.routeKind === 'unavailable') {
    return cloudAvailable ? 'Cloud route ready' : 'No reachable Stephanos route';
  }

  if (nodeRoute.routeKind === 'home-node') {
    if (localPending && !localAvailable && effectiveRouteMode !== 'cloud-first') {
      return 'Home PC node ready · checking local Ollama readiness';
    }

    if (cloudAvailable && !localAvailable) {
      return 'Home PC node ready · cloud route ready';
    }

    if (fallbackActive) {
      return `Home PC node ready · ${PROVIDER_DEFINITIONS[activeProvider]?.label || activeProvider} handling requests after fallback`;
    }

    return 'Home PC node ready';
  }

  if (nodeRoute.routeKind === 'local-desktop') {
    if (!backendAvailable) {
      return 'Local desktop runtime reachable, but backend is offline';
    }

    if (localPending && !localAvailable && effectiveRouteMode !== 'cloud-first') {
      return 'Checking local Ollama readiness';
    }

    if (effectiveRouteMode === 'cloud-first') {
      if (cloudAvailable) {
        return `${PROVIDER_DEFINITIONS[activeProvider]?.label || activeProvider} active for cloud routing`;
      }
      return 'Cloud route unavailable';
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
      return 'Local Ollama offline and cloud unavailable';
    }

    if (fallbackActive) {
      return `${PROVIDER_DEFINITIONS[activeProvider]?.label || activeProvider} handling requests after fallback`;
    }

    return 'Local desktop runtime ready';
  }

  if (cloudAvailable) {
    return 'Cloud route ready';
  }

  if (!backendAvailable) {
    return 'No reachable Stephanos route';
  }

  return runtimeContext.sessionKind === 'hosted-web'
    ? 'Home PC node unreachable'
    : 'No reachable Stephanos route';
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
    ? 'No reachable Stephanos route'
    : nodeRoute.routeKind === 'local-desktop'
      ? 'Local desktop runtime ready'
      : nodeRoute.routeKind === 'home-node'
        ? 'Home PC node ready'
        : nodeRoute.routeKind === 'cloud'
          ? 'Cloud route ready'
          : `${appName} ready with degraded dependencies`;

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
  };
}
