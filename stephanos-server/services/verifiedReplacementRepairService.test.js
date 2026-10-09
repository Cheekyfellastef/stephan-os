import test from 'node:test';
import assert from 'node:assert/strict';
import {submitVerifiedReplacementRepair} from './verifiedReplacementRepairService.js';
const head='a'.repeat(40);
const blocker='PROVIDER_NEUTRAL_PATCH_CHECK_FAILED:bad patch';
const mission={missionId:'critical-1717-elastic-goal',revision:9,currentPhase:'BLOCKED',continuity:{parkingStatus:'PARKED_BLOCKED'},blockers:[blocker]};
const proofs=['SOURCE_MERGED','LOCAL_ROUTE_HTTP_200','DESKTOP_FALLBACK_BROWSER_PROVEN'].map(requirement=>({requirement,sourceHead:head,authority:'CANONICAL_INDEPENDENT_VERIFIER',verified:true,sourceMutationAllowed:false,mergeAuthority:false}));
const acceptance={proofs,reconciliation:{completionAllowed:false}};
test('writes exact revision-bound repair only after verified evidence',async()=>{
 let called=null;
 const r=await submitVerifiedReplacementRepair({sourceHead:head,nowUtc:'2026-10-08T13:00:00Z',
 collectAcceptance:async()=>acceptance,verifyCurrentHead:async()=>true,
 readMission:async()=>({state:mission}),appendEvent:async(id,e)=>{called=e;return {state:{...mission,revision:10,continuity:{parkingStatus:'REENTRY_READY'}}};}});
 assert.equal(r.eventWritten,true);assert.equal(r.reentered,false);assert.equal(r.completed,false);
 assert.equal(called.eventType,'MISSION_REPAIR_PROVEN');assert.equal(called.expectedRevision,9);
 assert.deepEqual(called.resolvedBlockers,[blocker]);
});
test('missing browser evidence never writes',async()=>{
 let called=false;const r=await submitVerifiedReplacementRepair({sourceHead:head,
 collectAcceptance:async()=>({...acceptance,proofs:proofs.slice(0,2)}),verifyCurrentHead:async()=>true,
 readMission:async()=>({state:mission}),appendEvent:async()=>{called=true}});
 assert.equal(called,false);assert.equal(r.eventWritten,false);
});
test('head drift and revision conflicts fail closed',async()=>{
 const r=await submitVerifiedReplacementRepair({sourceHead:head,collectAcceptance:async()=>acceptance,
 verifyCurrentHead:async()=>false,readMission:async()=>({state:mission})});
 assert.equal(r.classification,'REPAIR_EXACT_HEAD_MOVED');
 const s=await submitVerifiedReplacementRepair({sourceHead:head,collectAcceptance:async()=>acceptance,
 verifyCurrentHead:async()=>true,readMission:async()=>({state:mission}),
 appendEvent:async()=>({preconditionFailed:true})});
 assert.equal(s.classification,'REPAIR_MISSION_REVISION_MOVED');assert.equal(s.eventWritten,false);
});
