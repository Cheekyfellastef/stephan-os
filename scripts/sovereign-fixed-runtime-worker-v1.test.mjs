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
import {readExecutionReceiptHistory} from '../shared/agents/executionReceiptV1.mjs';
const source=fs.readFileSync(new URL('./mission-orchestrator-worker.mjs',import.meta.url),'utf8');
const body=source.slice(source.indexOf('function fixedSourceGrantClass('),source.indexOf('export async function runMissionWorkerTick('));
const hash=b=>createHash('sha256').update(b).digest('hex');
const proof=(requirement,id)=>({receiptId:id,requirement,source:'test',evidenceType:'command-output',verified:true,exitCode:0});
const text=(v,f='')=>v===null||v===undefined?f:String(v).trim()||f;
function run(exe,args,options={}){const env={...process.env,...options.env};delete env.NODE_TEST_CONTEXT;return spawnSync(exe==='git.exe'?'git':exe==='node.exe'?process.execPath:exe,args,{cwd:options.cwd,env,shell:false,encoding:options.encoding===null?null:'utf8',timeout:10000,windowsHide:true});}
for(const mode of ['success','missing-proposal','cancelled','transport-cancel-success','transport-cancel-clean-failure','transport-unproven-clean-failure','transport-unproven-success','transport-mismatch-clean-failure','transport-mismatch-success','transport-missing-clean-failure','transport-missing-success','changed-claim','wrong-payload','forged-zero','clean-failed','partial-proposal','cancel-after-result','prior-receipt','prelaunch-exclusion','publication-failed','contradictory-clean','unknown-proposal',
 'abort-terminal-evidence','abort-clean-failure-evidence','abort-escrow','abort-collector','abort-clean-failure-collector','abort-final-receipt','abort-clean-failure-receipt','abort-caller-assert','abort-queue-commit','abort-after-queue-commit','abort-clean-failure-queue-commit'])test('native source parent integration: '+mode,async t=>{
 const invocation=new AbortController();let invocationAborts=0;
 const abortInvocation=()=>{if(!invocation.signal.aborted){invocationAborts++;invocation.abort();}};
 const invocationCase=mode.startsWith('abort-');
 const cleanFailure=mode==='clean-failed'||mode.endsWith('-clean-failure')||mode.startsWith('abort-clean-failure-');
 const transportCancelled=mode.startsWith('transport-cancel-');
 const transportHeld=mode.startsWith('transport-');
 const committedAbort=['abort-queue-commit','abort-after-queue-commit','abort-clean-failure-queue-commit'].includes(mode);
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
 const brands=new WeakSet(),exclusions=new WeakSet();let attempts=0,collections=0,nativeReturned=false,escrowFinalizations=0;
 const inspect=()=>({ok:true,sourceHead:head,profiles:['SOURCE_TASK_V1'],custodyRecordSha256:'b'.repeat(64),nativeRecordId:26});
 const native=async(_q,binding,{onPrepared})=>{
  attempts++;
  if(mode==='prelaunch-exclusion'){const result={ok:false,taskExecuted:false,reason:'FIXTURE_PRELAUNCH_EXCLUDED',stdout:''};exclusions.add(result);return result;}
  const prepared={Profile:'SOURCE_TASK_V1',RequestId:binding.requestId,RuntimeSourceHead:head,FrameSha256:'c'.repeat(64),RootPid:23456,RootCreatedAtUtc:new Date(Date.now()-1000).toISOString()};
  assert.equal(await onPrepared(prepared),true);
  const processingPath=join(queueRoot,'foundry-forge','processing',grant.actionId+'.json');
  let stdout='';
  if(['success','cancel-after-result','clean-failed'].includes(mode)||transportHeld||invocationCase){
   const proposal=await produceProviderNeutralSourceBuildProposalV1({adapter:'foundry-forge',processingPath,item},{...options,actionGrant:grant,runCommand:run,loadGoalContext:async()=>'',localModelFetchImpl:async()=>new Response(JSON.stringify({done:!cleanFailure,message:{content:JSON.stringify({edits:[{path:'shared/agents/example.mjs',old:'value=1',new:'value=2'}],summary:'fixture source'})}})+'\n')});
   assert.equal(proposal.success,!cleanFailure,proposal.error);
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
  // Reproduce the independent native deadline counterexample: clean proposal
  // and physical zero remain authentic while operation completion is UNPROVEN.
  const nativeReason=mode==='transport-unproven-clean-failure'?'DEADLINE':transportCancelled?'FIXED_RUNTIME_OPERATION_CANCELLED':'FIXTURE_STOP';
  const result={ok:!transportCancelled&&(['success','cancel-after-result'].includes(mode)||(invocationCase&&!cleanFailure)),taskExecuted:transportCancelled||['success','cancel-after-result','clean-failed','partial-proposal'].includes(mode)||invocationCase,reason:nativeReason,stdout,nativeReceipt:{Reason:nativeReason,Profile:'SOURCE_TASK_V1',FrameSha256:prepared.FrameSha256,TaskStage:{RootPid:23456}}};
  if(mode!=='forged-zero')brands.add(result);nativeReturned=true;return result;
 };
 const context=vm.createContext({Buffer,process,console,AbortController,setInterval,clearInterval,createHash,randomUUID,resolve,relative,join,homedir,text,
  lstatSync:fs.lstatSync,openSync:fs.openSync,fstatSync:fs.fstatSync,readFileSync:fs.readFileSync,readSync:fs.readSync,closeSync:fs.closeSync,
  FORGE_LIFEBOAT_WORKER_ID,MISSION_CONTROLLER_ROUTE,CODEX_TASK_CLASS,projectMissionControllerTaskV1,projectNarrowedMissionSourceScopeV1,
  ...store,...consumer,createSharedWorkspaceProofRecord,
  writeAtomicJson:async(...args)=>{const result=await writeAtomicJson(...args);if(['abort-terminal-evidence','abort-clean-failure-evidence'].includes(mode)&&args[1][1].endsWith('-terminal.json'))abortInvocation();return result;},
  finalizeSourceArtifactEscrowFromCapturedIdentityV1:async(...args)=>{escrowFinalizations++;const result=await finalizeSourceArtifactEscrowFromCapturedIdentityV1(...args);if(mode==='abort-escrow')abortInvocation();return result;},
  collectAgentWorkerResult:async(...args)=>{collections++;const result=await collectAgentWorkerResult(...args);if(mode==='cancel-after-result')await store.appendMissionEvent(missionId,{eventId:'cancel-after-result',eventType:'MISSION_CANCELLED'},options);if(['abort-collector','abort-clean-failure-collector'].includes(mode))abortInvocation();return result;},
  appendMissionWorkerExecutionReceiptTransition:async(...args)=>{const result=await consumer.appendMissionWorkerExecutionReceiptTransition(...args);if((mode==='abort-final-receipt'&&args[1]==='completed')||(mode==='abort-clean-failure-receipt'&&args[1]==='failed'))abortInvocation();return result;},
  finalizeMissionWorkerQueueClaim:async(...args)=>{const committing=consumer.finalizeMissionWorkerQueueClaim(...args);if(['abort-queue-commit','abort-clean-failure-queue-commit'].includes(mode))abortInvocation();const result=await committing;if(mode==='abort-after-queue-commit')abortInvocation();return result;},
  FIXED_SOURCE_PROPOSAL_MAX_BYTES_V1:4*1024*1024,
  inspectStephanosNativeCapacityGamingAdmissionV1:()=>({ok:true}),inspectFixedRuntimeQualificationV1:inspect,executeFixedSourceTaskRuntimeV1:native,
  consumeFixedRuntimeCompletionV1:value=>{const yes=brands.has(value);brands.delete(value);return yes?Object.freeze({executionCustodyReleased:true,operationDisposition:transportCancelled?'CANCELLED':mode.startsWith('transport-unproven-')?'UNPROVEN':mode.startsWith('transport-missing-')?undefined:mode.startsWith('transport-mismatch-')?(cleanFailure?'SUCCEEDED':'FAILED'):cleanFailure?'FAILED':'SUCCEEDED'}):null;},consumeFixedRuntimePrelaunchExclusionV1:value=>{const yes=exclusions.has(value);exclusions.delete(value);return yes;}});
 vm.runInContext(body+'\nglobalThis.runFixed=processFixedSourceTaskInWorker;',context);
 if(mode==='prior-receipt')await consumer.beginMissionWorkerExecutionReceiptChain({adapter:'foundry-forge',item,processingPath:join(queueRoot,'foundry-forge','processing',grant.actionId+'.json')},{...options,actionGrant:grant});
 const result=await context.runFixed({...options,actionGrant:grant,signal:invocation.signal,awaitActiveClaimHeartbeat:async()=>mode!=='publication-failed',...(mode==='abort-caller-assert'?{assertResultCustody:()=>{if(nativeReturned)abortInvocation();}}:{})});
 const current=await store.readMissionRecord(missionId,options);
 if(invocationCase){
  assert.equal(invocationAborts,1,'The actual external invocation must abort at the selected boundary');
  assert.equal(invocation.signal.aborted,true);
  assert.equal(result.executionCustodyReleased,true,'Native-zero evidence remains independent of invocation cancellation');
  const proofNames=await fs.promises.readdir(join(workspace,'proof'));
  assert.ok(proofNames.some(name=>name.endsWith('-terminal.json')),'Actual terminal evidence must remain preserved');
  assert.notEqual(current.state.currentPhase,'CANCELLED','No mission cancellation event substitutes for the invocation signal');
  if(['abort-terminal-evidence','abort-clean-failure-evidence','abort-caller-assert'].includes(mode))
   assert.equal(escrowFinalizations,0,'Cancellation before commit eligibility cannot start escrow finalization');
  if(committedAbort){
   const terminalDirectory=cleanFailure?'failed':'completed';
   assert.equal(fs.existsSync(join(queueRoot,'foundry-forge',terminalDirectory,grant.actionId+'.json')),true);
   assert.equal(fs.existsSync(join(queueRoot,'foundry-forge',terminalDirectory,grant.actionId+'.result.json')),true);
  }
 }
 if(mode==='success'||(committedAbort&&!cleanFailure)){
  assert.equal(result.success,true,JSON.stringify(result));assert.equal(collections,1);
  assert.equal(fs.existsSync(join(queueRoot,'foundry-forge','processing',grant.actionId+'.json')),false);
  assert.equal(current.state.dispatch.status,'complete');assert.ok(current.state.sourcePublication?.artifactSha256);
 }else if(mode==='clean-failed'||(committedAbort&&cleanFailure)){
  assert.equal(result.success,false,JSON.stringify(result));assert.equal(collections,1);
  assert.equal(current.state.dispatch.status,'failed');assert.equal(current.state.currentPhase,'BLOCKED');
  assert.equal(fs.existsSync(join(queueRoot,'foundry-forge','processing',grant.actionId+'.json')),false);
 }else{
  const collected=['cancel-after-result','abort-collector','abort-clean-failure-collector','abort-final-receipt','abort-clean-failure-receipt'].includes(mode);
  assert.equal(result.success,false,JSON.stringify(result));assert.equal(collections,collected?1:0);
  assert.equal(fs.existsSync(join(queueRoot,'foundry-forge','processing',grant.actionId+'.json')),true,mode);
  assert.equal(attempts,['wrong-payload','prior-receipt','publication-failed'].includes(mode)?0:1);
  assert.equal(current.state.dispatch.resultId,collected?grant.actionId:'');
  if(invocationCase)assert.equal(result.reason,'NATIVE_SOURCE_INVOCATION_CANCELLED');
  if(['cancelled','cancel-after-result'].includes(mode))assert.equal(current.state.currentPhase,'CANCELLED');
 }
 if(transportHeld){
  assert.equal(invocation.signal.aborted,false,'Native transport cancelled without caller signal');
  assert.equal(result.reason,'NATIVE_SOURCE_OPERATION_COMPLETION_INELIGIBLE');
  assert.equal(result.executionCustodyReleased,true,'Preserve separately authenticated physical native zero');
  assert.equal(collections,0,'Cancelled transport cannot collect even a clean failure');
  assert.equal(current.state.dispatch.resultId,'','Original claim stays owned');
  const retained=await fs.promises.readdir(join(queueRoot,'foundry-forge','processing'));
  assert.ok(retained.some(name=>name.endsWith('.proposal')),'Original source proposal remains retained');
  const proofNames=await fs.promises.readdir(join(workspace,'proof'));
  assert.ok(proofNames.some(name=>name.endsWith('-terminal.json')),'Authentic terminal evidence remains retained');
  const history=await readExecutionReceiptHistory(workspace,{executionId:grant.actionId},{repoRoot});
  assert.equal(history.ok,true);
  assert.equal(history.latestReceipt?.state,'progress','No completed/failed terminal receipt after native transport cancellation');
 }
 if(invocationCase){
  const history=await readExecutionReceiptHistory(workspace,{executionId:grant.actionId},{repoRoot});
  assert.equal(history.ok,true);
  const terminal=['completed','failed'].includes(history.latestReceipt?.state);
  assert.equal(terminal,committedAbort||['abort-final-receipt','abort-clean-failure-receipt'].includes(mode),'Retain any real receipt already committed; never invent or roll it back');
  if(['abort-collector','abort-final-receipt'].includes(mode))assert.ok(current.state.sourcePublication?.artifactSha256,'Retain already-collected source identity');
 }
});
