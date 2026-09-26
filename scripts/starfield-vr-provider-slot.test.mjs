import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  STARFIELD_VR_PROVIDER_SLOT_DRY_RUN,
  STARFIELD_VR_PROVIDER_SLOT_READY,
  applyProviderSlot,
  buildProviderSlotPlan,
  sha256File,
} from './starfield-vr-provider-slot.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'starfield-provider-slot-'));
  const vr = path.join(root, 'vr');
  const providers = path.join(vr, 'providers');
  const game = path.join(root, 'game');
  const vorpx = path.join(providers, 'vorpx');
  const mutar = path.join(providers, 'mutar-openxr', 'v2.0.1.Public');
  await Promise.all([
    mkdir(vorpx, { recursive: true }),
    mkdir(mutar, { recursive: true }),
    mkdir(game, { recursive: true }),
  ]);

  const vorpxDxgi = path.join(vorpx, 'dxgi.dll');
  const mutarDxgi = path.join(mutar, 'dxgi.dll');
  const mutarLoader = path.join(mutar, 'openxr_loader.dll');
  const liveDxgi = path.join(game, 'dxgi.dll');
  const liveLoader = path.join(game, 'openxr_loader.dll');

  await writeFile(vorpxDxgi, 'vorpx-driver');
  await writeFile(mutarDxgi, 'mutar-driver');
  await writeFile(mutarLoader, 'mutar-openxr-loader');
  await writeFile(liveDxgi, 'vorpx-driver');
  await writeFile(liveLoader, 'old-loader');

  const vorpxHash = await sha256File(vorpxDxgi);
  const mutarHash = await sha256File(mutarDxgi);
  const loaderHash = await sha256File(mutarLoader);
  const manifestPath = path.join(vr, 'starfield-vr-provider-cache.json');
  const manifest = {
    schemaVersion: 'stephanos.starfield-vr-provider-cache.v1',
    gameRoot: game,
    liveSlotPath: liveDxgi,
    providers: {
      vorpx: {
        status: 'verified-source',
        version: '25.1.5.0',
        files: [
          { role: 'injection-proxy', path: vorpxDxgi, sha256: vorpxHash },
        ],
      },
      'mutar-openxr': {
        status: 'experimental-source',
        version: 'v2.0.1.Public',
        files: [
          { role: 'injection-proxy', path: mutarDxgi, sha256: mutarHash },
          { role: 'openxr-loader', path: mutarLoader, sha256: loaderHash },
        ],
      },
    },
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    root,
    vr,
    providers,
    game,
    manifest,
    manifestPath,
    vorpxDxgi,
    mutarDxgi,
    mutarLoader,
    liveDxgi,
    liveLoader,
    vorpxHash,
    mutarHash,
    loaderHash,
  };
}

test('dry-run reports required provider changes without mutating Starfield files', async () => {
  const fx = await fixture();
  const beforeDxgi = await sha256File(fx.liveDxgi);
  const beforeLoader = await sha256File(fx.liveLoader);

  const result = await applyProviderSlot({
    manifestPath: fx.manifestPath,
    provider: 'mutar-openxr',
    apply: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.verdict, STARFIELD_VR_PROVIDER_SLOT_DRY_RUN);
  assert.equal(result.applied, false);
  assert.equal(result.changesRequired, 2);
  assert.equal(await sha256File(fx.liveDxgi), beforeDxgi);
  assert.equal(await sha256File(fx.liveLoader), beforeLoader);
  assert.match(await readFile(result.receiptPath, 'utf8'), /STARFIELD_VR_PROVIDER_SLOT_DRY_RUN/);
});

test('apply switches the exact Mutar provider files and is idempotent', async () => {
  const fx = await fixture();

  const first = await applyProviderSlot({
    manifestPath: fx.manifestPath,
    provider: 'mutar-openxr',
    apply: true,
  });
  assert.equal(first.verdict, STARFIELD_VR_PROVIDER_SLOT_READY);
  assert.equal(first.changed, true);
  assert.equal(await sha256File(fx.liveDxgi), fx.mutarHash);
  assert.equal(await sha256File(fx.liveLoader), fx.loaderHash);

  const second = await applyProviderSlot({
    manifestPath: fx.manifestPath,
    provider: 'mutar-openxr',
    apply: true,
  });
  assert.equal(second.verdict, STARFIELD_VR_PROVIDER_SLOT_READY);
  assert.equal(second.changed, false);
});

test('apply can return the injection slot to the verified VorpX driver', async () => {
  const fx = await fixture();
  await applyProviderSlot({ manifestPath: fx.manifestPath, provider: 'mutar-openxr', apply: true });
  const result = await applyProviderSlot({ manifestPath: fx.manifestPath, provider: 'vorpx', apply: true });

  assert.equal(result.verdict, STARFIELD_VR_PROVIDER_SLOT_READY);
  assert.equal(await sha256File(fx.liveDxgi), fx.vorpxHash);
  assert.equal(await sha256File(fx.liveLoader), fx.loaderHash);
});

test('source files outside the Stephanos provider cache are rejected', async () => {
  const fx = await fixture();
  const outside = path.join(fx.root, 'outside.dll');
  await writeFile(outside, 'outside');
  fx.manifest.providers.vorpx.files[0].path = outside;
  fx.manifest.providers.vorpx.files[0].sha256 = await sha256File(outside);
  await writeFile(fx.manifestPath, JSON.stringify(fx.manifest, null, 2));

  await assert.rejects(
    () => buildProviderSlotPlan({ manifestPath: fx.manifestPath, provider: 'vorpx' }),
    /provider-source-outside-cache/,
  );
});

test('bad source hashes and unsupported providers fail closed', async () => {
  const fx = await fixture();
  fx.manifest.providers.vorpx.files[0].sha256 = '0'.repeat(64);
  await writeFile(fx.manifestPath, JSON.stringify(fx.manifest, null, 2));

  await assert.rejects(
    () => buildProviderSlotPlan({ manifestPath: fx.manifestPath, provider: 'vorpx' }),
    /provider-source-hash-mismatch/,
  );
  await assert.rejects(
    () => buildProviderSlotPlan({ manifestPath: fx.manifestPath, provider: 'hybrid' }),
    /provider-not-allowlisted/,
  );
});

test('manifest cannot redirect the live slot away from Starfield dxgi.dll', async () => {
  const fx = await fixture();
  fx.manifest.liveSlotPath = path.join(fx.game, 'other.dll');
  await writeFile(fx.manifestPath, JSON.stringify(fx.manifest, null, 2));

  await assert.rejects(
    () => buildProviderSlotPlan({ manifestPath: fx.manifestPath, provider: 'vorpx' }),
    /live-slot-path-not-fixed/,
  );
});
