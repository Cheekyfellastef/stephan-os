import { createHash } from 'node:crypto';

export const MUSIC_CARD_PROOF_SCENARIO = 'MUSIC_CARDS_ARTWORK_EXACT_LINKS';
export const MUSIC_CARD_PROOF_SCHEMA = 'stephanos.browser-scenario-evidence.music-cards.v1';
const SOURCE_BINDING = 'playwright-scenario-source-responses-git-blob-v2';
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const MAX_CARDS = 20;

function spotifyId(value) {
  const uri = /^spotify:track:([A-Za-z0-9]{22})$/.exec(String(value || ''));
  if (uri) return uri[1];
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.username || url.password || url.port) return '';
    return /^\/track\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname)?.[1] || '';
  } catch { return ''; }
}

function youtubeId(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (url.hostname === 'youtu.be') return /^\/([A-Za-z0-9_-]{11})$/.exec(url.pathname)?.[1] || '';
    if (['www.youtube.com', 'youtube.com'].includes(url.hostname) && url.pathname === '/watch') {
      const id = url.searchParams.get('v') || '';
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
    }
  } catch {}
  return '';
}

function trustedArtwork(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['scdn.co', 'spotifycdn.com'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

function validSearch(link) {
  if (!link.label.startsWith('Find on ')) return true;
  try {
    const url = new URL(link.href);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    return link.label === 'Find on Spotify'
      ? url.hostname === 'open.spotify.com' && /^\/search\/.+/.test(url.pathname)
      : ['www.youtube.com', 'youtube.com'].includes(url.hostname) && url.pathname === '/results' && Boolean(url.searchParams.get('search_query'));
  } catch { return false; }
}

// Runs in the page. Read existing cards only: never seed songs, write storage,
// change ratings, start playback, or inject a provider response to obtain PASS.
export async function readMusicCardDom() {
  const { getCandidateVerificationStatus, isVerifiedCandidateTrack } = await import('/apps/music-tile/engine/candidateVerification.js');
  let state;
  let overlay;
  try {
    state = JSON.parse(localStorage.getItem('stephanos.musicTile.dashboardState.v1') || 'null');
    overlay = JSON.parse(localStorage.getItem('stephanos.musicTile.spotifyOembedArtwork.v1') || '{}');
  } catch { return { stateValid: false, cards: [] }; }
  if (!Array.isArray(state?.listeningDeck) || state.listeningDeck.length > 20) {
    return { stateValid: false, cards: [], cardCount: state?.listeningDeck?.length || 0 };
  }
  const inputs = [...document.querySelectorAll('#listening-deck [data-link-input]')];
  const cards = state.listeningDeck.map((track) => {
    const card = inputs.find((input) => input.getAttribute('data-link-input') === `spotify-${track.id}`)?.closest('.player-deck-card');
    const image = card?.querySelector('[data-catalog-artwork] img');
    const status = getCandidateVerificationStatus(track);
    const eligible = !['not-found', 'likely-hallucinated'].includes(status)
      && (isVerifiedCandidateTrack(track) || (track.sourceKind === 'native-catalog' && track.catalogVerificationStatus === 'metadata_verified'));
    return {
      id: String(track.id || ''), eligible, spotify: String(track.spotifyUrl || track.spotifyUri || ''),
      youtube: String(track.youtubeUrl || ''), present: Boolean(card),
      links: [...(card?.querySelectorAll('.media-controls a') || [])].map((link) => ({ label: link.textContent.trim(), href: link.href })),
      artwork: image?.currentSrc || image?.getAttribute('src') || '',
      artworkLoaded: Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0),
      overlay: overlay?.entries?.[String(track.id)] || null,
      catalogArtwork: { provider: track.catalogProvider, id: track.catalogProviderItemId,
        status: track.catalogVerificationStatus, source: track.artworkSource, url: track.artworkUrl,
        linkSource: track.catalogLinkSource },
      iframeCount: card?.querySelectorAll('iframe').length || 0,
    };
  });
  return { stateValid: true, cards, renderedCount: document.querySelectorAll('#listening-deck .player-deck-card').length };
}

// Independent checks on the browser observation. Never return song identities,
// provider URLs, local storage, console text or private profile data publicly.
export function inspectMusicCardSnapshot(snapshot = {}) {
  if (!snapshot || typeof snapshot !== 'object') snapshot = {};
  const rows = snapshot.cards;
  if (snapshot.stateValid !== true || !Array.isArray(rows) || rows.length < 1 || rows.length > MAX_CARDS
    || rows.some((row) => !row || typeof row !== 'object')
    || snapshot.renderedCount !== rows.length || new Set(rows.map((row) => row.id)).size !== rows.length) {
    return { ok: false, blocker: 'MUSIC_REAL_CARDS_UNAVAILABLE_OR_OUT_OF_BOUNDS', count: 0, spotifyCount: 0, fingerprint: '' };
  }
  let spotifyCount = 0;
  const signatures = [];
  for (const row of rows) {
    if (typeof row.id !== 'string' || !row.id || row.present !== true || !Array.isArray(row.links)
      || row.links.length > 8 || row.links.some((link) => !link || typeof link.label !== 'string' || typeof link.href !== 'string'
        || link.href.length > 2048 || !['Open in Spotify', 'Open in YouTube', 'Find on Spotify', 'Find on YouTube'].includes(link.label))
      || !Number.isSafeInteger(row.iframeCount) || row.iframeCount < 0 || row.iframeCount > 2) {
      return { ok: false, blocker: 'MUSIC_CARD_DOM_INCOMPLETE' };
    }
    const expectedSpotify = row.eligible === true ? spotifyId(row.spotify) : '';
    if (row.links.some((link) => !validSearch(link))) return { ok: false, blocker: 'MUSIC_SEARCH_ACTION_INVALID' };
    const expectedYoutube = youtubeId(row.youtube);
    const spotifyLinks = row.links.filter((link) => link.label === 'Open in Spotify');
    const youtubeLinks = row.links.filter((link) => link.label === 'Open in YouTube');
    if (spotifyLinks.length !== (expectedSpotify ? 1 : 0)
      || spotifyLinks.some((link) => spotifyId(link.href) !== expectedSpotify)
      || youtubeLinks.length !== (expectedYoutube ? 1 : 0)
      || youtubeLinks.some((link) => youtubeId(link.href) !== expectedYoutube)) {
      return { ok: false, blocker: 'MUSIC_EXACT_TRACK_ACTION_MISMATCH' };
    }
    if ((expectedSpotify || expectedYoutube) && row.links.some((link) => /^Find on (Spotify|YouTube)$/.test(link.label))) {
      return { ok: false, blocker: 'MUSIC_REDUNDANT_SEARCH_ACTION' };
    }
    if (!expectedSpotify && !expectedYoutube && !row.links.some((link) => /^Find on (Spotify|YouTube)$/.test(link.label))) {
      return { ok: false, blocker: 'MUSIC_UNRESOLVED_CARD_NOT_IDENTIFIED' };
    }
    if (expectedSpotify) {
      spotifyCount += 1;
      const overlay = row.overlay;
      const catalog = row.catalogArtwork || {};
      const overlayBound = overlay?.trackId === row.id && overlay?.spotifyTrackId === expectedSpotify
        && overlay?.source === 'spotify-oembed' && overlay?.artworkUrl === row.artwork;
      const catalogBound = catalog.provider === 'spotify' && catalog.id === expectedSpotify
        && catalog.status === 'metadata_verified' && catalog.source === 'spotify-catalogue' && catalog.url === row.artwork
        && catalog.linkSource === 'native-catalog-search';
      if (row.artworkLoaded !== true || !trustedArtwork(row.artwork) || (!overlayBound && !catalogBound)) {
        return { ok: false, blocker: 'MUSIC_ARTWORK_MISSING_UNLOADED_OR_IDENTITY_UNBOUND' };
      }
    } else if (row.eligible !== true && row.artwork && trustedArtwork(row.artwork)) {
      return { ok: false, blocker: 'MUSIC_UNVERIFIED_SPOTIFY_ARTWORK_VISIBLE' };
    }
    signatures.push([row.id, expectedSpotify, expectedYoutube, row.artwork, row.iframeCount]);
  }
  if (spotifyCount < 1) return { ok: false, blocker: 'MUSIC_VERIFIED_SPOTIFY_SAMPLE_MISSING' };
  signatures.sort((a, b) => a[0].localeCompare(b[0]));
  return { ok: true, blocker: '', count: rows.length, spotifyCount,
    fingerprint: createHash('sha256').update(JSON.stringify(signatures)).digest('hex') };
}

export function evaluateMusicCardEvidence(evidence = {}, { expectedHead = '', proofTarget = 'PULL_REQUEST_HEAD' } = {}) {
  if (!evidence || typeof evidence !== 'object') evidence = {};
  const blocking = [];
  const require = (condition, blocker) => { if (!condition) blocking.push(blocker); };
  require(evidence.schemaVersion === MUSIC_CARD_PROOF_SCHEMA, 'MUSIC_CARD_EVIDENCE_SCHEMA_INVALID');
  require(evidence.collector === 'playwright-existing-music-cards-v1' && evidence.fixtureInjected === false,
    'MUSIC_REAL_CARD_OBSERVATION_REQUIRED');
  require(evidence.realCardContextAdmitted === true, 'MUSIC_REAL_CARD_CONTEXT_NOT_ADMITTED');
  require(SHA.test(expectedHead) && evidence.sourceHead === expectedHead && evidence.proofTarget === proofTarget,
    'MUSIC_CARD_HEAD_OR_TARGET_MISMATCH');
  require(['PULL_REQUEST_HEAD', 'MERGED_MAIN'].includes(proofTarget), 'MUSIC_CARD_TARGET_INVALID');
  for (const binding of [evidence.sourceBefore, evidence.sourceAfter]) {
    require(binding?.exact === true && binding.sourceHead === expectedHead && HASH.test(binding.fingerprint || '')
      && binding.responseBinding === SOURCE_BINDING && binding.fileCount >= 2,
    'MUSIC_CARD_SERVED_SOURCE_UNPROVEN');
  }
  require(evidence.sourceBefore?.fingerprint === evidence.sourceAfter?.fingerprint, 'MUSIC_CARD_SOURCE_CHANGED_ON_RELOAD');
  require(evidence.before?.ok === true && evidence.after?.ok === true
    && Number.isSafeInteger(evidence.before?.count) && evidence.before.count >= 1 && evidence.before.count <= MAX_CARDS
    && Number.isSafeInteger(evidence.before?.spotifyCount) && evidence.before.spotifyCount >= 1
    && evidence.before.spotifyCount <= evidence.before.count
    && evidence.after.count === evidence.before.count && evidence.after.spotifyCount === evidence.before.spotifyCount,
  'MUSIC_CARD_ACCEPTANCE_FAILED');
  require(HASH.test(evidence.before?.fingerprint || '') && evidence.before.fingerprint === evidence.after?.fingerprint,
    'MUSIC_CARD_RELOAD_PERSISTENCE_FAILED');
  require(evidence.iframeIdentityPreserved === true, 'MUSIC_CARD_IFRAME_IDENTITY_CHANGED');
  require(evidence.consoleErrorCount === 0 && evidence.pageErrorCount === 0, 'MUSIC_CARD_BROWSER_ERRORS');
  if (evidence.blocker) blocking.push(evidence.blocker);
  return { accepted: blocking.length === 0, blocking: [...new Set(blocking)] };
}

export async function collectMusicCardEvidence(page, runtimeUrl, {
  capturedResponses = [], consoleErrors = [], pageErrors = [], expectedHead = '',
  proofTarget = 'PULL_REQUEST_HEAD', repoRoot = process.cwd(), bindSourceResponses,
  realCardContextAdmitted = false,
} = {}) {
  const evidence = { schemaVersion: MUSIC_CARD_PROOF_SCHEMA, collector: 'playwright-existing-music-cards-v1',
    fixtureInjected: false, realCardContextAdmitted, sourceHead: expectedHead, proofTarget, iframeIdentityPreserved: false };
  let refs;
  try {
    const runtime = new URL(runtimeUrl);
    if (runtime.protocol !== 'http:' || runtime.hostname !== '127.0.0.1' || runtime.port !== '4173'
      || runtime.username || runtime.password || typeof bindSourceResponses !== 'function') {
      throw new Error('MUSIC_CARD_FIXED_LOCAL_ROUTE_REQUIRED');
    }
    const scenarioUrl = new URL('/apps/music-tile/index.html', runtime.origin).href;
    // This is an internal caller contract, never a public mailbox flag. The
    // generic runner's fresh context cannot establish operator-profile truth.
    if (realCardContextAdmitted !== true) throw new Error('MUSIC_REAL_CARD_CONTEXT_NOT_ADMITTED');
    await page.route('**/apps/music-tile/**', (route) => route.continue({
      headers: { ...route.request().headers(), 'cache-control': 'no-store', pragma: 'no-cache' },
    }));
    let captureStart = capturedResponses.length;
    const navigation = await page.goto(scenarioUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    if (navigation?.status() !== 200 || page.url() !== scenarioUrl) throw new Error('MUSIC_CARD_ROUTE_MISMATCH');
    await page.locator('#listening-deck').waitFor({ state: 'attached', timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('#listening-deck .player-deck-card, #listening-deck .music-empty-state'), null, { timeout: 10000 });
    refs = await page.evaluateHandle(() => [...document.querySelectorAll('#listening-deck iframe')]);
    // Let the existing bounded artwork enrichment settle; do not replace DOM.
    let snapshot;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      snapshot = await page.evaluate(readMusicCardDom);
      if (inspectMusicCardSnapshot(snapshot).ok || snapshot.stateValid !== true || !snapshot.cards?.length) break;
      await page.waitForTimeout(1000);
    }
    evidence.before = inspectMusicCardSnapshot(snapshot);
    await page.waitForTimeout(1000);
    evidence.iframeIdentityPreserved = await page.evaluate((original) => {
      const current = [...document.querySelectorAll('#listening-deck iframe')];
      return original.length === current.length && original.every((node, index) => node === current[index] && node.isConnected);
    }, refs);
    evidence.sourceBefore = await bindSourceResponses(capturedResponses.slice(captureStart), { scenarioUrl, repoRoot, expectedHead });
    if (!evidence.before.ok) throw new Error(evidence.before.blocker);
    captureStart = capturedResponses.length;
    const reload = await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    if (reload?.status() !== 200 || page.url() !== scenarioUrl) throw new Error('MUSIC_CARD_ROUTE_MISMATCH');
    await page.locator('#listening-deck').waitFor({ state: 'attached', timeout: 10000 });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      snapshot = await page.evaluate(readMusicCardDom);
      if (inspectMusicCardSnapshot(snapshot).ok) break;
      await page.waitForTimeout(1000);
    }
    evidence.after = inspectMusicCardSnapshot(snapshot);
    evidence.sourceAfter = await bindSourceResponses(capturedResponses.slice(captureStart), { scenarioUrl, repoRoot, expectedHead });
    evidence.blocker = evidence.after.ok ? '' : evidence.after.blocker;
  } catch (error) {
    const code = String(error?.message || '');
    evidence.blocker = /^MUSIC_[A-Z_]+$/.test(code) ? code : 'MUSIC_CARD_BROWSER_EXECUTION_FAILED';
  } finally { await refs?.dispose?.(); }
  evidence.consoleErrorCount = consoleErrors.length;
  evidence.pageErrorCount = pageErrors.length;
  return Object.freeze(evidence);
}
