import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPHANOS_SESSION_MEMORY_STORAGE_KEY,
  STEPHANOS_UI_LAYOUT_STORAGE_KEY,
  createDefaultStephanosSessionMemory,
  persistStephanosSessionMemory,
  readPersistedStephanosSessionMemory,
  readPortableStephanosHomeNodePreference,
  restoreStephanosSessionMemoryForDevice,
  sanitizeStephanosSessionMemoryForDevice,
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

test('stephanosSessionMemory startup import path initializes without TDZ/uninitialized variable errors', async () => {
  const moduleUrl = new URL(`./stephanosSessionMemory.mjs?startup-init=${Date.now()}`, import.meta.url);
  const mod = await import(moduleUrl.href);

  assert.doesNotThrow(() => mod.createDefaultStephanosSessionMemory());
  assert.doesNotThrow(() => mod.readPersistedStephanosSessionMemory(null));
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
          ollama: { baseURL: 'http://localhost:11434', model: 'qwen:14b', timeoutMs: 8000 },
          openrouter: { baseURL: 'https://openrouter.ai/api/v1', model: 'openai/gpt-oss-20b', enabled: false },
        },
        ollamaConnection: {
          lastSuccessfulBaseURL: 'http://192.168.0.8:11434',
          lastSuccessfulHost: '192.168.0.8',
          recentHosts: ['192.168.0.8'],
          lastSelectedModel: 'qwen:14b',
        },
        hostedCloudCognition: {
          enabled: true,
          selectedProvider: 'gemini',
          providers: {
            groq: { enabled: true, baseURL: 'https://worker-groq.example.workers.dev', model: 'openai/gpt-oss-20b' },
            gemini: { enabled: true, baseURL: 'https://worker-gemini.example.workers.dev', model: 'gemini-2.5-flash' },
          },
        },
      },
      ui: {
        activeWorkspace: 'mission-console',
        activeSubview: 'memory',
        recentRoute: 'memory',
        operatorPaneLayout: {
          order: ['missionDashboardPanel', 'aiConsole', 'agentsPanel'],
        },
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
  assert.equal(restored.session.providerPreferences.hostedCloudCognition.enabled, true);
  assert.equal(restored.session.providerPreferences.hostedCloudCognition.selectedProvider, 'gemini');
  assert.equal(restored.session.providerPreferences.hostedCloudCognition.providers.gemini.baseURL, 'https://worker-gemini.example.workers.dev');
  assert.equal(restored.session.providerPreferences.hostedCloudCognition.providers.groq.baseURL, 'https://worker-groq.example.workers.dev');
  assert.equal(restored.session.ui.recentRoute, 'memory');
  assert.deepEqual(restored.session.ui.operatorPaneLayout.order, ['missionDashboardPanel', 'aiConsole', 'agentsPanel']);
  assert.equal(restored.session.ui.debugConsoleVisible, true);
  assert.equal(restored.working.recentCommands.length, 1);
  assert.equal(restored.working.recentCommands[0].raw_input, '/status');
  assert.match(persisted.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('hosted cloud cognition worker URLs survive save and full reload simulation', () => {
  const storage = createMemoryStorage();
  persistStephanosSessionMemory({
    session: {
      providerPreferences: {
        hostedCloudCognition: {
          enabled: true,
          selectedProvider: 'groq',
          providers: {
            groq: { enabled: true, baseURL: 'https://groq-worker.example.workers.dev', model: 'openai/gpt-oss-20b' },
            gemini: { enabled: true, baseURL: 'https://gemini-worker.example.workers.dev', model: 'gemini-2.5-flash' },
          },
        },
      },
    },
  }, storage);

  const reloaded = restoreStephanosSessionMemoryForDevice({
    storage,
    currentOrigin: 'https://stephanos.example',
  });

  assert.equal(reloaded.memory.session.providerPreferences.hostedCloudCognition.enabled, true);
  assert.equal(reloaded.memory.session.providerPreferences.hostedCloudCognition.providers.groq.baseURL, 'https://groq-worker.example.workers.dev');
  assert.equal(reloaded.memory.session.providerPreferences.hostedCloudCognition.providers.gemini.baseURL, 'https://gemini-worker.example.workers.dev');
  assert.equal(reloaded.memory.session.providerPreferences.hostedCloudCognition.providers.groq.model, 'openai/gpt-oss-20b');
  assert.equal(reloaded.memory.session.providerPreferences.hostedCloudCognition.providers.gemini.model, 'gemini-2.5-flash');
});

test('persistStephanosSessionMemory strips runtime-only truth fields from persisted core memory', () => {
  const storage = createMemoryStorage();
  persistStephanosSessionMemory({
    session: { providerPreferences: { provider: 'groq' } },
    runtimeTruth: { selectedRoute: 'home-node', actualTarget: 'http://localhost:8787' },
    finalRouteTruth: { routeKind: 'local-desktop', actualTarget: 'http://localhost:8787' },
    preferredTarget: 'http://localhost:8787',
  }, storage);

  const restored = readPersistedStephanosSessionMemory(storage);
  assert.equal(restored.session.providerPreferences.provider, 'groq');
  assert.equal(Object.prototype.hasOwnProperty.call(restored, 'runtimeTruth'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(restored, 'finalRouteTruth'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(restored, 'preferredTarget'), false);
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

test('sanitizeStephanosSessionMemoryForDevice keeps portable provider choice but strips localhost device-local fields for LAN sessions', () => {
  const { memory, diagnostics } = sanitizeStephanosSessionMemoryForDevice({
    session: {
      providerPreferences: {
        provider: 'ollama',
        routeMode: 'auto',
        providerConfigs: {
          ollama: { baseURL: 'http://localhost:11434', model: 'llama3.2', timeoutMs: 8000 },
        },
        ollamaConnection: {
          lastSuccessfulBaseURL: 'http://localhost:11434',
          lastSuccessfulHost: 'localhost',
          recentHosts: ['localhost', '192.168.0.198'],
          pcAddressHint: 'localhost',
          lastSelectedModel: 'llama3.2',
        },
      },
      ui: {
        debugConsoleVisible: true,
      },
    },
    working: {
      missionNote: 'portable note',
    },
  }, {
    currentOrigin: 'http://192.168.0.55:5173',
    manualNode: { host: '192.168.0.198', source: 'manual' },
  });

  assert.equal(memory.session.providerPreferences.provider, 'ollama');
  assert.equal(memory.session.providerPreferences.providerConfigs.ollama.baseURL, '');
  assert.equal(memory.session.providerPreferences.providerConfigs.ollama.model, 'llama3.2');
  assert.equal(memory.session.providerPreferences.ollamaConnection.lastSuccessfulBaseURL, '');
  assert.equal(memory.session.providerPreferences.ollamaConnection.lastSuccessfulHost, '');
  assert.deepEqual(memory.session.providerPreferences.ollamaConnection.recentHosts, ['192.168.0.198']);
  assert.equal(memory.session.ui.debugConsoleVisible, true);
  assert.equal(memory.working.missionNote, 'portable note');
  assert.equal(diagnostics.nonLocalSession, true);
  assert.equal(diagnostics.activeProviderConfigAdjusted, true);
  assert.match(diagnostics.message, /Ignored device-incompatible saved session fields/);
});

test('restoreStephanosSessionMemoryForDevice leaves localhost settings intact for PC-local sessions', () => {
  const storage = createMemoryStorage();
  persistStephanosSessionMemory({
    session: {
      providerPreferences: {
        provider: 'ollama',
        routeMode: 'auto',
        providerConfigs: {
          ollama: { baseURL: 'http://localhost:11434', model: 'gpt-oss:20b', timeoutMs: 8000 },
        },
      },
    },
  }, storage);

  const restored = restoreStephanosSessionMemoryForDevice({
    storage,
    currentOrigin: 'http://localhost:5173',
  });

  assert.equal(restored.memory.session.providerPreferences.providerConfigs.ollama.baseURL, 'http://localhost:11434');
  assert.deepEqual(restored.diagnostics.ignoredFields, []);
  assert.equal(restored.diagnostics.localDesktopSession, true);
});


test('persistStephanosSessionMemory keeps manual home-node preference portable across sessions', () => {
  const storage = createMemoryStorage();
  persistStephanosSessionMemory({
    session: {
      homeNodePreference: {
        host: '192.168.0.198',
        backendPort: 8787,
        uiPort: 5173,
        source: 'manual',
      },
    },
  }, storage);

  const portablePreference = readPortableStephanosHomeNodePreference(storage);
  assert.equal(portablePreference.host, '192.168.0.198');
  assert.equal(portablePreference.backendUrl, 'http://192.168.0.198:8787');
  assert.equal(portablePreference.source, 'manual');
});

test('restoreStephanosSessionMemoryForDevice preserves non-loopback manual home-node preference for non-local sessions', () => {
  const storage = createMemoryStorage();
  persistStephanosSessionMemory({
    session: {
      homeNodePreference: {
        host: '192.168.0.198',
        backendPort: 8787,
        uiPort: 5173,
        source: 'manual',
      },
      providerPreferences: {
        provider: 'groq',
      },
    },
  }, storage);

  const restored = restoreStephanosSessionMemoryForDevice({
    storage,
    currentOrigin: 'https://cheekyfellastef.github.io',
  });

  assert.equal(restored.memory.session.homeNodePreference.host, '192.168.0.198');
  assert.equal(restored.memory.session.homeNodePreference.source, 'manual');
  assert.doesNotMatch(restored.diagnostics.message, /homeNodePreference/);
});

test('restoreStephanosSessionMemoryForDevice drops loopback manual home-node preference for non-local sessions', () => {
  const storage = createMemoryStorage();
  persistStephanosSessionMemory({
    session: {
      homeNodePreference: {
        host: 'localhost',
        backendPort: 8787,
        uiPort: 5173,
        source: 'manual',
      },
    },
  }, storage);

  const restored = restoreStephanosSessionMemoryForDevice({
    storage,
    currentOrigin: 'https://cheekyfellastef.github.io',
  });

  assert.equal(restored.memory.session.homeNodePreference, null);
  assert.ok(restored.diagnostics.ignoredFields.includes('session.homeNodePreference'));
  assert.match(restored.diagnostics.reasons.join(' '), /manual home-node localhost address was ignored/i);
});
