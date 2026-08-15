import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SPATIAL_ASSET_RECORD_SCHEMA_VERSION,
  SPATIAL_BUILD_ORDER_SCHEMA_VERSION,
  SPATIAL_PROVENANCE_SCHEMA_VERSION,
  SPATIAL_WORLD_SNAPSHOT_SCHEMA_VERSION,
  validateSpatialAssetRecord,
  validateSpatialBuildOrder,
  validateSpatialProvenanceRecord,
  validateSpatialWorldFoundryBundle,
  validateSpatialWorldSnapshot,
} from './spatialWorldFoundryContractsV1.mjs';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const SOURCE_HEAD = '9284b9ff4e2db890c7134aa6dca142453eedf13b';
const CREATED_AT = '2026-08-14T10:30:00.000Z';

function buildOrder(overrides = {}) {
  return {
    schemaVersion: SPATIAL_BUILD_ORDER_SCHEMA_VERSION,
    spatialBuildOrderId: 'sbo.idea-planet-001.crate-001',
    intentId: 'intent.idea-planet-001',
    missionId: 'mission.spatial-world-foundry-001',
    planetId: 'idea-planet-001',
    regionId: 'landing-bay',
    objectIds: ['crate-001'],
    operatorRequest: 'Create a small interactive storage crate for the landing bay preview.',
    interpretationSummary: 'Generate one original low-cost test asset in an isolated candidate state.',
    designGenomeVersion: 'planet-genome.v1',
    researchRefs: ['vr-research/spatial-foundry/primitive-assets'],
    requiredOutcome: 'One previewable crate asset with provenance, validation and rollback identity.',
    assetClasses: ['mesh', 'material'],
    codeClasses: ['interaction'],
    dependencies: [],
    ownedResourceScopes: ['region:idea-planet-001/landing-bay', 'object:crate-001'],
    allowedOperations: ['GENERATE_ASSET', 'WRITE_SANDBOX', 'RUN_VALIDATION'],
    forbiddenOperations: ['MERGE', 'DEPLOY', 'VOICE_EXECUTE', 'LEASE_SEIZE'],
    requiredAgents: ['mesh-agent', 'validation-agent'],
    performanceBudget: { maxTriangles: 5000, maxTextureMb: 8 },
    comfortBudget: { flashingForbidden: true, maxAngularMotionDegPerSec: 0 },
    licenceAndProvenanceRequirements: 'Original generated content only; retain source and influence references.',
    previewRequirement: 'REQUIRED',
    verificationContract: 'spatial-world-foundry-primitive-preview-v1',
    approvalRequirement: 'POLICY_GATED',
    rollbackTarget: { scope: 'REGION', targetId: 'landing-bay', snapshotId: null },
    status: 'DRAFT',
    createdAtUtc: CREATED_AT,
    ...overrides,
  };
}

function asset(overrides = {}) {
  return {
    schemaVersion: SPATIAL_ASSET_RECORD_SCHEMA_VERSION,
    assetId: 'asset.crate-001',
    assetType: 'mesh',
    version: 'v1',
    contentHash: HASH_A,
    sourceLocation: 'assets/manifests/crate-001.json',
    largeAssetLocation: `cas://sha256/${'a'.repeat(64)}`,
    creatorAgentId: 'mesh-agent',
    creatingBuildOrderId: 'sbo.idea-planet-001.crate-001',
    planetId: 'idea-planet-001',
    regionId: 'landing-bay',
    parentVersion: null,
    sourceAndInfluenceRefs: ['vr-research/spatial-foundry/primitive-assets'],
    licenceAndRightsState: 'GENERATED_WITH_PROVENANCE',
    dependencies: [],
    dependents: [],
    engineOrRuntimeCompatibility: ['engine-neutral-gltf-candidate'],
    performanceClass: 'quest3-light',
    validationState: 'schema-valid',
    integrationState: 'DRAFT',
    liveState: 'NOT_LIVE',
    rollbackRefs: ['snapshot:world-pre-crate-001'],
    createdAtUtc: CREATED_AT,
    ...overrides,
  };
}

