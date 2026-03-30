import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSystemPanelStateController,
  installDraggablePanel,
  readSystemPanelPopupState,
  writeSystemPanelPopupState,
} from '../modules/system-panel/system-panel.js';
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
    updatedAt: '2026-03-27T00:00:00.000Z',
    session: {
      providerPreferences: {
        provider: 'mock',
        routeMode: 'auto',
        devMode: true,
        fallbackEnabled: true,
        disableHomeNodeForLocalSession: false,
        fallbackOrder: ['mock', 'groq', 'gemini', 'ollama'],
        providerConfigs: {
          groq: {}, gemini: {}, mock: {}, ollama: {}, openrouter: {},
        },
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


test('system panel controller uses shared toggle registry with current module toggles', () => {
  const controller = createSystemPanelStateController({
    setPanelState() {},
    applySurfaceVisibility() {},
    setRealitySyncEnabled() {},
    storage: createStorage({
      [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed(),
    }),
  });

  const toggleIds = controller.toggleDefinitions.map((entry) => entry.id);
  assert.equal(toggleIds.includes('self-healing-panel'), true);
  assert.equal(toggleIds.includes('app-installer-panel'), true);
  assert.equal(toggleIds.includes('runtime-diagnostics'), true);
});

test('system panel controller toggles runtime surfaces immediately', () => {
  const calls = [];
  const controller = createSystemPanelStateController({
    setPanelState(panelId, enabled) {
      calls.push({ panelId, enabled, type: 'panel' });
    },
    applySurfaceVisibility(payload) {
      calls.push({ ...payload, type: 'surface' });
    },
    setRealitySyncEnabled(enabled) {
      calls.push({ enabled, type: 'reality-sync' });
    },
    storage: createStorage({
      [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed(),
    }),
  });

  controller.setToggleState('runtime-diagnostics', true);
  controller.setToggleState('launcher-fingerprint', true);
  controller.setToggleState('truth-panel', true);
  controller.setToggleState('reality-sync', true);
  controller.setToggleState('stephanos-laws-panel', false);
  controller.setToggleState('agent-console-panel', true);

  assert.equal(calls.filter((entry) => entry.type === 'surface').length, 3);
  assert.deepEqual(calls.find((entry) => entry.type === 'reality-sync'), { enabled: true, type: 'reality-sync' });
  assert.deepEqual(calls.at(-1), { panelId: 'agent-console-panel', enabled: true, type: 'panel' });
});

test('system panel controller restores persisted toggle preferences', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed({
      runtimeDiagnosticsVisible: true,
      launcherRuntimeFingerprintVisible: true,
      truthPanelVisible: false,
      realitySyncEnabled: false,
      'stephanos-laws-panel': false,
      'stephanos-build-panel': true,
      'agent-console-panel': true,
    }),
  });

  const controller = createSystemPanelStateController({
    setPanelState() {},
    applySurfaceVisibility() {},
    setRealitySyncEnabled() {},
    storage,
  });

  assert.equal(controller.getToggleState('runtime-diagnostics'), true);
  assert.equal(controller.getToggleState('launcher-fingerprint'), true);
  assert.equal(controller.getToggleState('truth-panel'), false);
  assert.equal(controller.getToggleState('reality-sync'), false);
  assert.equal(controller.getToggleState('stephanos-laws-panel'), false);
  assert.equal(controller.getToggleState('stephanos-build-panel'), true);
  assert.equal(controller.getToggleState('agent-console-panel'), true);

  controller.setToggleState('truth-panel', true);
  controller.setToggleState('reality-sync', true);
  controller.setToggleState('stephanos-build-panel', false);
  const restored = JSON.parse(storage.dump()[STEPHANOS_SESSION_MEMORY_STORAGE_KEY]);
  assert.equal(restored.session.ui.uiLayout.truthPanelVisible, true);
  assert.equal(restored.session.ui.uiLayout.realitySyncEnabled, true);
  assert.equal(restored.session.ui.uiLayout['stephanos-build-panel'], false);
});

test('system panel drag start normalizes transform-centered coordinates before offset math', () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    innerWidth: 500,
    innerHeight: 500,
  };

  try {
    const listeners = new Map();
    const handle = {
      addEventListener(type, fn) {
        listeners.set(type, fn);
      },
      setPointerCapture() {},
    };

    const panel = {
      style: {
        left: '',
        top: '',
        transform: 'translate(-50%, -50%)',
      },
      querySelector(selector) {
        if (selector === '.drag-handle') {
          return handle;
        }
        return null;
      },
      classList: {
        add() {},
        remove() {},
      },
      getBoundingClientRect() {
        const width = 140;
        const height = 120;
        if (this.style.transform !== 'none') {
          return {
            left: 400,
            top: 320,
            width,
            height,
          };
        }
        return {
          left: Number.parseFloat(this.style.left) || 0,
          top: Number.parseFloat(this.style.top) || 0,
          width,
          height,
        };
      },
    };

    installDraggablePanel(panel, '.drag-handle');

    listeners.get('pointerdown')({
      button: 0,
      clientX: 430,
      clientY: 350,
      target: { closest: () => null },
      pointerId: 7,
      preventDefault() {},
    });

    assert.equal(panel.style.transform, 'none');
    assert.equal(panel.style.left, '352px');
    assert.equal(panel.style.top, '320px');

    listeners.get('pointermove')({
      clientX: 430,
      clientY: 350,
    });

    assert.equal(panel.style.left, '352px');
    assert.equal(panel.style.top, '320px');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('system panel popup state persists with shared session ui layout contract', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed(),
  });

  const defaults = readSystemPanelPopupState(storage);
  assert.equal(defaults.state.visible, false);
  assert.equal(defaults.state.collapsed, false);
  assert.equal(defaults.source, 'defaults');

  writeSystemPanelPopupState(
    {
      visible: true,
      collapsed: true,
      position: { x: 312, y: 144 },
    },
    storage,
  );

  const restored = readSystemPanelPopupState(storage);
  assert.equal(restored.state.visible, true);
  assert.equal(restored.state.collapsed, true);
  assert.deepEqual(restored.state.position, { x: 312, y: 144 });

  const memory = JSON.parse(storage.dump()[STEPHANOS_SESSION_MEMORY_STORAGE_KEY]);
  assert.equal(memory.session.ui.uiLayout['stephanos-system-panel'], true);
  assert.equal(memory.session.ui.uiLayout['stephanos-system-panel:collapsed'], true);
  assert.deepEqual(memory.session.ui.uiLayout.panelPositions['stephanos-system-panel'], {
    x: 312,
    y: 144,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(memory.session.ui.uiLayout, 'systemPanelPopup'), false);
});

