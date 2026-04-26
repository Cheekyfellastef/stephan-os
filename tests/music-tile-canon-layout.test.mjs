import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const musicMainSource = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
const musicCssSource = readFileSync(new URL('../apps/music-tile/style.css', import.meta.url), 'utf8');
const sharedPaneCssSource = readFileSync(new URL('../shared/styles/stephanos-panels.css', import.meta.url), 'utf8');
const musicHtmlSource = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');

test('music tile enters canon pane mode and mounts one pane plane for major sections', () => {
  assert.match(musicMainSource, /elements\.root\.classList\.add\('music-tile--canon-panes'\)/);
  assert.match(musicMainSource, /const tilePaneManager = createCanonTilePaneManager\(\{ appId: 'music-tile' \}\)/);
  assert.match(musicHtmlSource, /id="music-title-pane"/);
  assert.match(musicMainSource, /title:\s*'Stephanos Music Journey'/);
  assert.match(musicMainSource, /title:\s*'Search \/ Build Journey'/);
  assert.match(musicMainSource, /title:\s*'Session Summary'/);
  assert.match(musicMainSource, /title:\s*'Flow \/ Now Playing'/);
  assert.match(musicMainSource, /title:\s*'Command Console'/);
  assert.match(musicMainSource, /title:\s*'Results \/ Journey'/);
  assert.match(musicMainSource, /title:\s*'Debug'/);
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
  assert.match(musicCssSource, /html,\s*body\s*\{\s*min-height:\s*100%;\s*overflow-y:\s*auto;/);
  assert.match(musicCssSource, /\.music-tile\s*\{\s*min-height:\s*100vh;[\s\S]*overflow-y:\s*auto;/);
  assert.match(musicCssSource, /\.music-tile\.music-tile--canon-panes\s*\{\s*display:\s*block;\s*min-height:\s*100vh;/);
  assert.match(musicCssSource, /\.music-tile\.music-tile--canon-panes > \.panel\s*\{\s*display:\s*none;/);
  assert.match(musicCssSource, /\.music-tile\.music-tile--canon-panes > \.panel\[data-canon-pane-mounted='true'\]\s*\{\s*display:\s*none;/);
  assert.match(musicCssSource, /\.stephanos-panel-content > \.canon-tile-pane-section\s*\{\s*display:\s*block;/);
  assert.match(musicCssSource, /\.stephanos-panel-content > \.canon-tile-pane-section\.panel\s*\{\s*grid-column:\s*auto !important;/);
});

test('music tile canon CSS enforces pane content containment and command console wrapping', () => {
  assert.match(musicCssSource, /@import\s+url\('\.\.\/\.\.\/shared\/styles\/stephanos-panels\.css'\);/);
  assert.match(sharedPaneCssSource, /\.stephanos-panel\s*\{[\s\S]*display:\s*flex;[\s\S]*max-height:\s*calc\(100vh - 32px\);[\s\S]*overflow:\s*hidden;/);
  assert.match(sharedPaneCssSource, /\.stephanos-panel-header\s*\{[\s\S]*flex:\s*0 0 auto;[\s\S]*touch-action:\s*none;/);
  assert.match(sharedPaneCssSource, /\.stephanos-panel-content\s*\{\s*flex:\s*1 1 auto;[\s\S]*min-height:\s*0;[\s\S]*overflow-y:\s*auto;[\s\S]*overflow-x:\s*hidden;[\s\S]*overscroll-behavior:\s*contain;[\s\S]*-webkit-overflow-scrolling:\s*touch;/);
  assert.match(sharedPaneCssSource, /\.stephanos-panel-content,\s*\.stephanos-panel-content \*\s*\{\s*touch-action:\s*auto;/);
  assert.match(musicCssSource, /\.stephanos-panel-content \*,\s*\.canon-tile-pane-section \*\s*\{\s*max-width:\s*100%;/);
  assert.match(musicCssSource, /\.canon-tile-pane-section\s*\{[\s\S]*min-width:\s*0;[\s\S]*overflow-wrap:\s*anywhere;/);
  assert.match(musicCssSource, /\.stephanos-panel-content > \.canon-tile-pane-section\s*\{\s*display:\s*block;/);
  assert.match(musicCssSource, /\.stephanos-panel-content > \.canon-tile-pane-section\.panel\s*\{\s*grid-column:\s*auto !important;/);
  assert.match(musicCssSource, /\.command-row\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-wrap:\s*wrap;/);
  assert.match(musicCssSource, /#command-output\s*\{\s*overflow-wrap:\s*anywhere;/);
});

test('music tile pane scroll contract preserves header drag and scrollable body boundaries', () => {
  assert.match(sharedPaneCssSource, /\.stephanos-panel\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*overflow:\s*hidden;/);
  assert.match(sharedPaneCssSource, /\.stephanos-panel-header\s*\{[\s\S]*touch-action:\s*none;/);
  assert.match(sharedPaneCssSource, /\.stephanos-panel-content\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*overflow-x:\s*hidden;/);
  assert.match(sharedPaneCssSource, /\.stephanos-panel-content,\s*\.stephanos-panel-content \*\s*\{\s*touch-action:\s*auto;/);
  assert.match(musicMainSource, /tilePaneManager\.mountPaneFromSection\(\{\s*paneId:\s*'results-journey-pane'[\s\S]*section:\s*elements\.resultsPane,\s*panelClassName:\s*'music-tile-pane',\s*\}\);/);
  assert.match(musicMainSource, /tilePaneManager\.mountPaneFromSection\(\{\s*paneId:\s*'debug-pane'[\s\S]*section:\s*elements\.debugPanel,\s*panelClassName:\s*'music-tile-pane music-tile-pane-debug',\s*\}\);/);
});

test('music tile header banner reserves full text block and wraps safely', () => {
  assert.match(musicCssSource, /#music-title-pane\s*\{[\s\S]*max-width:\s*calc\(100vw - 44px\);[\s\S]*overflow:\s*visible;/);
  assert.match(musicCssSource, /#music-title-pane p,\s*#music-title-pane h1\s*\{[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*max-width:\s*100%;/);
});

test('music tile debug pane is canon-mounted and hidden by default until explicitly toggled', () => {
  assert.match(musicHtmlSource, /<section class=\"panel debug-panel\" id=\"debug-panel\" hidden>/);
  assert.match(musicMainSource, /tilePaneManager\.mountPaneFromSection\(\{\s*paneId:\s*'debug-pane'[\s\S]*section:\s*elements\.debugPanel,/);
  assert.match(musicMainSource, /function setDebugPaneVisibility\(isVisible\)[\s\S]*tilePaneManager\.setPaneVisible\('debug-pane', state\.debugVisible\);/);
  assert.match(musicMainSource, /setDebugPaneVisibility\(state\.debugVisible\);/);
});
