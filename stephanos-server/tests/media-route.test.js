import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import express from 'express';

const HEAD = 'a'.repeat(40);
const BACKEND_BOOTSTRAP_HEAD = Symbol.for('stephanos.backend.exact-head-bootstrap');

test('Media Fabric runtime health exposes bounded exact-head identity', async () => {
  const previousBootstrapHead = globalThis[BACKEND_BOOTSTRAP_HEAD];
  globalThis[BACKEND_BOOTSTRAP_HEAD] = HEAD;

  const { default: mediaRouter } = await import(`../routes/media.js?runtime-health-test=${Date.now()}`);
  const app = express();
  app.use('/api/media', mediaRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/media/vr-atlas/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-cache');

    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.schemaVersion, 'stephanos.media-runtime-health.v1');
    assert.equal(payload.mediaFabricSchemaVersion, 'stephanos.media-asset-fabric.v1');
    assert.equal(payload.collection, 'vr-atlas');
    assert.equal(payload.assetCount, 10);
    assert.deepEqual(payload.variants, ['thumb', 'panel', 'hero']);
    assert.equal(payload.sourceHead, HEAD);
    assert.equal(payload.exactHeadIdentityAvailable, true);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (previousBootstrapHead === undefined) delete globalThis[BACKEND_BOOTSTRAP_HEAD];
    else globalThis[BACKEND_BOOTSTRAP_HEAD] = previousBootstrapHead;
  }
});
