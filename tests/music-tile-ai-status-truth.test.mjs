import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync('apps/music-tile/main.js','utf8');

test('buildMusicAiStatusView exists and covers status cases', ()=>{
  assert.match(js,/function buildMusicAiStatusView/);
  ['not-tested','route-missing','payload-invalid','method-mismatch','backend-error','network-error','degraded','ready'].forEach((k)=>assert.match(js,new RegExp(k)));
});

test('diagnostics disclosure present', ()=> assert.match(js,/Show diagnostics/));
