// Real parent code, isolated VM transport. No native activation or custody.
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {win32} from 'node:path';
import {makeFixedRuntimeSourceProofFixtureV1,fixtureSha256 as hash} from './sovereign-fixed-runtime-source-proof-fixture-v1.mjs';
import {FIXED_RUNTIME_SOURCE_MEMBER_LIMIT_V1,fixedRuntimeGitClosureSha256V1} from '../sovereign-fixed-runtime-installer-candidate-v1.mjs';
const source=readFileSync(new URL('../sovereign-fixed-runtime-parent-v1.mjs',import.meta.url),'utf8');
const current=makeFixedRuntimeSourceProofFixtureV1({extras:[{path:'README.md',content:'unrelated update\n'}]});
const installed=makeFixedRuntimeSourceProofFixtureV1({extras:[{path:'README.md',content:'original unrelated content\n'}]});
assert.notEqual(current.head,installed.head);assert.equal(current.gitClosureSha256,installed.gitClosureSha256);
const root='C:\\Program Files\\Stephanos\\SovereignFixedRuntimeV1';
const sourceRoot='C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os';
const pe=Buffer.from('NONEXECUTABLE-ADOPTION-FIXTURE'),manifest='c'.repeat(64),custody='b'.repeat(64);
const modes=['equivalent','exact','authority-denied','slow-authority','authority-deadline',
  'authority-expired','native-inspection-expired','head-drift','origin-drift','proof-corrupt',
  'legacy','changed','ambiguous','discovery-bound','discovery-alias','partial-exact',
  'unsafe-protection','inventory-installation-mismatch','inventory-execution-mismatch','inventory-proof-mismatch',
  'inventory-tree-mismatch','stale-qualification','wrong-grant-head','prepared-installation-mismatch',
  'terminal-installation-mismatch','terminal-proof-mismatch'];
