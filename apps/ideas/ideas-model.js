import { sanitizeIdeasState } from './ideas-persistence.js';

const RELATIONSHIP_LABELS = {
  supports: 'supports',
  depends_on: 'depends on',
  derived_from: 'derived from',
  contradicts: 'contradicts',
  expands: 'expands',
  similar_to: 'similar to',
  part_of: 'part of',
  promotes_to: 'promotes to',
  evidence_for: 'evidence for',
  evidence_against: 'evidence against',
};

const DEFAULT_PROMOTION_STATE = {
  memory: 'not-submitted',
  retrieval: 'not-submitted',
  codex: 'not-prepared',
  roadmap: 'not-promoted',
  simulation: 'not-targeted',
  continuity: 'not-submitted',
  memoryLink: 'not-linked',
  retrievalLink: 'not-linked',
};

function normalizeSourceTruth(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    persistence: typeof source.persistence === 'string' && source.persistence.trim()
      ? source.persistence.trim()
      : 'unknown',
    retrieval: typeof source.retrieval === 'string' && source.retrieval.trim()
      ? source.retrieval.trim()
      : 'unavailable',
    memory: typeof source.memory === 'string' && source.memory.trim()
      ? source.memory.trim()
      : 'unknown',
    validation: typeof source.validation === 'string' && source.validation.trim()
      ? source.validation.trim()
      : 'caravan-source-validated',
  };
}

