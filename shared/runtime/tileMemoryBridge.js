import { createTileTruthAdapter } from './tileTruthAdapter.js';

function normalizeString(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeCandidate(candidate = {}, tileId = '') {
  return {
    key: normalizeString(candidate.key),
    value: candidate?.value,
    sourceType: 'tile',
    sourceRef: normalizeString(candidate.sourceRef, `tile:${tileId}`),
    reason: normalizeString(candidate.reason),
    type: normalizeString(candidate.type, 'tile.result'),
    importance: normalizeString(candidate.importance, 'normal'),
    tags: Array.isArray(candidate.tags) ? candidate.tags.map((tag) => normalizeString(tag)).filter(Boolean) : [],
  };
}

function defaultAdjudicate(candidate) {
  const hasKey = Boolean(candidate.key);
  const hasValue = candidate.value !== undefined && candidate.value !== null && String(candidate.value).trim() !== '';
  const hasReason = candidate.reason.length >= 12;
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
    const normalized = normalizeCandidate(candidate, normalizedTileId);
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
          sourceType: normalized.sourceType,
          sourceRef: normalized.sourceRef,
          reason: normalized.reason,
        },
        tags: ['tile.memory.candidate', `tile.${normalizedTileId}`, ...normalized.tags],
        importance: normalized.importance,
      });
    }

    const truth = truthAdapter.createTruthPayload({
      tileActionType: 'tile.memory.candidate.submit',
      tileSource,
      tileId: normalizedTileId,
      sourceRef: normalized.sourceRef,
      memoryCandidateSubmitted: true,
      memoryPromoted: adjudication.promoted === true,
      memoryReason: adjudication.reason,
      retrievalContributionSubmitted: false,
      retrievalIngested: false,
      retrievalSourceRef: '',
      additional: {
        memoryConfidence: adjudication.confidence || 'low',
      },
    });
    const executionMetadata = truthAdapter.toExecutionMetadata(truth);

    executionLoop?.publishTileEvent?.({
      tileId: normalizedTileId,
      tileTitle: normalizedTileId,
      action: 'tile.memory.candidate.submit',
      summary: adjudication.reason,
      result: {
        candidate: normalized,
        adjudication,
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
