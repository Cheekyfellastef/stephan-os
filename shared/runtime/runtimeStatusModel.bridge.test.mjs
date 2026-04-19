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

test('createRuntimeStatusModel accepts ts.net tailscale backend URL for hosted backend target resolution', () => {
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
          target: 'http://desktop-9flonkj.taild6f215.ts.net:8787',
          actualTarget: 'http://desktop-9flonkj.taild6f215.ts.net:8787',
        },
      },
    },
  });

  assert.equal(model.runtimeContext.backendTargetResolvedUrl, 'http://desktop-9flonkj.taild6f215.ts.net:8787');
  assert.match(model.runtimeContext.backendTargetResolutionSource, /home-node-bridge|tailscale/);
});

test('createRuntimeStatusModel accepts 100.x tailscale backend URL for hosted backend target resolution', () => {
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
            backendUrl: 'http://100.88.0.2:8787',
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
          target: 'http://100.88.0.2:8787',
          actualTarget: 'http://100.88.0.2:8787',
        },
      },
    },
  });

  assert.equal(model.runtimeContext.backendTargetResolvedUrl, 'http://100.88.0.2:8787');
  assert.match(model.runtimeContext.backendTargetResolutionSource, /home-node-bridge|tailscale/);
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

test('hosted https with remembered http bridge preserves execution warning while promoting direct probe truth', () => {
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

  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryReconciliationState, 'remembered-revalidated');
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeHostedExecutionCompatibility, 'mixed-scheme-blocked');
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeDirectReachability, 'reachable');
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeInputRaw, bridgeUrl);
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeInputNormalized, bridgeUrl);
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgePersistedValue, bridgeUrl);
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeProbeTarget, bridgeUrl);
  assert.match(model.runtimeContext.bridgeTransportTruth.tailscale.reason, /cannot execute HTTP Home Bridge fetches/i);
  assert.equal(model.runtimeContext.preferredTarget, bridgeUrl);
  assert.equal(model.runtimeContext.actualTargetUsed, bridgeUrl);
  const staleLanCandidate = model.runtimeContext.backendTargetCandidates.find((candidate) => candidate.url === staleLanUrl);
  assert.equal(staleLanCandidate, undefined);
  assert.equal(model.runtimeContext.canonicalHostedRouteTruth.blockingIssues.length, 0);
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
  assert.match(model.runtimeContext.backendTargetResolutionSource, /bridgeTransport\.liveTailscale\.backendUrl|bridgeTransport\.hostedExecution\.target/);
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

test('hosted reachable HTTPS tailscale bridge promotes canonical no-port target from remembered :8787 input', () => {
  const rawPersistedBridgeUrl = 'https://desktop-9flonkj.taild6f215.ts.net:8787';
  const canonicalHostedExecutionUrl = 'https://desktop-9flonkj.taild6f215.ts.net';
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: 'http://192.168.0.198:8787',
      bridgeMemory: {
        transport: 'tailscale',
        backendUrl: rawPersistedBridgeUrl,
        reason: 'Home Bridge configuration saved by operator.',
      },
      bridgeAutoRevalidation: {
        state: 'revalidated',
        reason: 'Remembered Home Bridge revalidated successfully.',
        directReachability: 'reachable',
        executionCompatibility: 'compatible',
        executionTarget: canonicalHostedExecutionUrl,
        infrastructureRequirement: 'none',
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
            backendUrl: rawPersistedBridgeUrl,
            accepted: false,
            active: false,
            reachability: 'unknown',
            usable: false,
            reason: 'Tailscale transport not configured.',
          },
        },
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: false,
          usable: false,
          target: 'http://192.168.0.198:8787',
          actualTarget: 'http://192.168.0.198:8787',
          blockedReason: 'manual LAN route unreachable from hosted surface',
        },
        'home-node-lan': {
          configured: true,
          available: false,
          usable: false,
          target: 'http://192.168.0.198:8787',
          actualTarget: 'http://192.168.0.198:8787',
          blockedReason: 'LAN bridge unreachable from hosted surface',
        },
        'home-node-bridge': {
          configured: true,
          available: true,
          usable: true,
          target: canonicalHostedExecutionUrl,
          actualTarget: canonicalHostedExecutionUrl,
          reason: 'HTTPS bridge /api/health reachable from hosted surface.',
        },
        cloud: { configured: true, available: true, usable: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  assert.equal(model.runtimeContext.bridgeTransportTruth.configuredTransport, 'tailscale');
  assert.equal(model.runtimeContext.bridgeTransportTruth.selectedTransport, 'tailscale');
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.accepted, true);
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.reachable, true);
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryPromotedToRouteCandidate, true);
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeInputRaw, rawPersistedBridgeUrl);
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.backendUrl, canonicalHostedExecutionUrl);
  const backendCandidate = model.runtimeContext.backendTargetCandidates.find((candidate) => candidate.url === canonicalHostedExecutionUrl);
  assert.equal(backendCandidate?.accepted, true);
  assert.equal(model.runtimeContext.backendTargetResolvedUrl, canonicalHostedExecutionUrl);
  assert.equal(model.runtimeContext.routeCandidateWinner?.candidateKey, 'home-node-tailscale');
  assert.equal(model.runtimeContext.routeCandidateWinner?.usable, true);
  assert.equal(model.finalRoute.actualTarget, canonicalHostedExecutionUrl);
});

