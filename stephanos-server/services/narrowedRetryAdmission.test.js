import test from 'node:test';
import assert from 'node:assert/strict';
import {createMissionOrchestratorState, applyMissionOrchestratorEvent} from '../../shared/agents/missionOrchestrator.mjs';
import {retrySafelyBlockedAgentFailure} from './criticalBacklogConveyorService.js';

test('narrowed retry binds the same authenticated plan and head across custody reads', async t => {
 for (const mode of ['valid', 'owner-moved', 'scope-moved', 'tests-moved', 'head-moved', 'worktree-head-moved',
   'ownership-held', 'cas-moved', 'completed-artifact', 'exhausted']) await t.test(mode, async () => {
  const head = 'a'.repeat(40);
  const oracle = 'node --test scripts/independent.test.mjs';
  const proof = receiptId => ({receiptId, requirement:'proof',source:'offline-test',evidenceType:'command-output',verified:true,exitCode:0});
  let state = createMissionOrchestratorState({missionId:'critical-1721-elastic-goal',title:'Existing intake task',
    operatorIntent:'Repair functional intake',intendedOutcome:'Verified behavior',missionKind:'implementation',
    repository:'Cheekyfellastef/stephan-os',branch:'openclaw/elastic-goal-1721',worktreePath:'C:/offline/worker',
    allowedFiles:['**'],requiredEvidence:['independent test'],requiredTests:['npm run stephanos:verify']});
  for (const event of [
    {eventType:'WORKTREE_READY',worktreePath:state.git.worktreePath,clean:true,receipt:proof('worktree')},
    {eventType:'AGENT_DISPATCHED',agentId:'foundry-forge'},
    {eventType:'AGENT_RESULT_RECEIVED',success:false,resultId:'retained-original-action',error:'SOURCE_ARTIFACT_DIFF_CHECK_FAILED'},
    {eventType:'MISSION_PARKED_FOR_REPAIR',reason:'Original failure',repairOwner:'#2961',receipt:proof('park')},
  ]) state = applyMissionOrchestratorEvent(state,event);
  if (mode === 'completed-artifact') state.dispatch.status = 'complete';
  if (mode === 'exhausted') state.repair.currentRound = state.repair.maximumRounds;
  const original = structuredClone(state);
  const record = {schemaVersion:'shared-agent-workspace-record.v1',kind:'stephanos.shared_workspace.goal',
    goalId:'goal-1721',issueNumber:1721,repository:state.repository,source:'github-goal-estate-mirror',
    mirrorSchema:'stephanos.github-goal-mirror.v1',githubAdmissionState:'ADMISSION_PROVEN',
    mirrorIssueNumber:1721,mirrorRepository:state.repository,mirrorBuildPickupAllowed:true,
    requiredTests:[...state.requiredTests,oracle],
    resourceIds:['repo:cheekyfellastef/stephan-os:path:stephanos-server/services/example.js']};
  let reads = 0, writes = 0, custody = 0;
  const result = await retrySafelyBlockedAgentFailure({backlog:[],env:{},
    paths:{repoRoot:'C:/offline/repository',workspaceRoot:'C:/offline/workspace',orchestratorRoot:'C:/offline/orchestrator',snapshotRoot:'C:/offline/snapshots'},
    listMissions:async()=>[structuredClone(state)],
    readProgrammeProjection:async()=>{
      reads++;
      const current = structuredClone(record);
      if (reads > 1) {
        if (mode === 'owner-moved') current.source = 'untrusted';
        if (mode === 'scope-moved') current.resourceIds = ['repo:cheekyfellastef/stephan-os:path:shared/other.mjs'];
        if (mode === 'tests-moved') current.requiredTests.push('node --test scripts/extra.test.mjs');
      }
      return {machineryInventory:{sourceHead:reads > 1 && mode === 'head-moved'?'b'.repeat(40):head},goalMirrorEstate:{records:[current]}};
    },
    proveRetryOwnershipReleased:async input=>{custody++;assert.equal(input.actionId,original.dispatch.resultId);return {ok:mode !== 'ownership-held'};},
    refreshRetryWorktree:async()=>({ok:true,clean:true,afterHead:mode === 'worktree-head-moved'?'b'.repeat(40):head}),
    appendEvent:async(_id,event)=>{
      writes++;
      assert.equal(event.expectedRevision,original.revision);
      assert.equal(event.expectedCurrentPhase,'BLOCKED');
      assert.equal(event.retryPlanSourceHead,head);
      if (mode === 'cas-moved') return {preconditionFailed:true};
      state=applyMissionOrchestratorEvent(state,event);
      return {state};
    },
  });
  assert.equal(result.retried,mode === 'valid',JSON.stringify(result));
  assert.equal(writes,['valid','cas-moved'].includes(mode)?1:0);
  if (mode === 'valid') {
    assert.equal(reads,2);
    assert.equal(custody,1);
    assert.deepEqual(state.allowedFiles,['stephanos-server/services/example.js','stephanos-server/services/example.js/**']);
    assert.deepEqual(state.requiredTests,record.requiredTests);
    assert.deepEqual(state.repair.history.at(-1).previousAllowedFiles,['**']);
    assert.equal(state.repair.currentRound,1);
  } else assert.deepEqual(state,original);
 });
});
