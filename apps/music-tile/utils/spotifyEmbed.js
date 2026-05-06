const SPOTIFY_OPEN = 'https://open.spotify.com';

function normalizeId(pathname = '') {
  const parts = String(pathname).split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [type, id] = parts;
  if (!['track', 'album', 'playlist', 'artist'].includes(type)) return null;
  return { type, id: id.split('?')[0] };
}

export function parseSpotifyReference(input = '') {
  const raw = String(input || '').trim();
  if (!raw) return null;

  if (raw.startsWith('spotify:')) {
    const [, type, id] = raw.split(':');
    if (!type || !id) return null;
    if (!['track', 'album', 'playlist', 'artist'].includes(type)) return null;
    return { type, id, uri: `spotify:${type}:${id}`, openUrl: `${SPOTIFY_OPEN}/${type}/${id}` };
  }

  try {
    const url = new URL(raw);
    if (!/spotify\.com$/i.test(url.hostname)) return null;
    const normalized = normalizeId(url.pathname);
    if (!normalized) return null;
    return {
      ...normalized,
      uri: `spotify:${normalized.type}:${normalized.id}`,
      openUrl: `${SPOTIFY_OPEN}/${normalized.type}/${normalized.id}`,
    };
  } catch {
    return null;
  }
}

export function toSpotifyEmbedUrl(input = '') {
  const parsed = parseSpotifyReference(input);
  if (!parsed) return '';
  return `${SPOTIFY_OPEN}/embed/${parsed.type}/${parsed.id}`;
}