test('hosted strict revalidation gate accepts canonical hosted execution target when tailscale operator URL keeps :8787 provenance', () => {
  const rawPersistedBridgeUrl = 'https://desktop-9flonkj.taild6f215.ts.net:8787';
  const canonicalHostedExecutionUrl = 'https://desktop-9flonkj.taild6f215.ts.net';
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { ollama: { ok: true }, groq: { ok: true } },
    selectedProvider: 'ollama',
    routeMode: 'local-first',
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: rawPersistedBridgeUrl,
            executionUrl: canonicalHostedExecutionUrl,
            accepted: true,
            active: true,
            reachability: 'reachable',
            usable: true,
          },
        },
      },
      bridgeMemory: {
        transport: 'tailscale',
        backendUrl: rawPersistedBridgeUrl,
        savedBridgeUrl: rawPersistedBridgeUrl,
        executionUrl: canonicalHostedExecutionUrl,
        rememberedAt: '2026-04-19T00:00:00.000Z',
      },
      bridgeAutoRevalidation: {
        state: 'revalidated',
        reason: 'Remembered Home Bridge revalidated successfully.',
        executionCompatibility: 'compatible',
        executionTarget: canonicalHostedExecutionUrl,
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          usable: true,
          routeVariant: 'home-node-bridge',
          target: canonicalHostedExecutionUrl,
          actualTarget: canonicalHostedExecutionUrl,
        },
        'home-node-bridge': {
          configured: true,
          available: true,
          usable: true,
          target: canonicalHostedExecutionUrl,
          actualTarget: canonicalHostedExecutionUrl,
        },
      },
    },
  });

  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryReconciliationState, 'remembered-revalidated');
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeAutoRevalidationState, 'revalidated');
  assert.equal(model.runtimeContext.bridgeTransportTruth.activeTransport, 'tailscale');
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.accepted, true);
  assert.equal(model.runtimeContext.backendTargetResolvedUrl, canonicalHostedExecutionUrl);
  assert.equal(model.finalRoute.actualTarget, canonicalHostedExecutionUrl);
});

