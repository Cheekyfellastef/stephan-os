import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Mission Console renders connected music context card and ask action', () => {
  const source = readFileSync(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8');
  assert.match(source, /Connected Tile Contexts/);
  assert.match(source, /Ask about Music Tile/);
  assert.match(source, /buildMissionConsoleContext/);
});
