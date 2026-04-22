import { TRACK_LIBRARY } from './data/trackLibrary.js';
import { parseMusicCommand } from './engine/musicCommandParser.js';
import { createDiscoveryQueries, createFlowQueue, discoverFromYouTubeApi } from './engine/musicDiscoveryEngine.js';
import {
  DEFAULT_SELECTION,
  loadMusicTileState,
  saveMusicTileState,
  resetMusicTileState,
  applyRatingToMemory,
  upsertMediaItems,
} from './state/musicTileState.js';

const YOUTUBE_WATCH = 'https://www.youtube.com/watch?v=';
const YOUTUBE_SEARCH = 'https://www.youtube.com/results?search_query=';

const elements = {
  root: document.getElementById('music-tile-root'),
  era: document.getElementById('era-select'),
  energy: document.getElementById('energy-select'),
  emotion: document.getElementById('emotion-select'),
  density: document.getElementById('density-select'),
  artists: document.getElementById('artist-input'),
  mode: document.getElementById('session-mode-select'),
  includeSeen: document.getElementById('include-seen-toggle'),
  unseenOnly: document.getElementById('unseen-only-toggle'),
  smartRefresh: document.getElementById('smart-refresh-btn'),
  flowMode: document.getElementById('flow-mode-btn'),
  reset: document.getElementById('reset-btn'),
  summary: document.getElementById('summary-grid'),
  queue: document.getElementById('journey-list'),
  commandInput: document.getElementById('command-input'),
  commandRun: document.getElementById('command-run-btn'),
  commandOutput: document.getElementById('command-output'),
  debugToggle: document.getElementById('debug-toggle'),
  debugPanel: document.getElementById('debug-panel'),
  debugOutput: document.getElementById('debug-output'),
};

const state = {
  selection: { ...DEFAULT_SELECTION },
  memory: null,
  queue: [],
  sessionMode: 'discovery',
  includeSeen: false,
  artists: [],
  debugVisible: false,
};

function getYouTubeApiKey() {
  return window.STEPHANOS_YOUTUBE_API_KEY || window.localStorage.getItem('stephanos.youtubeApiKey') || '';
}

function mediaItemLink(item) {
  if (item.id && item.id.length === 11) return `${YOUTUBE_WATCH}${item.id}`;
  return `${YOUTUBE_SEARCH}${encodeURIComponent(`${item.title} ${item.channelName}`)}`;
}

function readSelectionFromUI() {
  return {
    era: elements.era.value,
    energyCurve: elements.energy.value,
    emotion: elements.emotion.value,
    density: elements.density.value,
  };
}

function writeSelectionToUI(selection) {
  elements.era.value = selection.era;
  elements.energy.value = selection.energyCurve;
  elements.emotion.value = selection.emotion;
  elements.density.value = selection.density;
  elements.root.dataset.theme = selection.era;
}

function persistState() {
  saveMusicTileState({
    selection: state.selection,
    memory: state.memory,
  });
}

function renderSummary() {
  const unseenCount = Object.values(state.memory.mediaItems).filter((item) => !item.seen).length;
  const ratingsCount = state.memory.ratings.length;
  const trustedChannels = Object.values(state.memory.sourceChannels).filter((channel) => channel.trustScore >= 2).length;
  const topArtist = Object.entries(state.memory.artistAffinity).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None yet';

  elements.summary.innerHTML = [
    ['Session Mode', state.sessionMode],
    ['Artists', state.artists.join(', ') || 'Any'],
    ['Unseen Library', String(unseenCount)],
    ['Ratings Logged', String(ratingsCount)],
    ['Trusted Sources', String(trustedChannels)],
    ['Top Affinity', topArtist],
  ].map(([label, value]) => `
    <article class="summary-card">
      <strong>${label}</strong>
      <span>${value}</span>
    </article>
  `).join('');
}

