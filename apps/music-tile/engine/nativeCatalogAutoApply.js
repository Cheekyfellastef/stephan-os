import { resolveSpotifyReference } from '../utils/spotifyEmbed.js';

const STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
const AUTO_APPLY_MESSAGE = 'Spotify track URL found by Stephanos and applied automatically.';
const AUTO_RESOLVE_MAX_TRACKS = 20;
const AUTO_RESOLVE_TIMEOUT_MS = 8000;
const AUTO_RESOLVE_CONCURRENCY = 2;
const AUTO_RESOLVE_MAX_ATTEMPTS = 4;
const AUTO_RESOLVE_RETRY_DELAY_MS = 750;
const SPOTIFY_ARTWORK_HOST_SUFFIXES = Object.freeze(['scdn.co', 'spotifycdn.com']);
const pendingAnnouncements = new Map();
const automaticResolutionAttempts = new Map();
const scheduleMicrotask = typeof globalThis.queueMicrotask === 'function'
  ? globalThis.queueMicrotask.bind(globalThis)
  : (callback) => Promise.resolve().then(callback);
let announcementQueued = false;
let hydrationQueued = false;
let automaticResolutionQueued = false;
let automaticResolutionRunning = false;
let automaticResolutionTimer = null;
let observerInstalled = false;

function normalizedIdentity(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizedTokens(value = '') {
  return normalizedIdentity(value).split(' ').filter((token) => token.length > 1);
}

function normalizeCatalogArtworkUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const trustedHost = SPOTIFY_ARTWORK_HOST_SUFFIXES.some((suffix) => (
      host === suffix || host.endsWith(`.${suffix}`)
    ));
    return url.protocol === 'https:' && trustedHost ? url.toString() : '';
  } catch {
    return '';
  }
}

function tokenCoverage(expected = '', observed = '') {
  const expectedTokens = normalizedTokens(expected);
  const observedTokens = new Set(normalizedTokens(observed));
  if (!expectedTokens.length || !observedTokens.size) return 0;
  return expectedTokens.filter((token) => observedTokens.has(token)).length / expectedTokens.length;
}

function catalogMatchScore(track = {}, result = {}) {
  if (String(result.provider || '').toLowerCase() !== 'spotify'
    || String(result.verificationStatus || '') !== 'metadata_verified') return 0;
  const spotify = resolveSpotifyReference(result.spotifyUrl || result.spotifyUri || '');
  if (!spotify.valid || spotify.type !== 'track') return 0;
  const titleCoverage = tokenCoverage(track.title || track.name, result.title);
  if (titleCoverage < 0.8) return 0;
  const artistCoverage = Math.max(
    tokenCoverage(track.artist, result.artist),
    tokenCoverage(result.artist, track.artist),
  );
  if (artistCoverage < 0.8) return 0;
  const exactTitle = normalizedIdentity(track.title || track.name) === normalizedIdentity(result.title);
  return (exactTitle ? 1000 : 0) + Math.round(titleCoverage * 100) + Math.round(artistCoverage * 10);
}

function automaticResolutionKey(track = {}) {
  return [track.id, normalizedIdentity(track.artist), normalizedIdentity(track.title || track.name)]
    .map((value) => String(value || '').trim())
    .join('::');
}

function needsAutomaticResolution(track = {}) {
  const spotify = resolveSpotifyReference(track.spotifyUrl || track.spotifyUri || '');
  const hasSpotifyTrack = spotify.valid && spotify.type === 'track';
  const hasArtwork = Boolean(normalizeCatalogArtworkUrl(track.artworkUrl));
  return Boolean(track?.artist && (track?.title || track?.name) && (!hasSpotifyTrack || !hasArtwork));
}

function automaticResolutionAttemptState(track = {}) {
  return automaticResolutionAttempts.get(automaticResolutionKey(track)) || { attempts: 0, nextAttemptAt: 0 };
}

