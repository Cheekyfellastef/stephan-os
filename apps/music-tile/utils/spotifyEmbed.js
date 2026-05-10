const SPOTIFY_OPEN = 'https://open.spotify.com';
const TRACK_TYPE = 'track';
const ALLOWED_TYPES = new Set([TRACK_TYPE, 'album', 'playlist', 'artist']);

function isValidSpotifyId(id = '') {
  return /^[A-Za-z0-9]+$/.test(String(id || '').trim());
}

function buildResult(type, id) {
  return {
    valid: true,
    reason: 'ok',
    type,
    id,
    uri: `spotify:${type}:${id}`,
    embedUrl: `${SPOTIFY_OPEN}/embed/${type}/${id}`,
    openUrl: `${SPOTIFY_OPEN}/${type}/${id}`,
  };
}

export function resolveSpotifyReference(input = '') {
  const raw = String(input || '').trim();
  if (!raw) return { valid: false, reason: 'missing', type: null, id: null, uri: null, embedUrl: null, openUrl: null };

  if (raw.startsWith('spotify:')) {
    const [, type, id] = raw.split(':');
    if (!ALLOWED_TYPES.has(type)) return { valid: false, reason: 'unsupported-type', type: null, id: null, uri: null, embedUrl: null, openUrl: null };
    if (!isValidSpotifyId(id)) return { valid: false, reason: 'invalid-id', type: null, id: null, uri: null, embedUrl: null, openUrl: null };
    return buildResult(type, id);
  }

  try {
    const url = new URL(raw);
    if (!/spotify\.com$/i.test(url.hostname)) return { valid: false, reason: 'non-spotify-url', type: null, id: null, uri: null, embedUrl: null, openUrl: null };
    const parts = String(url.pathname || '').split('/').filter(Boolean);
    if (parts[0] === 'embed') {
      const [, embedType, embedId = ''] = parts;
      if (embedType !== TRACK_TYPE) return { valid: false, reason: 'unsupported-type', type: null, id: null, uri: null, embedUrl: null, openUrl: null };
      if (!isValidSpotifyId(embedId)) return { valid: false, reason: 'invalid-id', type: null, id: null, uri: null, embedUrl: null, openUrl: null };
      return buildResult(embedType, embedId);
    }
    const [type, id = ''] = parts;
    if (type === 'search') return { valid: false, reason: 'search-url', type: null, id: null, uri: null, embedUrl: null, openUrl: null };
    if (!ALLOWED_TYPES.has(type)) return { valid: false, reason: 'unsupported-type', type: null, id: null, uri: null, embedUrl: null, openUrl: null };
    if (!isValidSpotifyId(id)) return { valid: false, reason: 'invalid-id', type: null, id: null, uri: null, embedUrl: null, openUrl: null };
    return buildResult(type, id);
  } catch {
    return { valid: false, reason: 'malformed-url', type: null, id: null, uri: null, embedUrl: null, openUrl: null };
  }
}

export function parseSpotifyReference(input = '') {
  const resolved = resolveSpotifyReference(input);
  if (!resolved.valid) return null;
  return { type: resolved.type, id: resolved.id, uri: resolved.uri, openUrl: resolved.openUrl, embedUrl: resolved.embedUrl };
}

export function toSpotifyEmbedUrl(input = '') {
  return resolveSpotifyReference(input).embedUrl;
}

function trackSearchQuery(track = {}) {
  return `${track.artist || ''} ${track.title || track.name || ''}`.trim();
}

export function buildSpotifySearchUrl(track = {}) {
  return `${SPOTIFY_OPEN}/search/${encodeURIComponent(trackSearchQuery(track))}`;
}

export function buildYouTubeSearchUrl(track = {}) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(trackSearchQuery(track))}`;
}

function spotifyWarningForReason(reason = '') {
  const map = {
    missing: 'Needs verified Spotify link.',
    'search-url': 'Spotify search URLs are not playable track links.',
    'unsupported-type': 'Spotify link is not a track URL/URI.',
    'invalid-id': 'Spotify link appears invalid.',
    'non-spotify-url': 'URL is not a Spotify link.',
    'malformed-url': 'Malformed Spotify URL.',
  };
  return map[reason] || 'Needs verified Spotify link.';
}

export function getSpotifyLinkState(track = {}) {
  const rawRef = track.spotifyUrl || track.spotifyUri || '';
  const resolved = resolveSpotifyReference(rawRef);
  const searchUrl = buildSpotifySearchUrl(track);
  if (resolved.valid && resolved.type === TRACK_TYPE) {
    return {
      state: 'verified',
      canOpenSpotify: true,
      canEmbedSpotify: true,
      openUrl: resolved.openUrl,
      embedUrl: resolved.embedUrl,
      searchUrl,
      label: 'Verified Spotify link',
      warning: '',
    };
  }
  let state = 'needs-link';
  if (!rawRef) state = 'needs-link';
  else if (resolved.reason === 'search-url') state = 'search-only';
  else if (track.candidateVerificationStatus === 'not_found') state = 'not-found';
  else if (track.candidateVerificationStatus === 'likely_hallucinated') state = 'hallucinated';
  else state = 'invalid';
  return {
    state,
    canOpenSpotify: false,
    canEmbedSpotify: false,
    openUrl: '',
    embedUrl: '',
    searchUrl,
    label: 'Needs verified Spotify link',
    warning: spotifyWarningForReason(resolved.reason),
  };
}
