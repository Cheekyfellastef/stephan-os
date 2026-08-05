import { readFileSync, writeFileSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function write(path, content) {
  writeFileSync(path, content, 'utf8');
}

function replaceOnce(content, needle, replacement, label) {
  const first = content.indexOf(needle);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (content.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`Patch anchor is not unique: ${label}`);
  }
  return `${content.slice(0, first)}${replacement}${content.slice(first + needle.length)}`;
}

function replaceRegexOnce(content, pattern, replacement, label) {
  const matches = [...content.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) throw new Error(`Expected one regex patch anchor for ${label}, found ${matches.length}`);
  return content.replace(pattern, replacement);
}

const serverPath = 'stephanos-server/services/musicCatalogSearch.js';
let server = read(serverPath);
server = replaceOnce(server,
`function normalizeIsrc(value) {
  const isrc = String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}\\d{7}$/.test(isrc) ? isrc : '';
}
`,
`function normalizeIsrc(value) {
  const isrc = String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}\\d{7}$/.test(isrc) ? isrc : '';
}

const SPOTIFY_ARTWORK_HOST_SUFFIXES = Object.freeze(['scdn.co', 'spotifycdn.com']);

export function normalizeSpotifyArtworkUrl(images = []) {
  for (const image of Array.isArray(images) ? images : []) {
    const raw = String(image?.url || '').trim();
    if (!raw) continue;
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      const trustedHost = SPOTIFY_ARTWORK_HOST_SUFFIXES.some((suffix) => (
        host === suffix || host.endsWith(\`.\${suffix}\`)
      ));
      if (url.protocol === 'https:' && trustedHost) return url.toString();
    } catch {
      // Ignore malformed provider artwork instead of projecting it to the browser.
    }
  }
  return '';
}
`, 'server artwork normalizer');
server = replaceOnce(server,
`    durationMs: Math.max(0, Number(recording.length || 0)),
    confidence: score >= 90 ? 'high' : score >= 70 ? 'medium' : 'low',`,
`    durationMs: Math.max(0, Number(recording.length || 0)),
    artworkUrl: '',
    confidence: score >= 90 ? 'high' : score >= 70 ? 'medium' : 'low',`, 'MusicBrainz artwork field');
server = replaceOnce(server,
`    durationMs: Math.max(0, Number(track.duration_ms || 0)),
    confidence: 'high',`,
`    durationMs: Math.max(0, Number(track.duration_ms || 0)),
    artworkUrl: normalizeSpotifyArtworkUrl(track.album?.images),
    confidence: 'high',`, 'Spotify artwork field');
write(serverPath, server);

const searchPath = 'apps/music-tile/engine/nativeCatalogSearch.js';
let search = read(searchPath);
search = replaceOnce(search,
`function normalizedIdentity(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
`,
`function normalizedIdentity(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const SPOTIFY_ARTWORK_HOST_SUFFIXES = Object.freeze(['scdn.co', 'spotifycdn.com']);

export function normalizeCatalogArtworkUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const trustedHost = SPOTIFY_ARTWORK_HOST_SUFFIXES.some((suffix) => (
      host === suffix || host.endsWith(\`.\${suffix}\`)
    ));
    return url.protocol === 'https:' && trustedHost ? url.toString() : '';
  } catch {
    return '';
  }
}
`, 'browser artwork normalizer');
search = replaceOnce(search,
`  const universalId = String(result.universalId || \`\${provider}:track:\${providerItemId}\`).trim();
  return {`,
`  const universalId = String(result.universalId || \`\${provider}:track:\${providerItemId}\`).trim();
  const spotify = resolveSpotifyReference(result.spotifyUrl || result.spotifyUri || '');
  const artworkUrl = normalizeCatalogArtworkUrl(result.artworkUrl);
  return {`, 'catalogue track local variables');
