import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSpotifyReference, buildSpotifySearchUrl, buildYouTubeSearchUrl } from '../apps/music-tile/utils/spotifyEmbed.js';

const js = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('spotify reference helper separates embed/open urls', () => {
  const trackUri = resolveSpotifyReference('spotify:track:abc123');
  assert.equal(trackUri.embedUrl, 'https://open.spotify.com/embed/track/abc123');
  assert.equal(trackUri.openUrl, 'https://open.spotify.com/track/abc123');

  const trackUrl = resolveSpotifyReference('https://open.spotify.com/track/abc123?si=test');
  assert.equal(trackUrl.embedUrl, 'https://open.spotify.com/embed/track/abc123');
  assert.equal(trackUrl.openUrl, 'https://open.spotify.com/track/abc123');
  assert.equal(trackUrl.openUrl.includes('/embed/track/'), false);
});

test('search URLs are encoded', () => {
  assert.equal(buildSpotifySearchUrl({ artist: 'Anyma', title: 'Pictures Of You' }), 'https://open.spotify.com/search/Anyma%20Pictures%20Of%20You');
  assert.equal(buildYouTubeSearchUrl({ artist: 'Anyma', title: 'Pictures Of You' }), 'https://www.youtube.com/results?search_query=Anyma%20Pictures%20Of%20You');
});

test('listening/discovery cards use open url for Open in Spotify and search fallback for Find', () => {
  assert.match(js, /getSpotifyLinkState\(track\)/);
  assert.match(js, /<iframe src="\$\{embed\}"/);
  assert.match(js, />Open in Spotify</);
  assert.match(js, /Needs verified Spotify link/);
  assert.match(js, />Find on Spotify</);
  assert.match(js, /Resolve Spotify Link/);
});

test('spotify search refs are rejected from open/embed card paths', () => {
  const resolved = resolveSpotifyReference('https://open.spotify.com/search/Anyma%20Pictures%20Of%20You');
  assert.equal(resolved.valid, false);
  assert.equal(resolved.embedUrl, null);
  assert.equal(resolved.openUrl, null);
});
