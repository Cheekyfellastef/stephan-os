import test from 'node:test';
import assert from 'node:assert/strict';

import { createSystemPanelStateController } from '../modules/system-panel/system-panel.js';
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
  assert.equal(controller.getToggleState('agent-console-panel'), true);

  controller.setToggleState('truth-panel', true);
  controller.setToggleState('reality-sync', true);
  const restored = JSON.parse(storage.dump()[STEPHANOS_SESSION_MEMORY_STORAGE_KEY]);
  assert.equal(restored.session.ui.uiLayout.truthPanelVisible, true);
  assert.equal(restored.session.ui.uiLayout.realitySyncEnabled, true);
});
