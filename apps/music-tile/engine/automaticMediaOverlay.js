const DASHBOARD_STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
const OVERLAY_STORAGE_KEY = 'stephanos.musicTile.automaticMediaOverlay.v1';
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function text(value = '') { return String(value ?? '').trim(); }
function normalizedIdentity(value = '') { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

export function exactYouTubeVideoId(value = '') {
  const raw = text(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host === 'youtu.be') {
      const id = url.pathname.replace(/^\/+/, '').split('/')[0];
      return VIDEO_ID.test(id) ? id : '';
    }
    if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const id = url.pathname === '/watch' ? text(url.searchParams.get('v')) : '';
      return VIDEO_ID.test(id) ? id : '';
    }
  } catch {}
  return '';
}

export function canonicalYouTubeWatchUrl(value = '') {
  const videoId = exactYouTubeVideoId(value);
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : '';
}

export function trustedYouTubeArtworkUrl(videoId = '') {
  const id = text(videoId);
  return VIDEO_ID.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
}

export function hasExactYouTubeTrack(track = {}) {
  return Boolean(canonicalYouTubeWatchUrl(track.youtubeUrl || ''));
}

function readJson(storage, key, fallback) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(key) || '');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeOverlayEntry(storage, entry) {
  if (!storage?.setItem) return false;
  const overlay = readJson(storage, OVERLAY_STORAGE_KEY, { version: 1, entries: {} });
  const entries = overlay.entries && typeof overlay.entries === 'object' && !Array.isArray(overlay.entries)
    ? { ...overlay.entries }
    : {};
  entries[entry.trackId] = entry;
  storage.setItem(OVERLAY_STORAGE_KEY, JSON.stringify({ version: 1, entries }));
  return true;
}

function findLinkInput(root, kind, trackId) {
  const expected = `${kind}-${trackId}`;
  return Array.from(root?.querySelectorAll?.('[data-link-input]') || [])
    .find((node) => node.getAttribute('data-link-input') === expected) || null;
}

function findAction(root, action, trackId) {
  return Array.from(root?.querySelectorAll?.(`[data-action="${action}"]`) || [])
    .find((node) => String(node.getAttribute('data-id') || '') === String(trackId || '')) || null;
}

function removeManualFindLinks(card) {
  for (const link of Array.from(card?.querySelectorAll?.('.media-controls a') || [])) {
    if (/^Find on (Spotify|YouTube)$/i.test(text(link.textContent))) link.remove();
  }
}

function ensureYoutubeOpenLink(card, youtubeUrl) {
  const controls = card?.querySelector?.('.media-controls');
  if (!controls) return false;
  const existing = Array.from(controls.querySelectorAll('a')).find((link) => canonicalYouTubeWatchUrl(link.getAttribute('href')) === youtubeUrl);
  if (existing) {
    if (existing.textContent !== 'Open in YouTube') existing.textContent = 'Open in YouTube';
    return false;
  }
  const link = document.createElement('a');
  link.className = 'media-btn youtube';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.href = youtubeUrl;
  link.textContent = 'Open in YouTube';
  controls.append(link);
  return true;
}

function ensureArtwork(card, track, artworkUrl) {
  if (!card || !artworkUrl || typeof document === 'undefined') return false;
  let panel = card.querySelector('[data-catalog-artwork]');
  let changed = false;
  if (!panel) {
    panel = document.createElement('div');
    panel.dataset.catalogArtwork = 'true';
    panel.dataset.automaticMediaArtwork = 'youtube';
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
    source.textContent = 'Verified YouTube artwork';
    copy.append(title, source);
    panel.append(image, copy);
    const header = card.querySelector('.music-card-header');
    if (header?.after) header.after(panel);
    else card.prepend(panel);
    changed = true;
  }
  const image = panel.querySelector('img');
  const title = panel.querySelector('[data-catalog-artwork-title]');
  if (!image || !title) return changed;
  const nextAlt = `Artwork for ${text(track.title || track.name || 'this track')}`;
  const nextTitle = `${text(track.title || track.name || 'Unknown track')} · ${text(track.artist || 'Unknown artist')}`;
  if (image.getAttribute('src') !== artworkUrl) { image.src = artworkUrl; changed = true; }
  if (image.alt !== nextAlt) { image.alt = nextAlt; changed = true; }
  if (title.textContent !== nextTitle) { title.textContent = nextTitle; changed = true; }
  return changed;
}

function currentStoredTrack(storage, trackId) {
  const dashboard = readJson(storage, DASHBOARD_STORAGE_KEY, {});
  return (Array.isArray(dashboard.listeningDeck) ? dashboard.listeningDeck : [])
    .find((track) => String(track?.id || '') === String(trackId || '')) || null;
}

