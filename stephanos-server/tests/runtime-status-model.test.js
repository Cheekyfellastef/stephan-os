import test from 'node:test';
import assert from 'node:assert/strict';

import { FALLBACK_PROVIDER_KEYS } from '../../shared/ai/providerDefaults.mjs';
import { createRuntimeStatusModel, getReadyCloudProviders } from '../../shared/runtime/runtimeStatusModel.mjs';
import { getTool, projectStephanosSystemDiagnosticV1 } from '../services/toolRegistry.js';
import { getSubsystemRegistry } from '../services/subsystemRegistry.js';

test('default fallback order prefers cloud providers before mock', () => {
  assert.deepEqual(FALLBACK_PROVIDER_KEYS, ['groq', 'gemini', 'mock', 'ollama']);
});

test('runtime status uses cloud-first in hosted auto mode when home node is unavailable and cloud is ready', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      ollama: { ok: false },
      groq: { ok: true },
      gemini: { ok: false },
    },
    backendAvailable: true,
    validationState: 'healthy',
    runtimeContext: {
      frontendOrigin: 'https://stephanos.example',
      apiBaseUrl: 'https://api.stephanos.example',
      tileTruth: { ready: true },
    },
  });

  assert.equal(model.effectiveRouteMode, 'cloud-first');
  assert.equal(model.activeProvider, 'groq');
  assert.equal(model.cloudAvailable, true);
  assert.equal(model.localAvailable, false);
  assert.equal(model.fallbackActive, false);
  assert.equal(model.appLaunchState, 'ready');
  assert.equal(model.routeKind, 'cloud');
  assert.equal(model.dependencySummary, 'A cloud-backed Stephanos route is ready');
});

test('runtime status surfaces pending local discovery instead of stale offline', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'local-first',
    fallbackEnabled: true,
    providerHealth: {
      ollama: { ok: false, state: 'SEARCHING' },
      groq: { ok: false },
    },
    backendAvailable: true,
    validationState: 'healthy',
  });

  assert.equal(model.localPending, true);
  assert.equal(model.localAvailable, false);
  assert.equal(model.appLaunchState, 'degraded');
  assert.equal(model.dependencySummary, 'Checking local Ollama readiness');
});

test('runtime status reports no reachable route when local desktop backend is offline', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'local-first',
    fallbackEnabled: true,
    providerHealth: {
      ollama: { ok: true },
    },
    backendAvailable: false,
    validationState: 'healthy',
  });

  assert.equal(model.appLaunchState, 'degraded');
  assert.equal(model.statusTone, 'degraded');
  assert.equal(model.routeKind, 'unavailable');
  assert.equal(model.dependencySummary, 'No reachable Stephanos route');
});

test('ready cloud provider list still filters only healthy cloud providers', () => {
  assert.deepEqual(getReadyCloudProviders({ gemini: { ok: true }, groq: { ok: false } }), ['gemini']);
});

test('runtime status surfaces a reachable home PC node separately from local desktop', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      ollama: { ok: true },
      groq: { ok: true },
    },
    backendAvailable: true,
    validationState: 'healthy',
    runtimeContext: {
      frontendOrigin: 'https://stephanos.example',
      apiBaseUrl: 'http://192.168.1.42:8787',
      homeNode: { host: '192.168.1.42', uiPort: 5173, backendPort: 8787, source: 'lastKnown', reachable: true },
      preferredTarget: 'http://192.168.1.42:8787',
      actualTargetUsed: 'http://192.168.1.42:8787',
    },
  });

  assert.equal(model.routeKind, 'home-node');
  assert.equal(model.preferredRoute, 'home-node');
  assert.equal(model.homeNodeReachable, true);
  assert.equal(model.preferredTarget, 'http://192.168.1.42:8787');
  assert.equal(model.actualTargetUsed, 'http://192.168.1.42:8787');
  assert.equal(model.nodeAddressSource, 'lastKnown');
  assert.equal(model.dependencySummary, 'Home PC node is reachable on the LAN');
});