search = replaceOnce(search,
`    spotifyUrl: String(result.spotifyUrl || ''),
    spotifyUri: String(result.spotifyUri || ''),
    spotifySearchUrl: String(result.spotifySearchUrl || ''),
    candidateVerificationStatus: 'search-only',`,
`    spotifyUrl: spotify.valid && spotify.type === 'track' ? spotify.openUrl : '',
    spotifyUri: spotify.valid && spotify.type === 'track' ? spotify.uri : '',
    spotifySearchUrl: String(result.spotifySearchUrl || ''),
    artworkUrl,
    artworkSource: artworkUrl ? 'spotify-catalogue' : '',
    catalogLinkSource: spotify.valid && spotify.type === 'track' ? 'native-catalog-search' : '',
    candidateVerificationStatus: 'search-only',`, 'catalogue track artwork projection');
search = replaceOnce(search,
`  const enrichment = Object.freeze({
    spotifyUrl: incomingSpotify.openUrl,
    spotifyUri: incomingSpotify.uri,
    catalogProvider: catalogTrack.catalogProvider,
    catalogProviderLabel: catalogTrack.catalogProviderLabel,
    catalogProviderItemId: catalogTrack.catalogProviderItemId,
    catalogProviderUrl: catalogTrack.catalogProviderUrl,
    catalogConfidence: catalogTrack.catalogConfidence,
    catalogVerificationStatus: catalogTrack.catalogVerificationStatus,
    catalogPlaybackAvailability: catalogTrack.catalogPlaybackAvailability,
    catalogLinkSource: 'native-catalog-search',
  });`,
`  const enrichment = {
    spotifyUrl: incomingSpotify.openUrl,
    spotifyUri: incomingSpotify.uri,
    catalogProvider: catalogTrack.catalogProvider,
    catalogProviderLabel: catalogTrack.catalogProviderLabel,
    catalogProviderItemId: catalogTrack.catalogProviderItemId,
    catalogProviderUrl: catalogTrack.catalogProviderUrl,
    catalogConfidence: catalogTrack.catalogConfidence,
    catalogVerificationStatus: catalogTrack.catalogVerificationStatus,
    catalogPlaybackAvailability: catalogTrack.catalogPlaybackAvailability,
    catalogLinkSource: 'native-catalog-search',
  };
  if (catalogTrack.artworkUrl) {
    enrichment.artworkUrl = catalogTrack.artworkUrl;
    enrichment.artworkSource = 'spotify-catalogue';
  }
  Object.freeze(enrichment);`, 'catalogue enrichment artwork');
write(searchPath, search);

const autoPath = 'apps/music-tile/engine/nativeCatalogAutoApply.js';
let auto = read(autoPath);
auto = replaceOnce(auto,
`const AUTO_APPLY_MESSAGE = 'Spotify track URL found by Stephanos and applied automatically.';
const pendingAnnouncements = new Map();`,
`const AUTO_APPLY_MESSAGE = 'Spotify track URL found by Stephanos and applied automatically.';
const AUTO_RESOLVE_MAX_TRACKS = 20;
const AUTO_RESOLVE_TIMEOUT_MS = 8000;
const AUTO_RESOLVE_CONCURRENCY = 2;
const SPOTIFY_ARTWORK_HOST_SUFFIXES = Object.freeze(['scdn.co', 'spotifycdn.com']);
const pendingAnnouncements = new Map();
const attemptedAutoResolveKeys = new Set();`, 'automatic resolver constants');
auto = replaceOnce(auto,
`let announcementQueued = false;
let hydrationQueued = false;
let observerInstalled = false;`,
`let announcementQueued = false;
let hydrationQueued = false;
let automaticResolutionQueued = false;
let automaticResolutionRunning = false;
let observerInstalled = false;`, 'automatic resolver state');
auto = replaceOnce(auto,
`function normalizedIdentity(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
`,
`function normalizedIdentity(value = '') {
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
      host === suffix || host.endsWith(\`.\${suffix}\`)
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
  if (artistCoverage <= 0) return 0;
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
`, 'automatic resolver identity helpers');
auto = replaceRegexOnce(auto,
/function validatedDetail\(detail = \{\}\) \{[\s\S]*?\n\}\n\nfunction findStoredTrack/,
`function validatedDetail(detail = {}) {
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

function findStoredTrack`, 'validated catalogue detail');
auto = replaceOnce(auto,
`function updateTrackCard(track, spotify) {`,
`function updateTrackArtwork(card, track) {
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
  image.src = artworkUrl;
  image.alt = 'Artwork for ' + String(track.title || track.name || 'this track');
  title.textContent = String(track.title || track.name || 'Unknown track') + ' · ' + String(track.artist || 'Unknown artist');
  return true;
}

function updateTrackCard(track, spotify) {`, 'artwork card renderer');
auto = replaceOnce(auto,
`  if (!input || !card) return false;
  if (input.value !== spotify.openUrl) input.value = spotify.openUrl;`,
`  if (!input || !card) return false;
  if (input.value !== spotify.openUrl) input.value = spotify.openUrl;
  updateTrackArtwork(card, track);`, 'apply artwork to card');
