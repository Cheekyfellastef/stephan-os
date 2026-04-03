import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeStatusModel } from './runtimeStatusModel.mjs';

test('createRuntimeStatusModel treats LAN sessions with loopback backend leakage as hosted-web and prefers home-node targets', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    providerHealth: {
      ollama: { ok: false },
      groq: { ok: false },
      gemini: { ok: false },
    },
    backendAvailable: false,
    runtimeContext: {
      frontendOrigin: 'http://192.168.0.55:5173',
      apiBaseUrl: 'http://localhost:8787',
      preferredTarget: 'http://localhost:8787',
      actualTargetUsed: 'http://localhost:8787',
      nodeAddressSource: 'manual',
      homeNode: {
        host: '192.168.0.198',
        uiPort: 5173,
        backendPort: 8787,
        uiUrl: 'http://192.168.0.198:5173/',
        backendUrl: 'http://192.168.0.198:8787',
        source: 'manual',
        configured: true,
        reachable: false,
      },
    },
  });

  assert.equal(status.runtimeModeLabel, 'hosted/web');
  assert.equal(status.runtimeContext.sessionKind, 'hosted-web');
  assert.equal(status.runtimeContext.deviceContext, 'lan-companion');
  assert.equal(status.preferredTarget, 'http://192.168.0.198:5173/');
  assert.equal(status.actualTargetUsed, 'http://192.168.0.198:8787');
  assert.equal(status.nodeAddressSource, 'manual');
  assert.notEqual(status.preferredTarget, 'http://localhost:8787');
});

test('createRuntimeStatusModel keeps localhost routing for PC-local desktop sessions', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    providerHealth: {
      ollama: { ok: true },
    },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'http://localhost:5173',
      apiBaseUrl: 'http://localhost:8787',
      preferredTarget: 'http://localhost:8787',
      actualTargetUsed: 'http://localhost:8787',
      nodeAddressSource: 'local-backend-session',
    },
  });

  assert.equal(status.runtimeModeLabel, 'local desktop/dev');
  assert.equal(status.runtimeContext.sessionKind, 'local-desktop');
  assert.equal(status.preferredTarget, 'http://localhost:8787');
  assert.equal(status.actualTargetUsed, 'http://localhost:8787');
  assert.equal(status.nodeAddressSource, 'local-backend-session');
  assert.equal(status.finalRoute.routeKind, 'local-desktop');
  assert.equal(status.finalRoute.actualTarget, 'http://localhost:8787');
  assert.equal(status.finalRoute.providerEligibility.backendMediatedProviders, true);
  assert.equal(status.runtimeContext.finalRoute.actualTarget, 'http://localhost:8787');
});


test('createRuntimeStatusModel preserves explicit discard reasons when loopback route state is ignored on LAN sessions', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    providerHealth: {
      ollama: { ok: false },
      groq: { ok: false },
      gemini: { ok: false },
    },
    backendAvailable: false,
    runtimeContext: {
      frontendOrigin: 'http://192.168.0.55:5173',
      apiBaseUrl: 'http://localhost:8787',
      preferredTarget: 'http://localhost:8787',
      actualTargetUsed: 'http://localhost:8787',
      nodeAddressSource: 'manual',
      restoreDecision: 'Ignored loopback backend target for non-local session; using current home-node/network context instead.',
      homeNode: {
        host: '192.168.0.198',
        uiPort: 5173,
        backendPort: 8787,
        uiUrl: 'http://192.168.0.198:5173/',
        backendUrl: 'http://192.168.0.198:8787',
        source: 'manual',
        configured: true,
        reachable: false,
      },
    },
  });

  assert.equal(status.runtimeContext.restoreDecision, 'Ignored loopback backend target for non-local session; using current home-node/network context instead.');
  assert.equal(status.runtimeModeLabel, 'hosted/web');
  assert.equal(status.routeKind, 'unavailable');
  assert.equal(status.preferredTarget, 'http://192.168.0.198:5173/');
});


