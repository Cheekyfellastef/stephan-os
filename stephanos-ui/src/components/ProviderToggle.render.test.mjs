import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importBundledModule, srcRoot } from '../test/renderHarness.mjs';

function createStore(overrides = {}) {
  return {
    provider: 'groq',
    setProvider: () => {},
    routeMode: 'cloud-first',
    setRouteMode: () => {},
    devMode: true,
    setDevMode: () => {},
    fallbackEnabled: true,
    setFallbackEnabled: () => {},
    disableHomeNodeForLocalSession: false,
    setDisableHomeNodeForLocalSession: () => {},
    providerHealth: {
      groq: {
        ok: false,
        detail: 'Provide a Groq API key in the UI for this session or set GROQ_API_KEY on the backend.',
        configuredVia: 'missing',
        model: 'openai/gpt-oss-20b',
        baseURL: 'https://api.groq.com/openai/v1',
      },
    },
    providerDraftStatus: {
      mock: { errors: {}, message: '', savedAt: null },
      groq: { errors: {}, message: '', savedAt: null },
      gemini: { errors: {}, message: '', savedAt: null },
      ollama: { errors: {}, message: '', savedAt: null },
      openrouter: { errors: {}, message: '', savedAt: null },
    },
    getDraftProviderConfig: (providerKey) => ({
      mock: { model: 'stephanos-mock-v1', mode: 'echo', latencyMs: 0, failRate: 0 },
      groq: { model: 'openai/gpt-oss-20b', baseURL: 'https://api.groq.com/openai/v1', apiKey: '' },
      gemini: { model: 'gemini-2.5-flash', baseURL: 'https://generativelanguage.googleapis.com/v1beta/models', apiKey: '' },
      ollama: {
        baseURL: 'http://localhost:11434',
        timeoutMs: 8000,
        defaultOllamaTimeoutMs: 8000,
        perModelTimeoutOverrides: { 'qwen:32b': 20000 },
        model: 'gpt-oss:20b',
      },
      openrouter: { enabled: false, model: 'openai/gpt-oss-20b', baseURL: 'https://openrouter.ai/api/v1', apiKey: '' },
    }[providerKey]),
    updateDraftProviderConfig: () => {},
    saveDraftProviderConfig: () => ({ ok: true }),
    revertDraftProviderConfig: () => {},
    resetProviderConfig: () => {},
    resetToFreeMode: () => {},
    isDraftDirty: () => false,
    setUiDiagnostics: () => {},
    ollamaConnection: { pcAddressHint: '', lastSelectedModel: '', recentHosts: [] },
    setOllamaConnection: () => {},
    rememberSuccessfulOllamaConnection: () => {},
    homeNodePreference: null,
    setHomeNodePreference: () => {},
    homeNodeLastKnown: null,
    homeNodeStatus: { state: 'idle', detail: 'Home node not checked yet.', attempts: [] },
    ...overrides,
  };
}

const storeModulePath = path.join(srcRoot, 'test/mockAIStore.js');

