import { TRACK_LIBRARY } from './data/trackLibrary.js';
import { createMusicTileFlowController } from './flow/musicTileFlowController.js';
import { createMusicTilePlaybackController } from './flow/musicTilePlaybackController.js';
import { parseMusicCommand } from './engine/musicCommandParser.js';
import { createDiscoveryQueries } from './engine/musicDiscoveryEngine.js';
import { createMusicTilePlayerAdapter } from './player/musicTilePlayerAdapter.js';
import { createMediaProviderAdapters } from './providers/mediaProviderAdapters.js';
import { createMusicTileSessionStore } from './state/musicTileSessionStore.js';
import {
  DEFAULT_SELECTION,
  loadMusicTileState,
  saveMusicTileState,
  resetMusicTileState,
  applyRatingToMemory,
  markMediaItemSeen,
  upsertMediaItems,
  buildMediaReliabilityKey,
  upsertReliabilityRecord,
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
  hideBroken: document.getElementById('hide-broken-toggle'),
  showExternalOnly: document.getElementById('show-external-only-toggle'),
  preferInline: document.getElementById('prefer-inline-toggle'),
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
  playerRailBadge: document.getElementById('player-rail-badge'),
  playerFlowBadge: document.getElementById('player-flow-badge'),
  playerResumeBadge: document.getElementById('player-resume-badge'),
  playerSessionState: document.getElementById('player-session-state'),
  playerContinuityNote: document.getElementById('player-continuity-note'),
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
  hideBroken: true,
  showExternalOnly: true,
  preferInline: true,
  artists: [],
  debugVisible: false,
  currentMediaItemId: '',
  playerReady: false,
  playerState: 'idle',
  playerError: '',
  playbackIntentEstablished: false,
  playerErrorType: 'none',
  playbackMode: 'idle',
  fullscreenActive: false,
  positionTimer: null,
  embedBlockedSkipTimer: null,
};

const providerAdapters = createMediaProviderAdapters({
  youtubeApiKey: getYouTubeApiKey(),
  fetchImpl: fetch,
});

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
  if (item?.providerUrl) return item.providerUrl;
  if (item?.id && item.id.length === 11) return `${YOUTUBE_WATCH}${item.id}`;
  return `${YOUTUBE_SEARCH}${encodeURIComponent(`${item?.title || ''} ${item?.channelName || ''}`)}`;
}

function providerBadgeLabel(provider = '') {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === 'youtube') return 'YouTube';
  if (normalized === 'vimeo') return 'Vimeo';
  if (normalized === 'dailymotion') return 'Dailymotion';
  if (normalized === 'twitch') return 'Twitch';
  return normalized || 'Unknown';
}

function playbackBadgeLabel(playbackMode = '') {
  if (playbackMode === 'inline') return 'Inline';
  if (playbackMode === 'external') return 'External';
  return 'Suppressed';
}

