import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSharedWorkspaceRecord } from './sharedAgentWorkspaceStore.mjs';
import {
  decideSovereignOuterBridgeAttemptV1 as decide,
  projectSovereignOuterBridgeV1 as project,
} from './sovereignOuterBridgeV1.mjs';
import {
  createSovereignOuterBridgeSupervisorV1,
} from '../../scripts/sovereign-outer-bridge-service.mjs';

const HEAD='a'.repeat(40);
const now='2026-10-12T12:59:00.000Z';
const rescue=(x={})=>({
  schemaVersion:'stephanos.temporary-sovereign-lease-rescue.v1',
  publicationOk:true,blocker:'REPAIR_ORIGINAL_TERMINAL_SOURCE_BINDING_UNPROVEN',
  originalLeaseId:'critical-2962-elastic-goal-r7-lease',
  canonicalLeaseReleaseProven:false,...x,
});
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
test('wide span bridges healthy ends but does not invent a middle recovery',()=>{
  const view=project({observedAtUtc:now,sourceHead:HEAD,
    sourceIdentityVerified:true,rescue:rescue()});
  assert.equal(view.stage,'OUTER_BRIDGE_WIDE');
  assert.equal(view.wakeAdapterRequired,false);
  assert.equal(view.elasticAdmissionRequiredForRescue,false);
  assert.equal(view.status,'HELD');
  assert.equal(view.rescueBlocker,'REPAIR_ORIGINAL_TERMINAL_SOURCE_BINDING_UNPROVEN');
  assert.deepEqual(view.remainingGates,[
    'ORIGINAL_EXACT_LEASE_RELEASE','PHYSICAL_WORKER_PICKUP','TWO_UNATTENDED_REFILLS']);
  assert.equal(view.duplicateSchedulerAllowed,false);
  assert.equal(view.sourceMutationAllowed,false);
  assert.equal(view.leaseSeizureAllowed,false);
  assert.equal(view.canonicalHandbackEligible,false);
});

test('narrowing needs exact canonical release, then separately proven pickup and refills',()=>{
  const states=[
    {rescue:rescue({canonicalLeaseReleaseProven:true})},
    {rescue:rescue({canonicalLeaseReleaseProven:true}),workerPickupReceiptProven:true},
    {rescue:rescue({canonicalLeaseReleaseProven:true}),workerPickupReceiptProven:true,unattendedRefillReceiptCount:2},
  ];
  const values=states.map(x=>project({...x,observedAtUtc:now,sourceHead:HEAD,sourceIdentityVerified:true}));
  assert.deepEqual(values.map(x=>x.stage),[
    'OUTER_BRIDGE_NARROWING_LEASE',
    'OUTER_BRIDGE_NARROWING_PICKUP',
    'CANONICAL_REJOIN_READY',
  ]);
  assert.deepEqual(values.map(x=>x.canonicalHandbackEligible),[false,false,true]);
  assert.deepEqual(values.map(x=>x.status),['HELD','HELD','READY']);
  assert.equal(values[2].sourceMutationAllowed,false);
  assert.equal(values[2].independentDispatchAllowed,false);
});

test('invalid source, missing publication and untrusted schema cannot narrow bridge',()=>{
  for(const opts of [
    {sourceHead:'',sourceIdentityVerified:true,rescue:rescue({canonicalLeaseReleaseProven:true})},
    {sourceHead:HEAD,sourceIdentityVerified:false,rescue:rescue({canonicalLeaseReleaseProven:true})},
    {sourceHead:HEAD,sourceIdentityVerified:true,rescue:rescue({publicationOk:false,canonicalLeaseReleaseProven:true})},
    {sourceHead:HEAD,sourceIdentityVerified:true,rescue:rescue({schemaVersion:'untrusted',canonicalLeaseReleaseProven:true})},
    {sourceHead:HEAD,sourceIdentityVerified:true,rescue:null},
  ]){
    const view=project({observedAtUtc:now,...opts,workerPickupReceiptProven:true,unattendedRefillReceiptCount:9});
    assert.equal(view.canonicalHandbackEligible,false);
    assert.equal(view.physicalPickupProven,false);
    assert.equal(view.twoUnattendedRefillsProven,false);
  }
});

test('Core supervision respects interval, active cycle and gaming governor',()=>{
  assert.equal(decide({sourceHead:HEAD,nowMs:100000,nextEligibleAtMs:0}).start,true);
  assert.equal(decide({sourceHead:HEAD,inFlight:true,nowMs:100000}).reason,'RESCUE_CYCLE_ALREADY_IN_FLIGHT');
  assert.equal(decide({sourceHead:HEAD,gamingActive:true,nowMs:100000}).reason,'GAMING_GOVERNOR_PROTECTED');
  assert.equal(decide({sourceHead:HEAD,shutdown:true,nowMs:100000}).reason,'CORE_SHUTTING_DOWN');
  assert.equal(decide({sourceHead:'wrong',nowMs:100000}).reason,'EXACT_SOURCE_HEAD_UNPROVEN');
  assert.equal(decide({sourceHead:HEAD,nowMs:100000,nextEligibleAtMs:120000}).reason,'RESCUE_INTERVAL_COOLDOWN');
});

