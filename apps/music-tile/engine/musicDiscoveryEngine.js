const QUERY_SUFFIXES = ['live', 'set', 'afterlife', 'interview', 'mix', 'full set', 'festival'];
const EVENT_KEYWORDS = ['afterlife', 'cercle', 'zamna'];
const WORD_SPLIT_PATTERN = /[\s,|/&+-]+/;
const ARTIST_RELEVANCE_TIERS = {
  STRONG: 'strong',
  SOFT: 'soft',
  GENERAL: 'general',
};

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPhraseMatcher(phrase) {
  const normalized = normalizeText(phrase);
  if (!normalized) return null;
  const pattern = `(?:^|\\b)${escapeRegex(normalized)}(?:$|\\b)`;
  return new RegExp(pattern, 'i');
}

function collectMediaSearchText(mediaItem = {}) {
  return [
    mediaItem.title,
    mediaItem.description,
    mediaItem.channelName,
    ...(mediaItem.detectedArtists || []),
    ...(mediaItem.detectedLabels || []),
    ...(mediaItem.detectedEvents || []),
    mediaItem.providerMetadata?.title,
    mediaItem.providerMetadata?.description,
    mediaItem.providerMetadata?.channelName,
  ].map(normalizeText).filter(Boolean);
}

function collectArtistTerms(artist) {
  const base = String(artist?.name || artist || '').trim();
  if (!base) return [];
  const aliases = Array.isArray(artist?.aliases) ? artist.aliases : [];
  const collaborators = Array.isArray(artist?.collaborators) ? artist.collaborators : [];
  const labels = Array.isArray(artist?.labels) ? artist.labels : [];
  const terms = [base, ...aliases, ...collaborators, ...labels]
    .flatMap((term) => String(term || '').split(WORD_SPLIT_PATTERN).length > 3 ? [term] : [term])
    .map((term) => String(term || '').trim())
    .filter(Boolean);
  return Array.from(new Set(terms));
}

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

export function scoreArtistRelevance(mediaItem, activeArtists = [], context = {}) {
  if (!Array.isArray(activeArtists) || !activeArtists.length) {
    return {
      score: 0,
      matched: false,
      reasons: [],
      tier: ARTIST_RELEVANCE_TIERS.GENERAL,
    };
  }

  const reasons = [];
  const softReasons = [];
  const strongReasons = [];
  const title = normalizeText(mediaItem?.title);
  const description = normalizeText(mediaItem?.description);
  const channel = normalizeText(mediaItem?.channelName);
  const textBuckets = collectMediaSearchText(mediaItem);
  const bucketBlob = textBuckets.join(' ');
  const detectedEvents = (mediaItem?.detectedEvents || []).map(normalizeText);
  const detectedLabels = (mediaItem?.detectedLabels || []).map(normalizeText);
  let score = 0;
  let matched = false;
  let strongMatch = false;
  let softMatch = false;

  activeArtists.forEach((artist) => {
    const artistTerms = collectArtistTerms(artist);
    const collaboratorTerms = Array.isArray(artist?.collaborators)
      ? artist.collaborators.map(normalizeText).filter(Boolean)
      : [];
    const labelTerms = Array.isArray(artist?.labels)
      ? artist.labels.map(normalizeText).filter(Boolean)
      : [];
    artistTerms.forEach((term) => {
      const normalizedTerm = normalizeText(term);
      if (!normalizedTerm) return;
      const matcher = buildPhraseMatcher(normalizedTerm);
      const exactTitle = matcher?.test(title);
      const exactChannel = matcher?.test(channel);
      const exactDescription = matcher?.test(description);
      const inDetectedArtists = (mediaItem.detectedArtists || []).some((candidate) => normalizeText(candidate) === normalizedTerm);
      const normalizedWords = normalizedTerm.split(' ').filter(Boolean);
      const fuzzyWordsMatched = normalizedWords.length >= 2 && normalizedWords.some((word) => bucketBlob.includes(word));

      if (exactTitle) {
        score += 10;
        matched = true;
        strongMatch = true;
        strongReasons.push(`title:${normalizedTerm}`);
      }
      if (exactChannel) {
        score += 6;
        matched = true;
        strongMatch = true;
        strongReasons.push(`channel:${normalizedTerm}`);
      }
      if (exactDescription) {
        score += 4;
        matched = true;
        strongMatch = true;
        strongReasons.push(`description:${normalizedTerm}`);
      }
      if (inDetectedArtists) {
        score += 5;
        matched = true;
        strongMatch = true;
        strongReasons.push(`detected:${normalizedTerm}`);
      }
      if (!exactTitle && !exactChannel && !exactDescription && !inDetectedArtists && fuzzyWordsMatched) {
        score += 2;
        matched = true;
        softMatch = true;
        softReasons.push(`fuzzy:${normalizedTerm}`);
      }
    });

    const collaboratorHit = collaboratorTerms.find((candidate) => candidate && bucketBlob.includes(candidate));
    if (collaboratorHit) {
      score += 1.5;
      matched = true;
      softMatch = true;
      softReasons.push(`collaborator:${collaboratorHit}`);
    }

    const labelHit = labelTerms.find((candidate) => candidate && (detectedLabels.includes(candidate) || bucketBlob.includes(candidate)));
    if (labelHit) {
      score += 1.5;
      matched = true;
      softMatch = true;
      softReasons.push(`label:${labelHit}`);
    }
  });

  const queryAssociation = normalizeText(mediaItem.matchedArtist || mediaItem.artistSearchSource || '');
  if (queryAssociation) {
    score += 1;
    matched = true;
    softMatch = true;
    softReasons.push(`query-source:${queryAssociation}`);
  }

  const eventHit = EVENT_KEYWORDS.find((event) => detectedEvents.includes(event) || bucketBlob.includes(event));
  if (eventHit) {
    score += 1;
    matched = true;
    softMatch = true;
    softReasons.push(`event:${eventHit}`);
  }

  reasons.push(...strongReasons, ...softReasons);

  const tier = strongMatch
    ? ARTIST_RELEVANCE_TIERS.STRONG
    : (softMatch ? ARTIST_RELEVANCE_TIERS.SOFT : ARTIST_RELEVANCE_TIERS.GENERAL);

  if (!matched && context.artistSearchActive) reasons.push('general-discovery');

  return {
    score: Number(score.toFixed(2)),
    matched,
    reasons: Array.from(new Set(reasons)),
    tier,
  };
}

