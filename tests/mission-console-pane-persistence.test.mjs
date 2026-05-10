import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const missionConsoleSource = readFileSync(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../stephanos-ui/src/App.jsx', import.meta.url), 'utf8');

test('mission console does not create mission-only pane persistence namespace', () => {
  assert.doesNotMatch(missionConsoleSource, /CanonicalPaneStack/);
  assert.doesNotMatch(missionConsoleSource, /STORAGE_KEY_PREFIX/);
  assert.doesNotMatch(missionConsoleSource, /scope\s*=\s*['"]mission-console['"]/);
});

test('pane persistence source of truth remains shared app utilities', () => {
  assert.match(appSource, /STEPHANOS_TILE_PANE_ORDER_STORAGE_KEY/);
  assert.match(appSource, /loadPaneOrder\(/);
  assert.match(appSource, /savePaneOrder\(/);
});
