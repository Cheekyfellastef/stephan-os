import test from 'node:test';
import assert from 'node:assert/strict';

import { createRuntimeStatusModel } from './runtimeStatusModel.mjs';

test('createRuntimeStatusModel selects home-node route with bridge variant for hosted off-network sessions', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: 'https://bridge.example.com',
      homeNode: { host: '192.168.1.42', configured: true, reachable: false, source: 'manual' },
      homeNodeBridge: {
        configured: true,
        accepted: true,
        backendUrl: 'https://bridge.example.com',
        reachability: 'reachable',
        reason: 'Home-node bridge configured and reachable.',
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          routeVariant: 'home-node-bridge',
          source: 'home-node-bridge',
          target: 'https://bridge.example.com',
          actualTarget: 'https://bridge.example.com',
          reason: 'Home-node bridge configured and reachable for hosted/off-network session',
        },
        'home-node-bridge': {
          configured: true,
          available: true,
          source: 'home-node-bridge',
          target: 'https://bridge.example.com',
          actualTarget: 'https://bridge.example.com',
          reason: 'Home-node bridge configured and reachable',
        },
        cloud: { configured: false, available: false },
        dist: { configured: true, available: true, target: './apps/stephanos/dist/index.html', actualTarget: './apps/stephanos/dist/index.html' },
      },
    },
  });

  assert.equal(model.routeKind, 'home-node');
  assert.equal(model.finalRoute.routeVariant, 'home-node-bridge');
  assert.equal(model.finalRoute.actualTarget, 'https://bridge.example.com');
  assert.equal(model.runtimeModeLabel, 'home node/bridge');
});

test('createRuntimeStatusModel prefers LAN home-node variant over bridge when hosted session is on LAN', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'http://192.168.1.80:5173',
      apiBaseUrl: 'http://192.168.1.42:8787',
      homeNode: { host: '192.168.1.42', configured: true, reachable: true, source: 'manual' },
      homeNodeBridge: {
        configured: true,
        accepted: true,
        backendUrl: 'https://bridge.example.com',
        reachability: 'reachable',
        reason: 'Home-node bridge configured and reachable.',
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          routeVariant: 'home-node-lan',
          source: 'manual',
          target: 'http://192.168.1.42:8787',
          actualTarget: 'http://192.168.1.42:8787',
          reason: 'Home PC node is reachable on the LAN',
        },
        'home-node-lan': {
          configured: true,
          available: true,
          source: 'manual',
          target: 'http://192.168.1.42:8787',
          actualTarget: 'http://192.168.1.42:8787',
          reason: 'Home PC node is reachable on the LAN',
        },
        'home-node-bridge': {
          configured: true,
          available: true,
          source: 'home-node-bridge',
          target: 'https://bridge.example.com',
          actualTarget: 'https://bridge.example.com',
          reason: 'Home-node bridge configured and reachable',
        },
        cloud: { configured: true, available: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
        dist: { configured: true, available: true, target: './apps/stephanos/dist/index.html', actualTarget: './apps/stephanos/dist/index.html' },
      },
    },
  });

  assert.equal(model.routeKind, 'home-node');
  assert.equal(model.finalRoute.routeVariant, 'home-node-lan');
  assert.equal(model.finalRoute.actualTarget, 'http://192.168.1.42:8787');
});

test('createRuntimeStatusModel surfaces tailscale backend target candidate truthfully for hosted sessions', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: 'https://100.64.0.10',
            accepted: true,
            active: true,
            reachability: 'reachable',
            usable: true,
            deviceName: 'home-node',
            tailnetIp: '100.64.0.10',
          },
        },
      },
      routeDiagnostics: {
        'home-node-bridge': { configured: true, available: true, target: 'https://100.64.0.10', actualTarget: 'https://100.64.0.10' },
        cloud: { configured: true, available: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  const tailscaleCandidate = model.runtimeContext.backendTargetCandidates.find((candidate) => candidate.url === 'https://100.64.0.10');
  assert.ok(tailscaleCandidate);
  assert.equal(tailscaleCandidate.accepted, true);
  assert.equal(model.runtimeContext.bridgeTransportTruth.selectedTransport, 'tailscale');
});