test('createRuntimeStatusModel keeps manual node source and explicit failure reason when home-node probe fails on hosted web', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    providerHealth: {
      groq: { ok: false },
      gemini: { ok: false },
      ollama: { ok: false },
    },
    backendAvailable: false,
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: '',
      preferredTarget: 'https://cheekyfellastef.github.io',
      actualTargetUsed: 'https://cheekyfellastef.github.io',
      nodeAddressSource: 'manual',
      homeNode: {
        host: '192.168.0.198',
        uiPort: 5173,
        backendPort: 8787,
        uiUrl: 'http://192.168.0.198:5173/',
        backendUrl: 'http://192.168.0.198:8787',
        source: 'manual',
        configured: true,
        reachable: false,
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: false,
          source: 'manual',
          reason: 'Manual home-node 192.168.0.198 failed: probe timeout.',
          blockedReason: 'Manual home-node 192.168.0.198 failed: probe timeout.',
        },
      },
    },
  });

  assert.equal(status.routeKind, 'unavailable');
  assert.equal(status.nodeAddressSource, 'manual');
  assert.match(status.routeSummary, /probe timeout/i);
  assert.match(status.dependencySummary, /home pc node unavailable/i);
});

test('createRuntimeStatusModel does not let cloud selection overwrite manual node source on hosted sessions', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    providerHealth: {
      groq: { ok: true },
      gemini: { ok: false },
      ollama: { ok: false },
    },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: 'https://api.example.com',
      preferredTarget: 'https://cheekyfellastef.github.io',
      actualTargetUsed: 'https://api.example.com',
      nodeAddressSource: 'manual',
      homeNode: {
        host: '192.168.0.198',
        uiPort: 5173,
        backendPort: 8787,
        uiUrl: 'http://192.168.0.198:5173/',
        backendUrl: 'http://192.168.0.198:8787',
        source: 'manual',
        configured: true,
        reachable: false,
      },
      routeDiagnostics: {
        cloud: {
          configured: true,
          available: true,
          source: 'backend-cloud-session',
          target: 'https://cheekyfellastef.github.io',
          actualTarget: 'https://api.example.com',
          reason: 'A cloud-backed Stephanos route is ready',
        },
        'home-node': {
          configured: true,
          available: false,
          source: 'manual',
          blockedReason: 'Manual home-node 192.168.0.198 failed: unreachable host.',
        },
      },
    },
  });

  assert.equal(status.routeKind, 'cloud');
  assert.equal(status.nodeAddressSource, 'manual');
});


test('createRuntimeStatusModel adopts a reachable manual LAN home-node route and labels the runtime accordingly', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    providerHealth: {
      groq: { ok: true },
      ollama: { ok: false },
      gemini: { ok: false },
    },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: 'http://192.168.0.198:8787',
      preferredTarget: 'http://192.168.0.198:8787',
      actualTargetUsed: 'http://192.168.0.198:8787',
      nodeAddressSource: 'manual',
      homeNode: {
        host: '192.168.0.198',
        uiPort: 5173,
        backendPort: 8787,
        uiUrl: 'http://192.168.0.198:5173/',
        backendUrl: 'http://192.168.0.198:8787',
        source: 'manual',
        configured: true,
        reachable: true,
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          source: 'manual',
          target: 'http://192.168.0.198:8787',
          actualTarget: 'http://192.168.0.198:8787',
          reason: 'Home PC node is reachable on the LAN',
          blockedReason: '',
        },
      },
    },
  });

  assert.equal(status.routeKind, 'home-node');
  assert.equal(status.homeNodeReachable, true);
  assert.equal(status.nodeAddressSource, 'manual');
  assert.equal(status.preferredTarget, 'http://192.168.0.198:8787');
  assert.equal(status.actualTargetUsed, 'http://192.168.0.198:8787');
  assert.equal(status.runtimeModeLabel, 'home node/lan');
  assert.match(status.dependencySummary, /home pc node ready/i);
});

