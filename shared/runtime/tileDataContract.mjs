const DEFAULT_BACKEND_PORT = 8787;
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

function detectApiBaseUrl(locationObj = globalThis.location) {
  const explicit = normalizeString(globalThis.__STEPHANOS_BACKEND_BASE_URL || '');
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }

  const origin = normalizeString(locationObj?.origin || '');
  const hostname = normalizeString(locationObj?.hostname || '').toLowerCase();
  const port = normalizeString(locationObj?.port || '');

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    if (port && Number(port) !== DEFAULT_BACKEND_PORT) {
      return `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`;
    }
  }

  return origin;
}

function createMirrorStorageKey(appId) {
  return `${SHARED_TILE_MIRROR_PREFIX}.${normalizeString(appId, 'unknown')}`;
}

export function createStephanosTileDataClient({
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
  locationObj = globalThis.location,
  logger = console,
} = {}) {
  const apiBaseUrl = detectApiBaseUrl(locationObj);

  function log(event, payload = {}) {
    const target = logger && typeof logger.info === 'function' ? logger : console;
    target.info('[Stephanos TileData]', event, payload);
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
      return { ok: false, status: 0, json: null, diagnostics: { reason: 'fetch-or-api-base-unavailable' } };
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

    const mirrorKey = createMirrorStorageKey(normalizedAppId);
    writeLocalState(mirrorKey, payload);

    log('save', {
      appId: normalizedAppId,
      source: response.ok ? 'shared-backend' : 'local-mirror-fallback',
      status: response.status,
      apiBaseUrl,
    });

    return {
      ok: response.ok,
      state: sanitizedState,
      source: response.ok ? 'shared-backend' : 'local-mirror-fallback',
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
  } = {}) {
    const normalizedAppId = normalizeString(appId);
    if (!normalizedAppId) {
      throw new Error('loadDurableState requires appId.');
    }

    const response = await requestTileState(`/api/tile-state/${encodeURIComponent(normalizedAppId)}`);
    const remoteState = response.json?.data?.state;
    if (response.ok && remoteState && typeof remoteState === 'object') {
      const sanitizedState = sanitizeState(remoteState);
      writeLocalState(createMirrorStorageKey(normalizedAppId), {
        schemaVersion,
        state: sanitizedState,
      });
      log('load', { appId: normalizedAppId, source: 'shared-backend', status: response.status, apiBaseUrl });
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
      if (migrateLegacy) {
        const migration = await saveDurableState({
          appId: normalizedAppId,
          state: sanitizedLegacy,
          schemaVersion,
          sanitizeState,
        });
        migrationSaved = migration.ok;
      }

      log('legacy-detected', {
        appId: normalizedAppId,
        legacyKey: detectedLegacy,
        migrated: migrationSaved,
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
    if (mirrorState?.state && typeof mirrorState.state === 'object') {
      const sanitizedMirror = sanitizeState(mirrorState.state);
      log('load', { appId: normalizedAppId, source: 'local-mirror-fallback', status: response.status, apiBaseUrl });
      return {
        state: sanitizedMirror,
        source: 'local-mirror-fallback',
        migrated: false,
        diagnostics: response.diagnostics,
      };
    }

    const sanitizedDefault = sanitizeState(defaultState);
    log('load', { appId: normalizedAppId, source: 'default-state', status: response.status, apiBaseUrl });
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
