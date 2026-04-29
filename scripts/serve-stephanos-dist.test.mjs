import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import {
  canReuseStephanosServer,
  createStephanosDistServer,
  resolveContentType,
} from './serve-stephanos-dist.mjs';
import { repoRoot } from './stephanos-build-utils.mjs';
import { createStephanosLocalUrls } from '../shared/runtime/stephanosLocalUrls.mjs';
import { OPENCLAW_READONLY_VALIDATION_ENDPOINT } from '../shared/agents/openClawReadonlyValidationEndpoint.mjs';


const { distMountPath } = createStephanosLocalUrls({
  port: Number(process.env.STEPHANOS_SERVE_PORT || 4173),
});

function createHealthyReuseProbe(overrides = {}) {
  return {
    payload: {
      service: 'stephanos-dist-server',
      distMountPath,
      staticRootPath: repoRoot,
    },
    runtimeReady: true,
    runtimeStatusReady: true,
    moduleMimeReady: true,
    sourceTruthReady: true,
    scriptEntryMatchesExpected: true,
    markerMatchesExpected: true,
    ...overrides,
  };
}

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

test('dist server routes runtime-status before static 404 handling (query-string safe)', async (t) => {
  const server = createStephanosDistServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/apps/stephanos/runtime-status.json?source=launcher`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(typeof payload.runtimeMarker, 'string');
});

test('existing server reuse requires runtime marker parity and not just health', () => {
  assert.equal(
    canReuseStephanosServer(createHealthyReuseProbe({ markerMatchesExpected: true })),
    true,
  );

  assert.equal(
    canReuseStephanosServer(createHealthyReuseProbe({ markerMatchesExpected: false })),
    false,
  );
});

test('existing server reuse rejects stale responses when served index marker diverges from local dist marker', () => {
  assert.equal(
    canReuseStephanosServer({
      ...createHealthyReuseProbe({
        markerMatchesExpected: false,
      }),
    }),
    false,
  );
});

test('existing server reuse rejects module MIME mismatches even when marker parity would otherwise pass', () => {
  assert.equal(
    canReuseStephanosServer({
      ...createHealthyReuseProbe({
        moduleMimeReady: false,
      }),
    }),
    false,
  );
});

test('existing server reuse rejects missing runtime-status route even when health/runtime probes pass', () => {
  assert.equal(
    canReuseStephanosServer({
      ...createHealthyReuseProbe({
        runtimeStatusReady: false,
      }),
    }),
    false,
  );
});

test('existing server reuse rejects stale served script entry references even when marker parity passes', () => {
  assert.equal(
    canReuseStephanosServer({
      ...createHealthyReuseProbe({
        scriptEntryMatchesExpected: false,
      }),
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

test('readonly validation endpoint rejects non-loopback host', async (t) => {
  const server = createStephanosDistServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${OPENCLAW_READONLY_VALIDATION_ENDPOINT.path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpointHost: '192.168.1.20', endpointPort: 8787, endpointScope: 'local_only', allowedProbeTypes: 'health_and_handshake' }),
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.validationStatus, 'blocked');
});

test('readonly validation endpoint rejects non-local scope and credential-bearing payloads', async (t) => {
  const server = createStephanosDistServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${OPENCLAW_READONLY_VALIDATION_ENDPOINT.path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpointHost: '127.0.0.1',
      endpointPort: 8787,
      endpointScope: 'remote',
      allowedProbeTypes: 'health_and_handshake',
      authorization: 'Bearer should-be-rejected',
    }),
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.executionAllowed, false);
  assert.equal(payload.validationStatus, 'blocked');
  assert.equal(payload.validationBlockers.some((entry) => entry.includes('local_only')), true);
  assert.equal(payload.validationBlockers.some((entry) => entry.includes('Credential/token-bearing input')), true);
});

test('readonly validation endpoint rejects unsupported probe types (no arbitrary path proxy)', async (t) => {
  const server = createStephanosDistServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${OPENCLAW_READONLY_VALIDATION_ENDPOINT.path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpointHost: '127.0.0.1',
      endpointPort: 8787,
      endpointScope: 'local_only',
      allowedProbeTypes: '/arbitrary/path',
    }),
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.validationStatus, 'blocked');
  assert.equal(payload.validationBlockers.some((entry) => entry.includes('Allowed probe type')), true);
});

test('readonly validation endpoint returns unavailable/failing safely when local adapter is offline', async (t) => {
  const server = createStephanosDistServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${OPENCLAW_READONLY_VALIDATION_ENDPOINT.path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpointHost: '127.0.0.1', endpointPort: 65534, endpointScope: 'local_only', expectedProtocolVersion: 'v1', allowedProbeTypes: 'health_and_handshake' }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.executionAllowed, false);
  assert.match(payload.validationStatus, /failed|succeeded/);
  assert.ok(['unavailable', 'failing', 'passing', 'not_run'].includes(payload.healthResult.state));
  assert.deepEqual(payload.healthResult.evidence, ['probe:/health']);
  assert.deepEqual(payload.handshakeResult.evidence, ['probe:/handshake']);
  assert.equal(payload.executionAllowed, false);
});
