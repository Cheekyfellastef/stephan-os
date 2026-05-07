import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const musicMainSource = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
const musicHtmlSource = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../system/workspace.js', import.meta.url), 'utf8');

function bodyOf(fnName) {
  return musicMainSource.match(new RegExp(`function ${fnName}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] || '';
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

test('initialize follows canonical mount → hydrate → pane render → cockpit render → ready order', () => {
  const init = bodyOf('initialize');
  assert.ok(init.indexOf('initializePaneLayout();') >= 0);
  assert.ok(init.indexOf('const persisted = await loadMusicTileState();') > init.indexOf('initializePaneLayout();'));
  assert.ok(init.indexOf('renderSummary();') > init.indexOf('const persisted = await loadMusicTileState();'));
  assert.ok(init.indexOf('renderQueue();') > init.indexOf('renderSummary();'));
  assert.ok(init.indexOf('renderPlaybackPanel();') > init.indexOf('renderQueue();'));
  assert.ok(init.indexOf('renderDebug();') > init.indexOf('renderPlaybackPanel();'));
  assert.ok(init.indexOf('renderTasteCockpit();') > init.indexOf('renderDebug();'));
  assert.ok(init.indexOf('finalizeWorkspaceReadyIfComplete();') > init.indexOf('renderTasteCockpit();'));
});

test('post-hydration render functions are container-scoped and never replace root', () => {
  ['renderSummary', 'renderQueue', 'renderPlaybackPanel', 'renderDebug'].forEach((fnName) => {
    const body = bodyOf(fnName);
    assert.doesNotMatch(body, /elements\.root\.innerHTML\s*=/);
    assert.doesNotMatch(body, /elements\.root\.replaceChildren\(/);
  });
  assert.match(musicMainSource, /elements\.summary\.innerHTML\s*=/);
  assert.match(musicMainSource, /elements\.queue\.innerHTML\s*=/);
  assert.match(musicMainSource, /elements\.debugOutput\.textContent\s*=/);
});

test('workspace readiness and scaffold gating remain explicit', () => {
  assert.match(musicMainSource, /function setWorkspaceReady\(/);
  assert.match(musicMainSource, /workspaceReady/);
  assert.match(musicHtmlSource, /data-workspace-ready="false"/);
  assert.match(musicHtmlSource, /data-music-scaffold="true"/);
});
