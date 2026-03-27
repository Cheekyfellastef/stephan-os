const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_REFRESH_COOLDOWN_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS_PER_MARKER = 1;
const REALITY_SYNC_SESSION_KEY = 'stephanos.realitySync.v1';

function normalizeString(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  return fallback;
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toComparableTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonStorage(storage, key) {
  if (!storage || typeof storage.getItem !== 'function') {
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
  if (!storage || typeof storage.setItem !== 'function') {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // no-op when session storage is unavailable
  }
}

function createFetchResult({ marker = '', timestamp = '', available = false, source = 'unknown' } = {}) {
  return {
    marker: normalizeString(marker),
    timestamp: normalizeString(timestamp),
    available: normalizeBoolean(available, false),
    source: normalizeString(source, 'unknown'),
  };
}

function resolveLatestTruth(sources = {}) {
  const sourceTruth = sources.sourceTruth || createFetchResult({ source: 'source-truth' });
  const health = sources.health || createFetchResult({ source: 'health' });
  const distMetadata = sources.distMetadata || createFetchResult({ source: 'dist-metadata' });

  const firstMarker = [sourceTruth, health, distMetadata].find((entry) => entry.marker);
  const firstTimestamp = [sourceTruth, health, distMetadata].find((entry) => entry.timestamp);

  return {
    marker: firstMarker?.marker || '',
    timestamp: firstTimestamp?.timestamp || '',
    source: firstMarker?.source || firstTimestamp?.source || 'unavailable',
    available: [sourceTruth, health, distMetadata].some((entry) => entry.available || entry.marker || entry.timestamp),
    sources: {
      sourceTruth,
      health,
      distMetadata,
    },
  };
}

export function evaluateStaleness({ displayedMarker = '', displayedTimestamp = '', latestMarker = '', latestTimestamp = '' } = {}) {
  const normalizedDisplayedMarker = normalizeString(displayedMarker);
  const normalizedLatestMarker = normalizeString(latestMarker);
  const normalizedDisplayedTimestamp = normalizeString(displayedTimestamp);
  const normalizedLatestTimestamp = normalizeString(latestTimestamp);

  if (normalizedDisplayedMarker && normalizedLatestMarker) {
    return normalizedDisplayedMarker !== normalizedLatestMarker;
  }

  if (normalizedDisplayedTimestamp && normalizedLatestTimestamp) {
    const displayedTime = toComparableTimestamp(normalizedDisplayedTimestamp);
    const latestTime = toComparableTimestamp(normalizedLatestTimestamp);
    if (displayedTime != null && latestTime != null) {
      return latestTime > displayedTime;
    }
    return normalizedDisplayedTimestamp !== normalizedLatestTimestamp;
  }

  return false;
}

async function fetchJson(fetchImpl, url) {
  try {
    const response = await fetchImpl(url, { cache: 'no-store' });
    if (!response?.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

export function createRealitySyncController({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  reload = () => globalThis.location?.reload?.(),
  setIntervalImpl = (callback, intervalMs) => globalThis.setInterval(callback, intervalMs),
  clearIntervalImpl = (intervalId) => globalThis.clearInterval(intervalId),
  storage = globalThis.sessionStorage,
  sourceTruthUrl = './__stephanos/source-truth',
  healthUrl = './__stephanos/health',
  distMetadataUrl = './apps/stephanos/dist/stephanos-build.json',
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  refreshCooldownMs = DEFAULT_REFRESH_COOLDOWN_MS,
  maxAutoRefreshAttemptsPerMarker = DEFAULT_MAX_ATTEMPTS_PER_MARKER,
  onStateChange = null,
  onRefreshRequest = null,
  enabled = true,
} = {}) {
  let timerId = null;
  let inFlight = false;
  const persisted = parseJsonStorage(storage, REALITY_SYNC_SESSION_KEY) || {};
  let state = {
    enabled: normalizeBoolean(enabled, true),
    displayedMarker: '',
    displayedTimestamp: '',
    latestMarker: '',
    latestTimestamp: '',
    latestSource: 'unavailable',
    latestTruthAvailable: false,
    isStale: false,
    refreshPending: false,
    lastRefreshReason: '',
    lastRefreshAt: normalizeString(persisted.lastRefreshAt),
    attemptsForCurrentMarker: normalizeNumber(persisted.attemptsForCurrentMarker, 0),
    lastAppliedMarker: normalizeString(persisted.lastAppliedMarker),
    staleSince: '',
  };

  function emitState() {
    onStateChange?.({ ...state });
  }

  function persistSession() {
    writeJsonStorage(storage, REALITY_SYNC_SESSION_KEY, {
      lastAppliedMarker: state.lastAppliedMarker,
      attemptsForCurrentMarker: state.attemptsForCurrentMarker,
      lastRefreshAt: state.lastRefreshAt,
    });
  }

  function patchState(nextState = {}) {
    state = {
      ...state,
      ...nextState,
    };
    emitState();
  }

  function setEnabled(nextEnabled) {
    patchState({ enabled: normalizeBoolean(nextEnabled, true) });
  }

  function updateDisplayedTruth({ marker = '', timestamp = '' } = {}) {
    const nextDisplayedMarker = normalizeString(marker);
    const nextDisplayedTimestamp = normalizeString(timestamp);
    const isStale = evaluateStaleness({
      displayedMarker: nextDisplayedMarker,
      displayedTimestamp: nextDisplayedTimestamp,
      latestMarker: state.latestMarker,
      latestTimestamp: state.latestTimestamp,
    });
    patchState({
      displayedMarker: nextDisplayedMarker,
      displayedTimestamp: nextDisplayedTimestamp,
      isStale,
      refreshPending: false,
      staleSince: isStale ? state.staleSince || new Date(now()).toISOString() : '',
    });
  }

  async function fetchLatestTruth() {
    const [sourceTruthPayload, healthPayload, distMetadataPayload] = await Promise.all([
      fetchJson(fetchImpl, sourceTruthUrl),
      fetchJson(fetchImpl, healthUrl),
      fetchJson(fetchImpl, distMetadataUrl),
    ]);

    const sourceTruth = createFetchResult({
      marker: sourceTruthPayload?.runtimeMarker || sourceTruthPayload?.buildMarker || '',
      timestamp: sourceTruthPayload?.buildTimestamp || sourceTruthPayload?.runtimeBuildTimestamp || '',
      available: sourceTruthPayload != null,
      source: 'source-truth',
    });
    const health = createFetchResult({
      marker: healthPayload?.runtimeMarker || '',
      timestamp: healthPayload?.buildTimestamp || '',
      available: healthPayload != null,
      source: 'health',
    });
    const distMetadata = createFetchResult({
      marker: distMetadataPayload?.runtimeMarker || '',
      timestamp: distMetadataPayload?.buildTimestamp || '',
      available: distMetadataPayload != null,
      source: 'dist-metadata',
    });

    return resolveLatestTruth({
      sourceTruth,
      health,
      distMetadata,
    });
  }

  function canAutoRefreshForMarker(marker) {
    const targetMarker = normalizeString(marker);
    const nowMs = now();
    const lastRefreshMs = toComparableTimestamp(state.lastRefreshAt);
    const markerChanged = targetMarker && targetMarker !== state.lastAppliedMarker;
    const attempts = markerChanged ? 0 : state.attemptsForCurrentMarker;

    if (attempts >= maxAutoRefreshAttemptsPerMarker) {
      return false;
    }

    if (lastRefreshMs != null && (nowMs - lastRefreshMs) < refreshCooldownMs) {
      return false;
    }

    return true;
  }

  function triggerRefresh(reason) {
    const marker = normalizeString(state.latestMarker);
    const markerChanged = marker && marker !== state.lastAppliedMarker;
    const attempts = markerChanged ? 1 : state.attemptsForCurrentMarker + 1;
    const refreshedAt = new Date(now()).toISOString();

    patchState({
      refreshPending: true,
      lastRefreshReason: reason,
      lastRefreshAt: refreshedAt,
      attemptsForCurrentMarker: attempts,
      lastAppliedMarker: marker || state.lastAppliedMarker,
    });
    persistSession();

    if (typeof onRefreshRequest === 'function') {
      onRefreshRequest({ ...state });
      return;
    }

    reload();
  }

  async function checkNow({ reason = 'interval' } = {}) {
    if (inFlight || typeof fetchImpl !== 'function') {
      return { ...state };
    }

    inFlight = true;
    try {
      const latestTruth = await fetchLatestTruth();
      const isStale = evaluateStaleness({
        displayedMarker: state.displayedMarker,
        displayedTimestamp: state.displayedTimestamp,
        latestMarker: latestTruth.marker,
        latestTimestamp: latestTruth.timestamp,
      });

      patchState({
        latestMarker: latestTruth.marker,
        latestTimestamp: latestTruth.timestamp,
        latestSource: latestTruth.source,
        latestTruthAvailable: latestTruth.available,
        isStale,
        staleSince: isStale ? state.staleSince || new Date(now()).toISOString() : '',
      });

      if (state.enabled && isStale && canAutoRefreshForMarker(latestTruth.marker || latestTruth.timestamp)) {
        const refreshReason = `new-truth-detected:${latestTruth.source}:${reason}`;
        triggerRefresh(refreshReason);
      }

      return { ...state };
    } finally {
      inFlight = false;
    }
  }

  function init({ displayedMarker = '', displayedTimestamp = '', enabled: enabledOverride } = {}) {
    if (typeof enabledOverride === 'boolean') {
      state.enabled = enabledOverride;
    }
    updateDisplayedTruth({ marker: displayedMarker, timestamp: displayedTimestamp });
    void checkNow({ reason: 'startup' });

    if (!timerId) {
      timerId = setIntervalImpl(() => {
        void checkNow({ reason: 'poll' });
      }, pollIntervalMs);
    }

    return { ...state };
  }

  function dispose() {
    if (timerId != null) {
      clearIntervalImpl(timerId);
      timerId = null;
    }
  }

  function getState() {
    return { ...state };
  }

  return {
    init,
    dispose,
    getState,
    checkNow,
    setEnabled,
    updateDisplayedTruth,
  };
}
