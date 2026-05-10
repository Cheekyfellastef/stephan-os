import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const missionConsoleSource = readFileSync(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../stephanos-ui/src/App.jsx', import.meta.url), 'utf8');

test('mission console does not import false canonical pane stack components', () => {
  assert.doesNotMatch(missionConsoleSource, /CanonicalPaneStack/);
  assert.doesNotMatch(appSource, /CanonicalPaneStack/);
});

test('app-level Stephanos pane system remains pane canon for mission console', () => {
  assert.match(appSource, /StephanosSurfacePane/);
  assert.match(appSource, /loadPaneOrder/);
  assert.match(appSource, /savePaneOrder/);
  assert.match(appSource, /reconcilePaneOrder/);
  assert.match(appSource, /resolvePaneCollapsedState/);
  assert.match(appSource, /setPaneOrder/);
});
