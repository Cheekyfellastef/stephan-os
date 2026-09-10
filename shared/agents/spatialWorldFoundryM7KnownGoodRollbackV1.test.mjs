import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPATIAL_M7_STATUS,
  buildSpatialKnownGoodSnapshotV1,
  planSpatialRollbackV1,
} from './spatialWorldFoundryM7KnownGoodRollbackV1.mjs';

const sourceHead = 'a'.repeat(40);
const manifestA = `sha256:${'b'.repeat(64)}`;
const manifestB = `sha256:${'c'.repeat(64)}`;
const assetA = { assetId:'asset.crate-001', version:'v1', contentHash:`sha256:${'d'.repeat(64)}` };
const assetB = { assetId:'asset.lamp-001', version:'v2', contentHash:`sha256:${'e'.repeat(64)}` };

function snapshotInput(overrides = {}) {
  return {
    planetId:'idea-planet-001',
    scope:'REGION',
    scopeId:'landing-bay',
    worldStateVersion:'world.v1',
    sourceHead,
    worldManifestHash:manifestA,
    assetVersions:[assetB,assetA],
    runtimeCompatibility:['quest3-candidate','webxr-candidate'],
    rollbackParentSnapshotId:null,
    proofRefs:['proofs/spatial/m7-known-good'],
    createdAtUtc:'2026-08-20T18:30:00.000Z',
    ...overrides,
  };
}
function knownGood(overrides = {}) {
  const out = buildSpatialKnownGoodSnapshotV1(snapshotInput(overrides));
  assert.equal(out.status, SPATIAL_M7_STATUS.SNAPSHOT_READY, out.reasons?.join(','));
  return out.snapshot;
}
function current(overrides = {}) {
  return {
    ...knownGood({ worldManifestHash:manifestB, proofRefs:['proofs/spatial/m7-current'], createdAtUtc:'2026-08-20T18:31:00.000Z' }),
    snapshotId:'snapshot.current.001',
    knownGood:false,
    ...overrides,
  };
}

test('builds a canonical known-good snapshot accepted by the M1 snapshot contract', () => {
  const out = buildSpatialKnownGoodSnapshotV1(snapshotInput());
  assert.equal(out.status,SPATIAL_M7_STATUS.SNAPSHOT_READY);
  assert.equal(out.snapshot.knownGood,true);
  assert.match(out.snapshot.snapshotId,/^snapshot\.m7\.[0-9a-f]{32}$/);
  assert.deepEqual(out.snapshot.assetVersions.map((entry)=>entry.assetId),['asset.crate-001','asset.lamp-001']);
  assert.equal(out.authority.snapshotWriteAllowed,false);
});

test('known-good snapshot identity is content-addressed and stable across asset ordering', () => {
  const left=buildSpatialKnownGoodSnapshotV1(snapshotInput({assetVersions:[assetA,assetB]}));
  const right=buildSpatialKnownGoodSnapshotV1(snapshotInput({assetVersions:[assetB,assetA]}));
  assert.equal(left.snapshot.snapshotId,right.snapshot.snapshotId);
  assert.equal(left.snapshotDigest,right.snapshotDigest);
});

test('snapshot planner rejects widened or malformed data-only input', () => {
  const widened=snapshotInput(); widened.executeRollback=true;
  assert.equal(buildSpatialKnownGoodSnapshotV1(widened).status,SPATIAL_M7_STATUS.BLOCKED_INVALID_INPUT);
  const sparse=snapshotInput(); sparse.assetVersions=new Array(2); sparse.assetVersions[0]=assetA;
  assert.equal(buildSpatialKnownGoodSnapshotV1(sparse).status,SPATIAL_M7_STATUS.BLOCKED_INVALID_INPUT);
});