test('createRuntimeStatusModel prefers tailscale HTTPS execution URL over operator transport URL for hosted sessions', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: 'http://desktop-9flonkj.taild6f215.ts.net:8787',
            executionUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
            accepted: true,
            active: true,
            reachability: 'reachable',
            usable: true,
          },
        },
      },
      routeDiagnostics: {
        'home-node-bridge': {
          configured: true,
          available: true,
          target: 'https://desktop-9flonkj.taild6f215.ts.net',
          actualTarget: 'https://desktop-9flonkj.taild6f215.ts.net',
        },
        cloud: { configured: true, available: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  assert.equal(model.runtimeContext.backendTargetResolvedUrl, 'https://desktop-9flonkj.taild6f215.ts.net');
  assert.equal(model.runtimeContext.backendTargetCandidates[0].url, 'https://desktop-9flonkj.taild6f215.ts.net');
});

test('hosted backend target candidate order prefers remembered tailscale bridge over stale LAN manual candidate', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      homeNodeBridge: {
        configured: true,
        accepted: true,
        backendUrl: 'https://100.64.0.10',
        reachability: 'reachable',
      },
      bridgeMemory: {
        transport: 'tailscale',
        backendUrl: 'https://100.64.0.10',
      },
      bridgeTransportTruth: {
        selectedTransport: 'tailscale',
        bridgeMemoryReconciliationState: 'remembered-revalidated',
        bridgeMemoryUrl: 'https://100.64.0.10',
        tailscale: {
          backendUrl: 'https://100.64.0.10',
          accepted: true,
          reachable: true,
        },
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: false,
          target: 'http://192.168.1.42:8787',
          actualTarget: 'http://192.168.1.42:8787',
        },
        'home-node-bridge': {
          configured: true,
          available: true,
          target: 'https://100.64.0.10',
          actualTarget: 'https://100.64.0.10',
        },
        cloud: { configured: true, available: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  assert.equal(model.runtimeContext.backendTargetResolvedUrl, 'https://100.64.0.10');
  assert.equal(model.runtimeContext.backendTargetCandidates[0].url, 'https://100.64.0.10');
});

test('hosted remembered tailscale revalidation promotes live transport truth and preferred backend target', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      homeNodeBridge: {
        configured: true,
        accepted: true,
        backendUrl: 'http://192.168.0.198:8787',
        reachability: 'reachable',
      },
      bridgeMemory: {
        transport: 'tailscale',
        backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
      },
      bridgeAutoRevalidation: {
        state: 'revalidated',
        reason: 'Remembered Home Bridge revalidated successfully.',
      },
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          manual: {
            enabled: true,
            backendUrl: 'http://192.168.0.198:8787',
            accepted: true,
            reachability: 'reachable',
          },
          tailscale: {
            enabled: true,
            backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
            accepted: true,
            active: true,
            reachability: 'reachable',
            usable: true,
          },
        },
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          usable: true,
          source: 'home-node-bridge',
          routeVariant: 'home-node-bridge',
          target: 'http://192.168.0.198:8787',
          actualTarget: 'https://desktop-9flonkj.taild6f215.ts.net',
        },
        'home-node-bridge': {
          configured: true,
          available: true,
          usable: true,
          target: 'https://desktop-9flonkj.taild6f215.ts.net',
          actualTarget: 'https://desktop-9flonkj.taild6f215.ts.net',
        },
        cloud: { configured: true, available: true, usable: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  assert.equal(model.runtimeContext.bridgeTransportTruth.selectedTransport, 'tailscale');
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryReconciliationProvenance, 'remembered-tailscale-revalidated-as-tailscale');
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.backendUrl, 'https://desktop-9flonkj.taild6f215.ts.net');
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.accepted, true);
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.reachable, true);
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.usable, true);
  assert.equal(model.runtimeContext.backendTargetResolvedUrl, 'https://desktop-9flonkj.taild6f215.ts.net');
  assert.equal(model.runtimeContext.routeCandidateWinner.candidateKey, 'home-node-tailscale');
  assert.equal(model.runtimeContext.preferredTarget, 'https://desktop-9flonkj.taild6f215.ts.net');
  assert.equal(model.runtimeContext.actualTargetUsed, 'https://desktop-9flonkj.taild6f215.ts.net');
});

