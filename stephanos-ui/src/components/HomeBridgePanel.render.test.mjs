import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importBundledModule, srcRoot } from '../test/renderHarness.mjs';

function createStore(overrides = {}) {
  return {
    homeBridgeUrl: 'https://bridge.example.com',
    saveHomeBridgeUrl: () => ({ ok: true, normalizedUrl: 'https://bridge.example.com' }),
    clearHomeBridgeUrl: () => ({ ok: true }),
    uiLayout: { homeBridgePanel: true },
    togglePanel: () => {},
    runtimeStatusModel: {
      runtimeContext: {
        homeNodeBridge: {
          reachability: 'unknown',
          reason: '',
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
  assert.match(rendered, /Bridge URL/);
  assert.match(rendered, /Test Reachability/);
  assert.match(rendered, /Saved URL: <strong>https:\/\/bridge\.example\.com<\/strong>/);
});

test('App places Home Bridge panel below AI Provider Controls', async () => {
  const appSource = await import('node:fs/promises').then((fs) => fs.readFile(path.join(srcRoot, 'App.jsx'), 'utf8'));
  const providerPanelIndex = appSource.indexOf('panelId="providerControlsPanel"');
  const bridgePanelIndex = appSource.indexOf('<HomeBridgePanel />');

  assert.ok(providerPanelIndex >= 0);
  assert.ok(bridgePanelIndex > providerPanelIndex);
});
