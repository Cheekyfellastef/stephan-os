import {createSharedWorkspaceProofRecord,writeAtomicJson} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
// Parent integration with real temporary mission/queue/receipt/escrow stores.
// Native transport is isolated in a VM; this fixture grants no native authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as fs from 'node:fs';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve,relative,sep,basename} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import * as store from '../stephanos-server/services/missionOrchestratorStore.js';
import * as consumer from '../stephanos-server/services/missionOrchestratorWorkerConsumer.js';
import {collectAgentWorkerResult} from '../stephanos-server/services/missionOrchestratorWorkerService.js';
import {buildMissionWorkerAction} from '../shared/agents/missionOrchestratorWorker.mjs';
import {projectNarrowedMissionSourceScopeV1} from '../shared/agents/missionOrchestrator.mjs';
import {FORGE_LIFEBOAT_WORKER_ID,MISSION_CONTROLLER_ROUTE,projectMissionControllerTaskV1} from '../shared/agents/missionControllerCapacityRouterV1.mjs';
import {CODEX_TASK_CLASS} from '../shared/agents/codexCapacityGovernorV1.mjs';
import {finalizeSourceArtifactEscrowFromCapturedIdentityV1} from '../stephanos-server/services/sourceArtifactEscrowStore.js';
import {produceProviderNeutralSourceBuildProposalV1} from '../stephanos-server/services/providerNeutralSourceBuilderService.js';
const source=fs.readFileSync(new URL('./mission-orchestrator-worker.mjs',import.meta.url),'utf8');
const body=source.slice(source.indexOf('function fixedSourceGrantClass('),source.indexOf('export async function runMissionWorkerTick('));
const hash=b=>createHash('sha256').update(b).digest('hex');
const proof=(requirement,id)=>({receiptId:id,requirement,source:'test',evidenceType:'command-output',verified:true,exitCode:0});
const text=(v,f='')=>v===null||v===undefined?f:String(v).trim()||f;
function run(exe,args,options={}){const env={...process.env,...options.env};delete env.NODE_TEST_CONTEXT;return spawnSync(exe==='git.exe'?'git':exe==='node.exe'?process.execPath:exe,args,{cwd:options.cwd,env,shell:false,encoding:options.encoding===null?null:'utf8',timeout:10000,windowsHide:true});}
for(const mode of ['success','missing-proposal','cancelled','changed-claim','wrong-payload','forged-zero','clean-failed','partial-proposal','cancel-after-result','prior-receipt','prelaunch-exclusion','publication-failed','contradictory-clean','unknown-proposal'])test('native source parent integration: '+mode,async t=>{
 const parent=await mkdtemp(join(tmpdir(),'native-source-parent-'));
 t.after(async()=>{assert.ok(resolve(parent).startsWith(resolve(tmpdir())+sep));assert.ok(basename(parent).startsWith('native-source-parent-'));await rm(parent,{recursive:true,force:true});});
 const repoRoot=join(parent,'repo'),workspace=join(parent,'workspace'),queueRoot=join(parent,'queue');
 await mkdir(join(repoRoot,'shared','agents'),{recursive:true});await mkdir(workspace);
 await writeFile(join(repoRoot,'shared','agents','example.mjs'),'export const value=1;\n');
 await writeFile(join(repoRoot,'focused.test.mjs'),"import assert from 'node:assert/strict';import {value} from './shared/agents/example.mjs';assert.equal(value,2);\n");
 for(const args of [['init','-b','openclaw/native-source-fixture'],['config','user.email','fixture@example.invalid'],['config','user.name','Fixture'],['add','.'],['commit','-m','baseline']]){
  const result=run('git.exe',args,{cwd:repoRoot});assert.equal(result.status,0,result.stderr);
 }
 const head=run('git.exe',['rev-parse','HEAD'],{cwd:repoRoot}).stdout.trim();
 const options={root:join(parent,'state'),snapshotRoot:join(parent,'snapshots'),sharedWorkspaceRoot:workspace,repoRoot,queueRoot};
 const missionId='native-source-fixture';
 await store.createMissionRecord({missionId,missionKind:'implementation',operatorIntent:'Implement bounded source fixture',intendedOutcome:'Pass focused evidence',repository:'Cheekyfellastef/stephan-os',repositoryRoot:repoRoot,worktreePath:repoRoot,branch:'openclaw/native-source-fixture',allowedFiles:['shared/agents/example.mjs'],requiredTests:['node --test focused.test.mjs'],requiredEvidence:['focused test output']},options);
 const ready=await store.appendMissionEvent(missionId,{eventId:'worktree',eventType:'WORKTREE_READY',worktreePath:repoRoot,clean:true,receipt:proof('isolated worktree','worktree')},options);
 const draft={schemaVersion:'stephanos.mission-worker-action-grant.v1',grantId:'fixture-grant',controllerId:'durable-flywheel-controller',sourceRevision:head,missionId,missionRevision:ready.state.revision,currentPhase:ready.state.currentPhase,adapter:'foundry-forge',workerId:FORGE_LIFEBOAT_WORKER_ID,capacityRoute:MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE,capacityReceiptId:'fixture-capacity',capacityProofRefs:['proof/fixture-capacity.json'],repository:'Cheekyfellastef/stephan-os',issueNumber:1557,prNumber:null,branch:ready.state.git.branch,headSha:null,boundedActionCount:1,mergeAuthority:false,leaseSeizureAllowed:false};
 const action=buildMissionWorkerAction(ready.state,{actionGrant:draft});
 const grant={...draft,actionId:action.actionId,actionKind:action.actionKind,operation:action.operation||''};
 const item={schemaVersion:'stephanos.mission-worker-queue-item.v1',adapter:'foundry-forge',missionId,actionId:grant.actionId,createdAt:new Date().toISOString(),actionGrant:grant,payload:action,executionBinding:{schemaVersion:'stephanos.mission-worker-queue-execution-binding.v1',executionId:grant.actionId,leaseKey:missionId+'-r'+grant.missionRevision+'-lease',grantId:grant.grantId,missionId,missionRevision:grant.missionRevision,repository:grant.repository,issueNumber:1557,prNumber:null,branch:grant.branch,headSha:'',sourceRevision:head}};
 if(mode==='wrong-payload')item.payload.allowedFiles=['shared/agents/outside.mjs'];
 const pending=join(queueRoot,'foundry-forge','pending');await mkdir(pending,{recursive:true});
 await writeFile(join(pending,grant.actionId+'.json'),JSON.stringify(item));
 const brands=new WeakSet(),exclusions=new WeakSet();let attempts=0,collections=0;
 const inspect=()=>({ok:true,sourceHead:head,profiles:['SOURCE_TASK_V1'],custodyRecordSha256:'b'.repeat(64),nativeRecordId:26});
 const native=async(_q,binding,{onPrepared})=>{
  attempts++;
  if(mode==='prelaunch-exclusion'){const result={ok:false,taskExecuted:false,reason:'FIXTURE_PRELAUNCH_EXCLUDED',stdout:''};exclusions.add(result);return result;}
  const prepared={Profile:'SOURCE_TASK_V1',RequestId:binding.requestId,RuntimeSourceHead:head,FrameSha256:'c'.repeat(64),RootPid:23456,RootCreatedAtUtc:new Date(Date.now()-1000).toISOString()};
  assert.equal(await onPrepared(prepared),true);
  const processingPath=join(queueRoot,'foundry-forge','processing',grant.actionId+'.json');
  let stdout='';
  if(['success','cancel-after-result','clean-failed'].includes(mode)){
   const proposal=await produceProviderNeutralSourceBuildProposalV1({adapter:'foundry-forge',processingPath,item},{...options,actionGrant:grant,runCommand:run,loadGoalContext:async()=>'',localModelFetchImpl:async()=>new Response(JSON.stringify({done:mode!=='clean-failed',message:{content:JSON.stringify({edits:[{path:'shared/agents/example.mjs',old:'value=1',new:'value=2'}],summary:'fixture source'})}})+'\n')});
   assert.equal(proposal.success,mode!=='clean-failed',proposal.error);
   const content=Buffer.from(JSON.stringify({schemaVersion:'stephanos.fixed-source-task-proposal.v1',requestId:binding.requestId,actionId:grant.actionId,missionId,claimSha256:binding.claimSha256,frameSha256:prepared.FrameSha256,sourceHead:head,rootPid:23456,proposal}));
   const name=grant.actionId+'.json.source-task-'+binding.requestId+'.proposal';
   await writeFile(processingPath+'.source-task-'+binding.requestId+'.proposal',content);
   stdout='SOVEREIGN_RUNTIME_SOURCE_PROPOSAL_V1='+JSON.stringify({schemaVersion:'stephanos.fixed-source-task-proposal-reference.v1',requestId:binding.requestId,claimSha256:binding.claimSha256,proposalName:name,proposalSha256:hash(content),proposalBytes:content.length,success:proposal.success===true});
  } else if(['partial-proposal','contradictory-clean','unknown-proposal'].includes(mode)){
   await writeFile(join(repoRoot,'shared','agents','example.mjs'),'export const value=2;\n');
   const proposal={schemaVersion:'stephanos.provider-neutral-source-build-proposal.v1',actionId:grant.actionId,missionId,adapter:'foundry-forge',success:false,sourceState:mode==='contradictory-clean'?'UNCHANGED_OBSERVED':mode==='unknown-proposal'?'UNKNOWN':'PARTIAL_SOURCE_PRESERVED',sourceInspection:{known:true},partialSourcePossible:mode!=='contradictory-clean',changedFiles:['shared/agents/example.mjs']};
   const content=Buffer.from(JSON.stringify({schemaVersion:'stephanos.fixed-source-task-proposal.v1',requestId:binding.requestId,actionId:grant.actionId,missionId,claimSha256:binding.claimSha256,frameSha256:prepared.FrameSha256,sourceHead:head,rootPid:23456,proposal}));
   await writeFile(processingPath+'.source-task-'+binding.requestId+'.proposal',content);
   stdout='SOVEREIGN_RUNTIME_SOURCE_PROPOSAL_V1='+JSON.stringify({schemaVersion:'stephanos.fixed-source-task-proposal-reference.v1',requestId:binding.requestId,claimSha256:binding.claimSha256,proposalName:grant.actionId+'.json.source-task-'+binding.requestId+'.proposal',proposalSha256:hash(content),proposalBytes:content.length,success:false});
  } else if(mode==='missing-proposal'||mode==='cancelled')await writeFile(join(repoRoot,'shared','agents','example.mjs'),'export const value=2;\n');
  if(mode==='cancelled')await store.appendMissionEvent(missionId,{eventId:'cancel-during-source',eventType:'MISSION_CANCELLED'},options);
  if(mode==='changed-claim')await writeFile(processingPath,JSON.stringify({...item,payload:{...action,operatorIntent:'changed'}}));
  const result={ok:['success','cancel-after-result'].includes(mode),taskExecuted:['success','cancel-after-result','clean-failed','partial-proposal'].includes(mode),reason:'FIXTURE_STOP',stdout,nativeReceipt:{Profile:'SOURCE_TASK_V1',FrameSha256:prepared.FrameSha256,TaskStage:{RootPid:23456}}};
  if(mode!=='forged-zero')brands.add(result);return result;
 };
 const context=vm.createContext({Buffer,process,console,AbortController,setInterval,clearInterval,createHash,randomUUID,resolve,relative,join,homedir,text,
  lstatSync:fs.lstatSync,openSync:fs.openSync,fstatSync:fs.fstatSync,readFileSync:fs.readFileSync,readSync:fs.readSync,closeSync:fs.closeSync,
  FORGE_LIFEBOAT_WORKER_ID,MISSION_CONTROLLER_ROUTE,CODEX_TASK_CLASS,projectMissionControllerTaskV1,projectNarrowedMissionSourceScopeV1,
  ...store,...consumer,createSharedWorkspaceProofRecord,writeAtomicJson,finalizeSourceArtifactEscrowFromCapturedIdentityV1,
  collectAgentWorkerResult:async(...args)=>{collections++;const result=await collectAgentWorkerResult(...args);if(mode==='cancel-after-result')await store.appendMissionEvent(missionId,{eventId:'cancel-after-result',eventType:'MISSION_CANCELLED'},options);return result;},
  FIXED_SOURCE_PROPOSAL_MAX_BYTES_V1:4*1024*1024,
  inspectStephanosNativeCapacityGamingAdmissionV1:()=>({ok:true}),inspectFixedRuntimeQualificationV1:inspect,executeFixedSourceTaskRuntimeV1:native,
  consumeFixedRuntimeTerminalProvenanceV1:value=>{const yes=brands.has(value);brands.delete(value);return yes;},consumeFixedRuntimePrelaunchExclusionV1:value=>{const yes=exclusions.has(value);exclusions.delete(value);return yes;}});
 vm.runInContext(body+'\nglobalThis.runFixed=processFixedSourceTaskInWorker;',context);
 if(mode==='prior-receipt')await consumer.beginMissionWorkerExecutionReceiptChain({adapter:'foundry-forge',item,processingPath:join(queueRoot,'foundry-forge','processing',grant.actionId+'.json')},{...options,actionGrant:grant});
 const result=await context.runFixed({...options,actionGrant:grant,awaitActiveClaimHeartbeat:async()=>mode!=='publication-failed'});
 const current=await store.readMissionRecord(missionId,options);
 if(mode==='success'){
  assert.equal(result.success,true,JSON.stringify(result));assert.equal(collections,1);
  assert.equal(fs.existsSync(join(queueRoot,'foundry-forge','processing',grant.actionId+'.json')),false);
  assert.equal(current.state.dispatch.status,'complete');assert.ok(current.state.sourcePublication?.artifactSha256);
 }else if(mode==='clean-failed'){
  assert.equal(result.success,false,JSON.stringify(result));assert.equal(collections,1);
  assert.equal(current.state.dispatch.status,'failed');assert.equal(current.state.currentPhase,'BLOCKED');
  assert.equal(fs.existsSync(join(queueRoot,'foundry-forge','processing',grant.actionId+'.json')),false);
 }else{
  assert.equal(result.success,false,JSON.stringify(result));assert.equal(collections,mode==='cancel-after-result'?1:0);
  assert.equal(fs.existsSync(join(queueRoot,'foundry-forge','processing',grant.actionId+'.json')),true,mode);
  assert.equal(attempts,['wrong-payload','prior-receipt','publication-failed'].includes(mode)?0:1);
  assert.equal(current.state.dispatch.resultId,mode==='cancel-after-result'?grant.actionId:'');
  if(['cancelled','cancel-after-result'].includes(mode))assert.equal(current.state.currentPhase,'CANCELLED');
 }
});
