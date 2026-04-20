import { createTileTruthAdapter } from './tileTruthAdapter.js';
import {
  createExecution,
  createRetrievalContribution,
  normalizeString,
  normalizeTags,
} from './tileCognitionContract.mjs';

const DEFAULT_ALLOWLIST = ['ideas', 'wealthapp', 'music-tile', 'vr-research-lab'];

function createStorageKey(tileId) {
  return `stephanos.retrieval.tile-corpus.v1.${normalizeString(tileId, 'unknown')}`;
}

function createRetrievalStore({ tileId, storage, memoryGateway, stephanosMemory }) {
  const storageKey = createStorageKey(tileId);

  function readLocalCorpus() {
    if (!storage?.getItem) return [];
    try {
      const parsed = JSON.parse(storage.getItem(storageKey) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeLocalCorpus(entries = []) {
    if (!storage?.setItem) return false;
    try {
      storage.setItem(storageKey, JSON.stringify(entries));
      return true;
    } catch {
      return false;
    }
  }

  function saveSharedContribution(contribution) {
    if (!memoryGateway?.persistTypedRecord) {
      return null;
    }

    try {
      return memoryGateway.persistTypedRecord({
        id: contribution.id,
        type: 'tile.retrieval.contribution',
        summary: `Retrieval contribution from ${tileId}`,
        payload: contribution,
        tags: normalizeTags(['tile.retrieval.contribution', `tile.${tileId}`, ...contribution.tags]),
      });
    } catch {
      return null;
    }
  }

  function listSharedContributions(limit = 200) {
    if (!stephanosMemory?.listRecords) {
      return [];
    }

    try {
      return stephanosMemory
        .listRecords({ tag: `tile.${tileId}` })
        .filter((record) => String(record?.type || '') === 'tile.retrieval.contribution')
        .map((record) => (record?.payload && typeof record.payload === 'object' ? record.payload : null))
        .filter(Boolean)
        .slice(0, Math.max(1, Number(limit) || 200));
    } catch {
      return [];
    }
  }

  function save(contribution) {
    const sharedRecord = saveSharedContribution(contribution);
    if (sharedRecord) {
      return {
        ingested: true,
        mode: 'shared-backed',
        persistedRecord: sharedRecord,
        diagnostics: {
          validationState: 'implemented-not-battle-bridge-validated',
          fallbackUsed: false,
        },
      };
    }

    const nextLocal = [contribution, ...readLocalCorpus()].slice(0, 200);
    const localPersisted = writeLocalCorpus(nextLocal);
    return {
      ingested: localPersisted,
      mode: localPersisted ? 'local-fallback' : 'unavailable',
      persistedRecord: null,
      diagnostics: {
        validationState: 'caravan-local-fallback',
        fallbackUsed: true,
      },
    };
  }

  function listEntries(limit = 200) {
    const shared = listSharedContributions(limit);
    if (shared.length > 0) {
      return shared;
    }

    return readLocalCorpus().slice(0, Math.max(1, Number(limit) || 200));
  }

  return {
    save,
    listEntries,
    storageKey,
  };
}

export function createTileRetrievalBridge({
  tileId,
  tileSource = 'tile-runtime',
  storage = globalThis.localStorage,
  executionLoop = globalThis.StephanosExecutionLoop,
  memoryGateway = globalThis.stephanosMemoryGateway,
  stephanosMemory = globalThis.stephanosMemory,
  truthAdapter = createTileTruthAdapter(),
  allowlist = DEFAULT_ALLOWLIST,
} = {}) {
  const normalizedTileId = normalizeString(tileId);
  if (!normalizedTileId) {
    throw new Error('Tile retrieval bridge requires tileId.');
  }

  const allowSet = new Set((Array.isArray(allowlist) ? allowlist : DEFAULT_ALLOWLIST).map((entry) => normalizeString(entry)));
  const retrievalStore = createRetrievalStore({
    tileId: normalizedTileId,
    storage,
    memoryGateway,
    stephanosMemory,
  });

  function contributeDocument({ document = '', sourceRef = '', tags = [], triggerReindex = false } = {}) {
    const documentText = normalizeString(document);
    const normalizedSourceRef = normalizeString(sourceRef, `tile:${normalizedTileId}`);
    const contributionSubmitted = documentText.length > 0;
    const isAllowed = allowSet.has(normalizedTileId);

    let entry = null;
    let saveResult = {
      ingested: false,
      mode: 'blocked',
      persistedRecord: null,
      diagnostics: { validationState: 'caravan-source-validated', fallbackUsed: false },
    };

    if (contributionSubmitted && isAllowed) {
      const draftContribution = createRetrievalContribution({
        tileId: normalizedTileId,
        tileSource,
        document: documentText,
        sourceRef: normalizedSourceRef,
        tags,
        triggerReindex,
        allowlisted: isAllowed,
      });
      saveResult = retrievalStore.save(draftContribution);
      entry = {
        ...draftContribution,
        storageMode: saveResult.mode,
        ingestionState: saveResult.ingested ? 'indexed' : 'persist-failed',
      };
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
      retrievalIngested: saveResult.ingested,
      retrievalSourceRef: normalizedSourceRef,
      additional: {
        retrievalIndexStatus: saveResult.ingested ? (triggerReindex ? 'queued-reindex' : 'indexed') : 'blocked',
        retrievalStorageMode: saveResult.mode,
        retrievalValidationState: saveResult.diagnostics.validationState,
      },
    });
    const executionMetadata = truthAdapter.toExecutionMetadata(truth);
    const execution = createExecution({
      mode: saveResult.mode,
      adapter: saveResult.mode === 'shared-backed' ? 'memory-gateway' : 'local-storage-fallback',
      adjudication: isAllowed ? 'allowlisted' : 'blocked-by-allowlist',
      persisted: saveResult.ingested,
      diagnostics: {
        allowlisted: isAllowed,
        triggerReindex: triggerReindex === true,
        validationState: saveResult.diagnostics.validationState,
      },
    });

    executionLoop?.publishTileEvent?.({
      tileId: normalizedTileId,
      tileTitle: normalizedTileId,
      action: 'tile.retrieval.contribution.submit',
      summary: saveResult.ingested
        ? `Retrieval contribution ingested (${saveResult.mode}).`
        : 'Retrieval contribution rejected by allowlist, empty payload, or unavailable persistence.',
      result: {
        entry,
        allowlisted: isAllowed,
        persistedRecord: saveResult.persistedRecord,
        triggerReindex: triggerReindex === true,
        execution,
        execution_metadata: executionMetadata,
      },
      tags: ['tile.contract.v1', 'tile.retrieval.contribution'],
      source: tileSource,
    });

    return {
      ok: contributionSubmitted,
      submitted: contributionSubmitted,
      ingested: saveResult.ingested,
      allowlisted: isAllowed,
      entry,
      execution,
      executionMetadata,
      truth,
    };
  }

  function getSourceTruth() {
    if (!allowSet.has(normalizedTileId)) {
      return 'unavailable';
    }
    if (memoryGateway?.persistTypedRecord) {
      return 'scaffolded-unvalidated';
    }
    return 'local-fallback';
  }

  return {
    contributeDocument,
    listCorpusEntries: retrievalStore.listEntries,
    getSourceTruth,
    storageKey: retrievalStore.storageKey,
  };
}