test('system panel popup state migrates legacy key without losing valid state', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed({
      systemPanelPopupState: {
        visible: true,
        collapsed: false,
        position: { x: 410, y: 255 },
      },
    }),
  });

  const restore = readSystemPanelPopupState(storage);
  assert.equal(restore.source, 'systemPanelPopupState');
  assert.equal(restore.migrated, true);
  assert.deepEqual(restore.state, {
    visible: true,
    collapsed: false,
    position: { x: 410, y: 255 },
  });

  const memory = JSON.parse(storage.dump()[STEPHANOS_SESSION_MEMORY_STORAGE_KEY]);
  assert.equal(memory.session.ui.uiLayout['stephanos-system-panel'], true);
  assert.equal(memory.session.ui.uiLayout['stephanos-system-panel:collapsed'], false);
  assert.deepEqual(memory.session.ui.uiLayout.panelPositions['stephanos-system-panel'], { x: 410, y: 255 });
  assert.equal(Object.prototype.hasOwnProperty.call(memory.session.ui.uiLayout, 'systemPanelPopupState'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(memory.session.ui.uiLayout, 'systemPanelPopup'), false);
});

test('system panel popup state restores from canonical workspace visibility keys', () => {
  const storage = createStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: createSessionMemorySeed({
      'stephanos-system-panel': false,
      'stephanos-system-panel:collapsed': true,
      panelPositions: {
        'stephanos-system-panel': { x: 222, y: 188 },
      },
    }),
  });

  const restore = readSystemPanelPopupState(storage);
  assert.equal(restore.source, 'stephanos-system-panel');
  assert.equal(restore.migrated, false);
  assert.deepEqual(restore.state, {
    visible: false,
    collapsed: true,
    position: { x: 222, y: 188 },
  });
});

test('system panel drag commit callback receives persisted bounded position', () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    innerWidth: 700,
    innerHeight: 540,
  };

  try {
    const listeners = new Map();
    const commits = [];
    const handle = {
      addEventListener(type, fn) {
        listeners.set(type, fn);
      },
      setPointerCapture() {},
    };

    const panel = {
      style: {
        left: '',
        top: '',
        transform: 'none',
      },
      querySelector(selector) {
        if (selector === '.drag-handle') {
          return handle;
        }
        return null;
      },
      classList: {
        add() {},
        remove() {},
      },
      getBoundingClientRect() {
        const width = 160;
        const height = 120;
        return {
          left: Number.parseFloat(this.style.left) || 40,
          top: Number.parseFloat(this.style.top) || 40,
          width,
          height,
        };
      },
    };

    installDraggablePanel(panel, '.drag-handle', {
      onPositionCommit(position) {
        commits.push(position);
      },
    });

    listeners.get('pointerdown')({
      button: 0,
      clientX: 60,
      clientY: 60,
      target: { closest: () => null },
      pointerId: 1,
      preventDefault() {},
    });
    listeners.get('pointermove')({
      clientX: 280,
      clientY: 220,
    });
    listeners.get('pointerup')({});

    assert.equal(commits.length, 1);
    assert.equal(Number.isFinite(commits[0].x), true);
    assert.equal(Number.isFinite(commits[0].y), true);
  } finally {
    globalThis.window = originalWindow;
  }
});
