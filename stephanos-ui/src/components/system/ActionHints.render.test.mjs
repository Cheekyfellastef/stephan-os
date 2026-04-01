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

test('ActionHints renders no-hints-available message when truth is unavailable', async () => {
  const { renderActionHints } = await importBundledModule(
    path.join(srcRoot, 'test/renderActionHintsEntry.jsx'),
    { '../../state/aiStore': storeModulePath },
    'action-hints-no-truth',
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore();
  const rendered = renderActionHints(null);
  assert.match(rendered, /No action hints available/);
});

test('ActionHints renders no-action-required message for healthy truth', async () => {
  const { renderActionHints } = await importBundledModule(
    path.join(srcRoot, 'test/renderActionHintsEntry.jsx'),
    { '../../state/aiStore': storeModulePath },
    'action-hints-healthy',
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore();
  const rendered = renderActionHints({
    routeKind: 'local-desktop',
    backendReachable: true,
    fallbackActive: false,
    memoryMode: 'shared',
    providerExecution: {
      requestedProvider: 'ollama',
      executableProvider: 'ollama',
      providerHealthState: 'HEALTHY',
    },
  });
  assert.match(rendered, /No action required/);
});

test('ActionHints renders deterministic degraded hints and deduplicates passthrough text', async () => {
  const { renderActionHints } = await importBundledModule(
    path.join(srcRoot, 'test/renderActionHintsEntry.jsx'),
    { '../../state/aiStore': storeModulePath },
    'action-hints-degraded',
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore();
  const rendered = renderActionHints({
    routeKind: 'dist',
    backendReachable: false,
    fallbackActive: true,
    memoryMode: 'local',
    operatorGuidance: 'Review fallback cause in telemetry feed',
    operatorAction: 'Review fallback cause in telemetry feed',
    providerExecution: {
      requestedProvider: 'openai',
      executableProvider: 'mock',
      providerHealthState: 'UNKNOWN',
    },
  });

  assert.match(rendered, /Check backend health endpoint and local backend availability/);
  assert.match(rendered, /Fallback is active\./);
  assert.match(rendered, /Requested provider is not executing/);
  assert.match(rendered, /System is using mock provider/);
  assert.match(rendered, /Shared memory is not fully active/);

  const duplicateCount = (rendered.match(/Review fallback cause in telemetry feed/g) || []).length;
  assert.equal(duplicateCount, 1);
});