function renderQueue() {
  if (!state.queue.length) {
    elements.queue.innerHTML = '<li class="journey-item">No discovery results yet. Run Smart Refresh.</li>';
    return;
  }

  elements.queue.innerHTML = state.queue.map((item, index) => `
    <li class="journey-item">
      <div><strong>${index + 1}. ${item.title}</strong> — ${item.channelName}</div>
      <div class="track-meta">Score: ${item.score} • ${Math.round((item.duration || 0) / 60)} min • ${item.type}</div>
      <div class="track-actions">
        <a href="${mediaItemLink(item)}" target="_blank" rel="noopener noreferrer">Open</a>
        <button data-action="rate" data-id="${item.id}" data-rating="5" class="inline-btn">+5</button>
        <button data-action="rate" data-id="${item.id}" data-rating="3" class="inline-btn">+3</button>
        <button data-action="rate" data-id="${item.id}" data-rating="0" class="inline-btn">0</button>
        <button data-action="rate" data-id="${item.id}" data-rating="-3" class="inline-btn">-3</button>
        <button data-action="trust" data-channel="${item.channelId}" class="inline-btn">Trust Channel</button>
        <button data-action="block" data-channel="${item.channelId}" class="inline-btn">Block Channel</button>
      </div>
    </li>
  `).join('');
}

function renderDebug() {
  elements.debugOutput.textContent = JSON.stringify({
    selection: state.selection,
    sessionMode: state.sessionMode,
    queuePreview: state.queue.slice(0, 10).map((item) => ({ id: item.id, score: item.score, title: item.title })),
    memoryStats: {
      mediaItems: Object.keys(state.memory.mediaItems).length,
      seen: state.memory.seenItemIds.length,
      saved: state.memory.savedItemIds.length,
      ignored: state.memory.ignoredItemIds.length,
      ratings: state.memory.ratings.length,
    },
  }, null, 2);
}

