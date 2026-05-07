import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const musicMainSource = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
const musicHtmlSource = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../system/workspace.js', import.meta.url), 'utf8');

function bodyOf(fnName) {
  return musicMainSource.match(new RegExp(`function ${fnName}\\(\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] || '';
}

test('music tile render sequence instrumentation markers are present', () => {
  assert.match(musicMainSource, /main\.js script evaluated/);
  assert.match(musicMainSource, /initialize start/);
  assert.match(musicMainSource, /pane manager mount start/);
  assert.match(musicMainSource, /pane manager mount end/);
  assert.match(musicMainSource, /renderTasteCockpit start/);
  assert.match(musicMainSource, /renderTasteCockpit end/);
  assert.match(musicMainSource, /root visibility snapshot \$\{delayMs\}ms/);
  assert.match(workspaceSource, /\[music-tile\]\[sequence\] iframe load event/);
});

test('only one canonical top-level music screen marker is defined', () => {
  assert.equal((musicHtmlSource.match(/data-music-screen="spotify-taste-cockpit"/g) || []).length, 1);
  assert.equal((musicHtmlSource.match(/data-music-screen="legacy-music"/g) || []).length, 0);
});

test('initialize mounts panes before rendering cockpit and does not replace root html', () => {
  const init = bodyOf('initialize');
  assert.ok(init.indexOf('initializePaneLayout();') >= 0);
  assert.ok(init.indexOf('renderTasteCockpit();') > init.indexOf('initializePaneLayout();'));
  const afterRender = init.slice(init.indexOf('renderTasteCockpit();'));
  assert.doesNotMatch(afterRender, /elements\.root\.innerHTML\s*=/);
  assert.doesNotMatch(afterRender, /replaceChildren\(/);
});

test('taste cockpit content and rating controls remain in canonical markup source', () => {
  assert.match(musicMainSource, /taste-track-card/);
  assert.match(musicMainSource, /renderTasteCards/);
  assert.match(musicMainSource, /renderTasteCockpit\(\)/);
});
