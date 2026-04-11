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
        bridgeMemoryReconciliationState: 'remembered-revalidated',
        bridgeMemoryUrl: 'https://100.64.0.10',
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
  assert.equal(model.runtimeContext.backendTargetCandidates[0].source, 'bridgeMemory.remembered.backendUrl');
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
