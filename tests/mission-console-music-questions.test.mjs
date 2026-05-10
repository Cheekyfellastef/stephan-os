import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Mission Console includes music-aware question routing hints and local fallback status', () => {
  const source = readFileSync(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8');
  assert.match(source, /music tile|taste dna|spotify|verified|search leads|hallucinated/i);
  assert.match(source, /Quick Chat Context Selector/);
  assert.match(source, /Music Tile/);
});
