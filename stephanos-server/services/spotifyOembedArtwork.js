// Public Spotify oEmbed is scoped to an exact Spotify track ID. No credentials or
// arbitrary caller-supplied outbound URLs are accepted.
const TRACK_ID = /^[A-Za-z0-9]{22}$/;
const TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 7000;

export function trustedSpotifyOembedArtwork(value = '') {
  try {
    const parsed = new URL(String(value || '').trim());
    const host = parsed.hostname.toLowerCase();
    const trusted = ['scdn.co', 'spotifycdn.com']
      .some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
    return parsed.protocol === 'https:' && trusted ? parsed.toString() : '';
  } catch {
    return '';
  }
}

export function createSpotifyOembedArtworkResolver({
  fetchImpl = globalThis.fetch,
  timeoutMs = TIMEOUT_MS,
  ttlMs = TTL_MS,
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  return async function resolveSpotifyOembedArtwork(trackId = '') {
    const id = String(trackId || '').trim();
    if (!TRACK_ID.test(id)) return { ok: false, reason: 'spotify-track-id-invalid' };
    const cached = cache.get(id);
    if (cached && cached.expiresAt > now()) return cached.data;
    if (typeof fetchImpl !== 'function') return { ok: false, reason: 'spotify-oembed-unavailable' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || TIMEOUT_MS));
    try {
      const request = new URL('https://open.spotify.com/oembed');
      request.searchParams.set('url', `https://open.spotify.com/track/${id}`);
      const response = await fetchImpl(request, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response?.ok) return { ok: false, reason: 'spotify-oembed-http-error' };
      const payload = await response.json();
      const artworkUrl = trustedSpotifyOembedArtwork(payload?.thumbnail_url);
      if (payload?.provider_name !== 'Spotify' || !artworkUrl) {
        return { ok: false, reason: 'spotify-oembed-artwork-unverified' };
      }
      const data = {
        ok: true,
        trackId: id,
        artworkUrl,
        source: 'spotify-oembed',
      };
      cache.set(id, { expiresAt: now() + Math.max(0, Number(ttlMs) || TTL_MS), data });
      return data;
    } catch (error) {
      return {
        ok: false,
        reason: error?.name === 'AbortError' ? 'spotify-oembed-timeout' : 'spotify-oembed-failed',
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

export const resolveSpotifyOembedArtwork = createSpotifyOembedArtworkResolver();
