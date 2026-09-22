const YOUTUBE_SEARCH_ENDPOINT = 'https://www.youtube.com/results';
const DEFAULT_TIMEOUT_MS = 7000;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_QUERY_LENGTH = 160;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const NEGATIVE_TERMS = Object.freeze(['cover', 'karaoke', 'reaction', 'tutorial', 'instrumental cover', 'nightcore']);
const POSITIVE_TERMS = Object.freeze(['official audio', 'official video', 'official music video', 'topic', 'provided to youtube']);

function text(value = '') { return String(value ?? '').trim(); }
function normalize(value = '') { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function tokens(value = '') { return normalize(value).split(' ').filter((token) => token.length > 1); }
function coverage(expected = '', observed = '') {
  const expectedTokens = tokens(expected);
  const observedTokens = new Set(tokens(observed));
  if (!expectedTokens.length || !observedTokens.size) return 0;
  return expectedTokens.filter((token) => observedTokens.has(token)).length / expectedTokens.length;
}
function rendererText(value = {}) {
  if (typeof value?.simpleText === 'string') return value.simpleText.trim();
  return (Array.isArray(value?.runs) ? value.runs : []).map((run) => text(run?.text)).filter(Boolean).join(' ').trim();
}

export function youtubeThumbnailUrl(videoId = '') {
  const id = text(videoId);
  return VIDEO_ID.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
}

function extractAssignedJson(source = '', marker = 'ytInitialData') {
  const input = String(source || '');
  const markerIndex = input.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = input.indexOf('{', markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(input.slice(start, index + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function collectVideoRenderers(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  if (value.videoRenderer && typeof value.videoRenderer === 'object') output.push(value.videoRenderer);
  if (Array.isArray(value)) value.forEach((item) => collectVideoRenderers(item, output));
  else Object.values(value).forEach((item) => collectVideoRenderers(item, output));
  return output;
}

export function parseYouTubeSearchHtml(html = '') {
  const data = extractAssignedJson(html, 'ytInitialData');
  if (!data) return [];
  const seen = new Set();
  return collectVideoRenderers(data).map((renderer) => {
    const videoId = text(renderer?.videoId);
    const title = rendererText(renderer?.title);
    const channel = rendererText(renderer?.ownerText) || rendererText(renderer?.longBylineText) || rendererText(renderer?.shortBylineText);
    if (!VIDEO_ID.test(videoId) || !title || seen.has(videoId)) return null;
    seen.add(videoId);
    return Object.freeze({
      videoId,
      title,
      channel,
      youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
      artworkUrl: youtubeThumbnailUrl(videoId),
    });
  }).filter(Boolean);
}

export function scoreYouTubeTrackCandidate({ artist = '', title = '' } = {}, candidate = {}) {
  const requestedArtist = normalize(artist);
  const requestedTitle = normalize(title);
  const candidateTitle = normalize(candidate.title);
  const candidateChannel = normalize(candidate.channel);
  if (!requestedArtist || !requestedTitle || !candidateTitle) return 0;
  const titleCoverage = coverage(requestedTitle, candidateTitle);
  const artistCoverage = Math.max(coverage(requestedArtist, candidateTitle), coverage(requestedArtist, candidateChannel));
  if (titleCoverage < 0.8 || artistCoverage < 0.8) return 0;
  const combined = `${candidateTitle} ${candidateChannel}`;
  if (NEGATIVE_TERMS.some((term) => combined.includes(term))) return 0;
  const exactTitle = candidateTitle === requestedTitle || candidateTitle.includes(requestedTitle);
  const officialBonus = POSITIVE_TERMS.some((term) => combined.includes(term)) ? 80 : 0;
  return Math.round(titleCoverage * 1000) + Math.round(artistCoverage * 400) + (exactTitle ? 200 : 0) + officialBonus;
}

export function chooseYouTubeTrackCandidate(identity = {}, candidates = []) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({ candidate, score: scoreYouTubeTrackCandidate(identity, candidate) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.videoId.localeCompare(right.candidate.videoId))[0]?.candidate || null;
}

export function createYouTubePublicTrackResolver({
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  return async function resolveYouTubeTrack({ artist = '', title = '' } = {}) {
    const cleanArtist = text(artist).slice(0, MAX_QUERY_LENGTH);
    const cleanTitle = text(title).slice(0, MAX_QUERY_LENGTH);
    if (!cleanArtist || !cleanTitle) return { ok: false, reason: 'youtube-track-identity-required', result: null };
    const key = `${normalize(cleanArtist)}::${normalize(cleanTitle)}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.value;
    if (typeof fetchImpl !== 'function') return { ok: false, reason: 'youtube-fetch-unavailable', result: null };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
    try {
      const url = new URL(YOUTUBE_SEARCH_ENDPOINT);
      url.searchParams.set('search_query', `${cleanArtist} ${cleanTitle} official audio`);
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-GB,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 (compatible; StephanosOS/1.0; +https://github.com/Cheekyfellastef/stephan-os)',
        },
      });
      if (!response?.ok) return { ok: false, reason: `youtube-search-http-${Number(response?.status || 0)}`, result: null };
      const html = await response.text();
      const candidate = chooseYouTubeTrackCandidate({ artist: cleanArtist, title: cleanTitle }, parseYouTubeSearchHtml(html));
      const value = candidate
        ? Object.freeze({
            ok: true,
            reason: 'youtube-exact-track-resolved',
            result: Object.freeze({
              provider: 'youtube',
              providerLabel: 'YouTube',
              providerItemId: candidate.videoId,
              providerUrl: candidate.youtubeUrl,
              youtubeVideoId: candidate.videoId,
              youtubeUrl: candidate.youtubeUrl,
              artworkUrl: candidate.artworkUrl,
              title: candidate.title,
              channel: candidate.channel,
              verificationStatus: 'metadata_verified',
              playbackAvailability: 'external_playback',
            }),
          })
        : Object.freeze({ ok: false, reason: 'youtube-exact-track-not-proven', result: null });
      cache.set(key, { expiresAt: now() + Math.max(0, Number(cacheTtlMs) || DEFAULT_CACHE_TTL_MS), value });
      return value;
    } catch (error) {
      return { ok: false, reason: error?.name === 'AbortError' ? 'youtube-search-timeout' : 'youtube-search-failed', result: null };
    } finally {
      clearTimeout(timer);
    }
  };
}

export const resolveYouTubePublicTrack = createYouTubePublicTrackResolver();