test('hosted canonical execution evidence promotes remembered tailscale out of backoff and outranks stale HTTP backend candidates', () => {
  const rememberedUrl = 'https://desktop-9flonkj.taild6f215.ts.net:8787';
  const canonicalHostedExecutionUrl = 'https://desktop-9flonkj.taild6f215.ts.net';
  const staleApiBaseUrl = 'http://100.116.99.92:8787';
  const staleFallbackUrl = 'http://192.168.0.198:8787';
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { ollama: { ok: true }, groq: { ok: true } },
    selectedProvider: 'ollama',
    routeMode: 'local-first',
    runtimeContext: {
      frontendOrigin: 'https://192.168.0.50',
      apiBaseUrl: staleApiBaseUrl,
      actualTargetUsed: staleFallbackUrl,
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: rememberedUrl,
            executionUrl: canonicalHostedExecutionUrl,
            accepted: false,
            active: false,
            reachability: 'unknown',
            usable: false,
          },
        },
      },
      bridgeMemory: {
        transport: 'tailscale',
        backendUrl: rememberedUrl,
        executionUrl: canonicalHostedExecutionUrl,
        rememberedAt: '2026-04-19T00:00:00.000Z',
      },
      bridgeAutoRevalidation: {
        state: 'backoff',
        reason: 'Remembered bridge auto-validation exhausted bounded retries for this surface session.',
        executionCompatibility: 'compatible',
        executionTarget: canonicalHostedExecutionUrl,
      },
      routeDiagnostics: {
        'home-node-bridge': {
          configured: true,
          available: true,
          usable: true,
          target: canonicalHostedExecutionUrl,
          actualTarget: canonicalHostedExecutionUrl,
          reason: 'HTTPS bridge /api/health reachable from hosted surface.',
        },
      },
    },
  });

  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryValidatedOnThisSurface, true);
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryReachableOnThisSurface, true);
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryPromotedToRouteCandidate, true);
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.accepted, true);
  assert.equal(model.runtimeContext.bridgeTransportTruth.configuredTransport, 'tailscale');
  const tailscaleCandidate = model.runtimeContext.routeCandidates.find((candidate) => candidate.candidateKey === 'home-node-tailscale');
  assert.equal(tailscaleCandidate?.usable, true);
  const canonicalBackendCandidate = model.runtimeContext.backendTargetCandidates.find((candidate) => candidate.url === canonicalHostedExecutionUrl);
  assert.equal(canonicalBackendCandidate?.accepted, true);
  const staleHttpCandidate = model.runtimeContext.backendTargetCandidates.find((candidate) => candidate.url === staleApiBaseUrl);
  assert.ok(staleHttpCandidate);
  assert.ok(model.runtimeContext.backendTargetCandidates.indexOf(canonicalBackendCandidate) < model.runtimeContext.backendTargetCandidates.indexOf(staleHttpCandidate));
  assert.equal(model.runtimeContext.backendTargetResolvedUrl, canonicalHostedExecutionUrl);
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

test('hosted direct remembered backend evidence can win over failing derived hosted execution target', () => {
  const rememberedUrl = 'http://100.116.99.92:8787';
  const hostedExecutionUrl = 'https://desktop-9flonkj.taild6f215.ts.net';
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      bridgeMemory: { transport: 'tailscale', backendUrl: rememberedUrl },
      bridgeAutoRevalidation: {
        state: 'execution-incompatible',
        reason: 'Hosted HTTPS frontend cannot execute HTTP Home Bridge fetches due browser mixed-content policy.',
        directReachability: 'reachable',
        executionCompatibility: 'mixed-scheme-blocked',
        executionTarget: hostedExecutionUrl,
      },
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: rememberedUrl,
            executionUrl: hostedExecutionUrl,
            accepted: false,
            active: false,
            reachability: 'unknown',
            usable: false,
          },
        },
      },
      routeDiagnostics: {
        'home-node-bridge': { configured: true, available: false, usable: false, target: hostedExecutionUrl, actualTarget: hostedExecutionUrl },
        cloud: { configured: true, available: true, usable: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  const rememberedCandidate = model.runtimeContext.backendTargetCandidates.find((candidate) => candidate.url === rememberedUrl);
  const executionCandidate = model.runtimeContext.backendTargetCandidates.find((candidate) => candidate.url === hostedExecutionUrl);
  assert.equal(rememberedCandidate?.accepted, true);
  assert.equal(rememberedCandidate?.directBackendProbeSucceeded, true);
  assert.equal(executionCandidate?.accepted, false);
  assert.equal(model.runtimeContext.backendTargetResolvedUrl, rememberedUrl);
  assert.match(model.runtimeContext.backendTargetResolutionSource, /bridgeTransport\.tailscale\.backendUrl|bridgeTransport\.liveTailscale\.backendUrl|bridgeMemory\.remembered\.backendUrl/);
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryReachableOnThisSurface, true);
  assert.equal(model.runtimeContext.bridgeTransportTruth.bridgeMemoryPromotedToRouteCandidate, true);
  assert.equal(model.runtimeContext.bridgeTransportTruth.tailscale.accepted, true);
  assert.equal(model.runtimeContext.routeCandidateWinner?.candidateKey, 'home-node-tailscale');
  assert.equal(model.finalRoute.routeKind, 'home-node');
});

