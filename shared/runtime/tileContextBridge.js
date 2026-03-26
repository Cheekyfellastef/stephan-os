(function (global) {
  const REGISTRY_KEY = 'stephanos.ai.tile-context.registry.v1';

  function readRegistry() {
    try {
      const raw = global.localStorage?.getItem(REGISTRY_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function publishTileContextSnapshot(tileId, snapshot) {
    const normalizedTileId = String(tileId || '').trim();
    if (!normalizedTileId) {
      return null;
    }

    const nextSnapshot = {
      tileId: normalizedTileId,
      tileTitle: String(snapshot?.tileTitle || normalizedTileId).trim(),
      tileType: String(snapshot?.tileType || 'simulation').trim(),
      contextVersion: Number(snapshot?.contextVersion) || 1,
      summary: String(snapshot?.summary || '').trim(),
      structuredData: snapshot?.structuredData && typeof snapshot.structuredData === 'object' ? snapshot.structuredData : {},
      visibility: String(snapshot?.visibility || 'workspace').trim(),
      lastUpdated: new Date().toISOString(),
    };

    try {
      const registry = readRegistry();
      registry[normalizedTileId] = nextSnapshot;
      global.localStorage?.setItem(REGISTRY_KEY, JSON.stringify(registry));
      return nextSnapshot;
    } catch {
      return null;
    }
  }

  global.StephanosTileContextBridge = {
    publishTileContextSnapshot,
    readRegistry,
    storageKey: REGISTRY_KEY,
  };
})(window);
