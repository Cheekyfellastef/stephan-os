const WATCH_URL_PREFIX = 'https://www.youtube.com/watch?v=';
const SEARCH_URL_PREFIX = 'https://www.youtube.com/results?search_query=';

function sanitizeVideoId(videoId) {
  if (typeof videoId !== 'string') {
    return '';
  }

  const trimmed = videoId.trim();
  const looksLikeYouTubeId = /^[a-zA-Z0-9_-]{11}$/.test(trimmed);
  return looksLikeYouTubeId ? trimmed : '';
}

function buildDerivedQuery(track) {
  const artist = track.artist?.trim() || '';
  const title = track.title?.trim() || '';
  return [artist, title].filter(Boolean).join(' ').trim();
}

export function resolveYouTubeLink(track) {
  const strategy = track.youtube?.strategy || 'search-first';
  const preferredVideoId = sanitizeVideoId(track.youtube?.preferredVideoId);

  if ((strategy === 'direct-first' || strategy === 'search-first') && preferredVideoId) {
    return {
      mode: 'direct',
      url: `${WATCH_URL_PREFIX}${preferredVideoId}`,
      actionLabel: 'Open on YouTube'
    };
  }

  const query = track.youtube?.canonicalQuery?.trim() || track.youtube?.fallbackQuery?.trim() || buildDerivedQuery(track);

  return {
    mode: 'search',
    url: `${SEARCH_URL_PREFIX}${encodeURIComponent(query)}`,
    actionLabel: 'Search on YouTube'
  };
}
