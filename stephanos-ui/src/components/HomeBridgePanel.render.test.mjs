import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importBundledModule, srcRoot } from '../test/renderHarness.mjs';

function createStore(overrides = {}) {
  return {
    homeBridgeUrl: 'https://bridge.example.com',
    saveHomeBridgeUrl: () => ({ ok: true, normalizedUrl: 'https://bridge.example.com' }),
    clearHomeBridgeUrl: () => ({ ok: true }),
    bridgeTransportDefinitions: [
      { key: 'manual', label: 'Manual / LAN', status: 'active', description: '' },
      { key: 'tailscale', label: 'Tailscale', status: 'active', description: '' },
      { key: 'wireguard', label: 'WireGuard', status: 'planned', description: '' },
    ],
    bridgeTransportPreferences: {
      selectedTransport: 'tailscale',
      transports: {
        manual: { backendUrl: 'https://bridge.example.com', enabled: true },
        tailscale: { backendUrl: 'https://100.64.0.10', deviceName: 'home-node', tailnetIp: '100.64.0.10', diagnostics: [] },
      },
    },
    setBridgeTransportSelection: () => 'tailscale',
    updateBridgeTransportConfig: () => {},
    uiLayout: { homeBridgePanel: true },
    togglePanel: () => {},
    runtimeStatusModel: {
      runtimeContext: {
        homeNodeBridge: {
          reachability: 'unknown',
          reason: '',
        },
        routeCandidates: [
          { candidateKey: 'home-node-tailscale', usable: true, reachable: true, configured: true, score: 980 },
        ],
        routeCandidateWinner: {
          routeKind: 'home-node',
          transportKind: 'tailscale',
        },
      },
    },
    ...overrides,
  };
}

const storeModulePath = path.join(srcRoot, 'test/mockAIStore.js');

test('HomeBridgePanel renders bridge controls and saved URL status', async () => {
  const { renderHomeBridgePanel } = await importBundledModule(
    path.join(srcRoot, 'test/renderHomeBridgePanelEntry.jsx'),
    {
      '../state/aiStore': storeModulePath,
      '../ai/aiClient': path.join(srcRoot, 'test/mockAiClient.js'),
    },
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore();
  const rendered = renderHomeBridgePanel();

  assert.match(rendered, /Home Bridge/);
  assert.match(rendered, /Selected transport/);
  assert.match(rendered, /Test Reachability/);
  assert.match(rendered, /Tailscale Backend URL/);
  assert.match(rendered, /Route winner: <strong>home-node\/tailscale<\/strong>/);
  assert.match(rendered, /home-node-tailscale: usable \(score 980\)/);
  assert.match(rendered, /WireGuard status: <strong>planned \/ not yet configured<\/strong>/);
});

test('App places Home Bridge panel below AI Provider Controls', async () => {
  const appSource = await import('node:fs/promises').then((fs) => fs.readFile(path.join(srcRoot, 'App.jsx'), 'utf8'));
  const providerPanelIndex = appSource.indexOf('panelId="providerControlsPanel"');
  const bridgePanelIndex = appSource.indexOf('<HomeBridgePanel />');

  assert.ok(providerPanelIndex >= 0);
  assert.ok(bridgePanelIndex > providerPanelIndex);
});
