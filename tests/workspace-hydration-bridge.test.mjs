import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readWorkspaceHydrationBundle,
  resolveWorkspaceHydrationDatasets,
} from '../stephanos-server/services/workspaceHydrationService.js';
import {
  hydrateWorkspaceFromBackend,
  installWorkspaceHydrationParentBridge,
  WORKSPACE_HYDRATION_REQUEST_MESSAGE_V1,
  WORKSPACE_HYDRATION_RESPONSE_MESSAGE_V1,
} from '../shared/runtime/workspaceHydrationBridge.mjs';

test('workspace hydration defaults every unknown hosted workspace to canonical dashboard truth', () => {
  assert.deepEqual(resolveWorkspaceHydrationDatasets({ workspaceId: 'unknown-workspace' }), ['dashboard']);
  assert.deepEqual(
    resolveWorkspaceHydrationDatasets({ workspaceId: 'vr-research-lab' }),
    ['dashboard', 'vr-capability', 'vr-playtest', 'spatial-telemetry'],
  );
});

test('workspace hydration service returns a versioned partial bundle instead of hiding failed datasets', async () => {
  const bundle = await readWorkspaceHydrationBundle({
    workspaceId: 'vr-research-lab',
    datasets: ['dashboard', 'vr-capability'],
    nowMs: Date.parse('2026-10-06T10:30:00.000Z'),
    readers: {
      dashboard: async () => ({ state: 'ready', reason: 'READY', projection: { goals: [] } }),
      'vr-capability': async () => { throw new Error('VR_FEED_DOWN'); },
    },
  });

  assert.equal(bundle.schemaVersion, 'stephanos.workspace-hydration.v1');
  assert.equal(bundle.workspaceId, 'vr-research-lab');
  assert.equal(bundle.state, 'partial');
  assert.equal(bundle.datasets.dashboard.state, 'ready');
  assert.equal(bundle.datasets['vr-capability'].state, 'unavailable');
  assert.deepEqual(bundle.errors, ['vr-capability:VR_FEED_DOWN']);
});

test('workspace hydration client reuses the existing hosted backend bridge transport', async () => {
  const seen = [];
  const payload = await hydrateWorkspaceFromBackend({
    workspaceId: 'flywheel',
    datasets: ['dashboard'],
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      hostedExecutionBridgeUrl: 'https://battle-bridge.example.ts.net',
    },
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            schemaVersion: 'stephanos.workspace-hydration.v1',
            state: 'ready',
            workspaceId: 'flywheel',
          });
        },
      };
    },
  });

  assert.equal(payload.state, 'ready');
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /^https:\/\/battle-bridge\.example\.ts\.net\/api\/shared-workspace\/hydrate\?/);
  assert.match(seen[0].url, /workspace=flywheel/);
  assert.match(seen[0].url, /datasets=dashboard/);
});

test('parent hydration bridge serves only the active same-origin workspace iframe', async () => {
  const listeners = new Map();
  const posted = [];
  const iframeWindow = {
    postMessage(message, origin) {
      posted.push({ message, origin });
    },
  };
  const fakeWindow = {
    location: {
      origin: 'https://cheekyfellastef.github.io',
      href: 'https://cheekyfellastef.github.io/stephan-os/',
    },
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type, fn) {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
  };

  const bridge = installWorkspaceHydrationParentBridge({
    windowRef: fakeWindow,
    getActiveIframe: () => ({ contentWindow: iframeWindow }),
    getActiveWorkspaceId: () => 'flywheel',
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      hostedExecutionBridgeUrl: 'https://battle-bridge.example.ts.net',
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          schemaVersion: 'stephanos.workspace-hydration.v1',
          state: 'ready',
          workspaceId: 'flywheel',
        });
      },
    }),
  });

  assert.equal(bridge.installed, true);
  await listeners.get('message')({
    origin: 'https://cheekyfellastef.github.io',
    source: iframeWindow,
    data: {
      type: WORKSPACE_HYDRATION_REQUEST_MESSAGE_V1,
      requestId: 'request-1',
      workspaceId: 'flywheel',
      datasets: ['dashboard'],
    },
  });

  assert.equal(posted.length, 1);
  assert.equal(posted[0].origin, 'https://cheekyfellastef.github.io');
  assert.equal(posted[0].message.type, WORKSPACE_HYDRATION_RESPONSE_MESSAGE_V1);
  assert.equal(posted[0].message.ok, true);

  await listeners.get('message')({
    origin: 'https://evil.example',
    source: iframeWindow,
    data: {
      type: WORKSPACE_HYDRATION_REQUEST_MESSAGE_V1,
      requestId: 'request-2',
      workspaceId: 'flywheel',
    },
  });
  assert.equal(posted[1].message.ok, false);
  assert.equal(posted[1].message.error, 'workspace-hydration-origin-rejected');

  bridge.dispose();
});
