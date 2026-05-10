import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('landing and app surfaces both reference MissionConsoleTile canon', () => {
  const app = readFileSync(new URL('../stephanos-ui/src/App.jsx', import.meta.url), 'utf8');
  const tile = readFileSync(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8');
  assert.match(app, /<MissionConsoleTile/);
  assert.match(tile, /<AIConsole/);
});