test('createRuntimeStatusModel keeps local-first provider routing for reachable LAN home-node sessions', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    providerHealth: {
      ollama: { ok: true, reason: '' },
      groq: { ok: true },
    },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: 'http://192.168.0.198:8787',
      preferredTarget: 'http://192.168.0.198:8787',
      actualTargetUsed: 'http://192.168.0.198:8787',
      nodeAddressSource: 'manual',
      homeNode: {
        host: '192.168.0.198',
        uiPort: 5173,
        backendPort: 8787,
        backendUrl: 'http://192.168.0.198:8787',
        source: 'manual',
        configured: true,
        reachable: true,
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          source: 'manual',
          target: 'http://192.168.0.198:8787',
          actualTarget: 'http://192.168.0.198:8787',
          reason: 'Home PC node is reachable on the LAN',
        },
      },
    },
  });

  assert.equal(status.effectiveRouteMode, 'local-first');
  assert.equal(status.routeKind, 'home-node');
  assert.equal(status.activeProvider, 'ollama');
  assert.equal(status.preferredTarget, 'http://192.168.0.198:8787');
  assert.equal(status.nodeAddressSource, 'manual');
  assert.equal(status.finalRoute.routeKind, 'home-node');
  assert.equal(status.finalRoute.actualTarget, 'http://192.168.0.198:8787');
  assert.equal(status.finalRoute.providerEligibility.localProviders, true);
});

test('createRuntimeStatusModel marks dist and mock as fallback-only when no truthful backend route is reachable', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'mock',
    routeMode: 'auto',
    providerHealth: {
      mock: { ok: true },
    },
    backendAvailable: false,
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      preferredTarget: 'https://cheekyfellastef.github.io/apps/stephanos/dist/',
      actualTargetUsed: 'https://cheekyfellastef.github.io/apps/stephanos/dist/',
      routeDiagnostics: {
        dist: {
          configured: true,
          available: true,
          target: 'https://cheekyfellastef.github.io/apps/stephanos/dist/',
          actualTarget: 'https://cheekyfellastef.github.io/apps/stephanos/dist/',
          source: 'dist-entry',
          reason: 'Bundled dist runtime is reachable',
        },
      },
    },
  });

  assert.equal(status.finalRoute.routeKind, 'dist');
  assert.equal(status.finalRoute.providerEligibility.distFallbackOnly, true);
  assert.equal(status.finalRoute.providerEligibility.mockFallbackOnly, true);
  assert.equal(status.finalRoute.providerEligibility.backendMediatedProviders, false);
});

test('createRuntimeStatusModel surfaces explicit Ollama failure reasons before truthful fallback', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    providerHealth: {
      ollama: { ok: false, reason: 'Nothing answered at that Ollama address.' },
      groq: { ok: true },
    },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'http://localhost:4173',
      apiBaseUrl: 'http://localhost:8787',
      preferredTarget: 'http://localhost:8787',
      actualTargetUsed: 'http://localhost:8787',
      nodeAddressSource: 'local-backend-session',
      routeDiagnostics: {
        'local-desktop': {
          configured: true,
          available: true,
          source: 'local-backend-session',
          target: 'http://localhost:8787',
          actualTarget: 'http://localhost:8787',
          reason: 'Backend online locally; local-desktop stays valid',
        },
      },
    },
  });

  assert.equal(status.routeKind, 'local-desktop');
  assert.equal(status.activeProvider, 'groq');
  assert.match(status.dependencySummary, /Ollama unavailable: Nothing answered at that Ollama address\./i);
  assert.match(status.dependencySummary, /cloud active because local Ollama is unavailable/i);
});

test('createRuntimeStatusModel keeps local-desktop route truth while mock executes as provider fallback', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    providerHealth: {
      ollama: { ok: false, reason: 'Nothing answered at that Ollama address.' },
      mock: { ok: true },
    },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'http://localhost:4173',
      apiBaseUrl: 'http://localhost:8787',
      preferredTarget: 'http://localhost:8787',
      actualTargetUsed: 'http://localhost:8787',
      nodeAddressSource: 'local-backend-session',
      routeDiagnostics: {
        'local-desktop': {
          configured: true,
          available: true,
          source: 'local-backend-session',
          target: 'http://localhost:8787',
          actualTarget: 'http://localhost:8787',
          reason: 'Backend online locally; local-desktop stays valid',
        },
      },
    },
    activeProviderHint: 'mock',
  });

  assert.equal(status.finalRouteTruth.routeKind, 'local-desktop');
  assert.equal(status.finalRouteTruth.routeUsable, true);
  assert.equal(status.dependencySummary, 'Local desktop route valid; using mock provider fallback');
});