test('pc/local browser prefers local-desktop when backend is online even if home-node is unavailable', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      groq: { ok: true },
      ollama: { ok: false },
    },
    backendAvailable: true,
    validationState: 'healthy',
    runtimeContext: {
      frontendOrigin: 'http://localhost:4173',
      apiBaseUrl: 'http://192.168.1.42:8787',
      homeNode: { host: '192.168.1.42', uiPort: 5173, backendPort: 8787, source: 'manual', reachable: false },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: false,
          source: 'manual',
          reason: 'Home PC node is configured but currently unreachable',
        },
      },
    },
  });

  assert.equal(model.routeKind, 'local-desktop');
  assert.equal(model.preferredRoute, 'local-desktop');
  assert.equal(model.routeEvaluations['local-desktop'].available, true);
  assert.equal(model.routeEvaluations['home-node'].available, false);
  assert.match(model.dependencySummary, /optional home-node is unavailable/i);
  assert.equal(model.nodeAddressSource, 'local-browser-session');
});

test('provider/router keeps live local-desktop route truth even when mock is the only healthy fallback', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      ollama: { ok: false },
      groq: { ok: false },
      gemini: { ok: false },
      mock: { ok: true },
    },
    backendAvailable: true,
    validationState: 'healthy',
    runtimeContext: {
      frontendOrigin: 'http://localhost:4173',
      baseUrl: 'http://localhost:8787',
      preferredTarget: 'https://cheekyfellastef.github.io',
      actualTargetUsed: 'http://localhost:8787',
      nodeAddressSource: 'unknown',
      routeDiagnostics: {
        'local-desktop': {
          configured: true,
          available: true,
          target: 'http://localhost:8787',
          actualTarget: 'http://localhost:8787',
          source: 'local-backend-session',
          reason: 'Backend online locally; local-desktop route is live through the active backend session',
        },
      },
    },
  });

  assert.equal(model.routeKind, 'local-desktop');
  assert.equal(model.preferredRoute, 'local-desktop');
  assert.equal(model.activeProvider, '');
  assert.equal(model.routeSelectedProvider, 'ollama');
  assert.equal(model.nodeAddressSource, 'local-backend-session');
  assert.equal(model.preferredTarget, 'http://localhost:8787');
  assert.equal(model.actualTargetUsed, 'http://localhost:8787');
  assert.equal(model.runtimeModeLabel, 'local desktop/dev');
  assert.equal(model.appLaunchState, 'degraded');
  assert.match(model.dependencySummary, /local desktop route valid/i);
});

test('failed optional home-node does not suppress a valid local-desktop route', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'local-first',
    fallbackEnabled: true,
    providerHealth: {
      ollama: { ok: true },
    },
    backendAvailable: true,
    validationState: 'healthy',
    runtimeContext: {
      frontendOrigin: 'http://127.0.0.1:4173',
      apiBaseUrl: 'http://127.0.0.1:8787',
      homeNode: { host: '192.168.1.42', source: 'manual', reachable: false },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: false,
          source: 'manual',
          reason: 'Home PC node is configured but currently unreachable',
        },
      },
    },
  });

  assert.equal(model.routeKind, 'local-desktop');
  assert.equal(model.headline, 'Local desktop runtime ready');
  assert.doesNotMatch(model.headline, /home pc node unreachable/i);
});

test('ipad/lan context prefers home-node when it is reachable', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      groq: { ok: true },
    },
    backendAvailable: true,
    validationState: 'healthy',
    runtimeContext: {
      frontendOrigin: 'https://stephanos.example',
      apiBaseUrl: 'http://192.168.1.42:8787',
      homeNode: { host: '192.168.1.42', uiPort: 5173, backendPort: 8787, source: 'lastKnown', reachable: true },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          source: 'lastKnown',
          reason: 'Home PC node is reachable on the LAN',
        },
        cloud: {
          configured: true,
          available: true,
          source: 'hosted-dist-entry',
          reason: 'Hosted/cloud Stephanos entry is available for fallback',
        },
      },
    },
  });

  assert.equal(model.runtimeContext.deviceContext, 'lan-companion');
  assert.equal(model.preferredRoute, 'home-node');
  assert.equal(model.routeKind, 'home-node');
});

