import { createTileTruthAdapter } from './tileTruthAdapter.js';

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

function defaultArtifactStorageKey(tileId) {
  return `stephanos.tile.artifacts.v1.${normalizeString(tileId, 'unknown')}`;
}

export function createTileEventBridge({
  tileId,
  tileSource = 'tile-runtime',
  storage = globalThis.localStorage,
  executionLoop = globalThis.StephanosExecutionLoop,
  memoryGateway = globalThis.stephanosMemoryGateway,
  truthAdapter = createTileTruthAdapter(),
} = {}) {
  const normalizedTileId = normalizeString(tileId);
  if (!normalizedTileId) {
    throw new Error('Tile event bridge requires tileId.');
  }

  function readArtifacts() {
    if (!storage?.getItem) return [];
    try {
      const parsed = JSON.parse(storage.getItem(defaultArtifactStorageKey(normalizedTileId)) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeArtifacts(artifacts = []) {
    if (!storage?.setItem) return;
    try {
      storage.setItem(defaultArtifactStorageKey(normalizedTileId), JSON.stringify(artifacts));
    } catch {
      // Best-effort artifact journaling; do not block tile runtime flows.
    }
  }

  function emitEvent({ type = 'tile.event', payload = {}, sourceRef = '', tags = [], retrievalEligible = false } = {}) {
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    const artifact = {
      id: `${normalizedTileId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tileId: normalizedTileId,
      type: normalizeString(type, 'tile.event'),
      payload: safePayload,
      sourceRef: normalizeString(sourceRef),
      tags: normalizeTags(tags),
      retrievalEligible: retrievalEligible === true,
      timestamp: new Date().toISOString(),
    };

    const artifacts = [artifact, ...readArtifacts()].slice(0, 300);
    writeArtifacts(artifacts);

    memoryGateway?.persistTypedRecord?.({
      id: artifact.id,
      type: 'tile.event',
      summary: `${artifact.type} from ${normalizedTileId}`,
      payload: artifact,
      tags: normalizeTags(['tile.event', `tile.${normalizedTileId}`, ...artifact.tags]),
    });

    const truth = truthAdapter.createTruthPayload({
      tileActionType: artifact.type,
      tileSource,
      tileId: normalizedTileId,
      sourceRef: artifact.sourceRef,
      retrievalContributionSubmitted: artifact.retrievalEligible,
      retrievalIngested: false,
      retrievalSourceRef: artifact.sourceRef,
      memoryCandidateSubmitted: false,
      memoryPromoted: false,
      memoryReason: 'No memory candidate submitted for adjudication.',
      additional: { artifactId: artifact.id },
    });
    const executionMetadata = truthAdapter.toExecutionMetadata(truth);

    executionLoop?.publishTileEvent?.({
      tileId: normalizedTileId,
      tileTitle: normalizedTileId,
      action: artifact.type,
      summary: `${artifact.type} accepted`,
      result: {
        artifact,
        execution_metadata: executionMetadata,
      },
      tags: normalizeTags(['tile.contract.v1', ...artifact.tags]),
      source: tileSource,
    });

    return {
      ok: true,
      artifact,
      executionMetadata,
      truth,
    };
  }

  return {
    emitEvent,
    listArtifacts: readArtifacts,
    clearArtifacts: () => writeArtifacts([]),
    storageKey: defaultArtifactStorageKey(normalizedTileId),
  };
}
