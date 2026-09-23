import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  chooseYouTubeTrackCandidate,
  createYouTubePublicTrackResolver,
  parseYouTubeSearchHtml,
  scoreYouTubeTrackCandidate,
} from '../stephanos-server/services/youtubePublicTrackResolver.js';
import {
  canonicalYouTubeWatchUrl,
  hasExactYouTubeTrack,
  trustedYouTubeArtworkUrl,
} from '../apps/music-tile/engine/automaticMediaOverlay.js';
import { runCatalogLinkContinuityPass } from '../apps/music-tile/engine/nativeCatalogLinkContinuity.js';

const VIDEO_ID = 'abc12345678';
const COVER_ID = 'zzz12345678';
const FAN_ID = 'fan12345678';

function youtubeSearchHtml() {
  return `<html><script>var ytInitialData = ${JSON.stringify({
    contents: [{
      videoRenderer: {
        videoId: COVER_ID,
        title: { runs: [{ text: 'Anyma - Pictures Of You cover' }] },
        ownerText: { runs: [{ text: 'Bedroom Covers' }] },
      },
    }, {
      videoRenderer: {
        videoId: FAN_ID,
        title: { runs: [{ text: 'Anyma - Pictures Of You (Official Video)' }] },
        ownerText: { runs: [{ text: 'Anyma Archive' }] },
      },
    }, {
      videoRenderer: {
        videoId: VIDEO_ID,
        title: { runs: [{ text: 'Anyma - Pictures Of You (Official Video)' }] },
        ownerText: { runs: [{ text: 'Anyma' }] },
        ownerBadges: [{ metadataBadgeRenderer: {
          style: 'BADGE_STYLE_TYPE_VERIFIED_ARTIST',
          label: 'Official Artist Channel',
          tooltip: 'Official Artist Channel',
        } }],
      },
    }],
  })};</script></html>`;
}

