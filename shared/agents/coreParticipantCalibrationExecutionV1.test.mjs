import assert from 'node:assert/strict';
import test from 'node:test';
import { CORE_CALIBRATION_PARTICIPANTS, executeCoreParticipantTenQuestionExamV1, extractOpenClawCalibrationAnswerV1, resolveStephanosCalibrationTimeoutPolicyV1 } from './coreParticipantCalibrationExecutionV1.mjs';

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

test('OpenClaw gateway JSON result payload is extracted for grading',()=>{
 const answer=extractOpenClawCalibrationAnswerV1({result:{payloads:[{text:'LOCAL_GATEWAY_OK'}]}});
 assert.equal(answer,'LOCAL_GATEWAY_OK');
});


test('Qwen 3.5 calibration timeout covers cold start and one warmup retry',()=>{
 const policy=resolveStephanosCalibrationTimeoutPolicyV1({stephanosModel:'qwen3.5:27b'});
 assert.equal(policy.providerTimeoutMs,120000);
 assert.equal(policy.warmupRetryTimeoutMs,150000);
 assert.equal(policy.backendRouteTimeoutMs,270000);
 assert.equal(policy.uiRequestTimeoutMs,271500);
});

test('explicit longer calibration timeout remains authoritative',()=>{
 const policy=resolveStephanosCalibrationTimeoutPolicyV1({stephanosModel:'qwen3.5:27b',timeoutSeconds:180});
 assert.equal(policy.providerTimeoutMs,180000);
 assert.equal(policy.warmupRetryTimeoutMs,210000);
 assert.equal(policy.backendRouteTimeoutMs,390000);
 assert.equal(policy.uiRequestTimeoutMs,391500);
});
