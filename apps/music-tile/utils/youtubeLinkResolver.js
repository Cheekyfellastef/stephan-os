const WATCH_URL_PREFIX = 'https://www.youtube.com/watch?v=';
const SEARCH_URL_PREFIX = 'https://www.youtube.com/results?search_query=';

export function sanitizeVideoId(videoId) {
  if (typeof videoId !== 'string') {
    return '';
  }

  const trimmed = videoId.trim();
  const looksLikeYouTubeId = /^[a-zA-Z0-9_-]{11}$/.test(trimmed);
  return looksLikeYouTubeId ? trimmed : '';
}

export function getWatchVideoIdFromUrl(url = '') {
  const normalized = String(url || '').trim();
  if (!normalized) return '';

  try {
    const parsed = new URL(normalized);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname.includes('youtube.com')) {
      return sanitizeVideoId(parsed.searchParams.get('v'));
    }
    if (hostname === 'youtu.be') {
      return sanitizeVideoId(parsed.pathname.replace('/', ''));
    }
  } catch (_error) {
    return '';
  }

  return '';
}

function buildSearchQuery(item = {}) {
  const canonical = item?.canonicalQuery || item?.youtube?.canonicalQuery || '';
  const fallback = item?.fallbackQuery || item?.youtube?.fallbackQuery || '';
  if (canonical?.trim()) return canonical.trim();
  if (fallback?.trim()) return fallback.trim();
  return [item.artist, item.title, item.channelName].filter(Boolean).join(' ').trim();
}

export function getMediaPlaybackLinkState(item = {}) {
  const providerVideoId = sanitizeVideoId(item?.providerItemId);
  if (providerVideoId) {
    return {
      hasExactVideo: true,
      url: `${WATCH_URL_PREFIX}${providerVideoId}`,
      label: 'Play',
      reason: 'provider_item_id',
      videoId: providerVideoId,
    };
  }

  const watchVideoId = getWatchVideoIdFromUrl(item?.providerUrl);
  if (watchVideoId) {
    return {
      hasExactVideo: true,
      url: `${WATCH_URL_PREFIX}${watchVideoId}`,
      label: 'Play',
      reason: 'provider_url_watch',
      videoId: watchVideoId,
    };
  }

  const query = buildSearchQuery(item);
  return {
    hasExactVideo: false,
    url: `${SEARCH_URL_PREFIX}${encodeURIComponent(query)}`,
    label: query ? 'Find on YouTube' : 'Search YouTube',
    reason: query ? 'search_query' : 'missing_query',
    videoId: '',
  };
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
