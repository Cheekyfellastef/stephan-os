import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileGoalAcceptance} from './goalAcceptanceReconciliationV1.mjs';
test('parked goal cannot be declared complete without evidence',()=>{const r=reconcileGoalAcceptance({goalNumber:1646,mission:{missionId:'critical-1646-elastic-goal',currentPhase:'BLOCKED'},sourceHead:'a'.repeat(40)});assert.equal(r.completionAllowed,false);assert.ok(r.missing.length>0)});

const head='a'.repeat(40);
const mission=(n)=>({missionId:'critical-'+n+'-elastic-goal',currentPhase:'BLOCKED'});
const proof=(requirement, extra={})=>({requirement,receiptId:'receipt-'+requirement.toLowerCase().replaceAll('_','-'),sourceHead:head,observedAtUtc:'2026-10-08T09:30:00Z',verified:true,authority:'CANONICAL_INDEPENDENT_VERIFIER',sourceMutationAllowed:false,mergeAuthority:false,...extra});
for(const goalNumber of [1646,1717,1723]){
 test('goal '+goalNumber+' reports missing evidence without granting completion',()=>{
 const r=reconcileGoalAcceptance({goalNumber,mission:mission(goalNumber),sourceHead:head,proofs:[proof('SOURCE_MERGED')]});
 assert.equal(r.classification,'GOAL_ACCEPTANCE_EVIDENCE_INCOMPLETE');assert.deepEqual(r.verified,['SOURCE_MERGED']);assert.ok(r.missing.length);assert.equal(r.completionAllowed,false);
 });
}
test('stale and self asserted proofs cannot satisfy acceptance',()=>{
 const r=reconcileGoalAcceptance({goalNumber:1723,mission:mission(1723),sourceHead:head,proofs:[proof('QA_ROUTE_HTTP_200',{sourceHead:'b'.repeat(40)}),proof('TEN_QUESTION_ROUTE_PROVEN',{authority:'SELF_ASSERTED'})]});
 assert.equal(r.verified.length,0);
});
test('even complete acceptance requires protected canonical completion',()=>{
 const requirements=['SOURCE_MERGED','DIRECT_METER_OBSERVATION_OR_EXACT_BLOCKER','METER_AWARE_FALLBACK_PROVEN','DASHBOARD_TRUTH_PROVEN'];
 const r=reconcileGoalAcceptance({goalNumber:1646,mission:mission(1646),sourceHead:head,proofs:requirements.map(proof)});
 assert.equal(r.missing.length,0);assert.equal(r.completionAllowed,false);
});