test('hosted remembered tailscale http bridge remains operator-authoritative through runtimeStatusModel flow', () => {
  const bridgeUrl = 'http://desktop-9flonkj.taild6f215.ts.net:8787';
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      bridgeMemory: {
        transport: 'tailscale',
        backendUrl: bridgeUrl,
      },
      bridgeAutoRevalidation: {
        state: 'revalidated',
        reason: 'Remembered Home Bridge revalidated successfully.',
      },
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: bridgeUrl,
            accepted: true,
            active: true,
            reachability: 'reachable',
            usable: true,
          },
        },
      },
      routeDiagnostics: {
        'home-node-bridge': {
          configured: true,
          available: true,
          usable: true,
          target: bridgeUrl,
          actualTarget: bridgeUrl,
          source: 'bridgeTransport:tailscale',
        },
        cloud: { configured: true, available: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryUrl, bridgeUrl);
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.backendUrl, bridgeUrl);
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.accepted, true);
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.reachable, true);
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.usable, true);
  assert.equal(model.runtimeContext.backendTargetResolvedUrl, bridgeUrl);
});

test('hosted remembered tailscale pending probe does not auto-promote canonical route truth before acceptance', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: false,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      preferredTarget: 'http://192.168.0.198:8787',
      actualTargetUsed: 'http://192.168.0.198:8787',
      bridgeMemory: {
        transport: 'tailscale',
        backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
      },
      bridgeMemoryRehydrated: true,
      bridgeAutoRevalidation: {
        state: 'probing',
        reason: 'Remembered bridge validated; probing reachability from this surface.',
      },
      bridgeTransportPreferences: {
        selectedTransport: 'manual',
        transports: {
          manual: {
            enabled: true,
            backendUrl: 'http://192.168.0.198:8787',
            accepted: true,
            reachability: 'reachable',
          },
        },
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: false,
          target: 'http://192.168.0.198:8787',
          actualTarget: 'http://192.168.0.198:8787',
          blockedReason: 'hosted surface cannot reach LAN target',
        },
        'home-node-bridge': {
          configured: true,
          available: false,
          target: 'https://desktop-9flonkj.taild6f215.ts.net',
          actualTarget: 'https://desktop-9flonkj.taild6f215.ts.net',
          blockedReason: 'probe pending',
        },
      },
    },
  });

  assert.equal(model.runtimeContext.bridgeTransportTruth.selectedTransport, 'manual');
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryReconciliationState, 'remembered-awaiting-validation');
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeAutoRevalidationState, 'probing');
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.accepted, false);
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.usable, false);
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryReconciliationProvenance, 'remembered-tailscale-awaiting-validation');
  const staleLanCandidate = model.runtimeContext.backendTargetCandidates.find((candidate) => candidate.url === 'http://192.168.0.198:8787');
  assert.ok(staleLanCandidate);
  assert.equal(staleLanCandidate.accepted, false);
});

test('route candidates keep configured/reachable/usable truth separated for unreachable tailscale', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: 'https://100.64.0.10',
            accepted: true,
            active: false,
            reachability: 'unreachable',
            usable: false,
          },
        },
      },
      routeDiagnostics: {
        'home-node-bridge': { configured: true, available: false, blockedReason: 'tailscale transport unreachable' },
        cloud: { configured: true, available: true, usable: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  const tailscaleCandidate = model.runtimeContext.routeCandidates.find((candidate) => candidate.candidateKey === 'home-node-tailscale');
  assert.ok(tailscaleCandidate);
  assert.equal(tailscaleCandidate.configured, true);
  assert.equal(tailscaleCandidate.reachable, false);
  assert.equal(tailscaleCandidate.usable, false);
  assert.equal(model.runtimeContext.routeCandidateWinner.routeKind, 'cloud');
});

