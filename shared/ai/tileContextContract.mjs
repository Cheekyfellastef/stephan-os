const DEFAULT_CONTEXT_VERSION = 1;
const DEFAULT_TILE_TYPE = 'unknown';
const DEFAULT_VISIBILITY = 'workspace';

function safeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function safeIsoDate(value) {
  const candidate = safeString(value);
  if (!candidate) {
    return new Date().toISOString();
  }

  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function safeStructuredData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value;
}

export function normalizeTileContextSnapshot(input = {}, fallback = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};

  const tileId = safeString(source.tileId) || safeString(fallbackSource.tileId);

  return {
    tileId,
    tileTitle: safeString(source.tileTitle) || safeString(fallbackSource.tileTitle) || tileId || 'Untitled Tile',
    tileType: safeString(source.tileType) || safeString(fallbackSource.tileType) || DEFAULT_TILE_TYPE,
    contextVersion: Number.isFinite(Number(source.contextVersion))
      ? Number(source.contextVersion)
      : (Number.isFinite(Number(fallbackSource.contextVersion)) ? Number(fallbackSource.contextVersion) : DEFAULT_CONTEXT_VERSION),
    summary: safeString(source.summary) || safeString(fallbackSource.summary),
    structuredData: safeStructuredData(source.structuredData),
    lastUpdated: safeIsoDate(source.lastUpdated || fallbackSource.lastUpdated),
    visibility: safeString(source.visibility) || safeString(fallbackSource.visibility) || DEFAULT_VISIBILITY,
  };
}

export function isValidTileContextSnapshot(snapshot = {}) {
  const normalized = normalizeTileContextSnapshot(snapshot);
  return Boolean(normalized.tileId);
}

export function createTileContextSnapshot(input = {}, fallback = {}) {
  const normalized = normalizeTileContextSnapshot(input, fallback);
  if (!normalized.tileId) {
    throw new Error('Tile context snapshot requires a non-empty tileId.');
  }

  return normalized;
}

export const TILE_CONTEXT_CONTRACT_VERSION = DEFAULT_CONTEXT_VERSION;
export const TILE_CONTEXT_VISIBILITY = Object.freeze({
  WORKSPACE: 'workspace',
  PRIVATE: 'private',
  SHARED: 'shared',
});
