import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8');

test('mission console exposes music context selector and unavailable context fallback message', () => {
  assert.match(source, /<option value="music">Music Tile<\/option>/);
  assert.match(source, /Music Tile context unavailable\. Open Music Tile or rebuild context\./);
});