function librarySeedToMediaItem(track) {
  return {
    id: track.youtube?.preferredVideoId || `${track.id}-seed`,
    title: `${track.artist} — ${track.title}`,
    description: track.notes,
    channelId: `seed-${track.artist.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    channelName: `${track.artist} (seed)`,
    duration: Math.max(180, Math.round((track.approximateBpm || 120) * 16)),
    publishDate: '2022-01-01T00:00:00.000Z',
    thumbnail: '',
    detectedArtists: [track.artist],
    detectedEvents: [],
    detectedLabels: [],
    type: track.notes?.toLowerCase().includes('set') ? 'set' : 'track',
    score: 0,
    seen: false,
    saved: false,
    ignored: false,
  };
}

function rebuildFlowQueue() {
  const mediaItems = Object.values(state.memory.mediaItems);
  state.queue = createFlowQueue(mediaItems, {
    includeSeen: state.includeSeen,
    minDurationSeconds: state.sessionMode === 'flow' ? 30 * 60 : 0,
    trustByChannel: state.memory.channelTrust,
    affinityByArtist: state.memory.artistAffinity,
    seenIds: new Set(state.memory.seenItemIds),
  });
}

async function smartRefreshDiscovery() {
  state.selection = readSelectionFromUI();
  state.artists = elements.artists.value.split(',').map((value) => value.trim()).filter(Boolean);

  const artistObjects = state.artists.map((name) => ({ id: name.toLowerCase(), name }));
  const queries = artistObjects.flatMap((artist) => createDiscoveryQueries(artist));

  const apiKey = getYouTubeApiKey();
  const discovery = await discoverFromYouTubeApi({
    apiKey,
    queries: queries.slice(0, 4),
    maxResults: 12,
  });

  const discoveredItems = discovery.items.length
    ? discovery.items.map((item) => ({
      ...item,
      detectedArtists: state.artists,
      type: /set|mix|live/i.test(item.title) ? 'set' : 'clip',
    }))
    : TRACK_LIBRARY.map(librarySeedToMediaItem);

  state.memory = upsertMediaItems(state.memory, discoveredItems);
  state.memory.discoveryJobs.push({
    id: `job-${Date.now()}`,
    artistId: artistObjects[0]?.id || 'any',
    queries: queries.slice(0, 10),
    timestamp: new Date().toISOString(),
    resultsFound: discoveredItems.length,
    newItemsCount: discoveredItems.filter((item) => !state.memory.seenItemIds.includes(item.id)).length,
  });

  rebuildFlowQueue();
  persistState();
  renderSummary();
  renderQueue();
  renderDebug();
}

function executeCommand() {
  const parsed = parseMusicCommand(elements.commandInput.value);

  if (parsed.intent === 'filter') {
    state.includeSeen = !parsed.entities.unseen;
    elements.includeSeen.checked = state.includeSeen;
  }

  if (parsed.intent === 'play') {
    state.sessionMode = parsed.entities.mode || 'flow';
    elements.mode.value = state.sessionMode;
  }

  if (parsed.intent === 'discover') {
    if (parsed.entities.unseen) {
      state.includeSeen = false;
      elements.includeSeen.checked = false;
    }
  }

  rebuildFlowQueue();
  renderSummary();
  renderQueue();
  renderDebug();

  elements.commandOutput.textContent = `Intent: ${parsed.intent} • ${JSON.stringify(parsed.entities)}`;
}

function onQueueAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  if (action === 'rate') {
    state.memory = applyRatingToMemory(state.memory, button.dataset.id, Number(button.dataset.rating));
  }

  if (action === 'trust' || action === 'block') {
    const channelId = button.dataset.channel;
    const current = state.memory.channelTrust[channelId] || 0;
    state.memory.channelTrust[channelId] = Math.max(-5, Math.min(5, current + (action === 'trust' ? 1 : -3)));
  }

  rebuildFlowQueue();
  persistState();
  renderSummary();
  renderQueue();
  renderDebug();
}

function resetAll() {
  const reset = resetMusicTileState();
  state.selection = reset.selection;
  state.memory = reset.memory;
  state.sessionMode = 'discovery';
  state.includeSeen = false;
  state.artists = [];
  elements.artists.value = '';
  elements.mode.value = 'discovery';
  elements.includeSeen.checked = false;
  writeSelectionToUI(state.selection);
  rebuildFlowQueue();
  renderSummary();
  renderQueue();
  renderDebug();
}

function initialize() {
  loadMusicTileState().then((persisted) => {
    state.selection = persisted.selection;
    state.memory = persisted.memory;
    writeSelectionToUI(state.selection);
    rebuildFlowQueue();
    renderSummary();
    renderQueue();
    renderDebug();

    console.info('[TILE DATA][music-tile] hydrate', {
      appId: 'music-tile',
      sourceUsedOnLoad: persisted?.__tileDataMeta?.source || 'unknown',
      backendDiagnostics: persisted?.__tileDataMeta?.diagnostics || null,
    });
  });

  elements.smartRefresh.addEventListener('click', smartRefreshDiscovery);
  elements.flowMode.addEventListener('click', () => {
    state.sessionMode = 'flow';
    elements.mode.value = 'flow';
    rebuildFlowQueue();
    renderSummary();
    renderQueue();
  });
  elements.mode.addEventListener('change', () => {
    state.sessionMode = elements.mode.value;
    rebuildFlowQueue();
    renderSummary();
    renderQueue();
  });
  elements.includeSeen.addEventListener('change', () => {
    state.includeSeen = elements.includeSeen.checked;
    rebuildFlowQueue();
    renderQueue();
  });
  elements.unseenOnly.addEventListener('change', () => {
    if (elements.unseenOnly.checked) {
      state.includeSeen = false;
      elements.includeSeen.checked = false;
      rebuildFlowQueue();
      renderQueue();
    }
  });
  elements.reset.addEventListener('click', resetAll);
  elements.commandRun.addEventListener('click', executeCommand);
  elements.queue.addEventListener('click', onQueueAction);

  [elements.era, elements.energy, elements.emotion, elements.density].forEach((control) => {
    control.addEventListener('change', () => {
      state.selection = readSelectionFromUI();
      persistState();
    });
  });

  elements.debugToggle.addEventListener('click', () => {
    state.debugVisible = !state.debugVisible;
    elements.debugPanel.hidden = !state.debugVisible;
  });
}

initialize();
