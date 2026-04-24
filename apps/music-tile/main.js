import { TRACK_LIBRARY } from './data/trackLibrary.js';
import { createMusicTileFlowController } from './flow/musicTileFlowController.js';
import { createMusicTilePlaybackController } from './flow/musicTilePlaybackController.js';
import { parseMusicCommand } from './engine/musicCommandParser.js';
import { applyArtistSearchContext, createDiscoveryQueries } from './engine/musicDiscoveryEngine.js';
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
const SMART_REFRESH_TARGET_RESULTS = 20;
const SMART_REFRESH_MIN_RESULTS = 12;
const DEEP_DIVE_MIN_DURATION_SECONDS = 30 * 60;
const RATING_OPTIONS = [
  { value: -5, label: '👎👎 Strong Down', compact: '👎👎', title: 'Show me much less like this' },
  { value: -3, label: '👎 Down', compact: '👎', title: 'Show me less like this' },
  { value: 0, label: 'Neutral', compact: 'Neutral', title: 'No strong taste signal' },
  { value: 3, label: '👍 Up', compact: '👍', title: 'Show me more like this' },
  { value: 5, label: '👍👍 Strong Up', compact: '👍👍', title: 'This is my territory' },
];

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
  playbackStatus: document.getElementById('playback-status'),
  playbackNowPlaying: document.getElementById('playback-now-playing'),
  playbackChannel: document.getElementById('playback-channel'),
  playbackModeBadge: document.getElementById('playback-mode-badge'),
  playbackFlowBadge: document.getElementById('playback-flow-badge'),
  playbackResumeBadge: document.getElementById('playback-resume-badge'),
  playbackSessionState: document.getElementById('playback-session-state'),
  playbackContinuityNote: document.getElementById('playback-continuity-note'),
  openInYoutube: document.getElementById('open-in-youtube-btn'),
  playBtn: document.getElementById('playback-play-btn'),
  flowBtn: document.getElementById('playback-flow-btn'),
  nextBtn: document.getElementById('playback-next-btn'),
  prevBtn: document.getElementById('playback-prev-btn'),
  resumeFlowBtn: document.getElementById('player-resume-flow-btn'),
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
  artists: [],
  debugVisible: false,
  currentMediaItemId: '',
  playbackError: '',
  queueDebug: {
    artistSearchActive: false,
    activeArtists: [],
    counts: {
      before: 0,
      discoveredThisRefresh: 0,
      suppressed: 0,
      availability: 0,
      strongMatches: 0,
      softMatches: 0,
      generalMatches: 0,
      backfilled: 0,
      finalQueue: 0,
    },
    currentModeMinDuration: 0,
  },
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

function getYouTubeApiKey() {
  return window.STEPHANOS_YOUTUBE_API_KEY || window.localStorage.getItem('stephanos.youtubeApiKey') || '';
}

function mediaItemLink(item) {
  if (item?.providerItemId) return `${YOUTUBE_WATCH}${item.providerItemId}`;
  if (item?.providerUrl) return item.providerUrl;
  if (item?.id && item.id.length === 11) return `${YOUTUBE_WATCH}${item.id}`;
  return `${YOUTUBE_SEARCH}${encodeURIComponent(`${item?.title || ''} ${item?.channelName || ''}`)}`;
}

function resolveItemRankScore(item) {
  if (!item) return 0;
  const finalRankScore = Number(item.finalRankScore);
  if (Number.isFinite(finalRankScore)) return finalRankScore;
  const discoveryScore = Number(item.discoveryScore);
  if (Number.isFinite(discoveryScore)) return discoveryScore;
  const legacyScore = Number(item.score);
  return Number.isFinite(legacyScore) ? legacyScore : 0;
}

