import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importBundledModule, srcRoot } from '../../test/renderHarness.mjs';

const storeModulePath = path.join(srcRoot, 'test/mockAIStore.js');

function createStore(overrides = {}) {
  return {
    uiLayout: {
      actionHintsPanel: true,
    },
    togglePanel: () => {},
    ...overrides,
  };
}

test('ActionHints renders pending message when runtime truth is unavailable', async () => {
  const { renderActionHints } = await importBundledModule(
    path.join(srcRoot, 'test/renderActionHintsEntry.jsx'),
    { '../../state/aiStore': storeModulePath },
    'action-hints-no-truth',
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore();
  const rendered = renderActionHints(null);
  assert.match(rendered, /Runtime truth pending/);
});

test('ActionHints renders fallback + mock hints when fallback and mock provider are active', async () => {
  const { renderActionHints } = await importBundledModule(
    path.join(srcRoot, 'test/renderActionHintsEntry.jsx'),
    { '../../state/aiStore': storeModulePath },
    'action-hints-fallback-mock',
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore();
  const rendered = renderActionHints({
    finalRouteTruth: {
      routeKind: 'cloud',
      backendReachable: true,
      fallbackActive: true,
      providerExecution: { executableProvider: 'mock' },
    },
  });

  assert.match(rendered, /Fallback route is active/);
  assert.match(rendered, /Cloud route active/);
  assert.match(rendered, /Mock provider is executing/);
});
