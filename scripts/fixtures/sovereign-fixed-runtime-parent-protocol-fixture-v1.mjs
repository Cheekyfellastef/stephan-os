// Isolated VM protocol fixture. No native helper, real claim, or production brand.
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {win32} from 'node:path';
import {makeFixedRuntimeSourceProofFixtureV1} from './sovereign-fixed-runtime-source-proof-fixture-v1.mjs';
import {FIXED_RUNTIME_SOURCE_MEMBER_LIMIT_V1,fixedRuntimeGitClosureSha256V1} from '../sovereign-fixed-runtime-installer-candidate-v1.mjs';
const source=readFileSync(new URL('../sovereign-fixed-runtime-parent-v1.mjs',import.meta.url),'utf8');
const hash=b=>createHash('sha256').update(b).digest('hex');
const evidence=makeFixedRuntimeSourceProofFixtureV1(),head=evidence.head;
const custody='b'.repeat(64), manifest='c'.repeat(64), pe=Buffer.from('NONEXECUTABLE-VM-FIXTURE');
const spatial=process.argv.includes('--spatial');
let completed=0;
for(const mode of ['success','compatibility','cancel','refuse','reject','late','mutate','mutate-request','mutate-head','resource-during-run','parent-timeout','stdin-error','native-cancel','native-owner-ended','native-deadline','native-pipe','native-unknown','normal-failure','missing-entry','missing-resume','missing-parent-binding','missing-normal-exit','missing-output','missing-output-hash','missing-overflow','missing-cancel-fact','malformed',
 ...(spatial?['profile-missing','unregistered-action','wrong-prepared-profile','wrong-terminal-profile','wrong-terminal-head','surviving-descendant','missing-zero']:[])]) {
 let transportTimeout=null,spawned=false;
 const context=vm.createContext({Buffer,TextDecoder,performance,setTimeout:(callback,ms,...args)=>{if(ms>100000)transportTimeout=ms;return setTimeout(callback,mode==='parent-timeout'&&ms>100000?0:ms,...args);},clearTimeout,setInterval,clearInterval,AbortController,
  process:{platform:'win32',pid:12345,env:{}},console});
 const pending={SchemaVersion:'stephanos.fixed-runtime-pending.v1',SourceHead:head,SourceTree:evidence.tree,HelperSha256:hash(pe),ManifestSha256:manifest,GitClosureSha256:evidence.gitClosureSha256};
 const fs={lstatSync:path=>({isFile:()=>true,isDirectory:()=>true,isSymbolicLink:()=>false,nlink:1,size:128}),
  readFileSync:path=>path.endsWith('host.exe')?pe:path.endsWith('pending.json')?Buffer.from(JSON.stringify(pending)):
   path.endsWith('HEAD')?Buffer.from('ref: refs/heads/main\n'):Buffer.from(head+'\n'),
  opendirSync:()=>{throw new Error('UNEXPECTED_VERSION_DISCOVERY');}};
 let nativeClose=false,callbackSettled=false,resourceOk=true;
 const spawnSync=(_exe,args)=>args.at(-3)==='cat-file'?{status:0,stdout:args.at(-2)==='commit'?evidence.commit.bytes:evidence.trees.get(args.at(-1))}:
  args[0]==='--inspect-v1'?{status:0,stdout:'SOVEREIGN_RUNTIME_INVENTORY_V1='+JSON.stringify({
  SchemaVersion:'stephanos.fixed-runtime-inventory.v1',Ok:true,SourceHead:head,HelperSha256:hash(pe),ManifestSha256:manifest,
  InstallationSourceHead:head,SourceProofSha256:evidence.sourceProofSha256,GitClosureSha256:evidence.gitClosureSha256,
  SourceTree:evidence.tree,InstallationSourceTree:evidence.tree,
  AuthenticatedCustodyIdle:true,RuntimeActivationGranted:false,MutationAttempted:false,
  CustodyRecordSha256:custody,NativeRecordId:26,Profiles:['MAINTENANCE_GOAL_BUILDER_V1','SOURCE_TASK_V1',...(spatial&&mode!=='profile-missing'?['SPATIAL_WORKSPACE_PREPARE_V1']:[])],BootStartedAtUtc:'2026-01-01T00:00:00.0000000Z'})}:
  {status:0,stdout:'FIXED_RUNTIME_PROTECTED_V1'};
 const spawn=()=>{
  spawned=true;
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();
  let frame,frameSha,meta,closed=false;
  const terminal=ok=>{
   if(closed)return;closed=true;
   if(mode.startsWith('native-')||mode.startsWith('missing-')||mode==='normal-failure')ok=false;
   const normalFailure=mode==='normal-failure'||mode.startsWith('missing-');
   const interrupted=mode.startsWith('native-')&&mode!=='native-deadline'&&mode!=='native-unknown';
   const entryReported=ok||normalFailure||mode.startsWith('native-');
   const nativeReason=({'native-cancel':'CANCELLED','native-owner-ended':'OWNER_ENDED','native-deadline':'DEADLINE','native-pipe':'PIPE_UNPROVEN','native-unknown':'TERMINAL_IO_UNPROVEN','normal-failure':'CHILD_FAILED'})[mode]|| (mode.startsWith('missing-')?'CHILD_FAILED':ok?'':'PARENT_BINDING_UNPROVEN');
   const receipt={SchemaVersion:'stephanos.fixed-runtime-job.v1',RequestId:frame.RequestId,FrameSha256:frameSha,
    Profile:frame.Profile,OwnerPid:12345,OwnerCreatedAtUtc:'2026-01-01T00:00:01.0000000Z',RuntimeSourceHead:head,
    InstallationSourceHead:frame.InstallationSourceHead,SourceProofSha256:frame.SourceProofSha256,
    SourceHeadMatched:true,CustodyRecordSha256:custody,NativeRecordId:26,
    ActionId:meta.actionId,MissionId:meta.missionId,ClaimSha256:meta.claimSha256,
    TaskRootCreated:true,TaskResumed:entryReported,TaskExecuted:entryReported,OperationOk:ok,Reason:nativeReason,ExecutionCustodyReleased:true,
    TaskStage:{RootPid:23456,RootCreatedAtUtc:'2026-01-01T00:00:02.0000000Z',AssignedBeforeExecution:true,
     ZeroActiveProcessesObserved:true,ActiveProcesses:0,ExecutionCustodyReleased:true,Output:'',OutputSha256:hash(''),
     ResumeConfirmed:entryReported,ParentBindingAccepted:entryReported,NormalRootExit:entryReported,OutputComplete:true,OutputOverflow:false,CancellationRequested:interrupted,OperationOk:ok,Reason:nativeReason,ExitCode:ok?0:2}};
   if(mode==='malformed')receipt.FrameSha256='f'.repeat(64);
   if(mode==='wrong-terminal-profile')receipt.Profile='MAINTENANCE_GOAL_BUILDER_V1';
   if(mode==='wrong-terminal-head')receipt.RuntimeSourceHead='f'.repeat(40);
   if(mode==='surviving-descendant')receipt.TaskStage.ActiveProcesses=1;
   if(mode==='missing-zero')delete receipt.TaskStage.ZeroActiveProcessesObserved;
   if(mode==='missing-entry')receipt.TaskExecuted=false;
   if(mode==='missing-resume')receipt.TaskResumed=false;
   if(mode==='missing-parent-binding')receipt.TaskStage.ParentBindingAccepted=false;
   if(mode==='missing-normal-exit')receipt.TaskStage.NormalRootExit=false;
   if(mode==='missing-output')receipt.TaskStage.OutputComplete=false;
   if(mode==='missing-output-hash')receipt.TaskStage.OutputSha256='f'.repeat(64);
   if(mode==='missing-overflow')delete receipt.TaskStage.OutputOverflow;
   if(mode==='missing-cancel-fact')delete receipt.TaskStage.CancellationRequested;
   child.stdout.emit('data',Buffer.from('SOVEREIGN_RUNTIME_TERMINAL_V1='+JSON.stringify(receipt)+'\n'));
   nativeClose=true;child.emit('close',ok?0:2);
  };
  child.stdin.write=line=>{
   if(!frame){const records=line.split('\n');assert.equal(records.length,3);assert.equal(records[1],evidence.raw);
    frame=JSON.parse(records[0]);frameSha=hash(records[0]);
    meta=spatial?{}:JSON.parse(Buffer.from(frame.TaskFrameBase64,'base64'));
    if(spatial){assert.equal(frame.Profile,'SPATIAL_WORKSPACE_PREPARE_V1');assert.equal(frame.TaskFrameBase64,'');assert.equal(frame.TaskBindingSha256,hash(''));}
    assert.equal(frame.SourceProofSha256,evidence.sourceProofSha256);assert.equal(frame.InstallationSourceHead,head);
    queueMicrotask(()=>{
     child.stdout.emit('data',Buffer.from('SOVEREIGN_RUNTIME_PREPARED_V1='+JSON.stringify({
      SchemaVersion:'stephanos.fixed-runtime-prepared.v1',RequestId:frame.RequestId,FrameSha256:frameSha,
      Profile:mode==='wrong-prepared-profile'?'MAINTENANCE_GOAL_BUILDER_V1':frame.Profile,RuntimeSourceHead:head,OwnerPid:12345,OwnerCreatedAtUtc:'2026-01-01T00:00:01.0000000Z',
      InstallationSourceHead:frame.InstallationSourceHead,SourceProofSha256:frame.SourceProofSha256,
      RootPid:23456,RootCreatedAtUtc:'2026-01-01T00:00:02.0000000Z',HelperSha256:hash(pe),ManifestSha256:manifest,
      CustodyRecordSha256:custody,NativeRecordId:26})+'\n'));
     if(mode==='late')setTimeout(()=>terminal(false),0);
    });
   } else if(line.startsWith('ACK ')){if(mode==='resource-during-run')resourceOk=false;else if(mode==='stdin-error'){child.stdin.emit('error',new Error('fixture'));queueMicrotask(()=>terminal(true));}else if(mode!=='parent-timeout')queueMicrotask(()=>terminal(true));}
  };
  child.stdin.end=()=>queueMicrotask(()=>terminal(false));child.kill=()=>terminal(false);
  return child;
 };
 const mocks={'node:child_process':{spawn,spawnSync},'node:crypto':{createHash},'node:fs':fs,
  'node:path':{dirname:win32.dirname,join:win32.join},
  '../shared/agents/stephanosNativeCapacityGamingAdmissionV1.mjs':{inspectStephanosNativeCapacityGamingAdmissionV1:()=>({ok:resourceOk})},
  '../shared/agents/battleBridgeExecutionBoundaryV1.mjs':{createBattleBridgeMinimalChildEnvironment:()=>({}),
    resolveBattleBridgeGitExecution:()=>({executable:'FIXTURE_GIT',fixedConfigArgs:[],environment:{}})},
  '../shared/agents/battleBridgeGitProbeContextV1.mjs':{createBattleBridgeGitProbeContextV1:()=>({assert(){},close(){},repositoryArgs:()=>[]}),isBattleBridgeGitProbeContextV1:()=>true},
  './sovereign-maintenance-custody-store-v1.mjs':{readMaintenanceRecoverySourceV1:()=>head},
  './sovereign-fixed-runtime-installer-candidate-v1.mjs':{FIXED_RUNTIME_SOURCE_PATHS_V1:evidence.paths,FIXED_RUNTIME_SOURCE_MEMBER_LIMIT_V1,fixedRuntimeGitClosureSha256V1}};
 const module=new vm.SourceTextModule(source,{context});
 await module.link(specifier=>{const values=mocks[specifier];assert.ok(values,specifier);return new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context});});
 await module.evaluate();const api=module.namespace;
 const binding={requestId:'fixture-request-123',sourceHead:head,custodyRecordSha256:custody,nativeRecordId:26,
  ...(spatial?{actionId:mode==='unregistered-action'?'start-spatial-workspace':'prepare-spatial-workspace'}:
    {actionId:'task-a',missionId:'mission-a',claimSha256:'d'.repeat(64)})};
 const original={...binding},controller=new AbortController();
 const execute=spatial?api.executeFixedMaintenanceRuntimeV1:api.executeFixedSourceTaskRuntimeV1;
 const result=await execute(api.inspectFixedRuntimeQualificationV1(),binding,{signal:controller.signal,
  onPrepared:async()=>{
   if(mode==='cancel')controller.abort();
   if(mode==='reject'){callbackSettled=true;throw new Error('fixture binding failure');}
   if(mode==='late'){await new Promise(resolve=>setTimeout(resolve,20));assert.equal(nativeClose,true);}
   if(mode==='mutate')binding.actionId='task-b';
   if(mode==='mutate-request')binding.requestId='fixture-request-456';
   if(mode==='mutate-head')binding.sourceHead='e'.repeat(40);
   callbackSettled=true;return mode!=='refuse';
  }});
 if(['profile-missing','unregistered-action'].includes(mode)) {
  assert.equal(result.reason,mode==='profile-missing'?'FIXED_RUNTIME_PROFILE_NOT_COMPILED':'FIXED_RUNTIME_PROFILE_NOT_QUALIFIED',mode);
  assert.equal(spawned,false,mode);assert.equal(callbackSettled,false,mode);
  assert.equal(api.consumeFixedRuntimePrelaunchExclusionV1(result,original),true,mode);
  assert.equal(api.consumeFixedRuntimeTerminalProvenanceV1(result,original),false,mode);completed++;continue;
 }
 assert.equal(callbackSettled,mode!=='wrong-prepared-profile',mode);
 if(spatial)assert.equal(transportTimeout,240000,mode);
 assert.equal(result.ok,['success','compatibility','mutate','mutate-request','mutate-head'].includes(mode),mode);
 assert.equal(Object.isFrozen(result),true,mode);
 assert.equal(api.consumeFixedRuntimeCompletionV1({...result},original),null,mode+' copy');
 assert.equal(api.consumeFixedRuntimeCompletionV1(JSON.parse(JSON.stringify(result)),original),null,mode+' JSON');
 assert.equal(api.consumeFixedRuntimeCompletionV1({executionCustodyReleased:true,operationDisposition:'SUCCEEDED'},original),null,mode+' forged');
 if(mode==='compatibility'){
  assert.equal(api.consumeFixedRuntimeTerminalProvenanceV1(result,original),true,mode);
  assert.equal(api.consumeFixedRuntimeCompletionV1(result,original),null,mode+' consumes same proof');
  completed++;continue;
 }
 const completion=api.consumeFixedRuntimeCompletionV1(result,original);
 if(['malformed','wrong-prepared-profile','wrong-terminal-profile','wrong-terminal-head','surviving-descendant','missing-zero'].includes(mode))assert.equal(completion,null,mode);
 else {
  assert.equal(Object.isFrozen(completion),true,mode);
  assert.equal(completion.executionCustodyReleased,true,mode);
  const disposition=['success','compatibility','mutate','mutate-request','mutate-head'].includes(mode)?'SUCCEEDED':
   mode==='normal-failure'?'FAILED':(['native-deadline','native-unknown'].includes(mode)||mode.startsWith('missing-'))?'UNPROVEN':'CANCELLED';
  assert.equal(completion.operationDisposition,disposition,mode);
 }
 assert.equal(api.consumeFixedRuntimeCompletionV1(result,original),null,mode+' replay');
 assert.equal(api.consumeFixedRuntimeTerminalProvenanceV1(result,original),false,mode+' compatibility replay');
 completed++;
}
console.log(JSON.stringify({schemaVersion:'stephanos.isolated-parent-protocol-fixture.v1',cases:completed,nativeExecuted:false,productionQualification:false}));