test('plans one asset rollback from a known-good snapshot without executing it', () => {
  const target=knownGood();
  const out=planSpatialRollbackV1({currentSnapshot:current(),targetSnapshot:target,scope:'ASSET',targetId:'asset.crate-001',requestedAtUtc:'2026-08-20T18:40:00.000Z'});
  assert.equal(out.status,SPATIAL_M7_STATUS.ROLLBACK_READY);
  assert.deepEqual(out.restoreAssetVersions,[assetA]);
  assert.equal(out.authority.rollbackExecutionAllowed,false);
  assert.equal(out.authority.worldMutationAllowed,false);
});

test('plans a region rollback only from an exact matching region snapshot', () => {
  const target=knownGood();
  const out=planSpatialRollbackV1({currentSnapshot:current(),targetSnapshot:target,scope:'REGION',targetId:'landing-bay',requestedAtUtc:'2026-08-20T18:40:00.000Z'});
  assert.equal(out.status,SPATIAL_M7_STATUS.ROLLBACK_READY);
  assert.equal(out.restoreAssetVersions.length,2);
  const wrong=planSpatialRollbackV1({currentSnapshot:current(),targetSnapshot:target,scope:'REGION',targetId:'other-region',requestedAtUtc:'2026-08-20T18:40:00.000Z'});
  assert.equal(wrong.status,SPATIAL_M7_STATUS.BLOCKED_TARGET_MISMATCH);
});

test('plans a world-state rollback from an exact known-good world-state snapshot', () => {
  const target=knownGood({scope:'WORLD_STATE',scopeId:'world.v1'});
  const out=planSpatialRollbackV1({currentSnapshot:current(),targetSnapshot:target,scope:'WORLD_STATE',targetId:'world.v1',requestedAtUtc:'2026-08-20T18:40:00.000Z'});
  assert.equal(out.status,SPATIAL_M7_STATUS.ROLLBACK_READY);
  assert.equal(out.targetWorldManifestHash,manifestA);
  assert.equal(out.targetSourceHead,sourceHead);
});

test('rollback refuses non-known-good, cross-planet and identical snapshot targets', () => {
  const target=knownGood();
  const notGood={...target,knownGood:false};
  assert.equal(planSpatialRollbackV1({currentSnapshot:current(),targetSnapshot:notGood,scope:'ASSET',targetId:'asset.crate-001',requestedAtUtc:'2026-08-20T18:40:00.000Z'}).status,SPATIAL_M7_STATUS.BLOCKED_NOT_KNOWN_GOOD);
  const other={...target,planetId:'other-planet'};
  assert.equal(planSpatialRollbackV1({currentSnapshot:current(),targetSnapshot:other,scope:'ASSET',targetId:'asset.crate-001',requestedAtUtc:'2026-08-20T18:40:00.000Z'}).status,SPATIAL_M7_STATUS.BLOCKED_TARGET_MISMATCH);
  assert.equal(planSpatialRollbackV1({currentSnapshot:target,targetSnapshot:target,scope:'ASSET',targetId:'asset.crate-001',requestedAtUtc:'2026-08-20T18:40:00.000Z'}).status,SPATIAL_M7_STATUS.BLOCKED_TARGET_MISMATCH);
});

test('all M7 outputs remain plan-only with no merge, deployment, runtime or headset authority', () => {
  const snap=buildSpatialKnownGoodSnapshotV1(snapshotInput());
  const roll=planSpatialRollbackV1({currentSnapshot:current(),targetSnapshot:snap.snapshot,scope:'ASSET',targetId:'asset.crate-001',requestedAtUtc:'2026-08-20T18:40:00.000Z'});
  for (const auth of [snap.authority,roll.authority]) {
    assert.equal(auth.sourceMutationAllowed,false);
    assert.equal(auth.assetMutationAllowed,false);
    assert.equal(auth.registryMutationAllowed,false);
    assert.equal(auth.mergeAllowed,false);
    assert.equal(auth.deploymentAllowed,false);
    assert.equal(auth.runtimeMutationAllowed,false);
    assert.equal(auth.worldMutationAllowed,false);
    assert.equal(auth.headsetActionAllowed,false);
    assert.equal(auth.arbitraryCommandAllowed,false);
  }
});
