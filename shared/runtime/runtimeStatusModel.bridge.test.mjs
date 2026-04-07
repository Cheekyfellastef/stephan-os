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
