import { mergePersistedCatalogState } from './nativeCatalogAutoApply.js';
import { resolveSpotifyReference } from '../utils/spotifyEmbed.js';

const STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
const MAX_TRACKS_PER_PASS = 20;
const HYDRATION_CONCURRENCY = 2;
const REQUEST_TIMEOUT_MS = 8000;
const RETRY_DELAYS_MS = Object.freeze([5000, 15000, 60000, 300000]);
const SPOTIFY_ARTWORK_HOST_SUFFIXES = Object.freeze(['scdn.co', 'spotifycdn.com']);
const metadataCache = new Map();
const retryState = new Map();
const retryTimers = new Map();
let queuePending = false;
let hydrationRunning = false;
let observerInstalled = false;

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

function readState(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeArtworkUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const trusted = SPOTIFY_ARTWORK_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
    return url.protocol === 'https:' && trusted ? url.toString() : '';
  } catch {
    return '';
  }
}

function placeholderIdentity(track = {}) {
  const title = String(track.title || track.name || '').trim().toLowerCase();
  const artist = String(track.artist || '').trim().toLowerCase();
  return title === 'spotify track'
    || title === 'unknown track'
    || artist === 'unknown'
    || artist === 'unknown artist';
}

function hydrationKey(track = {}) {
  const spotify = resolveSpotifyReference(track.spotifyUrl || track.spotifyUri || '');
  if (!spotify.valid || spotify.type !== 'track') return '';
  return `${String(track.id || '')}::${spotify.id}`;
}

function needsExactHydration(track = {}) {
  const spotify = resolveSpotifyReference(track.spotifyUrl || track.spotifyUri || '');
  if (!spotify.valid || spotify.type !== 'track') return false;
  const artwork = normalizeArtworkUrl(track.artworkUrl);
  const exactMetadataBound = String(track.catalogProvider || '').toLowerCase() === 'spotify'
    && String(track.catalogProviderItemId || '') === spotify.id
    && String(track.catalogVerificationStatus || '') === 'metadata_verified';
  return placeholderIdentity(track) || !artwork || !exactMetadataBound;
}

function retryDue(key, nowMs) {
  const retry = retryState.get(key);
  return !retry || nowMs >= retry.nextAttemptAt;
}

function clearRetry(key) {
  retryState.delete(key);
  const timer = retryTimers.get(key);
  if (timer) clearTimeout(timer);
  retryTimers.delete(key);
}

function recordFailure(key, nowMs) {
  const previous = retryState.get(key);
  const failures = Math.min((previous?.failures || 0) + 1, RETRY_DELAYS_MS.length);
  const delayMs = RETRY_DELAYS_MS[Math.max(0, failures - 1)];
  retryState.set(key, { failures, nextAttemptAt: nowMs + delayMs });
  if (typeof document !== 'undefined' && !retryTimers.has(key)) {
    const timer = setTimeout(() => {
      retryTimers.delete(key);
      queueExactSpotifyLinkHydration();
    }, delayMs);
    retryTimers.set(key, timer);
  }
}

function validatedExactResult(payload, spotify) {
  const result = payload?.result;
  if (!payload?.ok || payload?.exactLookup !== true || !result || typeof result !== 'object') return null;
  if (String(result.provider || '').toLowerCase() !== 'spotify') return null;
  if (String(result.providerItemId || '') !== spotify.id) return null;
  if (String(result.verificationStatus || '') !== 'metadata_verified') return null;
  const resolved = resolveSpotifyReference(result.spotifyUrl || result.spotifyUri || '');
  if (!resolved.valid || resolved.type !== 'track' || resolved.id !== spotify.id) return null;
  const title = String(result.title || '').trim();
  const artist = String(result.artist || '').trim();
  if (!title || !artist) return null;
  const artworkUrl = normalizeArtworkUrl(result.artworkUrl);
  if (result.artworkUrl && !artworkUrl) return null;
  return Object.freeze({ ...result, artworkUrl });
}

