import test from 'node:test';
import assert from 'node:assert/strict';

import { createUIRenderer, getPaneRect, rectsOverlap } from '../system/ui_renderer.js';
import { STEPHANOS_SESSION_MEMORY_STORAGE_KEY } from '../shared/runtime/stephanosSessionMemory.mjs';

test.afterEach(() => {
  delete globalThis.document;
  delete globalThis.localStorage;
  delete globalThis.innerWidth;
  delete globalThis.innerHeight;
  delete globalThis.addEventListener;
  delete globalThis.removeEventListener;
});

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

function createElement(tagName = 'div', ownerDocument = null) {
  const listeners = new Map();
  const classes = new Set();
  const node = {
    tagName,
    ownerDocument,
    id: '',
    dataset: {},
    style: {},
    children: [],
    parentNode: null,
    innerHTML: '',
    textContent: '',
    classList: {
      add(value) { classes.add(value); },
      remove(value) { classes.delete(value); },
      contains(value) { return classes.has(value); },
      toggle(value, enabled) {
        if (enabled === false) {
          classes.delete(value);
          return false;
        }
        if (enabled === true || !classes.has(value)) {
          classes.add(value);
          return true;
        }
        classes.delete(value);
        return false;
      },
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    insertBefore(child, referenceNode) {
      child.parentNode = this;
      const index = this.children.indexOf(referenceNode);
      if (index < 0) {
        this.children.push(child);
      } else {
        this.children.splice(index, 0, child);
      }
      return child;
    },
    addEventListener(type, handler) {
      const current = listeners.get(type) || [];
      current.push(handler);
      listeners.set(type, current);
    },
    dispatch(type, event = {}) {
      const handlers = listeners.get(type) || [];
      handlers.forEach((handler) => handler(event));
    },
    setAttribute(name, value) {
      this[name] = String(value);
    },
    querySelector(selector) {
      const targetClass = selector.startsWith('.') ? selector.slice(1) : null;
      if (!targetClass) {
        return null;
      }
      const queue = [...this.children];
      while (queue.length > 0) {
        const current = queue.shift();
        if (current.classList?.contains(targetClass)) {
          return current;
        }
        queue.push(...(current.children || []));
      }
      return null;
    },
    getBoundingClientRect() {
      return {
        left: Number.parseFloat(this.style.left) || 24,
        top: Number.parseFloat(this.style.top) || 60,
        width: Number.parseFloat(this.style.width) || 320,
        height: Number.parseFloat(this.style.height) || 280,
      };
    },
  };

  Object.defineProperty(node, 'className', {
    get() {
      return Array.from(classes).join(' ');
    },
    set(value) {
      classes.clear();
      String(value || '')
        .split(/\s+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => classes.add(entry));
    },
  });

  return node;
}

function createDocumentFixture() {
  const documentRef = {
    nodes: new Map(),
    body: null,
    documentElement: { clientWidth: 1100, clientHeight: 800 },
    createElement(tagName) {
      return createElement(tagName, documentRef);
    },
    getElementById(id) {
      return this.nodes.get(id) || null;
    },
  };

  const body = createElement('body', documentRef);
  documentRef.body = body;
  const layout = createElement('section', documentRef);
  layout.id = 'stephanos-layout';
  layout.parentNode = body;
  body.children.push(layout);
  documentRef.nodes.set('stephanos-layout', layout);
  documentRef.nodes.set('workspace', null);

  const originalAppend = body.appendChild.bind(body);
  body.appendChild = (child) => {
    if (child.id) {
      documentRef.nodes.set(child.id, child);
    }
    return originalAppend(child);
  };

  return documentRef;
}

function createSessionMemorySeed(uiLayout = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    updatedAt: '2026-03-27T00:00:00.000Z',
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

test('panel drag saves persisted coordinates in session memory', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed(),
  });
  const documentRef = createDocumentFixture();
  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 1100;
  globalThis.innerHeight = 800;

  const ui = createUIRenderer();
  const panel = ui.createPanel('drag-save-panel', 'Drag Save');
  const header = panel.querySelector('.stephanos-panel-header');

  header.dispatch('pointerdown', { button: 0, clientX: 120, clientY: 120, preventDefault() {}, target: { closest() { return null; } } });
  header.dispatch('pointermove', { clientX: 220, clientY: 260 });
  header.dispatch('pointerup', {});

  const memory = JSON.parse(storage.dump()[STEPHANOS_SESSION_MEMORY_STORAGE_KEY]);
  const savedPosition = memory.session.ui.uiLayout.panelPositions['drag-save-panel'];
  assert.equal(Number.isFinite(savedPosition.x), true);
  assert.equal(Number.isFinite(savedPosition.y), true);
});

