import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import {
  canReuseStephanosServer,
  createStephanosDistServer,
  resolveContentType,
} from './serve-stephanos-dist.mjs';

test('resolveContentType serves JavaScript MIME for .mjs and .js files', () => {
  assert.equal(resolveContentType('/launcher/index.mjs'), 'text/javascript; charset=utf-8');
  assert.equal(resolveContentType('/shared/runtime/runtimeStatusModel.mjs'), 'text/javascript; charset=utf-8');
  assert.equal(resolveContentType('/apps/stephanos/dist/runtimeStatusModel.mjs'), 'text/javascript; charset=utf-8');
  assert.equal(resolveContentType('/apps/stephanos/dist/assets/index.js'), 'text/javascript; charset=utf-8');
  assert.notEqual(resolveContentType('/apps/stephanos/dist/runtimeStatusModel.mjs'), 'application/octet-stream');
  assert.equal(resolveContentType('/apps/stephanos/dist/runtimeStatusModel.mjs?v=dev-cache-bust'), 'text/javascript; charset=utf-8');
});

test('resolveContentType serves expected MIME types for core web assets', () => {
  assert.equal(resolveContentType('/apps/stephanos/dist/index.html'), 'text/html; charset=utf-8');
  assert.equal(resolveContentType('/apps/stephanos/dist/assets/app.css'), 'text/css; charset=utf-8');
  assert.equal(resolveContentType('/apps/stephanos/dist/stephanos-build.json'), 'application/json; charset=utf-8');
});

test('dist server serves shared runtime modules with JavaScript MIME type', async (t) => {
  const server = createStephanosDistServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const { port } = server.address();
  const moduleUrls = [
    '/shared/runtime/runtimeStatusModel.mjs',
    '/shared/runtime/stephanosLocalUrls.mjs',
    '/shared/runtime/runtimeStatusModel.mjs?v=dev-cache-bust',
    '/shared/runtime/stephanosLocalUrls.mjs?v=dev-cache-bust',
  ];

  for (const moduleUrl of moduleUrls) {
    const response = await fetch(`http://127.0.0.1:${port}${moduleUrl}`);
    assert.equal(response.status, 200, `${moduleUrl} should be served`);

    const contentType = response.headers.get('content-type');
    assert.equal(contentType, 'text/javascript; charset=utf-8');
    assert.notEqual(contentType, 'application/octet-stream');
  }
});


test('dist server serves launcher runtime-status endpoint with shared toggle registry payload', async (t) => {
  const server = createStephanosDistServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/apps/stephanos/runtime-status.json`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.systemPanel.toggleRegistrySource, 'shared/runtime/systemPanelToggleRegistry.mjs');
  assert.equal(Array.isArray(payload.systemPanel.toggleDefinitions), true);
  assert.equal(payload.systemPanel.toggleDefinitions.some((entry) => entry.id === 'self-healing-panel'), true);
  assert.equal(payload.systemPanel.toggleDefinitions.some((entry) => entry.id === 'app-installer-panel'), true);
});

test('existing server reuse requires runtime marker parity and not just health', () => {
  const healthyStephanosServer = {
    payload: {
      service: 'stephanos-dist-server',
      distMountPath: '/apps/stephanos/dist/',
      staticRootPath: '/workspace/stephan-os',
    },
    runtimeReady: true,
    runtimeStatusReady: true,
    moduleMimeReady: true,
    sourceTruthReady: true,
  };

  assert.equal(
    canReuseStephanosServer({
      ...healthyStephanosServer,
      markerMatchesExpected: true,
    }),
    true,
  );

  assert.equal(
    canReuseStephanosServer({
      ...healthyStephanosServer,
      markerMatchesExpected: false,
    }),
    false,
  );
});

test('existing server reuse rejects stale responses when served index marker diverges from local dist marker', () => {
  assert.equal(
    canReuseStephanosServer({
      payload: {
        service: 'stephanos-dist-server',
        distMountPath: '/apps/stephanos/dist/',
        staticRootPath: '/workspace/stephan-os',
      },
      runtimeReady: true,
      runtimeStatusReady: true,
      moduleMimeReady: true,
      sourceTruthReady: true,
      markerMatchesExpected: false,
    }),
    false,
  );
});

test('existing server reuse rejects module MIME mismatches even when marker parity would otherwise pass', () => {
  assert.equal(
    canReuseStephanosServer({
      payload: {
        service: 'stephanos-dist-server',
        distMountPath: '/apps/stephanos/dist/',
        staticRootPath: '/workspace/stephan-os',
      },
      runtimeReady: true,
      runtimeStatusReady: true,
      moduleMimeReady: false,
      sourceTruthReady: true,
      markerMatchesExpected: true,
    }),
    false,
  );
});

test('existing server reuse rejects missing runtime-status route even when health/runtime probes pass', () => {
  assert.equal(
    canReuseStephanosServer({
      payload: {
        service: 'stephanos-dist-server',
        distMountPath: '/apps/stephanos/dist/',
        staticRootPath: '/workspace/stephan-os',
      },
      runtimeReady: true,
      runtimeStatusReady: false,
      moduleMimeReady: true,
      sourceTruthReady: true,
      markerMatchesExpected: true,
    }),
    false,
  );
});

test('dist server exposes restart endpoint and reflects restart request in health payload', async (t) => {
  process.env.STEPHANOS_TEST_DISABLE_EXIT = '1';
  const server = createStephanosDistServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    delete process.env.STEPHANOS_TEST_DISABLE_EXIT;
    server.close();
  });

  const { port } = server.address();
  const restartResponse = await fetch(`http://127.0.0.1:${port}/__stephanos/restart`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: 'test',
      reason: 'integration-test',
    }),
  });

  assert.equal(restartResponse.status, 202);
  const restartPayload = await restartResponse.json();
  assert.equal(restartPayload.accepted, true);

  const healthResponse = await fetch(`http://127.0.0.1:${port}/__stephanos/health`);
  assert.equal(healthResponse.status, 200);
  const healthPayload = await healthResponse.json();
  assert.equal(healthPayload.ignitionRestart.supported, true);
  assert.equal(healthPayload.ignitionRestart.requested, true);
  assert.equal(healthPayload.ignitionRestart.source, 'test');
});
