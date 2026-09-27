import assert from 'node:assert/strict';
import test from 'node:test';
import { executeVrResearchCalibrationV1, runRecurringCalibrationReadinessV1 } from './recurringCalibrationRunnerV1.mjs';
import { createSharedWorkspaceParticipantStatusRecord, validateSharedWorkspaceRecord } from './sharedAgentWorkspaceStore.mjs';

const NOW='2026-09-27T15:00:00.000Z';
function status(participantId, timestampUtc, status='calibrated') {
  return createSharedWorkspaceParticipantStatusRecord({ participantStatusId:'calibration-'+participantId, participantId, timestampUtc, correlationId:'test-cycle', status, summary:'test calibration status', proofRefs:['proof/test.json'], relatedIssue:'#1308' });
}
const CORE_IDS=['stephanos','openclaw-local','openclaw-standalone'];
function currentCoreStatuses(){return CORE_IDS.map(id=>status(id,'2026-09-26T15:00:00.000Z'));}
const stubCoreExam=async({participantId})=>({participantId,questionCount:10,answeredCount:10,gapCount:0,requiresRepairReplay:false});
test('scheduled runner marks VR Research due after interval and publishes receipt', async () => {
  const published=[];
  const result=await runRecurringCalibrationReadinessV1({
    nowUtc:NOW, trigger:'SCHEDULED', intervalMs:7*24*60*60*1000,
    loadParticipantStatuses:async()=>({records:[status('stephanos-vr-research','2026-09-19T15:00:00.000Z'),...currentCoreStatuses()]}),
    publishRecord:async r=>{published.push(r);return{ok:true};},
  });
  assert.equal(result.ok,true);
  assert.deepEqual(result.readiness.dueParticipantIds,['stephanos-vr-research']);
  assert.equal(result.receipt.vrResearchDue,true);
  assert.equal(published.length,1);
});
test('scheduled runner keeps current VR Research out of due set', async () => {
  const result=await runRecurringCalibrationReadinessV1({
    nowUtc:NOW, trigger:'SCHEDULED',
    loadParticipantStatuses:async()=>({records:[status('stephanos-vr-research','2026-09-26T15:00:00.000Z'),...currentCoreStatuses()]}),
    publishRecord:async()=>({ok:true}), executeCoreParticipantExam:stubCoreExam,
  });
  assert.deepEqual(result.readiness.dueParticipantIds,[]);
  assert.equal(result.receipt.vrResearchDue,false);
});
test('urgent failure recovery makes VR Research immediately due', async () => {
  const result=await runRecurringCalibrationReadinessV1({
    nowUtc:NOW, trigger:'FAILURE_RECOVERY',
    loadParticipantStatuses:async()=>({records:[status('stephanos-vr-research','2026-09-27T14:59:00.000Z'),...currentCoreStatuses()]}),
    publishRecord:async()=>({ok:true}), executeCoreParticipantExam:stubCoreExam,
  });
  assert.deepEqual(result.readiness.dueParticipantIds,['openclaw-local','openclaw-standalone','stephanos','stephanos-vr-research']);
});


test('due VR Research automatically executes all ten grounded canonical questions after projection repair', async () => {
  const result=await runRecurringCalibrationReadinessV1({
    nowUtc:NOW, trigger:'FAILURE_RECOVERY', repoRoot:process.cwd(),
    loadParticipantStatuses:async()=>({records:[status('stephanos-vr-research','2026-09-27T14:59:00.000Z'),...currentCoreStatuses()]}),
    publishRecord:async()=>({ok:true}), executeCoreParticipantExam:stubCoreExam,
  });
  assert.equal(result.vrCalibration.questionCount,10);
  assert.equal(result.vrCalibration.groundedCount + result.vrCalibration.gapCount,10);
  assert.equal(result.vrCalibration.gapCount,0);
  assert.equal(result.vrCalibration.requiresRepairReplay,false);
  assert.deepEqual(result.vrCalibration.existingGoalCandidates,[]);
  assert.equal(result.receipt.vrCalibration.questionCount,10);
});


test('canonical VR Lab loader supplies projection-bound proof authority without caller self-certification', async () => {
  const result=await executeVrResearchCalibrationV1({repoRoot:process.cwd(),nowUtc:NOW});
  assert.equal(result.questionCount,10);
  assert.equal(result.groundedCount,10);
  assert.equal(result.gapCount,0);
  assert.equal(result.requiresRepairReplay,false);
});


test('flywheel automatically launches independent ten-question exams for all due core participants', async () => {
 const records=['stephanos','openclaw-local','openclaw-standalone'].map(id=>status(id,'2026-09-19T15:00:00.000Z'));
 const calls=[];
 const result=await runRecurringCalibrationReadinessV1({nowUtc:NOW,trigger:'SCHEDULED',loadParticipantStatuses:async()=>({records}),publishRecord:async()=>({ok:true}), executeCoreParticipantExam:stubCoreExam,executeCoreParticipantExam:async({participantId})=>{calls.push(participantId);return {participantId,questionCount:10,answeredCount:10,gapCount:0,requiresRepairReplay:false};}});
 assert.deepEqual(calls,['stephanos','openclaw-local','openclaw-standalone']);
 assert.equal(result.coreCalibrations.length,3);
 assert.ok(result.coreCalibrations.every(x=>x.questionCount===10));
 assert.equal(result.receipt.coreCalibrations.length,3);
});

test('live calibration publications use valid Shared Workspace schemas',async()=>{
 const statuses=[]; const events=[];
 const result=await runRecurringCalibrationReadinessV1({
  nowUtc:NOW,
  trigger:'SCHEDULED',
  loadParticipantStatuses:async()=>({records:[status('stephanos-vr-research','2026-09-26T15:00:00.000Z')]}),
  executeCoreParticipantExam:stubCoreExam,
  publishParticipantStatus:async record=>{statuses.push(record);return{ok:true};},
  publishRecord:async record=>{events.push(record);return{ok:true};},
 });
 assert.equal(result.ok,true);
 assert.equal(statuses.length,3);
 assert.ok(statuses.every(record=>validateSharedWorkspaceRecord(record,{nowMs:Date.parse(NOW)}).valid));
 assert.equal(events.length,1);
 assert.equal(validateSharedWorkspaceRecord(events[0],{nowMs:Date.parse(NOW)}).valid,true);
 assert.ok(statuses.every(record=>record.status==='calibrated'));
});
