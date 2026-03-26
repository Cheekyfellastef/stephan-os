import {
  createTileContextSnapshot,
  isValidTileContextSnapshot,
  normalizeTileContextSnapshot,
} from '../ai/tileContextContract.mjs';

export const TILE_CONTEXT_STORAGE_KEY = 'stephanos.ai.tile-context.registry.v1';
export const ACTIVE_TILE_CONTEXT_STORAGE_KEY = 'stephanos.ai.tile-context.active.v1';

const providerRegistry = new Map();

function readStorage(storage) {
  if (!storage || typeof storage.getItem !== 'function') {
    return {};
  }

  try {
    const raw = storage.getItem(TILE_CONTEXT_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStorage(nextValue = {}, storage = globalThis.localStorage) {
  if (!storage || typeof storage.setItem !== 'function') {
    return false;
  }

  try {
    storage.setItem(TILE_CONTEXT_STORAGE_KEY, JSON.stringify(nextValue));
    return true;
  } catch {
    return false;
  }
}

function writeActiveTileHint(hint = null, storage = globalThis.localStorage) {
  if (!storage || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
    return;
  }

  try {
    if (!hint || typeof hint !== 'object') {
      storage.removeItem(ACTIVE_TILE_CONTEXT_STORAGE_KEY);
      return;
    }

    storage.setItem(ACTIVE_TILE_CONTEXT_STORAGE_KEY, JSON.stringify({
      tileId: String(hint.tileId || '').trim(),
      tileTitle: String(hint.tileTitle || '').trim(),
      tileType: String(hint.tileType || '').trim(),
      source: String(hint.source || 'workspace'),
      lastUpdated: new Date().toISOString(),
    }));
  } catch {
    // best effort only
  }
}

function readActiveTileHint(storage = globalThis.localStorage) {
  if (!storage || typeof storage.getItem !== 'function') {
    return null;
  }

  try {
    const raw = storage.getItem(ACTIVE_TILE_CONTEXT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const tileId = String(parsed.tileId || '').trim();
    if (!tileId) {
      return null;
    }

    return {
      tileId,
      tileTitle: String(parsed.tileTitle || '').trim(),
      tileType: String(parsed.tileType || '').trim(),
      source: String(parsed.source || 'workspace').trim(),
      lastUpdated: String(parsed.lastUpdated || '').trim(),
    };
  } catch {
    return null;
  }
}

export function registerTileContextProvider(tileId, providerFn, options = {}) {
  const normalizedTileId = String(tileId || '').trim();
  if (!normalizedTileId) {
    throw new Error('registerTileContextProvider requires tileId.');
  }

  if (typeof providerFn !== 'function') {
    throw new Error(`registerTileContextProvider requires providerFn for tile ${normalizedTileId}.`);
  }

  providerRegistry.set(normalizedTileId, { providerFn, options });
}

export function unregisterTileContextProvider(tileId) {
  providerRegistry.delete(String(tileId || '').trim());
}

export function publishTileContextSnapshot(tileId, snapshot, { storage = globalThis.localStorage } = {}) {
  const normalizedTileId = String(tileId || '').trim();
  if (!normalizedTileId) {
    throw new Error('publishTileContextSnapshot requires tileId.');
  }

  const context = createTileContextSnapshot({ ...snapshot, tileId: normalizedTileId }, { tileId: normalizedTileId });
  const persisted = readStorage(storage);
  persisted[normalizedTileId] = context;
  writeStorage(persisted, storage);
  return context;
}

export function getTileContextSnapshot(tileId, { storage = globalThis.localStorage } = {}) {
  const normalizedTileId = String(tileId || '').trim();
  if (!normalizedTileId) {
    return null;
  }

  const providerEntry = providerRegistry.get(normalizedTileId);
  if (providerEntry?.providerFn) {
    try {
      const snapshot = providerEntry.providerFn();
      const normalized = createTileContextSnapshot(snapshot, { tileId: normalizedTileId });
      publishTileContextSnapshot(normalizedTileId, normalized, { storage });
      return normalized;
    } catch {
      return null;
    }
  }

  const persisted = readStorage(storage);
  if (!persisted[normalizedTileId]) {
    return null;
  }

  const normalized = normalizeTileContextSnapshot(persisted[normalizedTileId], { tileId: normalizedTileId });
  return isValidTileContextSnapshot(normalized) ? normalized : null;
}

export function getAllTileContextSnapshots({ storage = globalThis.localStorage } = {}) {
  const tileIds = new Set([...providerRegistry.keys(), ...Object.keys(readStorage(storage))]);
  return [...tileIds]
    .map((tileId) => getTileContextSnapshot(tileId, { storage }))
    .filter(Boolean);
}

export function setActiveTileContextHint(hint = {}, { storage = globalThis.localStorage } = {}) {
  writeActiveTileHint(hint, storage);
}

export function clearActiveTileContextHint({ storage = globalThis.localStorage } = {}) {
  writeActiveTileHint(null, storage);
}

export function getActiveTileContextHint({ storage = globalThis.localStorage } = {}) {
  return readActiveTileHint(storage);
}

export function getSelectedTileContextSnapshot({ tileId = '', storage = globalThis.localStorage } = {}) {
  const preferredTileId = String(tileId || '').trim() || getActiveTileContextHint({ storage })?.tileId || '';
  return preferredTileId ? getTileContextSnapshot(preferredTileId, { storage }) : null;
}