test('hosted remembers reachable backend when derived hosted execution target is absent', () => {
  const rememberedUrl = 'http://100.116.99.92:8787';
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      bridgeMemory: { transport: 'tailscale', backendUrl: rememberedUrl },
      bridgeAutoRevalidation: {
        state: 'revalidated',
        reason: 'Remembered Home Bridge revalidated successfully.',
        directReachability: 'reachable',
        executionCompatibility: 'unknown',
      },
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: rememberedUrl,
            accepted: true,
            active: true,
            reachability: 'reachable',
            usable: true,
          },
        },
      },
      routeDiagnostics: {
        'home-node-bridge': { configured: true, available: true, usable: true, target: rememberedUrl, actualTarget: rememberedUrl },
        cloud: { configured: true, available: true, usable: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  assert.equal(model.runtimeContext.backendTargetResolvedUrl, rememberedUrl);
  assert.equal(model.runtimeContext.routeCandidateWinner?.candidateKey, 'home-node-tailscale');
  assert.equal(model.finalRoute.routeKind, 'home-node');
});

test('hosted remembered backend remains rejected when direct probe evidence fails', () => {
  const rememberedUrl = 'http://100.116.99.92:8787';
  const model = createRuntimeStatusModel({
    backendAvailable: false,
    providerHealth: { groq: { ok: false } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      bridgeMemory: { transport: 'tailscale', backendUrl: rememberedUrl },
      bridgeAutoRevalidation: {
        state: 'unreachable',
        reason: 'Remembered Home Bridge is unreachable from this surface.',
        directReachability: 'unreachable',
        executionCompatibility: 'unknown',
      },
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: rememberedUrl,
            accepted: false,
            active: false,
            reachability: 'unreachable',
            usable: false,
          },
        },
      },
      routeDiagnostics: {
        'home-node-bridge': { configured: true, available: false, usable: false, target: rememberedUrl, actualTarget: rememberedUrl },
        cloud: { configured: false, available: false, usable: false },
      },
    },
  });

  const rememberedCandidate = model.runtimeContext.backendTargetCandidates.find((candidate) => candidate.url === rememberedUrl);
  assert.equal(rememberedCandidate?.accepted, false);
  assert.match(rememberedCandidate?.reason || '', /reachability probe/i);
  assert.equal(model.runtimeContext.backendTargetResolvedUrl, '');
});

test('hosted remembers operator backend from direct api health evidence even when hosted execution url fails', () => {
  const rememberedUrl = 'http://100.116.99.92:8787';
  const hostedExecutionUrl = 'https://desktop-9flonkj.taild6f215.ts.net';
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: rememberedUrl,
      bridgeMemory: { transport: 'tailscale', backendUrl: rememberedUrl },
      bridgeAutoRevalidation: {
        state: 'execution-incompatible',
        reason: 'Hosted HTTPS frontend cannot execute HTTP Home Bridge fetches due browser mixed-content policy.',
        directReachability: 'unknown',
        executionCompatibility: 'mixed-scheme-blocked',
        executionTarget: hostedExecutionUrl,
      },
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: rememberedUrl,
            executionUrl: hostedExecutionUrl,
            accepted: false,
            active: false,
            reachability: 'unknown',
            usable: false,
          },
        },
      },
      routeDiagnostics: {
        'home-node-bridge': { configured: true, available: false, usable: false, target: hostedExecutionUrl, actualTarget: hostedExecutionUrl },
        cloud: { configured: true, available: true, usable: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  const rememberedCandidate = model.runtimeContext.backendTargetCandidates.find((candidate) => candidate.url === rememberedUrl);
  const executionCandidate = model.runtimeContext.backendTargetCandidates.find((candidate) => candidate.url === hostedExecutionUrl);
  assert.equal(rememberedCandidate?.accepted, true);
  assert.equal(rememberedCandidate?.directBackendProbeSucceeded, true);
  assert.equal(executionCandidate?.accepted, false);
  assert.equal(model.runtimeContext.backendTargetResolvedUrl, rememberedUrl);
  assert.match(model.runtimeContext.backendTargetResolutionSource, /bridgeTransport\.tailscale\.backendUrl|bridgeTransport\.liveTailscale\.backendUrl|bridgeMemory\.remembered\.backendUrl/);
  assert.equal(model.finalRouteTruth.selectedRouteReachable, true);
  assert.equal(model.finalRouteTruth.backendReachable, true);
});

