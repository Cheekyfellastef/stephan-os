import test from 'node:test';
import assert from 'node:assert/strict';

import { createUIRenderer } from '../system/ui_renderer.js';
import { STEPHANOS_SESSION_MEMORY_STORAGE_KEY } from '../shared/runtime/stephanosSessionMemory.mjs';

test.afterEach(() => {
  delete globalThis.document;
  delete globalThis.localStorage;
  delete globalThis.innerWidth;
  delete globalThis.innerHeight;
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
  const panel = ui.createPanel('agent-console-panel', 'Agents Console');
  const header = panel.querySelector('.stephanos-panel-header');

  header.dispatch('pointerdown', { button: 0, clientX: 120, clientY: 120, preventDefault() {}, target: { closest() { return null; } } });
  header.dispatch('pointermove', { clientX: 220, clientY: 260 });
  header.dispatch('pointerup', {});

  const memory = JSON.parse(storage.dump()[STEPHANOS_SESSION_MEMORY_STORAGE_KEY]);
  const savedPosition = memory.session.ui.uiLayout.panelPositions['agent-console-panel'];
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
