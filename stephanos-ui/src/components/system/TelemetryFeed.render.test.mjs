import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importBundledModule, srcRoot } from '../../test/renderHarness.mjs';

const storeModulePath = path.join(srcRoot, 'test/mockAIStore.js');

function createStore(overrides = {}) {
  return {
    uiLayout: {
      telemetryFeedPanel: true,
    },
    togglePanel: () => {},
    ...overrides,
  };
}

test('TelemetryFeed renders no telemetry message when runtime truth is unavailable', async () => {
  const { renderTelemetryFeed } = await importBundledModule(
    path.join(srcRoot, 'test/renderTelemetryFeedEntry.jsx'),
    { '../../state/aiStore': storeModulePath },
    'telemetry-feed-no-truth',
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore();
  const rendered = renderTelemetryFeed(null);
  assert.match(rendered, /No telemetry available yet/);
});

test('TelemetryFeed renders awaiting message when runtime truth exists and no transitions occurred', async () => {
  const { renderTelemetryFeed } = await importBundledModule(
    path.join(srcRoot, 'test/renderTelemetryFeedEntry.jsx'),
    { '../../state/aiStore': storeModulePath },
    'telemetry-feed-awaiting',
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore();
  const rendered = renderTelemetryFeed({
    finalRouteTruth: {
      routeKind: 'local-desktop',
      backendReachable: true,
      fallbackActive: false,
      providerExecution: { executableProvider: 'ollama' },
      memoryMode: 'shared',
    },
  });
  assert.match(rendered, /Telemetry feed active\. Awaiting state changes\./);
});
