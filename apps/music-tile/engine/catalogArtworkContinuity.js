import './nativeCatalogLinkContinuity.js';
import { hydrateAutomaticMediaOverlay } from './automaticMediaOverlay.js';
import { AI_CANDIDATE_STATUSES, getCandidateVerificationStatus, isVerifiedCandidateTrack, hasVerifiedCatalogSpotifyTrack } from './candidateVerification.js';

const STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
const OEMBED_OVERLAY_KEY = 'stephanos.musicTile.spotifyOembedArtwork.v1';
const OEMBED_MAX_TRACKS_PER_PASS = 20;
const OEMBED_MAX_ATTEMPTS = 3;
const oembedAttempts = new Map();
let oembedTimer = null;
let oembedRunning = false;
const TRUSTED_ARTWORK_HOST_SUFFIXES = Object.freeze(['scdn.co', 'spotifycdn.com']);

function trustedArtworkUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const trustedHost = TRUSTED_ARTWORK_HOST_SUFFIXES.some((suffix) => (
      host === suffix || host.endsWith(`.${suffix}`)
    ));
    return url.protocol === 'https:' && trustedHost ? url.toString() : '';
  } catch {
    return '';
  }
}

function spotifyTrackId(value = '') {
  const raw = String(value || '').trim();
  const uriMatch = /^spotify:track:([A-Za-z0-9]+)$/.exec(raw);
  if (uriMatch) return uriMatch[1];
  try {
    const url = new URL(raw);
    if (url.hostname.toLowerCase() !== 'open.spotify.com') return '';
    const match = /^\/track\/([A-Za-z0-9]+)\/?$/.exec(url.pathname);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

function artworkMatchesCurrentSpotifyTrack(track = {}) {
  const currentTrackId = spotifyTrackId(track.spotifyUri || track.spotifyUrl || '');
  const catalogTrackId = String(track.catalogProviderItemId || '').trim();
  return Boolean(
    currentTrackId
    && catalogTrackId
    && currentTrackId === catalogTrackId
    && String(track.catalogProvider || '').toLowerCase() === 'spotify'
    && String(track.catalogVerificationStatus || '') === 'metadata_verified'
    && String(track.catalogLinkSource || '') === 'native-catalog-search'
    && String(track.artworkSource || '') === 'spotify-catalogue'
  );
}

export function canUseVerifiedSpotifyArtwork(track = {}) {
  const status = getCandidateVerificationStatus(track);
  if (status === AI_CANDIDATE_STATUSES.notFound
    || status === AI_CANDIDATE_STATUSES.likelyHallucinated) return false;
  return isVerifiedCandidateTrack(track) || hasVerifiedCatalogSpotifyTrack(track);
}

function readListeningDeck(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(STORAGE_KEY) || '{}');
    return Array.isArray(parsed?.listeningDeck) ? parsed.listeningDeck : [];
  } catch {
    return [];
  }
}

function readOembedOverlay(storage) {
  try {
    const saved = JSON.parse(storage?.getItem?.(OEMBED_OVERLAY_KEY) || '{}');
    return saved?.entries && typeof saved.entries === 'object' && !Array.isArray(saved.entries)
      ? saved.entries
      : {};
  } catch {
    return {};
  }
}

function trustedOembedArtwork(track, storage) {
  const id = spotifyTrackId(track.spotifyUrl || track.spotifyUri || '');
  const entry = readOembedOverlay(storage)[String(track.id || '')];
  return entry?.spotifyTrackId === id && id && entry?.trackId === String(track.id || '')
    ? trustedArtworkUrl(entry.artworkUrl)
    : '';
}

function persistOembedArtwork(storage, track, artworkUrl) {
  const spotifyId = spotifyTrackId(track.spotifyUrl || track.spotifyUri || '');
  if (!spotifyId || !trustedArtworkUrl(artworkUrl) || !storage?.setItem) return false;
  try {
    const entries = readOembedOverlay(storage);
    entries[String(track.id)] = {
      trackId: String(track.id),
      spotifyTrackId: spotifyId,
      artworkUrl,
      source: 'spotify-oembed',
    };
    storage.setItem(OEMBED_OVERLAY_KEY, JSON.stringify({ version: 1, entries }));
    return true;
  } catch {
    return false;
  }
}

