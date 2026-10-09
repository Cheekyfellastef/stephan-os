import test from 'node:test';
import assert from 'node:assert/strict';
import { planParkedMissionProofReentry } from './parkedMissionProofReentryPlanV1.mjs';
const head='a'.repeat(40);
const mission={missionId:'critical-1723-elastic-goal',revision:9,currentPhase:'BLOCKED',continuity:{parkingStatus:'PARKED_BLOCKED'},blockers:['PROVIDER_NEUTRAL_STRUCTURED_EDIT_ANCHOR_MISMATCH','INDEPENDENT_SOURCE_PROOF_MISSING']};
const proof=blocker=>({blocker,verified:true,authority:'CANONICAL_INDEPENDENT_VERIFIER',receiptId:'verified-repair-1723',sourceHead:head,observedAtUtc:'2026-10-08T10:00:00Z',missionId:mission.missionId,missionRevision:mission.revision,sourceMutationAllowed:false,mergeAuthority:false});
test('all exact blockers are required before proposing a repair receipt',()=>{
 const r=planParkedMissionProofReentry(mission,{proofs:[proof(mission.blockers[0])]},head);
 assert.equal(r.eventProposal,null);assert.deepEqual(r.unresolvedBlockers,[mission.blockers[1]]);
});
test('complete independent revision-bound proof produces non-executing proposal',()=>{
 const r=planParkedMissionProofReentry(mission,{proofs:mission.blockers.map(proof)},head);
 assert.equal(r.classification,'REPAIR_PROOF_READY_FOR_INDEPENDENT_ADJUDICATION');
 assert.equal(r.eventProposal.eventType,'MISSION_REPAIR_PROVEN');
 assert.equal(r.eventProposal.expectedRevision,9);
 assert.equal(r.missionEventWritten,false);assert.equal(r.automaticReentryAllowed,false);
});
test('stale mission revision and self-assigned authority fail closed',()=>{
 const r=planParkedMissionProofReentry(mission,{proofs:[proof(mission.blockers[0]),{...proof(mission.blockers[1]),missionRevision:8}]},head);
 assert.equal(r.eventProposal,null);
 const s=planParkedMissionProofReentry(mission,{proofs:mission.blockers.map(b=>({...proof(b),authority:'SELF_ASSERTED'}))},head);
 assert.equal(s.provenResolvedBlockers.length,0);
});
test('empty blocker record cannot be converted into repaired mission',()=>{
 const r=planParkedMissionProofReentry({...mission,blockers:[]},{proofs:[]},head);
 assert.equal(r.eventProposal,null);
});
