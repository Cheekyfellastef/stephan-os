import assert from 'node:assert/strict';
import test from 'node:test';
import { executeVrResearchCalibrationV1, runRecurringCalibrationReadinessV1 } from './recurringCalibrationRunnerV1.mjs';
import { createSharedWorkspaceParticipantStatusRecord } from './sharedAgentWorkspaceStore.mjs';

const NOW='2026-09-27T15:00:00.000Z';
function status(participantId, timestampUtc, status='calibrated') {
  return createSharedWorkspaceParticipantStatusRecord({ participantStatusId:'calibration-'+participantId, participantId, timestampUtc, correlationId:'test-cycle', status, summary:'test calibration status', proofRefs:['proof/test.json'], relatedIssue:'#1308' });
}
test('scheduled runner marks VR Research due after interval and publishes receipt', async () => {
  const published=[];
  const result=await runRecurringCalibrationReadinessV1({
    nowUtc:NOW, trigger:'SCHEDULED', intervalMs:7*24*60*60*1000,
    loadParticipantStatuses:async()=>({records:[status('stephanos-vr-research','2026-09-19T15:00:00.000Z'),status('openclaw-local','2026-09-26T15:00:00.000Z')]}),
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
    loadParticipantStatuses:async()=>({records:[status('stephanos-vr-research','2026-09-26T15:00:00.000Z')]}),
    publishRecord:async()=>({ok:true}),
  });
  assert.deepEqual(result.readiness.dueParticipantIds,[]);
  assert.equal(result.receipt.vrResearchDue,false);
});
test('urgent failure recovery makes VR Research immediately due', async () => {
  const result=await runRecurringCalibrationReadinessV1({
    nowUtc:NOW, trigger:'FAILURE_RECOVERY',
    loadParticipantStatuses:async()=>({records:[status('stephanos-vr-research','2026-09-27T14:59:00.000Z')]}),
    publishRecord:async()=>({ok:true}),
  });
  assert.deepEqual(result.readiness.dueParticipantIds,['stephanos-vr-research']);
});


test('due VR Research automatically executes all ten questions and routes gaps to repair replay', async () => {
  const result=await runRecurringCalibrationReadinessV1({
    nowUtc:NOW, trigger:'FAILURE_RECOVERY', repoRoot:process.cwd(),
    loadParticipantStatuses:async()=>({records:[status('stephanos-vr-research','2026-09-27T14:59:00.000Z')]}),
    publishRecord:async()=>({ok:true}),
  });
  assert.equal(result.vrCalibration.questionCount,10);
  assert.equal(result.vrCalibration.groundedCount + result.vrCalibration.gapCount,10);
  assert.equal(result.vrCalibration.requiresRepairReplay,result.vrCalibration.gapCount>0);
  assert.ok(result.vrCalibration.existingGoalCandidates.length>0);
  assert.equal(result.receipt.vrCalibration.questionCount,10);
});


test('canonical VR Lab loader supplies projection-bound proof authority without caller self-certification', async () => {
  const result=await executeVrResearchCalibrationV1({repoRoot:process.cwd(),nowUtc:NOW});
  assert.equal(result.questionCount,10);
  assert.ok(result.groundedCount>0);
  assert.equal(result.groundedCount+result.gapCount,10);
  assert.equal(result.requiresRepairReplay,result.gapCount>0);
});
