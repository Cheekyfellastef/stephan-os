import { createTileTruthAdapter } from './tileTruthAdapter.js';
import { createExecution, createMemoryCandidate, normalizeString, normalizeTags } from './tileCognitionContract.mjs';

function defaultAdjudicate(candidate) {
  const hasKey = Boolean(candidate.key);
  const hasValue = candidate.value !== undefined && candidate.value !== null && String(candidate.value).trim() !== '';
  const hasReason = candidate.provenance.operatorReason.length >= 12;
  const promoted = hasKey && hasValue && hasReason;

  return {
    eligible: hasKey && hasValue,
    promoted,
    reason: promoted
      ? 'Candidate promoted by tile adjudication guard.'
      : 'Candidate rejected: require key/value plus reason length >= 12 chars.',
    confidence: promoted ? 'medium' : 'low',
  };
}

export function createTileMemoryBridge({
  tileId,
  tileSource = 'tile-runtime',
  stephanosMemory = globalThis.stephanosMemory,
  executionLoop = globalThis.StephanosExecutionLoop,
  adjudicate = defaultAdjudicate,
  truthAdapter = createTileTruthAdapter(),
} = {}) {
  const normalizedTileId = normalizeString(tileId);
  if (!normalizedTileId) {
    throw new Error('Tile memory bridge requires tileId.');
  }

  function submitMemoryCandidate(candidate = {}) {
    const normalized = createMemoryCandidate({
      tileId: normalizedTileId,
      tileSource,
      candidate,
    });
    const adjudication = adjudicate(normalized);

    let persistedRecord = null;
    if (adjudication.promoted && stephanosMemory?.saveRecord) {
      persistedRecord = stephanosMemory.saveRecord({
        namespace: 'continuity',
        id: `tile-memory-${normalizedTileId}-${Date.now()}`,
        type: normalized.type,
        summary: `${normalized.key}: ${String(normalized.value).slice(0, 140)}`,
        payload: {
          key: normalized.key,
          value: normalized.value,
          sourceType: 'tile',
          sourceRef: normalized.provenance.sourceRef,
          reason: normalized.provenance.operatorReason,
          relatedIdeaIds: normalized.relatedIdeaIds,
        },
        tags: normalizeTags(['tile.memory.candidate', `tile.${normalizedTileId}`, ...normalized.tags]),
        importance: normalized.importance,
      });
    }

    const truth = truthAdapter.createTruthPayload({
      tileActionType: 'tile.memory.candidate.submit',
      tileSource,
      tileId: normalizedTileId,
      sourceRef: normalized.provenance.sourceRef,
      memoryCandidateSubmitted: true,
      memoryPromoted: adjudication.promoted === true,
      memoryReason: adjudication.reason,
      retrievalContributionSubmitted: false,
      retrievalIngested: false,
      retrievalSourceRef: '',
      additional: {
        memoryConfidence: adjudication.confidence || 'low',
        candidateSchema: normalized.schemaVersion,
      },
    });
    const executionMetadata = truthAdapter.toExecutionMetadata(truth);
    const execution = createExecution({
      mode: adjudication.promoted ? 'promoted' : 'rejected',
      adapter: stephanosMemory?.saveRecord ? 'stephanos-memory' : 'memory-unavailable',
      adjudication: adjudication.promoted ? 'promoted' : 'rejected',
      persisted: Boolean(persistedRecord),
      diagnostics: {
        eligible: adjudication.eligible === true,
        confidence: adjudication.confidence || 'low',
      },
    });

    executionLoop?.publishTileEvent?.({
      tileId: normalizedTileId,
      tileTitle: normalizedTileId,
      action: 'tile.memory.candidate.submit',
      summary: adjudication.reason,
      result: {
        candidate: normalized,
        adjudication,
        execution,
        persistedRecord,
        execution_metadata: executionMetadata,
      },
      tags: ['tile.contract.v1', 'tile.memory.candidate'],
      source: tileSource,
    });

    return {
      ok: true,
      candidate: normalized,
      adjudication,
      execution,
      promoted: adjudication.promoted === true,
      record: persistedRecord,
      executionMetadata,
      truth,
    };
  }

  return {
    submitMemoryCandidate,
  };
}
