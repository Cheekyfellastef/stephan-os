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
    streamingMode: 'off',
    setStreamingMode: () => {},
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
    hostedCloudCognition: {
      enabled: true,
      selectedProvider: 'groq',
      providers: {
        groq: { enabled: true, baseURL: 'https://worker-groq.example.workers.dev', model: 'openai/gpt-oss-20b' },
        gemini: { enabled: true, baseURL: 'https://worker-gemini.example.workers.dev', model: 'gemini-2.5-flash' },
      },
      lastHealth: {
        groq: { status: 'healthy', reason: 'Groq worker reachable.', checkedAt: '2026-04-21T00:00:00.000Z' },
        gemini: { status: 'unknown', reason: 'No provider health data yet.', checkedAt: '' },
      },
    },
    hostedCloudCognitionSaveState: {
      state: 'restored',
      message: 'Restored from session',
      diagnostics: {
        restoreSucceeded: true,
        lastRestoredSummary: 'groq:https://worker-groq.example.workers.dev',
        lastRestoreReason: 'Restored hosted cognition settings from session memory.',
      },
    },
    hostedCloudCognitionDirty: false,
    setHostedCloudCognitionEnabled: () => {},
    setHostedCloudCognitionProvider: () => {},
    updateHostedCloudCognitionProviderConfig: () => {},
    saveHostedCloudCognitionSettings: () => ({ ok: true }),
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
    runtimeStatusModel: {
      canonicalRouteRuntimeTruth: {
        battleBridgeAuthorityAvailable: false,
        hostedCloudPathAvailable: true,
        cloudCognitionAvailable: true,
        operatorSummary: 'Battle Bridge unavailable; hosted cloud cognition available.',
      },
    },
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

test('ProviderToggle renders the manual Ollama address action below the address input', async () => {
  const { renderProviderToggle } = await importBundledModule(
    path.join(srcRoot, 'test/renderProviderToggleEntry.jsx'),
    { '../state/aiStore': storeModulePath },
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore({
    provider: 'ollama',
    ollamaConnection: { pcAddressHint: '192.168.1.42', lastSelectedModel: '', recentHosts: [] },
  });
  const rendered = renderProviderToggle();

  assert.match(
    rendered,
    /provider-manual-address[\s\S]*<label>[\s\S]*PC Address \(optional\)[\s\S]*<\/label>[\s\S]*provider-manual-address-action[\s\S]*Try This Address/,
  );
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

test('ProviderToggle renders Hosted Cloud Cognition pane with worker URL and model controls', async () => {
  const { renderProviderToggle } = await importBundledModule(
    path.join(srcRoot, 'test/renderProviderToggleEntry.jsx'),
    { '../state/aiStore': storeModulePath },
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore();
  const rendered = renderProviderToggle();

  assert.match(rendered, /Hosted Cloud Cognition/);
  assert.match(rendered, /Hosted-safe reasoning through Worker-backed providers/i);
  assert.match(rendered, /Worker\/proxy base URL/);
  assert.match(rendered, /https:\/\/worker-groq\.example\.workers\.dev/);
  assert.match(rendered, /Authority:\s*<\/strong>\s*cognition-only \(execution deferred\)/);
  assert.match(rendered, /Save state:\s*<\/strong>\s*Restored from session/);
  assert.match(rendered, /Restore:\s*<\/strong>\s*Restored from session/);
  assert.match(rendered, /Restore diagnostics:\s*<\/strong>\s*Hydration ok/);
  assert.match(rendered, /Save Hosted Cloud Cognition/);
  assert.match(rendered, /Test Groq Worker/);
  assert.match(rendered, /Reachable:\s*<\/strong>\s*unknown/);
  assert.match(rendered, /Executable now:\s*<\/strong>\s*unknown/);
  assert.match(rendered, /Model:\s*<\/strong>\s*gemini-2\.5-flash/);
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
