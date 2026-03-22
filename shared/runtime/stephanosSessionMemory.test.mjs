import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPHANOS_SESSION_MEMORY_STORAGE_KEY,
  STEPHANOS_UI_LAYOUT_STORAGE_KEY,
  createDefaultStephanosSessionMemory,
  persistStephanosSessionMemory,
  readPersistedStephanosSessionMemory,
} from './stephanosSessionMemory.mjs';
import { AI_SETTINGS_STORAGE_KEY } from '../ai/providerDefaults.mjs';
import { readPersistedProviderPreferences } from './runtimeStatusModel.mjs';

function createMemoryStorage(seed = {}) {
  const storage = { ...seed };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
    },
    setItem(key, value) {
      storage[key] = String(value);
    },
    removeItem(key) {
      delete storage[key];
    },
    dump() {
      return { ...storage };
    },
  };
}

test('readPersistedStephanosSessionMemory falls back to safe defaults when storage is missing', () => {
  const memory = readPersistedStephanosSessionMemory(null);
  assert.deepEqual(memory, createDefaultStephanosSessionMemory());
});

test('persistStephanosSessionMemory writes central schema and legacy mirrors for reload compatibility', () => {
  const storage = createMemoryStorage();
  const persisted = persistStephanosSessionMemory({
    session: {
      providerPreferences: {
        provider: 'groq',
        routeMode: 'cloud-first',
        devMode: false,
        fallbackEnabled: false,
        fallbackOrder: ['gemini', 'mock'],
        providerConfigs: {
          groq: { baseURL: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-20b' },
          gemini: { baseURL: 'https://generativelanguage.googleapis.com/v1beta/models', model: 'gemini-2.5-flash' },
          mock: { enabled: true, latencyMs: 500, failRate: 0, mode: 'echo', model: 'stephanos-mock-v1' },
          ollama: { baseURL: 'http://localhost:11434', model: 'gpt-oss:20b', timeoutMs: 8000 },
          openrouter: { baseURL: 'https://openrouter.ai/api/v1', model: 'openai/gpt-oss-20b', enabled: false },
        },
        ollamaConnection: {
          lastSuccessfulBaseURL: 'http://192.168.0.8:11434',
          lastSuccessfulHost: '192.168.0.8',
          recentHosts: ['192.168.0.8'],
          lastSelectedModel: 'gpt-oss:20b',
        },
      },
      ui: {
        activeWorkspace: 'mission-console',
        activeSubview: 'memory',
        recentRoute: 'memory',
        uiLayout: {
          commandDeck: true,
          memoryPanel: true,
          debugConsole: true,
        },
      },
    },
    working: {
      recentCommands: [{
        id: 'cmd_1',
        raw_input: '/status',
        route: 'assistant',
        success: true,
        output_text: 'status ok',
        timestamp: '2026-03-22T00:00:00.000Z',
      }],
    },
  }, storage);

  const rawStorage = storage.dump();
  assert.ok(rawStorage[STEPHANOS_SESSION_MEMORY_STORAGE_KEY]);
  assert.ok(rawStorage[AI_SETTINGS_STORAGE_KEY]);
  assert.ok(rawStorage[STEPHANOS_UI_LAYOUT_STORAGE_KEY]);

  const restored = readPersistedStephanosSessionMemory(storage);
  assert.equal(restored.session.providerPreferences.provider, 'groq');
  assert.equal(restored.session.providerPreferences.routeMode, 'cloud-first');
  assert.equal(restored.session.ui.recentRoute, 'memory');
  assert.equal(restored.session.ui.debugConsoleVisible, true);
  assert.equal(restored.working.recentCommands.length, 1);
  assert.equal(restored.working.recentCommands[0].raw_input, '/status');
  assert.match(persisted.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('readPersistedStephanosSessionMemory truthfully migrates legacy provider and layout keys', () => {
  const storage = createMemoryStorage({
    [AI_SETTINGS_STORAGE_KEY]: JSON.stringify({
      provider: 'gemini',
      routeMode: 'explicit',
      fallbackEnabled: true,
      fallbackOrder: ['groq', 'mock'],
      providerConfigs: {
        gemini: { baseURL: 'https://generativelanguage.googleapis.com/v1beta/models', model: 'gemini-2.5-flash' },
      },
    }),
    [STEPHANOS_UI_LAYOUT_STORAGE_KEY]: JSON.stringify({
      statusPanel: false,
      debugConsole: true,
    }),
  });

  const restored = readPersistedStephanosSessionMemory(storage);
  assert.equal(restored.session.providerPreferences.provider, 'gemini');
  assert.equal(restored.session.providerPreferences.routeMode, 'explicit');
  assert.equal(restored.session.ui.uiLayout.statusPanel, false);
  assert.equal(restored.session.ui.debugConsoleVisible, true);
});

test('corrupt central storage fails safely and falls back to legacy/default values', () => {
  const storage = createMemoryStorage({
    [STEPHANOS_SESSION_MEMORY_STORAGE_KEY]: '{not valid json',
    [AI_SETTINGS_STORAGE_KEY]: JSON.stringify({
      provider: 'ollama',
      routeMode: 'local-first',
      fallbackEnabled: true,
      fallbackOrder: ['groq', 'gemini'],
    }),
  });

  const restored = readPersistedStephanosSessionMemory(storage);
  assert.equal(restored.session.providerPreferences.provider, 'ollama');
  assert.equal(restored.session.providerPreferences.routeMode, 'local-first');
  assert.deepEqual(restored.working.recentCommands, []);
});

test('readPersistedProviderPreferences uses centralized Stephanos session memory', () => {
  const storage = createMemoryStorage();
  persistStephanosSessionMemory({
    session: {
      providerPreferences: {
        provider: 'groq',
        routeMode: 'cloud-first',
        fallbackEnabled: false,
        fallbackOrder: ['mock'],
      },
    },
  }, storage);

  const preferences = readPersistedProviderPreferences(storage);
  assert.deepEqual(preferences, {
    selectedProvider: 'groq',
    routeMode: 'cloud-first',
    fallbackEnabled: false,
    fallbackOrder: ['mock', 'groq', 'gemini', 'ollama'],
  });
});