function provenance(overrides = {}) {
  return {
    schemaVersion: SPATIAL_PROVENANCE_SCHEMA_VERSION,
    provenanceId: 'prov.asset.crate-001.v1',
    assetId: 'asset.crate-001',
    assetVersion: 'v1',
    buildOrderId: 'sbo.idea-planet-001.crate-001',
    creatorAgentId: 'mesh-agent',
    operatorIntentRef: 'shared-workspace/intents/intent.idea-planet-001',
    designGenomeVersion: 'planet-genome.v1',
    researchRefs: ['vr-research/spatial-foundry/primitive-assets'],
    sourceAndInfluenceRefs: ['design-principle:compact-industrial-storage'],
    licenceAndRightsState: 'GENERATED_WITH_PROVENANCE',
    evidenceRefs: ['evidence/receipts/spatial-crate-001-generation'],
    createdAtUtc: CREATED_AT,
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    schemaVersion: SPATIAL_WORLD_SNAPSHOT_SCHEMA_VERSION,
    snapshotId: 'snapshot.idea-planet-001.crate-001-candidate',
    planetId: 'idea-planet-001',
    scope: 'REGION',
    scopeId: 'landing-bay',
    worldStateVersion: 'world.v1',
    sourceHead: SOURCE_HEAD,
    worldManifestHash: HASH_B,
    assetVersions: [
      { assetId: 'asset.crate-001', version: 'v1', contentHash: HASH_A },
    ],
    runtimeCompatibility: ['webxr-candidate', 'quest3-budget-unproven'],
    knownGood: false,
    rollbackParentSnapshotId: 'world-pre-crate-001',
    proofRefs: ['evidence/receipts/spatial-crate-001-snapshot'],
    createdAtUtc: CREATED_AT,
    ...overrides,
  };
}

function bundle(overrides = {}) {
  return {
    buildOrder: buildOrder(),
    asset: asset(),
    provenance: provenance(),
    snapshot: snapshot(),
    ...overrides,
  };
}

test('M1 contracts accept one bounded candidate asset lineage', () => {
  assert.deepEqual(validateSpatialBuildOrder(buildOrder()), {
    valid: true,
    errors: [],
    refusalReason: '',
  });
  assert.equal(validateSpatialAssetRecord(asset()).valid, true);
  assert.equal(validateSpatialProvenanceRecord(provenance()).valid, true);
  assert.equal(validateSpatialWorldSnapshot(snapshot()).valid, true);
  assert.equal(validateSpatialWorldFoundryBundle(bundle()).valid, true);
});

test('allowedOperations is an explicit safe allowlist rather than a bypass blacklist', () => {
  for (const unsafe of ['VOICE_EXECUTE', 'MERGE', 'DEPLOY', 'APPROVE', 'LEASE_SEIZE', 'RUNTIME_MUTATE', 'SHELL_EXECUTE', 'RUN_ARBITRARY_COMMAND']) {
    const verdict = validateSpatialBuildOrder(buildOrder({ allowedOperations: ['GENERATE_ASSET', unsafe] }));
    assert.equal(verdict.valid, false, `${unsafe} must fail closed`);
    assert.ok(verdict.errors.includes('allowedOperations-contains-unknown-operation'));
  }
  assert.equal(validateSpatialBuildOrder(buildOrder()).valid, true);
});

test('build orders enforce typed resource-scope grammar and exact order bindings', () => {
  for (const invalidScope of [
    'C:\\worlds\\idea-planet-001',
    'region:landing-bay',
    'region:idea-planet-001/landing-bay/extra',
    'planet:idea-planet-001/landing-bay',
    'object:idea-planet-001/crate-001',
  ]) {
    const verdict = validateSpatialBuildOrder(buildOrder({ ownedResourceScopes: [invalidScope] }));
    assert.equal(verdict.valid, false, `${invalidScope} must fail closed`);
    assert.ok(verdict.errors.includes('ownedResourceScopes-contains-invalid-resource-scope'));
  }

  const valid = validateSpatialBuildOrder(buildOrder({
    ownedResourceScopes: [
      'planet:idea-planet-001',
      'region:idea-planet-001/landing-bay',
      'object:crate-001',
    ],
  }));
  assert.equal(valid.valid, true, valid.errors.join(', '));

  const mismatches = [
    ['planet:other-planet', 'ownedResourceScopes-planet-mismatch'],
    ['region:other-planet/landing-bay', 'ownedResourceScopes-region-mismatch'],
    ['region:idea-planet-001/other-region', 'ownedResourceScopes-region-mismatch'],
    ['object:unrelated-object', 'ownedResourceScopes-object-mismatch'],
    ['asset:asset.crate-001', 'ownedResourceScopes-unbound-scope-type:asset'],
    ['world-system:lighting-001', 'ownedResourceScopes-unbound-scope-type:world-system'],
  ];
  for (const [scope, expectedError] of mismatches) {
    const verdict = validateSpatialBuildOrder(buildOrder({ ownedResourceScopes: [scope] }));
    assert.equal(verdict.valid, false, scope);
    assert.ok(verdict.errors.includes(expectedError), `${scope}: ${verdict.errors.join(', ')}`);
  }
});

