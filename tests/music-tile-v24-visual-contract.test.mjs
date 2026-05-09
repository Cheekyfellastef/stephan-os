import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const css = fs.readFileSync('apps/music-tile/style.css','utf8');

test('v2.4 music visual classes exist', ()=>{
  ['music-card','music-card-header','music-badge--spotify','music-badge--warning','music-chip--positive','music-empty-state','music-diagnostics'].forEach((c)=>assert.match(css,new RegExp('\\.'+c.replace('--','\\-\\-'))));
});
