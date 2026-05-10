import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('Music Tile Resolve Link shows Assisted Setup option when Spotify not configured', () => {
  assert.match(js, /Spotify catalogue search is not configured\. Stephanos can help set it up\./);
  assert.match(html, /Assisted Setup/);
});

test('Assisted Setup UI shows missing/present secret state wiring', () => {
  assert.match(js, /SPOTIFY_CLIENT_ID: \$\{spotify.requiredSecretPresence\?\.SPOTIFY_CLIENT_ID \? 'present' : 'missing'\}/);
  assert.match(js, /SPOTIFY_CLIENT_SECRET: \$\{spotify.requiredSecretPresence\?\.SPOTIFY_CLIENT_SECRET \? 'present' : 'missing'\}/);
});