test('home-node route selection remains independent from backend executable diagnostics', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      groq: { ok: true },
    },
    backendAvailable: true,
    validationState: 'healthy',
    runtimeContext: {
      frontendOrigin: 'https://stephanos.example',
      apiBaseUrl: 'http://192.168.1.42:8787',
      homeNode: { host: '192.168.1.42', source: 'lastKnown', reachable: true },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          source: 'lastKnown',
          reason: 'Home PC node is reachable on the LAN',
          backendReachable: true,
          backendExecutable: false,
        },
        cloud: {
          configured: true,
          available: true,
          source: 'hosted-dist-entry',
          reason: 'Hosted/cloud Stephanos entry is available for fallback',
          backendReachable: true,
          backendExecutable: true,
        },
      },
    },
  });

  assert.equal(model.routeKind, 'home-node');
  assert.equal(model.preferredRoute, 'home-node');
  assert.equal(model.routeEvaluations['home-node'].backendReachable, true);
});

test('hosted session ignores stale local-desktop diagnostics from restored state', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'local-first',
    fallbackEnabled: true,
    providerHealth: {
      ollama: { ok: true },
      groq: { ok: false },
    },
    backendAvailable: false,
    validationState: 'error',
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: 'https://cheekyfellastef.github.io',
      preferredTarget: 'https://cheekyfellastef.github.io',
      actualTargetUsed: 'https://cheekyfellastef.github.io',
      routeDiagnostics: {
        'local-desktop': {
          configured: true,
          available: true,
          source: 'local-backend-session',
          target: 'http://localhost:8787',
          actualTarget: 'http://localhost:8787',
          reason: 'Backend online locally; provider/router is using the live local-desktop backend session',
        },
      },
    },
  });

  assert.equal(model.runtimeContext.sessionKind, 'hosted-web');
  assert.equal(model.routeKind, 'unavailable');
  assert.equal(model.headline, 'No reachable Stephanos route');
  assert.equal(model.dependencySummary, 'No reachable Stephanos route');
  assert.equal(model.preferredTarget, 'https://cheekyfellastef.github.io');
  assert.equal(model.actualTargetUsed, 'https://cheekyfellastef.github.io');
});

test('route model does not emit source unknown when structured route status exists', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      groq: { ok: true },
    },
    backendAvailable: true,
    validationState: 'healthy',
    runtimeContext: {
      frontendOrigin: 'https://stephanos.example',
      apiBaseUrl: 'https://api.stephanos.example',
      routeDiagnostics: {
        cloud: {
          configured: true,
          available: true,
          source: 'hosted-dist-entry',
          reason: 'Hosted/cloud Stephanos entry is available for fallback',
        },
      },
    },
  });

  assert.notEqual(model.nodeAddressSource, 'unknown');
  assert.equal(model.nodeAddressSource, 'hosted-dist-entry');
});

test('mock remains the selected provider only when explicitly requested by the user', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'mock',
    routeMode: 'explicit',
    fallbackEnabled: true,
    providerHealth: {
      mock: { ok: true },
      ollama: { ok: false },
    },
    backendAvailable: true,
    validationState: 'healthy',
    runtimeContext: {
      frontendOrigin: 'http://localhost:4173',
      apiBaseUrl: 'http://localhost:8787',
      routeDiagnostics: {
        'local-desktop': {
          configured: true,
          available: true,
          target: 'http://localhost:8787',
          actualTarget: 'http://localhost:8787',
          source: 'local-backend-session',
          reason: 'Backend online locally; local-desktop route is live through the active backend session',
        },
      },
    },
  });

  assert.equal(model.routeKind, 'local-desktop');
  assert.equal(model.activeProvider, 'mock');
  assert.equal(model.routeSelectedProvider, 'mock');
});

test('backend online local session keeps local-desktop truth even when explicit route probes are missing', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      groq: { ok: false },
    },
    backendAvailable: true,
    validationState: 'error',
    runtimeContext: {
      frontendOrigin: 'http://localhost:4173',
      apiBaseUrl: 'http://localhost:8787',
      routeDiagnostics: {
        'local-desktop': {
          configured: true,
          available: false,
          misconfigured: true,
          source: 'local-browser-session',
          reason: 'Backend online but no local runtime target was selected',
        },
        cloud: {
          configured: false,
          available: false,
          source: 'cloud-route-unavailable',
          reason: 'Hosted/cloud Stephanos entry is unavailable',
        },
      },
    },
  });

  assert.equal(model.routeKind, 'local-desktop');
  assert.equal(model.headline, 'Local desktop runtime ready');
  assert.match(model.dependencySummary, /local desktop route valid/i);
  assert.equal(model.classificationFailed, true);
});


