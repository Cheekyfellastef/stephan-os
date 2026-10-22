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

test('Flywheel hydration preserves the full-history dashboard projection used by the rich workspace', async () => {
  const observedScopes = [];
  const bundle = await readWorkspaceHydrationBundle({
    workspaceId: 'flywheel',
    datasets: ['dashboard'],
    readers: {
      dashboard: async ({ recordScope }) => {
        observedScopes.push(recordScope);
        return { state: 'ready', reason: 'READY', projection: { goals: [] } };
      },
    },
  });

  assert.equal(bundle.state, 'ready');
  assert.deepEqual(observedScopes, ['full-history']);
  assert.equal(bundle.datasets.dashboard.provenance.workspaceId, 'flywheel');
  assert.equal(bundle.datasets.dashboard.provenance.transportId, '/api/shared-workspace/hydrate');
  assert.equal(bundle.datasets.dashboard.provenance.expectedSchemaVersion, 'stephanos.shared-workspace-dashboard-feed.v1');
  assert.equal(bundle.integrity.finalVerdict, 'WORKSPACE_INTEGRITY_PROOF_INCOMPLETE');
  assert.equal(bundle.integrity.amber, 1);
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
  assert.equal(bundle.datasets['vr-capability'].provenance.sourceState, 'BROKEN');
  assert.equal(bundle.integrity.finalVerdict, 'WORKSPACE_INTEGRITY_BROKEN');
  assert.equal(bundle.integrity.red, 1);
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