export function applyArtistSearchContext(mediaItems, context = {}) {
  const activeArtists = Array.isArray(context.activeArtists) ? context.activeArtists : [];
  const artistSearchActive = Boolean(context.artistSearchActive && activeArtists.length);

  const scored = mediaItems.map((item) => {
    const relevance = scoreArtistRelevance(item, activeArtists, { artistSearchActive });
    return {
      ...item,
      artistRelevanceScore: relevance.score,
      relevanceReasons: relevance.reasons,
      artistMatched: relevance.matched,
      relevanceTier: relevance.tier,
    };
  });
  return {
    filteredItems: scored,
    counts: {
      before: mediaItems.length,
      after: scored.length,
      matched: scored.filter((item) => item.artistMatched).length,
      strong: scored.filter((item) => item.relevanceTier === ARTIST_RELEVANCE_TIERS.STRONG).length,
      soft: scored.filter((item) => item.relevanceTier === ARTIST_RELEVANCE_TIERS.SOFT).length,
      general: scored.filter((item) => item.relevanceTier === ARTIST_RELEVANCE_TIERS.GENERAL).length,
    },
  };
}

export function rankMediaItemsForFlow(mediaItems, context = {}) {
  const seenIds = new Set(context.seenIds || []);
  const artistSearchActive = Boolean(context.artistSearchActive);
  const artistScoreWeight = artistSearchActive ? 1.35 : 0.65;
  const tierWeights = artistSearchActive
    ? { strong: 8, soft: 3, general: 0 }
    : { strong: 0, soft: 0, general: 0 };

  return mediaItems
    .map((item) => ({
      ...item,
      score: Number((
        scoreMediaItem(item, { ...context, seenIds }) +
        ((item.artistRelevanceScore || 0) * artistScoreWeight) +
        (tierWeights[item.relevanceTier] || 0)
      ).toFixed(2)),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.duration || 0) - (a.duration || 0);
    });
}

export function createFlowQueue(mediaItems, options = {}) {
  const includeSeen = Boolean(options.includeSeen);
  const includeExternal = options.includeExternal !== false;
  const preferInline = Boolean(options.preferInline);
  const minDurationSeconds = options.minDurationSeconds || 0;
  const ranked = rankMediaItemsForFlow(mediaItems, options);

  const filtered = ranked.filter((item) => {
    if (!includeSeen && item.seen) return false;
    if (item.ignored) return false;
    if (item.playbackMode === 'suppress') return false;
    if (!includeExternal && item.playbackMode === 'external') return false;
    if (item.duration < minDurationSeconds) return false;
    return true;
  });

  if (!preferInline) return filtered;
  return filtered.sort((a, b) => {
    const inlineA = a.playbackMode === 'inline' ? 1 : 0;
    const inlineB = b.playbackMode === 'inline' ? 1 : 0;
    if (inlineB !== inlineA) return inlineB - inlineA;
    return 0;
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
    durationSource: 'unknown',
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
