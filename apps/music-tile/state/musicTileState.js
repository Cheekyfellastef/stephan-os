const STORAGE_KEY = 'stephanos.musicTile.state.v1';
const SCHEMA_VERSION = 1;
const APP_ID = 'music-tile';
const LOG_PREFIX = '[TILE DATA][music-tile]';
let hydrationCompleted = false;

export function __resetMusicTileStateTestHooks() {
  hydrationCompleted = false;
}

export const DEFAULT_SELECTION = {
  era: 'afterlife-modern',
  energyCurve: 'rising',
  emotion: 'transcendent',
  density: 'layered'
};

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function sanitizeSelection(value) {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_SELECTION };
  }

  const next = { ...DEFAULT_SELECTION };

  if (typeof value.era === 'string') next.era = value.era;
  if (typeof value.energyCurve === 'string') next.energyCurve = value.energyCurve;
  if (typeof value.emotion === 'string') next.emotion = value.emotion;
  if (typeof value.density === 'string') next.density = value.density;

  return next;
}

export function loadMusicTileState() {
  const tileDataClient = window.StephanosTileDataContract?.client;
  if (tileDataClient?.loadDurableState) {
    return tileDataClient.loadDurableState({
      appId: APP_ID,
      schemaVersion: SCHEMA_VERSION,
      defaultState: {
        version: SCHEMA_VERSION,
        selection: { ...DEFAULT_SELECTION }
      },
      sanitizeState: (value) => ({
        version: SCHEMA_VERSION,
        selection: sanitizeSelection(value?.selection)
      }),
      legacyKeys: [STORAGE_KEY],
    }).then((response) => {
      hydrationCompleted = true;
      console.info(LOG_PREFIX, 'load', {
        appId: APP_ID,
        sourceUsedOnLoad: response?.source || 'unknown',
        backendUrlResolved: tileDataClient.apiBaseUrl || '',
        backendLoadSucceeded: response?.source === 'shared-backend',
        localFallbackUsed: response?.source !== 'shared-backend',
        localFallbackReason: response?.source === 'default-state'
          ? 'defaults'
          : (response?.source || ''),
        sharedDataOverwrittenByDefaults: false
      });
      return {
        ...response.state,
        __tileDataMeta: {
          source: response?.source || 'unknown',
          diagnostics: response?.diagnostics || null
        }
      };
    });
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    hydrationCompleted = true;
    return Promise.resolve({
      version: SCHEMA_VERSION,
      selection: { ...DEFAULT_SELECTION }
    });
  }

  const parsed = safeParse(raw);
  if (!parsed || parsed.version !== SCHEMA_VERSION) {
    hydrationCompleted = true;
    return Promise.resolve({
      version: SCHEMA_VERSION,
      selection: { ...DEFAULT_SELECTION }
    });
  }

  hydrationCompleted = true;
  return Promise.resolve({
    version: SCHEMA_VERSION,
    selection: sanitizeSelection(parsed.selection),
    __tileDataMeta: {
      source: 'legacy-local-fallback',
      diagnostics: null
    }
  });
}

export function saveMusicTileState(selection) {
  const payload = {
    version: SCHEMA_VERSION,
    selection: sanitizeSelection(selection)
  };

  if (!hydrationCompleted) {
    console.info(LOG_PREFIX, 'save-skipped', {
      appId: APP_ID,
      reason: 'hydration-incomplete'
    });
    return payload;
  }

  const tileDataClient = window.StephanosTileDataContract?.client;
  if (tileDataClient?.saveDurableState) {
    void tileDataClient.saveDurableState({
      appId: APP_ID,
      schemaVersion: SCHEMA_VERSION,
      state: payload,
      sanitizeState: (value) => ({
        version: SCHEMA_VERSION,
        selection: sanitizeSelection(value?.selection)
      }),
    }).then((response) => {
      console.info(LOG_PREFIX, 'save', {
        appId: APP_ID,
        sourceUsedOnSave: response?.source || 'unknown',
        backendUrlResolved: tileDataClient.apiBaseUrl || '',
        backendSaveSucceeded: Boolean(response?.ok),
        savePayloadSummary: { keys: Object.keys(payload.selection || {}) }
      });
    });
    return payload;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function resetMusicTileState() {
  if (!hydrationCompleted) {
    console.info(LOG_PREFIX, 'reset-skipped', {
      appId: APP_ID,
      reason: 'hydration-incomplete'
    });
    return {
      version: SCHEMA_VERSION,
      selection: { ...DEFAULT_SELECTION }
    };
  }
  const tileDataClient = window.StephanosTileDataContract?.client;
  if (tileDataClient?.saveDurableState) {
    tileDataClient.saveDurableState({
      appId: APP_ID,
      schemaVersion: SCHEMA_VERSION,
      state: {
        version: SCHEMA_VERSION,
        selection: { ...DEFAULT_SELECTION }
      },
      sanitizeState: (value) => ({
        version: SCHEMA_VERSION,
        selection: sanitizeSelection(value?.selection)
      }),
    });
  }

  window.localStorage.removeItem(STORAGE_KEY);
  return {
    version: SCHEMA_VERSION,
    selection: { ...DEFAULT_SELECTION }
  };
}
