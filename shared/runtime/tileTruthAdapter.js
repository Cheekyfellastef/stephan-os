function normalizeString(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

export function createTileTruthAdapter({ now = () => new Date().toISOString() } = {}) {
  function createTruthPayload({
    tileActionType = 'tile.action.unknown',
    tileSource = 'tile',
    tileId = '',
    sourceRef = '',
    memoryCandidateSubmitted = false,
    memoryPromoted = false,
    memoryReason = '',
    retrievalContributionSubmitted = false,
    retrievalIngested = false,
    retrievalSourceRef = '',
    additional = {},
  } = {}) {
    return {
      tileActionType: normalizeString(tileActionType, 'tile.action.unknown'),
      tileSource: normalizeString(tileSource, 'tile'),
      tileId: normalizeString(tileId),
      sourceRef: normalizeString(sourceRef),
      memoryCandidateSubmitted: normalizeBoolean(memoryCandidateSubmitted, false),
      memoryPromoted: normalizeBoolean(memoryPromoted, false),
      memoryReason: normalizeString(memoryReason),
      retrievalContributionSubmitted: normalizeBoolean(retrievalContributionSubmitted, false),
      retrievalIngested: normalizeBoolean(retrievalIngested, false),
      retrievalSourceRef: normalizeString(retrievalSourceRef),
      occurredAt: now(),
      ...(additional && typeof additional === 'object' ? additional : {}),
    };
  }

  function toExecutionMetadata(truthPayload = {}) {
    return {
      tile_action_type: normalizeString(truthPayload.tileActionType, 'tile.action.unknown'),
      tile_source: normalizeString(truthPayload.tileSource, 'tile'),
      tile_id: normalizeString(truthPayload.tileId),
      tile_source_ref: normalizeString(truthPayload.sourceRef),
      memory_candidate_submitted: normalizeBoolean(truthPayload.memoryCandidateSubmitted, false),
      memory_promoted: normalizeBoolean(truthPayload.memoryPromoted, false),
      memory_reason: normalizeString(truthPayload.memoryReason, 'No memory candidate submitted for adjudication.'),
      retrieval_contribution_submitted: normalizeBoolean(truthPayload.retrievalContributionSubmitted, false),
      retrieval_ingested: normalizeBoolean(truthPayload.retrievalIngested, false),
      retrieval_source_ref: normalizeString(truthPayload.retrievalSourceRef),
      tile_action_occurred_at: normalizeString(truthPayload.occurredAt, now()),
    };
  }

  return {
    createTruthPayload,
    toExecutionMetadata,
  };
}
