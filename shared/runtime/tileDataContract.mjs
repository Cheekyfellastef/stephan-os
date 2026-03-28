import {
  readPersistedStephanosHomeNode,
  readPersistedStephanosLastKnownNode,
  resolveStephanosBackendBaseUrl,
} from './stephanosHomeNode.mjs';

const SHARED_TILE_MIRROR_PREFIX = 'stephanos.tile.shared.mirror.v1';

function normalizeString(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function safeJsonParse(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isStorageAvailable(storage) {
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function';
}

function detectApiBaseUrl({ locationObj = globalThis.location, storage, explicitBaseUrl = globalThis.__STEPHANOS_BACKEND_BASE_URL } = {}) {
  return resolveStephanosBackendBaseUrl({
    currentOrigin: normalizeString(locationObj?.origin || ''),
    manualNode: readPersistedStephanosHomeNode(storage),
    lastKnownNode: readPersistedStephanosLastKnownNode(storage),
    explicitBaseUrl: normalizeString(explicitBaseUrl || ''),
  }).replace(/\/$/, '');
}

function createMirrorStorageKey(appId) {
  return `${SHARED_TILE_MIRROR_PREFIX}.${normalizeString(appId, 'unknown')}`;
}

function summarizeState(value) {
  if (!value || typeof value !== 'object') {
    return { type: typeof value };
  }

  return {
    keys: Object.keys(value),
    approxBytes: JSON.stringify(value).length,
  };
}

function hasObjectState(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isLoopbackHostname(hostname = '') {
  const normalized = String(hostname || '').trim().toLowerCase();
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(normalized);
}

export function createStephanosTileDataClient({
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
  locationObj = globalThis.location,
  logger = console,
  explicitBaseUrl = globalThis.__STEPHANOS_BACKEND_BASE_URL,
} = {}) {
  const apiBaseUrl = detectApiBaseUrl({ locationObj, storage, explicitBaseUrl });
  const defaultAllowMirrorFallback = isLoopbackHostname(locationObj?.hostname || '');

  function log(event, payload = {}) {
    const target = logger && typeof logger.info === 'function' ? logger : console;
    target.info('[TILE DATA]', event, payload);
  }

  function readLocalState(key) {
    if (!isStorageAvailable(storage)) {
      return null;
    }

    return safeJsonParse(storage.getItem(key));
  }

  function writeLocalState(key, value) {
    if (!isStorageAvailable(storage)) {
      return;
    }

    if (value == null) {
      storage.removeItem(key);
      return;
    }

    storage.setItem(key, JSON.stringify(value));
  }

  async function requestTileState(path, { method = 'GET', body } = {}) {
    if (typeof fetchImpl !== 'function' || !apiBaseUrl) {
      return {
        ok: false,
        status: 0,
        json: null,
        diagnostics: {
          reason: 'fetch-or-api-base-unavailable',
          method,
          path,
          apiBaseUrl,
        },
      };
    }

    try {
      const response = await fetchImpl(`${apiBaseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: body == null ? undefined : JSON.stringify(body),
      });

      const text = await response.text();
      const json = safeJsonParse(text) || null;
      return {
        ok: response.ok,
        status: response.status,
        json,
        diagnostics: {
          method,
          path,
          apiBaseUrl,
          status: response.status,
        },
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        json: null,
        diagnostics: {
          method,
          path,
          apiBaseUrl,
          error: normalizeString(error?.message, 'request-failed'),
        },
      };
    }
  }

  async function saveDurableState({ appId, state, schemaVersion = 1, sanitizeState = (value) => value } = {}) {
    const normalizedAppId = normalizeString(appId);
    if (!normalizedAppId) {
      throw new Error('saveDurableState requires appId.');
    }

    const sanitizedState = sanitizeState(state);
    const payload = {
      schemaVersion: Number(schemaVersion) || 1,
      state: sanitizedState,
      source: 'tile-runtime',
    };

    const response = await requestTileState(`/api/tile-state/${encodeURIComponent(normalizedAppId)}`, {
      method: 'PUT',
      body: payload,
    });

    const source = response.ok ? 'shared-backend' : 'local-mirror-fallback';
    if (response.ok) {
      const mirrorKey = createMirrorStorageKey(normalizedAppId);
      writeLocalState(mirrorKey, payload);
    }
    log('save', {
      appId: normalizedAppId,
      sourceUsedOnSave: source,
      backendUrlResolved: apiBaseUrl,
      backendSaveSucceeded: response.ok,
      localFallbackUsed: !response.ok,
      localFallbackReason: response.ok ? '' : (response.diagnostics?.error || `http-${response.status || 0}`),
      savePayloadSummary: summarizeState(sanitizedState),
      diagnostics: response.diagnostics,
    });

    return {
      ok: response.ok,
      state: sanitizedState,
      source,
      diagnostics: response.diagnostics,
    };
  }

  async function loadDurableState({
    appId,
    defaultState,
    sanitizeState = (value) => value,
    legacyKeys = [],
    schemaVersion = 1,
    migrateLegacy = true,
    allowMirrorFallback = defaultAllowMirrorFallback,
  } = {}) {
    const normalizedAppId = normalizeString(appId);
    if (!normalizedAppId) {
      throw new Error('loadDurableState requires appId.');
    }

    const response = await requestTileState(`/api/tile-state/${encodeURIComponent(normalizedAppId)}`);
    const remoteState = response.json?.data?.state;
    if (response.ok && hasObjectState(remoteState)) {
      const sanitizedState = sanitizeState(remoteState);
      writeLocalState(createMirrorStorageKey(normalizedAppId), {
        schemaVersion,
        state: sanitizedState,
      });
      log('load', {
        appId: normalizedAppId,
        sourceUsedOnLoad: 'shared-backend',
        backendUrlResolved: apiBaseUrl,
        backendLoadSucceeded: true,
        localFallbackUsed: false,
        sharedDataOverwrittenByDefaults: false,
        diagnostics: response.diagnostics,
      });
      return {
        state: sanitizedState,
        source: 'shared-backend',
        migrated: false,
        diagnostics: response.diagnostics,
      };
    }

    const legacyStorage = isStorageAvailable(storage) ? storage : null;
    const detectedLegacy = (legacyKeys || []).find((key) => safeJsonParse(legacyStorage?.getItem(key || '')));
    if (detectedLegacy) {
      const legacyRaw = safeJsonParse(legacyStorage.getItem(detectedLegacy));
      const sanitizedLegacy = sanitizeState(legacyRaw);
      let migrationSaved = false;
      if (migrateLegacy && response.status === 404) {
        const migration = await saveDurableState({
          appId: normalizedAppId,
          state: sanitizedLegacy,
          schemaVersion,
          sanitizeState,
        });
        migrationSaved = migration.ok;
      }

      log('load', {
        appId: normalizedAppId,
        sourceUsedOnLoad: migrationSaved ? 'legacy-migration' : 'local-fallback',
        backendUrlResolved: apiBaseUrl,
        backendLoadSucceeded: response.ok,
        localFallbackUsed: true,
        localFallbackReason: migrationSaved ? 'legacy-migrated-after-backend-404' : 'legacy-detected-without-authoritative-backend-slot',
        legacyKey: detectedLegacy,
        sharedDataOverwrittenByDefaults: false,
        diagnostics: response.diagnostics,
      });

      return {
        state: sanitizedLegacy,
        source: migrationSaved ? 'legacy-migrated-to-shared-backend' : 'legacy-local-fallback',
        migrated: migrationSaved,
        legacyKey: detectedLegacy,
        diagnostics: response.diagnostics,
      };
    }

    const mirrorState = readLocalState(createMirrorStorageKey(normalizedAppId));
    if (allowMirrorFallback && hasObjectState(mirrorState?.state)) {
      const sanitizedMirror = sanitizeState(mirrorState.state);
      log('load', {
        appId: normalizedAppId,
        sourceUsedOnLoad: 'local-fallback',
        backendUrlResolved: apiBaseUrl,
        backendLoadSucceeded: response.ok,
        localFallbackUsed: true,
        localFallbackReason: response.diagnostics?.error || `http-${response.status || 0}`,
        sharedDataOverwrittenByDefaults: false,
        diagnostics: response.diagnostics,
      });
      return {
        state: sanitizedMirror,
        source: 'local-mirror-fallback',
        migrated: false,
        diagnostics: response.diagnostics,
      };
    }

    const sanitizedDefault = sanitizeState(defaultState);
    log('load', {
      appId: normalizedAppId,
      sourceUsedOnLoad: 'defaults',
      backendUrlResolved: apiBaseUrl,
      backendLoadSucceeded: false,
      localFallbackUsed: !allowMirrorFallback,
      localFallbackReason: response.diagnostics?.error || `http-${response.status || 0}`,
      sharedDataOverwrittenByDefaults: false,
      diagnostics: response.diagnostics,
    });
    return {
      state: sanitizedDefault,
      source: 'default-state',
      migrated: false,
      diagnostics: response.diagnostics,
    };
  }

  return {
    apiBaseUrl,
    saveDurableState,
    loadDurableState,
  };
}

const globalClient = createStephanosTileDataClient();
if (typeof globalThis !== 'undefined') {
  globalThis.StephanosTileDataContract = {
    createStephanosTileDataClient,
    client: globalClient,
  };
}
