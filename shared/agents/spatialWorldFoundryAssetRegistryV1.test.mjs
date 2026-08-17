import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPATIAL_ASSET_RECORD_SCHEMA_VERSION,
} from './spatialWorldFoundryContractsV1.mjs';
import {
  SPATIAL_ASSET_REGISTRATION_ACTION,
  buildSpatialAssetContentAddressIndex,
  canonicalSpatialAssetContentAddress,
  createSpatialAssetRegistry,
  planSpatialAssetRegistration,
  spatialAssetVersionIdentity,
  validateSpatialAssetRegistry,
} from './spatialWorldFoundryAssetRegistryV1.mjs';

const sourceHead = '9284b9ff4e2db890c7134aa6dca142453eedf13b';
const createdAtUtc = '2026-08-14T10:45:00.000Z';

function hash(char) {
  return `sha256:${char.repeat(64)}`;
}

function asset(overrides = {}) {
  return {
    schemaVersion: SPATIAL_ASSET_RECORD_SCHEMA_VERSION,
    assetId: 'asset-tree-01',
    assetType: 'mesh',
    version: 'v1',
    contentHash: hash('a'),
    sourceLocation: 'cas://source/tree-01-v1',
    largeAssetLocation: null,
    creatorAgentId: 'environment-agent',
    creatingBuildOrderId: 'build-order-001',
    planetId: 'idea-planet-01',
    regionId: 'region-alpha',
    parentVersion: null,
    sourceAndInfluenceRefs: ['design-genome:v1'],
    licenceAndRightsState: 'GENERATED_WITH_PROVENANCE',
    dependencies: [],
    dependents: [],
    engineOrRuntimeCompatibility: ['engine-neutral'],
    performanceClass: 'standard',
    validationState: 'validated',
    integrationState: 'DRAFT',
    liveState: 'NOT_LIVE',
    rollbackRefs: [],
    createdAtUtc,
    ...overrides,
  };
}

function registry(entries = [], overrides = {}) {
  const built = createSpatialAssetRegistry({
    registryId: 'registry-idea-planet-01',
    planetId: 'idea-planet-01',
    sourceHead,
    generation: 1,
    entries,
    createdAtUtc,
    ...overrides,
  });
  return built;
}

test('a valid asset registry preserves exact version identities and canonical content addresses', () => {
  const first = asset();
  const built = registry([first]);
  assert.equal(built.valid, true, built.validation.errors.join(', '));
  assert.equal(built.validation.entryCount, 1);
  assert.equal(built.validation.uniqueVersionCount, 1);
  assert.equal(spatialAssetVersionIdentity(first), 'asset-tree-01@v1');
  assert.equal(canonicalSpatialAssetContentAddress(first), `cas://sha256/${'a'.repeat(64)}`);
});

test('registry validation inherits the repaired M1 canonical asset boundary', () => {
  const noncanonicalState = registry([asset({ validationState: 'VALIDATED' })]);
  assert.equal(noncanonicalState.valid, false);
  assert.match(noncanonicalState.validation.errors.join('\n'), /validationState-invalid-or-noncanonical/);

  const traversal = registry([asset({ sourceLocation: 'assets/..\/outside.json' })]);
  assert.equal(traversal.valid, false);
  assert.match(traversal.validation.errors.join('\n'), /sourceLocation-invalid/);
});

test('content-address index deduplicates physical identity without collapsing logical asset identities', () => {
  const first = asset();
  const second = asset({
    assetId: 'asset-tree-copy-01',
    contentHash: first.contentHash,
    sourceLocation: 'object://generated/tree-copy-01',
  });
  const built = registry([first, second]);
  assert.equal(built.valid, true, built.validation.errors.join(', '));
  const index = buildSpatialAssetContentAddressIndex(built.registry);
  assert.equal(index.valid, true);
  const address = canonicalSpatialAssetContentAddress(first);
  assert.deepEqual(index.index[address], ['asset-tree-01@v1', 'asset-tree-copy-01@v1']);
});