test('runtime status keeps provider eligibility aligned with finalRoute truth for cloud sessions', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      groq: { ok: true },
      ollama: { ok: false },
    },
    backendAvailable: true,
    validationState: 'healthy',
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

  assert.equal(model.finalRoute.routeKind, 'cloud');
  assert.equal(model.finalRoute.providerEligibility.backendMediatedProviders, false);
  assert.equal(model.finalRoute.providerEligibility.cloudProviders, true);
  assert.equal(model.guardrails.summary.errors, 0);
});

test('final route truth snapshot stays aligned with selected route and provider execution truth', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      ollama: { ok: true },
      groq: { ok: true },
    },
    backendAvailable: true,
    validationState: 'healthy',
    activeProviderHint: 'groq',
    runtimeContext: {
      frontendOrigin: 'https://stephanos.example',
      apiBaseUrl: 'http://192.168.1.42:8787',
      homeNode: { host: '192.168.1.42', uiPort: 5173, backendPort: 8787, source: 'manual', reachable: true },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          backendReachable: true,
          uiReachable: true,
          usable: true,
          source: 'manual',
          reason: 'Home PC node is reachable on the LAN',
        },
      },
    },
  });

  assert.equal(model.finalRouteTruth.sessionKind, 'hosted-web');
  assert.equal(model.finalRouteTruth.routeKind, 'home-node');
  assert.equal(model.finalRouteTruth.homeNodeUsable, true);
  assert.equal(model.finalRouteTruth.uiReachable, true);
  assert.equal(model.finalRouteTruth.selectedProvider, model.routeSelectedProvider);
  assert.equal(model.finalRouteTruth.executedProvider, model.activeProvider);
});

test('local operator override removes home-node usability from final truth on local desktop', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      ollama: { ok: true },
    },
    backendAvailable: true,
    validationState: 'healthy',
    runtimeContext: {
      frontendOrigin: 'http://localhost:4173',
      apiBaseUrl: 'http://localhost:8787',
      homeNode: { host: '192.168.1.42', source: 'manual', reachable: true },
      homeNodeOperatorOverrideActive: true,
      homeNodeOperatorOverrideNodeConfigured: true,
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          backendReachable: true,
          uiReachable: true,
          usable: true,
          source: 'manual',
          reason: 'Home PC node is reachable on the LAN',
        },
      },
    },
  });

  assert.equal(model.routeKind, 'local-desktop');
  assert.equal(model.routeEvaluations['home-node'].available, false);
  assert.equal(model.finalRouteTruth.homeNodeUsable, false);
  assert.equal(model.finalRouteTruth.routeKind, 'local-desktop');
});

test('backend reachable state clears stale local-desktop offline route blocker', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      groq: { ok: false },
    },
    backendAvailable: true,
    validationState: 'healthy',
    runtimeContext: {
      sessionKind: 'local-desktop',
      deviceContext: 'pc-local-browser',
      routeDiagnostics: {
        'local-desktop': {
          configured: true,
          available: false,
          usable: false,
          blockedReason: 'backend is offline',
          reason: 'stale diagnostics',
        },
      },
      healthProbeTruth: {
        lastBackendHealthProbeAt: '',
        lastBackendHealthProbeResult: 'ok:true',
        routeTruthHealthSource: 'refresh-health-poll',
      },
    },
  });

  const localDesktop = model.routeCandidates.find((candidate) => candidate.candidateKey === 'local-desktop');
  assert.equal(model.routeKind, 'local-desktop');
  assert.equal(model.finalRouteTruth.backendReachable, true);
  assert.equal(localDesktop.reachable, true);
  assert.equal(localDesktop.usable, true);
  assert.notEqual(localDesktop.state, 'configured-unreachable');
});