test('createRuntimeStatusModel keeps finalRoute as the sole route truth projection for consumers', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    providerHealth: {
      groq: { ok: true },
    },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'https://stephanos.example',
      apiBaseUrl: 'https://api.stephanos.example',
      preferredTarget: 'https://stephanos.example',
      actualTargetUsed: 'https://api.stephanos.example',
      routeDiagnostics: {
        cloud: {
          configured: true,
          available: true,
          source: 'backend-cloud-session',
          target: 'https://stephanos.example',
          actualTarget: 'https://api.stephanos.example',
          reason: 'A cloud-backed Stephanos route is ready',
        },
      },
    },
  });

  assert.equal(status.routeKind, status.finalRoute.routeKind);
  assert.equal(status.preferredTarget, status.finalRoute.preferredTarget);
  assert.equal(status.actualTargetUsed, status.finalRoute.actualTarget);
  assert.equal(status.nodeAddressSource, status.finalRoute.source);
  assert.deepEqual(status.runtimeContext.finalRoute, status.finalRoute);
  assert.equal(status.guardrails.summary.errors, 0);
});

test('createRuntimeStatusModel guardrails preserve request-host promotion for reachable home-node routes', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    providerHealth: {
      ollama: { ok: true },
    },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'https://stephanos.example',
      apiBaseUrl: 'http://192.168.0.198:8787',
      preferredTarget: 'http://192.168.0.198:8787',
      actualTargetUsed: 'http://192.168.0.198:8787',
      nodeAddressSource: 'manual',
      homeNode: {
        host: '192.168.0.198',
        uiPort: 5173,
        backendPort: 8787,
        backendUrl: 'http://192.168.0.198:8787',
        source: 'manual',
        configured: true,
        reachable: true,
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          source: 'manual',
          target: 'http://192.168.0.198:8787',
          actualTarget: 'http://192.168.0.198:8787',
          reason: 'Home PC node is reachable on the LAN',
        },
      },
    },
  });

  assert.equal(status.finalRoute.routeKind, 'home-node');
  assert.equal(status.finalRoute.actualTarget, 'http://192.168.0.198:8787');
  assert.equal(status.guardrails.summary.errors, 0);
  assert.equal(status.guardrails.summary.warnings, 0);
});

test('createRuntimeStatusModel reports uiReachabilityState as unknown until route truth is known', () => {
  const pending = createRuntimeStatusModel({
    validationState: 'launching',
    backendAvailable: false,
    providerHealth: {},
    runtimeContext: {},
  });

  const ready = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    providerHealth: {
      ollama: { ok: true },
    },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'https://stephanos.example',
      apiBaseUrl: 'http://192.168.0.198:8787',
      preferredTarget: 'http://192.168.0.198:8787',
      actualTargetUsed: 'http://192.168.0.198:8787',
      nodeAddressSource: 'manual',
      homeNode: {
        host: '192.168.0.198',
        uiPort: 5173,
        backendPort: 8787,
        backendUrl: 'http://192.168.0.198:8787',
        source: 'manual',
        configured: true,
        reachable: true,
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          uiReachable: true,
          source: 'manual',
          target: 'http://192.168.0.198:8787',
          actualTarget: 'http://192.168.0.198:8787',
          reason: 'Home PC node is reachable on the LAN',
        },
      },
    },
  });

  assert.equal(pending.finalRouteTruth.uiReachabilityState, 'unknown');
  assert.equal(ready.finalRouteTruth.uiReachabilityState, 'reachable');
});

