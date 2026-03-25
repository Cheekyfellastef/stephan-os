import {
  isMalformedStephanosHost,
  readPersistedStephanosHomeNode,
  readPersistedStephanosLastKnownNode,
  resolveStephanosBackendBaseUrl,
} from '../../../shared/runtime/stephanosHomeNode.mjs';

const DEFAULT_API_BASE_URL = 'http://localhost:8787';
const DEFAULT_TIMEOUT_MS = 30000;
const runtimeEnv = import.meta?.env || {};

function getFrontendOrigin() {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return 'http://localhost';
  }

  return window.location.origin;
}

function isLoopbackHost(hostname = '') {
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(String(hostname).toLowerCase());
}

function getStoredHomeNodeContext() {
  return {
    manualNode: readPersistedStephanosHomeNode(),
    lastKnownNode: readPersistedStephanosLastKnownNode(),
  };
}

function getDefaultApiBaseUrl() {
  const currentOrigin = getFrontendOrigin();
  const { manualNode, lastKnownNode } = getStoredHomeNodeContext();
  const resolvedBaseUrl = resolveStephanosBackendBaseUrl({
    currentOrigin,
    manualNode,
    lastKnownNode,
  });
  const currentHost = (() => {
    try {
      return new URL(currentOrigin).hostname || '';
    } catch {
      return '';
    }
  })();
  const localDesktopSession = !currentHost || isLoopbackHost(currentHost);

  if (resolvedBaseUrl) {
    return resolvedBaseUrl;
  }

  return localDesktopSession
    ? DEFAULT_API_BASE_URL
    : currentOrigin;
}

function normalizeBaseUrl(value) {
  if (!value || typeof value !== 'string') {
    return getDefaultApiBaseUrl();
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return getDefaultApiBaseUrl();
  }

  if (trimmed.startsWith('/')) {
    return `${getFrontendOrigin()}${trimmed === '/' ? '' : trimmed}`.replace(/\/$/, '');
  }

  try {
    const parsed = new URL(trimmed);
    if (isMalformedStephanosHost(parsed.hostname || '')) {
      return getDefaultApiBaseUrl();
    }
    return parsed.href.replace(/\/$/, '');
  } catch {
    return getDefaultApiBaseUrl();
  }
}

function resolveTimeoutMs(rawTimeoutMs) {
  const timeoutMs = Number(rawTimeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return timeoutMs;
}

function detectTarget(baseUrl) {
  try {
    const { hostname } = new URL(baseUrl);
    if (isLoopbackHost(hostname)) {
      return 'local';
    }
  } catch {
    return 'local';
  }

  return 'remote';
}

function getResolvedApiBaseUrl() {
  return normalizeBaseUrl(runtimeEnv.VITE_API_BASE_URL);
}

function getApiBaseUrlStrategy(baseUrl) {
  if (runtimeEnv.VITE_API_BASE_URL?.trim()) {
    return 'env:VITE_API_BASE_URL';
  }

  return getApiTargetLabel(baseUrl) === 'remote'
    ? 'default:preferred-home-node-or-current-host'
    : 'default:local-stephanos-backend';
}

export function getApiConfig() {
  const baseUrl = getResolvedApiBaseUrl();
  return {
    baseUrl,
    timeoutMs: resolveTimeoutMs(runtimeEnv.VITE_API_TIMEOUT_MS),
  };
}

export function buildApiUrl(pathname, baseUrl = getResolvedApiBaseUrl()) {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${baseUrl}${path}`;
}

export function getApiTargetLabel(baseUrl = getResolvedApiBaseUrl()) {
  return detectTarget(baseUrl);
}

export function getApiRuntimeConfig() {
  const config = getApiConfig();
  const { manualNode, lastKnownNode } = getStoredHomeNodeContext();

  return {
    frontendOrigin: getFrontendOrigin(),
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    target: getApiTargetLabel(config.baseUrl),
    strategy: getApiBaseUrlStrategy(config.baseUrl),
    backendTargetEndpoint: buildApiUrl('/api/ai/chat', config.baseUrl),
    healthEndpoint: buildApiUrl('/api/health', config.baseUrl),
    homeNode: manualNode || lastKnownNode || null,
  };
}

export function getApiRuntimeConfigSnapshotKey(runtimeConfig = getApiRuntimeConfig()) {
  const homeNode = runtimeConfig?.homeNode || null;

  return JSON.stringify({
    frontendOrigin: runtimeConfig?.frontendOrigin || '',
    baseUrl: runtimeConfig?.baseUrl || '',
    timeoutMs: Number(runtimeConfig?.timeoutMs) || DEFAULT_TIMEOUT_MS,
    target: runtimeConfig?.target || '',
    strategy: runtimeConfig?.strategy || '',
    backendTargetEndpoint: runtimeConfig?.backendTargetEndpoint || '',
    healthEndpoint: runtimeConfig?.healthEndpoint || '',
    homeNode: homeNode ? {
      host: homeNode.host || '',
      uiPort: Number(homeNode.uiPort) || 0,
      backendPort: Number(homeNode.backendPort) || 0,
      uiUrl: homeNode.uiUrl || '',
      backendUrl: homeNode.backendUrl || '',
      source: homeNode.source || '',
      reachable: Boolean(homeNode.reachable),
      configured: Boolean(homeNode.configured),
    } : null,
  });
}