auto = replaceOnce(auto,
`export function hydratePersistedCatalogLinks() {`,
`function catalogResultDetailForTrack(track, result) {
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
  if (typeof fetchImpl !== 'function') return null;
  const query = (String(track?.artist || '').trim() + ' ' + String(track?.title || track?.name || '').trim()).trim();
  if (!query) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs || AUTO_RESOLVE_TIMEOUT_MS)));
  try {
    const response = await fetchImpl('/api/music/catalog/search?q=' + encodeURIComponent(query) + '&limit=10', {
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok || !Array.isArray(payload.results)) return null;
    const ranked = payload.results
      .map((result) => ({ result, score: catalogMatchScore(track, result) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);
    return ranked[0]?.result || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveUnlinkedDeckTracks({
  storage = browserStorage(),
  fetchImpl = globalThis.fetch,
  maxTracks = AUTO_RESOLVE_MAX_TRACKS,
  timeoutMs = AUTO_RESOLVE_TIMEOUT_MS,
} = {}) {
  if (!storage) return { ok: false, reason: 'music-state-storage-unavailable', attemptedCount: 0, resolvedCount: 0 };
  const snapshot = readStoredState(storage);
  if (!snapshot || !Array.isArray(snapshot.listeningDeck)) {
    return { ok: false, reason: 'music-state-invalid', attemptedCount: 0, resolvedCount: 0 };
  }
  const pending = snapshot.listeningDeck
    .filter((track) => needsAutomaticResolution(track))
    .filter((track) => !attemptedAutoResolveKeys.has(automaticResolutionKey(track)))
    .slice(0, Math.max(0, Math.min(Number(maxTracks) || AUTO_RESOLVE_MAX_TRACKS, AUTO_RESOLVE_MAX_TRACKS)));
  if (!pending.length) {
    return { ok: true, reason: 'nothing-to-resolve', attemptedCount: 0, resolvedCount: 0, unresolvedCount: 0 };
  }

  let cursor = 0;
  const resolved = [];
  const worker = async () => {
    while (cursor < pending.length) {
      const track = pending[cursor];
      cursor += 1;
      attemptedAutoResolveKeys.add(automaticResolutionKey(track));
      const result = await requestAutomaticCatalogResolution(track, { fetchImpl, timeoutMs });
      if (!result) continue;
      const detail = catalogResultDetailForTrack(track, result);
      if (!detail) continue;
      const merged = mergePersistedCatalogState(snapshot, detail);
      if (merged.ok && merged.changed) resolved.push({ track: merged.track, spotify: merged.detail.spotify });
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
      };
    }
    for (const item of resolved) {
      updateTrackCard(item.track, item.spotify);
      announceAppliedTrack(item.track);
    }
  }
  return {
    ok: true,
    reason: resolved.length ? 'resolved' : 'no-verified-match',
    attemptedCount: pending.length,
    resolvedCount: resolved.length,
    unresolvedCount: pending.length - resolved.length,
  };
}

export function hydratePersistedCatalogLinks() {`, 'automatic catalogue resolver');
auto = replaceOnce(auto,
`function queueHydration() {
  if (hydrationQueued) return;
  hydrationQueued = true;
  scheduleMicrotask(() => {
    hydrationQueued = false;
    hydratePersistedCatalogLinks();
  });
}
`,
`function queueHydration() {
  if (hydrationQueued) return;
  hydrationQueued = true;
  scheduleMicrotask(() => {
    hydrationQueued = false;
    hydratePersistedCatalogLinks();
  });
}

function queueAutomaticResolution() {
  if (automaticResolutionQueued || automaticResolutionRunning) return;
  automaticResolutionQueued = true;
  setTimeout(async () => {
    automaticResolutionQueued = false;
    automaticResolutionRunning = true;
    try {
      await resolveUnlinkedDeckTracks();
    } finally {
      automaticResolutionRunning = false;
    }
  }, 0);
}
`, 'automatic resolver queue');
auto = replaceOnce(auto,
`  const observer = new MutationObserver(() => queueHydration());
  observer.observe(deck, { childList: true, subtree: true });
  queueHydration();`,
`  const observer = new MutationObserver(() => {
    queueHydration();
    queueAutomaticResolution();
  });
  observer.observe(deck, { childList: true, subtree: true });
  queueHydration();
  queueAutomaticResolution();`, 'observer automatic resolver hook');
