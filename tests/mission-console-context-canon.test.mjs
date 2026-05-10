import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('mission console tile keeps context registry and music context integration', () => {
  const source = readFileSync(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8');
  assert.match(source, /registerTileMissionContext\('music'/);
  assert.match(source, /buildMissionConsoleContext/);
});
