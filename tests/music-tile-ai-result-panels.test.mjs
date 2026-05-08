import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('AI result panel markup includes title/status/body/actions', () => {
  assert.match(js, /ai-result-panel/);
  assert.match(js, /ai-result-header/);
  assert.match(js, /ai-result-body/);
  assert.match(js, /ai-result-actions/);
});

test('Structured and text fallback panel classes are distinct', () => {
  assert.match(js, /ai-result-panel--structured/);
  assert.match(js, /ai-result-panel--text/);
});