export function hydrateAutomaticMediaOverlay({ root = globalThis.document, storage = globalThis.localStorage } = {}) {
  if (!root?.querySelectorAll || !storage?.getItem) return { checked: 0, hydrated: 0 };
  const overlay = readJson(storage, OVERLAY_STORAGE_KEY, { entries: {} });
  const entries = overlay.entries && typeof overlay.entries === 'object' ? Object.values(overlay.entries) : [];
  let checked = 0;
  let hydrated = 0;
  for (const entry of entries) {
    const videoId = text(entry?.youtubeVideoId);
    const youtubeUrl = canonicalYouTubeWatchUrl(entry?.youtubeUrl);
    if (!VIDEO_ID.test(videoId) || !youtubeUrl || exactYouTubeVideoId(youtubeUrl) !== videoId) continue;
    const track = currentStoredTrack(storage, entry.trackId);
    if (!track) continue;
    if (normalizedIdentity(track.artist) !== normalizedIdentity(entry.artist)
      || normalizedIdentity(track.title || track.name) !== normalizedIdentity(entry.title)
      || canonicalYouTubeWatchUrl(track.youtubeUrl || '') !== youtubeUrl) continue;
    const input = findLinkInput(root, 'youtube', entry.trackId);
    const card = input?.closest?.('.player-deck-card');
    if (!card) continue;
    checked += 1;
    if (input.value !== youtubeUrl) input.value = youtubeUrl;
    findAction(root, 'resolve-youtube-link', entry.trackId)?.remove();
    ensureYoutubeOpenLink(card, youtubeUrl);
    removeManualFindLinks(card);
    const status = Array.from(card.querySelectorAll('.meta')).find((node) => /Needs verified Spotify link/.test(node.textContent || ''));
    if (status) status.textContent = 'YouTube track verified automatically · Spotify optional.';
    const artworkUrl = trustedYouTubeArtworkUrl(videoId);
    if (ensureArtwork(card, track, artworkUrl)) hydrated += 1;
  }
  return { checked, hydrated };
}

export function applyYouTubeMediaResolutionToBrowser(rawDetail = {}, {
  root = globalThis.document,
  storage = globalThis.localStorage,
  now = () => new Date().toISOString(),
} = {}) {
  const trackId = text(rawDetail.trackId);
  const artist = text(rawDetail.artist);
  const title = text(rawDetail.title);
  const videoId = text(rawDetail.youtubeVideoId || exactYouTubeVideoId(rawDetail.youtubeUrl));
  const youtubeUrl = canonicalYouTubeWatchUrl(rawDetail.youtubeUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ''));
  if (!trackId || !artist || !title || !VIDEO_ID.test(videoId) || !youtubeUrl || exactYouTubeVideoId(youtubeUrl) !== videoId) {
    return { ok: false, changed: false, reason: 'youtube-enrichment-invalid' };
  }
  if (!root?.querySelectorAll || !storage?.getItem || !storage?.setItem) {
    return { ok: true, changed: false, reason: 'non-browser-runtime' };
  }
  const stored = currentStoredTrack(storage, trackId);
  if (!stored
    || normalizedIdentity(stored.artist) !== normalizedIdentity(artist)
    || normalizedIdentity(stored.title || stored.name) !== normalizedIdentity(title)) {
    return { ok: false, changed: false, reason: 'existing-track-not-persisted' };
  }
  const currentUrl = canonicalYouTubeWatchUrl(stored.youtubeUrl || '');
  if (currentUrl && currentUrl !== youtubeUrl) return { ok: false, changed: false, reason: 'youtube-track-conflict' };

  const input = findLinkInput(root, 'youtube', trackId);
  const saveButton = findAction(root, 'save-youtube-link', trackId);
  if (!input || !saveButton) return { ok: false, changed: false, reason: 'youtube-card-controls-unavailable' };
  const changed = currentUrl !== youtubeUrl;
  if (changed) {
    input.value = youtubeUrl;
    saveButton.click();
  }

  const entry = Object.freeze({
    trackId,
    artist,
    title,
    youtubeVideoId: videoId,
    youtubeUrl,
    artworkUrl: trustedYouTubeArtworkUrl(videoId),
    artworkSource: 'youtube-catalogue',
    catalogVerificationStatus: 'metadata_verified',
    catalogLinkSource: 'native-catalog-search',
    resolvedAt: now(),
  });
  try { writeOverlayEntry(storage, entry); }
  catch { return { ok: false, changed: false, reason: 'automatic-media-overlay-persistence-failed' }; }
  const hydration = hydrateAutomaticMediaOverlay({ root, storage });
  return { ok: true, changed, reason: changed ? 'youtube-resolved' : 'already-resolved', entry, hydration };
}
