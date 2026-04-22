import { TRACK_LIBRARY } from './data/trackLibrary.js';
import { createMusicTileFlowController } from './flow/musicTileFlowController.js';
import { createMusicTilePlaybackController } from './flow/musicTilePlaybackController.js';
import { parseMusicCommand } from './engine/musicCommandParser.js';
import { createDiscoveryQueries, discoverFromYouTubeApi } from './engine/musicDiscoveryEngine.js';
import { createMusicTilePlayerAdapter } from './player/musicTilePlayerAdapter.js';
import { createMusicTileSessionStore } from './state/musicTileSessionStore.js';
import {
  DEFAULT_SELECTION,
  loadMusicTileState,
  saveMusicTileState,
  resetMusicTileState,
  applyRatingToMemory,
  markMediaItemSeen,
  upsertMediaItems,
} from './state/musicTileState.js';

const YOUTUBE_SEARCH = 'https://www.youtube.com/results?search_query=';
const YOUTUBE_WATCH = 'https://www.youtube.com/watch?v=';
const EMBED_BLOCKED_ERROR_CODES = new Set([101, 150]);

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
  playerWrap: document.getElementById('player-frame-wrap'),
  playerStatus: document.getElementById('player-status'),
  playerError: document.getElementById('player-error'),
  playerNowPlaying: document.getElementById('player-now-playing'),
  playerChannel: document.getElementById('player-channel'),
  playerModeBadge: document.getElementById('player-mode-badge'),
  playerSessionState: document.getElementById('player-session-state'),
  openInYoutube: document.getElementById('open-in-youtube-btn'),
  playBtn: document.getElementById('player-play-btn'),
  pauseBtn: document.getElementById('player-pause-btn'),
  stopBtn: document.getElementById('player-stop-btn'),
  nextBtn: document.getElementById('player-next-btn'),
  prevBtn: document.getElementById('player-prev-btn'),
  fullBtn: document.getElementById('player-fullscreen-btn'),
  exitFullBtn: document.getElementById('player-exit-fullscreen-btn'),
  resumeFlowBtn: document.getElementById('player-resume-flow-btn'),
  fallbackActions: document.getElementById('player-fallback-actions'),
  fallbackOpenBtn: document.getElementById('player-fallback-open-btn'),
  fallbackNextBtn: document.getElementById('player-fallback-next-btn'),
  fallbackBackBtn: document.getElementById('player-fallback-back-btn'),
  muteBtn: document.getElementById('player-mute-btn'),
  volume: document.getElementById('player-volume'),
  position: document.getElementById('player-position'),
};

const flowController = createMusicTileFlowController();

const state = {
  selection: { ...DEFAULT_SELECTION },
  memory: null,
  queue: [],
  sessionMode: 'discovery',
  includeSeen: false,
  artists: [],
  debugVisible: false,
  currentMediaItemId: '',
  playerReady: false,
  playerState: 'idle',
  playerError: '',
  playbackIntentEstablished: false,
  playerErrorType: 'none',
  positionTimer: null,
  embedBlockedSkipTimer: null,
};

const sessionStore = createMusicTileSessionStore({
  readMemory: () => state.memory,
  writeMemory: (nextMemory) => {
    state.memory = nextMemory;
    persistState();
  },
});

const playbackController = createMusicTilePlaybackController({
  flowController,
  sessionStore,
  getMediaItemById: (id) => state.memory?.mediaItems?.[id] || null,
});

const playerAdapter = createMusicTilePlayerAdapter({
  containerId: 'yt-player-container',
  mountElement: elements.playerWrap,
  width: 640,
  height: 360,
  onEvent: handlePlayerEvent,
});

function getYouTubeApiKey() {
  return window.STEPHANOS_YOUTUBE_API_KEY || window.localStorage.getItem('stephanos.youtubeApiKey') || '';
}

