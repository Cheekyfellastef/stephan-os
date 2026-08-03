import { AI_CANDIDATE_STATUSES } from './candidateVerification.js';
import { resolveSpotifyReference } from '../utils/spotifyEmbed.js';

const MAX_QUERY_LENGTH = 160;
const MUSIC_TILE_STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
const SPOTIFY_TRACK_ID_PATTERN = /^[A-Za-z0-9]{22}$/;
const AUTO_LINK_BUTTON_ATTRIBUTE = 'data-auto-spotify-card-url';
const AUTO_LINK_MESSAGE_ATTRIBUTE = 'data-auto-spotify-card-url-message';
export const DEFAULT_PROVIDER_ATTEMPT_TIMEOUT_MS = 8000;
export const DEFAULT_BROWSER_TIMEOUT_MS = (DEFAULT_PROVIDER_ATTEMPT_TIMEOUT_MS * 2) + 2000;

export function normalizeNativeCatalogQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
}

export function catalogResultActionKey(result = {}) {
  const provider = String(result.provider || 'unknown').trim().toLowerCase();
  const providerItemId = String(result.providerItemId || result.universalId || '').trim();
  return `${provider}:${providerItemId}`;
}

export async function requestNativeCatalogSearch(query, { fetchImpl = globalThis.fetch, limit = 5, timeoutMs = DEFAULT_BROWSER_TIMEOUT_MS, signal } = {}) {
  const normalizedQuery = normalizeNativeCatalogQuery(query);
  if (!normalizedQuery) return { ok: false, error: 'Type a song, artist or musical direction.' };
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener?.('abort', abortFromCaller, { once: true });
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error('Music search timed out'), { code: 'catalog_search_timeout' }));
    }, Math.max(1, Number(timeoutMs || DEFAULT_BROWSER_TIMEOUT_MS)));
  });
  try {
    const url = `/api/music/catalog/search?q=${encodeURIComponent(normalizedQuery)}&limit=${Math.min(Math.max(Number(limit) || 5, 1), 10)}`;
    const response = await Promise.race([fetchImpl(url, { signal: controller.signal }), deadline]);
    const payload = await Promise.race([response.json(), deadline]);
    if (!response.ok || !payload?.ok) {
      return { ok: false, error: payload?.error || 'Music search is temporarily unavailable.', results: [] };
    }
    return payload;
  } catch (error) {
    if (error?.code === 'catalog_search_timeout' || error?.name === 'AbortError') {
      return { ok: false, error: 'Music search timed out. Please try again.', results: [] };
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', abortFromCaller);
  }
}

export function catalogResultToMusicTileTrack(result = {}) {
  const provider = String(result.provider || 'unknown').trim().toLowerCase();
  const providerItemId = String(result.providerItemId || '').trim();
  const title = String(result.title || '').trim();
  const artist = String(result.artist || 'Unknown Artist').trim() || 'Unknown Artist';
  const universalId = String(result.universalId || `${provider}:track:${providerItemId}`).trim();
  return {
    id: universalId,
    universalMusicId: universalId,
    title,
    artist,
    album: String(result.album || ''),
    lane: 'native-catalog-search',
    sourceKind: 'native-catalog',
    catalogProvider: provider,
    catalogProviderLabel: String(result.providerLabel || provider || 'Unknown'),
    catalogProviderItemId: providerItemId,
    catalogProviderUrl: String(result.providerUrl || ''),
    catalogConfidence: String(result.confidence || 'unknown'),
    catalogVerificationStatus: String(result.verificationStatus || 'unknown'),
    catalogPlaybackAvailability: String(result.playbackAvailability || 'unavailable'),
    spotifyUrl: String(result.spotifyUrl || ''),
    spotifyUri: String(result.spotifyUri || ''),
    spotifySearchUrl: String(result.spotifySearchUrl || ''),
    candidateVerificationStatus: 'search-only',
    verificationStatus: 'catalogue_identity_only',
    discoveryReason: `Found by native Music Search through ${String(result.providerLabel || provider || 'catalogue')}.`,
    traits: [],
    avoidTraits: [],
  };
}

