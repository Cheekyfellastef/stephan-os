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
    `stephanos-render-test-${path.basename(entryPoint).replace(/\W+/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`,
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

function createBaseStore(overrides = {}) {
  return {
    status: 'idle',
    isBusy: false,
    lastRoute: 'status',
    commandHistory: [],
    apiStatus: {
      state: 'checking',
      label: 'Checking backend...',
      detail: 'Waiting for health check.',
      baseUrl: '',
      frontendOrigin: 'http://localhost:5173',
      backendDefaultProvider: '',
      backendReachable: false,
      runtimeContext: null,
    },
    provider: 'ollama',
    providerSelectionSource: 'default:free-tier',
    routeMode: 'auto',
    devMode: true,
    fallbackEnabled: true,
    disableHomeNodeForLocalSession: false,
    fallbackOrder: ['groq', 'gemini', 'mock'],
    providerHealth: {},
    getActiveProviderConfig: () => ({ baseURL: '', model: '' }),
    getActiveProviderConfigSource: () => 'saved:session',
    uiDiagnostics: {
      componentMarker: 'test-marker',
      aiConsoleMarker: 'test-ai-console',
    },
    lastExecutionMetadata: null,
    runtimeStatusModel: undefined,
    uiLayout: {
      commandDeck: true,
      statusPanel: true,
      providerControlsPanel: true,
    },
    togglePanel: () => {},
    setProvider: () => {},
    setUiDiagnostics: () => {},
    workingMemory: {
      recentCommands: [],
      currentTask: '',
      activeFocusLabel: '',
      missionNote: '',
    },
    projectMemory: {
      currentMilestone: '',
    },
    sessionRestoreDiagnostics: {
      message: 'Portable session state restored.',
      reasons: [],
      ignoredFields: [],
    },
    ...overrides,
  };
}

const storeModulePath = path.join(srcRoot, 'test/mockAIStore.js');
const nullComponentPath = path.join(srcRoot, 'test/nullComponent.jsx');
const useAIConsoleMockPath = path.join(srcRoot, 'test/useAIConsoleMock.js');
const useDebugConsoleMockPath = path.join(srcRoot, 'test/useDebugConsoleMock.js');

const statusPanelAliases = {
  '../state/aiStore': storeModulePath,
};

const appAliases = {
  './state/aiStore': storeModulePath,
  '../state/aiStore': storeModulePath,
  './hooks/useAIConsole': useAIConsoleMockPath,
  './hooks/useDebugConsole': useDebugConsoleMockPath,
  './components/DebugConsole': nullComponentPath,
  './components/ToolsPanel': nullComponentPath,
  './components/MemoryPanel': nullComponentPath,
  './components/KnowledgeGraphPanel': nullComponentPath,
  './components/SimulationListPanel': nullComponentPath,
  './components/SimulationPanel': nullComponentPath,
  './components/ProposalPanel': nullComponentPath,
  './components/ActivityPanel': nullComponentPath,
  './components/RoadmapPanel': nullComponentPath,
  './components/SimulationHistoryPanel': nullComponentPath,
  './components/ProviderToggle': nullComponentPath,
};

const appWithRealConsoleAliases = {
  './state/aiStore': storeModulePath,
  '../state/aiStore': storeModulePath,
  './hooks/useDebugConsole': useDebugConsoleMockPath,
  './components/DebugConsole': nullComponentPath,
  './components/ToolsPanel': nullComponentPath,
  './components/MemoryPanel': nullComponentPath,
  './components/KnowledgeGraphPanel': nullComponentPath,
  './components/SimulationListPanel': nullComponentPath,
  './components/SimulationPanel': nullComponentPath,
  './components/ProposalPanel': nullComponentPath,
  './components/ActivityPanel': nullComponentPath,
  './components/RoadmapPanel': nullComponentPath,
  './components/SimulationHistoryPanel': nullComponentPath,
  './components/ProviderToggle': nullComponentPath,
};

test('StatusPanel renders when runtimeStatusModel is null or undefined', async () => {
  const { renderStatusPanel } = await importBundledModule(path.join(srcRoot, 'test/renderStatusPanelEntry.jsx'), statusPanelAliases);
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore({ runtimeStatusModel: null });
  const rendered = renderStatusPanel();

  assert.match(rendered, /Status/);
  assert.match(rendered, /Launch State:/);
  assert.match(rendered, /Dependency Summary: pending/);
  assert.match(rendered, /Final Route Source: unknown/);
  assert.match(rendered, /Guardrails Errors: 0/);
  assert.match(rendered, /Guardrails Detail: none/);
});

