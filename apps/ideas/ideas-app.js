import { createIdeasPersistence, sanitizeIdeasState } from './ideas-persistence.js';
import {
  buildIdeaActions,
  buildIdeaContextPackage,
  buildIdeasKnowledgeDigest,
  startIdeaEdit,
  transitionIdeaPromotionState,
  upsertIdeaRecord,
} from './ideas-model.js';
import { createTileEventBridge } from '../../shared/runtime/tileEventBridge.js';
import { createTileMemoryBridge } from '../../shared/runtime/tileMemoryBridge.js';
import { createTileRetrievalBridge } from '../../shared/runtime/tileRetrievalBridge.js';

const persistence = createIdeasPersistence(window);
const IDEAS_APP_ID = 'ideas';
const IDEAS_DATA_PORT_VERSION = 1;

const SEEDED_IDEAS = [
  {
    id: 'ideas_seed_001',
    title: 'Ideas Atlas foundation',
    summary: 'Map concepts into collections that can later become spaces/worlds without changing truth model.',
    tags: ['ideas', 'atlas', 'simulation-node'],
    media: [
      {
        type: 'text',
        title: 'Seed note',
        source: 'Seeded starter for evolving idea trees and linked spaces.',
        notes: 'Store as reference metadata only.'
      }
    ],
    createdAt: '2026-03-24T00:00:00.000Z',
    updatedAt: '2026-03-24T00:00:00.000Z',
  },
  {
    id: 'ideas_seed_002',
    title: 'Flat-to-VR observation board',
    summary: 'Track repeatable conversion findings from flat games into reusable VR patterns.',
    tags: ['vr', 'experiments', 'techniques'],
    media: [
      {
        type: 'video',
        title: 'RDR2 VR reference run',
        source: 'https://example.invalid/reference/video',
        notes: 'Replace with a real internal or external capture link.'
      },
      {
        type: 'link',
        title: 'Technique notes',
        source: 'VR-Research-Lab/docs/vr-techniques/stereo-rendering-methods.md',
        notes: 'Cross-link existing VR research notes in repo.'
      }
    ],
    createdAt: '2026-03-24T00:00:00.000Z',
    updatedAt: '2026-03-24T00:00:00.000Z',
  },
];

const elements = {
  title: document.getElementById('idea-title'),
  summary: document.getElementById('idea-summary'),
  tags: document.getElementById('idea-tags'),
  nodeType: document.getElementById('idea-node-type'),
  ideaStatus: document.getElementById('idea-status'),
  priority: document.getElementById('idea-priority'),
  collections: document.getElementById('idea-collections'),
  relatedIdeas: document.getElementById('idea-related-ideas'),
  relationType: document.getElementById('idea-relation-type'),
  relationTargetId: document.getElementById('idea-relation-target-id'),
  operatorNotes: document.getElementById('idea-operator-notes'),
  mediaType: document.getElementById('media-type'),
  mediaTitle: document.getElementById('media-title'),
  mediaSource: document.getElementById('media-source'),
  mediaNotes: document.getElementById('media-notes'),
  saveButton: document.getElementById('save-idea'),
  cancelEditButton: document.getElementById('cancel-edit-idea'),
  seedButton: document.getElementById('seed-ideas'),
  status: document.getElementById('save-status'),
  linkStatus: document.getElementById('ideas-link-status'),
  cognitionStatus: document.getElementById('ideas-cognition-status'),
  modeLabel: document.getElementById('idea-form-mode'),
  ideasList: document.getElementById('ideas-list'),
  dataPortText: document.getElementById('ideas-data-port-text'),
  dataPortStatus: document.getElementById('ideas-data-port-status'),
  dataPortExport: document.getElementById('ideas-export-json'),
  dataPortCopy: document.getElementById('ideas-copy-json'),
  dataPortImportClipboard: document.getElementById('ideas-import-clipboard'),
  dataPortImport: document.getElementById('ideas-import-json'),
  dataPortDownload: document.getElementById('ideas-download-json'),
  dataPortUpload: document.getElementById('ideas-upload-json'),
  dataPortUploadInput: document.getElementById('ideas-upload-json-input'),
  importLastResult: document.getElementById('ideas-import-last-result'),
  importRecordCount: document.getElementById('ideas-import-record-count'),
  importLastReason: document.getElementById('ideas-import-last-reason'),
  contextReadButton: document.getElementById('ideas-load-context'),
  submitMemoryButton: document.getElementById('ideas-submit-memory-candidate'),
  submitRetrievalButton: document.getElementById('ideas-submit-retrieval-contribution'),
  contractStatus: document.getElementById('ideas-contract-status'),
};

let state = { records: [] };
let hydrationCompleted = false;
let hydrationSource = 'unknown';
let editingIdeaId = null;
let lastSaveSource = 'none';
let lastExecutionMode = 'unknown';
let lastSaveError = '';
let lastContractStatus = 'No tile contract actions yet.';
let lastRetrievalTruth = 'unavailable';

