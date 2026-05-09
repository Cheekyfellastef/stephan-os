import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync('apps/music-tile/index.html','utf8');

test('memory truth sections separated', ()=>{
  assert.match(html,/memory-local-status/);
  assert.match(html,/memory-durable-status/);
  assert.match(html,/memory-ai-status/);
  assert.doesNotMatch(html,/network error/i);
});
