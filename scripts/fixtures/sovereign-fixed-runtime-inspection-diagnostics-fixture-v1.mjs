// Execute the actual production inspector in isolated Windows VM contexts.
// No native executable, production qualification, credential or host is used.
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {win32} from 'node:path';

const source=readFileSync(new URL('../sovereign-fixed-runtime-parent-v1.mjs',import.meta.url),'utf8');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const head='a'.repeat(40), manifest='c'.repeat(64), custody='b'.repeat(64);
const pe=Buffer.from('NONEXECUTABLE-INSPECTION-FIXTURE');
const root='C:\\Program Files\\Stephanos\\SovereignFixedRuntimeV1';
const directory=win32.join(root,head), sourceRoot='C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os';
const marker='SOVEREIGN_RUNTIME_INVENTORY_V1=';
const unknown='FIXED_RUNTIME_IDENTITY_INSPECTION_UNPROVEN';
const privateText='PRIVATE_FIXTURE_VALUE_C:\\private\\fixture';
const denial=reason=>({SchemaVersion:'stephanos.fixed-runtime-inventory.v1',Ok:false,Reason:reason,
  Profiles:[],RuntimeActivationGranted:false,MutationAttempted:false});
const base=denial('RUNTIME_NORMAL_OPERATOR_REQUIRED');
const success={SchemaVersion:'stephanos.fixed-runtime-inventory.v1',Ok:true,SourceHead:head,
  HelperSha256:hash(pe),ManifestSha256:manifest,AuthenticatedCustodyIdle:true,
  RuntimeActivationGranted:false,MutationAttempted:false,CustodyRecordSha256:custody,
  NativeRecordId:27,Profiles:['MAINTENANCE_GOAL_BUILDER_V1','SOURCE_TASK_V1'],
  BootStartedAtUtc:'2026-01-01T00:00:00.0000000Z'};
const cases=[];
const add=(name,options,reason=unknown)=>cases.push({name,...options,reason});
for(const reason of ['RUNTIME_NORMAL_OPERATOR_REQUIRED','RUNTIME_PENDING_LATER_BOOT_UNPROVEN',
  'RUNTIME_SOURCE_REF_CHANGED','RUNTIME_SOURCE_MEMBER_CHANGED','RUNTIME_JOURNAL_RETENTION_UNPROVEN',
  'RUNTIME_NATIVE_ANCHOR_MISSING','RUNTIME_CUSTODY_RECORD_AUTHENTICATION_FAILED'])
  add(reason,{row:denial(reason)},reason);
add('unrecognized uppercase reason',{row:denial('ATTACKER_SELECTED_PRIVATE_TOKEN')});
add('raw path reason',{row:denial(privateText)});
add('lowercase reason',{row:denial('runtime_normal_operator_required')});
add('wrong schema',{row:{...base,SchemaVersion:'foreign.inventory.v1'}});
add('claimed foreign source',{row:{...base,SourceHead:'d'.repeat(40)}});
add('claimed foreign helper',{row:{...base,HelperSha256:'d'.repeat(64)}});
add('extra raw error',{row:{...base,error:privateText}});
add('successful claim on failed exit',{row:{...base,Ok:true}});
add('string success flag',{row:{...base,Ok:'false'}});
add('activation claimed',{row:{...base,RuntimeActivationGranted:true}});
add('mutation claimed',{row:{...base,MutationAttempted:true}});
add('profile claimed',{row:{...base,Profiles:['MAINTENANCE_GOAL_BUILDER_V1']}});
add('profile wrong type',{row:{...base,Profiles:{}}});
add('array receipt',{row:[base]});
add('null receipt',{row:null});
add('missing field',{row:Object.fromEntries(Object.entries(base).filter(([key])=>key!=='Profiles'))});
add('invalid JSON',{stdout:marker+'{'});
add('unbounded output',{stdout:marker+JSON.stringify({...base,raw:privateText.repeat(2000)})});
add('two records',{stdout:marker+JSON.stringify(base)+'\n'+marker+JSON.stringify(base)});
add('leading other record',{stdout:'{}\n'+marker+JSON.stringify(base)});
add('trailing other record',{stdout:marker+JSON.stringify(base)+'\n{}'});
add('wrong marker',{stdout:'FOREIGN_INVENTORY='+JSON.stringify(base)});
add('unexpected exit',{row:base,status:1});
add('absent exit',{row:base,status:null});
add('signal with refusal',{row:base,signal:'SIGTERM'});
add('timeout dominates printed receipt',{row:base,error:{code:'ETIMEDOUT',message:privateText}},
  'FIXED_RUNTIME_IDENTITY_INSPECTION_TIMEOUT');
add('missing inspector dominates printed receipt',{row:base,error:{code:'ENOENT',message:privateText}},
  'FIXED_RUNTIME_INSPECTOR_NOT_FOUND');
add('other error sanitized',{row:base,error:{code:'EACCES',message:privateText}});
add('exit zero plus execution error',{row:success,status:0,error:{code:'EACCES',message:privateText}});
add('exit zero plus signal',{row:success,status:0,signal:'SIGTERM'});
add('current installation missing',{fsFailure:'version-missing',expectedInspections:0},
  'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING');
add('version unreadable',{fsFailure:'version-unreadable',expectedInspections:0},
  'FIXED_RUNTIME_QUALIFICATION_UNPROVEN');
add('ancestor missing is not version absence',{fsFailure:'ancestor-missing',expectedInspections:0},
  'FIXED_RUNTIME_QUALIFICATION_UNPROVEN');
