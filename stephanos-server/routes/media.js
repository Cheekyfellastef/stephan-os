import express from 'express';

import {
  getVrAtlasMediaManifest,
  resolveVrAtlasMediaAsset,
} from '../services/mediaAssetService.js';

const router = express.Router();

router.get('/vr-atlas/manifest', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json(getVrAtlasMediaManifest());
});

router.get('/vr-atlas/:assetId/:variant', async (req, res) => {
  const result = await resolveVrAtlasMediaAsset(req.params.assetId, req.params.variant);
  if (!result.ok) {
    res.status(result.status || 404).json({ ok: false, reason: result.reason || 'MEDIA_ASSET_NOT_FOUND' });
    return;
  }

  res.set({
    'Content-Type': result.contentType,
    'Content-Length': String(result.byteSize),
    'Cache-Control': result.cacheControl,
    ETag: `"sha256-${result.sha256}"`,
    'X-Stephanos-Media-Collection': result.collection,
    'X-Stephanos-Media-Asset': result.assetId,
    'X-Stephanos-Media-Variant': result.variant,
    'X-Stephanos-Media-Sha256': result.sha256,
    'X-Stephanos-Media-Width': String(result.width),
    'X-Stephanos-Media-Height': String(result.height),
    'X-Stephanos-Media-Bytes': String(result.byteSize),
    'X-Stephanos-Media-Source': result.source,
    'X-Stephanos-Media-Quality': result.qualityClass,
  });
  res.status(200).send(result.bytes);
});

export default router;
