import { sanitizeIdeasState } from './ideas-persistence.js';

function cloneIdeaRecord(record) {
  return {
    id: record.id,
    title: record.title,
    summary: record.summary,
    tags: [...(record.tags || [])],
    media: Array.isArray(record.media) ? record.media.map((media) => ({ ...media })) : [],
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
    { type: 'delete', label: 'Delete' },
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

export {
  buildIdeaActions,
  createIdeaId,
  startIdeaEdit,
  upsertIdeaRecord,
};