test('contract records fail closed on undeclared fields', () => {
  const candidate = buildOrder();
  candidate.rawVoiceCommand = 'run this now';
  const verdict = validateSpatialBuildOrder(candidate);
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('unknown-field:rawVoiceCommand'));
});

test('large binaries require governed schemes and repository source locations reject traversal', () => {
  for (const badLargeAsset of [
    'C:\\Users\\Stephan\\Downloads\\crate.glb',
    'assets/crate.glb',
    'assets/../../outside.glb',
    'object://bucket/../outside.glb',
  ]) {
    const verdict = validateSpatialAssetRecord(asset({ largeAssetLocation: badLargeAsset }));
    assert.equal(verdict.valid, false, `${badLargeAsset} must fail closed`);
    assert.ok(verdict.errors.includes('largeAssetLocation-invalid'));
  }
  const sourceTraversal = validateSpatialAssetRecord(asset({ sourceLocation: 'assets/../../outside.json' }));
  assert.equal(sourceTraversal.valid, false);
  assert.ok(sourceTraversal.errors.includes('sourceLocation-invalid'));
  assert.equal(validateSpatialAssetRecord(asset({ largeAssetLocation: `lfs://objects/${'a'.repeat(64)}` })).valid, true);
  assert.equal(validateSpatialAssetRecord(asset({ largeAssetLocation: 'object://world-assets/crate-001.glb' })).valid, true);
});

test('world snapshots are exact-source and asset-identity bound', () => {
  assert.equal(validateSpatialWorldSnapshot(snapshot({ sourceHead: 'not-a-head' })).valid, false);
  const duplicate = snapshot({
    assetVersions: [
      { assetId: 'asset.crate-001', version: 'v1', contentHash: HASH_A },
      { assetId: 'asset.crate-001', version: 'v2', contentHash: HASH_B },
    ],
  });
  const duplicateVerdict = validateSpatialWorldSnapshot(duplicate);
  assert.equal(duplicateVerdict.valid, false);
  assert.ok(duplicateVerdict.errors.includes('assetVersions-duplicate-asset'));
});

test('bundle validation catches core cross-record lineage substitution', () => {
  const cases = [
    [bundle({ asset: asset({ creatingBuildOrderId: 'sbo.other-build-order' }) }), 'lineage-build-order-mismatch'],
    [bundle({ provenance: provenance({ creatorAgentId: 'unrelated-agent' }) }), 'lineage-provenance-creator-mismatch'],
    [bundle({ asset: asset({ regionId: 'other-region' }) }), 'lineage-region-mismatch'],
    [bundle({ snapshot: snapshot({ scopeId: 'other-region' }) }), 'lineage-snapshot-region-mismatch'],
    [bundle({ provenance: provenance({ operatorIntentRef: 'shared-workspace/intents/other-intent' }) }), 'lineage-provenance-intent-mismatch'],
    [bundle({ provenance: provenance({ designGenomeVersion: 'planet-genome.v2' }) }), 'lineage-provenance-design-genome-mismatch'],
  ];
  for (const [candidate, expectedError] of cases) {
    const verdict = validateSpatialWorldFoundryBundle(candidate);
    assert.equal(verdict.valid, false, expectedError);
    assert.ok(verdict.errors.includes(expectedError), verdict.errors.join(', '));
  }
});

