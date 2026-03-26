import {
  getActiveTileContextHint,
  getAllTileContextSnapshots,
  getSelectedTileContextSnapshot,
} from '../runtime/tileContextRegistry.mjs';

function safeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function buildKeywordSet(prompt = '') {
  return new Set(
    safeString(prompt)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((word) => word.trim())
      .filter((word) => word.length > 2),
  );
}

function computeRelevanceScore(snapshot = {}, keywords = new Set()) {
  if (!keywords.size) {
    return 0;
  }

  const haystack = [snapshot.tileId, snapshot.tileTitle, snapshot.tileType, snapshot.summary]
    .join(' ')
    .toLowerCase();

  let score = 0;
  keywords.forEach((keyword) => {
    if (haystack.includes(keyword)) {
      score += 1;
    }
  });

  return score;
}

function limitTileContexts(contexts = [], maxSnapshots = 3) {
  return contexts.slice(0, Math.max(1, Number(maxSnapshots) || 3));
}

export function assembleStephanosContext({
  userPrompt = '',
  runtimeContext = {},
  maxSnapshots = 3,
  storage = globalThis.localStorage,
} = {}) {
  const activeHint = getActiveTileContextHint({ storage });
  const activeTileIdFromRuntime = safeString(runtimeContext.activeTileId);
  const activeTileSnapshot = getSelectedTileContextSnapshot({
    tileId: activeTileIdFromRuntime || activeHint?.tileId || '',
    storage,
  });

  const allSnapshots = getAllTileContextSnapshots({ storage });
  const keywords = buildKeywordSet(userPrompt);
  const relevantCandidates = allSnapshots
    .filter((snapshot) => snapshot.tileId !== activeTileSnapshot?.tileId)
    .map((snapshot) => ({
      snapshot,
      score: computeRelevanceScore(snapshot, keywords),
    }))
    .filter((candidate) => candidate.score > 0 || keywords.size === 0)
    .sort((a, b) => b.score - a.score || String(b.snapshot.lastUpdated || '').localeCompare(String(a.snapshot.lastUpdated || '')))
    .map((candidate) => candidate.snapshot);

  const relevantTileSnapshots = limitTileContexts(relevantCandidates, maxSnapshots);

  const tileContexts = [activeTileSnapshot, ...relevantTileSnapshots].filter(Boolean);

  return {
    contextVersion: 1,
    activeTileContext: activeTileSnapshot || null,
    relevantTileContexts: relevantTileSnapshots,
    tileContexts,
    runtimeTruth: {
      frontendOrigin: safeString(runtimeContext.frontendOrigin),
      target: safeString(runtimeContext.target),
      baseUrl: safeString(runtimeContext.baseUrl),
      routeMode: safeString(runtimeContext.routeMode),
      routeKind: safeString(runtimeContext.routeKind),
      deviceContext: safeString(runtimeContext.deviceContext),
      sessionKind: safeString(runtimeContext.sessionKind),
    },
    diagnostics: {
      activeTileId: activeTileSnapshot?.tileId || activeHint?.tileId || null,
      includedTileIds: tileContexts.map((snapshot) => snapshot.tileId),
      contextCount: tileContexts.length,
      usedTileContextInjection: tileContexts.length > 0,
      selectedFrom: activeTileIdFromRuntime ? 'runtime-context' : (activeHint?.tileId ? 'workspace-hint' : 'none'),
    },
  };
}
