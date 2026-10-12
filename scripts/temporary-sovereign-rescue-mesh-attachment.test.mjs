import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectRecoveryMeshTemporaryRescueChildV1 as project } from
  './battle-bridge-recovery-mesh.mjs';

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
const marker = 'TEMPORARY_SOVEREIGN_LEASE_RESCUE_RESULT=';
const child = (value=base)=>({status:0,stdout:marker+JSON.stringify(value)+'\n'});

test('Recovery Mesh allows bounded observed rescue while reserving material pickup proof',()=>{
  const v=project(child());
  assert.equal(v.observed,true);
  assert.equal(v.canonicalLeaseReleaseProven,true);
  assert.equal(v.physicalPickupProven,false);
  assert.equal(v.mode,'CANONICAL_RECOVERY_NEEDS_WORKER_PROOF');
});

test('nonzero, missing, duplicate or oversized child results are never proof',()=>{
  const cases=[
    {status:1,stdout:marker+JSON.stringify(base)},
    {status:0,stdout:'unrelated'},
    {status:0,stdout:marker+'{broken'},
    {status:0,stdout:(marker+JSON.stringify(base)+'\n').repeat(2)},
    {status:0,stdout:'x'.repeat(70_000)},
    {status:0,stdout:marker+JSON.stringify(base),error:new Error('timeout')},
  ];
  for(const value of cases){
    const v=project(value);
    assert.equal(v.observed,false);
    assert.equal(v.canonicalLeaseReleaseProven,false);
    assert.equal(v.physicalPickupProven,false);
  }
});

test('unknown schema, field omissions and widened source authority fail closed',()=>{
  for (const value of [
    {...base,schemaVersion:'other'},
    {...base,publicationOk:false},
    {...base,sourceMutationAllowed:true},
    {...base,leaseSeizureAllowed:true},
    {...base,newWriterAllowed:true},
    {...base,physicalPickupProven:true},
    {...base,mode:'COMPLETE'},
    {...base,sourceMutationAllowed:undefined},
  ]) {
    assert.equal(project(child(value)).observed,false);
  }
});

test('Recovery Mesh triggers fixed 12-second child only after canonical guarded eligibility',async()=>{
  const source=await readFile(new URL('./battle-bridge-recovery-mesh.mjs',import.meta.url),'utf8');
  assert.match(source,/process\.platform === 'win32' && completionGuardianEligible/);
  assert.match(source,/path\.resolve\(\s*paths\.repoRoot, 'scripts', 'temporary-sovereign-lease-rescue\.mjs'\)/);
  assert.match(source,/spawnSync\(process\.execPath, \[fixedRescueScript, '--once'\]/);
  assert.match(source,/timeout: 12_000, maxBuffer: 64 \* 1024/);
  assert.match(source,/temporaryLeaseRescue = projectRecoveryMeshTemporaryRescueChildV1\(child\)/);
  assert.match(source,/const completionGuardianHealthy = completionGuardian\?\.ok === true/);
});
