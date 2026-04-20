import {
  getActiveTileContextHint,
  getAllTileContextSnapshots,
  getSelectedTileContextSnapshot,
} from '../runtime/tileContextRegistry.mjs';
import { buildIdeaContextPackage, buildIdeasKnowledgeDigest } from '../../apps/ideas/ideas-model.js';
import { sanitizeIdeasState } from '../../apps/ideas/ideas-persistence.js';

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

function readIdeasState(runtimeContext = {}, storage) {
  const fromRuntime = runtimeContext?.ideasState;
  if (fromRuntime && typeof fromRuntime === 'object') {
    return sanitizeIdeasState(fromRuntime);
  }

  try {
    const raw = storage?.getItem?.('stephanos.simulationNodes.v1.ideas');
    if (!raw) {
      return { records: [] };
    }

    const parsed = JSON.parse(raw);
    return sanitizeIdeasState(parsed);
  } catch {
    return { records: [] };
  }
}

function extractBoundedRetrieval(runtimeContext = {}, {
  maxExcerpts = 2,
  maxChars = 180,
} = {}) {
  const source = Array.isArray(runtimeContext?.retrievalContext)
    ? runtimeContext.retrievalContext
    : [];

  return source
    .filter((entry) => entry && typeof entry === 'object')
    .slice(0, Math.max(0, Number(maxExcerpts) || 2))
    .map((entry) => ({
      sourceRef: safeString(entry?.provenance?.sourceRef || entry?.sourceRef || ''),
      excerpt: safeString(String(entry.document || '').slice(0, Math.max(32, Number(maxChars) || 180))),
      storageMode: safeString(entry.storageMode || 'unknown'),
    }))
    .filter((entry) => entry.excerpt);
}

export function assembleStephanosContext({
  userPrompt = '',
  runtimeContext = {},
  maxSnapshots = 3,
  storage = globalThis.localStorage,
} = {}) {
  const continuityState = runtimeContext.stephanosContinuity
    && typeof runtimeContext.stephanosContinuity.getState === 'function'
    ? runtimeContext.stephanosContinuity.getState()
    : null;
  const activeHint = getActiveTileContextHint({ storage });
  const activeTileIdFromRuntime = safeString(runtimeContext.activeTileId || continuityState?.workspace?.activeTileId);
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

  const ideasState = readIdeasState(runtimeContext, storage);
  const ideaDigest = buildIdeasKnowledgeDigest(ideasState.records, {
    selectedIdeaId: runtimeContext.selectedIdeaId || '',
  });
  const retrievalExcerpts = extractBoundedRetrieval(runtimeContext);
  const ideaContextPackage = buildIdeaContextPackage(ideasState.records, {
    selectedIdeaId: runtimeContext.selectedIdeaId || ideaDigest?.selectedIdea?.id || '',
    retrievalExcerpts,
    memoryRecords: runtimeContext.memoryContext || [],
  });

  return {
    contextVersion: 2,
    activeTileContext: activeTileSnapshot || null,
    relevantTileContexts: relevantTileSnapshots,
    tileContexts,
    ideasKnowledge: {
      ...ideaDigest,
      retrievalExcerpts,
    },
    ideasContextPackage: ideaContextPackage,
    runtimeTruth: {
      frontendOrigin: safeString(runtimeContext.frontendOrigin),
      target: safeString(runtimeContext.target),
      baseUrl: safeString(runtimeContext.baseUrl),
      routeMode: safeString(runtimeContext.routeMode),
      routeKind: safeString(runtimeContext.routeKind),
      deviceContext: safeString(runtimeContext.deviceContext),
      sessionKind: safeString(runtimeContext.sessionKind),
    },
    continuity: continuityState ? {
      continuityId: safeString(continuityState.session?.continuityId),
      activeWorkspace: safeString(continuityState.workspace?.activeWorkspace),
      activeTileId: safeString(continuityState.workspace?.activeTileId),
      recentEvents: Array.isArray(continuityState.recentEvents) ? continuityState.recentEvents.slice(-5) : [],
      updatedAt: safeString(continuityState.updatedAt),
    } : null,
    diagnostics: {
      activeTileId: activeTileSnapshot?.tileId || activeHint?.tileId || null,
      includedTileIds: tileContexts.map((snapshot) => snapshot.tileId),
      contextCount: tileContexts.length,
      usedTileContextInjection: tileContexts.length > 0,
      selectedFrom: activeTileIdFromRuntime ? 'runtime-context' : (activeHint?.tileId ? 'workspace-hint' : 'none'),
      ideasKnowledgeIncluded: ideaDigest?.diagnostics?.included === true,
      ideasKnowledgeReason: ideaDigest?.diagnostics?.reason || 'none',
      ideaContextPackageIncluded: ideaContextPackage?.included === true,
      retrievalExcerptsIncluded: retrievalExcerpts.length,
    },
  };
}
