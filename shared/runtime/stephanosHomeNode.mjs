const DEFAULT_HOME_NODE_UI_PORT = 5173;
const DEFAULT_HOME_NODE_BACKEND_PORT = 8787;
const DEFAULT_HOME_NODE_DIST_PORT = 4173;

export const STEPHANOS_HOME_NODE_STORAGE_KEY = 'stephanos_home_node_manual';
export const STEPHANOS_HOME_NODE_LAST_KNOWN_STORAGE_KEY = 'stephanos_home_node_last_known';

function isBrowserStorageAvailable(storage) {
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function';
}

function normalizePort(value, fallback) {
  const numeric = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function ensureTrailingSlash(value = '/') {
  return value.endsWith('/') ? value : `${value}/`;
}

function safeUrlParse(value = '') {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isLoopbackHost(hostname = '') {
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(String(hostname).trim().toLowerCase());
}

export function isPrivateIpv4Host(hostname = '') {
  const value = String(hostname).trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    return false;
  }

  const octets = value.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

export function isLikelyLanHost(hostname = '') {
  const value = String(hostname).trim().toLowerCase();
  if (!value) return false;
  if (isLoopbackHost(value) || isPrivateIpv4Host(value)) return true;
  return value.endsWith('.local');
}

export function extractHostname(value = '') {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  const parsed = safeUrlParse(trimmed);
  if (parsed?.hostname) {
    return parsed.hostname;
  }

  const withoutProtocol = trimmed.replace(/^[a-z]+:\/\//i, '').split('/')[0] || '';
  return withoutProtocol.replace(/:\d+$/, '').trim();
}

export function createStephanosHomeNodeUrls({ host = '', uiPort = DEFAULT_HOME_NODE_UI_PORT, backendPort = DEFAULT_HOME_NODE_BACKEND_PORT, distPort = DEFAULT_HOME_NODE_DIST_PORT } = {}) {
  const normalizedHost = extractHostname(host);
  const resolvedUiPort = normalizePort(uiPort, DEFAULT_HOME_NODE_UI_PORT);
  const resolvedBackendPort = normalizePort(backendPort, DEFAULT_HOME_NODE_BACKEND_PORT);
  const resolvedDistPort = normalizePort(distPort, DEFAULT_HOME_NODE_DIST_PORT);
  const uiOrigin = normalizedHost ? `http://${normalizedHost}:${resolvedUiPort}` : '';
  const backendOrigin = normalizedHost ? `http://${normalizedHost}:${resolvedBackendPort}` : '';
  const distOrigin = normalizedHost ? `http://${normalizedHost}:${resolvedDistPort}` : '';

  return {
    host: normalizedHost,
    ip: isPrivateIpv4Host(normalizedHost) ? normalizedHost : '',
    uiPort: resolvedUiPort,
    backendPort: resolvedBackendPort,
    distPort: resolvedDistPort,
    uiOrigin,
    uiUrl: uiOrigin ? `${uiOrigin}/` : '',
    backendOrigin,
    backendUrl: backendOrigin,
    backendHealthUrl: backendOrigin ? `${backendOrigin}/api/health` : '',
    distOrigin,
    distUrl: distOrigin ? `${distOrigin}/apps/stephanos/dist/` : '',
  };
}

function createEmptyStephanosHomeNode(defaults = {}, sourceFallback = 'manual') {
  return {
    host: '',
    ip: '',
    uiPort: normalizePort(defaults.uiPort, DEFAULT_HOME_NODE_UI_PORT),
    backendPort: normalizePort(defaults.backendPort, DEFAULT_HOME_NODE_BACKEND_PORT),
    distPort: normalizePort(defaults.distPort, DEFAULT_HOME_NODE_DIST_PORT),
    uiUrl: '',
    backendUrl: '',
    backendHealthUrl: '',
    distUrl: '',
    lastSeenAt: typeof defaults.lastSeenAt === 'string' ? defaults.lastSeenAt : '',
    source: String(defaults.source || sourceFallback),
    reachable: Boolean(defaults.reachable),
    configured: false,
  };
}

export function isValidStephanosHomeNode(value) {
  return Boolean(value && typeof value === 'object' && String(value.host || '').trim());
}

export function normalizeStephanosHomeNode(value = {}, defaults = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const fallback = defaults && typeof defaults === 'object' ? defaults : {};
  const host = extractHostname(input.host || input.ip || fallback.host || fallback.ip || '');
  if (!host) {
    return createEmptyStephanosHomeNode({ ...fallback, ...input }, fallback.source || 'manual');
  }

  const urls = createStephanosHomeNodeUrls({
    host,
    uiPort: input.uiPort ?? fallback.uiPort,
    backendPort: input.backendPort ?? fallback.backendPort,
    distPort: input.distPort ?? fallback.distPort,
  });

  return {
    host: urls.host,
    ip: input.ip || urls.ip,
    uiPort: urls.uiPort,
    backendPort: urls.backendPort,
    distPort: urls.distPort,
    uiUrl: input.uiUrl || urls.uiUrl,
    backendUrl: input.backendUrl || urls.backendUrl,
    backendHealthUrl: input.backendHealthUrl || urls.backendHealthUrl,
    distUrl: input.distUrl || urls.distUrl,
    lastSeenAt: typeof input.lastSeenAt === 'string' ? input.lastSeenAt : '',
    source: String(input.source || fallback.source || 'manual'),
    reachable: Boolean(input.reachable),
    configured: true,
  };
}

function readJsonStorage(storage, key) {
  if (!isBrowserStorageAvailable(storage)) {
    return null;
  }

  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJsonStorage(storage, key, value) {
  if (!isBrowserStorageAvailable(storage)) {
    return;
  }

  try {
    if (value == null) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures so runtime truth stays usable in restricted browsers.
  }
}

export function readPersistedStephanosHomeNode(storage = globalThis?.localStorage) {
  const normalized = normalizeStephanosHomeNode(readJsonStorage(storage, STEPHANOS_HOME_NODE_STORAGE_KEY), { source: 'manual' });
  return isValidStephanosHomeNode(normalized) ? normalized : null;
}

export function readPersistedStephanosLastKnownNode(storage = globalThis?.localStorage) {
  const normalized = normalizeStephanosHomeNode(readJsonStorage(storage, STEPHANOS_HOME_NODE_LAST_KNOWN_STORAGE_KEY), { source: 'lastKnown' });
  return isValidStephanosHomeNode(normalized) ? normalized : null;
}

export function persistStephanosHomeNodePreference(node, storage = globalThis?.localStorage) {
  const normalized = normalizeStephanosHomeNode(node, { source: 'manual' });
  writeJsonStorage(storage, STEPHANOS_HOME_NODE_STORAGE_KEY, isValidStephanosHomeNode(normalized) ? {
    host: normalized.host,
    ip: normalized.ip,
    uiPort: normalized.uiPort,
    backendPort: normalized.backendPort,
    distPort: normalized.distPort,
    uiUrl: normalized.uiUrl,
    backendUrl: normalized.backendUrl,
    distUrl: normalized.distUrl,
    source: 'manual',
  } : null);
  return isValidStephanosHomeNode(normalized) ? normalized : null;
}

export function persistStephanosLastKnownNode(node, storage = globalThis?.localStorage) {
  const normalized = normalizeStephanosHomeNode(node, { source: 'lastKnown' });
  writeJsonStorage(storage, STEPHANOS_HOME_NODE_LAST_KNOWN_STORAGE_KEY, isValidStephanosHomeNode(normalized) ? {
    host: normalized.host,
    ip: normalized.ip,
    uiPort: normalized.uiPort,
    backendPort: normalized.backendPort,
    distPort: normalized.distPort,
    uiUrl: normalized.uiUrl,
    backendUrl: normalized.backendUrl,
    backendHealthUrl: normalized.backendHealthUrl,
    distUrl: normalized.distUrl,
    lastSeenAt: normalized.lastSeenAt,
    source: normalized.source,
    reachable: normalized.reachable,
  } : null);
  return isValidStephanosHomeNode(normalized) ? normalized : null;
}

export function clearPersistedStephanosHomeNode(storage = globalThis?.localStorage) {
  writeJsonStorage(storage, STEPHANOS_HOME_NODE_STORAGE_KEY, null);
}

export function clearPersistedStephanosLastKnownNode(storage = globalThis?.localStorage) {
  writeJsonStorage(storage, STEPHANOS_HOME_NODE_LAST_KNOWN_STORAGE_KEY, null);
}

function createCandidateMap() {
  return new Map();
}

function addCandidate(candidateMap, value, defaults = {}) {
  if (!value || (typeof value !== 'object' && typeof value !== 'string')) {
    return;
  }

  if (typeof value === 'string' && !value.trim()) {
    return;
  }

  if (typeof value === 'object' && !Object.keys(value).length) {
    return;
  }

  const candidate = normalizeStephanosHomeNode(value, defaults);
  if (!isValidStephanosHomeNode(candidate)) {
    return;
  }

  const key = `${candidate.host}:${candidate.uiPort}:${candidate.backendPort}:${candidate.distPort}`;
  if (!candidateMap.has(key)) {
    candidateMap.set(key, candidate);
  }
}

export function buildStephanosHomeNodeCandidates({
  currentOrigin = '',
  manualNode = null,
  lastKnownNode = null,
  recentHosts = [],
} = {}) {
  const candidateMap = createCandidateMap();
  const current = safeUrlParse(currentOrigin);
  const currentHost = current?.hostname || '';
  const currentPort = normalizePort(current?.port, DEFAULT_HOME_NODE_UI_PORT);
  const allowLoopbackCandidates = !currentHost || isLoopbackHost(currentHost);

  const addCandidateIfCompatible = (value, defaults = {}) => {
    const candidate = normalizeStephanosHomeNode(value, defaults);
    if (!isValidStephanosHomeNode(candidate)) {
      return;
    }

    if (!allowLoopbackCandidates && isLoopbackHost(candidate.host)) {
      return;
    }

    addCandidate(candidateMap, candidate, defaults);
  };

  addCandidateIfCompatible(manualNode, { source: 'manual' });
  addCandidateIfCompatible(lastKnownNode, { source: 'lastKnown' });

  if (currentHost && !isLoopbackHost(currentHost)) {
    addCandidateIfCompatible({
      host: currentHost,
      uiPort: currentPort,
      source: 'currentOrigin',
    });
    addCandidateIfCompatible({
      host: currentHost,
      uiPort: DEFAULT_HOME_NODE_UI_PORT,
      source: 'currentOrigin',
    });
    addCandidateIfCompatible({
      host: currentHost,
      uiPort: DEFAULT_HOME_NODE_DIST_PORT,
      distPort: DEFAULT_HOME_NODE_DIST_PORT,
      source: 'currentOrigin',
    });
  }

  for (const recentHost of recentHosts) {
    addCandidateIfCompatible({
      host: recentHost,
      source: 'discovered',
    });
  }

  return Array.from(candidateMap.values()).slice(0, 8);
}

function createAbortErrorTimeout(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeoutId };
}

function classifyProbeFailureReason(reason = '') {
  const normalized = String(reason || '').trim();
  const lower = normalized.toLowerCase();

  if (!normalized) {
    return {
      code: 'unreachable-host',
      detail: 'unreachable host',
    };
  }

  if (lower === 'timeout') {
    return {
      code: 'probe-timeout',
      detail: 'probe timeout',
    };
  }

  if (lower === 'invalid-url' || lower === 'missing-backend-url') {
    return {
      code: 'invalid-url',
      detail: 'invalid URL',
    };
  }

  if (lower === 'not-stephanos-server') {
    return {
      code: 'unexpected-service',
      detail: 'target did not respond as stephanos-server',
    };
  }

  if (/^http-\d+$/.test(lower)) {
    return {
      code: 'unreachable-host',
      detail: `unreachable host (${lower})`,
    };
  }

  if (/cors|networkerror|failed to fetch/.test(lower)) {
    return {
      code: 'cors-network-failure',
      detail: 'CORS/network failure',
    };
  }

  if (/econnrefused|enotfound|ehostunreach|eai_again|fetch failed|network-error/.test(lower)) {
    return {
      code: 'unreachable-host',
      detail: 'unreachable host',
    };
  }

  return {
    code: 'probe-failed',
    detail: normalized,
  };
}

function describeHomeNodeFailure({
  source = 'unknown',
  reason = '',
  host = '',
  manualNodePresent = false,
  manualNodeInvalid = false,
  manualNodeLoopbackRejected = false,
} = {}) {
  if (source === 'manual') {
    if (manualNodeLoopbackRejected) {
      return {
        code: 'invalid-url',
        detail: 'localhost loopback manual node is invalid on non-local devices',
        message: 'Manual home-node localhost values are invalid on non-local devices and were ignored.',
      };
    }

    if (manualNodeInvalid) {
      return {
        code: 'invalid-url',
        detail: 'invalid URL',
        message: 'Manual home-node address is invalid.',
      };
    }

    if (!manualNodePresent) {
      return {
        code: 'missing-manual-node',
        detail: 'missing manual node',
        message: 'Manual home-node address is missing.',
      };
    }
  }

  const classified = classifyProbeFailureReason(reason);
  const sourceLabel = source === 'manual'
    ? 'Manual home-node'
    : source === 'lastKnown'
      ? 'Last known home-node'
      : 'Home-node';
  const hostLabel = host ? ` ${host}` : '';

  return {
    code: classified.code,
    detail: classified.detail,
    message: `${sourceLabel}${hostLabel} failed: ${classified.detail}.`,
  };
}

function formatAttemptRejection(attempt = {}) {
  if (attempt.ok) {
    return `${attempt.source}:${attempt.host || 'unknown'} accepted`;
  }

  const detail = String(attempt.failureDetail || attempt.reason || 'unknown failure').trim();
  return `${attempt.source}:${attempt.host || 'unknown'} rejected (${detail})`;
}

function summarizeFallbackDecision({ attempts = [], prioritizedAttempt = null, source = '', status = '' } = {}) {
  const attemptedCandidates = attempts.map((attempt) => ({
    host: attempt.host,
    backendUrl: attempt.backendUrl,
    source: attempt.source,
    ok: attempt.ok,
    rejection: attempt.ok ? '' : (attempt.failureDetail || attempt.reason || 'unknown failure'),
  }));

  return {
    selectedSource: source || prioritizedAttempt?.source || 'manual',
    selectedHost: prioritizedAttempt?.host || '',
    rule: status === 'available'
      ? 'selected first reachable candidate'
      : 'no candidates were reachable; preserving configured node context and falling back to current origin/runtime context',
    attemptedCandidates,
    summary: attempts.length
      ? attempts.map((attempt) => formatAttemptRejection(attempt)).join(' | ')
      : 'no non-loopback candidates were available to probe',
  };
}

async function fetchJsonWithTimeout(url, { fetchImpl = globalThis?.fetch, timeoutMs = 1500 } = {}) {
  if (typeof fetchImpl !== 'function' || !url) {
    return { ok: false, reason: 'fetch-unavailable' };
  }

  if (!safeUrlParse(url)) {
    return { ok: false, reason: 'invalid-url' };
  }

  const { controller, timeoutId } = createAbortErrorTimeout(timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, status: response.status, reason: `http-${response.status}` };
    }

    return { ok: true, json: await response.json() };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === 'AbortError' ? 'timeout' : (error?.message || 'network-error'),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function probeStephanosHomeNode(node, options = {}) {
  const candidate = normalizeStephanosHomeNode(node, { source: node?.source || 'discovered' });
  if (!isValidStephanosHomeNode(candidate) || !candidate.backendHealthUrl) {
    return { ok: false, node: isValidStephanosHomeNode(candidate) ? candidate : null, reason: 'invalid-url' };
  }

  const health = await fetchJsonWithTimeout(candidate.backendHealthUrl, options);
  if (!health.ok) {
    return {
      ok: false,
      node: { ...candidate, reachable: false },
      reason: health.reason || 'unreachable',
    };
  }

  if (health.json?.service !== 'stephanos-server') {
    return {
      ok: false,
      node: { ...candidate, reachable: false },
      reason: 'not-stephanos-server',
    };
  }

  const seenAt = new Date().toISOString();
  const publishedBackendUrl = String(
    health.json?.published_backend_base_url
    || health.json?.backend_base_url
    || ''
  ).trim();
  const publishedBackendHost = extractHostname(publishedBackendUrl);
  const shouldIgnorePublishedLoopback = Boolean(
    candidate.backendUrl
    && publishedBackendUrl
    && !isLoopbackHost(candidate.host)
    && isLoopbackHost(publishedBackendHost)
  );
  const resolvedBackendUrl = shouldIgnorePublishedLoopback
    ? candidate.backendUrl
    : (publishedBackendUrl || candidate.backendUrl);
  const resolved = normalizeStephanosHomeNode({
    ...candidate,
    backendUrl: resolvedBackendUrl,
    backendHealthUrl: candidate.backendHealthUrl,
    lastSeenAt: seenAt,
    reachable: true,
    source: candidate.source || 'discovered',
  }, { source: candidate.source || 'discovered' });

  return {
    ok: true,
    node: resolved,
    health: health.json,
  };
}

export async function discoverStephanosHomeNode({
  currentOrigin = '',
  manualNode = null,
  lastKnownNode = null,
  recentHosts = [],
  fetchImpl = globalThis?.fetch,
  timeoutMs = 1500,
  storage = globalThis?.localStorage,
} = {}) {
  try {
    const currentHost = extractHostname(currentOrigin);
    const nonLocalSession = Boolean(currentHost) && !isLoopbackHost(currentHost);
    const normalizedManualNode = normalizeStephanosHomeNode(manualNode, { source: 'manual' });
    const normalizedLastKnownNode = normalizeStephanosHomeNode(lastKnownNode, { source: 'lastKnown' });
    const manualNodePresent = Boolean(
      typeof manualNode === 'string'
        ? manualNode.trim()
        : (manualNode && typeof manualNode === 'object' && Object.keys(manualNode).length)
    );
    const manualNodeInvalid = manualNodePresent && !isValidStephanosHomeNode(normalizedManualNode);
    const manualNodeLoopbackRejected = nonLocalSession && isValidStephanosHomeNode(normalizedManualNode) && isLoopbackHost(normalizedManualNode.host);
    const candidates = buildStephanosHomeNodeCandidates({ currentOrigin, manualNode, lastKnownNode, recentHosts });
    const attempts = [];

    for (const candidate of candidates) {
      const probe = await probeStephanosHomeNode(candidate, { fetchImpl, timeoutMs });
      const failure = probe.ok ? null : describeHomeNodeFailure({
        source: candidate.source,
        reason: probe.reason,
        host: candidate.host,
        manualNodePresent,
        manualNodeInvalid,
        manualNodeLoopbackRejected,
      });
      attempts.push({
        host: candidate.host,
        uiUrl: candidate.uiUrl,
        backendUrl: candidate.backendUrl,
        source: candidate.source,
        ok: probe.ok,
        reason: probe.reason || '',
        failureCode: failure?.code || '',
        failureDetail: failure?.detail || '',
      });

      if (probe.ok && probe.node && isValidStephanosHomeNode(probe.node)) {
        const fallback = summarizeFallbackDecision({
          attempts,
          prioritizedAttempt: attempts[attempts.length - 1] || null,
          source: probe.node.source || candidate.source || 'discovered',
          status: 'available',
        });
        persistStephanosLastKnownNode({ ...probe.node, source: probe.node.source || candidate.source || 'discovered' }, storage);
        return {
          reachable: true,
          preferredNode: probe.node,
          node: probe.node,
          attempts,
          source: probe.node.source || candidate.source || 'discovered',
          status: 'available',
          message: 'Stephanos home node reachable.',
          failureCode: '',
          failureReason: '',
          fallback,
        };
      }
    }

    const preferredNode = isValidStephanosHomeNode(normalizedManualNode)
      ? normalizedManualNode
      : isValidStephanosHomeNode(normalizedLastKnownNode)
        ? normalizedLastKnownNode
        : null;
    const fallbackSource = manualNodePresent || manualNodeLoopbackRejected || manualNodeInvalid
      ? 'manual'
      : preferredNode?.source || 'manual';
    const prioritizedAttempt = attempts.find((attempt) => attempt.source === 'manual')
      || attempts.find((attempt) => attempt.source === 'lastKnown')
      || attempts[0]
      || null;
    const failure = describeHomeNodeFailure({
      source: prioritizedAttempt?.source || fallbackSource,
      reason: prioritizedAttempt?.reason || '',
      host: prioritizedAttempt?.host || preferredNode?.host || normalizedManualNode.host || normalizedLastKnownNode.host || '',
      manualNodePresent,
      manualNodeInvalid,
      manualNodeLoopbackRejected,
    });
    const configured = Boolean(preferredNode || manualNodePresent || manualNodeLoopbackRejected || manualNodeInvalid);
    const fallback = summarizeFallbackDecision({
      attempts,
      prioritizedAttempt,
      source: prioritizedAttempt?.source || fallbackSource || 'manual',
      status: configured ? 'unavailable' : 'not-configured',
    });

    return {
      reachable: false,
      preferredNode,
      node: null,
      attempts,
      source: prioritizedAttempt?.source || fallbackSource || 'manual',
      status: configured ? 'unavailable' : 'not-configured',
      message: configured ? failure.message : 'Manual home-node address is missing.',
      failureCode: configured ? failure.code : 'missing-manual-node',
      failureReason: configured ? failure.detail : 'missing manual node',
      fallback,
    };
  } catch (error) {
    return {
      reachable: false,
      preferredNode: null,
      node: null,
      attempts: [],
      source: 'unknown',
      status: 'searching',
      message: `Stephanos home node discovery failed softly: ${error?.message || 'unknown-error'}`,
      error: error?.message || 'unknown-error',
      failureCode: 'discovery-error',
      failureReason: error?.message || 'unknown-error',
      fallback: summarizeFallbackDecision({
        attempts: [],
        prioritizedAttempt: null,
        source: 'unknown',
        status: 'searching',
      }),
    };
  }
}

export function resolveStephanosBackendBaseUrl({
  currentOrigin = '',
  manualNode = null,
  lastKnownNode = null,
  explicitBaseUrl = '',
} = {}) {
  const explicit = safeUrlParse(explicitBaseUrl);
  if (explicit?.origin) {
    return explicit.origin;
  }

  const current = safeUrlParse(currentOrigin);
  if (current?.hostname && isLikelyLanHost(current.hostname) && !isLoopbackHost(current.hostname)) {
    if (normalizePort(current.port, DEFAULT_HOME_NODE_UI_PORT) === DEFAULT_HOME_NODE_BACKEND_PORT) {
      return current.origin;
    }
    return createStephanosHomeNodeUrls({ host: current.hostname, backendPort: DEFAULT_HOME_NODE_BACKEND_PORT }).backendUrl;
  }

  const manual = normalizeStephanosHomeNode(manualNode, { source: 'manual' });
  const lastKnown = normalizeStephanosHomeNode(lastKnownNode, { source: 'lastKnown' });
  const preferredNode = isValidStephanosHomeNode(manual)
    ? manual
    : isValidStephanosHomeNode(lastKnown)
      ? lastKnown
      : null;

  if (preferredNode?.backendUrl) {
    return preferredNode.backendUrl;
  }

  return `http://localhost:${DEFAULT_HOME_NODE_BACKEND_PORT}`;
}

export function summarizeStephanosHomeNode(node) {
  const normalized = normalizeStephanosHomeNode(node || {});
  if (!isValidStephanosHomeNode(normalized)) {
    return '';
  }

  const sourceLabel = normalized.source || 'manual';
  return `${normalized.host} · UI ${normalized.uiPort} · API ${normalized.backendPort} · ${sourceLabel}`;
}

export {
  DEFAULT_HOME_NODE_UI_PORT,
  DEFAULT_HOME_NODE_BACKEND_PORT,
  DEFAULT_HOME_NODE_DIST_PORT,
};
