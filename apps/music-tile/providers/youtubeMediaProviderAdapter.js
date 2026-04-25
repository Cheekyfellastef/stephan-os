function selectBestThumbnail(thumbnails = {}) {
  if (!thumbnails || typeof thumbnails !== 'object') return '';
  return String(
    thumbnails.maxres?.url
    || thumbnails.standard?.url
    || thumbnails.high?.url
    || thumbnails.medium?.url
    || thumbnails.default?.url
    || '',
  ).trim();
}

function parseIso8601Duration(duration = '') {
  const normalized = String(duration || '').trim();
  if (!normalized) return 0;
  const match = normalized.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return 0;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return (hours * 3600) + (minutes * 60) + seconds;
}

function toSearchCandidate(video = {}) {
  const id = video?.id?.videoId || video?.id || '';
  const snippet = video?.snippet || {};
  if (!id) return null;
  return {
    id,
    provider: 'youtube',
    providerItemId: id,
    providerType: 'video',
    title: snippet.title || 'Untitled',
    description: snippet.description || '',
    channelId: snippet.channelId || '',
    channelName: snippet.channelTitle || 'Unknown channel',
    publishDate: snippet.publishedAt || null,
    duration: 0,
    durationSource: 'unknown',
    thumbnail: selectBestThumbnail(snippet.thumbnails),
    thumbnailSource: selectBestThumbnail(snippet.thumbnails) ? 'youtube-search-snippet' : 'unknown',
  };
}

function isRegionBlocked(contentDetails = {}, regionCode = '') {
  const normalizedRegion = String(regionCode || '').trim().toUpperCase();
  if (!normalizedRegion) return false;
  const restriction = contentDetails.regionRestriction || {};
  const blocked = Array.isArray(restriction.blocked) ? restriction.blocked.map((entry) => String(entry || '').toUpperCase()) : [];
  const allowed = Array.isArray(restriction.allowed) ? restriction.allowed.map((entry) => String(entry || '').toUpperCase()) : [];
  if (blocked.includes(normalizedRegion)) return true;
  if (allowed.length && !allowed.includes(normalizedRegion)) return true;
  return false;
}

function buildCapabilities({ playbackMode = 'suppress' } = {}) {
  return {
    canPlayInline: playbackMode === 'inline',
    canOpenExternally: playbackMode !== 'suppress',
    canFlowInline: playbackMode === 'inline',
    canFlowExternal: playbackMode === 'inline' || playbackMode === 'external',
  };
}