test('fresh local-desktop health probe outranks home-node/manual in local sessions', () => {
  const nowIso = new Date().toISOString();
  const model = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      groq: { ok: false },
    },
    backendAvailable: false,
    validationState: 'healthy',
    runtimeContext: {
      sessionKind: 'local-desktop',
      deviceContext: 'pc-local-browser',
      routeDiagnostics: {
        'local-desktop': {
          configured: true,
          available: false,
          usable: false,
          blockedReason: 'backend is offline',
          reason: 'stale diagnostics',
        },
        'home-node': {
          configured: true,
          available: true,
          usable: true,
          backendReachable: true,
          uiReachable: true,
          source: 'manual',
          target: 'http://192.168.0.198:8787',
          actualTarget: 'http://192.168.0.198:8787',
          reason: 'Home PC node is reachable on the LAN',
        },
      },
      healthProbeTruth: {
        lastBackendHealthProbeAt: nowIso,
        lastBackendHealthProbeResult: 'ok:true',
        currentBackendHealthSource: 'refresh-health-poll',
      },
    },
  });

  assert.equal(model.routeKind, 'local-desktop');
  assert.equal(model.preferredRoute, 'local-desktop');
  assert.equal(model.routeCandidateWinner?.candidateKey, 'local-desktop');
  assert.equal(model.routeEvaluations['local-desktop'].backendReachable, true);
  assert.equal(model.finalRouteTruth.backendReachable, true);
  assert.equal(model.finalRouteTruth.networkReachabilityState, 'reachable');
});

test('Stephanos AI /status does not claim nominal health from a configured AI route alone', () => {
  const status = projectStephanosSystemDiagnosticV1({
    aiRouteConfigured: true,
    commanderObservation: {
      schemaVersion: 'stephanos.ai-sovereign-commander-health.v1',
      readOnly: true, localLoopbackOnly: true, available: false, healthy: false,
      state: 'UNKNOWN', blocker: 'COMMANDER_HEALTH_UNREACHABLE',
    },
  });
  assert.equal(status.readiness, 'UNVERIFIED');
  assert.equal(status.aiRouteConfigured, true);
  assert.equal(status.aiModelExecutionProven, false);
  assert.equal(status.physicalWorkerPickupProven, false);
  assert.equal(status.installedFixedRuntimeProven, false);
  assert.equal(status.catalogIsExecutionEvidence, false);
  assert.equal(status.blocker, 'COMMANDER_HEALTH_UNREACHABLE');
  assert.equal(status.readOnly, true);
  assert.equal(status.sourceMutationAllowed, false);
  assert.equal(status.mergeAuthority, false);
  assert.equal(getTool('getSystemStatus').state, 'live');
});

