import { createTileTruthAdapter } from './tileTruthAdapter.js';
import {
  createExecution,
  createTileArtifact,
  normalizeString,
  normalizeTags,
} from './tileCognitionContract.mjs';

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

  function emitEvent({ type = 'tile.event', payload = {}, sourceRef = '', tags = [], retrievalEligible = false, operatorReason = '' } = {}) {
    const artifact = createTileArtifact({
      tileId: normalizedTileId,
      tileSource,
      type,
      payload,
      sourceRef,
      tags,
      retrievalEligible,
      operatorReason,
    });

    const artifacts = [artifact, ...readArtifacts()].slice(0, 300);
    writeArtifacts(artifacts);

    const persistedRecord = memoryGateway?.persistTypedRecord?.({
      id: artifact.id,
      type: 'tile.event',
      summary: `${artifact.type} from ${normalizedTileId}`,
      payload: artifact,
      tags: normalizeTags(['tile.event', `tile.${normalizedTileId}`, ...artifact.tags]),
    }) || null;

    const truth = truthAdapter.createTruthPayload({
      tileActionType: artifact.type,
      tileSource,
      tileId: normalizedTileId,
      sourceRef: artifact.provenance.sourceRef,
      retrievalContributionSubmitted: artifact.retrievalEligible,
      retrievalIngested: false,
      retrievalSourceRef: artifact.provenance.sourceRef,
      memoryCandidateSubmitted: false,
      memoryPromoted: false,
      memoryReason: 'No memory candidate submitted for adjudication.',
      additional: {
        artifactId: artifact.id,
        artifactSchema: artifact.schemaVersion,
      },
    });
    const executionMetadata = truthAdapter.toExecutionMetadata(truth);
    const execution = createExecution({
      mode: 'event-journaled',
      adapter: memoryGateway?.persistTypedRecord ? 'memory-gateway+local-artifacts' : 'local-artifacts',
      adjudication: 'not-run',
      persisted: Boolean(persistedRecord),
      diagnostics: {
        storageKey: defaultArtifactStorageKey(normalizedTileId),
        memoryGatewayAvailable: Boolean(memoryGateway?.persistTypedRecord),
      },
    });

    executionLoop?.publishTileEvent?.({
      tileId: normalizedTileId,
      tileTitle: normalizedTileId,
      action: artifact.type,
      summary: `${artifact.type} accepted`,
      result: {
        artifact,
        execution,
        execution_metadata: executionMetadata,
      },
      tags: normalizeTags(['tile.contract.v1', ...artifact.tags]),
      source: tileSource,
    });

    return {
      ok: true,
      artifact,
      execution,
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
