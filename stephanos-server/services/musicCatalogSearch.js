import { getSpotifyConfigDiagnostics, searchSpotifyCatalog } from './spotifyClient.js';

const MUSICBRAINZ_SEARCH_ENDPOINT = 'https://musicbrainz.org/ws/2/recording';
const MUSICBRAINZ_USER_AGENT = 'StephanosOS/0.1 (https://github.com/Cheekyfellastef/stephan-os)';
const DEFAULT_TIMEOUT_MS = 8000;
export const MAX_CATALOG_QUERY_LENGTH = 160;
export const MAX_CATALOG_RESULT_LIMIT = 10;

function boundedLimit(value) {
  return Math.min(Math.max(Number(value) || 5, 1), MAX_CATALOG_RESULT_LIMIT);
}

export function normalizeCatalogQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CATALOG_QUERY_LENGTH);
}

function artistCredit(recording = {}) {
  return (recording['artist-credit'] || [])
    .map((credit) => String(credit?.name || credit?.artist?.name || '').trim())
    .filter(Boolean)
    .join(', ');
}

function spotifySearchUrl({ artist = '', title = '' } = {}) {
  const query = `${artist} ${title}`.trim();
  return `https://open.spotify.com/search/${encodeURIComponent(query)}`;
}

function normalizeIsrc(value) {
  const isrc = String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc) ? isrc : '';
}

export function normalizeMusicBrainzRecording(recording = {}) {
  const id = String(recording.id || '').trim();
  const title = String(recording.title || '').trim();
  const artist = artistCredit(recording) || 'Unknown Artist';
  const release = Array.isArray(recording.releases) ? recording.releases[0] : null;
  const score = Math.max(0, Math.min(100, Number(recording.score || 0)));
  const isrc = normalizeIsrc(Array.isArray(recording.isrcs) ? recording.isrcs[0] : '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !title) return null;
  return {
    universalId: isrc ? `isrc:${isrc}` : `musicbrainz:recording:${id}`,
    provider: 'musicbrainz',
    providerItemId: id,
    providerLabel: 'MusicBrainz',
    providerUrl: `https://musicbrainz.org/recording/${id}`,
    title,
    artist,
    album: String(release?.title || ''),
    releaseDate: String(release?.date || ''),
    isrc,
    durationMs: Math.max(0, Number(recording.length || 0)),
    confidence: score >= 90 ? 'high' : score >= 70 ? 'medium' : 'low',
    confidenceScore: score,
    verificationStatus: 'metadata_verified',
    playbackAvailability: 'search_only',
    spotifyUrl: '',
    spotifyUri: '',
    spotifySearchUrl: spotifySearchUrl({ artist, title }),
  };
}

export function normalizeSpotifyTrack(track = {}) {
  const id = String(track.id || '').trim();
  const title = String(track.name || '').trim();
  const artist = (track.artists || []).map((item) => item?.name).filter(Boolean).join(', ') || 'Unknown Artist';
  const isrc = normalizeIsrc(track.external_ids?.isrc);
  if (!/^[A-Za-z0-9]{22}$/.test(id) || !title) return null;
  const verifiedUrl = `https://open.spotify.com/track/${id}`;
  return {
    universalId: isrc ? `isrc:${isrc}` : `spotify:track:${id}`,
    provider: 'spotify',
    providerItemId: id,
    providerLabel: 'Spotify',
    providerUrl: verifiedUrl,
    title,
    artist,
    album: String(track.album?.name || ''),
    releaseDate: String(track.album?.release_date || ''),
    isrc,
    durationMs: Math.max(0, Number(track.duration_ms || 0)),
    confidence: 'high',
    confidenceScore: 100,
    verificationStatus: 'spotify_verified',
    playbackAvailability: 'spotify_track',
    spotifyUrl: verifiedUrl,
    spotifyUri: `spotify:track:${id}`,
    spotifySearchUrl: spotifySearchUrl({ artist, title }),
  };
}

export function createMusicBrainzSearchClient({
  fetchImpl = globalThis.fetch,
  minimumIntervalMs = 1000,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => Date.now(),
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
} = {}) {
  let nextAllowedAt = 0;
  let queue = Promise.resolve();

  return function searchMusicBrainzCatalog({ query, limit = 5 } = {}) {
    const normalizedQuery = normalizeCatalogQuery(query);
    const resultLimit = boundedLimit(limit);
    const request = queue.then(async () => {
      const delayMs = Math.max(0, nextAllowedAt - now());
      if (delayMs) await sleep(delayMs);
      nextAllowedAt = now() + minimumIntervalMs;

      const url = new URL(MUSICBRAINZ_SEARCH_ENDPOINT);
      url.searchParams.set('query', normalizedQuery);
      url.searchParams.set('limit', String(resultLimit));
      url.searchParams.set('fmt', 'json');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          headers: { Accept: 'application/json', 'User-Agent': MUSICBRAINZ_USER_AGENT },
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = new Error(`MusicBrainz catalogue search failed (${response.status})`);
          error.code = response.status === 503 ? 'musicbrainz_rate_limited' : 'musicbrainz_search_failed';
          throw error;
        }
        const payload = await response.json();
        return (Array.isArray(payload?.recordings) ? payload.recordings : [])
          .map(normalizeMusicBrainzRecording)
          .filter(Boolean)
          .slice(0, resultLimit);
      } finally {
        clearTimeout(timer);
      }
    });
    queue = request.catch(() => undefined);
    return request;
  };
}

