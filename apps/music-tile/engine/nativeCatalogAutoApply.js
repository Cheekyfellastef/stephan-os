import { resolveSpotifyReference } from '../utils/spotifyEmbed.js';

const STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
const AUTO_APPLY_MESSAGE = 'Spotify track URL found by Stephanos and applied automatically.';
const pendingAnnouncements = new Map();
let announcementQueued = false;
let hydrationQueued = false;
let observerInstalled = false;

function normalizedIdentity(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validatedDetail(detail = {}) {
  if (!plainObject(detail) || !plainObject(detail.enrichment)) return null;
  const spotify = resolveSpotifyReference(detail.spotifyUrl || detail.spotifyUri || '');
  if (!spotify.valid || spotify.type !== 'track') return null;
  if (String(detail.enrichment.spotifyUrl || '') !== spotify.openUrl
    || String(detail.enrichment.spotifyUri || '') !== spotify.uri
    || String(detail.enrichment.catalogVerificationStatus || '') !== 'metadata_verified'
    || String(detail.enrichment.catalogLinkSource || '') !== 'native-catalog-search') return null;
  return {
    trackId: String(detail.trackId || ''),
    artist: String(detail.artist || ''),
    title: String(detail.title || ''),
    spotify,
    enrichment: {
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
    },
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

function readStoredState() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '{}');
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

function updateTrackCard(track, spotify) {
  if (typeof document === 'undefined' || !track || !spotify?.openUrl) return false;
  const input = findTrackInput(track.id);
  const card = input?.closest('.player-deck-card');
  if (!input || !card) return false;
  if (input.value !== spotify.openUrl) input.value = spotify.openUrl;
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
  queueMicrotask(() => {
    announcementQueued = false;
    const count = pendingAnnouncements.size;
    pendingAnnouncements.clear();
    const status = document.getElementById('native-music-search-status');
    if (!status || !count) return;
    const suffix = `${count} existing song card${count === 1 ? '' : 's'} updated automatically`;
    if (!status.textContent.includes(suffix)) status.textContent = `${status.textContent} · ${suffix}`;
  });
}

export function hydratePersistedCatalogLinks() {
  if (typeof document === 'undefined' || !globalThis.localStorage) return 0;
  const snapshot = readStoredState();
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
  queueMicrotask(() => {
    hydrationQueued = false;
    hydratePersistedCatalogLinks();
  });
}

export function applyCatalogEnrichmentToBrowser(rawDetail = {}) {
  if (!globalThis.localStorage || typeof document === 'undefined') {
    return { ok: true, changed: false, reason: 'non-browser-runtime' };
  }
  const snapshot = readStoredState();
  const merged = mergePersistedCatalogState(snapshot, rawDetail);
  if (!merged.ok) return merged;
  try {
    if (merged.changed) globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    return { ok: false, changed: false, reason: 'music-state-persistence-failed' };
  }
  if (merged.changed) {
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
  const observer = new MutationObserver(() => queueHydration());
  observer.observe(deck, { childList: true, subtree: true });
  queueHydration();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installHydrationObserver, { once: true });
  } else {
    queueMicrotask(installHydrationObserver);
  }
}
