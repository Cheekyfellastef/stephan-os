import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('Music tile emits presence events for key interactions', () => {
  assert.match(js, /music\.track_rated|kind: 'track_rated'/);
  assert.match(js, /kind: 'feedback_applied'/);
  assert.match(js, /kind: 'journey_built'/);
  assert.match(js, /kind: 'ai_route_unavailable'/);
  assert.match(js, /stephanos:presence-event/);
});