function findCardForTrack(root, trackId) {
  const expected = `spotify-${String(trackId || '')}`;
  const input = Array.from(root.querySelectorAll?.('[data-link-input]') || [])
    .find((node) => node.getAttribute('data-link-input') === expected);
  return input?.closest?.('.player-deck-card') || null;
}

function removeStaleArtworkPanel(card) {
  const panel = card?.querySelector?.('[data-catalog-artwork]');
  if (!panel || panel.dataset.automaticMediaArtwork === 'youtube') return false;
  panel.remove();
  return true;
}

function ensureArtworkPanel(card, track, artworkUrl) {
  if (!card || !artworkUrl) return false;
  let panel = card.querySelector('[data-catalog-artwork]');
  if (panel?.dataset.automaticMediaArtwork === 'youtube') return false;
  let created = false;

  if (!panel) {
    panel = document.createElement('div');
    panel.dataset.catalogArtwork = 'true';
    panel.dataset.catalogArtworkContinuity = 'true';
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
    source.textContent = 'Spotify track artwork';
    copy.append(title, source);
    panel.append(image, copy);

    const header = card.querySelector('.music-card-header');
    if (header?.after) header.after(panel);
    else card.prepend(panel);
    created = true;
  }

  const image = panel.querySelector('img');
  const title = panel.querySelector('[data-catalog-artwork-title]');
  if (!image || !title) return false;

  const nextAlt = `Artwork for ${String(track.title || track.name || 'this track')}`;
  const nextTitle = `${String(track.title || track.name || 'Unknown track')} · ${String(track.artist || 'Unknown artist')}`;
  let changed = created;
  if (image.getAttribute('src') !== artworkUrl) {
    image.src = artworkUrl;
    changed = true;
  }
  if (image.alt !== nextAlt) {
    image.alt = nextAlt;
    changed = true;
  }
  if (title.textContent !== nextTitle) {
    title.textContent = nextTitle;
    changed = true;
  }
  return changed;
}

export function hydrateCatalogArtworkContinuity({
  root = globalThis.document,
  storage = globalThis.localStorage,
} = {}) {
  if (!root?.querySelectorAll) return { checked: 0, hydrated: 0, staleRemoved: 0, overlayChecked: 0, overlayHydrated: 0 };
  const deck = readListeningDeck(storage);
  let hydrated = 0;
  let checked = 0;
  let staleRemoved = 0;

  for (const track of deck) {
    if (!track?.id) continue;
    const card = findCardForTrack(root, track.id);
    const catalogArtwork = canUseVerifiedSpotifyArtwork(track) && artworkMatchesCurrentSpotifyTrack(track)
      ? trustedArtworkUrl(track?.artworkUrl)
      : '';
    const artworkUrl = canUseVerifiedSpotifyArtwork(track)
      ? (catalogArtwork || trustedOembedArtwork(track, storage))
      : '';
    if (!artworkUrl) {
      if (removeStaleArtworkPanel(card)) staleRemoved += 1;
      continue;
    }
    checked += 1;
    if (card && ensureArtworkPanel(card, track, artworkUrl)) hydrated += 1;
  }

  const overlay = hydrateAutomaticMediaOverlay({ root, storage });
  return {
    checked,
    hydrated,
    staleRemoved,
    overlayChecked: overlay.checked,
    overlayHydrated: overlay.hydrated,
  };
}

let hydrationQueued = false;
function queueHydration() {
  if (hydrationQueued) return;
  hydrationQueued = true;
  queueMicrotask(() => {
    hydrationQueued = false;
    hydrateCatalogArtworkContinuity();
  });
}

