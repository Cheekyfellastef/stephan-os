import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGoalAcceptanceProof } from './liveGoalAcceptanceProofService.js';
const sourceHead='a'.repeat(40);
const mission=n=>({missionId:'critical-'+n+'-elastic-goal',currentPhase:'BLOCKED'});
test('merge evidence requires independent exact ancestry',async()=>{
 const x=await collectGoalAcceptanceProof({goalNumber:1646,mission:mission(1646),sourceHead,verifyMerge:async()=>false});
 assert.equal(x.proofs.length,0);assert.equal(x.reconciliation.completionAllowed,false);
 const y=await collectGoalAcceptanceProof({goalNumber:1646,mission:mission(1646),sourceHead,verifyMerge:async()=>true});
 assert.deepEqual(y.reconciliation.verified,['SOURCE_MERGED']);
});
test('VR Link acceptance never confuses HTTP response with browser or headset proof',async()=>{
 const x=await collectGoalAcceptanceProof({goalNumber:1717,mission:mission(1717),sourceHead,verifyMerge:async()=>true,checkVrLink:async()=>true});
 assert.deepEqual(x.reconciliation.verified,['SOURCE_MERGED','LOCAL_ROUTE_HTTP_200']);assert.ok(x.reconciliation.missing.includes('HEADSET_SESSION_OR_UNSUPPORTED_PROOF'));
});
test('ten grounded or explicit-gap VR responses prove route contract, not grounded evidence',async()=>{
 const x=await collectGoalAcceptanceProof({goalNumber:1723,mission:mission(1723),sourceHead,verifyMerge:async()=>true,askVrResearch:async()=>({ok:true,participantId:'stephanos-vr-research',answer:{answerVerdict:'GAP_KNOWLEDGE'},gapObservation:{id:'gap'}})});
 assert.deepEqual(x.reconciliation.verified,['SOURCE_MERGED','QA_ROUTE_HTTP_200','TEN_QUESTION_ROUTE_PROVEN']);assert.ok(x.reconciliation.missing.includes('INDEPENDENT_PROOF_BINDING'));assert.equal(x.reconciliation.completionAllowed,false);
});