export function createYouTubeMediaProviderAdapter({ apiKey = '', fetchImpl = fetch } = {}) {
  async function discoverCandidates(query, options = {}) {
    if (!apiKey) return [];
    const endpoint = new URL('https://www.googleapis.com/youtube/v3/search');
    endpoint.searchParams.set('part', 'snippet');
    endpoint.searchParams.set('type', 'video');
    endpoint.searchParams.set('maxResults', String(options.maxResults || 10));
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('key', apiKey);

    const response = await fetchImpl(endpoint.toString());
    if (!response.ok) return [];
    const payload = await response.json();
    return (payload.items || []).map(toSearchCandidate).filter(Boolean);
  }

  async function enrichCandidates(ids = []) {
    const candidateIds = Array.from(new Set(ids.filter(Boolean)));
    if (!candidateIds.length || !apiKey) return {};
    const endpoint = new URL('https://www.googleapis.com/youtube/v3/videos');
    endpoint.searchParams.set('part', 'snippet,status,contentDetails');
    endpoint.searchParams.set('id', candidateIds.join(','));
    endpoint.searchParams.set('key', apiKey);

    const response = await fetchImpl(endpoint.toString());
    if (!response.ok) return {};
    const payload = await response.json();

    return (payload.items || []).reduce((acc, item) => {
      const id = String(item?.id || '').trim();
      if (!id) return acc;
      acc[id] = item;
      return acc;
    }, {});
  }

  function validateCandidate(candidate, context = {}) {
    const metadata = context.enrichedById?.[candidate.providerItemId] || null;
    const regionCode = context.regionCode || '';
    const reliabilityRecord = context.reliabilityRecord || null;
    const status = metadata?.status || {};
    const contentDetails = metadata?.contentDetails || {};
    const validationReasons = [];

    if (!metadata) validationReasons.push('youtube.unavailable');
    if (status.privacyStatus === 'private') validationReasons.push('youtube.private');
    if (status.uploadStatus && status.uploadStatus !== 'processed') validationReasons.push('youtube.not_processed');
    if (isRegionBlocked(contentDetails, regionCode)) validationReasons.push('youtube.region_blocked');
    if (status.embeddable === false) validationReasons.push('youtube.embed_blocked');

    const knownReliabilityClass = String(reliabilityRecord?.reliabilityClass || '').trim();
    const knownFailureCount = Number(reliabilityRecord?.failureCount || 0);
    if (knownReliabilityClass === 'externalOpenFailed' && knownFailureCount >= 2) {
      validationReasons.push('youtube.external_open_failed_repeat');
    }
    if ((knownReliabilityClass === 'unavailable' || knownReliabilityClass === 'providerRemoved') && knownFailureCount >= 2) {
      validationReasons.push('youtube.unavailable_repeat');
    }

    const hasSuppressionReason = validationReasons.some((reason) => [
      'youtube.private',
      'youtube.not_processed',
      'youtube.region_blocked',
      'youtube.unavailable',
      'youtube.external_open_failed_repeat',
      'youtube.unavailable_repeat',
    ].includes(reason));

    let playbackMode = 'inline';
    let availabilityStatus = 'available';
    let suppressionClass = 'none';

    if (hasSuppressionReason) {
      playbackMode = 'suppress';
      availabilityStatus = 'suppressed';
      suppressionClass = validationReasons.includes('youtube.region_blocked')
        ? 'regionBlocked'
        : (validationReasons.includes('youtube.private') ? 'private' : 'unavailable');
    } else if (validationReasons.includes('youtube.embed_blocked')) {
      playbackMode = 'external';
      availabilityStatus = 'external_only';
      suppressionClass = 'embedBlocked';
    }

    const duration = parseIso8601Duration(contentDetails.duration);
    const durationSource = duration > 0 ? 'youtube-contentDetails' : 'unknown';
    const enrichedThumbnail = selectBestThumbnail(metadata?.snippet?.thumbnails);
    const fallbackThumbnail = String(candidate?.thumbnail || '').trim();
    const thumbnail = enrichedThumbnail || fallbackThumbnail;
    const thumbnailSource = enrichedThumbnail
      ? 'youtube-snippet'
      : (fallbackThumbnail ? (candidate.thumbnailSource || 'youtube-search-snippet') : 'unknown');

    return {
      ...candidate,
      duration,
      durationSource,
      thumbnail,
      thumbnailSource,
      providerUrl: `https://www.youtube.com/watch?v=${candidate.providerItemId}`,
      playbackMode,
      availabilityStatus,
      validationStatus: playbackMode === 'suppress' ? 'blocked' : 'validated',
      validationReasons,
      suppressionClass,
      capabilities: {
        ...buildCapabilities({ playbackMode }),
        provider: 'youtube',
        providerType: 'video',
        playbackMode,
      },
      lastValidationAt: new Date().toISOString(),
    };
  }

  function buildExternalUrl(item) {
    return `https://www.youtube.com/watch?v=${item.providerItemId || item.id}`;
  }

  function buildInlineEmbedDescriptor(item) {
    return {
      provider: 'youtube',
      providerType: 'video',
      videoId: item.providerItemId || item.id,
    };
  }

  function getPlaybackCapabilities(item) {
    return item.capabilities || buildCapabilities({ playbackMode: item.playbackMode });
  }

  return {
    provider: 'youtube',
    selectBestThumbnail,
    discoverCandidates,
    enrichCandidates,
    validateCandidate,
    buildExternalUrl,
    buildInlineEmbedDescriptor,
    getPlaybackCapabilities,
  };
}
