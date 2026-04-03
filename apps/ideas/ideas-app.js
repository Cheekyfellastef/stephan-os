import { createIdeasPersistence, sanitizeIdeasState } from './ideas-persistence.js';
import { buildIdeaActions, startIdeaEdit, upsertIdeaRecord } from './ideas-model.js';

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
  mediaType: document.getElementById('media-type'),
  mediaTitle: document.getElementById('media-title'),
  mediaSource: document.getElementById('media-source'),
  mediaNotes: document.getElementById('media-notes'),
  saveButton: document.getElementById('save-idea'),
  cancelEditButton: document.getElementById('cancel-edit-idea'),
  seedButton: document.getElementById('seed-ideas'),
  status: document.getElementById('save-status'),
  linkStatus: document.getElementById('ideas-link-status'),
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
};

let state = { records: [] };
let hydrationCompleted = false;
let hydrationSource = 'unknown';
let editingIdeaId = null;

function setTileLinkStatus(message) {
  if (elements.linkStatus) {
    elements.linkStatus.textContent = message;
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
  const snapshot = bridge.publishTileContextSnapshot(IDEAS_APP_ID, {
    tileTitle: 'Ideas',
    tileType: 'knowledge',
    contextVersion: 1,
    summary: latestRecord
      ? `Ideas has ${records.length} record(s). Latest: ${latestRecord.title}.`
      : 'Ideas currently has no records.',
    structuredData: {
      recordCount: records.length,
      latestIdeaId: latestRecord?.id || '',
      latestIdeaTitle: latestRecord?.title || '',
      tagsPreview: latestRecord?.tags || [],
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
    setTileLinkStatus('Tile link: isolated (execution loop unavailable).');
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
    setTileLinkStatus(`Tile link: linked (${response.mode}).`);
  } else {
    setTileLinkStatus('Tile link: isolated (degraded local-only event flow).');
  }
  logIdeas('tile-execution-event', {
    ok: Boolean(response?.ok),
    action,
    mode: response?.mode || response?.reason || 'unknown',
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
  state = sanitized;
  const saveResult = await persistence.saveState({
    state,
    ui: {},
    hydrationCompleted,
  });
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
  const next = upsertIdeaRecord(readAll(), record);
  await writeAll(next);
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
      <section class="entry-actions">
        ${editAction ? `<button type="button" class="ghost idea-edit-button" data-idea-edit-id="${record.id}">${editAction.label}</button>` : ''}
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

  return {
    title,
    summary,
    tags,
    media,
  };
}

function clearForm() {
  elements.title.value = '';
  elements.summary.value = '';
  elements.tags.value = '';
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

  if (!record) {
    clearForm();
    return;
  }

  elements.title.value = record.title || '';
  elements.summary.value = record.summary || '';
  elements.tags.value = Array.isArray(record.tags) ? record.tags.join(', ') : '';
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
    logIdeas('edit-save-attempted', {
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
    const savedRecord = await upsert({
      ...payload,
      id: editingIdeaId || undefined,
    });
    logIdeas('edit-save-result', {
      mode: wasEditing ? 'updated-existing' : 'created-new',
      savedIdeaId: savedRecord.id,
    });

    setEditMode(null);
    elements.status.textContent = `Idea record ${wasEditing ? 'updated' : 'saved'} (${hydrationSource}).`;
    renderIdeas();
  } catch (error) {
    elements.status.textContent = error?.message || 'Failed to save record.';
  }
});

elements.cancelEditButton?.addEventListener('click', () => {
  logIdeas('edit-cancelled', {
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

elements.ideasList?.addEventListener('click', (event) => {
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
  logIdeas('hydration-complete', {
    sourceUsedOnLoad: hydrationSource,
    hydrationCompleted,
    recordCount: state.records.length,
  });
  setTileLinkStatus(hydrationSource === 'shared-backend'
    ? 'Tile link: shared memory linked.'
    : `Tile link: degraded (${hydrationSource}).`);

  if (!state.records.length) {
    elements.status.textContent = 'No shared Ideas records yet. Use Save or Re-seed examples.';
  } else {
    elements.status.textContent = `Ideas hydrated from ${hydrationSource}.`;
  }

  setLoadingState(false);
  setEditMode(null);
  renderIdeas();
  publishIdeasTileContext(readAll());
})();