test('Core cycle starts without awaiting blocked lease and never duplicates it',async()=>{
  let current=new Date(now);
  let releaseFirst;
  const first=new Promise(resolve=>releaseFirst=resolve);
  let calls=0, published=[];
  const supervisor=createSovereignOuterBridgeSupervisorV1({
    root:'/repo',workspaceRoot:'/workspace',
    now:()=>current,
    runRescue:async (a)=>{calls++;assert.equal(a.sourceHead,HEAD);return first;},
    publish:async(...args)=>{published.push(args);return {ok:true};},
  });
  assert.equal(supervisor.tick({sourceHead:HEAD}).start,true);
  assert.equal(supervisor.tick({sourceHead:HEAD}).reason,'RESCUE_CYCLE_ALREADY_IN_FLIGHT');
  await flush();
  assert.equal(calls,1);
  assert.equal(supervisor.snapshot().inFlight,true);
  assert.equal(published.length,1);
  assert.equal(published[0][2].bridge.rescueBlocker,'OUTER_RESCUE_INSPECTION_IN_FLIGHT');
  releaseFirst(rescue());
  await flush();
  assert.equal(supervisor.snapshot().inFlight,false);
  assert.equal(supervisor.snapshot().lastResult.stage,'OUTER_BRIDGE_WIDE');
  assert.equal(supervisor.snapshot().lastResult.publicationOk,true);
  assert.equal(supervisor.tick({sourceHead:HEAD}).reason,'RESCUE_INTERVAL_COOLDOWN');
  assert.equal(published.length,2);
  assert.equal(validateSharedWorkspaceRecord(published[0][2]).valid,true);
  assert.equal(validateSharedWorkspaceRecord(published[1][2]).valid,true);
  assert.deepEqual(published[0][1],['status','sovereign-outer-bridge-current.json']);
  assert.equal(published[0][2].status,'HELD');
  assert.equal(published[0][2].bridge.canonicalHandbackEligible,false);
  current=new Date(current.getTime()+61_000);
  assert.equal(supervisor.tick({sourceHead:HEAD,gamingActive:true}).reason,'GAMING_GOVERNOR_PROTECTED');
  assert.equal(supervisor.tick({sourceHead:HEAD}).start,true);
  await flush();
  assert.equal(calls,2);
});

test('an observer failure is HELD and does not kill Core Daemon supervisor',async()=>{
  const records=[];
  let attempts=0;
  const supervisor=createSovereignOuterBridgeSupervisorV1({
    root:'/repo',workspaceRoot:'/workspace',
    now:()=>new Date(now),
    runRescue:async()=>{attempts++;throw Error('private local stack trace should not appear')},
    publish:async(_root,_path,item)=>{records.push(item);return {ok:true}},
  });
  assert.equal(supervisor.tick({sourceHead:HEAD}).start,true);
  await flush();
  const snapshot=supervisor.snapshot();
  assert.equal(snapshot.inFlight,false);
  assert.equal(snapshot.lastResult.status,'HELD');
  assert.equal(snapshot.lastResult.publicationOk,true);
  assert.equal(snapshot.lastResult.rescueBlocker,'OUTER_RESCUE_EXECUTION_FAILED');
  assert.equal(JSON.stringify(snapshot).includes('private local stack trace'),false);
  assert.equal(records.length,2);
  assert.equal(records[0].bridge.rescueBlocker,'OUTER_RESCUE_INSPECTION_IN_FLIGHT');
  assert.equal(records[1].bridge.rescueBlocker,'OUTER_RESCUE_EXECUTION_FAILED');
  assert.equal(attempts,1);
});

test('failure to publish is not proof of successful recovery or handback',async()=>{
  const supervisor=createSovereignOuterBridgeSupervisorV1({
    root:'/repo',workspaceRoot:'/workspace',
    now:()=>new Date(now),
    runRescue:async()=>rescue({canonicalLeaseReleaseProven:true}),
    publish:async()=>{throw Error('local private path')},
  });
  assert.equal(supervisor.tick({sourceHead:HEAD}).start,true);
  await flush();
  const snapshot=supervisor.snapshot();
  assert.equal(snapshot.lastResult.publicationOk,false);
  assert.equal(snapshot.lastResult.status,'HELD');
  assert.equal(snapshot.lastResult.canonicalHandbackEligible,false);
  assert.equal(snapshot.lastResult.canonicalLeaseReleaseProven,true);
  assert.equal(snapshot.lastResult.physicalPickupProven,false);
  assert.equal(snapshot.lastResult.finalVerdict,'SOVEREIGN_OUTER_BRIDGE_PUBLICATION_FAILED');
});