const tileEventBridge = createTileEventBridge({
  tileId: IDEAS_APP_ID,
  tileSource: 'ideas-tile',
});
const tileMemoryBridge = createTileMemoryBridge({
  tileId: IDEAS_APP_ID,
  tileSource: 'ideas-tile',
});
const tileRetrievalBridge = createTileRetrievalBridge({
  tileId: IDEAS_APP_ID,
  tileSource: 'ideas-tile',
});
if (window.parent && window.parent !== window) {
  window.parent.StephanosTileRetrievalRegistry = window.parent.StephanosTileRetrievalRegistry || {};
  window.parent.StephanosTileRetrievalRegistry[IDEAS_APP_ID] = tileRetrievalBridge;
}

function describeMemoryStatus() {
  if (!hydrationCompleted) {
    return 'memory unavailable (hydrating)';
  }

  if (lastSaveError) {
    return `memory unavailable (${lastSaveError})`;
  }

  if (hydrationSource === 'shared-backend' && lastSaveSource !== 'legacy-local-fallback') {
    return 'memory linked (shared durable)';
  }

  if (hydrationSource === 'shared-backend' && lastSaveSource === 'legacy-local-fallback') {
    return 'memory degraded (legacy local fallback)';
  }

  if (hydrationSource.includes('fallback') || hydrationSource === 'default-state' || hydrationSource === 'unknown') {
    return `memory degraded (${hydrationSource})`;
  }

  return `memory unavailable (${hydrationSource})`;
}

function describeExecutionStatus() {
  if (lastExecutionMode === 'execution-loop-bridge' || lastExecutionMode === 'post-message-bridge') {
    return `tile loop linked (${lastExecutionMode})`;
  }

  if (lastExecutionMode === 'execution-loop-unavailable' || lastExecutionMode === 'missing-bridge') {
    return `tile loop unavailable (${lastExecutionMode})`;
  }

  return `tile loop ${lastExecutionMode}`;
}

function refreshLinkStatus() {
  if (!elements.linkStatus) {
    return;
  }

  elements.linkStatus.textContent = `Tile link: ${describeMemoryStatus()}; ${describeExecutionStatus()}.`;
  if (elements.cognitionStatus) {
    elements.cognitionStatus.textContent = `Cognition truth: persistence=${lastSaveSource || hydrationSource}; memory=${describeMemoryStatus()}; retrieval=${lastRetrievalTruth}.`;
  }
}

function setContractStatus(message) {
  lastContractStatus = String(message || '').trim() || 'No tile contract actions yet.';
  if (elements.contractStatus) {
    elements.contractStatus.textContent = `Tile contract: ${lastContractStatus}`;
  }
}

function logIdeas(event, payload = {}) {
  const logger = window.console || console;
  const target = logger && typeof logger.info === 'function' ? logger : console;
  target.info('[IDEAS TILE DATA]', event, payload);
}