test('hosted remembered tailscale cannot remain revalidated when backend target candidate is rejected', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      bridgeMemory: {
        transport: 'tailscale',
        backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
      },
      bridgeAutoRevalidation: { state: 'revalidated', reason: 'Remembered Home Bridge revalidated successfully.' },
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
            accepted: false,
            active: true,
            reachability: 'unknown',
            usable: true,
          },
        },
      },
      routeDiagnostics: {
        'home-node': { configured: true, available: false, target: 'https://desktop-9flonkj.taild6f215.ts.net', actualTarget: 'https://desktop-9flonkj.taild6f215.ts.net' },
        'home-node-bridge': { configured: true, available: false, target: 'https://desktop-9flonkj.taild6f215.ts.net', actualTarget: 'https://desktop-9flonkj.taild6f215.ts.net', blockedReason: 'probe evidence missing' },
        cloud: { configured: true, available: true, usable: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryReconciliationState, 'remembered-awaiting-validation');
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryReconciliationProvenance, 'remembered-candidate-not-yet-accepted');
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeAutoRevalidationState, 'probing');
});

test('hosted bridge transport truth cannot stay active/revalidated when route winner is none', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: false,
    providerHealth: { groq: { ok: false } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      bridgeMemory: {
        transport: 'tailscale',
        backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
      },
      bridgeAutoRevalidation: { state: 'revalidated', reason: 'Remembered Home Bridge revalidated successfully.' },
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
            accepted: false,
            active: true,
            reachability: 'unknown',
            usable: true,
          },
        },
      },
      routeDiagnostics: {
        'home-node': { configured: true, available: false, target: 'https://desktop-9flonkj.taild6f215.ts.net', actualTarget: 'https://desktop-9flonkj.taild6f215.ts.net' },
        'home-node-bridge': { configured: true, available: false, target: 'https://desktop-9flonkj.taild6f215.ts.net', actualTarget: 'https://desktop-9flonkj.taild6f215.ts.net' },
        cloud: { configured: false, available: false, usable: false },
        dist: { configured: false, available: false, usable: false },
      },
    },
  });

  assert.equal(model.runtimeContext.routeCandidateWinner, null);
  assert.notEqual(model.runtimeContext.bridgeTransportTruth.state, 'active');
  assert.equal(model.runtimeContext.bridgeTransportTruth.activeTransport, 'none');
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryReconciliationState, 'remembered-awaiting-validation');
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeAutoRevalidationState, 'probing');
});

test('hosted remembered-revalidated tailscale promotes route winner when backend target evidence is accepted', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      homeNodeBridge: {
        configured: true,
        accepted: true,
        backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
        reachability: 'reachable',
      },
      bridgeMemory: {
        transport: 'tailscale',
        backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
      },
      bridgeAutoRevalidation: { state: 'revalidated', reason: 'Remembered Home Bridge revalidated successfully.' },
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
            accepted: true,
            active: true,
            reachability: 'reachable',
            usable: true,
          },
        },
      },
      routeDiagnostics: {
        'home-node': { configured: true, available: false, usable: false, source: 'stale-home-node-probe' },
        'home-node-bridge': { configured: true, available: false, usable: false, source: 'stale-bridge-probe', blockedReason: 'stale route probe' },
        cloud: { configured: true, available: true, usable: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  assert.equal(model.runtimeContext.routeCandidateWinner?.candidateKey, 'home-node-tailscale');
  assert.equal(model.finalRoute.routeKind, 'home-node');
  assert.equal(model.finalRoute.actualTarget, 'https://desktop-9flonkj.taild6f215.ts.net');
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryReconciliationState, 'remembered-revalidated');
});

