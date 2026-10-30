import test from 'node:test';
import assert from 'node:assert/strict';
import {triageSovereignGoalRecoveryV1 as triage} from './sovereignGoalRecoveryTriageV1.mjs';
const head='a'.repeat(40);
const basic=()=>({mainHead:head,machineHead:head,observedAtUtc:'2026-10-14T15:20:00.000Z',
  nowUtc:'2026-10-14T15:20:01.000Z',originalCustodyReleased:false,
  islandPhysicalPickupVerified:false,seedRouterEvictionVerified:false,nativeCapacitySignedVerified:false});
test('keeps 4 independent actionable capability gaps and denies authority',()=>{
  const x=triage(basic());assert.equal(x.sourceHeadFresh,true);
  assert.equal(x.capabilityRequests.length,4);
  assert.deepEqual(x.capabilityRequests.map(t=>t.id),['custody','island','seed','native']);
  assert.equal(x.safeReadOnlyRemoteAction,'controller-lane-status');
  for(const key of ['canReleaseLease','canStartWorker','canInstallPrivilegedService','canForcePush','canMergeProtectedMain'])
    assert.equal(x[key],false,key);
});
test('stale, divergent or missing machine proof never licenses execution',()=>{
 for(const d of [{machineHead:'b'.repeat(40)},{machineHead:null},
   {observedAtUtc:'2026-10-14T15:10:00.000Z'},
   {observedAtUtc:'2026-10-14T15:21:00.000Z'}]){
   const x=triage({...basic(),...d});
   assert.equal(x.sourceHeadFresh,false);assert.equal(x.safeReadOnlyRemoteAction,'visibility-snapshot');
   assert.equal(x.canStartWorker,false);
 }
});
test('caller assertion of all true flags does not authenticate protected authority',()=>{
 const x=triage({...basic(),originalCustodyReleased:true,islandPhysicalPickupVerified:true,
 seedRouterEvictionVerified:true,nativeCapacitySignedVerified:true});
 assert.equal(x.capabilityRequests.length,0);
 assert.equal(x.canReleaseLease,false);assert.equal(x.canStartWorker,false);
 assert.equal(x.originalConveyor.state,'CUSTODY_GATE_CLAIMED_UNVERIFIED');
});
test('malformed snapshots fail closed',()=>{
 for(const x of [null,undefined,{},[],{mainHead:123}]){
  const v=triage(x);assert.equal(v.sourceHeadFresh,false);
  assert.equal(v.canReleaseLease,false);assert.equal(v.capabilityRequests.length,4);
 }
});