function mediaItemLink(item) {
  if (item?.id && item.id.length === 11) return `${YOUTUBE_WATCH}${item.id}`;
  return `${YOUTUBE_SEARCH}${encodeURIComponent(`${item?.title || ''} ${item?.channelName || ''}`)}`;
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

function getCurrentMediaItem() {
  if (!state.currentMediaItemId) return null;
  return state.memory.mediaItems[state.currentMediaItemId] || null;
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
    <li class="journey-item ${item.id === state.currentMediaItemId ? 'is-current' : ''}">
      <div><strong>${index + 1}. ${item.title}</strong> — ${item.channelName}</div>
      <div class="track-meta">Score: ${item.score} • ${Math.round((item.duration || 0) / 60)} min • ${item.type}</div>
      <div class="track-actions">
        <button data-action="play-now" data-id="${item.id}" class="inline-btn">Play In Tile</button>
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

function renderPlayerPanel() {
  const current = getCurrentMediaItem();
  const session = sessionStore.read();
  const isEmbedBlocked = state.playerErrorType === 'embedBlocked';
  const showResume = session.flowState === 'externally-opened' && session.resumeAvailable;

  elements.playerStatus.textContent = `Player: ${state.playerState}`;
  elements.playerError.textContent = state.playerError || '';
  elements.playerError.hidden = !state.playerError;
  elements.playerNowPlaying.textContent = current ? current.title : 'No track selected.';
  elements.playerChannel.textContent = current ? `Source: ${current.channelName}` : 'Source: —';
  elements.playerModeBadge.textContent = `Mode: ${session.mode === 'flow' ? 'Flow' : 'Single'}`;
  elements.playerSessionState.textContent = `State: ${session.flowState}`;
  elements.openInYoutube.disabled = !current;
  elements.resumeFlowBtn.hidden = !showResume;
  elements.fullBtn.disabled = !playerAdapter.isFullscreenSupported();
  elements.exitFullBtn.disabled = !playerAdapter.isFullscreenActive();
  elements.fallbackActions.hidden = !isEmbedBlocked;
  elements.fallbackOpenBtn.hidden = !isEmbedBlocked;
  elements.fallbackNextBtn.hidden = !isEmbedBlocked || session.mode !== 'flow';
  elements.fallbackBackBtn.hidden = !isEmbedBlocked || session.mode === 'flow';
}

function renderDebug() {
  elements.debugOutput.textContent = JSON.stringify({
    selection: state.selection,
    sessionMode: state.sessionMode,
    queuePreview: state.queue.slice(0, 10).map((item) => ({ id: item.id, score: item.score, title: item.title })),
    player: {
      ready: state.playerReady,
      state: state.playerState,
      currentMediaItemId: state.currentMediaItemId,
      playbackIntentEstablished: state.playbackIntentEstablished,
      error: state.playerError || null,
    },
    playbackSession: sessionStore.read(),
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
  state.queue = flowController.rebuild(Object.values(state.memory.mediaItems), {
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
  renderPlayerPanel();
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

  if (parsed.intent === 'discover' && parsed.entities.unseen) {
    state.includeSeen = false;
    elements.includeSeen.checked = false;
  }

  rebuildFlowQueue();
  renderSummary();
  renderQueue();
  renderPlayerPanel();
  renderDebug();

  elements.commandOutput.textContent = `Intent: ${parsed.intent} • ${JSON.stringify(parsed.entities)}`;
}

async function loadMediaItemIntoPlayer(item, { autoplay = false, mode = 'single' } = {}) {
  if (!item?.id) return;

  state.currentMediaItemId = item.id;
  state.playerError = '';
  state.playerErrorType = 'none';
  clearTimeout(state.embedBlockedSkipTimer);
  playbackController.onPlaybackError('none');

  if (mode === 'single') {
    playbackController.enterSingle(item, { queue: state.queue });
  }

  renderPlayerPanel();
  renderQueue();

  if (autoplay) {
    state.playbackIntentEstablished = true;
    await playerAdapter.loadVideo(item.id);
  } else {
    await playerAdapter.cueVideo(item.id);
  }
}

async function playFlowFromCurrentQueue() {
  const flowItem = playbackController.startOrResumeFlow(state.queue);
  if (!flowItem) {
    state.playerError = 'Flow queue is empty. Run Smart Refresh to discover tracks.';
    renderPlayerPanel();
    return;
  }

  await loadMediaItemIntoPlayer(flowItem, { autoplay: true, mode: 'flow' });
}

async function playNextInQueue() {
  let next = playbackController.nextInFlow(state.queue);
  while (next && state.memory?.mediaItems?.[next.id]?.embedBlocked) {
    next = playbackController.nextInFlow(state.queue);
  }

  if (!next) {
    state.playerState = 'ended';
    state.playerError = 'Flow queue complete. Refresh to continue.';
    state.playerErrorType = 'none';
    renderPlayerPanel();
    return;
  }

  await loadMediaItemIntoPlayer(next, { autoplay: true, mode: 'flow' });
}

function classifyPlayerErrorType(event) {
  if (EMBED_BLOCKED_ERROR_CODES.has(event.code)) return 'embedBlocked';
  if (event.code === 100) return 'unavailable';
  return 'network';
}

function markCurrentItemEmbedBlocked() {
  const current = getCurrentMediaItem();
  if (!current?.id) return;
  state.memory.mediaItems[current.id] = {
    ...state.memory.mediaItems[current.id],
    embedBlocked: true,
  };
  persistState();
}

function openCurrentItemInYouTube() {
  const current = getCurrentMediaItem();
  if (!current?.id) return;
  const canonicalWatchUrl = `${YOUTUBE_WATCH}${encodeURIComponent(current.id)}`;
  playerAdapter.pause();
  playbackController.onExternalOpen();
  renderPlayerPanel();
  window.open(canonicalWatchUrl, '_blank', 'noopener,noreferrer');
}

function returnToResults() {
  playerAdapter.stop();
  state.currentMediaItemId = '';
  state.playerState = 'idle';
  state.playerError = '';
  state.playerErrorType = 'none';
  playbackController.clearCurrentSelection();
  renderPlayerPanel();
  renderQueue();
  renderDebug();
}

async function handleQueueAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  if (action === 'rate') {
    state.memory = applyRatingToMemory(state.memory, button.dataset.id, Number(button.dataset.rating));
  }

  if (action === 'play-now') {
    const selected = flowController.selectById(button.dataset.id) || state.memory.mediaItems[button.dataset.id];
    if (selected) {
      await loadMediaItemIntoPlayer(selected, { autoplay: true, mode: 'single' });
    }
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
  renderPlayerPanel();
  renderDebug();
}

function onPlayerEnded() {
  const current = getCurrentMediaItem();
  if (!current) return;

  state.memory = markMediaItemSeen(state.memory, current.id);
  persistState();
  rebuildFlowQueue();
  renderSummary();
  renderQueue();
  void playNextInQueue();
}

function handlePlayerEvent(event) {
  if (event.type === 'ready') {
    state.playerReady = true;
    state.playerState = 'ready';
  }

  if (event.type === 'stateChange') {
    state.playerState = event.state;
  }

  if (event.type === 'playing') {
    playbackController.onPlaying(state.currentMediaItemId);
    clearInterval(state.positionTimer);
    state.positionTimer = window.setInterval(() => {
      const current = Math.round(playerAdapter.getCurrentTime());
      const duration = Math.round(playerAdapter.getDuration());
      elements.position.textContent = `${current}s / ${duration || 0}s`;
    }, 1000);
  }

  if (event.type === 'paused') {
    playbackController.onPaused();
  }

  if (event.type === 'paused' || event.type === 'ended') {
    clearInterval(state.positionTimer);
  }

  if (event.type === 'ended') {
    onPlayerEnded();
  }

  if (event.type === 'error') {
    const errorType = classifyPlayerErrorType(event);
    state.playerErrorType = errorType;
    playbackController.onPlaybackError(errorType);

    if (errorType === 'embedBlocked') {
      markCurrentItemEmbedBlocked();
      state.playerError = 'This video cannot be played inside the tile because embedding is disabled by the video owner.';
      const session = sessionStore.read();
      if (session.mode === 'flow') {
        clearTimeout(state.embedBlockedSkipTimer);
        state.embedBlockedSkipTimer = window.setTimeout(() => {
          void playNextInQueue();
        }, 1400);
      }
    } else {
      state.playerError = event.message;
    }
  }

  renderPlayerPanel();
  renderDebug();
}

function resetAll() {
  const reset = resetMusicTileState();
  state.selection = reset.selection;
  state.memory = reset.memory;
  state.sessionMode = 'discovery';
  state.includeSeen = false;
  state.artists = [];
  state.currentMediaItemId = '';
  state.playerState = 'idle';
  state.playerError = '';
  state.playbackIntentEstablished = false;
  state.playerErrorType = 'none';
  clearTimeout(state.embedBlockedSkipTimer);
  elements.artists.value = '';
  elements.mode.value = 'discovery';
  elements.includeSeen.checked = false;
  elements.position.textContent = '0s / 0s';
  writeSelectionToUI(state.selection);
  rebuildFlowQueue();
  renderSummary();
  renderQueue();
  renderPlayerPanel();
  renderDebug();
}

function bindControls() {
  elements.smartRefresh.addEventListener('click', smartRefreshDiscovery);
  elements.flowMode.addEventListener('click', async () => {
    state.sessionMode = 'flow';
    elements.mode.value = 'flow';
    rebuildFlowQueue();
    renderSummary();
    renderQueue();
    await playFlowFromCurrentQueue();
  });

  elements.playBtn.addEventListener('click', () => {
    state.playbackIntentEstablished = true;
    state.playerError = '';
    if (state.currentMediaItemId) {
      playerAdapter.play();
    } else {
      void playFlowFromCurrentQueue();
    }
    renderPlayerPanel();
  });
  elements.pauseBtn.addEventListener('click', () => playerAdapter.pause());
  elements.stopBtn.addEventListener('click', () => playerAdapter.stop());
  elements.nextBtn.addEventListener('click', () => {
    state.playbackIntentEstablished = true;
    void playNextInQueue();
  });
  elements.prevBtn.addEventListener('click', async () => {
    state.playbackIntentEstablished = true;
    const previous = playbackController.previousInFlow(state.queue);
    if (previous) {
      await loadMediaItemIntoPlayer(previous, { autoplay: true, mode: 'flow' });
    }
  });
  elements.fullBtn.addEventListener('click', async () => {
    const ok = await playerAdapter.enterFullscreen();
    if (!ok) {
      state.playerError = 'Fullscreen is unavailable in this browser context.';
      renderPlayerPanel();
    }
  });
  elements.exitFullBtn.addEventListener('click', async () => {
    await playerAdapter.exitFullscreen();
    renderPlayerPanel();
  });
  elements.resumeFlowBtn.addEventListener('click', async () => {
    await playFlowFromCurrentQueue();
  });
  elements.muteBtn.addEventListener('click', () => {
    if (playerAdapter.isMuted()) {
      playerAdapter.unMute();
      elements.muteBtn.textContent = 'Mute';
      return;
    }
    playerAdapter.mute();
    elements.muteBtn.textContent = 'Unmute';
  });
  elements.volume.addEventListener('input', () => {
    playerAdapter.setVolume(elements.volume.value);
  });

  elements.openInYoutube.addEventListener('click', openCurrentItemInYouTube);
  elements.fallbackOpenBtn.addEventListener('click', openCurrentItemInYouTube);
  elements.fallbackNextBtn.addEventListener('click', () => {
    void playNextInQueue();
  });
  elements.fallbackBackBtn.addEventListener('click', returnToResults);

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
  elements.queue.addEventListener('click', (event) => {
    void handleQueueAction(event);
  });

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

  window.addEventListener('beforeunload', () => {
    clearInterval(state.positionTimer);
    clearTimeout(state.embedBlockedSkipTimer);
    playerAdapter.destroy();
  });
}

function initialize() {
  loadMusicTileState().then(async (persisted) => {
    state.selection = persisted.selection;
    state.memory = persisted.memory;
    writeSelectionToUI(state.selection);
    rebuildFlowQueue();
    renderSummary();
    renderQueue();
    renderPlayerPanel();
    renderDebug();

    console.info('[TILE DATA][music-tile] hydrate', {
      appId: 'music-tile',
      sourceUsedOnLoad: persisted?.__tileDataMeta?.source || 'unknown',
      backendDiagnostics: persisted?.__tileDataMeta?.diagnostics || null,
    });

    try {
      await playerAdapter.initPlayer();
    } catch (error) {
      state.playerError = 'YouTube player failed to load. Check network/policy and try again.';
      renderPlayerPanel();
      renderDebug();
      console.warn('[music-tile] player init failed', error);
    }
  });

  bindControls();
}

initialize();
