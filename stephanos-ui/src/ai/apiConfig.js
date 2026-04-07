import {
  STEPHANOS_HOME_BRIDGE_URL_GLOBAL,
  isMalformedStephanosHost,
  readPersistedStephanosHomeBridgeUrl,
  readPersistedStephanosHomeNode,
  readPersistedStephanosLastKnownNode,
  resolveStephanosBackendBaseUrl,
} from '../../../shared/runtime/stephanosHomeNode.mjs';
import { normalizeRuntimeContext } from '../../../shared/runtime/runtimeStatusModel.mjs';

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
    bridgeUrl: globalThis?.[STEPHANOS_HOME_BRIDGE_URL_GLOBAL] || readPersistedStephanosHomeBridgeUrl() || '',
    manualNode: readPersistedStephanosHomeNode(),
    lastKnownNode: readPersistedStephanosLastKnownNode(),
  };
}

function getDefaultApiBaseUrl() {
  const currentOrigin = getFrontendOrigin();
  const { bridgeUrl, manualNode, lastKnownNode } = getStoredHomeNodeContext();
  return resolveStephanosBackendBaseUrl({
    currentOrigin,
    bridgeUrl,
    manualNode,
    lastKnownNode,
  }) || DEFAULT_API_BASE_URL;
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

function getTimeoutSource(rawTimeoutMs) {
  const timeoutMs = Number(rawTimeoutMs);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return 'env:VITE_API_TIMEOUT_MS';
  }
  return 'default:30000ms';
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
    timeoutSource: getTimeoutSource(runtimeEnv.VITE_API_TIMEOUT_MS),
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
  const { bridgeUrl, manualNode, lastKnownNode } = getStoredHomeNodeContext();

  return {
    frontendOrigin: getFrontendOrigin(),
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    timeoutSource: config.timeoutSource,
    target: getApiTargetLabel(config.baseUrl),
    strategy: getApiBaseUrlStrategy(config.baseUrl),
    backendTargetEndpoint: buildApiUrl('/api/ai/chat', config.baseUrl),
    healthEndpoint: buildApiUrl('/api/health', config.baseUrl),
    bridgeUrl,
    homeNode: manualNode || lastKnownNode || null,
  };
}

export function resolveAdminAuthorityUrl(runtimeContext = getApiRuntimeConfig()) {
  const normalizedRuntime = normalizeRuntimeContext(runtimeContext || {});
  const sessionKind = String(normalizedRuntime.sessionKind || '');
  if (sessionKind !== 'local-desktop') {
    return {
      ok: false,
      denied: true,
      target: String(runtimeContext?.baseUrl || ''),
      source: 'non-local-session',
      reason: 'non-local-admin-route',
      sessionKind: sessionKind || 'unknown',
      deviceContext: String(normalizedRuntime.deviceContext || 'unknown'),
    };
  }

  return {
    ok: true,
    denied: false,
    target: 'http://127.0.0.1:8787',
    source: 'pc-local-admin',
    reason: '',
    sessionKind: sessionKind || 'local-desktop',
    deviceContext: String(normalizedRuntime.deviceContext || 'pc-local-browser'),
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
    bridgeUrl: runtimeConfig?.bridgeUrl || '',
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
