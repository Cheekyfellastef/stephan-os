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

function ensureArtworkPanel(card, track, artworkUrl) {
  if (!card || !artworkUrl) return false;
  let panel = card.querySelector('[data-catalog-artwork]');
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
  if (!root?.querySelectorAll) return { checked: 0, hydrated: 0 };
  const deck = readListeningDeck(storage);
  let hydrated = 0;
  let checked = 0;

  for (const track of deck) {
    const artworkUrl = trustedArtworkUrl(track?.artworkUrl);
    if (!artworkUrl || !track?.id) continue;
    checked += 1;
    const card = findCardForTrack(root, track.id);
    if (card && ensureArtworkPanel(card, track, artworkUrl)) hydrated += 1;
  }

  return { checked, hydrated };
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