function getReliabilityRecord(item) {
  if (!item) return null;
  const key = buildMediaReliabilityKey({
    provider: item.provider,
    providerItemId: item.providerItemId,
    mediaItemId: item.id,
  });
  return key ? state.memory?.reliabilityRecords?.[key] || null : null;
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
      <div class="track-badges">
        <span class="track-badge">${providerBadgeLabel(item.provider)}</span>
        <span class="track-badge">${playbackBadgeLabel(item.playbackMode)}</span>
      </div>
      <div class="track-actions">
        <a data-action="play-now" data-id="${item.id}" class="inline-btn button-link primary" href="${mediaItemLink(item)}" target="_blank" rel="noopener noreferrer">Play</a>
        <a data-action="open-youtube" data-id="${item.id}" class="inline-btn button-link" href="${mediaItemLink(item)}" target="_blank" rel="noopener noreferrer">Open</a>
        <button data-action="play-inline" data-id="${item.id}" class="inline-btn ghost" ${item.playbackMode === 'inline' ? '' : 'disabled'}>Play Inline</button>
        <button data-action="start-flow" data-id="${item.id}" class="inline-btn ghost">Start Flow</button>
        <button data-action="rate" data-id="${item.id}" data-rating="5" class="inline-btn">+5</button>
        <button data-action="rate" data-id="${item.id}" data-rating="3" class="inline-btn">+3</button>
        <button data-action="rate" data-id="${item.id}" data-rating="0" class="inline-btn">0</button>
        <button data-action="rate" data-id="${item.id}" data-rating="-3" class="inline-btn">-3</button>
        <button data-action="save" data-id="${item.id}" class="inline-btn">Save</button>
        <button data-action="more-like" data-id="${item.id}" class="inline-btn">More like this</button>
        <button data-action="less-like" data-id="${item.id}" class="inline-btn">Less like this</button>
        <button data-action="trust" data-channel="${item.channelId}" class="inline-btn">Trust Channel</button>
        <button data-action="block" data-channel="${item.channelId}" class="inline-btn">Hide Source</button>
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
  elements.playerChannel.textContent = current ? `Source: ${current.channelName} • Provider: ${providerBadgeLabel(current.provider)}` : 'Source: —';
  elements.playerModeBadge.textContent = session.mode === 'flow' ? 'Flow Active' : 'Single Item';
  elements.playerRailBadge.textContent = state.playbackMode === 'external' ? 'YouTube Rail' : state.playbackMode === 'inline' ? 'Inline Rail' : 'Idle Rail';
  elements.playerFlowBadge.textContent = session.mode === 'flow' ? `Flow #${Math.max(1, session.currentIndex + 1)}` : 'Flow Off';
  elements.playerResumeBadge.hidden = !showResume;
  elements.playerSessionState.textContent = `State: ${session.flowState}`;
  elements.playerContinuityNote.textContent = showResume
    ? 'This item opened in YouTube. Your Flow session is still waiting here.'
    : '';
  const currentLink = current ? mediaItemLink(current) : 'https://www.youtube.com';
  const currentDisabled = !current;
  elements.openInYoutube.href = currentLink;
  elements.openInYoutube.setAttribute('aria-disabled', String(currentDisabled));
  elements.openInYoutube.tabIndex = currentDisabled ? -1 : 0;
  elements.fallbackOpenBtn.href = currentLink;
  elements.fallbackOpenBtn.setAttribute('aria-disabled', String(currentDisabled));
  elements.fallbackOpenBtn.tabIndex = currentDisabled ? -1 : 0;
  elements.resumeFlowBtn.hidden = !showResume;
  elements.fullBtn.disabled = !playerAdapter.isFullscreenSupported();
  elements.exitFullBtn.disabled = !state.fullscreenActive;
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
    suppressedPreview: Object.values(state.memory.mediaItems)
      .filter((item) => item.playbackMode === 'suppress')
      .slice(0, 10)
      .map((item) => ({ id: item.id, provider: item.provider, reasons: item.validationReasons || [] })),
    providerAdapters: providerAdapters.listProviders(),
    player: {
      ready: state.playerReady,
      state: state.playerState,
      mode: state.playbackMode,
      fullscreenActive: state.fullscreenActive,
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
    provider: 'youtube',
    providerItemId: track.youtube?.preferredVideoId || '',
    providerType: 'video',
    providerUrl: track.youtube?.preferredVideoId ? `${YOUTUBE_WATCH}${track.youtube.preferredVideoId}` : '',
    playbackMode: 'inline',
    availabilityStatus: 'seeded',
    validationStatus: 'seeded',
    validationReasons: [],
    capabilities: {
      canPlayInline: true,
      canOpenExternally: true,
      canFlowInline: true,
      canFlowExternal: true,
      provider: 'youtube',
      providerType: 'video',
      playbackMode: 'inline',
    },
    lastValidationAt: new Date().toISOString(),
    score: 0,
    seen: false,
    saved: false,
    ignored: false,
  };
}

