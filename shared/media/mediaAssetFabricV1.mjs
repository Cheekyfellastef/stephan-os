export const MEDIA_ASSET_FABRIC_SCHEMA = 'stephanos.media-asset-fabric.v1';
export const MEDIA_ASSET_POINTER_SCHEMA = 'stephanos.media-asset-pointer.v1';
export const MEDIA_COLLECTION_VR_ATLAS = 'vr-atlas';

export const MEDIA_VARIANTS = Object.freeze({
  thumb: Object.freeze({ width: 640, height: 360, minimumRasterBytes: 24_000 }),
  panel: Object.freeze({ width: 1920, height: 1080, minimumRasterBytes: 180_000 }),
  hero: Object.freeze({ width: 3840, height: 2160, minimumRasterBytes: 600_000 }),
});

export const MEDIA_CONTENT_TYPES = Object.freeze({
  avif: 'image/avif',
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
});

const SHA256 = /^[0-9a-f]{64}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{1,80}$/;

export function mediaVariantSpec(variant) {
  return MEDIA_VARIANTS[String(variant || '').toLowerCase()] || null;
}

export function mediaAssetApiPath(collection, assetId, variant) {
  const safeCollection = String(collection || '').toLowerCase();
  const safeAssetId = String(assetId || '').toLowerCase();
  const safeVariant = String(variant || '').toLowerCase();
  if (!SAFE_ID.test(safeCollection) || !SAFE_ID.test(safeAssetId) || !mediaVariantSpec(safeVariant)) return '';
  return `/api/media/${safeCollection}/${safeAssetId}/${safeVariant}`;
}

export function validateMediaAssetPointer(pointer = {}, expected = {}) {
  const assetId = String(pointer.assetId || '').toLowerCase();
  const collection = String(pointer.collection || '').toLowerCase();
  const variant = String(pointer.variant || '').toLowerCase();
  const extension = String(pointer.extension || '').toLowerCase();
  const contentType = String(pointer.contentType || '').toLowerCase();
  const spec = mediaVariantSpec(variant);
  const reasons = [];

  if (pointer.schemaVersion !== MEDIA_ASSET_POINTER_SCHEMA) reasons.push('schema-version-invalid');
  if (!SAFE_ID.test(assetId)) reasons.push('asset-id-invalid');
  if (!SAFE_ID.test(collection)) reasons.push('collection-invalid');
  if (!spec) reasons.push('variant-invalid');
  if (!SHA256.test(String(pointer.sha256 || ''))) reasons.push('sha256-invalid');
  if (!SHA256.test(String(pointer.sourceMasterSha256 || ''))) reasons.push('source-master-sha256-invalid');
  if (!Object.hasOwn(MEDIA_CONTENT_TYPES, extension)) reasons.push('extension-invalid');
  if (MEDIA_CONTENT_TYPES[extension] !== contentType) reasons.push('content-type-mismatch');

  if (expected.collection && collection !== String(expected.collection).toLowerCase()) reasons.push('collection-mismatch');
  if (expected.assetId && assetId !== String(expected.assetId).toLowerCase()) reasons.push('asset-id-mismatch');
  if (expected.variant && variant !== String(expected.variant).toLowerCase()) reasons.push('variant-mismatch');

  if (spec) {
    if (Number(pointer.width) !== spec.width || Number(pointer.height) !== spec.height) reasons.push('dimensions-invalid');
    const byteSize = Number(pointer.byteSize);
    if (!Number.isSafeInteger(byteSize) || byteSize < 1) reasons.push('byte-size-invalid');
    if (extension !== 'svg' && Number.isSafeInteger(byteSize) && byteSize < spec.minimumRasterBytes) reasons.push('raster-quality-floor-failed');
    const derivedFromVariant = String(pointer.derivedFromVariant || '').toLowerCase();
    if ((variant === 'panel' || variant === 'hero') && derivedFromVariant === 'thumb') reasons.push('thumbnail-upscale-forbidden');
  }

  return Object.freeze({
    ok: reasons.length === 0,
    reasons: Object.freeze(reasons),
    assetId,
    collection,
    variant,
    extension,
    contentType,
    spec,
  });
}
