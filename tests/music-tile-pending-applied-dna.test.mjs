import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');

test('Pending and applied Taste DNA panels exist', () => {
  assert.match(html, /Pending Taste DNA Changes/);
  assert.match(html, /Recently Applied Taste DNA Changes/);
});