test('StatusPanel renders truthful placeholders when finalRoute is missing', async () => {
  const { renderStatusPanel } = await importBundledModule(path.join(srcRoot, 'test/renderStatusPanelEntry.jsx'), statusPanelAliases);
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore({
    runtimeStatusModel: {
      appLaunchState: 'degraded',
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'auto',
      selectedProvider: 'ollama',
      routeSelectedProvider: 'ollama',
      activeProvider: 'ollama',
      activeRouteKind: 'local',
      dependencySummary: 'pending',
      runtimeContext: {},
      readyCloudProviders: [],
      readyLocalProviders: [],
      attemptOrder: [],
    },
  });
  const rendered = renderStatusPanel();

  assert.match(rendered, /Final Route Source: unknown/);
  assert.match(rendered, /Final Route Reachable: pending/);
  assert.match(rendered, /Preferred Target: unavailable/);
  assert.match(rendered, /Guardrails Warnings: 0/);
});

test('StatusPanel renders truthful placeholders when providerEligibility is missing', async () => {
  const { renderStatusPanel } = await importBundledModule(path.join(srcRoot, 'test/renderStatusPanelEntry.jsx'), statusPanelAliases);
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore({
    runtimeStatusModel: {
      appLaunchState: 'degraded',
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'auto',
      selectedProvider: 'ollama',
      routeSelectedProvider: 'ollama',
      activeProvider: 'ollama',
      activeRouteKind: 'local',
      finalRoute: {
        routeKind: 'unavailable',
        source: 'route-diagnostics',
      },
      runtimeContext: {},
      readyCloudProviders: [],
      readyLocalProviders: [],
      attemptOrder: [],
    },
  });
  const rendered = renderStatusPanel();

  assert.match(rendered, /Backend-Mediated Providers Eligible: pending/);
  assert.match(rendered, /Local Providers Eligible: pending/);
  assert.match(rendered, /Cloud Providers Eligible: pending/);
});


test('App render regression guard: real useAIConsole boot path still renders startup diagnostics', async () => {
  const { renderApp } = await importBundledModule(path.join(srcRoot, 'test/renderAppEntry.jsx'), appWithRealConsoleAliases);
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore({
    runtimeStatusModel: undefined,
    setCommandHistory: () => {},
    setIsBusy: () => {},
    setStatus: () => {},
    setLastRoute: () => {},
    setDebugData: () => {},
    setApiStatus: () => {},
    getActiveProviderConfigSource: () => 'saved:session',
    getEffectiveProviderConfigs: () => ({ ollama: { baseURL: '', model: '' } }),
    getDraftProviderConfig: () => ({ baseURL: '', model: '' }),
    updateDraftProviderConfig: () => {},
    ollamaConnection: {
      lastSuccessfulBaseURL: '',
      lastSuccessfulHost: '',
      recentHosts: [],
      pcAddressHint: '',
      lastSelectedModel: '',
    },
    rememberSuccessfulOllamaConnection: () => {},
    homeNodePreference: null,
    homeNodeLastKnown: null,
    setHomeNodeLastKnown: () => {},
    setHomeNodeStatus: () => {},
    setProviderHealth: () => {},
    lastExecutionMetadata: null,
    setLastExecutionMetadata: () => {},
  });

  const rendered = renderApp();

  assert.match(rendered, /Stephanos Mission Console/);
  assert.match(rendered, /Diagnostics pending|Checking reachable Stephanos route/);
  assert.match(rendered, /Checking backend\.\.\./);
});

test('startup loading state does not blank the page', async () => {
  const { renderApp } = await importBundledModule(path.join(srcRoot, 'test/renderAppEntry.jsx'), appAliases);
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore({
    runtimeStatusModel: undefined,
  });
  const rendered = renderApp();

  assert.match(rendered, /Stephanos Mission Console/);
  assert.match(rendered, /Status/);
  assert.match(rendered, /Checking backend\.\.\./);
});


test('StatusPanel renders guardrails diagnostics without crashing on partial runtime data', async () => {
  const { renderStatusPanel } = await importBundledModule(path.join(srcRoot, 'test/renderStatusPanelEntry.jsx'), statusPanelAliases);
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore({
    runtimeStatusModel: {
      appLaunchState: 'degraded',
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'auto',
      selectedProvider: 'ollama',
      routeSelectedProvider: 'ollama',
      activeProvider: 'ollama',
      activeRouteKind: 'local',
      finalRoute: {
        routeKind: 'unavailable',
        source: 'route-diagnostics',
        preferredTarget: 'unavailable',
        actualTarget: 'unavailable',
        reachability: { selectedRouteReachable: false },
        providerEligibility: {},
      },
      guardrails: {
        ok: false,
        hasErrors: true,
        hasWarnings: false,
        errors: [{ id: 'loopback-contamination', severity: 'error', message: 'Non-local sessions must never expose loopback or localhost as the client-facing route target.' }],
        warnings: [],
        invariants: [],
        summary: { total: 1, errors: 1, warnings: 0 },
      },
      runtimeContext: {},
      readyCloudProviders: [],
      readyLocalProviders: [],
      attemptOrder: [],
    },
  });
  const rendered = renderStatusPanel();

  assert.match(rendered, /Guardrails Errors: 1/);
  assert.match(rendered, /Guardrails Detail: Non-local sessions must never expose loopback or localhost as the client-facing route target\./);
});
