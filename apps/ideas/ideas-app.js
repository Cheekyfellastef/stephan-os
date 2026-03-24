import { createSimulationNodeStore, SIMULATION_NODE_CATEGORIES } from '../../shared/runtime/simulationNodeStore.mjs';

const store = createSimulationNodeStore({ category: SIMULATION_NODE_CATEGORIES.ideas });
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
  seedButton: document.getElementById('seed-ideas'),
  status: document.getElementById('save-status'),
  ideasList: document.getElementById('ideas-list'),
  dataPortText: document.getElementById('ideas-data-port-text'),
  dataPortStatus: document.getElementById('ideas-data-port-status'),
  dataPortExport: document.getElementById('ideas-export-json'),
  dataPortCopy: document.getElementById('ideas-copy-json'),
  dataPortImport: document.getElementById('ideas-import-json'),
  dataPortDownload: document.getElementById('ideas-download-json'),
  dataPortUpload: document.getElementById('ideas-upload-json'),
  dataPortUploadInput: document.getElementById('ideas-upload-json-input'),
};

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeIdeaRecord(record) {
  if (!isRecord(record)) {
    return null;
  }

  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!title || !id) {
    return null;
  }

  return {
    id,
    title,
    summary: typeof record.summary === 'string' ? record.summary.trim() : '',
    tags: Array.isArray(record.tags) ? record.tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean) : [],
    media: Array.isArray(record.media)
      ? record.media
        .filter((media) => isRecord(media))
        .map((media) => ({
          type: typeof media.type === 'string' ? media.type : '',
          title: typeof media.title === 'string' ? media.title : '',
          source: typeof media.source === 'string' ? media.source : '',
          notes: typeof media.notes === 'string' ? media.notes : '',
        }))
      : [],
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
  };
}

function sanitizeIdeasState(value) {
  if (!isRecord(value)) {
    return { records: [] };
  }

  const records = Array.isArray(value.records)
    ? value.records.map(sanitizeIdeaRecord).filter(Boolean)
    : [];

  return { records };
}

function createIdeasExportPayload() {
  const state = sanitizeIdeasState({ records: store.readAll() });
  return {
    app: IDEAS_APP_ID,
    version: IDEAS_DATA_PORT_VERSION,
    exportedAt: new Date().toISOString(),
    state,
    ui: {},
  };
}

function parseImportPayload(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    return { ok: false, message: 'Import failed: invalid JSON.' };
  }

  if (!isRecord(parsed) || parsed.app !== IDEAS_APP_ID) {
    return { ok: false, message: 'Import failed: wrong app payload. Expected app "ideas".' };
  }

  const version = Number(parsed.version);
  if (!Number.isFinite(version) || version < 1 || version > IDEAS_DATA_PORT_VERSION) {
    return { ok: false, message: `Import failed: unsupported version. Expected 1-${IDEAS_DATA_PORT_VERSION}.` };
  }

  if (!isRecord(parsed.state)) {
    return { ok: false, message: 'Import failed: missing state payload.' };
  }

  return {
    ok: true,
    state: sanitizeIdeasState(parsed.state),
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

function formatDate(value) {
  if (!value) return 'unknown';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'unknown' : parsed.toLocaleString();
}

function seedIfEmpty() {
  if (store.readAll().length > 0) {
    return;
  }

  store.writeAll(SEEDED_IDEAS);
}

function renderIdeas() {
  const records = store.readAll();
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
    `;

    elements.ideasList.appendChild(item);
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

elements.saveButton?.addEventListener('click', () => {
  try {
    const payload = getFormPayload();
    store.upsert(payload);
    clearForm();
    elements.status.textContent = 'Idea record saved.';
    renderIdeas();
  } catch (error) {
    elements.status.textContent = error?.message || 'Failed to save record.';
  }
});

elements.seedButton?.addEventListener('click', () => {
  store.writeAll(SEEDED_IDEAS);
  elements.status.textContent = 'Seed ideas restored.';
  renderIdeas();
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

elements.dataPortImport?.addEventListener('click', () => {
  const text = elements.dataPortText?.value || '';
  const parsed = parseImportPayload(text);
  if (!parsed.ok) {
    setDataPortStatus(parsed.message, 'error');
    return;
  }

  store.writeAll(parsed.state.records);
  renderIdeas();
  setDataPortStatus('Import success: Ideas state applied.', 'success');
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
      return;
    }

    store.writeAll(parsed.state.records);
    renderIdeas();
    setDataPortStatus('Import success: Ideas JSON file applied.', 'success');
  } catch (error) {
    setDataPortStatus('Import failed: unable to read selected file.', 'error');
  } finally {
    if (event?.target) {
      event.target.value = '';
    }
  }
});

seedIfEmpty();
renderIdeas();