test('panel restores collapsed state and clamps persisted coordinates', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed({
      panelPositions: {
        'task-monitor-panel': { x: 9000, y: 9000 },
      },
      panelCollapsed: {
        'task-monitor-panel': true,
      },
    }),
  });
  const documentRef = createDocumentFixture();
  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 900;
  globalThis.innerHeight = 640;

  const ui = createUIRenderer();
  const panel = ui.createPanel('task-monitor-panel', 'Task Monitor');

  assert.equal(panel.classList.contains('stephanos-panel-collapsed'), true);
  assert.ok(Number.parseFloat(panel.style.left) < 900);
  assert.ok(Number.parseFloat(panel.style.top) < 640);
});

test('resetPanelLayout clears collapsed state and rewrites default positions', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed(),
  });
  const documentRef = createDocumentFixture();
  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 900;

  const ui = createUIRenderer();
  const panel = ui.createPanel('command-console-panel', 'Debug Console');
  const knob = panel.querySelector('.stephanos-panel-knob');
  knob.dispatch('click', {});

  ui.resetPanelLayout();

  const memory = JSON.parse(storage.dump()[STEPHANOS_SESSION_MEMORY_STORAGE_KEY]);
  const collapsed = memory.session.ui.uiLayout.panelCollapsed['command-console-panel'];
  const position = memory.session.ui.uiLayout.panelPositions['command-console-panel'];
  assert.notEqual(collapsed, true);
  assert.equal(Number.isFinite(position.x), true);
  assert.equal(Number.isFinite(position.y), true);
});

test('build-proof panel participates in draggable persistent layout lifecycle', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed(),
  });
  const documentRef = createDocumentFixture();
  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 900;

  const ui = createUIRenderer();
  const panel = ui.createPanel('stephanos-build-panel', 'Build Proof');
  const header = panel.querySelector('.stephanos-panel-header');
  const knob = panel.querySelector('.stephanos-panel-knob');

  header.dispatch('pointerdown', { button: 0, clientX: 180, clientY: 180, preventDefault() {}, target: { closest() { return null; } } });
  header.dispatch('pointermove', { clientX: 420, clientY: 360 });
  header.dispatch('pointerup', {});
  knob.dispatch('click', {});
  ui.resetPanelLayout();

  const memory = JSON.parse(storage.dump()[STEPHANOS_SESSION_MEMORY_STORAGE_KEY]);
  const savedPosition = memory.session.ui.uiLayout.panelPositions['stephanos-build-panel'];
  const collapsed = memory.session.ui.uiLayout.panelCollapsed['stephanos-build-panel'];
  assert.equal(Number.isFinite(savedPosition.x), true);
  assert.equal(Number.isFinite(savedPosition.y), true);
  assert.notEqual(collapsed, true);
});

test('panel header tap without threshold movement does not commit drag position', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed(),
  });
  const documentRef = createDocumentFixture();
  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 900;

  const ui = createUIRenderer();
  const panel = ui.createPanel('service-inspector-panel', 'Service Inspector');
  const header = panel.querySelector('.stephanos-panel-header');

  header.dispatch('pointerdown', { button: 0, clientX: 120, clientY: 120, preventDefault() {}, target: { closest() { return null; } } });
  header.dispatch('pointermove', { clientX: 122, clientY: 122 });
  header.dispatch('pointerup', {});

  const memory = JSON.parse(storage.dump()[STEPHANOS_SESSION_MEMORY_STORAGE_KEY]);
  assert.equal(
    Object.prototype.hasOwnProperty.call(memory.session.ui.uiLayout.panelPositions || {}, 'service-inspector-panel'),
    false,
  );
});

test('createPanel normalizes pre-existing panel stack container to click-through overlay defaults', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed(),
  });
  const documentRef = createDocumentFixture();
  const existingContainer = createElement('div', documentRef);
  existingContainer.id = 'stephanos-panel-stack';
  existingContainer.style.display = 'block';
  existingContainer.style.position = 'relative';
  existingContainer.style.pointerEvents = 'auto';
  existingContainer.style.zIndex = '1';
  existingContainer.parentNode = documentRef.body;
  documentRef.body.children.push(existingContainer);
  documentRef.nodes.set('stephanos-panel-stack', existingContainer);

  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 900;

  const ui = createUIRenderer();
  ui.createPanel('stephanos-laws-panel', 'Laws');

  const panelStack = documentRef.body.children.find((child) => child.id === 'stephanos-panel-stack');
  assert.ok(panelStack);
  assert.equal(panelStack.style.position, 'fixed');
  assert.equal(panelStack.style.inset, '0');
  assert.equal(panelStack.style.pointerEvents, 'none');
  assert.equal(panelStack.style.zIndex, '4500');
});