function readAll() {
  return [...state.records].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function publishIdeasTileContext(records = []) {
  const bridge = window.StephanosTileContextBridge;
  if (!bridge?.publishTileContextSnapshot) {
    return null;
  }

  const latestRecord = records[0] || null;
  const digest = buildIdeasKnowledgeDigest(records, {
    selectedIdeaId: latestRecord?.id || '',
    maxRelated: 3,
    maxEvidence: 2,
  });
  const snapshot = bridge.publishTileContextSnapshot(IDEAS_APP_ID, {
    tileTitle: 'Ideas',
    tileType: 'knowledge',
    contextVersion: 2,
    summary: latestRecord
      ? `Ideas has ${records.length} node(s). Focus: ${latestRecord.title}.`
      : 'Ideas currently has no records.',
    structuredData: {
      recordCount: records.length,
      latestIdeaId: latestRecord?.id || '',
      latestIdeaTitle: latestRecord?.title || '',
      tagsPreview: latestRecord?.tags || [],
      knowledgeDigest: digest,
      ideaContextPackage: buildIdeaContextPackage(records, {
        selectedIdeaId: latestRecord?.id || '',
        retrievalSource: lastRetrievalTruth,
        memorySource: describeMemoryStatus(),
        persistenceSource: lastSaveSource || hydrationSource,
      }),
    },
    visibility: 'workspace',
  });

  logIdeas('tile-context-refresh', {
    published: Boolean(snapshot),
    recordCount: records.length,
    latestIdeaId: latestRecord?.id || '',
  });
  return snapshot;
}

function publishIdeasExecutionEvent({ action, summary, result = {}, tags = [] } = {}) {
  const bridge = window.StephanosTileContextBridge;
  if (!bridge?.publishTileExecutionEvent) {
    lastExecutionMode = 'missing-bridge';
    refreshLinkStatus();
    return {
      ok: false,
      reason: 'missing-bridge',
    };
  }

  const response = bridge.publishTileExecutionEvent(IDEAS_APP_ID, {
    tileTitle: 'Ideas',
    action,
    summary,
    result,
    tags: ['ideas', ...tags],
    source: 'ideas-tile',
  });
  if (response?.ok) {
    lastExecutionMode = response.mode || 'execution-loop-bridge';
  } else {
    lastExecutionMode = response?.reason || 'execution-loop-unavailable';
  }
  refreshLinkStatus();
  logIdeas('tile-execution-event', {
    ok: Boolean(response?.ok),
    action,
    mode: response?.mode || response?.reason || 'unknown',
  });
  return response;
}

function emitTileContractEvent({ type, payload, sourceRef, tags = [], retrievalEligible = false } = {}) {
  const response = tileEventBridge.emitEvent({
    type,
    payload,
    sourceRef,
    tags,
    retrievalEligible,
  });
  publishIdeasExecutionEvent({
    action: type,
    summary: `${type} emitted from tile contract bridge.`,
    result: {
      artifact: response.artifact,
      execution_metadata: response.executionMetadata,
    },
    tags: ['tile-contract', ...tags],
  });
  return response;
}

async function writeAll(records) {
  if (!hydrationCompleted) {
    logIdeas('save-blocked', {
      reason: 'hydration-incomplete',
      action: 'write-all',
    });
    throw new Error('Ideas is still hydrating shared data. Try again in a moment.');
  }

  const sanitized = sanitizeIdeasState({ records });
  logIdeas('write-all-requested', {
    hydrationCompleted,
    targetRecordCount: sanitized.records.length,
    idsPreview: sanitized.records.slice(0, 5).map((record) => record.id),
  });
  const saveResult = await persistence.saveState({
    state: sanitized,
    ui: {},
    hydrationCompleted,
  });
  if (!saveResult?.ok) {
    const reason = saveResult?.reason || saveResult?.source || 'save-failed';
    lastSaveError = reason;
    lastSaveSource = saveResult?.source || 'unknown';
    refreshLinkStatus();
    publishIdeasExecutionEvent({
      action: 'ideas.persist.failed',
      summary: `Ideas persistence failed (${reason}).`,
      result: {
        reason,
        source: saveResult?.source || 'unknown',
        recordCount: sanitized.records.length,
      },
      tags: ['save-failed'],
    });
    throw new Error(`Failed to persist Ideas state: ${reason}.`);
  }

  state = sanitized;
  lastSaveSource = saveResult?.source || 'unknown';
  lastSaveError = '';
  refreshLinkStatus();
  publishIdeasTileContext(state.records);
  publishIdeasExecutionEvent({
    action: 'ideas.persist',
    summary: `Ideas persisted ${state.records.length} record(s) through ${saveResult?.source || 'unknown'} path.`,
    result: {
      source: saveResult?.source || 'unknown',
      recordCount: state.records.length,
      hydrationSource,
    },
    tags: [saveResult?.source || 'unknown'],
  });
  logIdeas('backend-save-success', {
    source: saveResult?.source || 'unknown',
    recordCount: state.records.length,
  });
  return sanitized.records;
}

async function upsert(record) {
  logIdeas('upsert-requested', {
    incomingId: record?.id || '',
    title: record?.title || '',
    recordCountBefore: readAll().length,
  });
  const next = upsertIdeaRecord(readAll(), record);
  await writeAll(next);
  logIdeas('upsert-complete', {
    savedId: next[0]?.id || '',
    recordCountAfter: next.length,
  });
  return next[0];
}

function createIdeasExportPayload() {
  return {
    app: IDEAS_APP_ID,
    version: IDEAS_DATA_PORT_VERSION,
    exportedAt: new Date().toISOString(),
    state: sanitizeIdeasState({ records: readAll() }),
    ui: {},
  };
}

function parseImportPayload(rawText) {
  if (!rawText.trim()) {
    return { ok: false, message: 'Import failed: JSON input is empty.' };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    return { ok: false, message: 'Import failed: invalid JSON.' };
  }

  if (!parsed || parsed.app !== IDEAS_APP_ID) {
    return { ok: false, message: 'Import failed: wrong app payload. Expected app "ideas".' };
  }

  const version = Number(parsed.version);
  if (!Number.isFinite(version) || version < 1 || version > IDEAS_DATA_PORT_VERSION) {
    return { ok: false, message: `Import failed: unsupported version. Expected 1-${IDEAS_DATA_PORT_VERSION}.` };
  }

  if (!parsed.state || !Array.isArray(parsed.state.records)) {
    return { ok: false, message: 'Import failed: state.records must be an array.' };
  }

  const sanitizedState = sanitizeIdeasState(parsed.state);
  if (parsed.state.records.length > 0 && sanitizedState.records.length === 0) {
    return { ok: false, message: 'Import failed: no usable idea records found in state.records.' };
  }

  return {
    ok: true,
    state: sanitizedState,
  };
}

function setDataPortStatus(message, tone = 'info') {
  if (!elements.dataPortStatus) {
    return;
  }

  elements.dataPortStatus.textContent = message;
  elements.dataPortStatus.classList.remove('status-success', 'status-error');
  if (tone === 'success') {
    elements.dataPortStatus.classList.add('status-success');
  } else if (tone === 'error') {
    elements.dataPortStatus.classList.add('status-error');
  }
}

function setImportDebugStatus({ success, recordCount = 0, reason = 'N/A' }) {
  if (elements.importLastResult) {
    elements.importLastResult.textContent = success ? 'Success' : 'Failure';
  }

  if (elements.importRecordCount) {
    elements.importRecordCount.textContent = String(recordCount);
  }

  if (elements.importLastReason) {
    elements.importLastReason.textContent = reason;
  }
}

function formatDate(value) {
  if (!value) return 'unknown';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'unknown' : parsed.toLocaleString();
}

function renderIdeas() {
  const records = readAll();
  elements.ideasList.innerHTML = '';

  if (!records.length) {
    elements.ideasList.innerHTML = '<p class="subtle">No idea records saved yet.</p>';
    return;
  }

  records.forEach((record) => {
    const item = document.createElement('article');
    item.className = 'entry';

    const mediaHtml = record.media.length
      ? record.media.map((media) => `
        <div class="media-pill">
          <strong>${media.type}</strong>
          <span>${media.title}</span>
        </div>
        <div class="media-link">${media.source}</div>
      `).join('')
      : '<p class="subtle">No references attached.</p>';

    const actions = buildIdeaActions(record);
    const editAction = actions.find((action) => action.type === 'edit');
    const relationCount = Array.isArray(record.knowledge?.relations) ? record.knowledge.relations.length : 0;
    const collectionCount = Array.isArray(record.collectionIds) ? record.collectionIds.length : 0;
    const memoryState = record.promotionState?.memory || record.knowledge?.promotionState?.memory || 'not-submitted';
    const retrievalState = record.promotionState?.retrieval || record.knowledge?.promotionState?.retrieval || 'not-submitted';
    const codexState = record.promotionState?.codex || record.knowledge?.promotionState?.codex || 'not-prepared';
    const packetReadiness = record.knowledge?.aiContextPackageMeta?.readiness || 'draft';
    const relatedIdeas = Array.isArray(record.relatedIdeas) ? record.relatedIdeas : [];
    const relationSummary = (record.knowledge?.relations || []).reduce((acc, relation) => {
      acc[relation.relationType] = (acc[relation.relationType] || 0) + 1;
      return acc;
    }, {});
    const relationSummaryText = Object.entries(relationSummary)
      .map(([type, count]) => `${type}:${count}`)
      .join(', ') || 'none';
    const collections = Array.isArray(record.collectionIds) ? record.collectionIds : [];
    const sourceTruth = record.sourceTruth || record.knowledge?.sourceTruth || {};

    item.innerHTML = `
      <header>
        <h3 class="headline">${record.title}</h3>
        <p class="subtle">${record.summary || 'No summary provided.'}</p>
        <p class="subtle">Updated: ${formatDate(record.updatedAt)}</p>
      </header>
      <section>
        <strong>Tags:</strong> ${(record.tags || []).join(', ') || 'none'}
      </section>
      <section>
        <strong>References</strong>
        <div>${mediaHtml}</div>
      </section>
      <section>
        <strong>Knowledge</strong>
        <div class="subtle">
          type=${record.nodeType || record.knowledge?.nodeType || 'idea-node'} ·
          status=${record.status || record.knowledge?.status || 'spark'} ·
          priority=${record.priority || record.knowledge?.priority || 'normal'} ·
          collections=${collectionCount} ·
          relationships=${relationCount}
        </div>
        <div class="subtle">
          promotions: memory=${memoryState}, retrieval=${retrievalState}, codex=${codexState}
        </div>
        <div class="subtle">
          packet=${packetReadiness} · related=${relatedIdeas.length} · relationSummary=${relationSummaryText}
        </div>
      </section>
      <section>
        <strong>Collections</strong>
        <div class="pill-row">${collections.length ? collections.map((collection) => `<span class="pill">${collection}</span>`).join('') : '<span class="subtle">none</span>'}</div>
      </section>
      <section>
        <strong>Cognition truth</strong>
        <div class="subtle">
          persistence=${sourceTruth.persistence || lastSaveSource || hydrationSource} ·
          retrieval=${sourceTruth.retrieval || lastRetrievalTruth} ·
          memory=${sourceTruth.memory || 'unknown'} ·
          validation=${sourceTruth.validation || 'caravan-source-validated'}
        </div>
      </section>
      <section class="entry-actions">
        ${editAction ? `<button type="button" class="ghost idea-edit-button" data-idea-edit-id="${record.id}">${editAction.label}</button>` : ''}
        <button type="button" class="ghost" data-idea-promote-memory="${record.id}">Promote Memory</button>
        <button type="button" class="ghost" data-idea-promote-retrieval="${record.id}">Promote Retrieval</button>
        <button type="button" class="ghost" data-idea-promote-codex="${record.id}">Prepare Codex Seed</button>
        <button type="button" class="ghost" data-idea-promote-roadmap="${record.id}">Promote Roadmap Seed</button>
      </section>
    `;

    elements.ideasList.appendChild(item);
  });
}

async function applyImportedIdeas(records, successMessage) {
  const appliedRecords = await writeAll(records);
  setEditMode(null);
  renderIdeas();
  setDataPortStatus(`${successMessage} (${appliedRecords.length} record${appliedRecords.length === 1 ? '' : 's'} imported.)`, 'success');
  setImportDebugStatus({
    success: true,
    recordCount: appliedRecords.length,
    reason: 'Import applied to Ideas state and persisted.',
  });
}

function getFormPayload() {
  const title = elements.title.value.trim();
  const summary = elements.summary.value.trim();
  const tags = elements.tags.value.split(',').map((tag) => tag.trim()).filter(Boolean);
  const collections = elements.collections.value.split(',').map((tag) => tag.trim()).filter(Boolean);
  const relatedIdeas = elements.relatedIdeas.value.split(',').map((tag) => tag.trim()).filter(Boolean);
  const mediaTitle = elements.mediaTitle.value.trim();
  const mediaSource = elements.mediaSource.value.trim();
  const mediaNotes = elements.mediaNotes.value.trim();

  if (!title) {
    throw new Error('Title is required.');
  }

  const media = mediaTitle && mediaSource
    ? [{
      type: elements.mediaType.value,
      title: mediaTitle,
      source: mediaSource,
      notes: mediaNotes,
    }]
    : [];

  const relationTargetId = elements.relationTargetId.value.trim();
  const relationType = elements.relationType.value;
  const relations = relationTargetId
    ? [{
      targetId: relationTargetId,
      relationType,
      notes: '',
      confidence: 'unknown',
    }]
    : [];

  return {
    title,
    summary,
    tags,
    media,
    nodeType: elements.nodeType.value,
    status: elements.ideaStatus.value,
    priority: elements.priority.value,
    collectionIds: collections,
    relatedIdeas,
    notes: elements.operatorNotes.value.trim(),
    knowledge: {
      relations,
      collectionIds: collections,
      relatedIdeas,
      sourceTruth: {
        persistence: lastSaveSource || hydrationSource,
        retrieval: lastRetrievalTruth,
        memory: describeMemoryStatus(),
        validation: 'caravan-source-validated',
      },
      aiContextPackageMeta: {
        packageVersion: 1,
        readiness: 'seed-ready',
        bounded: true,
      },
    },
  };
}

function clearForm() {
  elements.title.value = '';
  elements.summary.value = '';
  elements.tags.value = '';
  elements.nodeType.value = 'idea-node';
  elements.ideaStatus.value = 'spark';
  elements.priority.value = 'normal';
  elements.collections.value = '';
  elements.relatedIdeas.value = '';
  elements.relationTargetId.value = '';
  elements.relationType.value = 'supports';
  elements.operatorNotes.value = '';
  elements.mediaTitle.value = '';
  elements.mediaSource.value = '';
  elements.mediaNotes.value = '';
  elements.mediaType.value = 'text';
}

function setEditMode(record = null) {
  editingIdeaId = record?.id || null;
  if (elements.modeLabel) {
    elements.modeLabel.textContent = editingIdeaId ? `Editing: ${record.title}` : 'Create idea record';
  }

  if (elements.cancelEditButton) {
    elements.cancelEditButton.hidden = !editingIdeaId;
  }

  if (elements.saveButton) {
    elements.saveButton.textContent = editingIdeaId ? 'Update idea' : 'Save idea';
  }

  if (!record) {
    clearForm();
    return;
  }

  elements.title.value = record.title || '';
  elements.summary.value = record.summary || '';
  elements.tags.value = Array.isArray(record.tags) ? record.tags.join(', ') : '';
  elements.nodeType.value = record.nodeType || record.knowledge?.nodeType || 'idea-node';
  elements.ideaStatus.value = record.status || record.knowledge?.status || 'spark';
  elements.priority.value = record.priority || record.knowledge?.priority || 'normal';
  elements.collections.value = Array.isArray(record.collectionIds) ? record.collectionIds.join(', ') : '';
  elements.relatedIdeas.value = Array.isArray(record.relatedIdeas) ? record.relatedIdeas.join(', ') : '';
  const relation = Array.isArray(record.knowledge?.relations) ? record.knowledge.relations[0] : null;
  elements.relationType.value = relation?.relationType || 'supports';
  elements.relationTargetId.value = relation?.targetId || '';
  elements.operatorNotes.value = record.notes || record.knowledge?.operatorNotes || '';
  const media = Array.isArray(record.media) ? record.media[0] : null;
  elements.mediaType.value = media?.type || 'text';
  elements.mediaTitle.value = media?.title || '';
  elements.mediaSource.value = media?.source || '';
  elements.mediaNotes.value = media?.notes || '';
}

function setLoadingState(isLoading) {
  if (elements.saveButton) elements.saveButton.disabled = isLoading;
  if (elements.seedButton) elements.seedButton.disabled = isLoading;
  if (elements.cancelEditButton) elements.cancelEditButton.disabled = isLoading;
  if (isLoading) {
    elements.status.textContent = 'Hydrating Ideas from shared backend…';
  }
}

elements.saveButton?.addEventListener('click', async () => {
  try {
    logIdeas('edit-save', {
      hydrationCompleted,
      editingIdeaId: editingIdeaId || '',
    });

    if (!hydrationCompleted) {
      logIdeas('save-blocked', {
        reason: 'hydration-incomplete',
        action: editingIdeaId ? 'edit-save' : 'create-save',
      });
      elements.status.textContent = 'Ideas is still hydrating shared data. Try again in a moment.';
      return;
    }

    const payload = getFormPayload();
    const wasEditing = Boolean(editingIdeaId);
    logIdeas('save-payload-ready', {
      mode: wasEditing ? 'update' : 'create',
      payloadTitleLength: payload.title.length,
      payloadSummaryLength: payload.summary.length,
      payloadTagCount: payload.tags.length,
      payloadMediaCount: payload.media.length,
      persistenceTarget: hydrationSource,
    });
    const savedRecord = await upsert({
      ...payload,
      id: editingIdeaId || undefined,
    });
    logIdeas('edit-save-result', {
      mode: wasEditing ? 'updated-existing' : 'created-new',
      savedIdeaId: savedRecord.id,
    });

    setEditMode(null);
    elements.status.textContent = `Idea record ${wasEditing ? 'updated' : 'saved'} (${lastSaveSource}).`;
    renderIdeas();
    logIdeas('save-render-complete', {
      savedIdeaId: savedRecord.id,
      renderedRecordCount: readAll().length,
      source: lastSaveSource,
    });

    publishIdeasExecutionEvent({
      action: wasEditing ? 'ideas.update' : 'ideas.create',
      summary: wasEditing
        ? `Updated idea "${savedRecord.title}".`
        : `Created idea "${savedRecord.title}".`,
      result: {
        ideaId: savedRecord.id,
        recordCount: state.records.length,
        source: lastSaveSource,
      },
      tags: [wasEditing ? 'update' : 'create', lastSaveSource],
    });
    try {
      emitTileContractEvent({
        type: wasEditing ? 'idea.updated' : 'idea.created',
        payload: {
          ideaId: savedRecord.id,
          title: savedRecord.title,
          tags: savedRecord.tags || [],
        },
        sourceRef: `idea:${savedRecord.id}`,
        tags: ['ideas', wasEditing ? 'update' : 'create'],
      });
      setContractStatus(`${wasEditing ? 'Updated' : 'Created'} idea artifact ${savedRecord.id}.`);
    } catch (sideEffectError) {
      logIdeas('tile-contract-side-effect-failed', {
        message: sideEffectError?.message || 'unknown side-effect failure',
        savedIdeaId: savedRecord.id,
      });
      setContractStatus(`Tile contract bridge unavailable after save (${sideEffectError?.message || 'unknown'}).`);
    }
  } catch (error) {
    logIdeas('edit-save-failed', {
      message: error?.message || 'Failed to save record.',
      editingIdeaId: editingIdeaId || '',
    });
    elements.status.textContent = error?.message || 'Failed to save record.';
  }
});

elements.cancelEditButton?.addEventListener('click', () => {
  logIdeas('edit-cancel', {
    editingIdeaId: editingIdeaId || '',
  });
  setEditMode(null);
  elements.status.textContent = 'Edit canceled.';
});

elements.seedButton?.addEventListener('click', async () => {
  if (!hydrationCompleted) {
    elements.status.textContent = 'Ideas is still hydrating shared data. Try again in a moment.';
    return;
  }

  await writeAll(SEEDED_IDEAS);
  elements.status.textContent = 'Seed ideas restored.';
  setEditMode(null);
  renderIdeas();
});

elements.contextReadButton?.addEventListener('click', () => {
  const bundle = window.StephanosTileContextBridge?.fetchTileContextBundle?.({
    tileId: IDEAS_APP_ID,
    includeRetrieval: true,
  });
  const memoryCount = Array.isArray(bundle?.memoryRecords) ? bundle.memoryRecords.length : 0;
  const retrievalCount = Array.isArray(bundle?.retrieval) ? bundle.retrieval.length : 0;
  emitTileContractEvent({
    type: 'tile.context.read',
    payload: {
      memoryCount,
      retrievalCount,
      runtimeTruth: bundle?.runtimeTruth || {},
    },
    sourceRef: 'tile:ideas:context-read',
    tags: ['context-read'],
  });
  setContractStatus(`Context read complete (memory=${memoryCount}, retrieval=${retrievalCount}, source=${bundle?.runtimeTruth?.retrievalSource || 'unknown'}).`);
});

function promoteIdeaToMemory(ideaId = '') {
  const target = readAll().find((record) => record.id === ideaId) || readAll()[0];
  if (!target) {
    setContractStatus('Memory candidate skipped: no saved ideas yet.');
    return;
  }

  const result = tileMemoryBridge.submitMemoryCandidate({
    key: `idea.insight.${target.id}`,
    value: target.summary || target.title,
    sourceRef: `idea:${target.id}`,
    reason: 'Operator promoted latest idea insight for durable continuity memory.',
    type: 'tile.result',
    confidence: target.knowledge?.promotionStatus === 'promoted' ? 'high' : 'medium',
    relatedIdeaIds: (target.knowledge?.relations || []).map((relation) => relation.targetId),
    tags: ['ideas', 'memory-candidate', target.knowledge?.promotionStatus || 'draft'],
  });
  if (result?.execution?.adjudication === 'promoted') {
    const promoted = transitionIdeaPromotionState(target, 'memory', 'promoted', {
      notes: 'Adjudicator promoted memory candidate from Ideas tile.',
    });
    if (promoted) {
      const retained = readAll().filter((record) => record.id !== promoted.id);
      state = sanitizeIdeasState({ records: [promoted, ...retained] });
      writeAll(state.records).then(() => renderIdeas()).catch(() => null);
    }
  }
  setContractStatus(`Memory candidate adjudicated (${result.promoted ? 'promoted' : 'rejected'}; mode=${result.execution?.mode || 'unknown'}).`);
}

elements.submitMemoryButton?.addEventListener('click', () => promoteIdeaToMemory());

function promoteIdeaToRetrieval(ideaId = '') {
  const target = readAll().find((record) => record.id === ideaId) || readAll()[0];
  if (!target) {
    setContractStatus('Retrieval contribution skipped: no saved ideas yet.');
    return;
  }

  const result = tileRetrievalBridge.contributeDocument({
    document: `${target.title}\n${target.summary}\nTags: ${(target.tags || []).join(', ')}`,
    sourceRef: `idea:${target.id}`,
    tags: ['ideas', 'retrieval'],
    triggerReindex: true,
  });
  const retrievalState = result.ingested
    ? (result.execution?.mode === 'shared-backed' ? 'ingested' : 'scaffolded-unvalidated')
    : (result.execution?.mode === 'local-fallback' ? 'fallback-only' : 'blocked');
  const promoted = transitionIdeaPromotionState(target, 'retrieval', retrievalState, {
    notes: `Retrieval contribution result (${result.execution?.mode || 'unknown'}).`,
  });
  if (promoted) {
    promoted.sourceTruth = {
      ...(promoted.sourceTruth || promoted.knowledge?.sourceTruth || {}),
      retrieval: result.execution?.mode === 'shared-backed' ? 'shared-backed' : (result.execution?.mode || 'local-fallback'),
      validation: result.execution?.mode === 'shared-backed'
        ? 'implemented-not-battle-bridge-validated'
        : 'caravan-source-validated',
    };
    promoted.knowledge = {
      ...(promoted.knowledge || {}),
      sourceTruth: promoted.sourceTruth,
    };
    const retained = readAll().filter((record) => record.id !== promoted.id);
    state = sanitizeIdeasState({ records: [promoted, ...retained] });
    writeAll(state.records).then(() => renderIdeas()).catch(() => null);
  }
  setContractStatus(`Retrieval contribution ${result.ingested ? 'ingested' : 'blocked'} (allowlisted=${result.allowlisted}; mode=${result.execution?.mode || 'unknown'}).`);
  lastRetrievalTruth = tileRetrievalBridge.getSourceTruth?.() || (result.execution?.mode || 'unavailable');
  refreshLinkStatus();
}

elements.submitRetrievalButton?.addEventListener('click', () => promoteIdeaToRetrieval());

elements.ideasList?.addEventListener('click', (event) => {
  const memoryButton = event?.target?.closest?.('[data-idea-promote-memory]');
  if (memoryButton) {
    const ideaId = memoryButton.getAttribute('data-idea-promote-memory') || '';
    promoteIdeaToMemory(ideaId);
    return;
  }
  const retrievalButton = event?.target?.closest?.('[data-idea-promote-retrieval]');
  if (retrievalButton) {
    const ideaId = retrievalButton.getAttribute('data-idea-promote-retrieval') || '';
    promoteIdeaToRetrieval(ideaId);
    return;
  }
  const codexButton = event?.target?.closest?.('[data-idea-promote-codex]');
  if (codexButton) {
    const ideaId = codexButton.getAttribute('data-idea-promote-codex') || '';
    const selected = readAll().find((record) => record.id === ideaId);
    if (!selected) return;
    const promoted = transitionIdeaPromotionState(selected, 'codex', 'seed-ready', {
      notes: 'Operator marked idea as Codex prompt seed ready.',
    });
    if (promoted) {
      const retained = readAll().filter((record) => record.id !== promoted.id);
      writeAll([promoted, ...retained]).then(() => {
        renderIdeas();
        setContractStatus(`Codex seed prepared for ${promoted.id}.`);
      }).catch(() => null);
    }
    return;
  }
  const roadmapButton = event?.target?.closest?.('[data-idea-promote-roadmap]');
  if (roadmapButton) {
    const ideaId = roadmapButton.getAttribute('data-idea-promote-roadmap') || '';
    const selected = readAll().find((record) => record.id === ideaId);
    if (!selected) return;
    const promoted = transitionIdeaPromotionState(selected, 'roadmap', 'seeded', {
      notes: 'Operator promoted idea into roadmap seed state.',
    });
    if (promoted) {
      const retained = readAll().filter((record) => record.id !== promoted.id);
      writeAll([promoted, ...retained]).then(() => {
        renderIdeas();
        setContractStatus(`Roadmap seed prepared for ${promoted.id}.`);
      }).catch(() => null);
    }
    return;
  }
  const button = event?.target?.closest?.('[data-idea-edit-id]');
  if (!button) {
    return;
  }

  const ideaId = button.getAttribute('data-idea-edit-id') || '';
  const editable = startIdeaEdit(readAll(), ideaId);
  if (!editable) {
    elements.status.textContent = 'Unable to enter edit mode for this record.';
    return;
  }

  logIdeas('edit-mode-started', {
    event: 'edit-start',
    ideaId: editable.id,
    hydrationCompleted,
  });
  setEditMode(editable);
  elements.status.textContent = `Editing idea "${editable.title}".`;
});

elements.dataPortExport?.addEventListener('click', () => {
  const payload = createIdeasExportPayload();
  const jsonText = `${JSON.stringify(payload, null, 2)}\n`;
  if (elements.dataPortText) {
    elements.dataPortText.value = jsonText;
  }
  setDataPortStatus('Export success: Ideas JSON generated.', 'success');
});

elements.dataPortCopy?.addEventListener('click', async () => {
  const jsonText = elements.dataPortText?.value?.trim() || '';
  if (!jsonText) {
    setDataPortStatus('Copy failed: export or paste JSON first.', 'error');
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(jsonText);
    } else if (elements.dataPortText) {
      elements.dataPortText.focus();
      elements.dataPortText.select();
      const copied = document.execCommand?.('copy');
      if (!copied) {
        throw new Error('Clipboard unavailable');
      }
    } else {
      throw new Error('Clipboard unavailable');
    }

    setDataPortStatus('Copy success: JSON copied to clipboard.', 'success');
  } catch (error) {
    setDataPortStatus('Copy failed: clipboard access unavailable.', 'error');
  }
});

