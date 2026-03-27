import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importBundledModule, srcRoot } from '../test/renderHarness.mjs';

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
  const { renderStatusPanel } = await importBundledModule(path.join(srcRoot, 'test/renderStatusPanelEntry.jsx'), statusPanelAliases, 'status-panel');
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore({ runtimeStatusModel: null });
  const rendered = renderStatusPanel();

  assert.match(rendered, /Status/);
  assert.match(rendered, /Copy Support Snapshot/);
  assert.match(rendered, /Launch State:/);
  assert.match(rendered, /Dependency Summary: pending/);
  assert.match(rendered, /Final Route Source: unknown/);
  assert.match(rendered, /Guardrails Errors: 0/);
  assert.match(rendered, /Guardrails Detail: none/);
});

test('StatusPanel renders truthful placeholders when finalRoute is missing', async () => {
  const { renderStatusPanel } = await importBundledModule(path.join(srcRoot, 'test/renderStatusPanelEntry.jsx'), statusPanelAliases, 'status-panel');
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
  assert.match(rendered, /Final Route Reachable: no/);
  assert.match(rendered, /Preferred Target: unavailable/);
  assert.match(rendered, /Guardrails Warnings: 0/);
});

test('StatusPanel renders truthful placeholders when providerEligibility is missing', async () => {
  const { renderStatusPanel } = await importBundledModule(path.join(srcRoot, 'test/renderStatusPanelEntry.jsx'), statusPanelAliases, 'status-panel');
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

test('StatusPanel renders runtime adjudicator diagnostics from canonical runtime truth', async () => {
  const { renderStatusPanel } = await importBundledModule(path.join(srcRoot, 'test/renderStatusPanelEntry.jsx'), statusPanelAliases, 'status-panel');
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore({
    runtimeStatusModel: {
      appLaunchState: 'degraded',
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'cloud-first',
      selectedProvider: 'groq',
      routeSelectedProvider: 'groq',
      activeProvider: 'groq',
      finalRoute: {
        routeKind: 'cloud',
        source: 'backend-cloud-session',
        preferredTarget: 'https://stephanos.example',
        actualTarget: 'https://api.stephanos.example',
      },
      finalRouteTruth: {
        routeKind: 'cloud',
        requestedProvider: 'groq',
        selectedProvider: 'groq',
        executedProvider: 'groq',
      },
      runtimeTruth: {
        session: { sessionKind: 'hosted-web', nonLocalSession: true },
        route: { winningReason: 'cloud route won' },
        reachability: { uiReachableState: 'reachable' },
        provider: { executableProvider: 'groq' },
        diagnostics: { blockingIssues: [{ code: 'x' }], invariantWarnings: [{ code: 'y' }] },
      },
      runtimeAdjudication: {
        issues: [{ code: 'x' }, { code: 'y' }],
      },
      runtimeContext: {},
      readyCloudProviders: [],
      readyLocalProviders: [],
      attemptOrder: [],
    },
  });

  const rendered = renderStatusPanel();
  assert.match(rendered, /Adjudicator Blocking Issues: 1/);
  assert.match(rendered, /Adjudicator Warnings: 1/);
  assert.match(rendered, /Adjudicator Total Issues: 2/);
  assert.match(rendered, /Executable Provider \(Adjudicated\): groq/);
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

test('App route/provider labels are sourced from finalRouteTruth', async () => {
  const { renderApp } = await importBundledModule(path.join(srcRoot, 'test/renderAppEntry.jsx'), appAliases);
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore({
    runtimeStatusModel: {
      appLaunchState: 'ready',
      dependencySummary: 'home-node degraded',
      statusTone: 'degraded',
      finalRoute: {
        routeKind: 'home-node',
        source: 'manual',
        preferredTarget: 'http://192.168.0.10:8787',
        actualTarget: 'http://192.168.0.10:8787',
        reachability: { selectedRouteReachable: false },
        providerEligibility: {},
      },
      finalRouteTruth: {
        routeKind: 'home-node',
        requestedProvider: 'ollama',
        selectedProvider: 'groq',
        executedProvider: 'gemini',
        preferredTarget: 'http://192.168.0.10:8787',
        actualTarget: 'http://192.168.0.10:8787',
        source: 'manual',
        routeUsable: false,
        backendReachable: true,
      },
    },
  });

  const rendered = renderApp();
  assert.match(rendered, /Route kind: <strong>home-node<\/strong>/);
  assert.match(rendered, /Requested provider: <strong>ollama<\/strong>/);
  assert.match(rendered, /Selected provider: <strong>groq<\/strong>/);
  assert.match(rendered, /Executed provider: <strong>gemini<\/strong>/);
});

test('AIConsole route/provider banner is sourced from finalRouteTruth', async () => {
  const { renderAIConsole } = await importBundledModule(path.join(srcRoot, 'test/renderAIConsoleEntry.jsx'), statusPanelAliases);
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore({
    runtimeStatusModel: {
      appLaunchState: 'ready',
      dependencySummary: 'degraded',
      statusTone: 'degraded',
      finalRoute: {
        routeKind: 'home-node',
        source: 'manual',
        preferredTarget: 'http://192.168.0.10:8787',
        actualTarget: 'http://192.168.0.10:8787',
        reachability: { selectedRouteReachable: false },
        providerEligibility: {},
      },
      finalRouteTruth: {
        routeKind: 'home-node',
        requestedProvider: 'ollama',
        selectedProvider: 'groq',
        executedProvider: 'gemini',
        preferredTarget: 'http://192.168.0.10:8787',
        source: 'manual',
        routeUsable: false,
      },
    },
  });
  const rendered = renderAIConsole();
  assert.match(rendered, /Requested: ollama · Selected: groq · Executed: gemini/);
});

test('StatusPanel truth rows degrade uiReachable honestly and keep provider stages distinct', async () => {
  const { renderStatusPanel } = await importBundledModule(path.join(srcRoot, 'test/renderStatusPanelEntry.jsx'), statusPanelAliases);
  globalThis.__STEPHANOS_TEST_AI_STORE__ = createBaseStore({
    runtimeStatusModel: {
      appLaunchState: 'ready',
      routeKind: 'cloud',
      selectedProvider: 'mock',
      routeSelectedProvider: 'mock',
      activeProvider: 'mock',
      finalRoute: {
        routeKind: 'home-node',
        source: 'manual',
        preferredTarget: 'http://192.168.0.99:8787',
        actualTarget: 'http://192.168.0.99:8787',
        reachability: { selectedRouteReachable: false },
        providerEligibility: {},
      },
      finalRouteTruth: {
        routeKind: 'home-node',
        requestedProvider: 'ollama',
        selectedProvider: 'groq',
        executedProvider: 'gemini',
        uiReachable: false,
        routeUsable: false,
      },
    },
  });

  const rendered = renderStatusPanel();
  assert.match(rendered, /Requested Provider: ollama/);
  assert.match(rendered, /Route Selected Provider: groq/);
  assert.match(rendered, /Active Provider: gemini/);
  assert.match(rendered, /Route Kind: home-node/);
  assert.match(rendered, /Selected Route UI Reachable: no/);
  assert.doesNotMatch(rendered, /Route Kind: cloud/);
  assert.doesNotMatch(rendered, /Requested Provider: mock/);
});
