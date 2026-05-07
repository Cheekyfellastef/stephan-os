import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveMusicTileLaunchTargetForTest } from '../modules/command-deck/command-deck.js';
import { workspace, resetWorkspaceRuntimeDebugState, getWorkspaceRuntimeDebugState } from '../system/workspace.js';

function makeNode() {
  return {
    style: {}, dataset: {}, classList: { add() {} }, setAttribute() {}, appendChild() {},
    innerHTML: '', textContent: '',
  };
}

test('music launch target resolves to canonical spotify-first workspace entry', () => {
  assert.equal(resolveMusicTileLaunchTargetForTest({ id: 'music', entry: 'apps/music/index.html' }), 'apps/music-tile/index.html');
  assert.equal(resolveMusicTileLaunchTargetForTest({ id: 'music-tile', entry: 'apps/music-tile/index.html' }), 'apps/music-tile/index.html');
});

test('workspace open canonicalizes music aliases to one active music app key', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;

  const nodes = {
    workspace: makeNode(),
    'workspace-content': makeNode(),
    projects: makeNode(),
    'workspace-title': makeNode(),
    'stephanos-layout': makeNode(),
    'dev-console': makeNode(),
  };
  nodes['dev-console'].closest = () => null;

  globalThis.document = {
    body: { classList: { add() {}, remove() {} } },
    getElementById(id) { return nodes[id] || null; },
    createElement(tag) { return { ...makeNode(), tagName: tag, addEventListener() {}, remove() {}, setAttribute() {} }; },
  };
  globalThis.window = { location: { href: 'http://localhost/' }, setTimeout: () => 0, clearTimeout: () => {} };
  globalThis.fetch = async () => ({ ok: true, status: 200 });

  resetWorkspaceRuntimeDebugState();
  await workspace.open({ id: 'music', folder: 'music', name: 'Music', entry: 'apps/music/index.html' }, { eventBus: { emit() {} } });
  const state = getWorkspaceRuntimeDebugState();

  assert.equal(state.activeProjectKey, 'music-tile');

  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  globalThis.fetch = originalFetch;
});
