import { sanitizeIdeasState } from './ideas-persistence.js';

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
      }
      : {
        nodeType: 'idea-node',
        collectionId: '',
        actionTarget: '',
        promotionStatus: 'draft',
        relations: [],
        evidence: [],
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

  return [
    { type: 'edit', label: 'Edit' },
  ];
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
    promotionStatus: record.knowledge?.promotionStatus || 'draft',
  }])).values()].slice(0, Math.max(1, Number(maxRelated) || 3));

  const selectedEvidence = (selected.knowledge?.evidence || []).slice(0, Math.max(1, Number(maxEvidence) || 3));

  return {
    selectedIdea: {
      id: selected.id,
      title: selected.title,
      summary: selected.summary,
      promotionStatus: selected.knowledge?.promotionStatus || 'draft',
      actionTarget: selected.knowledge?.actionTarget || '',
      collectionId: selected.knowledge?.collectionId || '',
      evidence: selectedEvidence,
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
    },
  };
}

export {
  buildIdeaActions,
  buildIdeasKnowledgeDigest,
  createIdeaId,
  startIdeaEdit,
  upsertIdeaRecord,
};
