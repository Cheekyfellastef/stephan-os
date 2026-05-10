import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('Resolve Spotify Link calls backend search route.', () => {
  assert.match(source, /\/api\/music\/spotify\/search/);
});

test('missing backend config shows catalog-not-configured message.', () => {
  assert.match(source, /Spotify catalog search not configured/);
});

test('Use this track saves canonical spotifyUrl\/spotifyUri.', () => {
  assert.match(source, /track\.spotifyUrl = parsed\.openUrl/);
  assert.match(source, /track\.spotifyUri = parsed\.uri/);
});

test('low confidence does not auto-save.', () => {
  assert.match(source, /window\.confirm\(/);
});

test('no results shows no-match fallback.', () => {
  assert.match(source, /No Spotify match found/);
});

test('search URLs are never saved as playable refs.', () => {
  assert.match(source, /Spotify search link, not a playable track link/);
});
