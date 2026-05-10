import express from 'express';
import { getSpotifyConfigDiagnostics, searchSpotifyCatalog } from '../services/spotifyClient.js';

const router = express.Router();

function normalize(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function scoreSpotifyMatch({ query = '', artist = '', title = '' }, track = {}) {
  const requestedTitle = normalize(title || query);
  const requestedArtist = normalize(artist || query);
  const resultTitle = normalize(track?.name || '');
  const resultArtists = (track?.artists || []).map((a) => normalize(a?.name || '')).filter(Boolean);
  const exactTitle = requestedTitle && requestedTitle === resultTitle;
  const artistExact = requestedArtist && resultArtists.includes(requestedArtist);
  const titlePartial = requestedTitle && resultTitle.includes(requestedTitle);
  const artistPartial = requestedArtist && resultArtists.some((a) => a.includes(requestedArtist) || requestedArtist.includes(a));
  if (exactTitle && artistExact) return { confidence: 'high', matchReason: 'Exact title and artist match' };
  if ((exactTitle || titlePartial) && artistExact) return { confidence: 'high', matchReason: 'Title match and artist match' };
  if (titlePartial && artistPartial) return { confidence: 'medium', matchReason: 'Partial title and artist match' };
  return { confidence: 'low', matchReason: 'Weak title/artist match' };
}

router.get('/spotify/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  const type = String(req.query.type || 'track').trim() || 'track';
  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 20);
  if (!query) {
    res.status(400).json({ configured: getSpotifyConfigDiagnostics().configured, error: 'Missing required query parameter: q' });
    return;
  }
  const diagnostics = getSpotifyConfigDiagnostics();
  if (!diagnostics.configured) {
    res.status(200).json({ configured: false, error: 'Spotify catalog search not configured' });
    return;
  }
  try {
    const payload = await searchSpotifyCatalog({ query, type, limit });
    const tracks = Array.isArray(payload?.tracks?.items) ? payload.tracks.items : [];
    res.json({
      configured: true,
      query,
      results: tracks.map((item) => {
        const { confidence, matchReason } = scoreSpotifyMatch({ query }, item);
        return {
          title: item.name || '',
          artist: (item.artists || []).map((a) => a.name).filter(Boolean).join(', '),
          album: item.album?.name || '',
          url: item.external_urls?.spotify || '',
          uri: item.uri || '',
          id: item.id || '',
          type: 'track',
          durationMs: Number(item.duration_ms || 0),
          popularity: Number(item.popularity || 0),
          confidence,
          matchReason,
        };
      }),
      error: null,
      diagnostics: getSpotifyConfigDiagnostics(),
    });
  } catch (error) {
    const denied = error?.code === 'spotify_denied';
    res.status(200).json({ configured: true, results: [], error: denied ? 'Spotify catalog search denied or restricted' : (error?.message || 'Spotify catalog search failed'), diagnostics: getSpotifyConfigDiagnostics() });
  }
});

router.get('/spotify/resolve-track', async (req, res) => {
  const artist = String(req.query.artist || '').trim();
  const title = String(req.query.title || '').trim();
  const query = `${artist} ${title}`.trim();
  if (!query) {
    res.status(400).json({ configured: getSpotifyConfigDiagnostics().configured, error: 'Missing required artist/title or query' });
    return;
  }
  const diagnostics = getSpotifyConfigDiagnostics();
  if (!diagnostics.configured) {
    res.status(200).json({ configured: false, error: 'Spotify catalog search not configured' });
    return;
  }
  try {
    const payload = await searchSpotifyCatalog({ query, type: 'track', limit: Math.min(Math.max(Number(req.query.limit || 10), 1), 20) });
    const tracks = Array.isArray(payload?.tracks?.items) ? payload.tracks.items : [];
    const results = tracks.map((item) => {
      const { confidence, matchReason } = scoreSpotifyMatch({ query, artist, title }, item);
      return { title: item.name || '', artist: (item.artists || []).map((a) => a.name).filter(Boolean).join(', '), album: item.album?.name || '', url: item.external_urls?.spotify || '', uri: item.uri || '', id: item.id || '', type: 'track', durationMs: Number(item.duration_ms || 0), popularity: Number(item.popularity || 0), confidence, matchReason };
    });
    res.json({ configured: true, query, results, error: null, diagnostics: getSpotifyConfigDiagnostics() });
  } catch (error) {
    const denied = error?.code === 'spotify_denied';
    res.status(200).json({ configured: true, results: [], error: denied ? 'Spotify catalog search denied or restricted' : (error?.message || 'Spotify catalog search failed'), diagnostics: getSpotifyConfigDiagnostics() });
  }
});

export default router;