function cloneIdeaRecord(record) {
  return {
    id: record.id,
    title: record.title,
    summary: record.summary,
    tags: [...(record.tags || [])],
    media: Array.isArray(record.media) ? record.media.map((media) => ({ ...media })) : [],
    knowledge: record?.knowledge && typeof record.knowledge === 'object'
      ? {
        ...record.knowledge,
        relations: Array.isArray(record.knowledge.relations) ? record.knowledge.relations.map((relation) => ({ ...relation })) : [],
        evidence: Array.isArray(record.knowledge.evidence) ? record.knowledge.evidence.map((evidence) => ({ ...evidence })) : [],
        collectionIds: Array.isArray(record.knowledge.collectionIds) ? [...record.knowledge.collectionIds] : [],
        relatedIdeas: Array.isArray(record.knowledge.relatedIdeas) ? [...record.knowledge.relatedIdeas] : [],
        promotionState: record.knowledge.promotionState ? { ...record.knowledge.promotionState } : { ...DEFAULT_PROMOTION_STATE },
        sourceArtifacts: Array.isArray(record.knowledge.sourceArtifacts) ? [...record.knowledge.sourceArtifacts] : [],
        memoryLinks: Array.isArray(record.knowledge.memoryLinks) ? [...record.knowledge.memoryLinks] : [],
        retrievalLinks: Array.isArray(record.knowledge.retrievalLinks) ? [...record.knowledge.retrievalLinks] : [],
        roadmapLinks: Array.isArray(record.knowledge.roadmapLinks) ? [...record.knowledge.roadmapLinks] : [],
        simulationLinks: Array.isArray(record.knowledge.simulationLinks) ? [...record.knowledge.simulationLinks] : [],
        aiContextPackageMeta: record.knowledge.aiContextPackageMeta && typeof record.knowledge.aiContextPackageMeta === 'object'
          ? { ...record.knowledge.aiContextPackageMeta }
          : undefined,
        sourceTruth: normalizeSourceTruth(record.knowledge.sourceTruth),
      }
      : {
        nodeType: 'concept',
        status: 'spark',
        priority: 'normal',
        collectionId: '',
        collectionIds: [],
        actionTarget: '',
        promotionStatus: 'draft',
        promotionState: { ...DEFAULT_PROMOTION_STATE },
        relatedIdeas: [],
        relations: [],
        evidence: [],
        sourceTile: '',
        sourceArtifacts: [],
        memoryLinks: [],
        retrievalLinks: [],
        roadmapLinks: [],
        simulationLinks: [],
        operatorNotes: '',
        aiContextPackageMeta: {},
        sourceTruth: normalizeSourceTruth(),
      },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function createIdeaId(now = Date.now()) {
  const safeNow = Number.isFinite(now) ? Math.floor(now) : Date.now();
  return `ideas_${safeNow}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildIdeaActions(record) {
  if (!record || typeof record !== 'object') {
    return [];
  }

  const memoryState = record?.promotionState?.memory || record?.knowledge?.promotionState?.memory || 'not-submitted';
  const retrievalState = record?.promotionState?.retrieval || record?.knowledge?.promotionState?.retrieval || 'not-submitted';
  const codexState = record?.promotionState?.codex || record?.knowledge?.promotionState?.codex || 'not-prepared';
  return [
    { type: 'edit', label: 'Edit' },
    { type: 'promote-memory', label: `Memory: ${memoryState}` },
    { type: 'promote-retrieval', label: `Retrieval: ${retrievalState}` },
    { type: 'prepare-codex', label: `Codex: ${codexState}` },
  ];
}

function transitionIdeaPromotionState(record, target = 'memory', state = 'submitted', { actor = 'operator', notes = '' } = {}) {
  const sanitized = sanitizeIdeasState({ records: [record] }).records[0];
  if (!sanitized) {
    return null;
  }

  const current = sanitized.knowledge?.promotionState || {};
  const next = {
    ...current,
    [target]: String(state || '').trim() || 'unknown',
    lastTransitionAt: new Date().toISOString(),
    lastActor: String(actor || '').trim() || 'operator',
    trace: [...(Array.isArray(current.trace) ? current.trace : []), {
      target: String(target || '').trim() || 'unknown',
      state: String(state || '').trim() || 'unknown',
      at: new Date().toISOString(),
      notes: String(notes || '').trim(),
    }].slice(-30),
  };

  return sanitizeIdeasState({
    records: [{
      ...sanitized,
      promotionState: next,
      knowledge: {
        ...sanitized.knowledge,
        promotionState: next,
      },
      updatedAt: new Date().toISOString(),
    }],
  }).records[0] || null;
}

function startIdeaEdit(records, ideaId) {
  const normalizedIdeaId = String(ideaId || '').trim();
  if (!normalizedIdeaId) {
    return null;
  }

  const sanitized = sanitizeIdeasState({ records });
  const found = sanitized.records.find((record) => record.id === normalizedIdeaId);
  return found ? cloneIdeaRecord(found) : null;
}

function upsertIdeaRecord(records, ideaDraft, { nowIso = new Date().toISOString(), idFactory = createIdeaId } = {}) {
  const sanitized = sanitizeIdeasState({ records }).records;
  const hasDraftId = typeof ideaDraft?.id === 'string' && ideaDraft.id.trim();
  const existing = hasDraftId ? sanitized.find((record) => record.id === ideaDraft.id.trim()) : null;
  const id = existing?.id || (hasDraftId ? ideaDraft.id.trim() : idFactory());
  const nextRecord = sanitizeIdeasState({
    records: [{
      ...ideaDraft,
      id,
      createdAt: existing?.createdAt || ideaDraft?.createdAt || nowIso,
      updatedAt: nowIso,
    }],
  }).records[0];

  if (!nextRecord) {
    throw new Error('Invalid idea record.');
  }

  const retained = sanitized.filter((record) => record.id !== nextRecord.id);
  return [nextRecord, ...retained]
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function buildIdeasKnowledgeDigest(records = [], {
  selectedIdeaId = '',
  maxRelated = 3,
  maxEvidence = 3,
} = {}) {
  const sanitized = sanitizeIdeasState({ records }).records;
  const selected = sanitized.find((record) => record.id === String(selectedIdeaId || '').trim()) || sanitized[0] || null;
  if (!selected) {
    return {
      selectedIdea: null,
      relatedIdeas: [],
      promotedMemories: [],
      retrievalExcerpts: [],
      diagnostics: {
        included: false,
        reason: 'no-ideas-available',
      },
    };
  }

  const relatedByRelation = (selected.knowledge?.relations || [])
    .map((relation) => sanitized.find((record) => record.id === relation.targetId))
    .filter(Boolean);

  const relatedByTags = sanitized
    .filter((record) => record.id !== selected.id)
    .map((record) => ({
      record,
      overlap: record.tags.filter((tag) => selected.tags.includes(tag)).length,
    }))
    .filter((candidate) => candidate.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .map((candidate) => candidate.record);

  const relatedIdeas = [...new Map([...relatedByRelation, ...relatedByTags].map((record) => [record.id, {
    id: record.id,
    title: record.title,
    summary: record.summary,
    relationCount: Array.isArray(record.knowledge?.relations) ? record.knowledge.relations.length : 0,
    status: record.status || record.knowledge?.status || 'spark',
    priority: record.priority || record.knowledge?.priority || 'normal',
    promotionStatus: record.knowledge?.promotionStatus || 'draft',
  }])).values()].slice(0, Math.max(1, Number(maxRelated) || 3));

  const selectedEvidence = (selected.knowledge?.evidence || []).slice(0, Math.max(1, Number(maxEvidence) || 3));
  const selectedCollections = selected.collectionIds || selected.knowledge?.collectionIds || [];
  const relationSummary = (selected.knowledge?.relations || []).reduce((acc, relation) => {
    const key = relation?.relationType || 'supports';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    selectedIdea: {
      id: selected.id,
      title: selected.title,
      summary: selected.summary,
      nodeType: selected.nodeType || selected.knowledge?.nodeType || 'concept',
      status: selected.status || selected.knowledge?.status || 'spark',
      priority: selected.priority || selected.knowledge?.priority || 'normal',
      promotionStatus: selected.knowledge?.promotionStatus || 'draft',
      promotionState: selected.promotionState || selected.knowledge?.promotionState || null,
      actionTarget: selected.knowledge?.actionTarget || '',
      collectionId: selected.knowledge?.collectionId || selected.collectionIds?.[0] || '',
      collectionIds: selectedCollections,
      evidence: selectedEvidence,
      relatedIdeaIds: selected.relatedIdeas || selected.knowledge?.relatedIdeas || [],
      relationSummary,
      aiContextHints: selected.aiContextHints || selected.knowledge?.aiContextHints || null,
      sourceTruth: normalizeSourceTruth(selected.knowledge?.sourceTruth || selected.sourceTruth),
      collectionsSummary: {
        count: selectedCollections.length,
        labels: selectedCollections.slice(0, 4),
      },
    },
    relatedIdeas,
    promotedMemories: [],
    retrievalExcerpts: [],
    diagnostics: {
      included: true,
      reason: 'idea-knowledge-digest',
      selectedIdeaId: selected.id,
      relatedCount: relatedIdeas.length,
      evidenceCount: selectedEvidence.length,
      relationTypes: Object.keys(relationSummary).length,
    },
  };
}

function buildIdeaContextPackage(records = [], {
  selectedIdeaId = '',
  retrievalExcerpts = [],
  memoryRecords = [],
  retrievalSource = 'unavailable',
  memorySource = 'unknown',
  persistenceSource = 'unknown',
  maxRelated = 3,
  maxEvidence = 2,
} = {}) {
  const digest = buildIdeasKnowledgeDigest(records, { selectedIdeaId, maxRelated, maxEvidence });
  if (!digest.selectedIdea) {
    return {
      packageVersion: 1,
      included: false,
      reason: 'no-selected-idea',
      diagnostics: digest.diagnostics,
    };
  }

  const boundedRetrieval = Array.isArray(retrievalExcerpts)
    ? retrievalExcerpts.slice(0, 2).map((entry) => ({
      sourceRef: entry.sourceRef || '',
      excerpt: entry.excerpt || '',
      storageMode: entry.storageMode || retrievalSource,
    }))
    : [];
  const boundedMemory = Array.isArray(memoryRecords)
    ? memoryRecords
      .slice(0, 2)
      .map((record) => ({
        id: record.id || '',
        type: record.type || '',
        summary: record.summary || '',
      }))
    : [];
  const relationshipSummary = Object.entries(digest.selectedIdea.relationSummary || {})
    .map(([type, count]) => ({
      type,
      label: RELATIONSHIP_LABELS[type] || type,
      count,
    }))
    .slice(0, 5);

  return {
    packageVersion: 1,
    included: true,
    selectedIdea: digest.selectedIdea,
    relatedIdeas: digest.relatedIdeas.slice(0, 3),
    evidenceSummaries: (digest.selectedIdea.evidence || []).map((entry) => ({
      type: entry.type,
      title: entry.title,
      source: entry.source,
    })),
    relationshipSummary,
    promotionState: digest.selectedIdea.promotionState || null,
    memorySummaries: boundedMemory,
    retrievalExcerpts: boundedRetrieval,
    diagnostics: {
      inclusionReason: 'idea-context-package',
      selectedIdeaId: digest.selectedIdea.id,
      bounded: true,
      relatedIncluded: Math.min(digest.relatedIdeas.length, 3),
      memoryIncluded: boundedMemory.length,
      retrievalIncluded: boundedRetrieval.length,
      sourceTruth: {
        persistence: persistenceSource,
        retrieval: retrievalSource,
        memory: memorySource,
        validation: 'caravan-source-validated',
      },
      includedFrom: {
        selectedIdea: 'ideas-tile-state',
        relatedIdeas: digest.relatedIdeas.length ? 'ideas-relation+tag-projection' : 'none',
        evidence: (digest.selectedIdea.evidence || []).length ? 'idea-knowledge-evidence' : 'none',
        memory: boundedMemory.length ? memorySource : 'none',
        retrieval: boundedRetrieval.length ? retrievalSource : 'none',
      },
    },
  };
}

export {
  buildIdeaActions,
  buildIdeaContextPackage,
  buildIdeasKnowledgeDigest,
  createIdeaId,
  startIdeaEdit,
  transitionIdeaPromotionState,
  upsertIdeaRecord,
};
