import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  MEDIA_ASSET_POINTER_SCHEMA,
  MEDIA_COLLECTION_VR_ATLAS,
  mediaVariantSpec,
  validateMediaAssetPointer,
} from '../shared/media/mediaAssetFabricV1.mjs';
import { inspectMediaAssetBytes } from '../shared/media/mediaAssetInspectionV1.mjs';
import {
  getVrAtlasMediaManifest,
  renderVrAtlasVectorFallback,
  resolveVrAtlasMediaAsset,
} from '../stephanos-server/services/mediaAssetService.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('Media Asset Fabric publishes ten VR Atlas assets with 640/1920/3840 variants', () => {
  const manifest = getVrAtlasMediaManifest();
  assert.equal(manifest.schemaVersion, 'stephanos.media-asset-fabric.v1');
  assert.equal(manifest.collection, MEDIA_COLLECTION_VR_ATLAS);
  assert.equal(manifest.assetCount, 10);
  assert.equal(manifest.assets.length, 10);
  for (const asset of manifest.assets) {
    assert.deepEqual(
      Object.fromEntries(Object.entries(asset.variants).map(([name, value]) => [name, [value.width, value.height]])),
      { thumb: [640, 360], panel: [1920, 1080], hero: [3840, 2160] },
    );
    assert.match(asset.variants.hero.url, new RegExp(`/api/media/vr-atlas/${asset.assetId}/hero$`));
  }
});

test('vector-native fallback is resolution-independent, byte-verifiable and truth-labelled', () => {
  const hero = renderVrAtlasVectorFallback('spatial-bridge', 'hero');
  assert.ok(hero);
  assert.equal(hero.contentType, 'image/svg+xml');
  assert.equal(hero.width, 3840);
  assert.equal(hero.height, 2160);
  assert.equal(hero.qualityClass, 'VECTOR_NATIVE_SHARP');
  assert.match(hero.bytes.toString('utf8'), /VECTOR-NATIVE SHARP FALLBACK · NOT RUNTIME PROOF/);
  assert.equal(hero.sha256, sha256(hero.bytes));
  const inspected = inspectMediaAssetBytes(hero.bytes, hero.extension);
  assert.deepEqual([inspected.ok, inspected.width, inspected.height], [true, 3840, 2160]);
});

test('4K raster quality gate rejects the old tiny-payload failure mode and thumbnail upscale lineage', () => {
  const spec = mediaVariantSpec('hero');
  const base = {
    schemaVersion: MEDIA_ASSET_POINTER_SCHEMA,
    collection: MEDIA_COLLECTION_VR_ATLAS,
    assetId: 'spatial-bridge',
    variant: 'hero',
    extension: 'avif',
    contentType: 'image/avif',
    width: spec.width,
    height: spec.height,
    sha256: 'a'.repeat(64),
    sourceMasterSha256: 'b'.repeat(64),
    byteSize: 90_000,
    derivedFromVariant: 'master',
  };
  const tiny = validateMediaAssetPointer(base, { collection: MEDIA_COLLECTION_VR_ATLAS, assetId: 'spatial-bridge', variant: 'hero' });
  assert.equal(tiny.ok, false);
  assert.ok(tiny.reasons.includes('raster-quality-floor-failed'));

  const upscaled = validateMediaAssetPointer({ ...base, byteSize: 900_000, derivedFromVariant: 'thumb' }, { collection: MEDIA_COLLECTION_VR_ATLAS, assetId: 'spatial-bridge', variant: 'hero' });
  assert.equal(upscaled.ok, false);
  assert.ok(upscaled.reasons.includes('thumbnail-upscale-forbidden'));
});

test('media byte inspector rejects arbitrary bytes even when their size looks like a 4K raster', () => {
  const fake = Buffer.alloc(900_000, 7);
  const inspected = inspectMediaAssetBytes(fake, 'avif');
  assert.equal(inspected.ok, false);
  assert.equal(inspected.reason, 'avif-signature-invalid');
});

test('content-addressed cache wins over fallback only when pointer, hash, bytes and natural dimensions agree', async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'stephanos-media-fabric-'));
  try {
    const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2160" viewBox="0 0 3840 2160"><rect width="3840" height="2160" fill="#06131f"/></svg>', 'utf8');
    const digest = sha256(bytes);
    await mkdir(join(cacheRoot, 'objects'), { recursive: true });
    await mkdir(join(cacheRoot, 'pointers', 'vr-atlas'), { recursive: true });
    await writeFile(join(cacheRoot, 'objects', `${digest}.svg`), bytes);
    await writeFile(join(cacheRoot, 'pointers', 'vr-atlas', 'spatial-bridge.hero.json'), JSON.stringify({
      schemaVersion: MEDIA_ASSET_POINTER_SCHEMA,
      collection: MEDIA_COLLECTION_VR_ATLAS,
      assetId: 'spatial-bridge',
      variant: 'hero',
      extension: 'svg',
      contentType: 'image/svg+xml',
      width: 3840,
      height: 2160,
      byteSize: bytes.length,
      sha256: digest,
      sourceMasterSha256: 'c'.repeat(64),
      derivedFromVariant: 'master',
    }));

    const resolved = await resolveVrAtlasMediaAsset('spatial-bridge', 'hero', { cacheRoot });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.source, 'verified-content-addressed-cache');
    assert.equal(resolved.sha256, digest);
    assert.equal(resolved.byteSize, bytes.length);
    const inspected = inspectMediaAssetBytes(resolved.bytes, resolved.extension);
    assert.deepEqual([inspected.ok, inspected.width, inspected.height], [true, 3840, 2160]);
  } finally {
    await rm(cacheRoot, { recursive: true, force: true });
  }
});

test('registered atlas entry uses the Media Fabric client rather than the legacy base64 loader', async () => {
  const app = JSON.parse(await readFile(resolve(root, 'apps/vr-capability-atlas/app.json'), 'utf8'));
  const html = await readFile(resolve(root, 'apps/vr-capability-atlas/index-v3.html'), 'utf8');
  const client = await readFile(resolve(root, 'apps/vr-capability-atlas/atlas-v3.js'), 'utf8');
  assert.equal(app.entry, 'index-v3.html');
  assert.ok(app.capabilities.includes('media-asset-fabric-v1'));
  assert.match(html, /atlas-v3\.js/);
  assert.match(client, /\/api\/media\/vr-atlas\//);
  assert.doesNotMatch(client, /\.avif\.b64\.txt/);
  assert.doesNotMatch(client, /atob\(/);
});
