const DEFAULT_API_BASE_URL = 'http://localhost:8787';
const DEFAULT_TIMEOUT_MS = 30000;

function getFrontendOrigin() {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return 'http://localhost';
  }

  return window.location.origin;
}

function isLoopbackHost(hostname = '') {
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(String(hostname).toLowerCase());
}

function getHostedDefaultApiBaseUrl() {
  const origin = getFrontendOrigin();
  try {
    const parsed = new URL(origin);
    if (!isLoopbackHost(parsed.hostname)) {
      return parsed.origin;
    }
  } catch {
    return DEFAULT_API_BASE_URL;
  }

  return DEFAULT_API_BASE_URL;
}

function normalizeBaseUrl(value) {
  if (!value || typeof value !== 'string') {
    return getHostedDefaultApiBaseUrl();
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return getHostedDefaultApiBaseUrl();
  }

  if (trimmed.startsWith('/')) {
    return `${getFrontendOrigin()}${trimmed === '/' ? '' : trimmed}`.replace(/\/$/, '');
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.href.replace(/\/$/, '');
  } catch {
    return getHostedDefaultApiBaseUrl();
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

function getApiBaseUrlStrategy() {
  if (import.meta.env.VITE_API_BASE_URL?.trim()) {
    return 'env:VITE_API_BASE_URL';
  }

  return getApiTargetLabel() === 'remote'
    ? 'default:same-origin-hosted-backend'
    : 'default:local-stephanos-backend';
}

export const API_CONFIG = {
  baseUrl: normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL),
  timeoutMs: resolveTimeoutMs(import.meta.env.VITE_API_TIMEOUT_MS),
};

export function buildApiUrl(pathname) {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${API_CONFIG.baseUrl}${path}`;
}

export function getApiTargetLabel() {
  return detectTarget(API_CONFIG.baseUrl);
}

export function getApiRuntimeConfig() {
  return {
    frontendOrigin: getFrontendOrigin(),
    baseUrl: API_CONFIG.baseUrl,
    timeoutMs: API_CONFIG.timeoutMs,
    target: getApiTargetLabel(),
    strategy: getApiBaseUrlStrategy(),
    backendTargetEndpoint: buildApiUrl('/api/ai/chat'),
    healthEndpoint: buildApiUrl('/api/health'),
  };
}