function formatTaste(rating) {
  const numericRating = Number(rating);
  if (!Number.isFinite(numericRating)) return 'unrated';
  return RATING_OPTIONS.find((option) => option.value === numericRating)?.compact || `Rated ${numericRating}`;
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
  if (playbackMode === 'external' || playbackMode === 'inline') return 'YouTube';
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

  const currentRatingsByMediaId = state.memory.ratings.reduce((acc, entry) => {
    if (!entry?.mediaItemId) return acc;
    if (!acc[entry.mediaItemId] || new Date(entry.timestamp).getTime() >= new Date(acc[entry.mediaItemId].timestamp).getTime()) {
      acc[entry.mediaItemId] = entry;
    }
    return acc;
  }, {});

  elements.queue.innerHTML = state.queue.map((item, index) => {
    const latestRating = currentRatingsByMediaId[item.id]?.rating;
    const persistedRating = Number.isFinite(Number(item.userRating)) ? Number(item.userRating) : latestRating;
    const rankScore = resolveItemRankScore(item);
    return `
    <li class="journey-item ${item.id === state.currentMediaItemId ? 'is-current' : ''}">
      <div><strong>${index + 1}. ${item.title}</strong> — ${item.channelName}</div>
      <div class="track-meta">Rank: ${rankScore.toFixed(2)} • ${Math.round((item.duration || 0) / 60)} min • ${item.type}</div>
      <div class="track-meta">Taste: ${formatTaste(persistedRating)}</div>
      <div class="track-badges">
        <span class="track-badge">${providerBadgeLabel(item.provider)}</span>
        <span class="track-badge">${playbackBadgeLabel(item.playbackMode)}</span>
        ${item.relevanceTier ? `<span class="track-badge">Tier: ${item.relevanceTier}</span>` : ''}
      </div>
      <div class="track-actions">
        <a data-action="play-now" data-id="${item.id}" class="inline-btn button-link primary" href="${mediaItemLink(item)}" target="_blank" rel="noopener noreferrer">Play</a>
        <a data-action="open-youtube" data-id="${item.id}" class="inline-btn button-link" href="${mediaItemLink(item)}" target="_blank" rel="noopener noreferrer">Open in YouTube</a>
        <button data-action="start-flow" data-id="${item.id}" class="inline-btn ghost">Start Flow</button>
        ${RATING_OPTIONS.map((option) => `
          <button
            data-action="rate"
            data-id="${item.id}"
            data-rating="${option.value}"
            class="inline-btn rating-btn ${Number(persistedRating) === option.value ? 'is-selected' : ''}"
            title="${option.title}"
            aria-label="${option.label}"
          >${option.compact}</button>
        `).join('')}
        <button data-action="save" data-id="${item.id}" class="inline-btn">Save</button>
        <button data-action="more-like" data-id="${item.id}" class="inline-btn">More like this</button>
        <button data-action="less-like" data-id="${item.id}" class="inline-btn">Less like this</button>
        <button data-action="trust" data-channel="${item.channelId}" class="inline-btn">Trust Channel</button>
        <button data-action="block" data-channel="${item.channelId}" class="inline-btn">Hide Source</button>
      </div>
    </li>
  `;
  }).join('');
}

function renderPlaybackPanel() {
  const current = getCurrentMediaItem();
  const session = sessionStore.read();
  const showResume = session.flowState === 'externally-opened' && session.resumeAvailable;

  elements.playbackStatus.textContent = state.playbackError
    ? `Route: YouTube external open • ${state.playbackError}`
    : 'Route: YouTube external open';
  elements.playbackNowPlaying.textContent = current ? current.title : 'No item selected yet.';
  elements.playbackChannel.textContent = current ? `Source: ${current.channelName} • Provider: ${providerBadgeLabel(current.provider)}` : 'Source: —';
  elements.playbackModeBadge.textContent = session.mode === 'flow' ? 'Flow Active' : 'Single Item';
  elements.playbackFlowBadge.textContent = session.mode === 'flow' ? `Flow #${Math.max(1, session.currentIndex + 1)}` : 'Flow Off';
  elements.playbackResumeBadge.hidden = !showResume;
  elements.playbackSessionState.textContent = `State: ${session.flowState}`;
  elements.playbackContinuityNote.textContent = showResume
    ? 'Opened externally. Flow session is paused and ready to resume.'
    : '';

  const currentLink = current ? mediaItemLink(current) : 'https://www.youtube.com';
  const currentDisabled = !current;
  elements.openInYoutube.href = currentLink;
  elements.openInYoutube.setAttribute('aria-disabled', String(currentDisabled));
  elements.openInYoutube.tabIndex = currentDisabled ? -1 : 0;
  elements.resumeFlowBtn.hidden = !showResume;
}