elements.dataPortImport?.addEventListener('click', async () => {
  const text = elements.dataPortText?.value || '';
  const parsed = parseImportPayload(text);
  if (!parsed.ok) {
    setDataPortStatus(parsed.message, 'error');
    setImportDebugStatus({ success: false, recordCount: 0, reason: parsed.message });
    return;
  }

  await applyImportedIdeas(parsed.state.records, 'Import success: Ideas state applied');
});

elements.dataPortImportClipboard?.addEventListener('click', async () => {
  try {
    if (!window.isSecureContext || !navigator.clipboard?.readText) {
      throw new Error('Clipboard read unavailable');
    }

    const clipboardText = await navigator.clipboard.readText();
    const parsed = parseImportPayload(clipboardText);
    if (!parsed.ok) {
      setDataPortStatus(parsed.message, 'error');
      setImportDebugStatus({ success: false, recordCount: 0, reason: parsed.message });
      return;
    }

    if (elements.dataPortText) {
      elements.dataPortText.value = `${clipboardText.trim()}\n`;
    }

    await applyImportedIdeas(parsed.state.records, 'Clipboard import success: Ideas state applied');
  } catch (error) {
    const message = 'Clipboard import failed. Paste JSON into the text area and use Import From Text.';
    setDataPortStatus(message, 'error');
    setImportDebugStatus({ success: false, recordCount: 0, reason: message });
  }
});

