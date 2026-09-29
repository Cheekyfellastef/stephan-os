import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chooseAtlasMediaTransport } from '../apps/vr-capability-atlas/atlas-media-resilience.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('VR Atlas uses Media Fabric only when a verified raster cache is actually serving artwork', () => {
  assert.equal(chooseAtlasMediaTransport({ ok: true, source: 'verified-content-addressed-cache' }), 'fabric');
  assert.equal(chooseAtlasMediaTransport({ ok: true, source: 'vector-native-fallback' }), 'bundled');
  assert.equal(chooseAtlasMediaTransport({ ok: false, source: '' }), 'bundled');
});

test('VR Atlas wires media resilience before V3 rendering and retains portable bundled artwork fallback', async () => {
  const html = await readFile(resolve(root, 'apps/vr-capability-atlas/index-v3.html'), 'utf8');
  const resilience = await readFile(resolve(root, 'apps/vr-capability-atlas/atlas-media-resilience.mjs'), 'utf8');

  const resilienceIndex = html.indexOf('./atlas-media-resilience.mjs');
  const atlasIndex = html.indexOf('./atlas-v3.js');
  assert.ok(resilienceIndex >= 0, 'resilience module must be loaded');
  assert.ok(atlasIndex > resilienceIndex, 'resilience module must install before V3 renders media');
  assert.match(resilience, /resolveStephanosBackendClientBaseUrl/);
  assert.match(resilience, /concept\.assets/);
  assert.match(resilience, /image\/avif/);
  assert.match(resilience, /MutationObserver/);
  assert.match(resilience, /verified-content-addressed-cache/);
  assert.match(resilience, /conceptIdForImage/);
  assert.match(resilience, /picture\[data-media-asset\] img/);
});
