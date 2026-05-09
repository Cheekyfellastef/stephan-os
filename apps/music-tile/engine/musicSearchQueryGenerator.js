import { resolveArtistIntelligence } from './musicArtistIntelligence.js';

export function generateMusicSearchQueries({ artist = '', tasteDNA = {}, aiHint = null } = {}) {
  const queries = [];
  const resolved = resolveArtistIntelligence(artist);
  if (resolved.artist?.defaultSearchQueries?.length) {
    resolved.artist.defaultSearchQueries.forEach((q) => {
      queries.push({ label: `Search ${resolved.artist.canonicalName}`, query: q, target: q.toLowerCase().includes('live') ? 'youtube' : 'spotify', reason: 'artist intelligence seed', sourceTraits: resolved.artist.lanes || [] });
    });
  }
  const positiveTraits = Object.entries(tasteDNA).filter(([, v]) => v?.polarity !== 'negative').slice(0, 4).map(([k]) => k);
  if (positiveTraits.length) queries.push({ label: 'Taste DNA lane', query: `${positiveTraits.join(' ')} ${artist}`.trim(), target: 'general', reason: 'taste dna synthesis', sourceTraits: positiveTraits });
  if (aiHint?.spotifySearchQuery) queries.push({ label: 'AI Spotify lead', query: aiHint.spotifySearchQuery, target: 'spotify', reason: 'ai hint', sourceTraits: aiHint.matchedTraits || [] });
  if (aiHint?.youtubeSearchQuery) queries.push({ label: 'AI YouTube lead', query: aiHint.youtubeSearchQuery, target: 'youtube', reason: 'ai hint', sourceTraits: aiHint.matchedTraits || [] });
  return queries;
}
