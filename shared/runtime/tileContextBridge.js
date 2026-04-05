(function (global) {
  const REGISTRY_KEY = 'stephanos.ai.tile-context.registry.v1';
  const RETRIEVAL_KEY_PREFIX = 'stephanos.retrieval.tile-corpus.v1.';

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

  function readRetrievalCorpus(tileId) {
    const normalizedTileId = String(tileId || '').trim();
    if (!normalizedTileId) {
      return [];
    }

    try {
      const raw = global.localStorage?.getItem(`${RETRIEVAL_KEY_PREFIX}${normalizedTileId}`);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
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

  function resolveExecutionLoopTarget() {
    if (global.StephanosExecutionLoop && typeof global.StephanosExecutionLoop.publishTileEvent === 'function') {
      return global.StephanosExecutionLoop;
    }

    const parentWindow = global.parent;
    if (parentWindow && parentWindow !== global && parentWindow.StephanosExecutionLoop && typeof parentWindow.StephanosExecutionLoop.publishTileEvent === 'function') {
      return parentWindow.StephanosExecutionLoop;
    }

    return null;
  }

  function fetchTileContextBundle({ tileId = '', includeRetrieval = false, memoryLimit = 8, retrievalLimit = 4 } = {}) {
    const normalizedTileId = String(tileId || '').trim();
    const registry = readRegistry();
    const tileSnapshot = normalizedTileId ? (registry[normalizedTileId] || null) : null;

    const memoryRecords = global.parent?.stephanosMemory?.listRecords
      ? global.parent.stephanosMemory.listRecords({ tag: normalizedTileId ? `tile.${normalizedTileId}` : undefined }).slice(0, Math.max(1, Number(memoryLimit) || 8))
      : [];

    const retrieval = includeRetrieval
      ? readRetrievalCorpus(normalizedTileId).slice(0, Math.max(1, Number(retrievalLimit) || 4))
      : [];

    return {
      tileId: normalizedTileId,
      tileSnapshot,
      memoryRecords,
      retrieval,
      runtimeTruth: {
        source: global.parent?.stephanosMemory ? 'shared-runtime' : 'tile-local',
        includeRetrieval: includeRetrieval === true,
      },
      fetchedAt: new Date().toISOString(),
    };
  }

  function publishTileExecutionEvent(tileId, payload = {}) {
    const normalizedTileId = String(tileId || '').trim();
    if (!normalizedTileId) {
      return {
        ok: false,
        reason: 'tile-id-required',
      };
    }

    const eventPayload = {
      tileId: normalizedTileId,
      tileTitle: String(payload.tileTitle || normalizedTileId).trim(),
      action: String(payload.action || 'unknown').trim(),
      summary: String(payload.summary || '').trim(),
      result: payload.result && typeof payload.result === 'object' ? payload.result : {},
      tags: Array.isArray(payload.tags) ? payload.tags : [],
      source: String(payload.source || 'tile-runtime').trim(),
      timestamp: new Date().toISOString(),
    };

    const loopTarget = resolveExecutionLoopTarget();
    if (loopTarget) {
      loopTarget.publishTileEvent(eventPayload);
      return {
        ok: true,
        mode: 'execution-loop-bridge',
      };
    }

    try {
      if (global.parent && global.parent !== global && typeof global.parent.postMessage === 'function') {
        global.parent.postMessage({
          type: 'stephanos:tile-execution-event',
          payload: eventPayload,
        }, '*');
        return {
          ok: true,
          mode: 'post-message-bridge',
        };
      }
    } catch {
      // no-op
    }

    return {
      ok: false,
      reason: 'execution-loop-unavailable',
    };
  }

  global.StephanosTileContextBridge = {
    publishTileContextSnapshot,
    publishTileExecutionEvent,
    fetchTileContextBundle,
    readRegistry,
    storageKey: REGISTRY_KEY,
  };
})(window);
