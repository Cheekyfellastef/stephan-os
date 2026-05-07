import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const musicMainSource = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
const sharedPaneCssSource = readFileSync(new URL('../shared/styles/stephanos-panels.css', import.meta.url), 'utf8');

test('music tile drag/scroll behavior follows canonical stephanos pane contract', () => {
  assert.match(musicMainSource, /createCanonTilePaneManager\(\{ appId: 'music-tile', layoutMode: 'freeform' \}\)/);
  assert.match(sharedPaneCssSource, /\.stephanos-panel-header\s*\{[\s\S]*touch-action:\s*none;/);
  assert.match(sharedPaneCssSource, /\.stephanos-panel-content\s*\{[\s\S]*overflow-y:\s*auto;/);
});