test('every supported snapshot scope is bound to the corresponding bundle identity', () => {
  const validScopes = [
    ['ASSET', 'asset.crate-001'],
    ['OBJECT', 'crate-001'],
    ['FEATURE', 'crate-001'],
    ['REGION', 'landing-bay'],
    ['PLANET', 'idea-planet-001'],
    ['WORLD_STATE', 'world.v1'],
  ];
  for (const [scope, scopeId] of validScopes) {
    const verdict = validateSpatialWorldFoundryBundle(bundle({ snapshot: snapshot({ scope, scopeId }) }));
    assert.equal(verdict.valid, true, `${scope}: ${verdict.errors.join(', ')}`);
  }

  const invalidScopes = [
    ['ASSET', 'asset.other', 'lineage-snapshot-asset-scope-mismatch'],
    ['OBJECT', 'other-object', 'lineage-snapshot-object-scope-mismatch'],
    ['FEATURE', 'other-feature', 'lineage-snapshot-object-scope-mismatch'],
    ['REGION', 'other-region', 'lineage-snapshot-region-mismatch'],
    ['PLANET', 'other-planet', 'lineage-snapshot-planet-scope-mismatch'],
    ['WORLD_STATE', 'world.v2', 'lineage-snapshot-world-state-scope-mismatch'],
  ];
  for (const [scope, scopeId, expectedError] of invalidScopes) {
    const verdict = validateSpatialWorldFoundryBundle(bundle({ snapshot: snapshot({ scope, scopeId }) }));
    assert.equal(verdict.valid, false, scope);
    assert.ok(verdict.errors.includes(expectedError), `${scope}: ${verdict.errors.join(', ')}`);
  }
});

test('accessor-backed records fail closed without invoking getters', () => {
  let calls = 0;
  const hostile = buildOrder();
  Object.defineProperty(hostile, 'allowedOperations', {
    enumerable: true,
    get() {
      calls += 1;
      return calls === 1 ? ['GENERATE_ASSET'] : ['MERGE'];
    },
  });
  let verdict;
  assert.doesNotThrow(() => { verdict = validateSpatialBuildOrder(hostile); });
  assert.equal(calls, 0);
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('buildOrder-must-be-data-only'));

  const hostileAsset = asset();
  Object.defineProperty(hostileAsset, 'creatorAgentId', {
    enumerable: true,
    get() {
      calls += 1;
      throw new Error('creator getter must not run');
    },
  });
  let bundleVerdict;
  assert.doesNotThrow(() => {
    bundleVerdict = validateSpatialWorldFoundryBundle(bundle({ asset: hostileAsset }));
  });
  assert.equal(calls, 0);
  assert.equal(bundleVerdict.valid, false);
  assert.ok(bundleVerdict.errors.includes('bundle-must-be-data-only'));
});

test('custom prototypes, symbol keys, cycles and sparse arrays fail closed', () => {
  const inherited = Object.assign(Object.create({ mergeAllowed: true }), buildOrder());
  assert.equal(validateSpatialBuildOrder(inherited).valid, false);

  const symbolRecord = asset();
  symbolRecord[Symbol('hidden')] = 'MERGE';
  assert.equal(validateSpatialAssetRecord(symbolRecord).valid, false);

  const cycle = buildOrder();
  cycle.performanceBudget.loop = cycle;
  assert.equal(validateSpatialBuildOrder(cycle).valid, false);

  const sparse = buildOrder();
  sparse.objectIds = new Array(1);
  assert.equal(validateSpatialBuildOrder(sparse).valid, false);
});

test('identity and version spellings must already be canonical', () => {
  const candidates = [
    validateSpatialAssetRecord(asset({ assetId: ' asset.crate-001 ' })),
    validateSpatialAssetRecord(asset({ assetId: 'Asset.crate-001' })),
    validateSpatialBuildOrder(buildOrder({ planetId: 'Idea-Planet-001' })),
    validateSpatialBuildOrder(buildOrder({ regionId: ' landing-bay ' })),
    validateSpatialProvenanceRecord(provenance({ assetVersion: 'V1' })),
    validateSpatialWorldSnapshot(snapshot({ scope: 'region' })),
  ];
  assert.equal(candidates.every((verdict) => verdict.valid === false), true);
});

test('raw voice remains context only and cannot grant mutation authority', () => {
  const order = buildOrder({
    operatorRequest: 'Voice transcript: create a crate preview, but do not execute or publish anything.',
    allowedOperations: ['GENERATE_ASSET', 'WRITE_SANDBOX', 'RUN_VALIDATION'],
  });
  assert.equal(validateSpatialBuildOrder(order).valid, true);
  const widened = validateSpatialBuildOrder(buildOrder({ allowedOperations: ['VOICE_EXECUTE'] }));
  assert.equal(widened.valid, false);
});
