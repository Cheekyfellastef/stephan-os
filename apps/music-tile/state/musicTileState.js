const STORAGE_KEY = 'stephanos.musicTile.state.v2';
const LEGACY_STORAGE_KEY = 'stephanos.musicTile.state.v1';
const SCHEMA_VERSION = 2;
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
  density: 'layered',
};

export const DEFAULT_MUSIC_MEMORY = {
  artists: [],
  mediaItems: {},
  sourceChannels: {},
  ratings: [],
  channelTrust: {},
  artistAffinity: {},
  seenItemIds: [],
  savedItemIds: [],
  ignoredItemIds: [],
  discoveryJobs: [],
  sessions: [],
};

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function sanitizeSelection(value) {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SELECTION };
  const next = { ...DEFAULT_SELECTION };
  if (typeof value.era === 'string') next.era = value.era;
  if (typeof value.energyCurve === 'string') next.energyCurve = value.energyCurve;
  if (typeof value.emotion === 'string') next.emotion = value.emotion;
  if (typeof value.density === 'string') next.density = value.density;
  return next;
}

function sanitizeMemory(value) {
  if (!value || typeof value !== 'object') return { ...DEFAULT_MUSIC_MEMORY };
  return {
    artists: Array.isArray(value.artists) ? value.artists : [],
    mediaItems: value.mediaItems && typeof value.mediaItems === 'object' ? value.mediaItems : {},
    sourceChannels: value.sourceChannels && typeof value.sourceChannels === 'object' ? value.sourceChannels : {},
    ratings: Array.isArray(value.ratings) ? value.ratings : [],
    channelTrust: value.channelTrust && typeof value.channelTrust === 'object' ? value.channelTrust : {},
    artistAffinity: value.artistAffinity && typeof value.artistAffinity === 'object' ? value.artistAffinity : {},
    seenItemIds: Array.isArray(value.seenItemIds) ? value.seenItemIds : [],
    savedItemIds: Array.isArray(value.savedItemIds) ? value.savedItemIds : [],
    ignoredItemIds: Array.isArray(value.ignoredItemIds) ? value.ignoredItemIds : [],
    discoveryJobs: Array.isArray(value.discoveryJobs) ? value.discoveryJobs : [],
    sessions: Array.isArray(value.sessions) ? value.sessions : [],
  };
}

function sanitizeState(value) {
  return {
    version: SCHEMA_VERSION,
    selection: sanitizeSelection(value?.selection),
    memory: sanitizeMemory(value?.memory),
  };
}

function buildDefaultState() {
  return {
    version: SCHEMA_VERSION,
    selection: { ...DEFAULT_SELECTION },
    memory: { ...DEFAULT_MUSIC_MEMORY },
  };
}

export function loadMusicTileState() {
  const tileDataClient = window.StephanosTileDataContract?.client;
  if (tileDataClient?.loadDurableState) {
    return tileDataClient.loadDurableState({
      appId: APP_ID,
      schemaVersion: SCHEMA_VERSION,
      defaultState: buildDefaultState(),
      sanitizeState,
      legacyKeys: [STORAGE_KEY, LEGACY_STORAGE_KEY],
    }).then((response) => {
      hydrationCompleted = true;
      console.info(LOG_PREFIX, 'load', {
        appId: APP_ID,
        sourceUsedOnLoad: response?.source || 'unknown',
      });
      return {
        ...sanitizeState(response.state),
        __tileDataMeta: {
          source: response?.source || 'unknown',
          diagnostics: response?.diagnostics || null,
        },
      };
    });
  }

  const raw = window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) {
    hydrationCompleted = true;
    return Promise.resolve(buildDefaultState());
  }

  const parsed = safeParse(raw);
  hydrationCompleted = true;
  return Promise.resolve({
    ...sanitizeState(parsed),
    __tileDataMeta: {
      source: 'legacy-local-fallback',
      diagnostics: null,
    },
  });
}

export function saveMusicTileState(nextState) {
  const payload = sanitizeState(nextState);

  if (!hydrationCompleted) {
    console.info(LOG_PREFIX, 'save-skipped', { appId: APP_ID, reason: 'hydration-incomplete' });
    return payload;
  }

  const tileDataClient = window.StephanosTileDataContract?.client;
  if (tileDataClient?.saveDurableState) {
    void tileDataClient.saveDurableState({
      appId: APP_ID,
      schemaVersion: SCHEMA_VERSION,
      state: payload,
      sanitizeState,
    });
    return payload;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function resetMusicTileState() {
  const resetState = buildDefaultState();
  if (!hydrationCompleted) {
    return resetState;
  }

  const tileDataClient = window.StephanosTileDataContract?.client;
  if (tileDataClient?.saveDurableState) {
    void tileDataClient.saveDurableState({
      appId: APP_ID,
      schemaVersion: SCHEMA_VERSION,
      state: resetState,
      sanitizeState,
    });
  }

  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  return resetState;
}

function clampAffinity(value) {
  return Math.max(-5, Math.min(5, Number(value.toFixed(2))));
}

function ensureUnique(list, value) {
  if (!list.includes(value)) list.push(value);
}

export function applyRatingToMemory(memory, mediaItemId, rating, note = '') {
  const numericRating = Math.max(-5, Math.min(5, Number(rating) || 0));
  const next = sanitizeMemory(memory);
  const mediaItem = next.mediaItems[mediaItemId];
  if (!mediaItem) return next;

  mediaItem.score = numericRating;
  mediaItem.saved = numericRating >= 3;
  mediaItem.ignored = numericRating <= -3;

  ensureUnique(next.seenItemIds, mediaItemId);
  if (mediaItem.saved) ensureUnique(next.savedItemIds, mediaItemId);
  if (mediaItem.ignored) ensureUnique(next.ignoredItemIds, mediaItemId);

  next.ratings.push({
    mediaItemId,
    rating: numericRating,
    timestamp: new Date().toISOString(),
    note,
    derivedSignals: {
      artistAffinityDelta: numericRating * 0.2,
      channelAffinityDelta: numericRating * 0.25,
      eventAffinityDelta: numericRating * 0.15,
    },
  });

  (mediaItem.detectedArtists || []).forEach((artistName) => {
    const current = next.artistAffinity[artistName] || 0;
    next.artistAffinity[artistName] = clampAffinity(current + numericRating * 0.2);
  });

  const currentTrust = next.channelTrust[mediaItem.channelId] || 0;
  next.channelTrust[mediaItem.channelId] = clampAffinity(currentTrust + numericRating * 0.25);
  next.sourceChannels[mediaItem.channelId] = {
    id: mediaItem.channelId,
    name: mediaItem.channelName,
    trustScore: next.channelTrust[mediaItem.channelId],
    tags: next.sourceChannels[mediaItem.channelId]?.tags || [],
    lastSeen: new Date().toISOString(),
  };

  return next;
}

export function upsertMediaItems(memory, items) {
  const next = sanitizeMemory(memory);
  items.forEach((item) => {
    const current = next.mediaItems[item.id] || {};
    const seen = next.seenItemIds.includes(item.id);
    next.mediaItems[item.id] = {
      ...current,
      ...item,
      seen,
      saved: next.savedItemIds.includes(item.id),
      ignored: next.ignoredItemIds.includes(item.id),
    };

    if (item.channelId) {
      next.sourceChannels[item.channelId] = {
        id: item.channelId,
        name: item.channelName,
        trustScore: next.channelTrust[item.channelId] || 0,
        tags: next.sourceChannels[item.channelId]?.tags || [],
        lastSeen: new Date().toISOString(),
      };
    }
  });

  return next;
}