test('hosted https with remembered http bridge classifies execution-incompatible instead of generic unreachable', () => {
  const bridgeUrl = 'http://desktop-9flonkj.taild6f215.ts.net:8787';
  const staleLanUrl = 'http://192.168.0.198:8787';
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      preferredTarget: staleLanUrl,
      actualTargetUsed: staleLanUrl,
      bridgeMemory: { transport: 'tailscale', backendUrl: bridgeUrl },
      bridgeAutoRevalidation: {
        state: 'execution-incompatible',
        reason: 'Hosted HTTPS frontend cannot execute HTTP Home Bridge fetches due browser mixed-content policy.',
        directReachability: 'reachable',
        executionCompatibility: 'mixed-scheme-blocked',
        infrastructureRequirement: 'Publish HTTPS bridge endpoint.',
      },
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: bridgeUrl,
            accepted: false,
            active: false,
            reachability: 'reachable',
            usable: false,
          },
        },
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          target: staleLanUrl,
          actualTarget: staleLanUrl,
        },
        'home-node-bridge': {
          configured: true,
          available: true,
          target: bridgeUrl,
          actualTarget: bridgeUrl,
        },
        cloud: { configured: true, available: true, usable: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryReconciliationState, 'remembered-execution-incompatible');
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeHostedExecutionCompatibility, 'mixed-scheme-blocked');
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeDirectReachability, 'reachable');
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeInputRaw, bridgeUrl);
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeInputNormalized, bridgeUrl);
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgePersistedValue, bridgeUrl);
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeProbeTarget, bridgeUrl);
  assert.match(model.runtimeContext.bridgeTransportTruth.tailscale.reason, /cannot execute HTTP Home Bridge fetches/i);
  assert.equal(model.runtimeContext.preferredTarget, '');
  assert.equal(model.runtimeContext.actualTargetUsed, '');
  const staleLanCandidate = model.runtimeContext.backendTargetCandidates.find((candidate) => candidate.url === staleLanUrl);
  assert.equal(staleLanCandidate, undefined);
  assert.equal(model.runtimeContext.canonicalHostedRouteTruth.blockingIssues[0].code, 'hosted-backend-execution-incompatible');
});

test('hosted remembered-revalidated tailscale downgrades to blocker state when backend evidence is not accepted', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: false,
    providerHealth: { groq: { ok: false } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      homeNodeBridge: {
        configured: true,
        accepted: false,
        backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
        reachability: 'unknown',
      },
      bridgeMemory: {
        transport: 'tailscale',
        backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
      },
      bridgeAutoRevalidation: { state: 'revalidated', reason: 'Remembered Home Bridge revalidated successfully.' },
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
            accepted: false,
            active: true,
            reachability: 'unknown',
            usable: true,
          },
        },
      },
      routeDiagnostics: {
        'home-node': { configured: true, available: false, source: 'probe-missing' },
        'home-node-bridge': { configured: true, available: false, source: 'probe-missing' },
        cloud: { configured: false, available: false, usable: false },
        dist: { configured: false, available: false, usable: false },
      },
    },
  });

  assert.equal(model.runtimeContext.routeCandidateWinner, null);
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryReconciliationState, 'remembered-awaiting-validation');
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryReconciliationProvenance, 'remembered-candidate-not-yet-accepted');
  assert.equal(model.runtimeContext.bridgeTransportTruth.state, 'configured');
  assert.equal(model.runtimeContext.bridgeTransportTruth.activeTransport, 'none');
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeAutoRevalidationState, 'probing');
});