function rebuildFlowQueue() {
  state.queue = flowController.rebuild(Object.values(state.memory.mediaItems), {
    includeSeen: state.includeSeen,
    includeExternal: state.showExternalOnly,
    preferInline: state.preferInline,
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

  const youtubeAdapter = createMediaProviderAdapters({
    youtubeApiKey: getYouTubeApiKey(),
    fetchImpl: fetch,
  }).get('youtube');

  const discoveredItems = [];
  for (const query of queries.slice(0, 4)) {
    const candidates = await youtubeAdapter.discoverCandidates(query, { maxResults: 12 });
    if (!candidates.length) continue;
    const enrichedById = await youtubeAdapter.enrichCandidates(candidates.map((candidate) => candidate.providerItemId));
    candidates.forEach((candidate) => {
      const reliabilityRecord = getReliabilityRecord(candidate);
      const validated = youtubeAdapter.validateCandidate(candidate, {
        enrichedById,
        regionCode: 'US',
        reliabilityRecord,
      });

      const hydrated = {
        ...validated,
        detectedArtists: state.artists,
        type: /set|mix|live/i.test(validated.title) ? 'set' : 'clip',
      };

      if (validated.playbackMode !== 'suppress' || !state.hideBroken) {
        discoveredItems.push(hydrated);
      }

      state.memory = upsertReliabilityRecord(state.memory, {
        mediaItemId: hydrated.id,
        provider: hydrated.provider,
        providerItemId: hydrated.providerItemId,
        suppressionState: hydrated.playbackMode,
        failureReason: (hydrated.validationReasons || [])[0] || '',
        reliabilityClass: hydrated.suppressionClass || '',
        incrementFailure: hydrated.playbackMode === 'suppress',
        validatedAt: hydrated.lastValidationAt,
      });
    });
  }

  const fallbackItems = TRACK_LIBRARY.map(librarySeedToMediaItem);
  const mergedDiscoveredItems = discoveredItems.length ? discoveredItems : fallbackItems;

  state.memory = upsertMediaItems(state.memory, mergedDiscoveredItems);
  state.memory.discoveryJobs.push({
    id: `job-${Date.now()}`,
    artistId: artistObjects[0]?.id || 'any',
    queries: queries.slice(0, 10),
    timestamp: new Date().toISOString(),
    resultsFound: mergedDiscoveredItems.length,
    newItemsCount: mergedDiscoveredItems.filter((item) => !state.memory.seenItemIds.includes(item.id)).length,
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
  state.playbackMode = 'inline';
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

function setInlinePlaybackUnavailableMessage(message) {
  state.playerErrorType = 'embedBlocked';
  state.playerError = `${message} Use "Open in YouTube" for reliable playback.`;
  state.playbackMode = 'external';
  playbackController.onPlaybackError('embedBlocked');
  renderPlayerPanel();
  renderDebug();
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
  while (next && (state.memory?.mediaItems?.[next.id]?.embedBlocked || state.memory?.mediaItems?.[next.id]?.playbackMode !== 'inline')) {
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
    playbackMode: 'external',
    availabilityStatus: 'external_only',
    validationStatus: 'validated',
    validationReasons: Array.from(new Set([...(state.memory.mediaItems[current.id]?.validationReasons || []), 'youtube.embed_blocked'])),
  };
  state.memory = upsertReliabilityRecord(state.memory, {
    mediaItemId: current.id,
    provider: current.provider || 'youtube',
    providerItemId: current.providerItemId || current.id,
    suppressionState: 'external',
    failureReason: 'youtube.embed_blocked',
    reliabilityClass: 'embedBlocked',
    incrementFailure: true,
  });
  persistState();
}

function handleExternalOpenForCurrentItem() {
  const current = getCurrentMediaItem();
  if (!current?.id) return;
  playbackController.onExternalOpen();
  state.playerError = '';
  state.playerErrorType = 'none';
  state.playbackMode = 'external';
  renderPlayerPanel();
  renderDebug();
}

function returnToResults() {
  playerAdapter.stop();
  state.currentMediaItemId = '';
  state.playerState = 'idle';
  state.playerError = '';
  state.playerErrorType = 'none';
  state.playbackMode = 'idle';
  playbackController.clearCurrentSelection();
  renderPlayerPanel();
  renderQueue();
  renderDebug();
}

async function handleQueueAction(event) {
  const actionTarget = event.target.closest('[data-action]');
  if (!actionTarget) return;

  const action = actionTarget.dataset.action;
  if (action === 'rate') {
    state.memory = applyRatingToMemory(state.memory, actionTarget.dataset.id, Number(actionTarget.dataset.rating));
  }
  if (action === 'save') {
    state.memory = applyRatingToMemory(state.memory, actionTarget.dataset.id, 4, 'save');
  }
  if (action === 'more-like') {
    state.memory = applyRatingToMemory(state.memory, actionTarget.dataset.id, 3, 'more-like-this');
  }
  if (action === 'less-like') {
    state.memory = applyRatingToMemory(state.memory, actionTarget.dataset.id, -3, 'less-like-this');
  }

  if (action === 'play-now') {
    event.preventDefault();
    const selected = flowController.selectById(actionTarget.dataset.id) || state.memory.mediaItems[actionTarget.dataset.id];
    if (selected) {
      if (selected.playbackMode === 'external' || selected.embedBlocked) {
        state.currentMediaItemId = selected.id;
        playbackController.enterSingle(selected, { queue: state.queue });
        playbackController.onExternalOpen();
        state.playbackMode = 'external';
      } else if (selected.playbackMode === 'inline') {
        await loadMediaItemIntoPlayer(selected, { autoplay: true, mode: 'single' });
      }
    }
  }

  if (action === 'open-youtube') {
    const selected = flowController.selectById(actionTarget.dataset.id) || state.memory.mediaItems[actionTarget.dataset.id];
    if (selected) {
      state.currentMediaItemId = selected.id;
      playbackController.enterSingle(selected, { queue: state.queue });
      playbackController.onExternalOpen();
      state.playerError = '';
      state.playerErrorType = 'none';
      state.playbackMode = 'external';
    }
  }

  if (action === 'play-inline') {
    const selected = flowController.selectById(actionTarget.dataset.id) || state.memory.mediaItems[actionTarget.dataset.id];
    if (selected) {
      if (selected.playbackMode !== 'inline' || selected.embedBlocked) {
        state.currentMediaItemId = selected.id;
        setInlinePlaybackUnavailableMessage('Play Inline unavailable: this video disables embedding.');
      } else {
        await loadMediaItemIntoPlayer(selected, { autoplay: true, mode: 'single' });
      }
    }
  }

  if (action === 'start-flow') {
    const selected = flowController.selectById(actionTarget.dataset.id) || state.memory.mediaItems[actionTarget.dataset.id];
    if (selected) {
      playbackController.startFlowAtItem(selected, state.queue);
      await loadMediaItemIntoPlayer(selected, { autoplay: true, mode: 'flow' });
    }
  }

  if (action === 'trust' || action === 'block') {
    const channelId = actionTarget.dataset.channel;
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
  const session = sessionStore.read();
  if (session.mode === 'flow') {
    void playNextInQueue();
  }
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
    state.playbackMode = 'inline';
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
      state.playbackMode = 'external';
      markCurrentItemEmbedBlocked();
      state.playerError = 'Play Inline unavailable: embedding is disabled by the video owner. Use Open in YouTube.';
      const session = sessionStore.read();
      if (session.mode === 'flow') {
        clearTimeout(state.embedBlockedSkipTimer);
        state.embedBlockedSkipTimer = window.setTimeout(() => {
          void playNextInQueue();
        }, 1400);
      }
    } else if (errorType === 'unavailable') {
      const current = getCurrentMediaItem();
      if (current?.id) {
        state.memory.mediaItems[current.id] = {
          ...state.memory.mediaItems[current.id],
          playbackMode: 'suppress',
          availabilityStatus: 'suppressed',
          validationStatus: 'blocked',
          validationReasons: Array.from(new Set([...(state.memory.mediaItems[current.id]?.validationReasons || []), 'youtube.unavailable'])),
        };
        state.memory = upsertReliabilityRecord(state.memory, {
          mediaItemId: current.id,
          provider: current.provider || 'youtube',
          providerItemId: current.providerItemId || current.id,
          suppressionState: 'suppress',
          failureReason: 'youtube.unavailable',
          reliabilityClass: 'unavailable',
          incrementFailure: true,
        });
      }
      state.playerError = 'This video is no longer available and has been suppressed from future Flow queues.';
      rebuildFlowQueue();
      persistState();
    } else {
      state.playerError = event.message;
    }
  }
  if (event.type === 'fullscreenChange') {
    state.fullscreenActive = event.isFullscreen === true;
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
  state.hideBroken = true;
  state.showExternalOnly = true;
  state.preferInline = true;
  state.artists = [];
  state.currentMediaItemId = '';
  state.playerState = 'idle';
  state.playerError = '';
  state.playbackIntentEstablished = false;
  state.playerErrorType = 'none';
  state.playbackMode = 'idle';
  clearTimeout(state.embedBlockedSkipTimer);
  elements.artists.value = '';
  elements.mode.value = 'discovery';
  elements.includeSeen.checked = false;
  elements.hideBroken.checked = true;
  elements.showExternalOnly.checked = true;
  elements.preferInline.checked = true;
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
      const current = getCurrentMediaItem();
      if (current?.embedBlocked) {
        setInlinePlaybackUnavailableMessage('Play Inline unavailable: this video disables embedding.');
      } else {
        playerAdapter.play();
      }
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

  elements.openInYoutube.addEventListener('click', (event) => {
    if (elements.openInYoutube.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
      return;
    }
    handleExternalOpenForCurrentItem();
  });
  elements.fallbackOpenBtn.addEventListener('click', (event) => {
    if (elements.fallbackOpenBtn.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
      return;
    }
    handleExternalOpenForCurrentItem();
  });
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
  elements.hideBroken.addEventListener('change', () => {
    state.hideBroken = elements.hideBroken.checked;
    rebuildFlowQueue();
    renderQueue();
  });
  elements.showExternalOnly.addEventListener('change', () => {
    state.showExternalOnly = elements.showExternalOnly.checked;
    rebuildFlowQueue();
    renderQueue();
  });
  elements.preferInline.addEventListener('change', () => {
    state.preferInline = elements.preferInline.checked;
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
    elements.hideBroken.checked = state.hideBroken;
    elements.showExternalOnly.checked = state.showExternalOnly;
    elements.preferInline.checked = state.preferInline;
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
      state.playbackMode = 'external';
      renderPlayerPanel();
      renderDebug();
      console.warn('[music-tile] player init failed', error);
    }
  });

  bindControls();
}

initialize();