// This is intentionally a bounded page-lifetime continuity pass, not a daemon.
// Public Spotify oEmbed fills cover art for cards that already have an exact
// Spotify track URL, even when Spotify Web API credentials are absent.
function needsOembedLookup(track, storage, root) {
  const spotifyId = spotifyTrackId(track?.spotifyUrl || track?.spotifyUri || '');
  if (!track?.id || !spotifyId || !canUseVerifiedSpotifyArtwork(track) || !findCardForTrack(root, track.id)) return false;
  if (artworkMatchesCurrentSpotifyTrack(track) && trustedArtworkUrl(track.artworkUrl)) return false;
  if (trustedOembedArtwork(track, storage)) return false;
  return (oembedAttempts.get(`${track.id}::${spotifyId}`) || 0) < OEMBED_MAX_ATTEMPTS;
}

export async function runSpotifyOembedArtworkPass({
  storage = globalThis.localStorage,
  root = globalThis.document,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!storage?.getItem || !root?.querySelectorAll || typeof fetchImpl !== 'function') {
    return { ok: false, attemptedCount: 0, hydratedCount: 0, pendingCount: 0 };
  }
  const due = readListeningDeck(storage)
    .filter((track) => needsOembedLookup(track, storage, root))
    .slice(0, OEMBED_MAX_TRACKS_PER_PASS);
  let cursor = 0;
  let hydratedCount = 0;
  const worker = async () => {
    while (cursor < due.length) {
      const track = due[cursor++];
      const spotifyId = spotifyTrackId(track.spotifyUrl || track.spotifyUri || '');
      const key = `${track.id}::${spotifyId}`;
      oembedAttempts.set(key, (oembedAttempts.get(key) || 0) + 1);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      try {
        const response = await fetchImpl(
          `/api/music/spotify/oembed-artwork?trackId=${encodeURIComponent(spotifyId)}`,
          { signal: controller.signal },
        );
        if (!response.ok) continue;
        const data = await response.json();
        const url = trustedArtworkUrl(data?.artworkUrl);
        if (!data?.ok || data.trackId !== spotifyId || !url) continue;
        const current = readListeningDeck(storage).find((candidate) => String(candidate.id) === String(track.id));
        if (!current || !canUseVerifiedSpotifyArtwork(current)
          || spotifyTrackId(current.spotifyUrl || current.spotifyUri || '') !== spotifyId) continue;
        if (persistOembedArtwork(storage, current, url)) {
          hydratedCount += 1;
          hydrateCatalogArtworkContinuity({ storage, root });
        }
      } catch {
        // Network and provider failures remain fail-closed, then retry at most three times.
      } finally {
        clearTimeout(timer);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, due.length) }, () => worker()));
  const pendingCount = readListeningDeck(storage)
    .filter((track) => needsOembedLookup(track, storage, root)).length;
  return { ok: true, attemptedCount: due.length, hydratedCount, pendingCount };
}

function queueOembedLookup(delayMs = 900) {
  if (oembedRunning || oembedTimer !== null || typeof document === 'undefined') return;
  oembedTimer = setTimeout(async () => {
    oembedTimer = null;
    if (oembedRunning) return;
    oembedRunning = true;
    let result = null;
    try {
      result = await runSpotifyOembedArtworkPass();
    } finally {
      oembedRunning = false;
    }
    if (result?.pendingCount > 0) queueOembedLookup(2500);
  }, delayMs);
}

export function installCatalogArtworkContinuity() {
  if (typeof document === 'undefined') return null;
  const start = () => {
    queueHydration();
    queueOembedLookup();
    const deck = document.getElementById('listening-deck');
    if (!deck || typeof MutationObserver !== 'function') return null;
    const observer = new MutationObserver(() => {
      queueHydration();
      queueOembedLookup();
    });
    observer.observe(deck, { childList: true, subtree: true });
    globalThis.addEventListener?.('online', () => {
      oembedAttempts.clear();
      queueOembedLookup(100);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') queueOembedLookup(100);
    });
    return observer;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
    return null;
  }
  return start();
}

installCatalogArtworkContinuity();
