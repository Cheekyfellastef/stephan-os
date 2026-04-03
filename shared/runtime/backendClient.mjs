import {
  readPersistedStephanosHomeNode,
  readPersistedStephanosLastKnownNode,
  resolveStephanosBackendTarget,
} from './stephanosHomeNode.mjs';

const DEFAULT_BACKEND_TIMEOUT_MS = 5000;

function safeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveFrontendOrigin(runtimeContext = {}) {
  if (safeString(runtimeContext.frontendOrigin)) {
    return safeString(runtimeContext.frontendOrigin);
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return '';
}

function resolveBackendBaseUrl(runtimeContext = {}) {
  const storage = runtimeContext.storage || globalThis?.localStorage;
  const manualNode = runtimeContext.manualNode || readPersistedStephanosHomeNode(storage);
  const lastKnownNode = runtimeContext.lastKnownNode || readPersistedStephanosLastKnownNode(storage);

  return resolveStephanosBackendTarget({
    currentOrigin: resolveFrontendOrigin(runtimeContext),
    manualNode,
    lastKnownNode,
    explicitBaseUrl: runtimeContext.baseUrl,
  });
}

function createAbortController(timeoutMs, externalSignal) {
  const controller = new AbortController();
  const resolvedTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_BACKEND_TIMEOUT_MS;
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, resolvedTimeout);

  if (externalSignal && typeof externalSignal.addEventListener === 'function') {
    externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return { controller, timeoutId };
}

function joinBackendUrl(baseUrl, path) {
  const normalizedBase = safeString(baseUrl).replace(/\/$/, '');
  const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
  return `${normalizedBase}${normalizedPath}`;
}

export async function requestStephanosBackend({
  path = '/',
  method = 'GET',
  body,
  headers = {},
  runtimeContext = {},
  fetchImpl = globalThis?.fetch,
  timeoutMs = DEFAULT_BACKEND_TIMEOUT_MS,
  signal,
  diagnostics,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch is unavailable; cannot contact Stephanos backend.');
  }

  const backendTarget = resolveBackendBaseUrl(runtimeContext);
  const baseUrl = backendTarget?.resolvedUrl || '';
  if (!baseUrl) {
    const unresolvedError = new Error(backendTarget?.invalidReason || 'Stephanos backend target is unresolved.');
    unresolvedError.code = 'backend-target-unresolved';
    unresolvedError.baseUrl = '';
    unresolvedError.path = path;
    unresolvedError.resolutionSource = backendTarget?.resolutionSource || 'unresolved';
    throw unresolvedError;
  }
  const url = joinBackendUrl(baseUrl, path);
  const requestHeaders = {
    Accept: 'application/json',
    'Cache-Control': 'no-cache',
    ...headers,
  };

  const hasJsonBody = body !== undefined;
  if (hasJsonBody && !requestHeaders['Content-Type']) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  const { controller, timeoutId } = createAbortController(timeoutMs, signal);

  try {
    const response = await fetchImpl(url, {
      method,
      cache: 'no-store',
      headers: requestHeaders,
      body: hasJsonBody ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        const parseError = new Error(`Stephanos backend returned malformed JSON from ${path}.`);
        parseError.baseUrl = baseUrl;
        parseError.path = path;
        parseError.url = url;
        throw parseError;
      }
    }

    if (!response.ok) {
      const error = new Error((json && json.error) || `Stephanos backend request failed with HTTP ${response.status}.`);
      error.status = response.status;
      error.payload = json;
      error.baseUrl = baseUrl;
      error.path = path;
      error.url = url;
      throw error;
    }

    diagnostics?.({
      ok: true,
      method,
      path,
      baseUrl,
      url,
      status: response.status,
    });

    return {
      ok: true,
      status: response.status,
      text,
      json: json || {},
      baseUrl,
      path,
      url,
    };
  } catch (error) {
    diagnostics?.({
      ok: false,
      method,
      path,
      baseUrl,
      url,
      status: error?.status || 0,
      error: error?.message || 'unknown-error',
    });
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`Stephanos backend request timed out after ${timeoutMs}ms for ${path}.`);
      timeoutError.code = 'backend-timeout';
      timeoutError.baseUrl = baseUrl;
      timeoutError.path = path;
      timeoutError.url = url;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function resolveStephanosBackendClientBaseUrl(runtimeContext = {}) {
  return resolveBackendBaseUrl(runtimeContext)?.resolvedUrl || '';
}
