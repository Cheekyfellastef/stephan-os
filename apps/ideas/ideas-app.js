import { createSimulationNodeStore, SIMULATION_NODE_CATEGORIES } from '../../shared/runtime/simulationNodeStore.mjs';

const store = createSimulationNodeStore({ category: SIMULATION_NODE_CATEGORIES.ideas });

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
};

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

seedIfEmpty();
renderIdeas();
