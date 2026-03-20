import {
  AI_SETTINGS_STORAGE_KEY,
  CLOUD_PROVIDER_KEYS,
  DEFAULT_PROVIDER_KEY,
  FALLBACK_PROVIDER_KEYS,
  LOCAL_PROVIDER_KEYS,
  PROVIDER_DEFINITIONS,
  normalizeFallbackOrder,
  normalizeProviderSelection,
} from '../ai/providerDefaults.mjs';

function isBrowserStorageAvailable(storage) {
  return storage && typeof storage.getItem === 'function';
}

function normalizeProviderHealth(providerHealth = {}) {
  return providerHealth && typeof providerHealth === 'object' ? providerHealth : {};
}

function orderedProviders(fallbackOrder = []) {
  return [...new Set([...normalizeFallbackOrder(fallbackOrder), ...Object.keys(PROVIDER_DEFINITIONS)])];
}

export function readPersistedProviderPreferences(storage = globalThis?.localStorage) {
  const defaults = {
    selectedProvider: DEFAULT_PROVIDER_KEY,
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
      fallbackEnabled: parsed.fallbackEnabled !== false,
      fallbackOrder: normalizeFallbackOrder(parsed.fallbackOrder),
    };
  } catch {
    return defaults;
  }
}

export function getReadyCloudProviders(providerHealth = {}, fallbackOrder = FALLBACK_PROVIDER_KEYS) {
  const health = normalizeProviderHealth(providerHealth);
  return orderedProviders(fallbackOrder)
    .filter((providerKey) => CLOUD_PROVIDER_KEYS.includes(providerKey))
    .filter((providerKey) => health[providerKey]?.ok);
}

export function deriveProviderMode({
  selectedProvider = DEFAULT_PROVIDER_KEY,
  fallbackEnabled = true,
  fallbackOrder = FALLBACK_PROVIDER_KEYS,
  providerHealth = {},
  preferAuto = false,
} = {}) {
  const normalizedProvider = normalizeProviderSelection(selectedProvider);
  const readyCloudProviders = getReadyCloudProviders(providerHealth, fallbackOrder);

  if (CLOUD_PROVIDER_KEYS.includes(normalizedProvider)) {
    return 'cloud';
  }

  if (LOCAL_PROVIDER_KEYS.includes(normalizedProvider)) {
    if (preferAuto || (fallbackEnabled && readyCloudProviders.length > 0)) {
      return 'auto';
    }

    return 'local';
  }

  return fallbackEnabled && readyCloudProviders.length > 0 ? 'auto' : 'cloud';
}

function buildDependencySummary({ backendAvailable, localAvailable, cloudAvailable, providerMode, fallbackActive, activeProvider }) {
  if (!backendAvailable) {
    return 'Backend offline';
  }

  if (providerMode === 'cloud') {
    return cloudAvailable ? `${PROVIDER_DEFINITIONS[activeProvider]?.label || activeProvider} active` : 'Cloud provider unavailable';
  }

  if (localAvailable && !fallbackActive) {
    return 'Local AI ready';
  }

  if (!localAvailable && cloudAvailable) {
    return 'Cloud active, local offline';
  }

  if (!localAvailable && !cloudAvailable) {
    return 'Local offline, cloud unavailable';
  }

  if (fallbackActive) {
    return `${PROVIDER_DEFINITIONS[activeProvider]?.label || activeProvider} handling requests`;
  }

  return 'Runtime healthy';
}

export function createRuntimeStatusModel({
  appId = 'stephanos',
  appName = 'Stephanos OS',
  validationState = 'healthy',
  selectedProvider = DEFAULT_PROVIDER_KEY,
  fallbackEnabled = true,
  fallbackOrder = FALLBACK_PROVIDER_KEYS,
  providerHealth = {},
  backendAvailable = false,
  preferAuto = false,
  activeProviderHint = '',
} = {}) {
  const normalizedProvider = normalizeProviderSelection(selectedProvider);
  const health = normalizeProviderHealth(providerHealth);
  const localAvailable = LOCAL_PROVIDER_KEYS.some((providerKey) => health[providerKey]?.ok);
  const readyCloudProviders = getReadyCloudProviders(health, fallbackOrder);
  const cloudAvailable = readyCloudProviders.length > 0;
  const providerMode = deriveProviderMode({
    selectedProvider: normalizedProvider,
    fallbackEnabled,
    fallbackOrder,
    providerHealth: health,
    preferAuto,
  });

  let activeProvider = normalizeProviderSelection(activeProviderHint || normalizedProvider);
  if (!activeProviderHint) {
    if (providerMode === 'cloud') {
      activeProvider = CLOUD_PROVIDER_KEYS.includes(normalizedProvider)
        ? normalizedProvider
        : (readyCloudProviders[0] || normalizedProvider);
    } else if (providerMode === 'auto' && !localAvailable && cloudAvailable) {
      activeProvider = readyCloudProviders[0] || normalizedProvider;
    }
  }

  const fallbackActive = Boolean(
    fallbackEnabled
    && activeProvider
    && activeProvider !== normalizedProvider
    && (cloudAvailable || LOCAL_PROVIDER_KEYS.includes(activeProvider))
  );

  const dependencySummary = buildDependencySummary({
    backendAvailable,
    localAvailable,
    cloudAvailable,
    providerMode,
    fallbackActive,
    activeProvider,
  });

  const launchUnavailable = validationState === 'error';
  const launchDegraded = !launchUnavailable && (
    validationState === 'launching'
    || !backendAvailable
    || (!localAvailable && providerMode !== 'cloud')
    || fallbackActive
    || (providerMode === 'cloud' && !cloudAvailable)
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
    providerMode,
    selectedProvider: normalizedProvider,
    activeProvider,
    localAvailable,
    cloudAvailable,
    backendAvailable,
    fallbackActive,
    appLaunchState,
    readyCloudProviders,
    dependencySummary,
    headline,
    statusTone: appLaunchState === 'unavailable' ? 'unavailable' : appLaunchState === 'degraded' ? 'degraded' : 'ready',
  };
}
