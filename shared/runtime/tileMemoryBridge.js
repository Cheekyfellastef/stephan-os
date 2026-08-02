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

export function resolveTileHostRuntime(name, runtime = globalThis) {
  const runtimeName = normalizeString(name);
  if (!runtimeName || !runtime) return null;
  try {
    if (runtime[runtimeName]) return runtime[runtimeName];
    const parentRuntime = runtime.parent;
    if (parentRuntime && parentRuntime !== runtime && parentRuntime[runtimeName]) return parentRuntime[runtimeName];
  } catch {
    return null;
  }
  return null;
}

export function createTileMemoryBridge({
  tileId,
  tileSource = 'tile-runtime',
  stephanosMemory = resolveTileHostRuntime('stephanosMemory'),
  executionLoop = resolveTileHostRuntime('StephanosExecutionLoop'),
  adjudicate = defaultAdjudicate,
  truthAdapter = createTileTruthAdapter(),
} = {}) {
  const normalizedTileId = normalizeString(tileId);
  if (!normalizedTileId) {
    throw new Error('Tile memory bridge requires tileId.');
  }

  function submitMemoryCandidate(candidate = {}) {
    const memoryRuntime = stephanosMemory || resolveTileHostRuntime('stephanosMemory');
    const eventRuntime = executionLoop || resolveTileHostRuntime('StephanosExecutionLoop');
    const normalized = createMemoryCandidate({
      tileId: normalizedTileId,
      tileSource,
      candidate,
    });
    const adjudication = adjudicate(normalized);

    let persistedRecord = null;
    if (adjudication.promoted && memoryRuntime?.saveRecord) {
      persistedRecord = memoryRuntime.saveRecord({
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
      adapter: memoryRuntime?.saveRecord ? 'stephanos-memory' : 'memory-unavailable',
      adjudication: adjudication.promoted ? 'promoted' : 'rejected',
      persisted: Boolean(persistedRecord),
      diagnostics: {
        eligible: adjudication.eligible === true,
        confidence: adjudication.confidence || 'low',
      },
    });

    eventRuntime?.publishTileEvent?.({
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

  async function submitMemoryCandidateDurably(candidate = {}) {
    const memoryRuntime = stephanosMemory || resolveTileHostRuntime('stephanosMemory');
    const eventRuntime = executionLoop || resolveTileHostRuntime('StephanosExecutionLoop');
    const normalized = createMemoryCandidate({
      tileId: normalizedTileId,
      tileSource,
      candidate,
    });
    const adjudication = adjudicate(normalized);
    let persistedRecord = null;
    let authorityReceipt = null;

    if (adjudication.promoted && typeof memoryRuntime?.saveRecordDurably === 'function') {
      try {
        const result = await memoryRuntime.saveRecordDurably({
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
        if (result?.authorityConfirmed === true && result?.record?.id) {
          persistedRecord = result.record;
          authorityReceipt = result.receipt || null;
        }
      } catch {
        persistedRecord = null;
        authorityReceipt = null;
      }
    }

    const persisted = Boolean(persistedRecord && authorityReceipt?.authorityConfirmed === true);
    const memoryReason = adjudication.promoted && !persisted
      ? 'Candidate was eligible, but shared durable-memory authority did not confirm persistence.'
      : adjudication.reason;
    const truth = truthAdapter.createTruthPayload({
      tileActionType: 'tile.memory.candidate.submit',
      tileSource,
      tileId: normalizedTileId,
      sourceRef: normalized.provenance.sourceRef,
      memoryCandidateSubmitted: true,
      memoryPromoted: adjudication.promoted === true,
      memoryReason,
      retrievalContributionSubmitted: false,
      retrievalIngested: false,
      retrievalSourceRef: '',
      additional: {
        memoryConfidence: adjudication.confidence || 'low',
        candidateSchema: normalized.schemaVersion,
        durableAuthorityConfirmed: persisted,
      },
    });
    const executionMetadata = truthAdapter.toExecutionMetadata(truth);
    const execution = createExecution({
      mode: persisted ? 'promoted' : adjudication.promoted ? 'authority-unconfirmed' : 'rejected',
      adapter: typeof memoryRuntime?.saveRecordDurably === 'function' ? 'stephanos-memory-durable' : 'memory-unavailable',
      adjudication: adjudication.promoted ? 'promoted' : 'rejected',
      persisted,
      diagnostics: {
        eligible: adjudication.eligible === true,
        confidence: adjudication.confidence || 'low',
        authorityConfirmed: persisted,
      },
    });

    eventRuntime?.publishTileEvent?.({
      tileId: normalizedTileId,
      tileTitle: normalizedTileId,
      action: 'tile.memory.candidate.submit',
      summary: memoryReason,
      result: {
        execution,
        memoryRecordIdentity: persistedRecord?.id
          ? { namespace: persistedRecord.namespace || 'continuity', id: persistedRecord.id }
          : null,
        authorityConfirmed: persisted,
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
      authorityReceipt,
      executionMetadata,
      truth,
    };
  }

  async function listDurableMemoryCandidates({ tags = [] } = {}) {
    const memoryRuntime = stephanosMemory || resolveTileHostRuntime('stephanosMemory');
    if (typeof memoryRuntime?.listRecordsDurably !== 'function') {
      return { records: [], authorityConfirmed: false };
    }
    const result = await memoryRuntime.listRecordsDurably({
      namespace: 'continuity',
      type: 'operator.preference',
      tag: `tile.${normalizedTileId}`,
    });
    const requiredTags = normalizeTags(tags);
    const records = result?.authorityConfirmed === true
      ? (Array.isArray(result.records) ? result.records : []).filter((record) => requiredTags.every((tag) => (record.tags || []).includes(tag)))
      : [];
    return {
      records,
      authorityConfirmed: result?.authorityConfirmed === true,
      authorityReceipt: result?.receipt || null,
    };
  }

  async function revokeMemoryCandidate({ record = {}, reason = '', sourceRef = '' } = {}) {
    const memoryRuntime = stephanosMemory || resolveTileHostRuntime('stephanosMemory');
    const eventRuntime = executionLoop || resolveTileHostRuntime('StephanosExecutionLoop');
    const namespace = normalizeString(record?.namespace, 'continuity');
    const id = normalizeString(record?.id);
    const operatorReason = normalizeString(reason);
    const ownedRecord = namespace === 'continuity' && id.startsWith(`tile-memory-${normalizedTileId}-`);
    const eligible = ownedRecord && operatorReason.length >= 12;
    let revoked = false;
    let alreadyAbsent = false;

    if (eligible && typeof memoryRuntime?.deleteRecordDurably === 'function') {
      const durableResult = await memoryRuntime.deleteRecordDurably({ namespace, id });
      alreadyAbsent = durableResult?.alreadyAbsent === true;
      revoked = durableResult?.authorityConfirmed === true
        && (durableResult?.deleted === true || alreadyAbsent);
    } else if (eligible && memoryRuntime?.deleteRecord) {
      revoked = memoryRuntime.deleteRecord({ namespace, id }) === true;
      if (!revoked && typeof memoryRuntime.getRecord === 'function') {
        try {
          alreadyAbsent = memoryRuntime.getRecord({ namespace, id }) === null;
          revoked = alreadyAbsent;
        } catch {
          alreadyAbsent = false;
        }
      }
    }

    const revocationReason = revoked
      ? alreadyAbsent
        ? 'Durable tile memory record was already absent; revocation is complete.'
        : 'Original durable tile memory record revoked.'
      : eligible
        ? 'Memory revocation failed: durable delete adapter unavailable or record not found.'
        : 'Memory revocation rejected: require an original record owned by this tile and an operator reason.';
    const truth = truthAdapter.createTruthPayload({
      tileActionType: 'tile.memory.candidate.revoke',
      tileSource,
      tileId: normalizedTileId,
      sourceRef: normalizeString(sourceRef, `tile:${normalizedTileId}`),
      memoryCandidateSubmitted: false,
      memoryPromoted: false,
      memoryReason: revocationReason,
      retrievalContributionSubmitted: false,
      retrievalIngested: false,
      retrievalSourceRef: '',
      additional: {
        memoryRevocationRequested: eligible,
        memoryRevoked: revoked,
        memoryRecordAlreadyAbsent: alreadyAbsent,
        revokedRecordNamespace: namespace,
        revokedRecordId: id,
      },
    });
    const executionMetadata = truthAdapter.toExecutionMetadata(truth);
    const execution = createExecution({
      mode: revoked ? (alreadyAbsent ? 'already-absent' : 'revoked') : 'revocation-blocked',
      adapter: memoryRuntime?.deleteRecordDurably || memoryRuntime?.deleteRecord ? 'stephanos-memory' : 'memory-unavailable',
      adjudication: eligible ? 'revocation-eligible' : 'rejected',
      persisted: revoked,
      diagnostics: { eligible, ownedRecord, revoked, alreadyAbsent },
    });

    eventRuntime?.publishTileEvent?.({
      tileId: normalizedTileId,
      tileTitle: normalizedTileId,
      action: 'tile.memory.candidate.revoke',
      summary: revocationReason,
      result: {
        record: { namespace, id },
        execution,
        execution_metadata: executionMetadata,
      },
      tags: ['tile.contract.v1', 'tile.memory.revocation'],
      source: tileSource,
    });

    return {
      ok: eligible,
      revoked,
      alreadyAbsent,
      record: { namespace, id },
      execution,
      executionMetadata,
      truth,
    };
  }

  async function revokeAllMemoryCandidates({ tags = [], reason = '', sourceRef = '' } = {}) {
    const memoryRuntime = stephanosMemory || resolveTileHostRuntime('stephanosMemory');
    const eventRuntime = executionLoop || resolveTileHostRuntime('StephanosExecutionLoop');
    const operatorReason = normalizeString(reason);
    const requiredTags = normalizeTags(tags);
    const eligible = operatorReason.length >= 12 && requiredTags.length > 0;
    let durableResult = null;
    if (eligible && typeof memoryRuntime?.deleteRecordsDurably === 'function') {
      durableResult = await memoryRuntime.deleteRecordsDurably({
        namespace: 'continuity',
        idPrefix: `tile-memory-${normalizedTileId}-`,
        type: 'operator.preference',
        tags: normalizeTags(['tile.memory.candidate', `tile.${normalizedTileId}`, ...requiredTags]),
      });
    }
    const revoked = durableResult?.authorityConfirmed === true;
    const deletedCount = revoked ? Number(durableResult?.deletedCount || 0) : 0;
    const alreadyEmpty = revoked && durableResult?.alreadyEmpty === true;
    const revocationReason = revoked
      ? alreadyEmpty
        ? 'The canonical owned tile-memory set was already empty.'
        : 'The canonical owned tile-memory set was revoked atomically.'
      : eligible
        ? 'Owned-set memory revocation failed: atomic durable authority was unavailable.'
        : 'Owned-set memory revocation rejected: require scoped tags and an operator reason.';
    const truth = truthAdapter.createTruthPayload({
      tileActionType: 'tile.memory.candidate.revoke-set',
      tileSource,
      tileId: normalizedTileId,
      sourceRef: normalizeString(sourceRef, `tile:${normalizedTileId}`),
      memoryCandidateSubmitted: false,
      memoryPromoted: false,
      memoryReason: revocationReason,
      retrievalContributionSubmitted: false,
      retrievalIngested: false,
      retrievalSourceRef: '',
      additional: {
        memoryRevocationRequested: eligible,
        memoryRevoked: revoked,
        memoryRecordAlreadyAbsent: alreadyEmpty,
        revokedRecordCount: deletedCount,
      },
    });
    const executionMetadata = truthAdapter.toExecutionMetadata(truth);
    const execution = createExecution({
      mode: revoked ? (alreadyEmpty ? 'already-absent' : 'revoked') : 'revocation-blocked',
      adapter: typeof memoryRuntime?.deleteRecordsDurably === 'function' ? 'stephanos-memory-durable-owned-set' : 'memory-unavailable',
      adjudication: eligible ? 'revocation-eligible' : 'rejected',
      persisted: revoked,
      diagnostics: { eligible, revoked, alreadyEmpty, deletedCount },
    });

    eventRuntime?.publishTileEvent?.({
      tileId: normalizedTileId,
      tileTitle: normalizedTileId,
      action: 'tile.memory.candidate.revoke-set',
      summary: revocationReason,
      result: {
        execution,
        authorityConfirmed: revoked,
        revokedRecordCount: deletedCount,
        execution_metadata: executionMetadata,
      },
      tags: ['tile.contract.v1', 'tile.memory.revocation'],
      source: tileSource,
    });

    return {
      ok: eligible,
      revoked,
      alreadyEmpty,
      deletedCount,
      execution,
      executionMetadata,
      truth,
    };
  }

  return {
    revokeMemoryCandidate,
    revokeAllMemoryCandidates,
    submitMemoryCandidate,
    submitMemoryCandidateDurably,
    listDurableMemoryCandidates,
  };
}
