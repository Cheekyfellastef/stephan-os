import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('jump handler exists and is wired by stable data-action selector', () => {
  assert.match(js, /function jumpToDiscoveryPipeline\(\)/);
  assert.match(js, /data-action="jump-discovery-pipeline"/);
  assert.match(js, /querySelector\('\[data-action="jump-discovery-pipeline"\]'\)\?\.addEventListener\('click', jumpToDiscoveryPipeline\)/);
});

test('jump handles missing pipeline and missing target statuses', () => {
  assert.match(js, /No Discovery Pipeline yet\. Build a journey first\./);
  assert.match(js, /Discovery Pipeline section not found\./);
});

test('jump scrolls journey column scroller, applies highlight, and updates status', () => {
  assert.match(js, /closest\('#journey-col\.col'\)/);
  assert.match(js, /scroller\.scrollTo\(\{ top:/);
  assert.match(js, /target\.classList\.add\('music-highlight-pulse'\)/);
  assert.match(js, /setTimeout\(\(\) => target\.classList\.remove\('music-highlight-pulse'\), 1200\)/);
  assert.match(js, /Jumped to Discovery Pipeline\./);
});

test('jump handler survives renderAll because it is rebound in renderDiscoveryResults', () => {
  assert.match(js, /function renderDiscoveryResults\(/);
  assert.match(js, /addEventListener\('click', jumpToDiscoveryPipeline\)/);
});
