import { createTileTruthAdapter } from './tileTruthAdapter.js';

const DEFAULT_ALLOWLIST = ['ideas', 'wealthapp', 'music-tile', 'vr-research-lab'];

function normalizeString(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((tag) => normalizeString(tag)).filter(Boolean))];
}

function createStorageKey(tileId) {
  return `stephanos.retrieval.tile-corpus.v1.${normalizeString(tileId, 'unknown')}`;
}

export function createTileRetrievalBridge({
  tileId,
  tileSource = 'tile-runtime',
  storage = globalThis.localStorage,
  executionLoop = globalThis.StephanosExecutionLoop,
  truthAdapter = createTileTruthAdapter(),
  allowlist = DEFAULT_ALLOWLIST,
} = {}) {
  const normalizedTileId = normalizeString(tileId);
  if (!normalizedTileId) {
    throw new Error('Tile retrieval bridge requires tileId.');
  }

  const allowSet = new Set((Array.isArray(allowlist) ? allowlist : DEFAULT_ALLOWLIST).map((entry) => normalizeString(entry)));
  const storageKey = createStorageKey(normalizedTileId);

  function readCorpus() {
    if (!storage?.getItem) return [];
    try {
      const parsed = JSON.parse(storage.getItem(storageKey) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeCorpus(entries = []) {
    if (!storage?.setItem) return;
    storage.setItem(storageKey, JSON.stringify(entries));
  }

  function contributeDocument({ document = '', sourceRef = '', tags = [], triggerReindex = false } = {}) {
    const documentText = normalizeString(document);
    const normalizedSourceRef = normalizeString(sourceRef, `tile:${normalizedTileId}`);
    const contributionSubmitted = documentText.length > 0;
    const isAllowed = allowSet.has(normalizedTileId);
    const ingested = contributionSubmitted && isAllowed;

    let entry = null;
    if (ingested) {
      entry = {
        id: `${normalizedTileId}-doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tileId: normalizedTileId,
        document: documentText,
        sourceType: 'tile',
        sourceRef: normalizedSourceRef,
        tags: normalizeTags(tags),
        ingestedAt: new Date().toISOString(),
      };
      writeCorpus([entry, ...readCorpus()].slice(0, 200));
    }

    const truth = truthAdapter.createTruthPayload({
      tileActionType: 'tile.retrieval.contribution.submit',
      tileSource,
      tileId: normalizedTileId,
      sourceRef: normalizedSourceRef,
      memoryCandidateSubmitted: false,
      memoryPromoted: false,
      memoryReason: 'No memory candidate submitted for adjudication.',
      retrievalContributionSubmitted: contributionSubmitted,
      retrievalIngested: ingested,
      retrievalSourceRef: normalizedSourceRef,
      additional: {
        retrievalIndexStatus: ingested ? (triggerReindex ? 'queued-reindex' : 'indexed') : 'blocked',
      },
    });
    const executionMetadata = truthAdapter.toExecutionMetadata(truth);

    executionLoop?.publishTileEvent?.({
      tileId: normalizedTileId,
      tileTitle: normalizedTileId,
      action: 'tile.retrieval.contribution.submit',
      summary: ingested ? 'Retrieval contribution ingested.' : 'Retrieval contribution rejected by allowlist or empty payload.',
      result: {
        entry,
        allowlisted: isAllowed,
        triggerReindex: triggerReindex === true,
        execution_metadata: executionMetadata,
      },
      tags: ['tile.contract.v1', 'tile.retrieval.contribution'],
      source: tileSource,
    });

    return {
      ok: contributionSubmitted,
      submitted: contributionSubmitted,
      ingested,
      allowlisted: isAllowed,
      entry,
      executionMetadata,
      truth,
    };
  }

  return {
    contributeDocument,
    listCorpusEntries: readCorpus,
    storageKey,
  };
}
