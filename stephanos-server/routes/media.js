import express from 'express';

import { inspectMediaAssetBytes } from '../../shared/media/mediaAssetInspectionV1.mjs';
import {
  getVrAtlasMediaManifest,
  resolveVrAtlasMediaAsset,
} from '../services/mediaAssetService.js';

const FULL_SHA = /^[0-9a-f]{40}$/;

function immutableBackendSourceHead(backendIdentity) {
  const candidate = String(backendIdentity?.sourceHead || '').trim().toLowerCase();
  return FULL_SHA.test(candidate) ? candidate : '';
}

export function createMediaRouter({ backendIdentity = null } = {}) {
  const router = express.Router();
  const sourceHead = immutableBackendSourceHead(backendIdentity);

  router.get('/vr-atlas/manifest', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json(getVrAtlasMediaManifest());
  });

  router.get('/vr-atlas/health', (_req, res) => {
    const manifest = getVrAtlasMediaManifest();
    res.set('Cache-Control', 'no-cache');
    res.json({
      ok: true,
      schemaVersion: 'stephanos.media-runtime-health.v1',
      mediaFabricSchemaVersion: manifest.schemaVersion,
      collection: manifest.collection,
      assetCount: manifest.assetCount,
      sharpFallback: manifest.sharpFallback,
      variants: ['thumb', 'panel', 'hero'],
      sourceHead,
      exactHeadIdentityAvailable: Boolean(sourceHead),
    });
  });

  router.get('/vr-atlas/:assetId/:variant', async (req, res) => {
    const result = await resolveVrAtlasMediaAsset(req.params.assetId, req.params.variant);
    if (!result.ok) {
      res.status(result.status || 404).json({ ok: false, reason: result.reason || 'MEDIA_ASSET_NOT_FOUND' });
      return;
    }

    const inspection = inspectMediaAssetBytes(result.bytes, result.extension);
    if (!inspection.ok || inspection.width !== result.width || inspection.height !== result.height) {
      res.status(422).json({
        ok: false,
        reason: 'MEDIA_ASSET_BYTE_IDENTITY_FAILED',
        observedFormat: inspection.format || '',
        observedWidth: inspection.width || 0,
        observedHeight: inspection.height || 0,
      });
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
      'X-Stephanos-Media-Width': String(inspection.width),
      'X-Stephanos-Media-Height': String(inspection.height),
      'X-Stephanos-Media-Bytes': String(result.byteSize),
      'X-Stephanos-Media-Source': result.source,
      'X-Stephanos-Media-Quality': result.qualityClass,
      'X-Stephanos-Media-Byte-Identity': 'verified',
    });
    res.status(200).send(result.bytes);
  });

  return router;
}

export default createMediaRouter();
