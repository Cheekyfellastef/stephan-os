import { requestStephanosBackend } from './backendClient.mjs';

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

function isLikelyStaticHostedOrigin(hostname = '') {
  const value = String(hostname || '').trim().toLowerCase();
  if (!value) return false;
  return value.endsWith('.github.io')
    || value.endsWith('.pages.dev')
    || value.endsWith('.netlify.app')
    || value.endsWith('.vercel.app');
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

function isValidIpv4Host(hostname = '') {
  const value = String(hostname).trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    return false;
  }

  const octets = value.split('.').map((part) => Number.parseInt(part, 10));
  return !octets.some((part) => Number.isNaN(part) || part < 0 || part > 255);
}

export function isMalformedStephanosHost(hostname = '') {
  const value = String(hostname).trim().toLowerCase();
  if (!value) {
    return true;
  }
  if (!/[a-z0-9]/.test(value)) {
    return true;
  }
  if (value.startsWith('.') || value.endsWith('.') || value.includes('..')) {
    return true;
  }

  if (/^\d+$/.test(value)) {
    return true;
  }

  if (/^\d+(?:\.\d+){1,3}$/.test(value) && !isValidIpv4Host(value)) {
    return true;
  }

  return false;
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
  const validHost = normalizedHost && !isMalformedStephanosHost(normalizedHost) ? normalizedHost : '';
  const resolvedUiPort = normalizePort(uiPort, DEFAULT_HOME_NODE_UI_PORT);
  const resolvedBackendPort = normalizePort(backendPort, DEFAULT_HOME_NODE_BACKEND_PORT);
  const resolvedDistPort = normalizePort(distPort, DEFAULT_HOME_NODE_DIST_PORT);
  const uiOrigin = validHost ? `http://${validHost}:${resolvedUiPort}` : '';
  const backendOrigin = validHost ? `http://${validHost}:${resolvedBackendPort}` : '';
  const distOrigin = validHost ? `http://${validHost}:${resolvedDistPort}` : '';

  return {
    host: validHost,
    ip: isPrivateIpv4Host(validHost) ? validHost : '',
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
  if (!host || isMalformedStephanosHost(host)) {
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
  const raw = readJsonStorage(storage, STEPHANOS_HOME_NODE_STORAGE_KEY);
  const normalized = normalizeStephanosHomeNode(raw, { source: 'manual' });
  if (raw && !isValidStephanosHomeNode(normalized)) {
    writeJsonStorage(storage, STEPHANOS_HOME_NODE_STORAGE_KEY, null);
  }
  return isValidStephanosHomeNode(normalized) ? normalized : null;
}

export function readPersistedStephanosLastKnownNode(storage = globalThis?.localStorage) {
  const raw = readJsonStorage(storage, STEPHANOS_HOME_NODE_LAST_KNOWN_STORAGE_KEY);
  const normalized = normalizeStephanosHomeNode(raw, { source: 'lastKnown' });
  if (raw && !isValidStephanosHomeNode(normalized)) {
    writeJsonStorage(storage, STEPHANOS_HOME_NODE_LAST_KNOWN_STORAGE_KEY, null);
  }
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

function summarizeAttemptFailures(attempts = []) {
  if (!Array.isArray(attempts) || !attempts.length) {
    return 'no non-loopback candidates were available to probe';
  }

  return attempts.map((attempt) => formatAttemptRejection(attempt)).join(' | ');
}

function deriveOperatorAction({
  nonLocalSession = false,
  prioritizedAttempt = null,
  preferredNode = null,
  configured = false,
} = {}) {
  if (!configured) {
    return nonLocalSession
      ? 'Set a manual home-node to a reachable LAN host/IP and backend port (for example 192.168.x.x:8787).'
      : 'Start stephanos-server locally or configure a reachable home-node.';
  }

  const source = prioritizedAttempt?.source || preferredNode?.source || '';
  const reason = String(prioritizedAttempt?.reason || '').toLowerCase();
  const host = prioritizedAttempt?.host || preferredNode?.host || '';
  if (reason === 'timeout') {
    return `Probe to ${host || 'the configured home-node'} timed out. Confirm the target host/port is reachable from this device and that /api/health responds quickly.`;
  }
  if (reason === 'not-stephanos-server') {
    return `Target ${host || 'configured host'} is reachable but is not stephanos-server. Point manual home-node to the machine running stephanos-server on port 8787.`;
  }
  if (reason.includes('cors') || reason.includes('failed to fetch') || reason.includes('networkerror')) {
    return `Browser network/CORS blocked access to ${host || 'configured host'}. Ensure iPad/browser can reach the LAN backend and the backend allows this origin.`;
  }
  if (source === 'manual') {
    return `Update manual home-node to a reachable LAN host/IP and port, then re-check discovery. Current target: ${host || 'unknown host'}.`;
  }
  if (source === 'lastKnown') {
    return `Last known home-node ${host || ''} is no longer reachable. Update manual home-node to the current reachable LAN host/IP.`;
  }

  return nonLocalSession
    ? 'No reachable Stephanos backend was found from this hosted session. Set manual home-node to the reachable LAN backend host/IP:port.'
    : 'No reachable Stephanos backend was found. Start stephanos-server or configure a reachable home-node.';
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
    summary: summarizeAttemptFailures(attempts),
  };
}

async function fetchJsonWithTimeout(url, { fetchImpl = globalThis?.fetch, timeoutMs = 1500 } = {}) {
  if (typeof fetchImpl !== 'function' || !url) {
    return { ok: false, reason: 'fetch-unavailable' };
  }

  if (!safeUrlParse(url)) {
    return { ok: false, reason: 'invalid-url' };
  }

  try {
    const parsed = safeUrlParse(url);
    const probe = await requestStephanosBackend({
      path: '/api/health',
      method: 'GET',
      runtimeContext: {
        baseUrl: parsed?.origin || '',
      },
      fetchImpl,
      timeoutMs,
    });
    return { ok: true, json: probe.json };
  } catch (error) {
    return {
      ok: false,
      status: error?.status,
      reason: error?.code === 'backend-timeout'
        ? 'timeout'
        : (error?.status ? `http-${error.status}` : (error?.message || 'network-error')),
    };
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
    const attemptSummary = summarizeAttemptFailures(attempts);
    const operatorAction = deriveOperatorAction({
      nonLocalSession,
      prioritizedAttempt,
      preferredNode,
      configured,
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
      attemptSummary,
      operatorAction,
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
      attemptSummary: 'no non-loopback candidates were available to probe',
      operatorAction: 'Retry discovery after confirming network connectivity and backend availability.',
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
  return resolveStephanosBackendTarget({
    currentOrigin,
    manualNode,
    lastKnownNode,
    explicitBaseUrl,
  }).resolvedUrl;
}

export function resolveStephanosBackendTarget({
  currentOrigin = '',
  manualNode = null,
  lastKnownNode = null,
  explicitBaseUrl = '',
} = {}) {
  const explicit = safeUrlParse(explicitBaseUrl);
  if (explicit?.origin) {
    return {
      resolvedUrl: explicit.origin,
      resolutionSource: 'explicit-backend-target',
      fallbackUsed: false,
      invalidReason: '',
      resolved: true,
    };
  }

  const current = safeUrlParse(currentOrigin);
  const currentHost = current?.hostname || '';
  const currentIsHostedWeb = Boolean(currentHost) && !isLoopbackHost(currentHost);
  if (current?.hostname && isLikelyLanHost(current.hostname) && !isLoopbackHost(current.hostname)) {
    if (normalizePort(current.port, DEFAULT_HOME_NODE_UI_PORT) === DEFAULT_HOME_NODE_BACKEND_PORT) {
      return {
        resolvedUrl: current.origin,
        resolutionSource: 'current-lan-origin',
        fallbackUsed: false,
        invalidReason: '',
        resolved: true,
      };
    }
    return {
      resolvedUrl: createStephanosHomeNodeUrls({ host: current.hostname, backendPort: DEFAULT_HOME_NODE_BACKEND_PORT }).backendUrl,
      resolutionSource: 'current-lan-origin',
      fallbackUsed: false,
      invalidReason: '',
      resolved: true,
    };
  }

  const manual = normalizeStephanosHomeNode(manualNode, { source: 'manual' });
  const lastKnown = normalizeStephanosHomeNode(lastKnownNode, { source: 'lastKnown' });
  const preferredNode = isValidStephanosHomeNode(manual)
    ? manual
    : isValidStephanosHomeNode(lastKnown)
      ? lastKnown
      : null;

  if (preferredNode?.backendUrl) {
    const backendParsed = safeUrlParse(preferredNode.backendUrl);
    if (backendParsed?.origin && !isMalformedStephanosHost(backendParsed.hostname || '')) {
      return {
        resolvedUrl: backendParsed.origin,
        resolutionSource: preferredNode.source === 'lastKnown' ? 'last-known-home-node-target' : 'manual-home-node-target',
        fallbackUsed: false,
        invalidReason: '',
        resolved: true,
      };
    }
  }

  if (currentIsHostedWeb) {
    const staticOrigin = isLikelyStaticHostedOrigin(currentHost);
    return {
      resolvedUrl: '',
      resolutionSource: 'unresolved-hosted-session',
      fallbackUsed: false,
      invalidReason: staticOrigin
        ? 'same-origin /api is invalid on static host'
        : 'hosted session requires explicit backend/home-node/cloud target',
      resolved: false,
    };
  }

  return {
    resolvedUrl: `http://localhost:${DEFAULT_HOME_NODE_BACKEND_PORT}`,
    resolutionSource: 'localhost-default',
    fallbackUsed: true,
    invalidReason: '',
    resolved: true,
  };
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