async function fetchExactMetadata(track, {
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const spotify = resolveSpotifyReference(track.spotifyUrl || track.spotifyUri || '');
  if (!spotify.valid || spotify.type !== 'track' || typeof fetchImpl !== 'function') return null;
  const cached = metadataCache.get(spotify.id);
  if (cached) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs || REQUEST_TIMEOUT_MS)));
  try {
    const response = await fetchImpl(`/api/music/catalog/track?id=${encodeURIComponent(spotify.id)}`, {
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) return null;
    const result = validatedExactResult(payload, spotify);
    if (!result) return null;
    metadataCache.set(spotify.id, result);
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function exactDetail(track, result) {
  const spotify = resolveSpotifyReference(track.spotifyUrl || track.spotifyUri || '');
  if (!spotify.valid || spotify.type !== 'track' || spotify.id !== result.providerItemId) return null;
  const enrichment = {
    spotifyUrl: spotify.openUrl,
    spotifyUri: spotify.uri,
    catalogProvider: 'spotify',
    catalogProviderLabel: String(result.providerLabel || 'Spotify'),
    catalogProviderItemId: spotify.id,
    catalogProviderUrl: String(result.providerUrl || spotify.openUrl),
    catalogConfidence: String(result.confidence || 'high'),
    catalogVerificationStatus: 'metadata_verified',
    catalogPlaybackAvailability: String(result.playbackAvailability || 'playback_unverified'),
    catalogLinkSource: 'native-catalog-search',
  };
  if (result.artworkUrl) {
    enrichment.artworkUrl = result.artworkUrl;
    enrichment.artworkSource = 'spotify-catalogue';
  }
  return {
    trackId: String(track.id || ''),
    artist: String(track.artist || ''),
    title: String(track.title || track.name || ''),
    spotifyUrl: spotify.openUrl,
    spotifyUri: spotify.uri,
    enrichment,
  };
}

function mergeExactMetadata(snapshot, track, result) {
  const detail = exactDetail(track, result);
  if (!detail) return { ok: false, changed: false, track: null };
  const merged = mergePersistedCatalogState(snapshot, detail);
  if (!merged.ok || !merged.track) return merged;
  let changed = merged.changed;
  const metadata = {
    title: String(result.title || '').trim(),
    artist: String(result.artist || '').trim(),
    album: String(result.album || '').trim(),
    exactSpotifyLinkHydrated: true,
  };
  for (const [key, value] of Object.entries(metadata)) {
    if (String(merged.track[key] ?? '') === String(value ?? '')) continue;
    merged.track[key] = value;
    changed = true;
  }
  return { ...merged, changed };
}

function ensureArtworkPanel(card, track) {
  const artworkUrl = normalizeArtworkUrl(track?.artworkUrl);
  if (!card || !artworkUrl) return false;
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
  image.src = artworkUrl;
  image.alt = `Artwork for ${String(track.title || 'this track')}`;
  title.textContent = `${String(track.title || 'Unknown track')} · ${String(track.artist || 'Unknown artist')}`;
  return true;
}

function updateExactCard(track, ratings = {}) {
  if (typeof document === 'undefined' || !track) return false;
  const spotify = resolveSpotifyReference(track.spotifyUrl || track.spotifyUri || '');
  if (!spotify.valid || spotify.type !== 'track') return false;
  const input = Array.from(document.querySelectorAll('[data-link-input]'))
    .find((node) => node.getAttribute('data-link-input') === `spotify-${track.id}`);
  const card = input?.closest('.player-deck-card');
  if (!card) return false;
  if (input.value !== spotify.openUrl) input.value = spotify.openUrl;
  const title = card.querySelector('.music-card-title');
  const meta = card.querySelector('.music-card-header .music-card-meta');
  if (title) title.textContent = String(track.title || 'Unknown track');
  if (meta) meta.textContent = `${String(track.artist || 'Unknown Artist')} · rating ${ratings?.[track.id] ?? 'unrated'}`;
  ensureArtworkPanel(card, track);
  let message = card.querySelector('[data-exact-link-hydration-message]');
  const editor = input.closest('.links-editor');
  if (editor && !message) {
    message = document.createElement('div');
    message.className = 'meta';
    message.dataset.exactLinkHydrationMessage = 'true';
    editor.append(message);
  }
  if (message) message.textContent = 'Spotify card metadata and artwork hydrated automatically.';
  return true;
}

export async function resolveExactSpotifyLinkCards({
  storage = browserStorage(),
  fetchImpl = globalThis.fetch,
  maxTracks = MAX_TRACKS_PER_PASS,
  timeoutMs = REQUEST_TIMEOUT_MS,
  now = () => Date.now(),
} = {}) {
  if (!storage) return { ok: false, reason: 'music-state-storage-unavailable', attemptedCount: 0, resolvedCount: 0 };
  const snapshot = readState(storage);
  if (!snapshot || !Array.isArray(snapshot.listeningDeck)) {
    return { ok: false, reason: 'music-state-invalid', attemptedCount: 0, resolvedCount: 0 };
  }
  const nowMs = Number(now());
  const pending = snapshot.listeningDeck
    .filter(needsExactHydration)
    .filter((track) => retryDue(hydrationKey(track), nowMs))
    .slice(0, Math.max(0, Math.min(Number(maxTracks) || MAX_TRACKS_PER_PASS, MAX_TRACKS_PER_PASS)));
  if (!pending.length) return { ok: true, reason: 'nothing-to-hydrate', attemptedCount: 0, resolvedCount: 0 };

  let cursor = 0;
  let changed = false;
  const resolvedTracks = [];
  const worker = async () => {
    while (cursor < pending.length) {
      const track = pending[cursor];
      cursor += 1;
      const key = hydrationKey(track);
      const result = await fetchExactMetadata(track, { fetchImpl, timeoutMs });
      if (!result) {
        recordFailure(key, nowMs);
        continue;
      }
      const merged = mergeExactMetadata(snapshot, track, result);
      if (!merged.ok || !merged.track) {
        recordFailure(key, nowMs);
        continue;
      }
      clearRetry(key);
      changed = changed || merged.changed;
      resolvedTracks.push(merged.track);
    }
  };
  const workers = Math.min(HYDRATION_CONCURRENCY, pending.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));

  if (changed) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      return { ok: false, reason: 'music-state-persistence-failed', attemptedCount: pending.length, resolvedCount: 0 };
    }
  }
  if (typeof document !== 'undefined') {
    for (const track of resolvedTracks) updateExactCard(track, snapshot.ratings || {});
  }
  return {
    ok: true,
    reason: resolvedTracks.length ? 'hydrated' : 'no-exact-metadata',
    attemptedCount: pending.length,
    resolvedCount: resolvedTracks.length,
  };
}

export function queueExactSpotifyLinkHydration() {
  if (queuePending || hydrationRunning || typeof document === 'undefined') return;
  queuePending = true;
  queueMicrotask(() => {
    queuePending = false;
    hydrationRunning = true;
    resolveExactSpotifyLinkCards()
      .finally(() => { hydrationRunning = false; });
  });
}

function installExactSpotifyLinkObserver() {
  if (observerInstalled || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const deck = document.getElementById('listening-deck');
  if (!deck) return;
  observerInstalled = true;
  const observer = new MutationObserver((records) => {
    const deckStructureChanged = records.some((record) => Array.from(record.addedNodes || [])
      .some((node) => node?.nodeType === 1 && (node.matches?.('.player-deck-card') || node.querySelector?.('.player-deck-card'))));
    if (deckStructureChanged) queueExactSpotifyLinkHydration();
  });
  observer.observe(deck, { childList: true, subtree: false });
  queueExactSpotifyLinkHydration();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installExactSpotifyLinkObserver, { once: true });
  } else {
    queueMicrotask(installExactSpotifyLinkObserver);
  }
}