test('hosted remembers operator backend from direct api health evidence without hosted execution target', () => {
  const rememberedUrl = 'http://100.116.99.92:8787';
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: rememberedUrl,
      bridgeMemory: { transport: 'tailscale', backendUrl: rememberedUrl },
      bridgeAutoRevalidation: {
        state: 'revalidated',
        reason: 'Remembered Home Bridge revalidated successfully.',
        directReachability: 'unknown',
        executionCompatibility: 'unknown',
      },
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: rememberedUrl,
            accepted: false,
            active: false,
            reachability: 'unknown',
            usable: false,
          },
        },
      },
      routeDiagnostics: {
        'home-node-bridge': { configured: true, available: false, usable: false, target: '', actualTarget: '' },
        cloud: { configured: true, available: true, usable: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  const rememberedCandidate = model.runtimeContext.backendTargetCandidates.find((candidate) => candidate.url === rememberedUrl);
  assert.equal(rememberedCandidate?.accepted, true);
  assert.equal(rememberedCandidate?.directBackendProbeSucceeded, true);
  assert.equal(model.runtimeContext.backendTargetResolvedUrl, rememberedUrl);
  assert.match(model.runtimeContext.backendTargetResolutionSource, /bridgeTransport\.tailscale\.backendUrl|bridgeTransport\.liveTailscale\.backendUrl|bridgeMemory\.remembered\.backendUrl/);
  assert.equal(model.finalRouteTruth.selectedRouteReachable, true);
});

test('hosted backend candidates preserve direct and hosted execution probe evidence when both succeed', () => {
  const rememberedUrl = 'http://100.116.99.92:8787';
  const hostedExecutionUrl = 'https://desktop-9flonkj.taild6f215.ts.net';
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      bridgeMemory: { transport: 'tailscale', backendUrl: rememberedUrl },
      bridgeAutoRevalidation: {
        state: 'revalidated',
        reason: 'Remembered Home Bridge revalidated successfully.',
        directReachability: 'reachable',
        executionCompatibility: 'compatible',
        executionTarget: hostedExecutionUrl,
      },
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: rememberedUrl,
            executionUrl: hostedExecutionUrl,
            accepted: true,
            active: true,
            reachability: 'reachable',
            usable: true,
          },
        },
      },
      routeDiagnostics: {
        'home-node-bridge': { configured: true, available: true, usable: true, target: rememberedUrl, actualTarget: rememberedUrl },
        cloud: { configured: true, available: true, usable: true, target: 'https://cloud.example.com', actualTarget: 'https://cloud.example.com' },
      },
    },
  });

  const rememberedCandidate = model.runtimeContext.backendTargetCandidates.find((candidate) => candidate.url === rememberedUrl);
  const hostedExecutionCandidate = model.runtimeContext.backendTargetCandidates.find((candidate) => candidate.url === hostedExecutionUrl);
  assert.equal(rememberedCandidate?.accepted, true);
  assert.equal(rememberedCandidate?.directBackendProbeSucceeded, true);
  assert.equal(hostedExecutionCandidate?.hostedExecutionProbeSucceeded, true);
  assert.equal(model.runtimeContext.backendTargetResolvedUrl, hostedExecutionUrl);
  assert.match(model.runtimeContext.backendTargetResolutionSource, /bridgeTransport\.liveTailscale\.executionUrl|bridgeTransport\.hostedExecution\.target/);
  assert.equal(model.finalRoute.routeKind, 'home-node');
});

