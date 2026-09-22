import './nativeCatalogLinkContinuity.js';
import { hydrateAutomaticMediaOverlay } from './automaticMediaOverlay.js';

const STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
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

function readListeningDeck(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(STORAGE_KEY) || '{}');
    return Array.isArray(parsed?.listeningDeck) ? parsed.listeningDeck : [];
  } catch {
    return [];
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
    source.textContent = 'Verified Spotify catalogue artwork';
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
    const artworkUrl = trustedArtworkUrl(track?.artworkUrl);
    if (!artworkUrl || !artworkMatchesCurrentSpotifyTrack(track)) {
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

export function installCatalogArtworkContinuity() {
  if (typeof document === 'undefined') return null;
  const start = () => {
    queueHydration();
    const deck = document.getElementById('listening-deck');
    if (!deck || typeof MutationObserver !== 'function') return null;
    const observer = new MutationObserver(queueHydration);
    observer.observe(deck, { childList: true, subtree: true });
    return observer;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
    return null;
  }
  return start();
}

installCatalogArtworkContinuity();