const searchMusicBrainzCatalog = createMusicBrainzSearchClient();

export async function searchProviderNeutralCatalog({
  query,
  limit = 5,
  env = process.env,
  spotifyDiagnostics = getSpotifyConfigDiagnostics,
  spotifySearch = searchSpotifyCatalog,
  musicBrainzSearch = searchMusicBrainzCatalog,
} = {}) {
  const normalizedQuery = normalizeCatalogQuery(query);
  const resultLimit = boundedLimit(limit);
  if (!normalizedQuery) {
    const error = new Error('A music search query is required');
    error.code = 'catalog_query_required';
    throw error;
  }

  const attempts = [];
  const spotify = spotifyDiagnostics(env);
  if (spotify.configured) {
    try {
      const payload = await spotifySearch({ query: normalizedQuery, type: 'track', limit: resultLimit, env });
      const results = (Array.isArray(payload?.tracks?.items) ? payload.tracks.items : [])
        .map(normalizeSpotifyTrack)
        .filter(Boolean);
      attempts.push({ provider: 'spotify', status: results.length ? 'ready' : 'empty' });
      if (results.length) {
        return {
          ok: true,
          query: normalizedQuery,
          provider: 'spotify',
          providerLabel: 'Spotify',
          authMode: 'application',
          fallbackUsed: false,
          personalAccountAccess: false,
          results,
          attempts,
        };
      }
    } catch (error) {
      attempts.push({ provider: 'spotify', status: 'failed', reason: String(error?.code || 'spotify_failed') });
    }
  } else {
    attempts.push({ provider: 'spotify', status: 'not_configured' });
  }

  try {
    const results = await musicBrainzSearch({ query: normalizedQuery, limit: resultLimit });
    attempts.push({ provider: 'musicbrainz', status: results.length ? 'ready' : 'empty' });
    return {
      ok: true,
      query: normalizedQuery,
      provider: 'musicbrainz',
      providerLabel: 'MusicBrainz',
      authMode: 'none',
      fallbackUsed: true,
      personalAccountAccess: false,
      results,
      attempts,
    };
  } catch (error) {
    attempts.push({ provider: 'musicbrainz', status: 'failed', reason: String(error?.code || 'musicbrainz_failed') });
    return {
      ok: false,
      query: normalizedQuery,
      provider: 'none',
      providerLabel: 'Unavailable',
      authMode: 'none',
      fallbackUsed: true,
      personalAccountAccess: false,
      results: [],
      attempts,
      error: 'Music catalogue search is temporarily unavailable',
    };
  }
}