add('source HEAD missing is not installation absence',{fsFailure:'source-missing',expectedInspections:0},
  'FIXED_RUNTIME_QUALIFICATION_UNPROVEN');
add('redirected version',{fsFailure:'version-link',expectedInspections:0},
  'FIXED_RUNTIME_PARENT_REDIRECTION');
add('helper changed',{pendingChange:'helper',expectedInspections:0},'FIXED_RUNTIME_PENDING_IDENTITY_UNPROVEN');
add('pending source changed',{pendingChange:'head',expectedInspections:0},'FIXED_RUNTIME_PENDING_IDENTITY_UNPROVEN');
add('denial on zero remains unqualified',{row:base,status:0},'FIXED_RUNTIME_AUTHENTICATED_IDLE_UNPROVEN');
cases.push({name:'unchanged positive inventory',row:success,status:0,ok:true});

for(const entry of cases) {
  let inspections=0,executions=0;
  const context=vm.createContext({Buffer,performance,setTimeout,clearTimeout,setInterval,clearInterval,
    AbortController,process:{platform:'win32',pid:12345,env:{}}});
  const pending={SchemaVersion:'stephanos.fixed-runtime-pending.v1',SourceHead:entry.pendingChange==='head'?'d'.repeat(40):head,
    HelperSha256:entry.pendingChange==='helper'?'d'.repeat(64):hash(pe),ManifestSha256:manifest};
  const fail=code=>{throw Object.assign(new Error(privateText),{code});};
  const fs={lstatSync:path=>{
    if(path===directory && entry.fsFailure==='version-missing') fail('ENOENT');
    if(path===directory && entry.fsFailure==='version-unreadable') fail('EACCES');
    if(path===root && entry.fsFailure==='ancestor-missing') fail('ENOENT');
    if(path===win32.join(sourceRoot,'.git','HEAD') && entry.fsFailure==='source-missing') fail('ENOENT');
    return {isFile:()=>true,isDirectory:()=>true,nlink:1,size:128,
      isSymbolicLink:()=>path===directory && entry.fsFailure==='version-link'};
  },readFileSync:path=>path.endsWith('host.exe')?pe:path.endsWith('pending.json')?Buffer.from(JSON.stringify(pending)):
    path.endsWith('HEAD')?Buffer.from('ref: refs/heads/main\n'):Buffer.from(head+'\n')};
  const spawnSync=(executable,args)=>{
    if(args[0]!=='--inspect-v1') return {status:0,stdout:'FIXED_RUNTIME_PROTECTED_V1'};
    inspections++;
    assert.equal(executable,win32.join(directory,'host.exe'));
    assert.deepEqual([...args],['--inspect-v1']);
    return {status:Object.hasOwn(entry,'status')?entry.status:2,
      stdout:Object.hasOwn(entry,'stdout')?entry.stdout:marker+JSON.stringify(entry.row),
      stderr:privateText,error:entry.error,signal:entry.signal};
  };
  const mocks={'node:child_process':{spawn:()=>{executions++;throw new Error('EXECUTION_NOT_PERMITTED_IN_FIXTURE');},spawnSync},
    'node:crypto':{createHash},'node:fs':fs,'node:path':{dirname:win32.dirname,join:win32.join},
    '../shared/agents/stephanosNativeCapacityGamingAdmissionV1.mjs':{inspectStephanosNativeCapacityGamingAdmissionV1:()=>({ok:true})},
    '../shared/agents/battleBridgeExecutionBoundaryV1.mjs':{createBattleBridgeMinimalChildEnvironment:()=>({})}};
  const module=new vm.SourceTextModule(source,{context});
  await module.link(specifier=>{
    const values=mocks[specifier];assert.ok(values,specifier);
    return new vm.SyntheticModule(Object.keys(values),function(){
      for(const [key,value]of Object.entries(values))this.setExport(key,value);
    },{context});
  });
  await module.evaluate();
  const api=module.namespace,result=api.inspectFixedRuntimeQualificationV1();
  assert.equal(result.ok,entry.ok===true,entry.name);
  assert.equal(Object.isFrozen(result),true,entry.name);
  assert.equal(inspections,entry.expectedInspections??1,entry.name);
  assert.equal(JSON.stringify(result).includes(privateText),false,entry.name);
  assert.equal(Object.hasOwn(result,'stdout'),false,entry.name);
  assert.equal(Object.hasOwn(result,'stderr'),false,entry.name);
  if(entry.ok) {
    assert.equal(result.sourceHead,head,entry.name);
    assert.equal(result.dispatchAllowed,true,entry.name);
  } else {
    assert.equal(result.reason,entry.reason,entry.name);
    assert.equal(result.dispatchAllowed,false,entry.name);
    assert.equal(result.taskExecuted,false,entry.name);
    assert.equal(result.taskRootCreated,false,entry.name);
    const attempted=await api.executeFixedMaintenanceRuntimeV1(result,
      {requestId:'inspection-fixture-123',sourceHead:head,custodyRecordSha256:custody,nativeRecordId:27},
      {onPrepared:()=>true});
    assert.equal(attempted.reason,'FIXED_RUNTIME_FRESH_QUALIFICATION_REQUIRED',entry.name);
    assert.equal(attempted.dispatchAllowed,false,entry.name);
  }
  assert.equal(executions,0,entry.name);
}
console.log(JSON.stringify({schemaVersion:'stephanos.isolated-inspection-diagnostics-fixture.v1',
  cases:cases.length,nativeExecuted:false,productionQualification:false}));
