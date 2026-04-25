import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const musicMainSource = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
const musicCssSource = readFileSync(new URL('../apps/music-tile/style.css', import.meta.url), 'utf8');
const musicHtmlSource = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');

test('music tile enters canon pane mode and mounts one pane plane for major sections', () => {
  assert.match(musicMainSource, /elements\.root\.classList\.add\('music-tile--canon-panes'\)/);
  assert.match(musicMainSource, /const tilePaneManager = createCanonTilePaneManager\(\{ appId: 'music-tile' \}\)/);
  assert.equal((musicMainSource.match(/paneId:\s*'search-build-journey-pane'/g) || []).length, 1);
  assert.equal((musicMainSource.match(/paneId:\s*'session-summary-pane'/g) || []).length, 1);
  assert.equal((musicMainSource.match(/paneId:\s*'flow-now-playing-pane'/g) || []).length, 1);
  assert.equal((musicMainSource.match(/paneId:\s*'command-console-pane'/g) || []).length, 1);
  assert.equal((musicMainSource.match(/paneId:\s*'results-journey-pane'/g) || []).length, 1);
  assert.equal((musicMainSource.match(/paneId:\s*'debug-pane'/g) || []).length, 1);
});

test('music tile includes canon layout reset action that does not re-enable old grid flow', () => {
  assert.match(musicMainSource, /elements\.resetLayout\.addEventListener\('click', \(\) => \{/);
  assert.match(musicMainSource, /tilePaneManager\.resetLayout\(\)/);
  assert.match(musicHtmlSource, /id="reset-layout-btn"/);
});

test('music tile canon CSS neutralizes legacy grid panel flow when canon mode is active', () => {
  assert.match(musicCssSource, /\.music-tile\.music-tile--canon-panes\s*\{\s*display:\s*block;\s*min-height:\s*100vh;/);
  assert.match(musicCssSource, /\.music-tile\.music-tile--canon-panes > \.panel:not\(\.music-shell-static\)\s*\{\s*display:\s*none;/);
  assert.match(musicCssSource, /\.music-tile\.music-tile--canon-panes > \.panel\[data-canon-pane-mounted='true'\]\s*\{\s*display:\s*none;/);
  assert.match(musicCssSource, /\.stephanos-panel-content > \.canon-tile-pane-section\s*\{\s*display:\s*block;/);
  assert.match(musicCssSource, /\.stephanos-panel-content > \.canon-tile-pane-section\.panel\s*\{\s*grid-column:\s*auto !important;/);
});

test('music tile debug pane is canon-mounted and hidden by default until explicitly toggled', () => {
  assert.match(musicHtmlSource, /<section class=\"panel debug-panel\" id=\"debug-panel\" hidden>/);
  assert.match(musicMainSource, /tilePaneManager\.mountPaneFromSection\(\{\s*paneId:\s*'debug-pane'[\s\S]*section:\s*elements\.debugPanel,/);
  assert.match(musicMainSource, /function setDebugPaneVisibility\(isVisible\)[\s\S]*tilePaneManager\.setPaneVisible\('debug-pane', state\.debugVisible\);/);
  assert.match(musicMainSource, /setDebugPaneVisibility\(state\.debugVisible\);/);
});