elements.dataPortDownload?.addEventListener('click', () => {
  const jsonText = elements.dataPortText?.value?.trim() || '';
  if (!jsonText) {
    setDataPortStatus('Download failed: export or paste JSON first.', 'error');
    return;
  }

  try {
    const blob = new Blob([`${jsonText}\n`], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `ideas-data-port-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(downloadUrl);
    setDataPortStatus('Download started.', 'success');
  } catch (error) {
    setDataPortStatus('Download failed: could not create JSON file.', 'error');
  }
});

elements.dataPortUpload?.addEventListener('click', () => {
  elements.dataPortUploadInput?.click();
});

elements.dataPortUploadInput?.addEventListener('change', async (event) => {
  const file = event?.target?.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = typeof file.text === 'function'
      ? await file.text()
      : await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(new Error('Unable to read file.'));
        reader.readAsText(file);
      });

    if (elements.dataPortText) {
      elements.dataPortText.value = text;
    }

    const parsed = parseImportPayload(text);
    if (!parsed.ok) {
      setDataPortStatus(parsed.message, 'error');
      setImportDebugStatus({ success: false, recordCount: 0, reason: parsed.message });
      return;
    }

    await applyImportedIdeas(parsed.state.records, 'Import success: Ideas JSON file applied');
  } catch (error) {
    const message = 'Import failed: unable to read selected file.';
    setDataPortStatus(message, 'error');
    setImportDebugStatus({ success: false, recordCount: 0, reason: message });
  } finally {
    if (event?.target) {
      event.target.value = '';
    }
  }
});

(async function initIdeas() {
  setLoadingState(true);
  setImportDebugStatus({ success: false, recordCount: 0, reason: 'No import attempt yet.' });

  const loaded = await persistence.loadStateWithMeta();
  state = sanitizeIdeasState(loaded.state);
  hydrationSource = loaded.meta.source || 'unknown';
  hydrationCompleted = true;
  lastSaveSource = hydrationSource;
  lastRetrievalTruth = tileRetrievalBridge.getSourceTruth?.() || 'unavailable';
  lastExecutionMode = 'execution-loop-unavailable';
  lastSaveError = '';
  logIdeas('hydration-complete', {
    sourceUsedOnLoad: hydrationSource,
    hydrationCompleted,
    recordCount: state.records.length,
  });
  refreshLinkStatus();

  if (!state.records.length) {
    elements.status.textContent = 'No shared Ideas records yet. Use Save or Re-seed examples.';
  } else {
    elements.status.textContent = `Ideas hydrated from ${hydrationSource}.`;
  }

  setLoadingState(false);
  setEditMode(null);
  renderIdeas();
  publishIdeasTileContext(readAll());
  setContractStatus(lastContractStatus);
})();