test('createPanel re-hardens reused panel stack container on subsequent panel creation', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed(),
  });
  const documentRef = createDocumentFixture();
  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 900;

  const ui = createUIRenderer();
  ui.createPanel('stephanos-laws-panel', 'Laws');

  const panelStack = documentRef.body.children.find((child) => child.id === 'stephanos-panel-stack');
  assert.ok(panelStack);
  documentRef.nodes.set('stephanos-panel-stack', panelStack);
  panelStack.style.position = 'absolute';
  panelStack.style.pointerEvents = 'auto';
  panelStack.style.zIndex = '9999';
  panelStack.style.inset = 'auto';

  ui.createPanel('stephanos-build-panel', 'Build Proof');

  assert.equal(panelStack.style.position, 'fixed');
  assert.equal(panelStack.style.inset, '0');
  assert.equal(panelStack.style.pointerEvents, 'none');
  assert.equal(panelStack.style.zIndex, '4500');
});

test('createPanel preserves persisted closed visibility state for late panel registration', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed({
      'agent-console-panel': false,
    }),
  });
  const documentRef = createDocumentFixture();
  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 900;

  const ui = createUIRenderer();
  const panel = ui.createPanel('agent-console-panel', 'Agents Console');
  const panelStack = documentRef.body.children.find((child) => child.id === 'stephanos-panel-stack');

  assert.equal(panel.style.display, 'none');
  assert.equal(panelStack.style.display, 'none');
});


test('createPanel applies default closed visibility for Build Proof and Laws when no persisted state exists', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed(),
  });
  const documentRef = createDocumentFixture();
  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 900;

  const ui = createUIRenderer();
  const lawsPanel = ui.createPanel('stephanos-laws-panel', 'Laws of Stephanos');
  const buildPanel = ui.createPanel('stephanos-build-panel', 'Build Proof');
  const panelStack = documentRef.body.children.find((child) => child.id === 'stephanos-panel-stack');

  assert.equal(lawsPanel.style.display, 'none');
  assert.equal(buildPanel.style.display, 'none');
  assert.equal(panelStack.style.display, 'none');
});

test('createPanel preserves persisted false for Build Proof and Laws and does not reopen by default', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed({
      'stephanos-laws-panel': false,
      'stephanos-build-panel': false,
    }),
  });
  const documentRef = createDocumentFixture();
  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 900;

  const ui = createUIRenderer();
  const lawsPanel = ui.createPanel('stephanos-laws-panel', 'Laws of Stephanos');
  const buildPanel = ui.createPanel('stephanos-build-panel', 'Build Proof');
  const panelStack = documentRef.body.children.find((child) => child.id === 'stephanos-panel-stack');

  assert.equal(lawsPanel.style.display, 'none');
  assert.equal(buildPanel.style.display, 'none');
  assert.equal(panelStack.style.display, 'none');
});

test('createPanel applies default closed visibility for restorable panel with no persisted state', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed(),
  });
  const documentRef = createDocumentFixture();
  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 900;

  const ui = createUIRenderer();
  const panel = ui.createPanel('module-map-panel', 'Module Map');
  const panelStack = documentRef.body.children.find((child) => child.id === 'stephanos-panel-stack');

  assert.equal(panel.style.display, 'none');
  assert.equal(panelStack.style.display, 'none');
});

test('createPanel recovers malformed persisted visibility using safe default', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed({
      'task-monitor-panel': 'open',
    }),
  });
  const documentRef = createDocumentFixture();
  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 900;

  const ui = createUIRenderer();
  const panel = ui.createPanel('task-monitor-panel', 'Task Monitor');
  assert.equal(panel.style.display, 'none');
});

test('two panes restored to same position resolve to non-overlapping layout', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed({
      panelPositions: {
        'panel-a': { x: 100, y: 120 },
        'panel-b': { x: 100, y: 120 },
      },
    }),
  });
  const documentRef = createDocumentFixture();
  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 900;

  const ui = createUIRenderer();
  const panelA = ui.createPanel('panel-a', 'Panel A');
  const panelB = ui.createPanel('panel-b', 'Panel B');

  assert.equal(rectsOverlap(getPaneRect(panelA), getPaneRect(panelB), 12), false);
});

