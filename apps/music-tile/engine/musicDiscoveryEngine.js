const QUERY_SUFFIXES = ['live', 'set', 'afterlife', 'interview', 'mix', 'full set', 'festival'];
const EVENT_KEYWORDS = ['afterlife', 'cercle', 'zamna'];

function clampRating(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(-5, Math.min(5, Math.round(numeric)));
}

export function createDiscoveryQueries(artist, context = {}) {
  const base = typeof artist?.name === 'string' ? artist.name.trim() : '';
  if (!base) return [];

  const collaborators = Array.isArray(artist.collaborators) ? artist.collaborators : [];
  const labels = Array.isArray(artist.labels) ? artist.labels : [];
  const events = Array.isArray(context.events) ? context.events : EVENT_KEYWORDS;

  const querySet = new Set([base]);
  QUERY_SUFFIXES.forEach((suffix) => querySet.add(`${base} ${suffix}`));
  collaborators.forEach((collaborator) => querySet.add(`${base} ${collaborator} live`));
  labels.forEach((label) => querySet.add(`${base} ${label} set`));
  events.forEach((event) => querySet.add(`${base} ${event}`));

  return Array.from(querySet);
}

export function deriveSignalsFromRating(mediaItem, rating) {
  const normalized = clampRating(rating);
  const artistDelta = normalized * 0.2;
  const channelDelta = normalized * 0.25;
  const eventDelta = normalized * 0.15;

  return {
    artistAffinityDelta: artistDelta,
    channelAffinityDelta: channelDelta,
    eventAffinityDelta: eventDelta,
    contentTypeDelta: mediaItem?.type === 'set' ? normalized * 0.18 : normalized * 0.08,
  };
}

function scoreDuration(durationSeconds = 0) {
  if (durationSeconds >= 60 * 30) return 3;
  if (durationSeconds >= 60 * 12) return 1;
  if (durationSeconds <= 60) return -3;
  return 0;
}

function recencyWeight(publishDate) {
  if (!publishDate) return 0;
  const date = new Date(publishDate);
  if (Number.isNaN(date.getTime())) return 0;
  const ageDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays < 120) return 1;
  if (ageDays > 3650) return -1;
  return 0;
}

export function scoreMediaItem(mediaItem, context = {}) {
  const trustByChannel = context.trustByChannel || {};
  const affinityByArtist = context.affinityByArtist || {};
  const preferredEvents = context.preferredEvents || EVENT_KEYWORDS;

  const channelTrustWeight = trustByChannel[mediaItem.channelId] || 0;
  const artistMatchWeight = (mediaItem.detectedArtists || []).reduce((sum, artistName) => sum + (affinityByArtist[artistName] || 0), 0);
  const title = (mediaItem.title || '').toLowerCase();
  const titleMatchStrength = ['set', 'live', 'mix', 'full'].reduce((sum, token) => sum + (title.includes(token) ? 0.75 : 0), 0);
  const durationWeight = scoreDuration(mediaItem.duration);
  const recency = recencyWeight(mediaItem.publishDate);
  const eventMatchWeight = preferredEvents.some((event) => title.includes(event)) ? 1.5 : 0;
  const userAffinityWeight = mediaItem.type === 'set' ? 1.5 : 0;
  const duplicatePenalty = context.seenIds?.has(mediaItem.id) ? -5 : 0;

  return Number((
    channelTrustWeight +
    artistMatchWeight +
    titleMatchStrength +
    durationWeight +
    recency +
    eventMatchWeight +
    userAffinityWeight +
    duplicatePenalty
  ).toFixed(2));
}

export function rankMediaItemsForFlow(mediaItems, context = {}) {
  const seenIds = new Set(context.seenIds || []);

  return mediaItems
    .map((item) => ({
      ...item,
      score: scoreMediaItem(item, { ...context, seenIds }),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.duration || 0) - (a.duration || 0);
    });
}

export function createFlowQueue(mediaItems, options = {}) {
  const includeSeen = Boolean(options.includeSeen);
  const minDurationSeconds = options.minDurationSeconds || 0;
  const ranked = rankMediaItemsForFlow(mediaItems, options);

  return ranked.filter((item) => {
    if (!includeSeen && item.seen) return false;
    if (item.ignored) return false;
    if (item.duration < minDurationSeconds) return false;
    return true;
  });
}

export function toYouTubeMediaItem(video) {
  const id = video?.id?.videoId || video?.id || '';
  const snippet = video?.snippet || {};
  return {
    id,
    title: snippet.title || 'Untitled',
    description: snippet.description || '',
    channelId: snippet.channelId || '',
    channelName: snippet.channelTitle || 'Unknown channel',
    duration: 0,
    publishDate: snippet.publishedAt || null,
    thumbnail: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '',
    detectedArtists: [],
    detectedEvents: [],
    detectedLabels: [],
    type: 'clip',
    score: 0,
    seen: false,
    saved: false,
    ignored: false,
  };
}

export async function discoverFromYouTubeApi({ apiKey, queries = [], maxResults = 10, fetchImpl = fetch }) {
  if (!apiKey) {
    return { items: [], source: 'no-api-key', quotaAware: true };
  }

  const items = [];
  for (const query of queries) {
    const endpoint = new URL('https://www.googleapis.com/youtube/v3/search');
    endpoint.searchParams.set('part', 'snippet');
    endpoint.searchParams.set('type', 'video');
    endpoint.searchParams.set('maxResults', String(maxResults));
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('key', apiKey);

    const response = await fetchImpl(endpoint.toString());
    if (!response.ok) continue;
    const payload = await response.json();
    const converted = (payload.items || []).map(toYouTubeMediaItem);
    items.push(...converted);
  }

  return { items, source: 'youtube-search-list', quotaAware: true };
}
