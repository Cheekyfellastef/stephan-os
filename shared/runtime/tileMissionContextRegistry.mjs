const providers = new Map();

export function registerTileMissionContext(tileId, provider) {
  if (!tileId || typeof provider !== 'function') return;
  providers.set(String(tileId).trim().toLowerCase(), provider);
}

export function getTileMissionContext(tileId, payload = {}) {
  const key = String(tileId || '').trim().toLowerCase();
  const provider = providers.get(key);
  if (!provider) return null;
  return provider(payload);
}

export function getAllTileMissionContexts(payloadByTile = {}) {
  const rows = [];
  providers.forEach((provider, tileId) => {
    rows.push(provider(payloadByTile[tileId] || {}));
  });
  return rows;
}

export function buildMissionConsoleContext({ targetTile = '', payloadByTile = {} } = {}) {
  if (targetTile) {
    return {
      targetTile,
      contexts: [getTileMissionContext(targetTile, payloadByTile[String(targetTile).toLowerCase()] || {})].filter(Boolean),
    };
  }
  return {
    targetTile: 'all',
    contexts: getAllTileMissionContexts(payloadByTile),
  };
}
