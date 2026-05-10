import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');

test('discovery controls are wired directly to fixed cockpit controls', () => {
  assert.match(source, /function wireEvents\(\) \{[\s\S]*buildBtn\?\.addEventListener\('click', buildJourney\);[\s\S]*startBtn\?\.addEventListener\('click', startJourney\);/);
  assert.match(source, /const ui = \{[\s\S]*buildBtn: document\.getElementById\('build-journey-btn'\),[\s\S]*startBtn: document\.getElementById\('start-journey-btn'\),/);
});

test('build/start handlers read artist input and enforce visible empty-input status', () => {
  assert.match(source, /const artists = parseArtists\(ui\.artistInput\?\.value \|\| ''\);/);
  assert.match(source, /Enter an artist to build a journey\./);
  assert.match(source, /Building journey for: \$\{term\}/);
  assert.match(source, /Starting journey for: \$\{term\}\./);
});

test('discovery controls expose queue and media actions from fixed cockpit cards', () => {
  assert.match(source, /Add to listening queue/);
  assert.match(source, /Needs verified Spotify link/);
  assert.match(source, /Find on Spotify/);
  assert.match(source, /Resolve Spotify Link/);
  assert.match(source, /Open in Spotify/);
  assert.match(source, /const youtubeLabel = youtubeUrl \? 'Open in YouTube' : 'Find on YouTube';/);
});

test('fixed cockpit status surface exists and obsolete pane-era debug controls are not required', () => {
  assert.match(html, /id="status-text"/);
  assert.doesNotMatch(html, /id="discovery-status"/);
  assert.doesNotMatch(html, /id="discovery-debug-status"/);
});
