import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const uiRoot = path.join(repoRoot, 'stephanos-ui');
const srcRoot = path.join(uiRoot, 'src');
const buildDefine = {
  __STEPHANOS_UI_VERSION__: JSON.stringify('test-version'),
  __STEPHANOS_UI_SOURCE__: JSON.stringify('test-source'),
  __STEPHANOS_UI_SOURCE_FINGERPRINT__: JSON.stringify('test-fingerprint'),
  __STEPHANOS_UI_BUILD_TARGET__: JSON.stringify('test-target'),
  __STEPHANOS_UI_BUILD_TARGET_IDENTIFIER__: JSON.stringify('test-target-id'),
  __STEPHANOS_UI_RUNTIME_ID__: JSON.stringify('test-runtime-id'),
  __STEPHANOS_UI_SOURCE_TRUTH__: JSON.stringify('test-source-truth'),
  __STEPHANOS_UI_BUILD_METADATA__: JSON.stringify({
    runtimeMarker: 'test-runtime-marker',
    gitCommit: 'test-commit',
    buildTimestamp: 'test-build-timestamp',
  }),
};

function aliasPlugin(aliases) {
  return {
    name: 'alias-plugin',
    setup(buildContext) {
      buildContext.onResolve({ filter: /.*/ }, (args) => {
        if (aliases[args.path]) {
          return { path: aliases[args.path] };
        }
        return null;
      });
    },
  };
}

async function importBundledModule(entryPoint, aliases = {}) {
  const outfile = path.join(
    os.tmpdir(),
    `stephanos-provider-toggle-test-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`,
  );

  const result = await build({
    absWorkingDir: uiRoot,
    entryPoints: [entryPoint],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile,
    define: buildDefine,
    jsx: 'automatic',
    plugins: [aliasPlugin(aliases)],
  });
  assert.ok(result.errors.length === 0, `Expected bundle without errors for ${entryPoint}`);
  const imported = await import(pathToFileURL(outfile).href);
  await fs.unlink(outfile).catch(() => {});
  return imported;
}

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
      ollama: { baseURL: 'http://localhost:11434', timeoutMs: 8000, model: 'gpt-oss:20b' },
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
