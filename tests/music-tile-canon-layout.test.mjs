import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const musicMainSource = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
const musicCssSource = readFileSync(new URL('../apps/music-tile/style.css', import.meta.url), 'utf8');
const sharedPaneCssSource = readFileSync(new URL('../shared/styles/stephanos-panels.css', import.meta.url), 'utf8');
const musicHtmlSource = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');
const canonTilePaneSource = readFileSync(new URL('../shared/runtime/canonTilePanes.mjs', import.meta.url), 'utf8');

test('music tile enters canon pane mode and mounts one pane plane for major sections', () => {
  assert.match(musicMainSource, /elements\.root\.classList\.add\('music-tile--canon-panes'\)/);
  assert.match(musicMainSource, /const tilePaneManager = createCanonTilePaneManager\(\{ appId: 'music-tile', layoutMode: 'freeform' \}\)/);
  assert.match(musicHtmlSource, /id="music-title-pane"/);
  assert.match(musicMainSource, /title:\s*'Stephanos Music Journey'/);
  assert.match(musicMainSource, /title:\s*'Search \/ Build Journey'/);
  assert.match(musicMainSource, /title:\s*'Taste Cockpit'/);
  assert.match(musicMainSource, /title:\s*'Session Summary'/);
  assert.match(musicMainSource, /title:\s*'Flow \/ Now Playing'/);
  assert.match(musicMainSource, /title:\s*'Command Console'/);
  assert.match(musicMainSource, /title:\s*'Results \/ Journey'/);
  assert.match(musicMainSource, /title:\s*'Debug'/);
  assert.ok((musicMainSource.match(/paneId:\s*'search-build-pane'/g) || []).length >= 1);
  assert.ok((musicMainSource.match(/paneId:\s*'taste-cockpit-pane'/g) || []).length >= 1);
  assert.ok((musicMainSource.match(/paneId:\s*'session-summary-pane'/g) || []).length >= 1);
  assert.ok((musicMainSource.match(/paneId:\s*'flow-now-playing-pane'/g) || []).length >= 1);
  assert.ok((musicMainSource.match(/paneId:\s*'command-console-pane'/g) || []).length >= 1);
  assert.ok((musicMainSource.match(/paneId:\s*'journey-pane'/g) || []).length >= 1);
  assert.ok((musicMainSource.match(/paneId:\s*'debug-pane'/g) || []).length >= 1);
});

test('music tile includes canon layout reset action that does not re-enable old grid flow', () => {
  assert.match(musicMainSource, /elements\.resetLayout\.addEventListener\('click', \(\) => \{/);
  assert.match(musicMainSource, /tilePaneManager\.resetLayout\(\)/);
  assert.match(musicMainSource, /tilePaneManager\.applyDefaultPaneLayout\(MUSIC_TILE_DEFAULT_PANE_LAYOUT\)/);
  assert.match(musicMainSource, /elements\.resetLayoutStatus\.textContent = 'Pane layout reset\.'/);
  assert.doesNotMatch(musicMainSource, /elements\.resetLayout\.addEventListener\('click',[\s\S]*resetMusicTileState\(/);
  assert.doesNotMatch(musicMainSource, /elements\.resetLayout\.addEventListener\('click',[\s\S]*state\.memory\s*=\s*null/);
  assert.match(musicHtmlSource, /id="reset-layout-btn"[^>]*>Reset pane layout</);
  assert.match(musicHtmlSource, /id="reset-layout-status"/);
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
  assert.match(musicMainSource, /tilePaneManager\.mountPaneFromSection\(\{\s*paneId:\s*'journey-pane'[\s\S]*section:\s*elements\.resultsPane,\s*panelClassName:\s*'music-tile-pane',\s*\}\);/);
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


test('music tile seeds canonical default desktop pane positions in preferred order', () => {
  assert.match(musicMainSource, /const MUSIC_TILE_DEFAULT_PANE_LAYOUT = \[/);
  assert.match(musicMainSource, /\{ paneId: 'taste-cockpit-pane', x: 760, y: 20, width: 480, height: 520 \}/);
  assert.match(musicMainSource, /\{ paneId: 'search-build-pane', x: 448, y: 72 \}/);
  assert.match(musicMainSource, /\{ paneId: 'session-summary-pane', x: 872, y: 72 \}/);
  assert.match(musicMainSource, /\{ paneId: 'journey-pane', x: 24, y: 388 \}/);
  assert.match(musicMainSource, /\{ paneId: 'flow-now-playing-pane', x: 448, y: 388 \}/);
  assert.match(musicMainSource, /\{ paneId: 'debug-pane', x: 872, y: 388 \}/);
  assert.match(musicMainSource, /\{ paneId: 'command-console-pane', x: 448, y: 612 \}/);
});

test('shared canon grid-slot mode compacts collapsed panels and keeps internal scroll behavior', () => {
  assert.match(sharedPaneCssSource, /#stephanos-panel-stack\.stephanos-panel-stack-grid-slot\s*\{[\s\S]*display:\s*grid;/);
  assert.match(sharedPaneCssSource, /#stephanos-panel-stack\.stephanos-panel-stack-grid-slot\s*\{[\s\S]*align-content:\s*start;/);
  assert.match(sharedPaneCssSource, /\.stephanos-panel\.stephanos-panel-collapsed\s*\{[\s\S]*max-height:\s*56px;/);
  assert.match(sharedPaneCssSource, /\.stephanos-panel-content\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow-y:\s*auto;/);
  assert.match(sharedPaneCssSource, /#stephanos-panel-stack\.stephanos-panel-stack-grid-slot \.stephanos-panel \.stephanos-panel-header\s*\{[\s\S]*cursor:\s*default;[\s\S]*touch-action:\s*auto;/);
});

test('freeform pane layout keeps canonical drag behavior intact for music panels', () => {
  assert.doesNotMatch(musicMainSource, /layoutMode:\s*'grid-slot'/);
  assert.match(musicMainSource, /layoutMode:\s*'freeform'/);
});

test('music tile hides duplicate bottom command-deck return control', () => {
  assert.match(musicCssSource, /body \[data-command-deck-return-control='bottom'\]\s*\{\s*display:\s*none !important;/);
});
