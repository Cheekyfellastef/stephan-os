const DEFAULT_API_BASE_URL = 'http://localhost:8787';
const DEFAULT_TIMEOUT_MS = 30000;

function normalizeBaseUrl(value) {
  if (!value || typeof value !== 'string') {
    return DEFAULT_API_BASE_URL;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_API_BASE_URL;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.href.replace(/\/$/, '');
  } catch {
    return DEFAULT_API_BASE_URL;
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
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return 'local';
    }
  } catch {
    return 'local';
  }

  return 'remote';
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