test('Stephanos AI reports a reachable sovereign with failed last guarded repair as blocked', () => {
  const status = projectStephanosSystemDiagnosticV1({
    aiRouteConfigured: true,
    commanderObservation: {
      schemaVersion: 'stephanos.ai-sovereign-commander-health.v1',
      readOnly: true, localLoopbackOnly: true,
      available: true, healthy: true, state: 'SERVICE_REACHABLE',
      guardian: {
        lastOk: false, lastBlocker: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING',
        lastSourceHead: '',
      },
    },
  });
  assert.equal(status.readiness, 'BLOCKED');
  assert.equal(status.commanderReachable, true);
  assert.equal(status.guardianLastRepairFailed, true);
  assert.equal(status.blocker, 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING');
  assert.equal(status.nextSafeStep, 'VERIFY_EXACT_MAIN_FIXED_RUNTIME_INSTALLATION');
  assert.equal(status.guardianLastSourceHead, '');
  assert.equal(status.physicalWorkerPickupProven, false);
});

test('healthy Commander service and even a successful guardian do not prove a model or worker build', () => {
  const status = projectStephanosSystemDiagnosticV1({
    aiRouteConfigured: true,
    commanderObservation: {
      schemaVersion: 'stephanos.ai-sovereign-commander-health.v1',
      readOnly: true, localLoopbackOnly: true,
      available: true, healthy: true, state: 'SERVICE_REACHABLE',
      guardian: { lastOk: true, lastSourceHead: 'a'.repeat(40) },
    },
  });
  assert.equal(status.readiness, 'PARTIAL');
  assert.equal(status.guardianLastRepairSucceeded, true);
  assert.equal(status.guardianLastRepairFailed, false);
  assert.equal(status.blocker, 'PHYSICAL_WORKER_PICKUP_UNPROVEN');
  assert.equal(status.aiModelExecutionProven, false);
  assert.equal(status.physicalWorkerPickupProven, false);
  assert.equal(status.installedFixedRuntimeProven, false);
});

test('forged Commander health without original loopback provenance is rejected for status', () => {
  for (const fake of [
    { available: true, healthy: true, state: 'SERVICE_REACHABLE' },
    { schemaVersion: 'stephanos.ai-sovereign-commander-health.v1',
      available: true, healthy: true, state: 'SERVICE_REACHABLE',
      readOnly: false, localLoopbackOnly: true },
    { schemaVersion: 'stephanos.ai-sovereign-commander-health.v1',
      available: true, healthy: true, state: 'SERVICE_REACHABLE',
      readOnly: true, localLoopbackOnly: false },
  ]) {
    const status = projectStephanosSystemDiagnosticV1({ aiRouteConfigured: true, commanderObservation: fake });
    assert.equal(status.commanderReachable, false);
    assert.equal(status.readiness, 'UNVERIFIED');
    assert.equal(status.physicalWorkerPickupProven, false);
  }
});

test('static AI Core subsystem registry is never accepted as runtime health proof', () => {
  const aiCore = getSubsystemRegistry().find((s) => s.id === 'ai_core');
  assert.ok(aiCore);
  assert.equal(aiCore.state, 'live', 'tool registration must remain discoverable');
  assert.equal(aiCore.health.status, 'unverified');
  assert.equal(aiCore.health.evidenceScope, 'registry-declaration-only');
  assert.equal(aiCore.health.liveRuntimeProven, false);
});

test('Stephanos AI repairs the real upstream health dependency before checking worker pickup', () => {
  const expected = [
    {
      name: 'Commander unavailable',
      value: { schemaVersion: 'stephanos.ai-sovereign-commander-health.v1',
        readOnly: true, localLoopbackOnly: true, available: false, healthy: false,
        state: 'UNKNOWN', blocker: 'COMMANDER_HEALTH_UNREACHABLE' },
      owner: '#2573', step: 'VERIFY_COMMANDER_HEALTH_PROVENANCE',
      readiness: 'UNVERIFIED',
    },
    {
      name: 'untrusted observer',
      value: { schemaVersion: 'stephanos.ai-sovereign-commander-health.v1',
        readOnly: false, localLoopbackOnly: true, available: true, healthy: true,
        state: 'SERVICE_REACHABLE' },
      owner: '#2573', step: 'VERIFY_COMMANDER_HEALTH_PROVENANCE',
      readiness: 'UNVERIFIED',
    },
    {
      name: 'missing observation',
      value: null,
      owner: '#2573', step: 'VERIFY_COMMANDER_HEALTH_PROVENANCE',
      readiness: 'UNVERIFIED',
    },
    {
      name: 'degraded health',
      value: { schemaVersion: 'stephanos.ai-sovereign-commander-health.v1',
        readOnly: true, localLoopbackOnly: true, available: true, healthy: false,
        state: 'SERVICE_DEGRADED', blocker: 'COMMANDER_HEALTH_NOT_READY' },
      owner: '#2573', step: 'VERIFY_COMMANDER_HEALTH_PROVENANCE',
      readiness: 'UNVERIFIED',
    },
    {
      name: 'reachable but fixed runtime absent',
      value: { schemaVersion: 'stephanos.ai-sovereign-commander-health.v1',
        readOnly: true, localLoopbackOnly: true, available: true, healthy: true,
        state: 'SERVICE_REACHABLE',
        guardian: { lastOk: false, lastBlocker: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING' } },
      owner: '#2961', step: 'VERIFY_EXACT_MAIN_FIXED_RUNTIME_INSTALLATION',
      readiness: 'BLOCKED',
    },
    {
      name: 'reachable guardian success is only partial',
      value: { schemaVersion: 'stephanos.ai-sovereign-commander-health.v1',
        readOnly: true, localLoopbackOnly: true, available: true, healthy: true,
        state: 'SERVICE_REACHABLE', guardian: { lastOk: true } },
      owner: '#2961', step: 'VERIFY_CANONICAL_NATIVE_WORKER_PICKUP',
      readiness: 'PARTIAL',
    },
  ];
  for (const item of expected) {
    const diagnostic = projectStephanosSystemDiagnosticV1({
      aiRouteConfigured: true, commanderObservation: item.value,
    });
    assert.equal(diagnostic.readiness, item.readiness, item.name);
    assert.equal(diagnostic.nextProofOwnerGoal, item.owner, item.name);
    assert.equal(diagnostic.nextSafeStep, item.step, item.name);
    assert.equal(diagnostic.physicalWorkerPickupProven, false, item.name);
    assert.equal(diagnostic.aiModelExecutionProven, false, item.name);
    assert.equal(diagnostic.sourceMutationAllowed, false, item.name);
    assert.equal(diagnostic.mergeAuthority, false, item.name);
  }
});


test('reachable Commander with absent or malformed guardian terminal evidence stays upstream UNVERIFIED', () => {
  const malformedGuardians = [
    undefined, null, {}, [], 'yes', { lastOk: null }, { lastOk: 'true' },
    { lastOk: 1 }, { lastOk: 0 },
  ];
  for (const [index, guardian] of malformedGuardians.entries()) {
    const diagnostic = projectStephanosSystemDiagnosticV1({
      aiRouteConfigured: true,
      commanderObservation: {
        schemaVersion: 'stephanos.ai-sovereign-commander-health.v1',
        readOnly: true, localLoopbackOnly: true,
        available: true, healthy: true, state: 'SERVICE_REACHABLE',
        guardian,
      },
    });
    assert.equal(diagnostic.commanderReachable, true, String(index));
    assert.equal(diagnostic.readiness, 'UNVERIFIED', String(index));
    assert.equal(diagnostic.blocker, 'SOVEREIGN_GUARDIAN_TERMINAL_PROOF_UNVERIFIED', String(index));
    assert.equal(diagnostic.nextProofOwnerGoal, '#2573', String(index));
    assert.equal(diagnostic.nextSafeStep, 'VERIFY_SOVEREIGN_GUARDIAN_TERMINAL_PROOF', String(index));
    assert.equal(diagnostic.guardianLastRepairSucceeded, false, String(index));
    assert.equal(diagnostic.guardianLastRepairFailed, false, String(index));
    assert.equal(diagnostic.physicalWorkerPickupProven, false, String(index));
    assert.equal(diagnostic.aiModelExecutionProven, false, String(index));
    assert.equal(diagnostic.sourceMutationAllowed, false, String(index));
    assert.equal(diagnostic.mergeAuthority, false, String(index));
  }
});

test('reachable Commander with failed upstream maintenance never recommends downstream worker pickup', () => {
  const failedBlockers = [
    'SOVEREIGN_MAINTENANCE_OWNER_PROTOCOL_REQUIRED',
    'MAILBOX_OUTBOX_LEGACY_RECONCILIATION_TERMINAL_UNPROVEN',
    'CORE_RECOVERY_INVENTORY_EXPIRED',
    'SOVEREIGN_LAST_REPAIR_FAILED',
    '',
  ];
  for (const lastBlocker of failedBlockers) {
    const diagnostic = projectStephanosSystemDiagnosticV1({
      aiRouteConfigured: true,
      commanderObservation: {
        schemaVersion: 'stephanos.ai-sovereign-commander-health.v1',
        readOnly: true, localLoopbackOnly: true,
        available: true, healthy: true, state: 'SERVICE_REACHABLE',
        guardian: { lastOk: false, lastBlocker },
      },
    });
    assert.equal(diagnostic.readiness, 'BLOCKED', lastBlocker);
    assert.equal(diagnostic.blocker, lastBlocker || 'SOVEREIGN_LAST_REPAIR_FAILED', lastBlocker);
    assert.equal(diagnostic.nextProofOwnerGoal, '#2573', lastBlocker);
    assert.equal(diagnostic.nextSafeStep, 'VERIFY_SOVEREIGN_MAINTENANCE_BLOCKER', lastBlocker);
    assert.equal(diagnostic.guardianLastRepairFailed, true, lastBlocker);
    assert.equal(diagnostic.physicalWorkerPickupProven, false, lastBlocker);
    assert.equal(diagnostic.aiModelExecutionProven, false, lastBlocker);
    assert.equal(diagnostic.sourceMutationAllowed, false, lastBlocker);
    assert.equal(diagnostic.mergeAuthority, false, lastBlocker);
  }
});
