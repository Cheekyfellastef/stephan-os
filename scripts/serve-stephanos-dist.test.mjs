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

test('existing server reuse requires runtime marker parity and not just health', () => {
  const healthyStephanosServer = {
    payload: {
      service: 'stephanos-dist-server',
      distMountPath: '/apps/stephanos/dist/',
      staticRootPath: '/workspace/stephan-os',
    },
    runtimeReady: true,
    moduleMimeReady: true,
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
      moduleMimeReady: true,
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
      moduleMimeReady: false,
      markerMatchesExpected: true,
    }),
    false,
  );
});
