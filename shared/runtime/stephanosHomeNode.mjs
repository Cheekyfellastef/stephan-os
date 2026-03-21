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

export function normalizeStephanosHomeNode(value = {}, defaults = {}) {
  const host = extractHostname(value.host || value.ip || defaults.host || defaults.ip || '');
  if (!host) {
    return null;
  }

  const urls = createStephanosHomeNodeUrls({
    host,
    uiPort: value.uiPort ?? defaults.uiPort,
    backendPort: value.backendPort ?? defaults.backendPort,
    distPort: value.distPort ?? defaults.distPort,
  });

  return {
    host: urls.host,
    ip: value.ip || urls.ip,
    uiPort: urls.uiPort,
    backendPort: urls.backendPort,
    distPort: urls.distPort,
    uiUrl: value.uiUrl || urls.uiUrl,
    backendUrl: value.backendUrl || urls.backendUrl,
    backendHealthUrl: value.backendHealthUrl || urls.backendHealthUrl,
    distUrl: value.distUrl || urls.distUrl,
    lastSeenAt: typeof value.lastSeenAt === 'string' ? value.lastSeenAt : '',
    source: String(value.source || defaults.source || 'manual'),
    reachable: Boolean(value.reachable),
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
  return normalizeStephanosHomeNode(readJsonStorage(storage, STEPHANOS_HOME_NODE_STORAGE_KEY) || {}, { source: 'manual' });
}

export function readPersistedStephanosLastKnownNode(storage = globalThis?.localStorage) {
  return normalizeStephanosHomeNode(readJsonStorage(storage, STEPHANOS_HOME_NODE_LAST_KNOWN_STORAGE_KEY) || {}, { source: 'lastKnown' });
}

export function persistStephanosHomeNodePreference(node, storage = globalThis?.localStorage) {
  const normalized = normalizeStephanosHomeNode(node || {}, { source: 'manual' });
  writeJsonStorage(storage, STEPHANOS_HOME_NODE_STORAGE_KEY, normalized ? {
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
  return normalized;
}

export function persistStephanosLastKnownNode(node, storage = globalThis?.localStorage) {
  const normalized = normalizeStephanosHomeNode(node || {}, { source: 'lastKnown' });
  writeJsonStorage(storage, STEPHANOS_HOME_NODE_LAST_KNOWN_STORAGE_KEY, normalized ? {
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
  return normalized;
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
  const candidate = normalizeStephanosHomeNode(value, defaults);
  if (!candidate?.host) {
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

  addCandidate(candidateMap, manualNode, { source: 'manual' });
  addCandidate(candidateMap, lastKnownNode, { source: 'lastKnown' });

  if (currentHost && !isLoopbackHost(currentHost)) {
    addCandidate(candidateMap, {
      host: currentHost,
      uiPort: currentPort,
      source: 'currentOrigin',
    });
    addCandidate(candidateMap, {
      host: currentHost,
      uiPort: DEFAULT_HOME_NODE_UI_PORT,
      source: 'currentOrigin',
    });
    addCandidate(candidateMap, {
      host: currentHost,
      uiPort: DEFAULT_HOME_NODE_DIST_PORT,
      distPort: DEFAULT_HOME_NODE_DIST_PORT,
      source: 'currentOrigin',
    });
  }

  for (const recentHost of recentHosts) {
    addCandidate(candidateMap, {
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

async function fetchJsonWithTimeout(url, { fetchImpl = globalThis?.fetch, timeoutMs = 1500 } = {}) {
  if (typeof fetchImpl !== 'function' || !url) {
    return { ok: false, reason: 'fetch-unavailable' };
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
  if (!candidate?.backendHealthUrl) {
    return { ok: false, node: candidate, reason: 'missing-backend-url' };
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
  const resolved = normalizeStephanosHomeNode({
    ...candidate,
    backendUrl: health.json?.backend_base_url || candidate.backendUrl,
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
  const candidates = buildStephanosHomeNodeCandidates({ currentOrigin, manualNode, lastKnownNode, recentHosts });
  const attempts = [];

  for (const candidate of candidates) {
    const probe = await probeStephanosHomeNode(candidate, { fetchImpl, timeoutMs });
    attempts.push({
      host: candidate.host,
      uiUrl: candidate.uiUrl,
      backendUrl: candidate.backendUrl,
      source: candidate.source,
      ok: probe.ok,
      reason: probe.reason || '',
    });

    if (probe.ok && probe.node) {
      persistStephanosLastKnownNode({ ...probe.node, source: probe.node.source || candidate.source || 'discovered' }, storage);
      return {
        reachable: true,
        preferredNode: probe.node,
        node: probe.node,
        attempts,
        source: probe.node.source || candidate.source || 'discovered',
      };
    }
  }

  return {
    reachable: false,
    preferredNode: null,
    node: null,
    attempts,
    source: manualNode?.host ? 'manual' : (lastKnownNode?.host ? 'lastKnown' : 'unknown'),
  };
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
  if (current?.hostname && !isLoopbackHost(current.hostname)) {
    if (normalizePort(current.port, DEFAULT_HOME_NODE_UI_PORT) === DEFAULT_HOME_NODE_BACKEND_PORT) {
      return current.origin;
    }
    return createStephanosHomeNodeUrls({ host: current.hostname, backendPort: DEFAULT_HOME_NODE_BACKEND_PORT }).backendUrl;
  }

  const preferredNode = normalizeStephanosHomeNode(manualNode, { source: 'manual' })
    || normalizeStephanosHomeNode(lastKnownNode, { source: 'lastKnown' });

  if (preferredNode?.backendUrl) {
    return preferredNode.backendUrl;
  }

  return `http://localhost:${DEFAULT_HOME_NODE_BACKEND_PORT}`;
}

export function summarizeStephanosHomeNode(node) {
  const normalized = normalizeStephanosHomeNode(node || {});
  if (!normalized) {
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
