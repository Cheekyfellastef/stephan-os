import {
  canonicalSpatialAssetContentAddress,
  planSpatialAssetRegistration,
  spatialAssetVersionIdentity,
  validateSpatialAssetRegistry,
} from './spatialWorldFoundryAssetRegistryV1.mjs';
import { validateSpatialAssetRecord } from './spatialWorldFoundryContractsV1.mjs';

export const SPATIAL_STORAGE_ADAPTER_SCHEMA_VERSION = 'stephanos.spatial-world-foundry.storage-adapter.v1';
export const SPATIAL_STORAGE_PLAN_SCHEMA_VERSION = 'stephanos.spatial-world-foundry.storage-plan.v1';
export const SPATIAL_STORAGE_RECEIPT_SCHEMA_VERSION = 'stephanos.spatial-world-foundry.storage-receipt.v1';

export const SPATIAL_STORAGE_PROVIDER_CLASSES = Object.freeze([
  'LOCAL_CONTENT_ADDRESSED',
  'GIT_LFS',
  'OBJECT_STORE',
]);

const PROVIDER_SCHEMES = Object.freeze({
  LOCAL_CONTENT_ADDRESSED: 'cas',
  GIT_LFS: 'lfs',
  OBJECT_STORE: 'object',
});
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SAFE_VERSION = /^[a-z0-9][a-z0-9._+:-]{0,127}$/;
const CONTENT_HASH = /^sha256:([0-9a-f]{64})$/;
const SHA = /^[0-9a-f]{40}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function text(value, maximum = 1024) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && value.length <= maximum
    && !CONTROL.test(value)
    ? value
    : '';
}

function plain(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}

function freeze(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  const output = {};
  for (const [key, entry] of Object.entries(value)) output[key] = freeze(entry);
  return Object.freeze(output);
}

function authority() {
  return freeze({
    storageWriteAllowed: false,
    adapterInstallAllowed: false,
    endpointSelectionAllowed: false,
    arbitraryPathAllowed: false,
    sourceMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
  });
}

