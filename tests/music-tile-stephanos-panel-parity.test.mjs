import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const musicMainSource = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
const musicCssSource = readFileSync(new URL('../apps/music-tile/style.css', import.meta.url), 'utf8');
const sharedPaneCssSource = readFileSync(new URL('../shared/styles/stephanos-panels.css', import.meta.url), 'utf8');

test('music tile reuses stephanos canonical panel collapse/chevron/scroll contracts', () => {
  assert.match(sharedPaneCssSource, /\.stephanos-canon-rotating-chevron-button \.chevron/);
  assert.match(sharedPaneCssSource, /\.stephanos-panel-content\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow-y:\s*auto;/);
  assert.match(musicMainSource, /mountPaneFromSection\([\s\S]*paneId:\s*'taste-cockpit-pane'/);
  assert.match(musicMainSource, /mountPaneFromSection\([\s\S]*paneId:\s*'journey-pane'/);
  assert.match(musicMainSource, /mountPaneFromSection\([\s\S]*paneId:\s*'debug-pane'/);
  assert.match(musicCssSource, /\.music-tile-pane\s*\{\s*min-width:\s*0;[\s\S]*max-width:\s*100%;/);
});