function storageWithTrack(track) {
  const values = new Map([
    ['stephanos.musicTile.dashboardState.v1', JSON.stringify({ listeningDeck: [track] })],
  ]);
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test('public YouTube parser requires authoritative channel evidence and rejects cover or fan-upload noise', () => {
  const candidates = parseYouTubeSearchHtml(youtubeSearchHtml());
  assert.equal(candidates.length, 3);
  assert.equal(scoreYouTubeTrackCandidate({ artist: 'Anyma', title: 'Pictures Of You' }, candidates[0]), 0);
  assert.equal(scoreYouTubeTrackCandidate({ artist: 'Anyma', title: 'Pictures Of You' }, candidates[1]), 0);
  assert.equal(candidates[2].officialArtistChannel, true);
  assert.deepEqual(candidates[2].authorityEvidence, ['official-artist-channel']);
  const chosen = chooseYouTubeTrackCandidate({ artist: 'Anyma', title: 'Pictures Of You' }, candidates);
  assert.equal(chosen.videoId, VIDEO_ID);
  assert.equal(chosen.youtubeUrl, `https://www.youtube.com/watch?v=${VIDEO_ID}`);
  assert.equal(chosen.artworkUrl, `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`);
});

test('YouTube Topic channels count as authoritative catalogue evidence', () => {
  const candidate = {
    videoId: VIDEO_ID,
    title: 'Pictures Of You',
    channel: 'Anyma - Topic',
    youtubeUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    artworkUrl: trustedYouTubeArtworkUrl(VIDEO_ID),
  };
  assert.ok(scoreYouTubeTrackCandidate({ artist: 'Anyma', title: 'Pictures Of You' }, candidate) > 0);
});

test('bounded YouTube resolver returns a canonical exact video and trusted artwork without an API key', async () => {
  let seenUrl = '';
  const resolve = createYouTubePublicTrackResolver({
    fetchImpl: async (url) => {
      seenUrl = String(url);
      return { ok: true, status: 200, text: async () => youtubeSearchHtml() };
    },
    timeoutMs: 100,
  });
  const result = await resolve({ artist: 'Anyma', title: 'Pictures Of You' });
  assert.equal(result.ok, true);
  assert.match(seenUrl, /^https:\/\/www\.youtube\.com\/results\?/);
  assert.equal(result.result.youtubeVideoId, VIDEO_ID);
  assert.equal(result.result.youtubeUrl, `https://www.youtube.com/watch?v=${VIDEO_ID}`);
  assert.equal(result.result.artworkUrl, trustedYouTubeArtworkUrl(VIDEO_ID));
  assert.equal(result.result.verificationStatus, 'metadata_verified');
  assert.deepEqual(result.result.authorityEvidence, ['official-artist-channel']);
});

test('automatic card continuity falls through from metadata-only catalogue truth to exact YouTube', async () => {
  const track = { id: 'pictures-of-you', artist: 'Anyma', title: 'Pictures Of You' };
  const storage = storageWithTrack(track);
  const calls = [];
  const applied = [];
  const fetchImpl = async (url) => {
    const requestUrl = String(url);
    calls.push(requestUrl);
    if (requestUrl.startsWith('/api/music/catalog/search')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          provider: 'musicbrainz',
          results: [{
            provider: 'musicbrainz',
            providerLabel: 'MusicBrainz',
            providerItemId: 'f1d2d2f9-0000-4000-8000-000000000001',
            providerUrl: 'https://musicbrainz.org/recording/f1d2d2f9-0000-4000-8000-000000000001',
            title: 'Pictures Of You',
            artist: 'Anyma',
            verificationStatus: 'metadata_verified',
            playbackAvailability: 'search_only',
            spotifyUrl: '',
            spotifyUri: '',
          }],
        }),
      };
    }
    if (requestUrl.startsWith('/api/music/youtube/resolve-track')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            provider: 'youtube',
            providerLabel: 'YouTube',
            providerItemId: VIDEO_ID,
            providerUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
            youtubeVideoId: VIDEO_ID,
            youtubeUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
            artworkUrl: trustedYouTubeArtworkUrl(VIDEO_ID),
            authorityEvidence: ['official-artist-channel'],
            verificationStatus: 'metadata_verified',
          },
        }),
      };
    }
    throw new Error(`unexpected request ${requestUrl}`);
  };

  const result = await runCatalogLinkContinuityPass({
    storage,
    fetchImpl,
    applyEnrichment: () => ({ ok: false, changed: false, reason: 'spotify-track-unavailable' }),
    applyYouTubeEnrichment: (detail) => {
      applied.push(detail);
      const snapshot = JSON.parse(storage.getItem('stephanos.musicTile.dashboardState.v1'));
      snapshot.listeningDeck[0].youtubeUrl = detail.youtubeUrl;
      storage.setItem('stephanos.musicTile.dashboardState.v1', JSON.stringify(snapshot));
      return { ok: true, changed: true };
    },
    timeoutMs: 100,
    retryDelays: [0, 0, 0],
    now: 1000,
  });

  assert.equal(result.resolvedCount, 1);
  assert.equal(result.pendingRetryCount, 0);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].youtubeUrl, `https://www.youtube.com/watch?v=${VIDEO_ID}`);
  assert.equal(calls.some((url) => url.startsWith('/api/music/catalog/search')), true);
  assert.equal(calls.some((url) => url.startsWith('/api/music/youtube/resolve-track')), true);
  const persisted = JSON.parse(storage.getItem('stephanos.musicTile.dashboardState.v1')).listeningDeck[0];
  assert.equal(hasExactYouTubeTrack(persisted), true);
  assert.equal(canonicalYouTubeWatchUrl(persisted.youtubeUrl), `https://www.youtube.com/watch?v=${VIDEO_ID}`);
});

test('automatic overlay is wired through the existing Save YouTube state handler and removes manual Find controls after proof', async () => {
  const source = await readFile(new URL('../apps/music-tile/engine/automaticMediaOverlay.js', import.meta.url), 'utf8');
  const continuity = await readFile(new URL('../apps/music-tile/engine/nativeCatalogLinkContinuity.js', import.meta.url), 'utf8');
  const artwork = await readFile(new URL('../apps/music-tile/engine/catalogArtworkContinuity.js', import.meta.url), 'utf8');
  assert.match(source, /findAction\(root, 'save-youtube-link'/);
  assert.match(source, /saveButton\.click\(\)/);
  assert.match(source, /Find on \(Spotify\|YouTube\)/);
  assert.match(source, /YouTube track verified automatically/);
  assert.match(continuity, /\/api\/music\/youtube\/resolve-track/);
  assert.match(continuity, /applyYouTubeMediaResolutionToBrowser/);
  assert.match(artwork, /hydrateAutomaticMediaOverlay/);
});