test('ProviderToggle renders a Groq API key field and truthful backend-only copy', async () => {
  const { renderProviderToggle } = await importBundledModule(
    path.join(srcRoot, 'test/renderProviderToggleEntry.jsx'),
    { '../state/aiStore': storeModulePath },
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore();
  const rendered = renderProviderToggle();

  assert.match(rendered, /Cloud-backed Groq/);
  assert.match(rendered, /Paste a Groq API key here for the current UI session/i);
  assert.match(rendered, /Groq requests still run only through the Stephanos backend/i);
  assert.match(rendered, /API key/);
});

test('ProviderToggle keeps Home PC Host or IP input editable', async () => {
  const { renderProviderToggle } = await importBundledModule(
    path.join(srcRoot, 'test/renderProviderToggleEntry.jsx'),
    { '../state/aiStore': storeModulePath },
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore({
    homeNodePreference: { host: '192.168.0.198', uiPort: 5173, backendPort: 8787, source: 'manual' },
  });
  const rendered = renderProviderToggle();
  const hostInputMarkup = rendered.match(/<span>Home PC Host or IP<\/span><input[^>]+>/i)?.[0] || '';

  assert.match(rendered, /Home PC Host or IP/);
  assert.match(hostInputMarkup, /type=\"text\"/i);
  assert.doesNotMatch(hostInputMarkup, /readonly/i);
  assert.doesNotMatch(hostInputMarkup, /disabled/i);
});

test('ProviderToggle shows default Ollama timeout and optional per-model override controls', async () => {
  const { renderProviderToggle } = await importBundledModule(
    path.join(srcRoot, 'test/renderProviderToggleEntry.jsx'),
    { '../state/aiStore': storeModulePath },
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore({
    provider: 'ollama',
  });
  const rendered = renderProviderToggle();

  assert.match(rendered, /Default Ollama Timeout \(ms\)/);
  assert.match(rendered, /Optional Model Timeout Overrides/);
  assert.match(rendered, /qwen:32b/);
});

test('ProviderToggle surfaces manual home-node guidance for hosted-web manual-needed state', async () => {
  const { renderProviderToggle } = await importBundledModule(
    path.join(srcRoot, 'test/renderProviderToggleEntry.jsx'),
    { '../state/aiStore': storeModulePath },
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore({
    homeNodeStatus: {
      state: 'unreachable',
      detail: 'No reachable Stephanos backend was found from this hosted session. Set manual home-node to the reachable LAN backend host/IP:port.',
      source: 'manual',
      attempts: [],
    },
  });
  const rendered = renderProviderToggle();

  assert.match(rendered, /Home PC node unreachable/);
  assert.match(rendered, /Set manual home-node to the reachable LAN backend host\/IP:port/i);
  assert.match(rendered, /Home PC Host or IP/);
});

test('resolveHomeNodeDraftSync keeps in-progress edits from being clobbered', async () => {
  const { resolveHomeNodeDraftSync } = await importBundledModule(
    path.join(srcRoot, 'components/ProviderToggle.jsx'),
    { '../state/aiStore': storeModulePath },
  );

  const syncResult = resolveHomeNodeDraftSync({
    currentDraft: { host: '192.168.1.77', uiPort: 5173, backendPort: 8787 },
    preference: { host: '192.168.1.42', uiPort: 5173, backendPort: 8787 },
    isEditing: true,
  });

  assert.equal(syncResult.nextDraft.host, '192.168.1.77');
  assert.equal(syncResult.overwritten, false);
  assert.equal(syncResult.skippedBecauseEditing, true);
});

test('resolveHomeNodeDraftSync applies persisted value when editing is inactive', async () => {
  const { resolveHomeNodeDraftSync } = await importBundledModule(
    path.join(srcRoot, 'components/ProviderToggle.jsx'),
    { '../state/aiStore': storeModulePath },
  );

  const syncResult = resolveHomeNodeDraftSync({
    currentDraft: { host: '192.168.1.77', uiPort: 5173, backendPort: 8787 },
    preference: { host: '192.168.1.42', uiPort: 5173, backendPort: 8787 },
    isEditing: false,
  });

  assert.equal(syncResult.nextDraft.host, '192.168.1.42');
  assert.equal(syncResult.overwritten, true);
  assert.equal(syncResult.overwriteSource, 'homeNodePreference-sync');
});

test('resolveHomeNodeDraftSync does not replace non-empty draft with empty persisted host', async () => {
  const { resolveHomeNodeDraftSync } = await importBundledModule(
    path.join(srcRoot, 'components/ProviderToggle.jsx'),
    { '../state/aiStore': storeModulePath },
  );

  const syncResult = resolveHomeNodeDraftSync({
    currentDraft: { host: '192.168.1.77', uiPort: 5173, backendPort: 8787 },
    preference: { host: '', uiPort: 5173, backendPort: 8787 },
    isEditing: false,
  });

  assert.equal(syncResult.nextDraft.host, '192.168.1.77');
  assert.equal(syncResult.overwritten, false);
  assert.equal(syncResult.skippedBecauseEmptyPreference, true);
});
