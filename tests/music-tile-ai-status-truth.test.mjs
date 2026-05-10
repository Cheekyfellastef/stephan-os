import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('200 transport-ready with unknown provider is not route unavailable wording', () => {
  assert.match(js, /statusKind = providerUnknown \? 'degraded' : 'ready'/);
  assert.match(js, /AI transport ready\. Provider details unavailable in this tile\./);
  assert.doesNotMatch(js, /AI route unavailable\. Provider metadata unavailable\./);
});

test('provider metadata unknown is shown as informational and text-fallback remains compatible', () => {
  assert.match(js, /provider_metadata_unavailable · info/);
  assert.match(js, /responseMode === 'text-fallback'/);
  assert.match(js, /Text fallback mode active\./);
});

test('provider metadata unknown does not block AI actions or force ai_route_unavailable on 200', () => {
  assert.match(js, /if \(result\.ok\) \{/);
  assert.match(js, /music\.ai_transport_ready/);
  assert.match(js, /if \(!res\.ok\)/);
});