write(autoPath, auto);

const intelligenceTestPath = 'tests/music-intelligence-centre-vnext.test.mjs';
let intelligenceTest = read(intelligenceTestPath);
intelligenceTest = replaceOnce(intelligenceTest,
`import { mergePersistedCatalogState } from '../apps/music-tile/engine/nativeCatalogAutoApply.js';`,
`import { mergePersistedCatalogState, resolveUnlinkedDeckTracks } from '../apps/music-tile/engine/nativeCatalogAutoApply.js';`, 'unit test auto resolver import');
intelligenceTest = replaceOnce(intelligenceTest,
`const AUTO_SPOTIFY_URI = \`spotify:track:\${AUTO_SPOTIFY_ID}\`;
const OTHER_SPOTIFY_URI`,
`const AUTO_SPOTIFY_URI = \`spotify:track:\${AUTO_SPOTIFY_ID}\`;
const AUTO_ARTWORK_URL = 'https://i.scdn.co/image/ab67616d00001e02f7f1f53af3505f5638d7d8b1';
const OTHER_SPOTIFY_URI`, 'unit test artwork constant');
intelligenceTest += `

test('automatic deck resolution persists verified Spotify URL and artwork without manual search', async () => {
  const snapshot = {
    listeningDeck: [existingCatalogTrack()],
    ratings: { 'journey-enjoy-the-silence': 2 },
    tags: { 'journey-enjoy-the-silence': ['ghost in the track'] },
    trackFeedback: { 'journey-enjoy-the-silence': 'Keep this.' },
  };
  const data = new Map([[STORAGE_KEY_FOR_TEST, JSON.stringify(snapshot)]]);
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
  let requestedUrl = '';
  const result = await resolveUnlinkedDeckTracks({
    storage,
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          ok: true,
          results: [verifiedCatalogResult({ artworkUrl: AUTO_ARTWORK_URL })],
        }),
      };
    },
  });
  const stored = JSON.parse(storage.getItem(STORAGE_KEY_FOR_TEST));
  assert.equal(result.ok, true);
  assert.equal(result.attemptedCount, 1);
  assert.equal(result.resolvedCount, 1);
  assert.match(requestedUrl, /Depeche%20Mode%20Enjoy%20the%20Silence/);
  assert.equal(stored.listeningDeck[0].spotifyUrl, AUTO_SPOTIFY_URL);
  assert.equal(stored.listeningDeck[0].artworkUrl, AUTO_ARTWORK_URL);
  assert.equal(stored.listeningDeck[0].artworkSource, 'spotify-catalogue');
  assert.equal(stored.ratings['journey-enjoy-the-silence'], 2);
  assert.deepEqual(stored.tags['journey-enjoy-the-silence'], ['ghost in the track']);
  assert.equal(stored.trackFeedback['journey-enjoy-the-silence'], 'Keep this.');
});

test('automatic deck resolution rejects the wrong track identity and unsafe artwork', async () => {
  const snapshot = { listeningDeck: [existingCatalogTrack({ id: 'journey-wrong-identity', title: 'Wrong Expected Track', artist: 'Wrong Expected Artist' })], ratings: {}, tags: {}, trackFeedback: {} };
  const data = new Map([[STORAGE_KEY_FOR_TEST, JSON.stringify(snapshot)]]);
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
  const result = await resolveUnlinkedDeckTracks({
    storage,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        results: [verifiedCatalogResult({
          title: 'Personal Jesus',
          artworkUrl: 'https://attacker.invalid/cover.jpg',
        })],
      }),
    }),
  });
  const stored = JSON.parse(storage.getItem(STORAGE_KEY_FOR_TEST));
  assert.equal(result.resolvedCount, 0);
  assert.equal(stored.listeningDeck[0].spotifyUrl, undefined);
  assert.equal(stored.listeningDeck[0].artworkUrl, undefined);
});
`;
intelligenceTest = intelligenceTest.replace(
  `const OTHER_SPOTIFY_URI = 'spotify:track:0VjIjW4GlUZAMYd2vXMi3b';`,
  `const OTHER_SPOTIFY_URI = 'spotify:track:0VjIjW4GlUZAMYd2vXMi3b';\nconst STORAGE_KEY_FOR_TEST = 'stephanos.musicTile.dashboardState.v1';`,
);
write(intelligenceTestPath, intelligenceTest);