test('createRuntimeStatusModel emits canonical runtimeTruth aligned with final route/provider adjudication', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    providerHealth: { groq: { ok: true } },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: 'https://api.example.com',
      routeDiagnostics: {
        cloud: {
          configured: true,
          available: true,
          source: 'backend-cloud-session',
          target: 'https://cheekyfellastef.github.io',
          actualTarget: 'https://api.example.com',
          reason: 'A cloud-backed Stephanos route is ready',
        },
      },
    },
  });

  assert.equal(status.runtimeTruth.selectedRoute, status.finalRouteTruth.routeKind);
  assert.equal(status.runtimeTruth.actualTarget, status.finalRouteTruth.actualTarget);
  assert.equal(status.runtimeTruth.selectedProvider, status.finalRouteTruth.selectedProvider);
  assert.equal(status.runtimeTruth.executedProvider, status.finalRouteTruth.executedProvider);
  assert.equal(status.runtimeTruth.backendReachable, true);
});

test('createRuntimeStatusModel gates ready launch state on selected route usability and tile execution readiness', () => {
  const degradedStatus = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    providerHealth: {
      ollama: { ok: true },
    },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'http://localhost:5173',
      apiBaseUrl: 'http://localhost:8787',
      preferredTarget: 'http://localhost:8787',
      actualTargetUsed: 'http://localhost:8787',
      nodeAddressSource: 'local-backend-session',
      routeDiagnostics: {
        'local-desktop': {
          configured: true,
          available: true,
          uiReachable: true,
          usable: false,
          blockedReason: 'Tile launch surface still hydrating.',
        },
      },
      tileTruth: {
        ready: false,
        reason: 'Tile registry is still hydrating.',
        launchSurface: 'mission-console',
      },
    },
  });

  assert.equal(degradedStatus.appLaunchState, 'degraded');
  assert.equal(degradedStatus.finalRouteTruth.routeUsable, false);

  const readyStatus = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    providerHealth: {
      ollama: { ok: true },
    },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'http://localhost:5173',
      apiBaseUrl: 'http://localhost:8787',
      preferredTarget: 'http://localhost:8787',
      actualTargetUsed: 'http://localhost:8787',
      nodeAddressSource: 'local-backend-session',
      routeDiagnostics: {
        'local-desktop': {
          configured: true,
          available: true,
          uiReachable: true,
          usable: true,
        },
      },
      tileTruth: {
        ready: true,
        launchSurface: 'mission-console',
      },
    },
  });

  assert.equal(readyStatus.appLaunchState, 'ready');
  assert.equal(readyStatus.finalRouteTruth.routeUsable, true);
});


test('createRuntimeStatusModel keeps local-desktop usable truth coherent with winning route and executable provider', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    providerHealth: {
      ollama: { ok: true },
    },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'http://localhost:5173',
      apiBaseUrl: 'http://localhost:8787',
      preferredTarget: 'http://localhost:8787',
      actualTargetUsed: 'http://localhost:8787',
      nodeAddressSource: 'local-backend-session',
      routeDiagnostics: {
        'local-desktop': {
          configured: true,
          available: true,
          usable: false,
          blockedReason: 'backend is online locally, but no explicit live UI route was published',
          reason: 'Backend online locally; local-desktop stays valid and will use bundled dist UI until a live UI probe is available',
        },
      },
      tileTruth: {
        ready: true,
        launchSurface: 'mission-console',
      },
    },
  });

  assert.equal(status.finalRouteTruth.routeKind, 'local-desktop');
  assert.equal(status.finalRouteTruth.routeUsable, true);
  assert.equal(status.finalRouteTruth.executedProvider, 'ollama');
  assert.equal(status.finalRouteTruth.winnerReason.includes('Backend online locally'), true);
  assert.equal(status.dependencySummary, 'Local Ollama ready');
});

test('createRuntimeStatusModel records unresolved hosted backend target metadata in runtime context', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    providerHealth: {
      groq: { ok: false },
      gemini: { ok: false },
      ollama: { ok: false },
    },
    backendAvailable: false,
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: '',
      preferredTarget: '',
      actualTargetUsed: '',
      nodeAddressSource: 'session-restore',
    },
  });

  assert.equal(status.runtimeContext.sessionKind, 'hosted-web');
  assert.equal(status.runtimeContext.backendTargetResolutionSource, 'unresolved');
  assert.equal(status.runtimeContext.backendTargetResolvedUrl, '');
  assert.match(status.runtimeContext.backendTargetInvalidReason, /No non-loopback backend target resolved/);
});