export function validateSpatialStorageAdapter(adapter = {}) {
  const errors = [];
  const keys = ['schemaVersion', 'adapterId', 'adapterVersion', 'providerClass', 'scheme', 'immutableAddressing', 'contentHashVerification', 'writeReceiptRequired'];
  if (!plain(adapter)) errors.push('adapter-must-be-data-only-object');
  else {
    for (const key of Reflect.ownKeys(adapter)) if (typeof key !== 'string' || !keys.includes(key)) errors.push(`adapter-field-invalid:${String(key)}`);
    for (const key of keys) if (!Object.hasOwn(adapter, key)) errors.push(`adapter-missing-field:${key}`);
  }
  if (adapter.schemaVersion !== SPATIAL_STORAGE_ADAPTER_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  if (!SAFE_ID.test(text(adapter.adapterId, 128))) errors.push('adapterId-invalid');
  if (!SAFE_VERSION.test(text(adapter.adapterVersion, 128))) errors.push('adapterVersion-invalid');
  if (!SPATIAL_STORAGE_PROVIDER_CLASSES.includes(adapter.providerClass)) errors.push('providerClass-invalid');
  if (PROVIDER_SCHEMES[adapter.providerClass] !== adapter.scheme) errors.push('provider-scheme-mismatch');
  if (adapter.immutableAddressing !== true) errors.push('immutableAddressing-required');
  if (adapter.contentHashVerification !== true) errors.push('contentHashVerification-required');
  if (adapter.writeReceiptRequired !== true) errors.push('writeReceiptRequired-required');
  const unique = [...new Set(errors)];
  return freeze({ valid: unique.length === 0, errors: unique, refusalReason: unique[0] || '' });
}

export function planSpatialStoragePlacement(registry = {}, assetRecord = {}, adapter = {}) {
  const registryValidation = validateSpatialAssetRegistry(registry);
  if (!registryValidation.valid) return freeze({ schemaVersion: SPATIAL_STORAGE_PLAN_SCHEMA_VERSION, status: 'BLOCKED_INVALID_REGISTRY', errors: registryValidation.errors, authority: authority() });
  const assetValidation = validateSpatialAssetRecord(assetRecord);
  if (!assetValidation.valid) return freeze({ schemaVersion: SPATIAL_STORAGE_PLAN_SCHEMA_VERSION, status: 'BLOCKED_INVALID_ASSET', errors: assetValidation.errors, authority: authority() });
  const adapterValidation = validateSpatialStorageAdapter(adapter);
  if (!adapterValidation.valid) return freeze({ schemaVersion: SPATIAL_STORAGE_PLAN_SCHEMA_VERSION, status: 'BLOCKED_INVALID_ADAPTER', errors: adapterValidation.errors, authority: authority() });

  const registration = planSpatialAssetRegistration(registry, assetRecord);
  if (!['REGISTER', 'NOOP_ALREADY_REGISTERED'].includes(registration.action)) {
    return freeze({ schemaVersion: SPATIAL_STORAGE_PLAN_SCHEMA_VERSION, status: 'BLOCKED_ASSET_REGISTRATION', registration, errors: registration.errors, authority: authority() });
  }

  const canonicalAddress = canonicalSpatialAssetContentAddress(assetRecord);
  const match = assetRecord.contentHash.match(CONTENT_HASH);
  if (!canonicalAddress || !match) return freeze({ schemaVersion: SPATIAL_STORAGE_PLAN_SCHEMA_VERSION, status: 'BLOCKED_INVALID_CONTENT_IDENTITY', errors: ['canonical-content-address-required'], authority: authority() });
  const targetLocation = `${adapter.scheme}://sha256/${match[1]}`;
  const alreadyBound = assetRecord.largeAssetLocation === targetLocation || (assetRecord.largeAssetLocation === null && targetLocation === canonicalAddress);

  return freeze({
    schemaVersion: SPATIAL_STORAGE_PLAN_SCHEMA_VERSION,
    status: alreadyBound ? 'STORAGE_REFERENCE_BOUND_PROOF_REQUIRED' : 'STORAGE_WRITE_PROOF_REQUIRED',
    registryId: registry.registryId,
    registrySourceHead: registry.sourceHead,
    assetIdentity: spatialAssetVersionIdentity(assetRecord),
    contentHash: assetRecord.contentHash,
    canonicalContentAddress: canonicalAddress,
    providerClass: adapter.providerClass,
    adapterId: adapter.adapterId,
    adapterVersion: adapter.adapterVersion,
    targetLocation,
    immutableAddressing: true,
    contentHashVerificationRequired: true,
    writeReceiptRequired: true,
    registrationAction: registration.action,
    errors: [],
    authority: authority(),
  });
}

export function validateSpatialStorageReceipt(plan = {}, receipt = {}) {
  const errors = [];
  const keys = ['schemaVersion', 'adapterId', 'adapterVersion', 'assetIdentity', 'contentHash', 'targetLocation', 'registrySourceHead', 'bytes', 'verdict', 'observedAtUtc'];
  if (!plain(receipt)) errors.push('receipt-must-be-data-only-object');
  else {
    for (const key of Reflect.ownKeys(receipt)) if (typeof key !== 'string' || !keys.includes(key)) errors.push(`receipt-field-invalid:${String(key)}`);
    for (const key of keys) if (!Object.hasOwn(receipt, key)) errors.push(`receipt-missing-field:${key}`);
  }
  if (receipt.schemaVersion !== SPATIAL_STORAGE_RECEIPT_SCHEMA_VERSION) errors.push('receipt-schema-version-mismatch');
  if (plan?.schemaVersion !== SPATIAL_STORAGE_PLAN_SCHEMA_VERSION || !['STORAGE_WRITE_PROOF_REQUIRED', 'STORAGE_REFERENCE_BOUND_PROOF_REQUIRED'].includes(plan.status)) errors.push('valid-storage-plan-required');
  if (receipt.adapterId !== plan?.adapterId || receipt.adapterVersion !== plan?.adapterVersion) errors.push('adapter-binding-mismatch');
  if (receipt.assetIdentity !== plan?.assetIdentity || receipt.contentHash !== plan?.contentHash || receipt.targetLocation !== plan?.targetLocation) errors.push('asset-storage-binding-mismatch');
  if (!SHA.test(text(receipt.registrySourceHead, 40)) || receipt.registrySourceHead !== plan?.registrySourceHead) errors.push('registry-source-head-mismatch');
  if (!Number.isSafeInteger(receipt.bytes) || receipt.bytes < 0) errors.push('bytes-invalid');
  if (receipt.verdict !== 'STORED_AND_HASH_VERIFIED') errors.push('verified-storage-verdict-required');
  const observed = Date.parse(text(receipt.observedAtUtc, 64));
  if (!Number.isFinite(observed) || new Date(observed).toISOString() !== receipt.observedAtUtc) errors.push('observedAtUtc-invalid');
  const unique = [...new Set(errors)];
  return freeze({ valid: unique.length === 0, errors: unique, refusalReason: unique[0] || '', authority: authority() });
}
