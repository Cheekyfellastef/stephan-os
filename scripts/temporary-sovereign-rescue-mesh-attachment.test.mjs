import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  projectRecoveryMeshTemporaryRescueObservationV1 as project,
} from './battle-bridge-recovery-mesh.mjs';

const base = Object.freeze({
  schemaVersion: 'stephanos.temporary-sovereign-lease-rescue.v1',
  publicationOk: true,
  mode: 'CANONICAL_RECOVERY_NEEDS_WORKER_PROOF',
  blocker: 'POST_RELEASE_PHYSICAL_PICKUP_UNPROVEN',
  sourceMutationAllowed: false,
  leaseSeizureAllowed: false,
  newWriterAllowed: false,
  physicalPickupProven: false,
  canonicalLeaseReleaseProven: true,
});

test('Recovery Mesh projects bounded canonical observer state without claiming worker pickup',()=>{
  const value=project(base);
  assert.equal(value.observed,true);
  assert.equal(value.canonicalLeaseReleaseProven,true);
  assert.equal(value.physicalPickupProven,false);
  assert.equal(value.mode,'CANONICAL_RECOVERY_NEEDS_WORKER_PROOF');
});

test('invalid, empty, or widened observer results remain held',()=>{
  for(const result of [
    null,{},undefined,
    {...base, schemaVersion:'wrong'},
    {...base, publicationOk:false},
    {...base, sourceMutationAllowed:true},
    {...base, leaseSeizureAllowed:true},
    {...base, newWriterAllowed:true},
    {...base, physicalPickupProven:true},
    {...base, mode:'COMPLETE'},
    {...base, mode:'EXACT_LEASE_RELEASED'},
  ]){
    const value=project(result);
    assert.equal(value.observed,false);
    assert.equal(value.canonicalLeaseReleaseProven,false);
    assert.equal(value.physicalPickupProven,false);
  }
});

test('safe observation can still report original worker not verified',()=>{
  const value=project({
    ...base,
    mode:'ORIGINAL_OWNER_REPAIR_REQUIRED',
    canonicalLeaseReleaseProven:false,
    blocker:'REPAIR_ORIGINAL_TERMINAL_SOURCE_BINDING_UNPROVEN',
  });
  assert.equal(value.observed,true);
  assert.equal(value.canonicalLeaseReleaseProven,false);
  assert.equal(value.blocker,'REPAIR_ORIGINAL_TERMINAL_SOURCE_BINDING_UNPROVEN');
});

test('Recovery Mesh uses original singleton task and in-process canonical guard, never new child or scheduler',async()=>{
  const source=await readFile(new URL('./battle-bridge-recovery-mesh.mjs',import.meta.url),'utf8');
  assert.match(source,/process\.platform === 'win32' && completionGuardianEligible/);
  assert.match(source,/await runTemporarySovereignRescueObservationV1\(\{/);
  assert.match(source,/sourceHead: syncRepairExpectedHead/);
  assert.match(source,/temporaryLeaseRescue = projectRecoveryMeshTemporaryRescueObservationV1\(observation\)/);
  assert.match(source,/const completionGuardianHealthy = completionGuardian\?\.ok === true/);
  assert.doesNotMatch(source,/spawnSync\(process\.execPath,\s*\[fixedRescueScript/);
  assert.doesNotMatch(source,/projectRecoveryMeshTemporaryRescueChildV1/);
});