test('createRuntimeStatusModel keeps hosted cloud route usable when cloud execution is ready even if backend target metadata is unresolved', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    providerHealth: {
      groq: { ok: true },
      gemini: { ok: false },
      ollama: { ok: false },
    },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: '',
      preferredTarget: '',
      actualTargetUsed: '',
      nodeAddressSource: 'route-diagnostics',
      backendTargetResolutionSource: 'unresolved',
      backendTargetResolvedUrl: '',
      backendTargetInvalidReason: 'No non-loopback backend target resolved for hosted session.',
      routeDiagnostics: {
        cloud: {
          configured: true,
          available: true,
          usable: true,
          source: 'backend-cloud-session',
          reason: 'A cloud-backed Stephanos route is ready',
        },
      },
      tileTruth: {
        ready: true,
        launchSurface: 'mission-console',
      },
    },
    activeProviderHint: 'groq',
  });

  assert.equal(status.runtimeContext.sessionKind, 'hosted-web');
  assert.equal(status.runtimeContext.backendTargetResolutionSource, 'unresolved');
  assert.equal(status.runtimeContext.backendTargetResolvedUrl, '');
  assert.match(status.runtimeContext.backendTargetInvalidReason, /No non-loopback backend target resolved/);
  assert.equal(status.routeKind, 'cloud');
  assert.equal(status.cloudRouteReachable, true);
  assert.equal(status.finalRouteTruth.routeKind, 'cloud');
  assert.equal(status.finalRouteTruth.routeUsable, true);
  assert.equal(status.finalRouteTruth.executedProvider, 'groq');
  assert.equal(status.appLaunchState, 'ready');
  assert.equal(status.fallbackActive, false);
  assert.equal(status.finalRouteTruth.fallbackActive, false);
});

test('createRuntimeStatusModel overrides hosted cloud metadata blockers when cloud execution is confirmed', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    providerHealth: {
      groq: { ok: true },
      gemini: { ok: false },
      ollama: { ok: false },
    },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: '',
      preferredTarget: '',
      actualTargetUsed: '',
      backendTargetResolutionSource: 'unresolved',
      backendTargetResolvedUrl: '',
      backendTargetInvalidReason: 'No non-loopback backend target resolved for hosted session.',
      routeDiagnostics: {
        cloud: {
          configured: true,
          available: true,
          usable: false,
          blockedReason: 'backend-target unresolved',
          reason: 'A cloud-backed Stephanos route is ready',
        },
      },
      tileTruth: {
        ready: true,
        launchSurface: 'mission-console',
      },
    },
    activeProviderHint: 'groq',
  });

  assert.equal(status.runtimeContext.sessionKind, 'hosted-web');
  assert.equal(status.routeKind, 'cloud');
  assert.equal(status.finalRouteTruth.routeUsable, true);
  assert.equal(status.canonicalRouteRuntimeTruth.routeUsable, true);
  assert.equal(status.appLaunchState, 'ready');
  assert.equal(status.runtimeTruth.diagnostics.blockingIssues.length, 0);
  assert.equal(status.routeEvaluations.cloud.usable, true);
});

test('createRuntimeStatusModel rejects same-origin static-host fallback backend target in hosted-web sessions', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    providerHealth: {
      groq: { ok: false },
      gemini: { ok: false },
      ollama: { ok: false },
    },
    backendAvailable: false,
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: 'https://cheekyfellastef.github.io',
      preferredTarget: 'https://cheekyfellastef.github.io',
      actualTargetUsed: 'https://cheekyfellastef.github.io',
      backendTargetResolutionSource: 'currentOrigin',
      nodeAddressSource: 'currentOrigin',
    },
  });

  assert.equal(status.runtimeContext.sessionKind, 'hosted-web');
  assert.equal(status.runtimeContext.backendTargetResolutionSource, 'unresolved');
  assert.equal(status.runtimeContext.backendTargetResolvedUrl, '');
  assert.equal(status.runtimeContext.backendTargetFallbackUsed, false);
  assert.match(status.runtimeContext.backendTargetInvalidReason, /Same-origin static-host backend fallback is invalid/);
});
