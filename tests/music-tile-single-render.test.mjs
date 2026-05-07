import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const musicMainSource = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
const musicHtmlSource = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');
const tasteCockpitSource = readFileSync(new URL('../apps/music-tile/ui/tasteCockpitView.js', import.meta.url), 'utf8');

test('music tile defines one canonical startup entry and singleton guard', () => {
  assert.equal((musicMainSource.match(/function initialize\(\)/g) || []).length, 1);
  assert.equal((musicMainSource.match(/initialize\(\);/g) || []).length, 1);
  assert.match(musicMainSource, /const MUSIC_TILE_SINGLETON_KEY = '__STEPHANOS_MUSIC_TILE_CANON_STARTUP__';/);
  assert.match(musicMainSource, /startupState\.count > 1[\s\S]*Duplicate startup prevented/);
  assert.match(musicMainSource, /querySelectorAll\('#music-tile-root'\)\.length/);
});

test('music tile startup mounts panes before rendering taste cockpit', () => {
  const initializeBody = musicMainSource.match(/function initialize\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  const layoutIndex = initializeBody.indexOf('initializePaneLayout();');
  const cockpitIndex = initializeBody.indexOf('renderTasteCockpit();');
  const bindIndex = initializeBody.indexOf('bindControls();');
  assert.ok(layoutIndex >= 0, 'initializePaneLayout call missing');
  assert.ok(cockpitIndex > layoutIndex, 'renderTasteCockpit should run after pane mount');
  assert.ok(bindIndex > cockpitIndex, 'bindControls should run after initial cockpit render');
});

test('music tile html includes one canonical workspace root and one pane each for cockpit and journey', () => {
  assert.equal((musicHtmlSource.match(/id="music-tile-root"/g) || []).length, 1);
  assert.equal((musicHtmlSource.match(/id="music-taste-cockpit-pane"/g) || []).length, 1);
  assert.equal((musicHtmlSource.match(/id="music-results-pane"/g) || []).length, 1);
});

test('taste cockpit markup builder returns seeded non-empty list structure', () => {
  assert.match(tasteCockpitSource, /function buildTasteCockpitMarkup\(/);
  assert.match(tasteCockpitSource, /Array\.isArray\(tracks\) \? tracks : \[\]\)\.map/);
  assert.match(tasteCockpitSource, /taste-track-card/);
});