test('hosted lan-companion canonicalizes validated remembered tailscale bridge and avoids rejected LAN backend drift', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: 'http://192.168.0.198:8787',
      homeNode: {
        configured: true,
        reachable: true,
        backendUrl: 'http://192.168.0.198:8787',
        source: 'manual',
      },
      homeNodeBridge: {
        configured: true,
        accepted: true,
        backendUrl: 'http://192.168.0.198:8787',
        reachability: 'reachable',
        reason: 'Home PC node is reachable on the LAN',
      },
      bridgeMemory: {
        transport: 'tailscale',
        backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
        reason: 'Home Bridge configuration saved by operator.',
      },
      bridgeAutoRevalidation: {
        state: 'revalidated',
        reason: 'Home Bridge configuration saved by operator.',
      },
      bridgeTransportPreferences: {
        selectedTransport: 'manual',
        transports: {
          manual: {
            enabled: true,
            backendUrl: 'http://192.168.0.198:8787',
            accepted: true,
            reachability: 'reachable',
          },
          tailscale: {
            enabled: true,
            backendUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
            accepted: true,
            active: false,
            reachability: 'reachable',
            usable: true,
          },
        },
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          usable: true,
          target: 'http://192.168.0.198:8787',
          actualTarget: 'http://192.168.0.198:8787',
          reason: 'Home PC node is reachable on the LAN',
        },
        'home-node-bridge': {
          configured: true,
          available: false,
          usable: false,
          target: 'https://desktop-9flonkj.taild6f215.ts.net',
          actualTarget: 'https://desktop-9flonkj.taild6f215.ts.net',
          blockedReason: 'tailscale transport unreachable',
        },
        cloud: { configured: true, available: true, usable: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  assert.equal(model.runtimeContext.sessionKind, 'hosted-web');
  assert.equal(model.runtimeContext.bridgeTransportTruth.selectedTransport, 'tailscale');
  assert.equal(model.runtimeContext.bridgeTransportTruth.activeTransport, 'tailscale');
  assert.equal(model.runtimeContext.bridgeTransportTruth.state, 'active');
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.accepted, true);
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.reachable, true);
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.usable, true);
  assert.equal(model.runtimeContext.backendTargetResolvedUrl, 'https://desktop-9flonkj.taild6f215.ts.net');
  assert.equal(model.runtimeContext.backendTargetResolutionSource, 'bridgeTransport.liveTailscale.backendUrl');
  assert.equal(model.runtimeContext.backendTargetFallbackUsed, false);
  assert.equal(model.runtimeContext.routeCandidateWinner?.candidateKey, 'home-node-tailscale');
  assert.equal(model.runtimeContext.routeCandidateWinner?.transportKind, 'tailscale');
  assert.equal(model.finalRoute.preferredTarget, 'https://desktop-9flonkj.taild6f215.ts.net');
  assert.equal(model.finalRoute.actualTarget, 'https://desktop-9flonkj.taild6f215.ts.net');
  const manualCandidate = model.runtimeContext.routeCandidates.find((candidate) => candidate.candidateKey === 'home-node-manual');
  assert.ok(manualCandidate);
  assert.equal(manualCandidate.usable, false);
  assert.equal(manualCandidate.active, false);
});

test('route candidates allow usable tailscale route to beat cloud for hosted off-network session', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: 'https://100.64.0.10',
            accepted: true,
            active: true,
            reachability: 'reachable',
            usable: true,
          },
        },
      },
      routeDiagnostics: {
        'home-node': { configured: true, available: true, usable: true, source: 'home-node-bridge', routeVariant: 'home-node-bridge', target: 'https://100.64.0.10', actualTarget: 'https://100.64.0.10' },
        'home-node-bridge': { configured: true, available: true, usable: true, source: 'home-node-bridge', target: 'https://100.64.0.10', actualTarget: 'https://100.64.0.10' },
        cloud: { configured: true, available: true, usable: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  assert.equal(model.routeKind, 'home-node');
  assert.equal(model.runtimeContext.routeCandidateWinner.transportKind, 'tailscale');
  assert.equal(model.runtimeContext.routeSelectionSource, 'runtime-truth-adjudication');
});

test('wireguard planned candidate never becomes usable or active', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      bridgeTransportPreferences: {
        selectedTransport: 'wireguard',
      },
      routeDiagnostics: {
        cloud: { configured: true, available: true, usable: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  const wireguardCandidate = model.runtimeContext.routeCandidates.find((candidate) => candidate.candidateKey === 'home-node-wireguard');
  assert.ok(wireguardCandidate);
  assert.equal(wireguardCandidate.usable, false);
  assert.equal(wireguardCandidate.active, false);
});
