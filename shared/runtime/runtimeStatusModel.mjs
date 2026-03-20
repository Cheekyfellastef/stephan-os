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

function isLoopbackHost(hostname = '') {
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(String(hostname).toLowerCase());
}

function normalizeRuntimeContext(runtimeContext = {}) {
  const frontendOrigin = String(runtimeContext.frontendOrigin || '');
  const apiBaseUrl = String(runtimeContext.apiBaseUrl || runtimeContext.backendBaseUrl || '');
  const frontendHost = parseHostname(frontendOrigin);
  const backendHost = parseHostname(apiBaseUrl);
  const frontendReachability = isLoopbackHost(frontendHost) || !frontendHost
    ? 'local'
    : 'hosted';
  const backendReachability = isLoopbackHost(backendHost) || !backendHost
    ? 'local'
    : 'reachable';
  const sessionKind = frontendReachability === 'local' && backendReachability === 'local'
    ? 'local-desktop'
    : 'hosted-web';

  return {
    frontendOrigin,
    apiBaseUrl,
    frontendHost,
    backendHost,
    frontendReachability,
    backendReachability,
    sessionKind,
    localNodeReachableFromSession: runtimeContext.localNodeReachableFromSession,
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

function buildDependencySummary({
  backendAvailable,
  localAvailable,
  localPending,
  cloudAvailable,
  effectiveRouteMode,
  fallbackActive,
  activeProvider,
  runtimeContext,
}) {
  if (!backendAvailable) {
    return 'Backend offline';
  }

  if (localPending && !localAvailable && effectiveRouteMode !== 'cloud-first') {
    return 'Checking local Ollama readiness';
  }

  if (effectiveRouteMode === 'cloud-first') {
    if (cloudAvailable) {
      return `${PROVIDER_DEFINITIONS[activeProvider]?.label || activeProvider} active for cloud routing`;
    }
    return runtimeContext.sessionKind === 'hosted-web'
      ? 'Hosted session has no cloud provider available'
      : 'Cloud provider unavailable';
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

  return 'Runtime healthy';
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

  const dependencySummary = buildDependencySummary({
    backendAvailable,
    localAvailable: routePlan.localAvailable,
    localPending,
    cloudAvailable: routePlan.cloudAvailable,
    effectiveRouteMode: routePlan.effectiveRouteMode,
    fallbackActive,
    activeProvider,
    runtimeContext: normalizedRuntimeContext,
  });

  const launchUnavailable = validationState === 'error';
  const launchDegraded = !launchUnavailable && (
    validationState === 'launching'
    || !backendAvailable
    || (localPending && routePlan.effectiveRouteMode !== 'cloud-first')
    || (routePlan.effectiveRouteMode === 'local-first' && !routePlan.localAvailable)
    || (routePlan.effectiveRouteMode === 'cloud-first' && !routePlan.cloudAvailable)
    || fallbackActive
  );
  const appLaunchState = launchUnavailable ? 'unavailable' : (launchDegraded ? 'degraded' : 'ready');

  const headline = appLaunchState === 'unavailable'
    ? `${appName} unavailable`
    : appLaunchState === 'degraded'
      ? `${appName} ready with degraded dependencies`
      : `${appName} ready`;

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
  };
}
