import assert from 'node:assert/strict';
import test from 'node:test';
import { CORE_CALIBRATION_PARTICIPANTS, executeCoreParticipantTenQuestionExamV1 } from './coreParticipantCalibrationExecutionV1.mjs';

for(const participantId of CORE_CALIBRATION_PARTICIPANTS){
 test(participantId+' automatically sits an independent ten-question exam',async()=>{
  const seen=[];
  const result=await executeCoreParticipantTenQuestionExamV1({participantId,ask:async(id,q)=>{seen.push([id,q]);return 'bounded answer from '+id;}});
  assert.equal(result.questionCount,10);
  assert.equal(result.answeredCount,10);
  assert.equal(result.gapCount,0);
  assert.equal(seen.length,10);
  assert.ok(seen.every(([id])=>id===participantId));
 });
}
test('one failed participant question becomes repair/replay gap without aborting remaining exam',async()=>{
 let n=0;
 const result=await executeCoreParticipantTenQuestionExamV1({participantId:'openclaw-local',ask:async()=>{n+=1;if(n===3)throw new Error('route unavailable');return 'answer';}});
 assert.equal(result.questionCount,10); assert.equal(result.answeredCount,9); assert.equal(result.gapCount,1); assert.equal(result.requiresRepairReplay,true);
 assert.equal(result.gapObservations[0].requiresExistingGoalSearch,true);
});
