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
    devMode: false,
    togglePanel: () => {},
    ...overrides,
  };
}

const runtimeTruth = {
  finalRouteTruth: {
    routeKind: 'local-desktop',
    backendReachable: true,
    fallbackActive: false,
    providerExecution: { executableProvider: 'ollama' },
    memoryMode: 'shared',
  },
};

test('TelemetryFeed renders no mission trace message when runtime truth is unavailable', async () => {
  const { renderTelemetryFeed } = await importBundledModule(
    path.join(srcRoot, 'test/renderTelemetryFeedEntry.jsx'),
    { '../../state/aiStore': storeModulePath },
    'telemetry-feed-no-truth',
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore();
  const rendered = renderTelemetryFeed(null);
  assert.match(rendered, /No mission trace yet\. Start by capturing an operator intent\./);
});

test('TelemetryFeed renders mission trace with required chain entries by default', async () => {
  const { renderTelemetryFeed } = await importBundledModule(
    path.join(srcRoot, 'test/renderTelemetryFeedEntry.jsx'),
    { '../../state/aiStore': storeModulePath },
    'telemetry-feed-trace-default',
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore();
  const rendered = renderTelemetryFeed(runtimeTruth, []);
  assert.match(rendered, /Mission Trace \/ Execution Telemetry/);
  assert.match(rendered, /Intent captured/);
  assert.match(rendered, /Complete \/ blocked \/ needs revision/);
  assert.match(rendered, /pending/);
});

test('TelemetryFeed projects mission trace owner and status from telemetry entries', async () => {
  const { renderTelemetryFeed } = await importBundledModule(
    path.join(srcRoot, 'test/renderTelemetryFeedEntry.jsx'),
    { '../../state/aiStore': storeModulePath },
    'telemetry-feed-owner-status',
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore();
  const rendered = renderTelemetryFeed(runtimeTruth, [
    {
      id: 'evt-1',
      timestamp: '2026-04-23T00:00:00.000Z',
      subsystem: 'MISSION',
      change: 'Intent captured from operator prompt',
      status: 'passed',
    },
    {
      id: 'evt-2',
      timestamp: '2026-04-23T00:02:00.000Z',
      subsystem: 'OPENCLAW',
      change: 'OpenClaw handoff blocked awaiting approval',
    },
  ]);

  assert.match(rendered, /Intent captured/);
  assert.match(rendered, /passed/);
  assert.match(rendered, /Stephanos/);
  assert.match(rendered, /OpenClaw action prepared/);
  assert.match(rendered, /blocked/);
  assert.match(rendered, /OpenClaw/);
  assert.match(rendered, /Blocked\/failure detected in mission trace/);
});