function renderDebug() {
  elements.debugOutput.textContent = JSON.stringify({
    selection: state.selection,
    sessionMode: state.sessionMode,
    searchContext: {
      artists: state.artists,
      artistSearchActive: state.queueDebug.artistSearchActive,
      queueCounts: state.queueDebug.counts,
    },
    queuePreview: state.queue.slice(0, 10).map((item) => ({
      id: item.id,
      score: resolveItemRankScore(item),
      artistRelevanceScore: item.artistRelevanceScore || 0,
      relevanceTier: item.relevanceTier || 'general',
      relevanceReasons: item.relevanceReasons || [],
      title: item.title,
      finalScore: resolveItemRankScore(item),
      userRating: Number.isFinite(Number(item.userRating)) ? Number(item.userRating) : null,
    })),
    suppressedPreview: Object.values(state.memory.mediaItems)
      .filter((item) => item.playbackMode === 'suppress')
      .slice(0, 10)
      .map((item) => ({ id: item.id, provider: item.provider, reasons: item.validationReasons || [] })),
    providerAdapters: providerAdapters.listProviders(),
    playback: {
      route: 'youtube-external',
      currentMediaItemId: state.currentMediaItemId,
      error: state.playbackError || null,
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
    playbackMode: 'external',
    availabilityStatus: 'seeded',
    validationStatus: 'seeded',
    validationReasons: [],
    capabilities: {
      canPlayInline: false,
      canOpenExternally: true,
      canFlowInline: false,
      canFlowExternal: true,
      provider: 'youtube',
      providerType: 'video',
      playbackMode: 'external',
    },
    lastValidationAt: new Date().toISOString(),
    discoveryScore: 0,
    finalRankScore: 0,
    score: 0,
    seen: false,
    saved: false,
    ignored: false,
  };
}

function rebuildFlowQueue() {
  const allItems = Object.values(state.memory.mediaItems);
  const availableItems = allItems.filter((item) => {
    if (item.ignored) return false;
    if (item.playbackMode === 'suppress' && state.hideBroken) return false;
    if (state.showExternalOnly && item.playbackMode !== 'external') return false;
    return true;
  });
  const artistSearchActive = state.artists.length > 0;
  const artistContextResult = applyArtistSearchContext(availableItems, {
    activeArtists: state.artists.map((name) => ({ name })),
    artistSearchActive,
  });

  const strongMatches = artistContextResult.filteredItems.filter((item) => item.relevanceTier === 'strong');
  const softMatches = artistContextResult.filteredItems.filter((item) => item.relevanceTier === 'soft');
  const generalMatches = artistContextResult.filteredItems.filter((item) => item.relevanceTier === 'general');
  const recentDiscoveries = generalMatches.filter((item) => item.artistSearchSource);
  const seededLibraryFallback = generalMatches.filter((item) => item.validationStatus === 'seeded' || item.availabilityStatus === 'seeded');

  const prioritizedCandidates = [];
  const pushUnique = (items) => {
    items.forEach((item) => {
      if (prioritizedCandidates.some((candidate) => candidate.id === item.id)) return;
      prioritizedCandidates.push(item);
    });
  };

  pushUnique(strongMatches);
  pushUnique(softMatches);
  pushUnique(recentDiscoveries);
  pushUnique(generalMatches);
  pushUnique(seededLibraryFallback);

  const targetResultCount = artistSearchActive ? SMART_REFRESH_TARGET_RESULTS : Math.max(SMART_REFRESH_MIN_RESULTS, Math.min(SMART_REFRESH_TARGET_RESULTS, prioritizedCandidates.length));
  const candidatesForQueue = prioritizedCandidates.slice(0, Math.max(targetResultCount, SMART_REFRESH_MIN_RESULTS));
  const backfilledCount = Math.max(0, candidatesForQueue.length - strongMatches.length);
  const modeMinDuration = state.sessionMode === 'deep-dive' ? DEEP_DIVE_MIN_DURATION_SECONDS : 0;

  state.queueDebug = {
    artistSearchActive,
    activeArtists: [...state.artists],
    counts: {
      before: allItems.length,
      discoveredThisRefresh: (state.memory.discoveryJobs[state.memory.discoveryJobs.length - 1] || {}).resultsFound || 0,
      suppressed: allItems.filter((item) => item.playbackMode === 'suppress').length,
      availability: availableItems.length,
      strongMatches: artistContextResult.counts.strong || 0,
      softMatches: artistContextResult.counts.soft || 0,
      generalMatches: artistContextResult.counts.general || 0,
      backfilled: backfilledCount,
      finalQueue: 0,
    },
    currentModeMinDuration: modeMinDuration,
  };

  state.queue = flowController.rebuild(candidatesForQueue, {
    includeSeen: state.includeSeen,
    includeExternal: state.showExternalOnly,
    preferInline: false,
    minDurationSeconds: modeMinDuration,
    trustByChannel: state.memory.channelTrust,
    affinityByArtist: state.memory.artistAffinity,
    artistSearchActive,
    seenIds: new Set(state.memory.seenItemIds),
  });

  if (state.queue.length < SMART_REFRESH_MIN_RESULTS) {
    const fallbackPool = prioritizedCandidates.filter((item) => !candidatesForQueue.some((candidate) => candidate.id === item.id));
    const expandedCandidates = [...candidatesForQueue, ...fallbackPool].slice(0, Math.max(SMART_REFRESH_TARGET_RESULTS, SMART_REFRESH_MIN_RESULTS));
    state.queue = flowController.rebuild(expandedCandidates, {
      includeSeen: state.includeSeen,
      includeExternal: state.showExternalOnly,
      preferInline: false,
      minDurationSeconds: modeMinDuration,
      trustByChannel: state.memory.channelTrust,
      affinityByArtist: state.memory.artistAffinity,
      artistSearchActive,
      seenIds: new Set(state.memory.seenItemIds),
    });
  }
  state.queueDebug.counts.finalQueue = state.queue.length;
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
        artistSearchSource: query,
        matchedQuery: query,
        matchedArtist: state.artists.find((artistName) => {
          const haystack = `${validated.title || ''} ${validated.description || ''} ${validated.channelName || ''}`.toLowerCase();
          return haystack.includes(artistName.toLowerCase());
        }) || '',
        candidateArtists: Array.from(new Set([...(validated.candidateArtists || []), ...state.artists])),
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
  renderPlaybackPanel();
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
  renderPlaybackPanel();
  renderDebug();

  elements.commandOutput.textContent = `Intent: ${parsed.intent} • ${JSON.stringify(parsed.entities)}`;
}

function openMediaItemExternally(item, { flow = false, markSeen = false } = {}) {
  if (!item?.id) return false;

  state.currentMediaItemId = item.id;
  state.playbackError = '';

  if (flow) {
    playbackController.startFlowAtItem(item, state.queue);
  } else {
    playbackController.enterSingle(item, { queue: state.queue });
  }
  playbackController.onExternalOpen();

  const opened = window.open(mediaItemLink(item), '_blank', 'noopener,noreferrer');
  if (!opened) {
    state.playbackError = 'Popup blocked. Use Open in YouTube or allow popups for this tile.';
  }

  if (markSeen) {
    state.memory = markMediaItemSeen(state.memory, item.id);
    persistState();
    rebuildFlowQueue();
    renderSummary();
    renderQueue();
  }

  renderPlaybackPanel();
  renderDebug();
  return Boolean(opened);
}

function playFlowFromCurrentQueue() {
  const flowItem = playbackController.startOrResumeFlow(state.queue);
  if (!flowItem) {
    state.playbackError = 'Flow queue is empty. Run Smart Refresh to discover tracks.';
    renderPlaybackPanel();
    return;
  }

  openMediaItemExternally(flowItem, { flow: true, markSeen: true });
}

function playNextInQueue() {
  const next = playbackController.nextInFlow(state.queue);
  if (!next) {
    state.playbackError = 'Flow queue complete. Refresh to continue.';
    renderPlaybackPanel();
    renderDebug();
    return;
  }
  openMediaItemExternally(next, { flow: true, markSeen: true });
}

function playPreviousInQueue() {
  const previous = playbackController.previousInFlow(state.queue);
  if (!previous) return;
  openMediaItemExternally(previous, { flow: true, markSeen: true });
}

function handleExternalOpenForCurrentItem() {
  const current = getCurrentMediaItem();
  if (!current?.id) return;
  playbackController.onExternalOpen();
  renderPlaybackPanel();
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

  if (action === 'play-now' || action === 'open-youtube') {
    event.preventDefault();
    const selected = flowController.selectById(actionTarget.dataset.id) || state.memory.mediaItems[actionTarget.dataset.id];
    if (selected) openMediaItemExternally(selected, { flow: false, markSeen: action === 'play-now' });
  }

  if (action === 'start-flow') {
    const selected = flowController.selectById(actionTarget.dataset.id) || state.memory.mediaItems[actionTarget.dataset.id];
    if (selected) openMediaItemExternally(selected, { flow: true, markSeen: true });
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
  renderPlaybackPanel();
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
  state.artists = [];
  state.currentMediaItemId = '';
  state.playbackError = '';
  elements.artists.value = '';
  elements.mode.value = 'discovery';
  elements.includeSeen.checked = false;
  elements.hideBroken.checked = true;
  elements.showExternalOnly.checked = true;
  writeSelectionToUI(state.selection);
  rebuildFlowQueue();
  renderSummary();
  renderQueue();
  renderPlaybackPanel();
  renderDebug();
}

function bindControls() {
  elements.smartRefresh.addEventListener('click', smartRefreshDiscovery);
  elements.flowMode.addEventListener('click', () => {
    state.sessionMode = 'flow';
    elements.mode.value = 'flow';
    rebuildFlowQueue();
    renderSummary();
    renderQueue();
    playFlowFromCurrentQueue();
  });

  elements.playBtn.addEventListener('click', () => {
    state.playbackError = '';
    const current = getCurrentMediaItem();
    if (current) {
      openMediaItemExternally(current, { flow: sessionStore.read().mode === 'flow', markSeen: true });
      return;
    }
    playFlowFromCurrentQueue();
  });
  elements.flowBtn.addEventListener('click', () => {
    state.sessionMode = 'flow';
    elements.mode.value = 'flow';
    playFlowFromCurrentQueue();
  });
  elements.nextBtn.addEventListener('click', playNextInQueue);
  elements.prevBtn.addEventListener('click', playPreviousInQueue);
  elements.resumeFlowBtn.addEventListener('click', playFlowFromCurrentQueue);

  elements.openInYoutube.addEventListener('click', (event) => {
    if (elements.openInYoutube.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
      return;
    }
    handleExternalOpenForCurrentItem();
  });

  elements.mode.addEventListener('change', () => {
    state.sessionMode = elements.mode.value;
    rebuildFlowQueue();
    renderSummary();
    renderQueue();
  });
  elements.artists.addEventListener('input', () => {
    state.artists = elements.artists.value.split(',').map((value) => value.trim()).filter(Boolean);
    rebuildFlowQueue();
    renderSummary();
    renderQueue();
    renderDebug();
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
}

function initialize() {
  loadMusicTileState().then((persisted) => {
    state.selection = persisted.selection;
    state.memory = persisted.memory;
    elements.hideBroken.checked = state.hideBroken;
    elements.showExternalOnly.checked = state.showExternalOnly;
    writeSelectionToUI(state.selection);
    rebuildFlowQueue();
    renderSummary();
    renderQueue();
    renderPlaybackPanel();
    renderDebug();

    console.info('[TILE DATA][music-tile] hydrate', {
      appId: 'music-tile',
      sourceUsedOnLoad: persisted?.__tileDataMeta?.source || 'unknown',
      backendDiagnostics: persisted?.__tileDataMeta?.diagnostics || null,
    });
  });

  bindControls();
}

initialize();
