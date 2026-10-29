// Isolated VM protocol fixture. No native helper, real claim, or production brand.
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {win32} from 'node:path';
const source=readFileSync(new URL('../sovereign-fixed-runtime-parent-v1.mjs',import.meta.url),'utf8');
const hash=b=>createHash('sha256').update(b).digest('hex');
const head='a'.repeat(40), custody='b'.repeat(64), manifest='c'.repeat(64), pe=Buffer.from('NONEXECUTABLE-VM-FIXTURE');
let completed=0;
for(const mode of ['success','cancel','refuse','reject','late','mutate','mutate-request','mutate-head','resource-during-run','malformed']) {
 const context=vm.createContext({Buffer,performance,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,
  process:{platform:'win32',pid:12345,env:{}},console});
 const pending={SchemaVersion:'stephanos.fixed-runtime-pending.v1',SourceHead:head,HelperSha256:hash(pe),ManifestSha256:manifest};
 const fs={lstatSync:path=>({isFile:()=>true,isDirectory:()=>true,isSymbolicLink:()=>false,nlink:1,size:128}),
  readFileSync:path=>path.endsWith('host.exe')?pe:path.endsWith('pending.json')?Buffer.from(JSON.stringify(pending)):
   path.endsWith('HEAD')?Buffer.from('ref: refs/heads/main\n'):Buffer.from(head+'\n')};
 let nativeClose=false,callbackSettled=false,resourceOk=true;
 const spawnSync=(_exe,args)=>args[0]==='--inspect-v1'?{status:0,stdout:'SOVEREIGN_RUNTIME_INVENTORY_V1='+JSON.stringify({
  SchemaVersion:'stephanos.fixed-runtime-inventory.v1',Ok:true,SourceHead:head,HelperSha256:hash(pe),ManifestSha256:manifest,
  AuthenticatedCustodyIdle:true,RuntimeActivationGranted:false,MutationAttempted:false,
  CustodyRecordSha256:custody,NativeRecordId:26,Profiles:['MAINTENANCE_GOAL_BUILDER_V1','SOURCE_TASK_V1'],BootStartedAtUtc:'2026-01-01T00:00:00.0000000Z'})}:
  {status:0,stdout:'FIXED_RUNTIME_PROTECTED_V1'};
 const spawn=()=>{
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();
  let frame,frameSha,meta,closed=false;
  const terminal=ok=>{
   if(closed)return;closed=true;
   const receipt={SchemaVersion:'stephanos.fixed-runtime-job.v1',RequestId:frame.RequestId,FrameSha256:frameSha,
    Profile:frame.Profile,OwnerPid:12345,OwnerCreatedAtUtc:'2026-01-01T00:00:01.0000000Z',RuntimeSourceHead:head,
    SourceHeadMatched:true,CustodyRecordSha256:custody,NativeRecordId:26,
    ActionId:meta.actionId,MissionId:meta.missionId,ClaimSha256:meta.claimSha256,
    TaskRootCreated:true,TaskResumed:ok,TaskExecuted:ok,OperationOk:ok,Reason:ok?'COMPLETED':'PARENT_BINDING_UNPROVEN',ExecutionCustodyReleased:true,
    TaskStage:{RootPid:23456,RootCreatedAtUtc:'2026-01-01T00:00:02.0000000Z',AssignedBeforeExecution:true,
     ZeroActiveProcessesObserved:true,ActiveProcesses:0,ExecutionCustodyReleased:true,Output:'',OutputSha256:hash(''),
     ResumeConfirmed:ok,ParentBindingAccepted:ok,NormalRootExit:ok,OutputComplete:true,ExitCode:ok?0:2}};
   if(mode==='malformed')receipt.FrameSha256='f'.repeat(64);
   child.stdout.emit('data',Buffer.from('SOVEREIGN_RUNTIME_TERMINAL_V1='+JSON.stringify(receipt)+'\n'));
   nativeClose=true;child.emit('close',ok?0:2);
  };
  child.stdin.write=line=>{
   if(!frame){frame=JSON.parse(line);frameSha=hash(line.trim());meta=JSON.parse(Buffer.from(frame.TaskFrameBase64,'base64'));
    queueMicrotask(()=>{
     child.stdout.emit('data',Buffer.from('SOVEREIGN_RUNTIME_PREPARED_V1='+JSON.stringify({
      SchemaVersion:'stephanos.fixed-runtime-prepared.v1',RequestId:frame.RequestId,FrameSha256:frameSha,
      Profile:frame.Profile,RuntimeSourceHead:head,OwnerPid:12345,OwnerCreatedAtUtc:'2026-01-01T00:00:01.0000000Z',
      RootPid:23456,RootCreatedAtUtc:'2026-01-01T00:00:02.0000000Z',HelperSha256:hash(pe),ManifestSha256:manifest,
      CustodyRecordSha256:custody,NativeRecordId:26})+'\n'));
     if(mode==='late')setTimeout(()=>terminal(false),0);
    });
   } else if(line.startsWith('ACK ')){if(mode==='resource-during-run')resourceOk=false;else queueMicrotask(()=>terminal(true));}
  };
  child.stdin.end=()=>queueMicrotask(()=>terminal(false));child.kill=()=>terminal(false);
  return child;
 };
 const mocks={'node:child_process':{spawn,spawnSync},'node:crypto':{createHash},'node:fs':fs,
  'node:path':{dirname:win32.dirname,join:win32.join},
  '../shared/agents/stephanosNativeCapacityGamingAdmissionV1.mjs':{inspectStephanosNativeCapacityGamingAdmissionV1:()=>({ok:resourceOk})},
  '../shared/agents/battleBridgeExecutionBoundaryV1.mjs':{createBattleBridgeMinimalChildEnvironment:()=>({})}};
 const module=new vm.SourceTextModule(source,{context});
 await module.link(specifier=>{const values=mocks[specifier];assert.ok(values,specifier);return new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context});});
 await module.evaluate();const api=module.namespace;
 const binding={requestId:'fixture-request-123',sourceHead:head,custodyRecordSha256:custody,nativeRecordId:26,
  actionId:'task-a',missionId:'mission-a',claimSha256:'d'.repeat(64)};
 const original={...binding},controller=new AbortController();
 const result=await api.executeFixedSourceTaskRuntimeV1(api.inspectFixedRuntimeQualificationV1(),binding,{signal:controller.signal,
  onPrepared:async()=>{
   if(mode==='cancel')controller.abort();
   if(mode==='reject'){callbackSettled=true;throw new Error('fixture binding failure');}
   if(mode==='late'){await new Promise(resolve=>setTimeout(resolve,20));assert.equal(nativeClose,true);}
   if(mode==='mutate')binding.actionId='task-b';
   if(mode==='mutate-request')binding.requestId='fixture-request-456';
   if(mode==='mutate-head')binding.sourceHead='e'.repeat(40);
   callbackSettled=true;return mode!=='refuse';
  }});
 assert.equal(callbackSettled,true,mode);
 assert.equal(result.ok,['success','mutate','mutate-request','mutate-head'].includes(mode),mode);
 assert.equal(api.consumeFixedRuntimeTerminalProvenanceV1({...result},original),false,mode);
 assert.equal(api.consumeFixedRuntimeTerminalProvenanceV1(result,original),mode!=='malformed',mode);
 assert.equal(api.consumeFixedRuntimeTerminalProvenanceV1(result,original),false,mode+' replay');
 if(mode==='mutate')assert.equal(api.consumeFixedRuntimeTerminalProvenanceV1(result,binding),false);
 completed++;
}
console.log(JSON.stringify({schemaVersion:'stephanos.isolated-parent-protocol-fixture.v1',cases:completed,nativeExecuted:false,productionQualification:false}));
