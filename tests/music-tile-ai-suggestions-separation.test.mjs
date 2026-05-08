import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');

test('AI Suggestions section is separate from Discovery Results', () => {
  assert.match(html, /AI Suggestions/);
  assert.match(html, /Discovery Results/);
  assert.match(html, /id="ai-suggestions-list"/);
  assert.match(html, /id="discovery-results-list"/);
});