test('caravan mode: hosted iPad safari keeps route reachable when browser blocks mixed-content HTTP backend', () => {
  const rememberedUrl = 'http://100.116.99.92:8787';
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: rememberedUrl,
      bridgeMemory: { transport: 'tailscale', backendUrl: rememberedUrl },
      bridgeAutoRevalidation: {
        state: 'execution-incompatible',
        reason: 'Hosted HTTPS frontend cannot execute HTTP Home Bridge fetches due browser mixed-content policy.',
        directReachability: 'reachable',
        executionCompatibility: 'mixed-scheme-blocked',
      },
      bridgeTransportPreferences: {
        selectedTransport: 'tailscale',
        transports: {
          tailscale: {
            enabled: true,
            backendUrl: rememberedUrl,
            accepted: true,
            active: true,
            reachability: 'reachable',
            usable: true,
          },
        },
      },
      routeDiagnostics: {
        'home-node': { configured: true, available: true, usable: true, target: rememberedUrl, actualTarget: rememberedUrl },
        'home-node-bridge': { configured: true, available: true, usable: true, target: rememberedUrl, actualTarget: rememberedUrl },
        cloud: { configured: false, available: false, usable: false },
      },
    },
  });

  assert.equal(model.finalRouteTruth.backendReachable, true);
  assert.equal(model.finalRouteTruth.selectedRouteReachable, true);
  assert.equal(model.finalRouteTruth.routeUsable, true);
  assert.equal(model.finalRouteTruth.browserDirectAccessState, 'blocked-mixed-content');
  assert.equal(model.finalRouteTruth.transportCompatibilityLayer, 'required');
  assert.notEqual(model.finalRouteTruth.routeKind, 'unavailable');
});

test('caravan mode: hosted iPad safari with HTTPS backend keeps direct browser compatibility', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { groq: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
      bridgeAutoRevalidation: {
        state: 'revalidated',
        reason: 'Remembered Home Bridge revalidated successfully.',
        directReachability: 'reachable',
        executionCompatibility: 'compatible',
        executionTarget: 'https://desktop-9flonkj.taild6f215.ts.net',
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          usable: true,
          target: 'https://desktop-9flonkj.taild6f215.ts.net',
          actualTarget: 'https://desktop-9flonkj.taild6f215.ts.net',
        },
        cloud: { configured: false, available: false, usable: false },
      },
    },
  });

  assert.equal(model.finalRouteTruth.backendReachable, true);
  assert.equal(model.finalRouteTruth.browserDirectAccessState, 'compatible');
  assert.equal(model.finalRouteTruth.transportCompatibilityLayer, 'not-required');
});

test('caravan mode: desktop browser + http backend remains direct-compatible', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: true,
    providerHealth: { ollama: { ok: true } },
    runtimeContext: {
      frontendOrigin: 'http://localhost:5173',
      apiBaseUrl: 'http://localhost:8787',
      routeDiagnostics: {
        'local-desktop': {
          configured: true,
          available: true,
          usable: true,
          target: 'http://localhost:8787',
          actualTarget: 'http://localhost:8787',
        },
      },
    },
  });

  assert.equal(model.finalRouteTruth.backendReachable, true);
  assert.equal(model.finalRouteTruth.browserDirectAccessState, 'compatible');
  assert.equal(model.finalRouteTruth.transportCompatibilityLayer, 'not-required');
  assert.equal(model.finalRouteTruth.routeKind, 'local-desktop');
});

test('caravan mode: no backend remains rejected', () => {
  const model = createRuntimeStatusModel({
    backendAvailable: false,
    providerHealth: {},
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: 'http://100.116.99.92:8787',
      routeDiagnostics: {
        'home-node': { configured: true, available: false, usable: false },
        cloud: { configured: false, available: false, usable: false },
      },
    },
  });

  assert.equal(model.finalRouteTruth.backendReachable, false);
  assert.equal(model.finalRouteTruth.routeKind, 'unavailable');
});
