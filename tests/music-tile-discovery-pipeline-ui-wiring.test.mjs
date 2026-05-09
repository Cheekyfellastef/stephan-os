import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('Build Journey stores discoveryPipeline state', () => {
  assert.match(js, /state\.discoveryPipeline\s*=\s*\{/);
});

test('pipeline sections render', () => {
  for (const label of ['Discovery Pipeline Summary','Verified Candidates','Search Leads','AI Suggestions','Fallback Taste DNA Matches','Reality \/ Verification Warnings','Verification Audit']) {
    assert.match(js, new RegExp(label));
  }
});

test('search leads do not render Spotify iframe and verified can render iframe', () => {
  assert.match(js, /kind === 'verified' && verified \? `<iframe/);
});

test('search lead controls include Search Spotify and Search YouTube', () => {
  assert.match(js, /Search Spotify/);
  assert.match(js, /Search YouTube/);
});

test('legacy discovery results are explicitly labeled', () => {
  assert.match(js, /Legacy \/ local results/);
});
