const TILE_COGNITION_SCHEMA_VERSION = 'tile-cognition.v2';

function normalizeString(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return [...new Set(tags.map((tag) => normalizeString(tag)).filter(Boolean))];
}

function normalizeTruthMode(value) {
  const normalized = normalizeString(value, 'caravan-source-validated');
  return normalized || 'caravan-source-validated';
}

function createProvenance({
  tileId = '',
  tileSource = 'tile-runtime',
  sourceRef = '',
  operatorReason = '',
  executionPath = 'runtime-bridge',
  truthMode = 'caravan-source-validated',
} = {}) {
  return {
    tileId: normalizeString(tileId),
    tileSource: normalizeString(tileSource, 'tile-runtime'),
    sourceRef: normalizeString(sourceRef),
    operatorReason: normalizeString(operatorReason),
    executionPath: normalizeString(executionPath, 'runtime-bridge'),
    truthMode: normalizeTruthMode(truthMode),
  };
}

function createExecution({
  mode = 'local-fallback',
  adapter = 'unknown',
  adjudication = 'not-run',
  persisted = false,
  diagnostics = {},
} = {}) {
  return {
    mode: normalizeString(mode, 'local-fallback'),
    adapter: normalizeString(adapter, 'unknown'),
    adjudication: normalizeString(adjudication, 'not-run'),
    persisted: persisted === true,
    diagnostics: diagnostics && typeof diagnostics === 'object' ? diagnostics : {},
    occurredAt: new Date().toISOString(),
  };
}

function createTileArtifact({
  tileId,
  tileSource,
  type = 'tile.event',
  payload = {},
  sourceRef = '',
  tags = [],
  retrievalEligible = false,
  operatorReason = '',
} = {}) {
  const normalizedTileId = normalizeString(tileId);
  return {
    schemaVersion: TILE_COGNITION_SCHEMA_VERSION,
    id: `${normalizedTileId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'artifact',
    type: normalizeString(type, 'tile.event'),
    tileId: normalizedTileId,
    payload: payload && typeof payload === 'object' ? payload : {},
    tags: normalizeTags(tags),
    retrievalEligible: retrievalEligible === true,
    timestamp: new Date().toISOString(),
    provenance: createProvenance({ tileId: normalizedTileId, tileSource, sourceRef, operatorReason }),
  };
}

function createMemoryCandidate({
  tileId,
  tileSource,
  candidate = {},
} = {}) {
  const normalizedTileId = normalizeString(tileId);
  return {
    schemaVersion: TILE_COGNITION_SCHEMA_VERSION,
    kind: 'memory-candidate',
    tileId: normalizedTileId,
    key: normalizeString(candidate.key),
    value: candidate?.value,
    type: normalizeString(candidate.type, 'tile.result'),
    importance: normalizeString(candidate.importance, 'normal'),
    confidence: normalizeString(candidate.confidence, 'unknown'),
    relatedIdeaIds: normalizeTags(candidate.relatedIdeaIds),
    tags: normalizeTags(candidate.tags),
    provenance: createProvenance({
      tileId: normalizedTileId,
      tileSource,
      sourceRef: normalizeString(candidate.sourceRef, `tile:${normalizedTileId}`),
      operatorReason: normalizeString(candidate.reason),
      executionPath: 'memory-adjudicator',
    }),
  };
}

function createRetrievalContribution({
  tileId,
  tileSource,
  document = '',
  sourceRef = '',
  tags = [],
  triggerReindex = false,
  allowlisted = false,
  storageMode = 'local-fallback',
  ingestionState = 'blocked',
} = {}) {
  const normalizedTileId = normalizeString(tileId);
  return {
    schemaVersion: TILE_COGNITION_SCHEMA_VERSION,
    id: `${normalizedTileId}-retrieval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'retrieval-contribution',
    tileId: normalizedTileId,
    document: normalizeString(document),
    tags: normalizeTags(tags),
    triggerReindex: triggerReindex === true,
    allowlisted: allowlisted === true,
    ingestionState: normalizeString(ingestionState, 'blocked'),
    storageMode: normalizeString(storageMode, 'local-fallback'),
    ingestedAt: new Date().toISOString(),
    provenance: createProvenance({
      tileId: normalizedTileId,
      tileSource,
      sourceRef: normalizeString(sourceRef, `tile:${normalizedTileId}`),
      executionPath: 'retrieval-gateway',
      truthMode: storageMode === 'shared-backed'
        ? 'implemented-not-battle-bridge-validated'
        : 'caravan-local-fallback',
    }),
  };
}

export {
  TILE_COGNITION_SCHEMA_VERSION,
  createExecution,
  createMemoryCandidate,
  createProvenance,
  createRetrievalContribution,
  createTileArtifact,
  normalizeString,
  normalizeTags,
};
