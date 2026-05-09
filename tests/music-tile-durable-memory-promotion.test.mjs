import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync('apps/music-tile/index.html','utf8');

test('durable memory promotion controls exist', ()=>{
  assert.match(html,/Preview memory candidates/);
  assert.match(html,/Test durable memory bridge/);
  assert.match(html,/Promote selected/);
  assert.match(html,/Approval required/);
});