function normalizeAutomaticMatchText(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function automaticArtistParts(value = '') {
  return String(value || '')
    .split(/\s*(?:,|&|\bfeat\.?\b|\bfeaturing\b|\bwith\b|\bx\b)\s*/i)
    .map(normalizeAutomaticMatchText)
    .filter(Boolean);
}

function isCanonicalSpotifyCatalogResult(result = {}) {
  const providerItemId = String(result.providerItemId || '').trim();
  if (String(result.provider || '').trim().toLowerCase() !== 'spotify') return false;
  if (!SPOTIFY_TRACK_ID_PATTERN.test(providerItemId)) return false;
  if (String(result.verificationStatus || '') !== 'metadata_verified') return false;
  if (String(result.spotifyUrl || '') !== `https://open.spotify.com/track/${providerItemId}`) return false;
  if (String(result.spotifyUri || '') !== `spotify:track:${providerItemId}`) return false;
  return true;
}

export function selectAutomaticSpotifyTrackMatch(track = {}, results = []) {
  const targetTitle = normalizeAutomaticMatchText(track.title || track.name || '');
  const targetArtists = automaticArtistParts(track.artist || '');
  if (!targetTitle || !targetArtists.length) return null;

  const exactMatches = (Array.isArray(results) ? results : []).filter((result) => {
    if (!isCanonicalSpotifyCatalogResult(result)) return false;
    if (normalizeAutomaticMatchText(result.title || '') !== targetTitle) return false;
    const resultArtists = automaticArtistParts(result.artist || '');
    return targetArtists.some((artist) => resultArtists.includes(artist));
  });

  return exactMatches.length === 1 ? exactMatches[0] : null;
}

export function applyAutomaticSpotifyMatchToTrack(track = {}, result = {}, now = () => new Date().toISOString()) {
  if (!track || typeof track !== 'object') return { ok: false, blocker: 'MUSIC_TILE_TRACK_INVALID' };
  const exactMatch = selectAutomaticSpotifyTrackMatch(track, [result]);
  if (!exactMatch) return { ok: false, blocker: 'MUSIC_TILE_SPOTIFY_MATCH_NOT_EXACT' };
  const spotify = resolveSpotifyReference(exactMatch.spotifyUrl || exactMatch.spotifyUri || '');
  if (!spotify.valid || spotify.type !== 'track') return { ok: false, blocker: 'MUSIC_TILE_SPOTIFY_TRACK_URL_INVALID' };

  track.spotifyUrl = spotify.openUrl;
  track.spotifyUri = spotify.uri;
  track.spotifySearchUrl = String(exactMatch.spotifySearchUrl || '');
  track.catalogProvider = 'spotify';
  track.catalogProviderLabel = String(exactMatch.providerLabel || 'Spotify');
  track.catalogProviderItemId = String(exactMatch.providerItemId || '');
  track.catalogProviderUrl = String(exactMatch.providerUrl || spotify.openUrl);
  track.catalogConfidence = String(exactMatch.confidence || 'high');
  track.catalogVerificationStatus = 'metadata_verified';
  track.catalogPlaybackAvailability = String(exactMatch.playbackAvailability || 'playback_unverified');
  track.candidateVerificationStatus = track.aiSuggested
    ? AI_CANDIDATE_STATUSES.userConfirmed
    : AI_CANDIDATE_STATUSES.verified;
  track.spotifyAutoResolutionState = 'resolved';
  track.spotifyAutoResolvedAt = now();
  return { ok: true, spotifyUrl: spotify.openUrl, spotifyUri: spotify.uri };
}

function readMusicTileState(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(MUSIC_TILE_STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (!Array.isArray(parsed.listeningDeck)) parsed.listeningDeck = [];
    if (!parsed.linkMessages || typeof parsed.linkMessages !== 'object' || Array.isArray(parsed.linkMessages)) parsed.linkMessages = {};
    return parsed;
  } catch {
    return null;
  }
}

function writeMusicTileState(storage, state) {
  try {
    storage?.setItem?.(MUSIC_TILE_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function directSpotifyReference(track = {}) {
  const reference = resolveSpotifyReference(track.spotifyUrl || track.spotifyUri || '');
  return reference.valid && reference.type === 'track' ? reference : null;
}

function trackCanBeAutomaticallyResolved(track = {}) {
  if (directSpotifyReference(track)) return false;
  const artist = normalizeAutomaticMatchText(track.artist || '');
  const title = normalizeAutomaticMatchText(track.title || track.name || '');
  if (!artist || !title) return false;
  if (artist === 'unknown' || artist === 'unknown artist' || title === 'unknown' || title === 'untitled') return false;
  return !track.spotifyAutoResolutionState;
}

function cardTrackId(card) {
  const input = card?.querySelector?.('input[data-link-input^="spotify-"]');
  const identity = String(input?.getAttribute?.('data-link-input') || '');
  return identity.startsWith('spotify-') ? identity.slice('spotify-'.length) : '';
}

function ensureCardMessage(card, message) {
  if (!card) return;
  let node = card.querySelector(`[${AUTO_LINK_MESSAGE_ATTRIBUTE}]`);
  if (!node) {
    node = card.ownerDocument.createElement('div');
    node.className = 'meta';
    node.setAttribute(AUTO_LINK_MESSAGE_ATTRIBUTE, 'true');
    const editor = card.querySelector('.links-editor');
    (editor || card).append(node);
  }
  node.textContent = String(message || '');
}

function removeSpotifySearchLinks(card) {
  card?.querySelectorAll?.('a[href*="open.spotify.com/search/"]').forEach((link) => link.remove());
}

function ensureAutomaticResolveButton(card, trackId, onResolve, label = 'Get Spotify link automatically') {
  if (!card || !trackId) return null;
  let button = card.querySelector(`[${AUTO_LINK_BUTTON_ATTRIBUTE}]`);
  if (!button) {
    button = card.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'media-btn spotify resolve';
    button.setAttribute(AUTO_LINK_BUTTON_ATTRIBUTE, 'true');
    const controls = card.querySelector('.media-controls') || card.querySelector('.links-editor') || card;
    controls.append(button);
    button.addEventListener('click', onResolve);
  }
  button.textContent = label;
  return button;
}

function updateResolvedCardDom(card, track, spotify) {
  if (!card || !spotify) return;
  removeSpotifySearchLinks(card);
  card.querySelector(`[${AUTO_LINK_BUTTON_ATTRIBUTE}]`)?.remove();
  card.querySelectorAll('[data-action="resolve-spotify-link"]').forEach((button) => button.remove());
  const input = card.querySelector('input[data-link-input^="spotify-"]');
  if (input) input.value = spotify.openUrl;
  const controls = card.querySelector('.media-controls');
  if (controls && !controls.querySelector(`a[href="${spotify.openUrl}"]`)) {
    const link = card.ownerDocument.createElement('a');
    link.className = 'media-btn spotify';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.href = spotify.openUrl;
    link.textContent = 'Open in Spotify';
    controls.prepend(link);
  }
  ensureCardMessage(card, 'Stephanos found the exact Spotify track and added its URL to this song card automatically.');
  card.dispatchEvent(new CustomEvent('music-tile:spotify-url-resolved', {
    bubbles: true,
    detail: { trackId: String(track.id || ''), spotifyUrl: spotify.openUrl },
  }));
}

export function installAutomaticSpotifyCardUrlBridge({
  documentRef = globalThis.document,
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch,
  MutationObserverImpl = globalThis.MutationObserver,
  queueMicrotaskImpl = globalThis.queueMicrotask,
} = {}) {
  if (!documentRef?.querySelector || !storage?.getItem || typeof fetchImpl !== 'function') {
    return { installed: false, blocker: 'MUSIC_TILE_BROWSER_SURFACE_UNAVAILABLE' };
  }
  const deck = documentRef.querySelector('#listening-deck');
  if (!deck) return { installed: false, blocker: 'MUSIC_TILE_LISTENING_DECK_UNAVAILABLE' };
  if (deck.dataset.autoSpotifyCardUrlBridge === 'installed') return { installed: true, reused: true };
  deck.dataset.autoSpotifyCardUrlBridge = 'installed';

  const inFlight = new Set();
  let scanQueued = false;

  const resolveTrack = async (trackId, card, { retry = false } = {}) => {
    if (!trackId || inFlight.has(trackId)) return;
    const before = readMusicTileState(storage);
    const track = before?.listeningDeck?.find((entry) => String(entry?.id || '') === trackId);
    if (!track) return;
    const existing = directSpotifyReference(track);
    if (existing) {
      updateResolvedCardDom(card, track, existing);
      return;
    }
    if (retry) delete track.spotifyAutoResolutionState;
    if (!trackCanBeAutomaticallyResolved(track)) return;

    inFlight.add(trackId);
    track.spotifyAutoResolutionState = 'pending';
    track.spotifyAutoResolutionAttemptedAt = new Date().toISOString();
    before.linkMessages[trackId] = 'Stephanos is finding and adding the exact Spotify track URL…';
    writeMusicTileState(storage, before);
    removeSpotifySearchLinks(card);
    const button = ensureAutomaticResolveButton(card, trackId, () => resolveTrack(trackId, card, { retry: true }), 'Finding Spotify link…');
    if (button) button.disabled = true;
    ensureCardMessage(card, before.linkMessages[trackId]);

    try {
      const query = `${track.artist || ''} ${track.title || track.name || ''}`.trim();
      const payload = await requestNativeCatalogSearch(query, { fetchImpl, limit: 10 });
      const latest = readMusicTileState(storage);
      const latestTrack = latest?.listeningDeck?.find((entry) => String(entry?.id || '') === trackId);
      if (!latest || !latestTrack) return;
      const nowResolved = directSpotifyReference(latestTrack);
      if (nowResolved) {
        latestTrack.spotifyAutoResolutionState = 'resolved';
        latest.linkMessages[trackId] = 'Spotify link already present.';
        writeMusicTileState(storage, latest);
        updateResolvedCardDom(card, latestTrack, nowResolved);
        return;
      }
      const match = payload?.ok
        ? selectAutomaticSpotifyTrackMatch(latestTrack, Array.isArray(payload.results) ? payload.results : [])
        : null;
      const applied = match ? applyAutomaticSpotifyMatchToTrack(latestTrack, match) : { ok: false };
      if (!applied.ok) {
        latestTrack.spotifyAutoResolutionState = 'blocked';
        latest.linkMessages[trackId] = payload?.ok
          ? 'Stephanos did not receive one exact Spotify title-and-artist match. Nothing was pasted or guessed. Tap retry later, or paste a direct track URL only as a fallback.'
          : String(payload?.error || 'Automatic Spotify lookup is temporarily unavailable.');
        writeMusicTileState(storage, latest);
        ensureCardMessage(card, latest.linkMessages[trackId]);
        const retryButton = ensureAutomaticResolveButton(card, trackId, () => resolveTrack(trackId, card, { retry: true }), 'Retry automatic Spotify link');
        if (retryButton) retryButton.disabled = false;
        return;
      }
      latest.linkMessages[trackId] = 'Stephanos found the exact Spotify track and added its URL to this song card automatically.';
      writeMusicTileState(storage, latest);
      updateResolvedCardDom(card, latestTrack, resolveSpotifyReference(latestTrack.spotifyUrl));
    } catch (error) {
      const latest = readMusicTileState(storage);
      const latestTrack = latest?.listeningDeck?.find((entry) => String(entry?.id || '') === trackId);
      if (latest && latestTrack) {
        latestTrack.spotifyAutoResolutionState = 'blocked';
        latest.linkMessages[trackId] = `Automatic Spotify lookup failed safely: ${String(error?.message || error)}. The card stayed unchanged.`;
        writeMusicTileState(storage, latest);
        ensureCardMessage(card, latest.linkMessages[trackId]);
      }
      const retryButton = ensureAutomaticResolveButton(card, trackId, () => resolveTrack(trackId, card, { retry: true }), 'Retry automatic Spotify link');
      if (retryButton) retryButton.disabled = false;
    } finally {
      inFlight.delete(trackId);
    }
  };

  const scan = () => {
    scanQueued = false;
    const state = readMusicTileState(storage);
    if (!state) return;
    deck.querySelectorAll('.player-deck-card').forEach((card) => {
      const trackId = cardTrackId(card);
      const track = state.listeningDeck.find((entry) => String(entry?.id || '') === trackId);
      if (!track) return;
      const spotify = directSpotifyReference(track);
      if (spotify) {
        updateResolvedCardDom(card, track, spotify);
        return;
      }
      removeSpotifySearchLinks(card);
      const pending = track.spotifyAutoResolutionState === 'pending';
      const blocked = track.spotifyAutoResolutionState === 'blocked';
      const button = ensureAutomaticResolveButton(
        card,
        trackId,
        () => resolveTrack(trackId, card, { retry: blocked }),
        pending ? 'Finding Spotify link…' : blocked ? 'Retry automatic Spotify link' : 'Get Spotify link automatically',
      );
      if (button) button.disabled = pending;
      if (state.linkMessages?.[trackId]) ensureCardMessage(card, state.linkMessages[trackId]);
      if (trackCanBeAutomaticallyResolved(track)) void resolveTrack(trackId, card);
    });
  };

  const scheduleScan = () => {
    if (scanQueued) return;
    scanQueued = true;
    (typeof queueMicrotaskImpl === 'function' ? queueMicrotaskImpl : (callback) => Promise.resolve().then(callback))(scan);
  };

  const observer = typeof MutationObserverImpl === 'function'
    ? new MutationObserverImpl(scheduleScan)
    : null;
  observer?.observe(deck, { childList: true, subtree: true });
  scheduleScan();
  return { installed: true, disconnect: () => observer?.disconnect() };
}

export function findExistingCatalogTrack(list = [], result = {}) {
  const universalId = String(result.universalId || '').trim();
  const provider = String(result.provider || '').trim().toLowerCase();
  const providerItemId = String(result.providerItemId || '').trim();
  const normalizedIdentity = `${String(result.artist || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}::${String(result.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
  return (Array.isArray(list) ? list : []).find((track) => {
    if (universalId && String(track?.universalMusicId || track?.id || '') === universalId) return true;
    if (provider && providerItemId
      && String(track?.catalogProvider || '').toLowerCase() === provider
      && String(track?.catalogProviderItemId || '') === providerItemId) return true;
    const trackIdentity = `${String(track?.artist || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}::${String(track?.title || track?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
    return normalizedIdentity !== '::' && trackIdentity === normalizedIdentity;
  }) || null;
}

if (typeof document !== 'undefined' && typeof localStorage !== 'undefined') {
  queueMicrotask(() => installAutomaticSpotifyCardUrlBridge());
}
