import test from 'node:test';
import assert from 'node:assert/strict';
import {projectModelTransportFailureProofV1 as project, modelTransportFailureProofMatchesV1 as matches} from './modelTransportFailureRetryV1.mjs';
import {createMissionOrchestratorState,applyMissionOrchestratorEvent as apply} from './missionOrchestrator.mjs';

const result={schemaVersion:'stephanos.provider-neutral-source-builder.v1',processed:true,success:false,
 providerInvoked:true,providerCompleted:false,failureStage:'PROVIDER',finalVerdict:'PROVIDER_NEUTRAL_SOURCE_BUILD_BLOCKED',
 missionId:'critical-1721-elastic-goal',actionId:'critical-1721-elastic-goal-r5-test',error:'fetch failed'};
const receipt={executionId:result.actionId,state:'failed',phase:'provider-neutral-result-blocked',blocker:result.error,
 receiptId:result.actionId+'-5',sourceHead:'a'.repeat(40)};
test('transport retry proof requires exact returned provider failure and terminal execution',()=>{
 const proof=project(result,receipt);
 assert.ok(matches(proof,result.missionId,result.actionId,result.error));
 for(const key of Object.keys(result)) assert.equal(project({...result,[key]:null},receipt),null,key);
 for(const key of Object.keys(receipt)) assert.equal(project(result,{...receipt,[key]:null}),null,key);
 for(const error of ['HTTP 401','unknown error','PROVIDER_NEUTRAL_MODEL_TRANSPORT_FAILED:UNKNOWN'])
  assert.equal(project({...result,error},{...receipt,blocker:error}),null);
 for(const key of Object.keys(proof)) assert.equal(matches({...proof,[key]:null},result.missionId,result.actionId,result.error),false,key);
});

test('reducer consumes one existing round only with bound transport proof',()=>{
 const evidence=id=>({receiptId:id,requirement:'test',source:'test',evidenceType:'command-output',verified:true,exitCode:0});
 let state=createMissionOrchestratorState({missionId:result.missionId,title:'Existing task',operatorIntent:'Bounded repair',
  intendedOutcome:'Functional source',missionKind:'implementation',repository:'Cheekyfellastef/stephan-os',branch:'openclaw/elastic-goal-1721',
  allowedFiles:['shared/example.mjs'],requiredTests:['npm run stephanos:verify','node --test scripts/oracle.test.mjs'],requiredEvidence:['test']});
 for(const event of [{eventType:'WORKTREE_READY',clean:true,worktreePath:'C:/test',receipt:evidence('worktree')},
  {eventType:'AGENT_DISPATCHED',agentId:'foundry-forge'},
  {eventType:'AGENT_RESULT_RECEIVED',success:false,resultId:result.actionId,error:result.error},
  {eventType:'MISSION_PARKED_FOR_REPAIR',reason:result.error,repairOwner:'#2961',receipt:evidence('park')}]) state=apply(state,event);
 const event={eventType:'AGENT_FAILURE_RETRY_ADMITTED',retryableBlockers:[result.error],
  retryProviderFailureProof:project(result,receipt),retryPlanSourceHead:'b'.repeat(40),receipt:evidence('retry')};
 const accepted=apply(state,event);
 assert.equal(accepted.repair.currentRound,1,JSON.stringify(accepted.blockers));
 assert.equal(accepted.currentPhase,'AGENT_IMPLEMENTATION');
 assert.deepEqual(accepted.allowedFiles,state.allowedFiles);
 assert.deepEqual(accepted.requiredTests,state.requiredTests);
 assert.equal(accepted.repair.history.at(-1).previousDispatch.resultId,result.actionId);
 for(const invalid of [{...event,retryProviderFailureProof:null},{...event,retryPlanSourceHead:''},
  {...event,retryProviderFailureProof:{...event.retryProviderFailureProof,actionId:'different-action'}}]) {
   const held=apply(state,invalid);assert.equal(held.repair.currentRound,0);assert.equal(held.currentPhase,'BLOCKED');
 }
 const exhausted=apply({...state,repair:{...state.repair,currentRound:3}},event);
 assert.equal(exhausted.repair.currentRound,3);assert.equal(exhausted.currentPhase,'BLOCKED');
});