function canAttemptAutomaticResolution(track = {}, now = Date.now()) {
  const state = automaticResolutionAttemptState(track);
  return state.attempts < AUTO_RESOLVE_MAX_ATTEMPTS && state.nextAttemptAt <= now;
}

function markAutomaticResolutionFailure(track = {}, now = Date.now()) {
  const key = automaticResolutionKey(track);
  const previous = automaticResolutionAttempts.get(key) || { attempts: 0, nextAttemptAt: 0 };
  const attempts = Math.min(AUTO_RESOLVE_MAX_ATTEMPTS, previous.attempts + 1);
  automaticResolutionAttempts.set(key, {
    attempts,
    nextAttemptAt: now + (AUTO_RESOLVE_RETRY_DELAY_MS * Math.max(1, attempts)),
  });
  return attempts;
}

function clearAutomaticResolutionFailure(track = {}) {
  automaticResolutionAttempts.delete(automaticResolutionKey(track));
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function browserStorage() {
  try {
    const storage = globalThis.localStorage;
    return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
      ? storage
      : null;
  } catch {
    return null;
  }
}

function validatedDetail(detail = {}) {
  if (!plainObject(detail) || !plainObject(detail.enrichment)) return null;
  const spotify = resolveSpotifyReference(detail.spotifyUrl || detail.spotifyUri || '');
  if (!spotify.valid || spotify.type !== 'track') return null;
  if (String(detail.enrichment.spotifyUrl || '') !== spotify.openUrl
    || String(detail.enrichment.spotifyUri || '') !== spotify.uri
    || String(detail.enrichment.catalogVerificationStatus || '') !== 'metadata_verified'
    || String(detail.enrichment.catalogLinkSource || '') !== 'native-catalog-search') return null;
  const artworkUrl = normalizeCatalogArtworkUrl(detail.enrichment.artworkUrl);
  if (detail.enrichment.artworkUrl && !artworkUrl) return null;
  if (artworkUrl && String(detail.enrichment.artworkSource || 'spotify-catalogue') !== 'spotify-catalogue') return null;
  const enrichment = {
    spotifyUrl: spotify.openUrl,
    spotifyUri: spotify.uri,
    catalogProvider: String(detail.enrichment.catalogProvider || ''),
    catalogProviderLabel: String(detail.enrichment.catalogProviderLabel || ''),
    catalogProviderItemId: String(detail.enrichment.catalogProviderItemId || ''),
    catalogProviderUrl: String(detail.enrichment.catalogProviderUrl || ''),
    catalogConfidence: String(detail.enrichment.catalogConfidence || 'unknown'),
    catalogVerificationStatus: 'metadata_verified',
    catalogPlaybackAvailability: String(detail.enrichment.catalogPlaybackAvailability || 'playback_unverified'),
    catalogLinkSource: 'native-catalog-search',
  };
  if (artworkUrl) {
    enrichment.artworkUrl = artworkUrl;
    enrichment.artworkSource = 'spotify-catalogue';
  }
  return {
    trackId: String(detail.trackId || ''),
    artist: String(detail.artist || ''),
    title: String(detail.title || ''),
    spotify,
    enrichment,
  };
}

function findStoredTrack(list = [], detail = {}) {
  if (detail.trackId) {
    const exact = list.find((track) => String(track?.id || '') === detail.trackId);
    if (exact) return exact;
  }
  const identity = `${normalizedIdentity(detail.artist)}::${normalizedIdentity(detail.title)}`;
  return list.find((track) => {
    const trackIdentity = `${normalizedIdentity(track?.artist)}::${normalizedIdentity(track?.title || track?.name)}`;
    return identity !== '::' && trackIdentity === identity;
  }) || null;
}

export function mergePersistedCatalogState(snapshot, rawDetail = {}) {
  if (!plainObject(snapshot) || !Array.isArray(snapshot.listeningDeck)) {
    return { ok: false, changed: false, reason: 'music-state-invalid' };
  }
  const detail = validatedDetail(rawDetail);
  if (!detail) return { ok: false, changed: false, reason: 'catalogue-enrichment-invalid' };
  const track = findStoredTrack(snapshot.listeningDeck, detail);
  if (!track) return { ok: false, changed: false, reason: 'existing-track-not-persisted' };

  const currentSpotify = resolveSpotifyReference(track.spotifyUrl || track.spotifyUri || '');
  if (currentSpotify.valid && currentSpotify.type === 'track' && currentSpotify.uri !== detail.spotify.uri) {
    return { ok: false, changed: false, reason: 'spotify-track-conflict' };
  }
  const changed = Object.entries(detail.enrichment)
    .some(([key, value]) => String(track[key] ?? '') !== String(value ?? ''));
  if (changed) Object.assign(track, detail.enrichment);
  return { ok: true, changed, track, detail };
}

function readStoredState(storage = browserStorage()) {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
    return plainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function findTrackInput(trackId) {
  const expected = `spotify-${trackId}`;
  return Array.from(document.querySelectorAll('[data-link-input]'))
    .find((node) => node.getAttribute('data-link-input') === expected) || null;
}

function findTrackButton(action, trackId) {
  return Array.from(document.querySelectorAll(`[data-action="${action}"]`))
    .find((node) => String(node.getAttribute('data-id') || '') === String(trackId || '')) || null;
}

function updateTrackArtwork(card, track) {
  const artworkUrl = normalizeCatalogArtworkUrl(track?.artworkUrl);
  if (!card || !artworkUrl || card.querySelector('iframe')) return false;
  let panel = card.querySelector('[data-catalog-artwork]');
  if (!panel) {
    panel = document.createElement('div');
    panel.dataset.catalogArtwork = 'true';
    panel.className = 'catalog-artwork-preview';
    panel.style.display = 'grid';
    panel.style.gridTemplateColumns = '84px minmax(0, 1fr)';
    panel.style.gap = '12px';
    panel.style.alignItems = 'center';
    panel.style.margin = '10px 0';
    panel.style.padding = '10px';
    panel.style.border = '1px solid rgba(255,255,255,0.12)';
    panel.style.borderRadius = '12px';
    panel.style.background = 'rgba(255,255,255,0.035)';
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.style.width = '84px';
    image.style.height = '84px';
    image.style.objectFit = 'cover';
    image.style.borderRadius = '10px';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.dataset.catalogArtworkTitle = 'true';
    const source = document.createElement('div');
    source.className = 'meta';
    source.textContent = 'Verified Spotify catalogue artwork';
    copy.append(title, source);
    panel.append(image, copy);
    const header = card.querySelector('.music-card-header');
    if (header?.after) header.after(panel);
    else card.prepend(panel);
  }
  const image = panel.querySelector('img');
  const title = panel.querySelector('[data-catalog-artwork-title]');
  if (!image || !title) return false;
  const nextAlt = 'Artwork for ' + String(track.title || track.name || 'this track');
  const nextTitle = String(track.title || track.name || 'Unknown track') + ' · ' + String(track.artist || 'Unknown artist');
  if (image.getAttribute('src') !== artworkUrl) image.src = artworkUrl;
  if (image.alt !== nextAlt) image.alt = nextAlt;
  if (title.textContent !== nextTitle) title.textContent = nextTitle;
  return true;
}

function updateTrackCard(track, spotify) {
  if (typeof document === 'undefined' || !track || !spotify?.openUrl) return false;
  const input = findTrackInput(track.id);
  const card = input?.closest('.player-deck-card');
  if (!input || !card) return false;
  if (input.value !== spotify.openUrl) input.value = spotify.openUrl;
  updateTrackArtwork(card, track);
  findTrackButton('resolve-spotify-link', track.id)?.remove();

  const missing = Array.from(card.querySelectorAll('.meta')).find((node) => (
    /Needs verified Spotify link|Unverified AI candidate|Likely hallucinated candidate/.test(node.textContent || '')
  ));
  const catalogueTruth = 'Spotify catalogue link found; browser playback not yet verified.';
  if (missing && missing.textContent !== catalogueTruth) missing.textContent = catalogueTruth;

  const controls = card.querySelector('.media-controls');
  const existingOpenLink = Array.from(controls?.querySelectorAll('a') || [])
    .find((node) => node.getAttribute('href') === spotify.openUrl);
  if (controls && !existingOpenLink) {
    const link = document.createElement('a');
    link.className = 'media-btn spotify';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.href = spotify.openUrl;
    link.textContent = 'Open in Spotify';
    controls.prepend(link);
  }

  const editor = input.closest('.links-editor');
  let message = editor?.querySelector('[data-catalog-auto-apply-message]');
  if (editor && !message) {
    message = document.createElement('div');
    message.className = 'meta';
    message.dataset.catalogAutoApplyMessage = 'true';
    editor.append(message);
  }
  if (message && message.textContent !== AUTO_APPLY_MESSAGE) message.textContent = AUTO_APPLY_MESSAGE;
  return true;
}

function announceAppliedTrack(track) {
  if (!track) return;
  pendingAnnouncements.set(String(track.id || `${track.artist}::${track.title}`), track);
  if (announcementQueued) return;
  announcementQueued = true;
  scheduleMicrotask(() => {
    announcementQueued = false;
    const count = pendingAnnouncements.size;
    pendingAnnouncements.clear();
    const status = document.getElementById('native-music-search-status');
    if (!status || !count) return;
    const suffix = `${count} existing song card${count === 1 ? '' : 's'} updated automatically`;
    if (!status.textContent.includes(suffix)) status.textContent = `${status.textContent} · ${suffix}`;
  });
}

function catalogResultDetailForTrack(track, result) {
  const spotify = resolveSpotifyReference(result?.spotifyUrl || result?.spotifyUri || '');
  if (!spotify.valid || spotify.type !== 'track') return null;
  const artworkUrl = normalizeCatalogArtworkUrl(result?.artworkUrl);
  const enrichment = {
    spotifyUrl: spotify.openUrl,
    spotifyUri: spotify.uri,
    catalogProvider: 'spotify',
    catalogProviderLabel: String(result?.providerLabel || 'Spotify'),
    catalogProviderItemId: String(result?.providerItemId || ''),
    catalogProviderUrl: String(result?.providerUrl || spotify.openUrl),
    catalogConfidence: String(result?.confidence || 'high'),
    catalogVerificationStatus: 'metadata_verified',
    catalogPlaybackAvailability: String(result?.playbackAvailability || 'playback_unverified'),
    catalogLinkSource: 'native-catalog-search',
  };
  if (artworkUrl) {
    enrichment.artworkUrl = artworkUrl;
    enrichment.artworkSource = 'spotify-catalogue';
  }
  return {
    trackId: String(track?.id || ''),
    artist: String(track?.artist || ''),
    title: String(track?.title || track?.name || ''),
    spotifyUrl: spotify.openUrl,
    spotifyUri: spotify.uri,
    enrichment,
  };
}

async function requestAutomaticCatalogResolution(track, {
  fetchImpl = globalThis.fetch,
  timeoutMs = AUTO_RESOLVE_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') return { ok: false, retryable: true, reason: 'fetch-unavailable' };
  const query = (String(track?.artist || '').trim() + ' ' + String(track?.title || track?.name || '').trim()).trim();
  if (!query) return { ok: false, retryable: false, reason: 'track-identity-missing' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs || AUTO_RESOLVE_TIMEOUT_MS)));
  try {
    const response = await fetchImpl('/api/music/catalog/search?q=' + encodeURIComponent(query) + '&limit=10', {
      signal: controller.signal,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, retryable: true, reason: 'catalogue-response-invalid' };
    }
    if (!response.ok || !payload?.ok || !Array.isArray(payload.results)) {
      return { ok: false, retryable: true, reason: 'catalogue-temporarily-unavailable' };
    }
    const ranked = payload.results
      .map((result) => ({ result, score: catalogMatchScore(track, result) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);
    if (!ranked.length) return { ok: false, retryable: true, reason: 'no-verified-match' };
    return { ok: true, retryable: false, result: ranked[0].result };
  } catch (error) {
    return {
      ok: false,
      retryable: true,
      reason: error?.name === 'AbortError' ? 'catalogue-timeout' : 'catalogue-request-failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

function countRetryableTracks(snapshot = {}) {
  if (!Array.isArray(snapshot.listeningDeck)) return 0;
  return snapshot.listeningDeck.filter((track) => (
    needsAutomaticResolution(track)
    && automaticResolutionAttemptState(track).attempts < AUTO_RESOLVE_MAX_ATTEMPTS
  )).length;
}

export async function resolveUnlinkedDeckTracks({
  storage = browserStorage(),
  fetchImpl = globalThis.fetch,
  maxTracks = AUTO_RESOLVE_MAX_TRACKS,
  timeoutMs = AUTO_RESOLVE_TIMEOUT_MS,
} = {}) {
  if (!storage) return { ok: false, reason: 'music-state-storage-unavailable', attemptedCount: 0, resolvedCount: 0, retryableCount: 0 };
  const snapshot = readStoredState(storage);
  if (!snapshot || !Array.isArray(snapshot.listeningDeck)) {
    return { ok: false, reason: 'music-state-invalid', attemptedCount: 0, resolvedCount: 0, retryableCount: 0 };
  }
  const now = Date.now();
  const unresolved = snapshot.listeningDeck.filter((track) => needsAutomaticResolution(track));
  const pending = unresolved
    .filter((track) => canAttemptAutomaticResolution(track, now))
    .slice(0, Math.max(0, Math.min(Number(maxTracks) || AUTO_RESOLVE_MAX_TRACKS, AUTO_RESOLVE_MAX_TRACKS)));
  if (!pending.length) {
    const retryableCount = countRetryableTracks(snapshot);
    return {
      ok: true,
      reason: retryableCount ? 'retry-cooldown' : 'nothing-to-resolve',
      attemptedCount: 0,
      resolvedCount: 0,
      unresolvedCount: unresolved.length,
      retryableCount,
    };
  }

  let cursor = 0;
  const resolved = [];
  const worker = async () => {
    while (cursor < pending.length) {
      const track = pending[cursor];
      cursor += 1;
      const request = await requestAutomaticCatalogResolution(track, { fetchImpl, timeoutMs });
      if (!request.ok) {
        if (request.retryable) markAutomaticResolutionFailure(track);
        else automaticResolutionAttempts.set(automaticResolutionKey(track), {
          attempts: AUTO_RESOLVE_MAX_ATTEMPTS,
          nextAttemptAt: Number.POSITIVE_INFINITY,
        });
        continue;
      }
      const detail = catalogResultDetailForTrack(track, request.result);
      if (!detail) {
        markAutomaticResolutionFailure(track);
        continue;
      }
      const merged = mergePersistedCatalogState(snapshot, detail);
      if (!merged.ok) {
        markAutomaticResolutionFailure(track);
        continue;
      }
      clearAutomaticResolutionFailure(track);
      if (merged.changed) resolved.push({ track: merged.track, spotify: merged.detail.spotify });
    }
  };
  const workerCount = Math.min(AUTO_RESOLVE_CONCURRENCY, pending.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (resolved.length) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      return {
        ok: false,
        reason: 'music-state-persistence-failed',
        attemptedCount: pending.length,
        resolvedCount: 0,
        retryableCount: countRetryableTracks(snapshot),
      };
    }
    for (const item of resolved) {
      updateTrackCard(item.track, item.spotify);
      if (typeof document !== 'undefined') announceAppliedTrack(item.track);
    }
  }
  const retryableCount = countRetryableTracks(snapshot);
  return {
    ok: true,
    reason: resolved.length ? 'resolved' : (retryableCount ? 'retry-scheduled' : 'no-verified-match'),
    attemptedCount: pending.length,
    resolvedCount: resolved.length,
    unresolvedCount: snapshot.listeningDeck.filter((track) => needsAutomaticResolution(track)).length,
    retryableCount,
  };
}

export function hydratePersistedCatalogLinks() {
  if (typeof document === 'undefined') return 0;
  const storage = browserStorage();
  if (!storage) return 0;
  const snapshot = readStoredState(storage);
  if (!snapshot || !Array.isArray(snapshot.listeningDeck)) return 0;
  let hydrated = 0;
  for (const track of snapshot.listeningDeck) {
    if (track?.catalogLinkSource !== 'native-catalog-search'
      || track?.catalogVerificationStatus !== 'metadata_verified') continue;
    const spotify = resolveSpotifyReference(track.spotifyUrl || track.spotifyUri || '');
    if (!spotify.valid || spotify.type !== 'track') continue;
    if (updateTrackCard(track, spotify)) hydrated += 1;
  }
  return hydrated;
}

function queueHydration() {
  if (hydrationQueued) return;
  hydrationQueued = true;
  scheduleMicrotask(() => {
    hydrationQueued = false;
    hydratePersistedCatalogLinks();
  });
}

function queueAutomaticResolution(delayMs = 0) {
  if (automaticResolutionRunning) {
    automaticResolutionQueued = true;
    return;
  }
  if (automaticResolutionTimer) return;
  automaticResolutionQueued = true;
  automaticResolutionTimer = setTimeout(async () => {
    automaticResolutionTimer = null;
    automaticResolutionQueued = false;
    automaticResolutionRunning = true;
    let retryableCount = 0;
    try {
      const result = await resolveUnlinkedDeckTracks();
      retryableCount = Number(result?.retryableCount || 0);
    } finally {
      automaticResolutionRunning = false;
      if (retryableCount > 0 || automaticResolutionQueued) {
        automaticResolutionQueued = false;
        queueAutomaticResolution(AUTO_RESOLVE_RETRY_DELAY_MS);
      }
    }
  }, Math.max(0, Number(delayMs) || 0));
}

export function applyCatalogEnrichmentToBrowser(rawDetail = {}) {
  if (typeof document === 'undefined') {
    return { ok: true, changed: false, reason: 'non-browser-runtime' };
  }
  const storage = browserStorage();
  if (!storage) return { ok: false, changed: false, reason: 'music-state-storage-unavailable' };
  const snapshot = readStoredState(storage);
  const merged = mergePersistedCatalogState(snapshot, rawDetail);
  if (!merged.ok) return merged;
  try {
    if (merged.changed) storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    return { ok: false, changed: false, reason: 'music-state-persistence-failed' };
  }
  if (merged.changed) {
    clearAutomaticResolutionFailure(merged.track);
    updateTrackCard(merged.track, merged.detail.spotify);
    announceAppliedTrack(merged.track);
    queueHydration();
  }
  return merged;
}

function installHydrationObserver() {
  if (observerInstalled || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const deck = document.getElementById('listening-deck');
  if (!deck) return;
  observerInstalled = true;
  const observer = new MutationObserver((records) => {
    const deckStructureChanged = records.some((record) => {
      const changedNodes = [
        ...Array.from(record.addedNodes || []),
        ...Array.from(record.removedNodes || []),
      ];
      return changedNodes.some((node) => (
        node?.nodeType === 1
        && (node.matches?.('.player-deck-card') || node.querySelector?.('.player-deck-card'))
      ));
    });
    if (!deckStructureChanged) return;
    queueHydration();
    queueAutomaticResolution();
  });
  observer.observe(deck, { childList: true, subtree: false });
  queueHydration();
  queueAutomaticResolution();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installHydrationObserver, { once: true });
  } else {
    scheduleMicrotask(installHydrationObserver);
  }
}