test('a new asset registration plan is pure, content-addressed and authority-free', () => {
  const built = registry([]);
  assert.equal(built.valid, true, built.validation.errors.join(', '));
  const candidate = asset();
  const plan = planSpatialAssetRegistration(built.registry, candidate);
  assert.equal(plan.action, SPATIAL_ASSET_REGISTRATION_ACTION.REGISTER);
  assert.equal(plan.assetIdentity, 'asset-tree-01@v1');
  assert.equal(plan.currentGeneration, 1);
  assert.equal(plan.nextGeneration, 2);
  assert.equal(plan.contentAddress, `cas://sha256/${'a'.repeat(64)}`);
  assert.match(plan.candidateRegistryHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(plan.authority.storageWriteAllowed, false);
  assert.equal(plan.authority.sourceMutationAllowed, false);
  assert.equal(plan.authority.mergeAllowed, false);
  assert.equal(plan.authority.deploymentAllowed, false);
  assert.equal(plan.authority.runtimeMutationAllowed, false);
});

test('re-registering the exact immutable asset is a no-op while conflicting reuse of the same version identity is blocked', () => {
  const first = asset();
  const built = registry([first]);
  assert.equal(built.valid, true, built.validation.errors.join(', '));

  const noop = planSpatialAssetRegistration(built.registry, first);
  assert.equal(noop.action, SPATIAL_ASSET_REGISTRATION_ACTION.NOOP_ALREADY_REGISTERED);

  const conflict = planSpatialAssetRegistration(built.registry, asset({ contentHash: hash('b'), sourceLocation: 'cas://source/tree-01-conflict' }));
  assert.equal(conflict.action, SPATIAL_ASSET_REGISTRATION_ACTION.BLOCKED_IDENTITY_CONFLICT);
  assert.match(conflict.errors.join('\n'), /different-record/);
});

test('new versions require their declared parent version to already exist', () => {
  const empty = registry([]);
  const versionTwo = asset({ version: 'v2', parentVersion: 'v1', contentHash: hash('b'), sourceLocation: 'cas://source/tree-01-v2' });
  const blocked = planSpatialAssetRegistration(empty.registry, versionTwo);
  assert.equal(blocked.action, SPATIAL_ASSET_REGISTRATION_ACTION.BLOCKED_MISSING_PARENT);
  assert.equal(blocked.parentIdentity, 'asset-tree-01@v1');

  const withParent = registry([asset()]);
  const allowed = planSpatialAssetRegistration(withParent.registry, versionTwo);
  assert.equal(allowed.action, SPATIAL_ASSET_REGISTRATION_ACTION.REGISTER);
});

test('asset dependencies must already be represented in the same planet registry', () => {
  const base = registry([]);
  const dependent = asset({ dependencies: ['asset-material-bark'] });
  const blocked = planSpatialAssetRegistration(base.registry, dependent);
  assert.equal(blocked.action, SPATIAL_ASSET_REGISTRATION_ACTION.BLOCKED_MISSING_DEPENDENCY);
  assert.deepEqual(blocked.missingDependencies, ['asset-material-bark']);

  const material = asset({ assetId: 'asset-material-bark', assetType: 'material', contentHash: hash('c'), sourceLocation: 'cas://source/bark-v1' });
  const withMaterial = registry([material]);
  assert.equal(withMaterial.valid, true, withMaterial.validation.errors.join(', '));
  const allowed = planSpatialAssetRegistration(withMaterial.registry, dependent);
  assert.equal(allowed.action, SPATIAL_ASSET_REGISTRATION_ACTION.REGISTER);
});

test('registry validation fails closed on dependency cycles even when every referenced asset exists', () => {
  const first = asset({ assetId: 'asset-a', dependencies: ['asset-b'] });
  const second = asset({ assetId: 'asset-b', dependencies: ['asset-a'], contentHash: hash('b'), sourceLocation: 'cas://source/asset-b' });
  const candidate = {
    schemaVersion: 'stephanos.spatial-asset-registry.v1',
    registryId: 'registry-idea-planet-01',
    planetId: 'idea-planet-01',
    sourceHead,
    generation: 1,
    entries: [first, second],
    createdAtUtc,
  };
  const validation = validateSpatialAssetRegistry(candidate);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('\n'), /dependency-cycle:/);
});

test('registry validation rejects cross-planet assets and missing parent lineage', () => {
  const wrongPlanet = {
    schemaVersion: 'stephanos.spatial-asset-registry.v1',
    registryId: 'registry-idea-planet-01',
    planetId: 'idea-planet-01',
    sourceHead,
    generation: 1,
    entries: [asset({ planetId: 'idea-planet-02' })],
    createdAtUtc,
  };
  const planetValidation = validateSpatialAssetRegistry(wrongPlanet);
  assert.equal(planetValidation.valid, false);
  assert.match(planetValidation.errors.join('\n'), /planetId-mismatch/);

  const missingParent = {
    ...wrongPlanet,
    entries: [asset({ version: 'v2', parentVersion: 'v1', contentHash: hash('b'), sourceLocation: 'cas://source/tree-v2' })],
  };
  const parentValidation = validateSpatialAssetRegistry(missingParent);
  assert.equal(parentValidation.valid, false);
  assert.match(parentValidation.errors.join('\n'), /missing-parent:/);
});
