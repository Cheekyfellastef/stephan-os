import test from 'node:test';
import assert from 'node:assert/strict';

import {
  planSpatialStoragePlacement,
  SPATIAL_STORAGE_ADAPTER_SCHEMA_VERSION,
  SPATIAL_STORAGE_RECEIPT_SCHEMA_VERSION,
  validateSpatialStorageAdapter,
  validateSpatialStorageReceipt,
} from './spatialWorldFoundryStorageContractV1.mjs';

const SOURCE_HEAD = 'a'.repeat(40);
const HASH_HEX = 'b'.repeat(64);

function registry() {
  return {
    schemaVersion: 'stephanos.spatial-asset-registry.v1',
    registryId: 'planet-a-registry',
    planetId: 'planet-a',
    sourceHead: SOURCE_HEAD,
    generation: 1,
    entries: [],
    createdAtUtc: '2026-08-17T15:00:00.000Z',
  };
}

function asset(overrides = {}) {
  return {
    schemaVersion: 'stephanos.spatial-asset-registry-record.v1',
    assetId: 'asset-a',
    assetType: 'mesh',
    version: 'v1',
    contentHash: `sha256:${HASH_HEX}`,
    sourceLocation: `cas://sha256/${HASH_HEX}`,
    largeAssetLocation: null,
    creatorAgentId: 'mesh-agent',
    creatingBuildOrderId: 'build-order-a',
    planetId: 'planet-a',
    regionId: 'region-a',
    parentVersion: null,
    sourceAndInfluenceRefs: ['research:primitive'],
    licenceAndRightsState: 'GENERATED_WITH_PROVENANCE',
    dependencies: [],
    dependents: [],
    engineOrRuntimeCompatibility: ['engine-neutral'],
    performanceClass: 'small',
    validationState: 'pending',
    integrationState: 'DRAFT',
    liveState: 'NOT_LIVE',
    rollbackRefs: [],
    createdAtUtc: '2026-08-17T15:00:00.000Z',
    ...overrides,
  };
}

function adapter(providerClass = 'OBJECT_STORE') {
  const scheme = providerClass === 'LOCAL_CONTENT_ADDRESSED' ? 'cas' : providerClass === 'GIT_LFS' ? 'lfs' : 'object';
  return {
    schemaVersion: SPATIAL_STORAGE_ADAPTER_SCHEMA_VERSION,
    adapterId: `${scheme}-adapter`,
    adapterVersion: 'v1',
    providerClass,
    scheme,
    immutableAddressing: true,
    contentHashVerification: true,
    writeReceiptRequired: true,
  };
}

test('plans immutable object storage without granting a write', () => {
  const plan = planSpatialStoragePlacement(registry(), asset(), adapter('OBJECT_STORE'));
  assert.equal(plan.status, 'STORAGE_WRITE_PROOF_REQUIRED', plan.errors?.join('\n'));
  assert.equal(plan.targetLocation, `object://sha256/${HASH_HEX}`);
  assert.equal(plan.canonicalContentAddress, `cas://sha256/${HASH_HEX}`);
  assert.equal(plan.authority.storageWriteAllowed, false);
  assert.equal(plan.authority.endpointSelectionAllowed, false);
});

test('local CAS can bind the canonical identity but still requires proof', () => {
  const plan = planSpatialStoragePlacement(registry(), asset(), adapter('LOCAL_CONTENT_ADDRESSED'));
  assert.equal(plan.status, 'STORAGE_REFERENCE_BOUND_PROOF_REQUIRED');
  assert.equal(plan.writeReceiptRequired, true);
});

test('adapter cannot smuggle an endpoint, path or command field', () => {
  const unsafe = { ...adapter(), endpoint: 'https://example.invalid/bucket' };
  const validation = validateSpatialStorageAdapter(unsafe);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some((error) => error.includes('adapter-field-invalid')), true);
});

test('exact hash-bound storage receipt proves only the storage fact', () => {
  const plan = planSpatialStoragePlacement(registry(), asset(), adapter('OBJECT_STORE'));
  const receipt = {
    schemaVersion: SPATIAL_STORAGE_RECEIPT_SCHEMA_VERSION,
    adapterId: plan.adapterId,
    adapterVersion: plan.adapterVersion,
    assetIdentity: plan.assetIdentity,
    contentHash: plan.contentHash,
    targetLocation: plan.targetLocation,
    registrySourceHead: plan.registrySourceHead,
    bytes: 4096,
    verdict: 'STORED_AND_HASH_VERIFIED',
    observedAtUtc: '2026-08-17T15:02:00.000Z',
  };
  const validation = validateSpatialStorageReceipt(plan, receipt);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.equal(validation.authority.sourceMutationAllowed, false);
  assert.equal(validation.authority.runtimeMutationAllowed, false);

  const wrong = validateSpatialStorageReceipt(plan, { ...receipt, contentHash: `sha256:${'c'.repeat(64)}` });
  assert.equal(wrong.valid, false);
  assert.equal(wrong.errors.includes('asset-storage-binding-mismatch'), true);
});