let completed=0;
for(const mode of modes) {
  const compile=mode==='exact'?current:installed,compileDirectory=win32.join(root,compile.head);
  const currentDirectory=win32.join(root,current.head);
  let authorityCalls=0,gitCalls=0,inspections=0,executions=0,time=0;
  const context=vm.createContext({Buffer,TextDecoder,performance:{now:()=>time},setTimeout,clearTimeout,setInterval,clearInterval,
    AbortController,process:{platform:'win32',pid:12345,env:{}}});
  const pendingFor=version=>({SchemaVersion:'stephanos.fixed-runtime-pending.v1',SourceHead:version,
    SourceTree:compile.tree,HelperSha256:hash(pe),ManifestSha256:manifest,
    ...(mode==='legacy'?{}:{GitClosureSha256:mode==='changed'?'e'.repeat(64):current.gitClosureSha256})});
  const fs={
    lstatSync(path) {
      if(path===currentDirectory && mode!=='exact' && mode!=='partial-exact')
        throw Object.assign(new Error('MISSING'),{code:'ENOENT'});
      return {isFile:()=>true,isDirectory:()=>true,isSymbolicLink:()=>false,nlink:1,size:128};
    },
    readFileSync(path) {
      if(path.endsWith('host.exe'))return pe;
      if(path.endsWith('pending.json')) {
        const version=win32.basename(win32.dirname(path));
        return Buffer.from(JSON.stringify(mode==='partial-exact' && version===current.head
          ?{...pendingFor(version),HelperSha256:'e'.repeat(64)}:pendingFor(version)));
      }
      if(path===win32.join(sourceRoot,'.git','HEAD'))return Buffer.from('ref: refs/heads/main\n');
      const drift=mode==='head-drift' && path===win32.join(sourceRoot,'.git','refs','heads','main') ||
        mode==='origin-drift' && path===win32.join(sourceRoot,'.git','refs','remotes','origin','main');
      return Buffer.from((drift?installed.head:current.head)+'\n');
    },
    opendirSync() {
      const names=mode==='ambiguous'?[compile.head,'f'.repeat(40)]:
        mode==='discovery-bound'?Array.from({length:65},(_,i)=>i.toString(16).padStart(40,'0')):
        mode==='discovery-alias'?[compile.head.toUpperCase()]:[compile.head];
      let index=0;return {readSync:()=>index<names.length?{name:names[index++]}:null,closeSync(){}};
    },
  };
  const spawnSync=(executable,args,options)=>{
    if(args.at(-4)==='show-ref') {
      const ref=args.at(-1);
      const drift=(mode==='head-drift' && ref==='refs/heads/main')
        || (mode==='origin-drift' && ref==='refs/remotes/origin/main');
      return {status:0,stdout:Buffer.from((drift?installed.head:current.head)+'\n')};
    }
    if(args.at(-3)==='cat-file') {
      gitCalls++;let bytes=args.at(-2)==='commit'?current.commit.bytes:current.trees.get(args.at(-1));
      if(mode==='proof-corrupt')bytes=Buffer.concat([bytes,Buffer.from('corrupt')]);
      return {status:0,stdout:bytes};
    }
    if(args[0]!=='--inspect-v1')return {status:mode==='unsafe-protection'?2:0,stdout:'FIXED_RUNTIME_PROTECTED_V1'};
    inspections++;assert.equal(executable,win32.join(compileDirectory,'host.exe'));
    assert.equal(options.input,current.raw+'\n');
    assert.ok(options.timeout<=15000 && options.timeout<=25000-time);
    if(mode==='native-inspection-expired')time=25000;
    return {status:0,stdout:'SOVEREIGN_RUNTIME_INVENTORY_V1='+JSON.stringify({
      SchemaVersion:'stephanos.fixed-runtime-inventory.v1',Ok:true,
      SourceHead:mode==='inventory-execution-mismatch'?compile.head:current.head,
      InstallationSourceHead:mode==='inventory-installation-mismatch'?current.head:compile.head,
      SourceTree:mode==='inventory-tree-mismatch'?compile.tree:current.tree,InstallationSourceTree:compile.tree,
      SourceProofSha256:mode==='inventory-proof-mismatch'?'e'.repeat(64):current.sourceProofSha256,
      GitClosureSha256:current.gitClosureSha256,HelperSha256:hash(pe),ManifestSha256:manifest,
      AuthenticatedCustodyIdle:true,RuntimeActivationGranted:false,MutationAttempted:false,
      CustodyRecordSha256:custody,NativeRecordId:26,Profiles:['SOURCE_TASK_V1'],
      BootStartedAtUtc:'2026-01-01T00:00:00.0000000Z',
    })};
  };
  const spawn=(executable,args)=>{
    executions++;assert.equal(executable,win32.join(compileDirectory,'host.exe'));assert.deepEqual([...args],[]);
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();
    let frame,frameSha,closed=false;
    const terminal=()=>{
      if(closed)return;closed=true;
      const meta=JSON.parse(Buffer.from(frame.TaskFrameBase64,'base64'));
      child.stdout.emit('data',Buffer.from('SOVEREIGN_RUNTIME_TERMINAL_V1='+JSON.stringify({
        SchemaVersion:'stephanos.fixed-runtime-job.v1',RequestId:frame.RequestId,FrameSha256:frameSha,Profile:frame.Profile,
        OwnerPid:12345,OwnerCreatedAtUtc:'2026-01-01T00:00:01.0000000Z',RuntimeSourceHead:current.head,
        InstallationSourceHead:mode==='terminal-installation-mismatch'?current.head:compile.head,
        SourceProofSha256:mode==='terminal-proof-mismatch'?'f'.repeat(64):current.sourceProofSha256,
        SourceHeadMatched:true,CustodyRecordSha256:custody,NativeRecordId:26,
        ActionId:meta.actionId,MissionId:meta.missionId,ClaimSha256:meta.claimSha256,
        TaskRootCreated:true,TaskResumed:true,TaskExecuted:true,OperationOk:true,Reason:'',ExecutionCustodyReleased:true,
        TaskStage:{RootPid:23456,RootCreatedAtUtc:'2026-01-01T00:00:02.0000000Z',AssignedBeforeExecution:true,
          ZeroActiveProcessesObserved:true,ActiveProcesses:0,ExecutionCustodyReleased:true,Output:'',OutputSha256:hash(''),
          ResumeConfirmed:true,ParentBindingAccepted:true,NormalRootExit:true,OutputComplete:true,OutputOverflow:false,
          CancellationRequested:false,OperationOk:true,Reason:'',ExitCode:0},
      })+'\n'));child.emit('close',0);
    };
    child.stdin.write=line=>{
      if(frame){if(line.startsWith('ACK '))queueMicrotask(terminal);return;}
      const records=line.split('\n');assert.equal(records.length,3);assert.equal(records[1],current.raw);
      frame=JSON.parse(records[0]);frameSha=hash(records[0]);
      assert.equal(frame.RuntimeSourceHead,current.head);assert.equal(frame.InstallationSourceHead,compile.head);
      assert.equal(frame.SourceProofSha256,current.sourceProofSha256);
      queueMicrotask(()=>child.stdout.emit('data',Buffer.from('SOVEREIGN_RUNTIME_PREPARED_V1='+JSON.stringify({
        SchemaVersion:'stephanos.fixed-runtime-prepared.v1',RequestId:frame.RequestId,FrameSha256:frameSha,
        Profile:frame.Profile,RuntimeSourceHead:current.head,
        InstallationSourceHead:mode==='prepared-installation-mismatch'?current.head:compile.head,
        SourceProofSha256:current.sourceProofSha256,OwnerPid:12345,OwnerCreatedAtUtc:'2026-01-01T00:00:01.0000000Z',
        RootPid:23456,RootCreatedAtUtc:'2026-01-01T00:00:02.0000000Z',HelperSha256:hash(pe),ManifestSha256:manifest,
        CustodyRecordSha256:custody,NativeRecordId:26,
      })+'\n')));
    };
    child.stdin.end=()=>queueMicrotask(terminal);child.kill=terminal;return child;
  };
  const mocks={
    'node:child_process':{spawn,spawnSync},'node:crypto':{createHash},'node:fs':fs,
    'node:path':{dirname:win32.dirname,join:win32.join},
    '../shared/agents/stephanosNativeCapacityGamingAdmissionV1.mjs':{inspectStephanosNativeCapacityGamingAdmissionV1:()=>({ok:true})},
    '../shared/agents/battleBridgeExecutionBoundaryV1.mjs':{createBattleBridgeMinimalChildEnvironment:()=>({}),
      resolveBattleBridgeGitExecution:()=>({executable:'FIXTURE_GIT',fixedConfigArgs:[],environment:{}})},
    '../shared/agents/battleBridgeGitProbeContextV1.mjs':{createBattleBridgeGitProbeContextV1:()=>({assert(){},close(){},repositoryArgs:()=>[]}),isBattleBridgeGitProbeContextV1:()=>true},
    './sovereign-maintenance-custody-store-v1.mjs':{readMaintenanceRecoverySourceV1:()=>{
      authorityCalls++;
      if(mode==='authority-denied')throw new Error('MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN');
      if(mode==='slow-authority')time=120001;
      if(mode==='authority-deadline')time=25000;
      if(mode==='authority-expired')time=25001;
      return current.head;}},
    './sovereign-fixed-runtime-installer-candidate-v1.mjs':{FIXED_RUNTIME_SOURCE_PATHS_V1:current.paths,FIXED_RUNTIME_SOURCE_MEMBER_LIMIT_V1,fixedRuntimeGitClosureSha256V1},
  };
  const module=new vm.SourceTextModule(source,{context});
  await module.link(specifier=>{const values=mocks[specifier];assert.ok(values,specifier);
    return new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value);},{context});});
  await module.evaluate();const api=module.namespace;
  const originalPending=JSON.stringify(pendingFor(compile.head));
  // A fabricated argument is ignored: the real production observer is called.
  const qualification=api.inspectFixedRuntimeQualificationV1({currentMainProven:true,expectedHead:current.head});
  assert.equal(authorityCalls,1,mode);
  const admits=['equivalent','exact','stale-qualification','wrong-grant-head','prepared-installation-mismatch',
    'terminal-installation-mismatch','terminal-proof-mismatch'].includes(mode);
  assert.equal(qualification.ok,admits,mode+': '+qualification.reason);
  if(admits) {
    assert.equal(qualification.sourceHead,current.head);assert.equal(qualification.installationSourceHead,compile.head);
    const binding={requestId:'fixture-adoption-request',sourceHead:mode==='wrong-grant-head'?compile.head:current.head,
      custodyRecordSha256:custody,nativeRecordId:26,actionId:'task-a',missionId:'mission-a',claimSha256:'d'.repeat(64)};
    const originalBinding={...binding};
    if(mode==='stale-qualification')time=6000;
    const result=await api.executeFixedSourceTaskRuntimeV1(qualification,binding,{onPrepared:()=>true});
    assert.equal(result.ok,['equivalent','exact'].includes(mode),mode);
    assert.deepEqual(binding,originalBinding,mode+' original grant is immutable');
    const completion=api.consumeFixedRuntimeCompletionV1(result,binding);
    assert.equal(completion?.operationDisposition??null,['equivalent','exact'].includes(mode)?'SUCCEEDED':null,mode);
    assert.equal(executions,['stale-qualification','wrong-grant-head'].includes(mode)?0:1,mode);
  } else {
    assert.equal(executions,0,mode);assert.equal(qualification.dispatchAllowed,false,mode);
  }
  if(['authority-denied','slow-authority','authority-deadline','authority-expired'].includes(mode)){
    assert.equal(gitCalls,0);assert.equal(inspections,0);
  }
  if(['slow-authority','authority-deadline','authority-expired','native-inspection-expired'].includes(mode))
    assert.equal(qualification.reason,'FIXED_RUNTIME_CANONICAL_SOURCE_EXPIRED');
  if(['legacy','changed','ambiguous','discovery-bound','discovery-alias','partial-exact','unsafe-protection'].includes(mode))
    assert.equal(inspections,0,mode+' no native inspector before admission');
  assert.equal(JSON.stringify(pendingFor(compile.head)),originalPending,mode+' installation and custody are never rewritten');
  completed++;
}
console.log(JSON.stringify({cases:completed,nativeExecuted:false,productionQualification:false,custodyMutated:false}));
