import test from 'node:test';
import assert from 'node:assert/strict';
import {planReplacementSourceRecovery} from './replacementSourceRecoveryPilotV1.mjs';
const head='a'.repeat(40);
const mission={missionId:'critical-1717-elastic-goal',revision:9,currentPhase:'BLOCKED',continuity:{parkingStatus:'PARKED_BLOCKED'},blockers:['PROVIDER_NEUTRAL_PATCH_CHECK_FAILED:corrupt patch at line 7']};
const requirements=['SOURCE_MERGED','LOCAL_ROUTE_HTTP_200','DESKTOP_FALLBACK_BROWSER_PROVEN'];
const proof=requirement=>({requirement,sourceHead:head,authority:'CANONICAL_INDEPENDENT_VERIFIER',verified:true,sourceMutationAllowed:false,mergeAuthority:false});
const acceptance={proofs:requirements.map(proof),reconciliation:{completionAllowed:false}};
test('reconciles verified replacement into proposal without writing or completing',()=>{
 const r=planReplacementSourceRecovery({mission,acceptance,sourceHead:head,observedAtUtc:'2026-10-08T12:00:00Z'});
 assert.equal(r.classification,'REPLACEMENT_SOURCE_REPAIR_PROPOSAL_READY');
 assert.equal(r.reentry.eventProposal?.eventType,'MISSION_REPAIR_PROVEN');
 assert.equal(r.reentry.eventProposal?.expectedRevision,9);
 assert.equal(r.missionEventWritten,false);assert.equal(r.completionAllowed,false);
});
test('missing browser proof cannot clear a malformed source blocker',()=>{
 const r=planReplacementSourceRecovery({mission,acceptance:{...acceptance,proofs:requirements.slice(0,2).map(proof)},sourceHead:head,observedAtUtc:'2026-10-08T12:00:00Z'});
 assert.equal(r.reentry.eventProposal,null);
});
test('unrelated mission or extra blocker never inherits #1717 repair',()=>{
 const r=planReplacementSourceRecovery({mission:{...mission,blockers:[...mission.blockers,'OTHER_PROBLEM']},acceptance,sourceHead:head,observedAtUtc:'2026-10-08T12:00:00Z'});
 assert.equal(r.reentry.eventProposal,null);
});
test('stale source and self assertions cannot clear the blocker',()=>{
 const r=planReplacementSourceRecovery({mission,acceptance:{...acceptance,proofs:requirements.map(x=>({...proof(x),sourceHead:'b'.repeat(40)}))},sourceHead:head,observedAtUtc:'2026-10-08T12:00:00Z'});
 assert.equal(r.reentry.eventProposal,null);
});
