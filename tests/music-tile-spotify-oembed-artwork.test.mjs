import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { canUseVerifiedSpotifyArtwork } from '../apps/music-tile/engine/catalogArtworkContinuity.js';

import {
  createSpotifyOembedArtworkResolver,
  trustedSpotifyOembedArtwork,
} from '../stephanos-server/services/spotifyOembedArtwork.js';

const TRACK_ID = '4uLU6hMCjMI75M1A2tKUQC';
const IMAGE = 'https://i.scdn.co/image/ab67616d00001e02ccdd';

test('public Spotify oEmbed artwork resolves a canonical exact-track URL without any account keys', async () => {
  const requests = [];
  const resolve = createSpotifyOembedArtworkResolver({
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        json: async () => ({
          provider_name: 'Spotify',
          thumbnail_url: IMAGE,
          title: 'Enjoy the Silence',
        }),
      };
    },
  });
  const first = await resolve(TRACK_ID);
  const again = await resolve(TRACK_ID);
  assert.deepEqual(first, {
    ok: true,
    trackId: TRACK_ID,
    artworkUrl: IMAGE,
    source: 'spotify-oembed',
  });
  assert.deepEqual(again, first);
  assert.equal(requests.length, 1, 'cached exact track must avoid duplicate provider traffic');
  const request = new URL(requests[0].url);
  assert.equal(request.origin, 'https://open.spotify.com');
  assert.equal(request.pathname, '/oembed');
  assert.equal(request.searchParams.get('url'), `https://open.spotify.com/track/${TRACK_ID}`);
});

test('oEmbed rejects malformed IDs, untrusted artwork, and unverified provider claims', async () => {
  let calls = 0;
  const resolver = createSpotifyOembedArtworkResolver({
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({ provider_name: 'Not Spotify', thumbnail_url: IMAGE }),
      };
    },
  });
  assert.equal((await resolver('https://example.com/foo')).reason, 'spotify-track-id-invalid');
  assert.equal(calls, 0);
  assert.equal((await resolver(TRACK_ID)).reason, 'spotify-oembed-artwork-unverified');
  assert.equal(trustedSpotifyOembedArtwork('https://i.scdn.co.evil.org/art'), '');
  assert.equal(trustedSpotifyOembedArtwork('http://i.scdn.co/art'), '');
  assert.equal(trustedSpotifyOembedArtwork(IMAGE), IMAGE);
});

test('unverified, not-found and hallucinated candidates cannot hydrate Spotify artwork', () => {
  const basic = { id: 'one', title: 'Enjoy the Silence', artist: 'Depeche Mode', spotifyUrl: `https://open.spotify.com/track/${TRACK_ID}` };
  assert.equal(canUseVerifiedSpotifyArtwork({ ...basic, candidateVerificationStatus: 'verified' }), true);
  assert.equal(canUseVerifiedSpotifyArtwork({ ...basic, aiSuggested: true, candidateVerificationStatus: 'unverified' }), false);
  assert.equal(canUseVerifiedSpotifyArtwork({ ...basic, candidateVerificationStatus: 'not-found' }), false);
  assert.equal(canUseVerifiedSpotifyArtwork({ ...basic, candidateVerificationStatus: 'likely-hallucinated' }), false);
  const verifiedCatalog = {
    catalogProvider: 'spotify',
    catalogProviderItemId: TRACK_ID,
    catalogLinkSource: 'native-catalog-search',
    catalogVerificationStatus: 'metadata_verified',
    candidateVerificationStatus: 'search-only',
  };
  assert.equal(canUseVerifiedSpotifyArtwork({ ...basic, ...verifiedCatalog, sourceKind: 'journey-candidate' }), true,
    'automatically enriched journey tracks must show the exact matched album artwork');
  assert.equal(canUseVerifiedSpotifyArtwork({ ...basic, ...verifiedCatalog, sourceKind: 'native-catalog' }), true);
  assert.equal(canUseVerifiedSpotifyArtwork({ ...basic, ...verifiedCatalog, catalogProviderItemId: 'wrong-id' }), false,
    'an unrelated Spotify recording can never lend artwork');
  assert.equal(canUseVerifiedSpotifyArtwork({ ...basic, ...verifiedCatalog, catalogLinkSource: '' }), false,
    'unproven catalogue identity cannot lend artwork');
  assert.equal(canUseVerifiedSpotifyArtwork({ ...basic, ...verifiedCatalog, candidateVerificationStatus: 'likely-hallucinated' }), false);
  assert.equal(canUseVerifiedSpotifyArtwork({ ...basic, ...verifiedCatalog, candidateVerificationStatus: 'not-found' }), false);
});

test('Music source preserves playback-bearing DOM and hides redundant search links for resolved cards', async () => {
  const main = await readFile(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
  const continuity = await readFile(new URL('../apps/music-tile/engine/catalogArtworkContinuity.js', import.meta.url), 'utf8');
  const route = await readFile(new URL('../stephanos-server/routes/music.js', import.meta.url), 'utf8');
  assert.match(main, /hasDirectMediaLink = Boolean\(spotifyOpenUrl \|\| youtubeUrl\)/);
  assert.match(main, /!hasDirectMediaLink \? `<a class="media-btn spotify"/);
  assert.match(main, /!hasDirectMediaLink \? `<a class="media-btn youtube"/);
  assert.match(main, /youtubeAction = youtubeUrl \?/);
  assert.match(continuity, /spotifyOembedArtwork\.v1/);
  assert.match(continuity, /spotifyTrackId\(current\.spotifyUrl \|\| current\.spotifyUri \|\| ''\) !== spotifyId/);
  assert.match(continuity, /hydrateCatalogArtworkContinuity\(\{ storage, root \}\)/);
  assert.match(continuity, /canUseVerifiedSpotifyArtwork\(current\)/);
  assert.match(main, /blockedSpotifyIdentity/);
  assert.match(main, /hasValidatedCatalogLink = hasVerifiedCatalogSpotifyTrack\(track\)/);
  assert.doesNotMatch(continuity, /\.innerHTML\s*=/);
  assert.match(route, /router\.get\('\/spotify\/oembed-artwork'/);
  assert.match(route, /\^\[A-Za-z0-9\]\{22\}\$/);
});
