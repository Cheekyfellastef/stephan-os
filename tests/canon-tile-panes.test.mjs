import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearCanonTilePaneLayout,
  createCanonTilePaneManager,
  toCanonTilePaneDomId,
} from '../shared/runtime/canonTilePanes.mjs';
import { STEPHANOS_SESSION_MEMORY_STORAGE_KEY } from '../shared/runtime/stephanosSessionMemory.mjs';

function createStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
    dump() {
      return { ...data };
    },
  };
}

function createSessionMemorySeed(uiLayout = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    updatedAt: '2026-04-01T00:00:00.000Z',
    session: {
      providerPreferences: {
        provider: 'mock',
        routeMode: 'auto',
        devMode: true,
        fallbackEnabled: true,
        disableHomeNodeForLocalSession: false,
        fallbackOrder: ['mock', 'groq', 'gemini', 'ollama'],
        providerConfigs: { groq: {}, gemini: {}, mock: {}, ollama: {}, openrouter: {} },
        ollamaConnection: {},
      },
      ui: {
        activeWorkspace: 'mission-console',
        activeSubview: 'assistant',
        recentRoute: 'assistant',
        uiLayout,
      },
      homeNodePreference: null,
    },
    working: {},
    project: {},
  });
}

test('canon tile pane IDs are namespaced and DOM-safe', () => {
  assert.equal(toCanonTilePaneDomId('music-tile', 'journey-pane'), 'music-tile-journey-pane');
  assert.equal(toCanonTilePaneDomId('Music Tile', 'Flow / Now Playing'), 'music-tile-flow-now-playing');
});

test('clearCanonTilePaneLayout removes only app pane layout keys', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed({
      panelPositions: {
        'music-tile-search-build-journey-pane': { x: 44, y: 66 },
        'music-tile-results-journey-pane': { x: 120, y: 80 },
        'other-app-main-pane': { x: 20, y: 30 },
      },
      panelCollapsed: {
        'music-tile-search-build-journey-pane': true,
        'other-app-main-pane': false,
      },
    }),
  });

  clearCanonTilePaneLayout({
    appId: 'music-tile',
    paneIds: ['search-build-journey-pane', 'results-journey-pane'],
    storage,
  });

  const nextMemory = JSON.parse(storage.dump()[STEPHANOS_SESSION_MEMORY_STORAGE_KEY]);
  assert.equal(nextMemory.session.ui.uiLayout.panelPositions['music-tile-search-build-journey-pane'], undefined);
  assert.equal(nextMemory.session.ui.uiLayout.panelPositions['music-tile-results-journey-pane'], undefined);
  assert.deepEqual(nextMemory.session.ui.uiLayout.panelPositions['other-app-main-pane'], { x: 20, y: 30 });
  assert.equal(nextMemory.session.ui.uiLayout.panelCollapsed['music-tile-search-build-journey-pane'], undefined);
  assert.equal(nextMemory.session.ui.uiLayout.panelCollapsed['other-app-main-pane'], false);
});

test('canon tile pane manager resolves app-scoped pane IDs', () => {
  const manager = createCanonTilePaneManager({
    appId: 'music-tile',
    uiRenderer: {
      createPanel(id) {
        return {
          id,
          dataset: {},
          classList: { add() {} },
          appendChild() {},
        };
      },
      removePanel() {},
    },
    storage: createStorage(),
  });

  assert.equal(manager.toPaneDomId('debug-pane'), 'music-tile-debug-pane');
});