test('dragging pane over another resolves collision before persistence', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed(),
  });
  const documentRef = createDocumentFixture();
  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 900;

  const ui = createUIRenderer();
  const panelA = ui.createPanel('panel-collision-a', 'Panel A');
  const panelB = ui.createPanel('panel-collision-b', 'Panel B');
  const headerB = panelB.querySelector('.stephanos-panel-header');

  headerB.dispatch('pointerdown', { button: 0, clientX: 220, clientY: 220, preventDefault() {}, target: { closest() { return null; } } });
  headerB.dispatch('pointermove', { clientX: 40, clientY: 80 });
  headerB.dispatch('pointerup', {});

  const memory = JSON.parse(storage.dump()[STEPHANOS_SESSION_MEMORY_STORAGE_KEY]);
  assert.equal(rectsOverlap(getPaneRect(panelA), getPaneRect(panelB), 12), false);
  assert.deepEqual(memory.session.ui.uiLayout.panelPositions['panel-collision-b'], {
    x: Number.parseFloat(panelB.style.left),
    y: Number.parseFloat(panelB.style.top),
  });
});

test('collapsed panes still resolve to non-overlapping header footprints', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed({
      panelPositions: {
        'collapsed-a': { x: 80, y: 80 },
        'collapsed-b': { x: 80, y: 80 },
      },
      panelCollapsed: {
        'collapsed-a': true,
        'collapsed-b': true,
      },
    }),
  });
  const documentRef = createDocumentFixture();
  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 900;
  globalThis.innerHeight = 640;

  const ui = createUIRenderer();
  const panelA = ui.createPanel('collapsed-a', 'Collapsed A');
  const panelB = ui.createPanel('collapsed-b', 'Collapsed B');

  assert.equal(panelA.classList.contains('stephanos-panel-collapsed'), true);
  assert.equal(panelB.classList.contains('stephanos-panel-collapsed'), true);
  assert.equal(rectsOverlap(getPaneRect(panelA), getPaneRect(panelB), 12), false);
});

test('viewport resize clamps and resolves new collisions', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed({
      panelPositions: {
        'resize-a': { x: 760, y: 460 },
        'resize-b': { x: 760, y: 460 },
      },
    }),
  });
  const documentRef = createDocumentFixture();
  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 900;
  const listeners = {};
  globalThis.addEventListener = (event, handler) => { listeners[event] = handler; };
  globalThis.removeEventListener = () => {};

  const ui = createUIRenderer();
  const panelA = ui.createPanel('resize-a', 'Resize A');
  const panelB = ui.createPanel('resize-b', 'Resize B');
  globalThis.innerWidth = 900;
  globalThis.innerHeight = 700;
  listeners.resize?.();

  assert.equal(rectsOverlap(getPaneRect(panelA), getPaneRect(panelB), 12), false);
  assert.ok(Number.parseFloat(panelA.style.left) <= 900);
  assert.ok(Number.parseFloat(panelB.style.left) <= 900);
});

test('resetPanelLayout creates non-overlapping defaults for multiple panes', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed(),
  });
  const documentRef = createDocumentFixture();
  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 960;

  const ui = createUIRenderer();
  const panelA = ui.createPanel('reset-a', 'Reset A');
  const panelB = ui.createPanel('reset-b', 'Reset B');
  const panelC = ui.createPanel('reset-c', 'Reset C');
  ui.resetPanelLayout();

  assert.equal(rectsOverlap(getPaneRect(panelA), getPaneRect(panelB), 12), false);
  assert.equal(rectsOverlap(getPaneRect(panelB), getPaneRect(panelC), 12), false);
});

test('music tile pane IDs participate in shared collision plane', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed({
      panelPositions: {
        'music-tile-search-build-journey-pane': { x: 120, y: 120 },
        'music-tile-flow-now-playing-pane': { x: 120, y: 120 },
        'music-tile-results-journey-pane': { x: 120, y: 120 },
        'music-tile-debug-pane': { x: 120, y: 120 },
      },
    }),
  });
  const documentRef = createDocumentFixture();
  globalThis.document = documentRef;
  globalThis.localStorage = storage;
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 900;

  const ui = createUIRenderer();
  const searchPane = ui.createPanel('music-tile-search-build-journey-pane', 'Search');
  const flowPane = ui.createPanel('music-tile-flow-now-playing-pane', 'Flow');
  const resultsPane = ui.createPanel('music-tile-results-journey-pane', 'Results');
  const debugPane = ui.createPanel('music-tile-debug-pane', 'Debug');

  assert.equal(rectsOverlap(getPaneRect(searchPane), getPaneRect(flowPane), 12), false);
  assert.equal(rectsOverlap(getPaneRect(flowPane), getPaneRect(resultsPane), 12), false);
  assert.equal(rectsOverlap(getPaneRect(resultsPane), getPaneRect(debugPane), 12), false);
});
