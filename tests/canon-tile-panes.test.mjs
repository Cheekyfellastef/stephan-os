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

function createClassList() {
  const values = new Set();
  return {
    add(...entries) {
      entries.forEach((entry) => values.add(entry));
    },
    remove(...entries) {
      entries.forEach((entry) => values.delete(entry));
    },
    contains(entry) {
      return values.has(entry);
    },
  };
}

function createMockSection(id) {
  const attributes = {};
  return {
    id,
    hidden: true,
    dataset: {},
    classList: createClassList(),
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    getAttribute(name) {
      return attributes[name];
    },
    querySelector(selector) {
      if (selector === 'h2') {
        return { textContent: 'Mock Pane' };
      }
      return null;
    },
    parentNode: null,
    closest() {
      return null;
    },
  };
}

test('mountPaneFromSection marks section as canon-mounted with host ownership', () => {
  const panelById = new Map();
  const section = createMockSection('music-controls-pane');
  const manager = createCanonTilePaneManager({
    appId: 'music-tile',
    uiRenderer: {
      createPanel(id) {
        const contentNodes = [];
        const panel = {
          id,
          dataset: {},
          classList: createClassList(),
          appendChild(node) {
            contentNodes.push(node);
            node.parentNode = panel;
            node.closest = () => ({ id });
          },
          contentNodes,
        };
        panelById.set(id, panel);
        return panel;
      },
      removePanel() {},
    },
    storage: createStorage(),
  });

  const panel = manager.mountPaneFromSection({
    paneId: 'search-build-journey-pane',
    section,
  });

  assert.ok(panel);
  assert.equal(section.hidden, false);
  assert.equal(section.classList.contains('panel'), false);
  assert.equal(section.classList.contains('canon-tile-pane-section'), true);
  assert.equal(section.getAttribute('data-canon-pane-mounted'), 'true');
  assert.equal(section.getAttribute('data-canon-pane-host'), 'music-tile-search-build-journey-pane');
  assert.equal(panelById.get('music-tile-search-build-journey-pane').contentNodes.length, 1);
});

test('mountPaneFromSection prevents duplicate mounting for same section and pane id', () => {
  const panelById = new Map();
  const section = createMockSection('music-results-pane');
  const manager = createCanonTilePaneManager({
    appId: 'music-tile',
    uiRenderer: {
      createPanel(id) {
        const panel = {
          id,
          dataset: {},
          classList: createClassList(),
          appendChild() {},
        };
        panelById.set(id, panel);
        return panel;
      },
      removePanel() {},
    },
    storage: createStorage(),
  });

  const originalDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      return panelById.get(id) || null;
    },
  };

  const first = manager.mountPaneFromSection({
    paneId: 'results-journey-pane',
    section,
  });
  const duplicateBySection = manager.mountPaneFromSection({
    paneId: 'results-journey-pane-dup',
    section,
  });
  const duplicateByPaneId = manager.mountPaneFromSection({
    paneId: 'results-journey-pane',
    section: createMockSection('music-results-pane-2'),
  });

  assert.ok(first);
  assert.equal(duplicateBySection?.id, 'music-tile-results-journey-pane');
  assert.equal(duplicateByPaneId?.id, 'music-tile-results-journey-pane');
  globalThis.document = originalDocument;
});

test('mountPaneFromSection prevents section from mounting into multiple pane hosts', () => {
  const panelById = new Map();
  const section = createMockSection('music-command-pane');
  section.setAttribute('data-canon-pane-mounted', 'true');
  section.setAttribute('data-canon-pane-host', 'music-tile-flow-now-playing-pane');

  const manager = createCanonTilePaneManager({
    appId: 'music-tile',
    uiRenderer: {
      createPanel(id) {
        const panel = {
          id,
          dataset: {},
          classList: createClassList(),
          appendChild() {},
        };
        panelById.set(id, panel);
        return panel;
      },
      removePanel() {},
    },
    storage: createStorage(),
  });

  const existingHostPanel = { id: 'music-tile-flow-now-playing-pane' };
  const originalDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      if (id === 'music-tile-flow-now-playing-pane') return existingHostPanel;
      return panelById.get(id) || null;
    },
  };

  const duplicateHostAttempt = manager.mountPaneFromSection({
    paneId: 'command-console-pane',
    section,
  });

  assert.equal(duplicateHostAttempt, existingHostPanel);
  assert.equal(panelById.size, 0);
  globalThis.document = originalDocument;
});
