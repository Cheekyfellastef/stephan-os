import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import express from 'express';

import mediaRouter from '../routes/media.js';

const HEAD = 'a'.repeat(40);

test('Media Fabric runtime health exposes bounded exact-head identity', async () => {
  const previousSourceHead = process.env.STEPHANOS_BACKEND_SOURCE_HEAD;
  process.env.STEPHANOS_BACKEND_SOURCE_HEAD = HEAD;

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
    if (previousSourceHead === undefined) delete process.env.STEPHANOS_BACKEND_SOURCE_HEAD;
    else process.env.STEPHANOS_BACKEND_SOURCE_HEAD = previousSourceHead;
  }
});