const providerTestPath = 'tests/music-provider-neutral-catalog-search.test.mjs';
let providerTest = read(providerTestPath);
providerTest += `

test('Spotify catalogue normalization carries only trusted CDN artwork', () => {
  const trusted = normalizeSpotifyTrack({
    id: '4uLU6hMCjMI75M1A2tKUQC',
    name: 'Enjoy the Silence',
    artists: [{ name: 'Depeche Mode' }],
    album: { images: [{ url: 'https://i.scdn.co/image/ab67616d00001e02f7f1f53af3505f5638d7d8b1' }] },
  });
  assert.equal(trusted.artworkUrl, 'https://i.scdn.co/image/ab67616d00001e02f7f1f53af3505f5638d7d8b1');
  const untrusted = normalizeSpotifyTrack({
    id: '4uLU6hMCjMI75M1A2tKUQC',
    name: 'Enjoy the Silence',
    artists: [{ name: 'Depeche Mode' }],
    album: { images: [{ url: 'https://attacker.invalid/cover.jpg' }] },
  });
  assert.equal(untrusted.artworkUrl, '');
});
`;
write(providerTestPath, providerTest);

const browserTestPath = 'tests/music-tile-rating-playback-browser.test.mjs';
let browserTest = read(browserTestPath);
browserTest = replaceOnce(browserTest,
`const AUTO_SPOTIFY_URI = \`spotify:track:\${AUTO_SPOTIFY_ID}\`;
const MIME_TYPES`,
`const AUTO_SPOTIFY_URI = \`spotify:track:\${AUTO_SPOTIFY_ID}\`;
const AUTO_ARTWORK_URL = 'https://i.scdn.co/image/ab67616d00001e02f7f1f53af3505f5638d7d8b1';
const MIME_TYPES`, 'browser artwork constant');
browserTest += `

test('iPad-width existing card receives Spotify URL and artwork without manual search', async () => {
  const server = await startRepositoryServer();
  let browser;
  try {
    browser = await chromium.launch(
      process.env.STEPHANOS_BROWSER_CHANNEL
        ? { channel: process.env.STEPHANOS_BROWSER_CHANNEL, headless: true }
        : { headless: true },
    );
    const page = await browser.newPage({ viewport: { width: 820, height: 1180 } });
    let catalogRequests = 0;
    await page.route('https://i.scdn.co/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" />' });
    });
    await page.route(/\\/api\\/music\\/catalog\\/search\\?/, async (route) => {
      catalogRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          ok: true,
          provider: 'spotify',
          providerLabel: 'Spotify',
          results: [{
            universalId: \`spotify:track:\${AUTO_SPOTIFY_ID}\`,
            provider: 'spotify',
            providerItemId: AUTO_SPOTIFY_ID,
            providerLabel: 'Spotify',
            providerUrl: AUTO_SPOTIFY_URL,
            title: 'Enjoy the Silence',
            artist: 'Depeche Mode',
            album: 'Violator',
            confidence: 'high',
            verificationStatus: 'metadata_verified',
            playbackAvailability: 'playback_unverified',
            spotifyUrl: AUTO_SPOTIFY_URL,
            spotifyUri: AUTO_SPOTIFY_URI,
            artworkUrl: AUTO_ARTWORK_URL,
          }],
        }),
      });
    });
    await page.addInitScript(({ key, trackId }) => {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, JSON.stringify({
        candidates: [],
        listeningDeck: [{
          id: trackId,
          title: 'Enjoy the Silence',
          artist: 'Depeche Mode',
          lane: 'doorway-track',
          sourceKind: 'journey-candidate',
          candidateVerificationStatus: 'search-only',
          traits: ['dark club pressure'],
        }],
        ratings: { [trackId]: 2 },
        tags: { [trackId]: ['ghost in the track'] },
        trackFeedback: { [trackId]: 'Keep this.' },
        linkMessages: {},
      }));
    }, { key: STORAGE_KEY, trackId: AUTO_TRACK_ID });

    await page.goto(\`\${server.origin}/apps/music-tile/index.html\`);
    await page.waitForFunction(({ trackId, spotifyUrl, artworkUrl }) => {
      const input = document.querySelector(\`[data-link-input="spotify-\${trackId}"]\`);
      const image = document.querySelector('[data-catalog-artwork] img');
      return input?.value === spotifyUrl && image?.src === artworkUrl;
    }, { trackId: AUTO_TRACK_ID, spotifyUrl: AUTO_SPOTIFY_URL, artworkUrl: AUTO_ARTWORK_URL });

    const proof = await page.evaluate(({ key, trackId, spotifyUrl, artworkUrl }) => {
      const stored = JSON.parse(localStorage.getItem(key));
      const track = stored.listeningDeck.find((item) => item.id === trackId);
      const card = document.querySelector('.player-deck-card');
      const image = card.querySelector('[data-catalog-artwork] img');
      return {
        spotifyInput: document.querySelector(\`[data-link-input="spotify-\${trackId}"]\`)?.value,
        openLinkPresent: Array.from(card.querySelectorAll('a')).some((link) => link.href === spotifyUrl),
        artworkSrc: image?.src,
        artworkAlt: image?.alt,
        iframeCount: card.querySelectorAll('iframe').length,
        storedSpotifyUrl: track?.spotifyUrl,
        storedArtworkUrl: track?.artworkUrl,
        storedArtworkSource: track?.artworkSource,
        storedRating: stored.ratings?.[trackId],
        storedTags: stored.tags?.[trackId],
        storedFeedback: stored.trackFeedback?.[trackId],
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        expectedArtworkUrl: artworkUrl,
      };
    }, { key: STORAGE_KEY, trackId: AUTO_TRACK_ID, spotifyUrl: AUTO_SPOTIFY_URL, artworkUrl: AUTO_ARTWORK_URL });
    assert.equal(catalogRequests, 1);
    assert.deepEqual(proof, {
      spotifyInput: AUTO_SPOTIFY_URL,
      openLinkPresent: true,
      artworkSrc: AUTO_ARTWORK_URL,
      artworkAlt: 'Artwork for Enjoy the Silence',
      iframeCount: 0,
      storedSpotifyUrl: AUTO_SPOTIFY_URL,
      storedArtworkUrl: AUTO_ARTWORK_URL,
      storedArtworkSource: 'spotify-catalogue',
      storedRating: 2,
      storedTags: ['ghost in the track'],
      storedFeedback: 'Keep this.',
      noHorizontalOverflow: true,
      expectedArtworkUrl: AUTO_ARTWORK_URL,
    });

    await page.reload();
    await page.waitForFunction(({ trackId, spotifyUrl, artworkUrl }) => (
      document.querySelector(\`[data-link-input="spotify-\${trackId}"]\`)?.value === spotifyUrl
      && document.querySelector('[data-catalog-artwork] img')?.src === artworkUrl
    ), { trackId: AUTO_TRACK_ID, spotifyUrl: AUTO_SPOTIFY_URL, artworkUrl: AUTO_ARTWORK_URL });
    assert.equal(catalogRequests, 1);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});
`;
write(browserTestPath, browserTest);

for (const [path, text] of [
  [serverPath, server],
  [searchPath, search],
  [autoPath, auto],
  [intelligenceTestPath, intelligenceTest],
  [providerTestPath, providerTest],
  [browserTestPath, browserTest],
]) {
  if (text.includes('<<<<<<<') || text.includes('>>>>>>>')) throw new Error(`Conflict marker in ${path}`);
}

console.log('MUSIC_AUTO_URL_ARTWORK_PATCH_APPLIED=YES');
