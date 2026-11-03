import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { FRESH_HOST_OPERATION_SCHEMA as schema,validateFreshHostOperation,
  runFreshCanonicalHostOperation,executeFreshCanonicalHostOperation } from './stephanos-codex-dispatch-host-operation-v1.mjs';
const head='a'.repeat(40),next='b'.repeat(40),args={operatorApproval:'operator-approved',expectedBranch:'main'};
const repoRoot=resolve(process.env.USERPROFILE||homedir(),'Documents','GitHub','stephan-os');
test('host adapter accepts only the existing two fixed operations and existing bounded preservation profile',()=>{
  assert.equal(validateFreshHostOperation('sync',args).expectedBranch,'main');
  for(const op of ['sync','update']) for(const patch of [{command:'anything'},{repoRoot:'other'},{expectedHead:head},{expectedBranch:'feature'},{operatorApproval:'yes'}]) assert.throws(()=>validateFreshHostOperation(op,{...args,...patch}));
  for(const op of ['merge','shell','restart']) assert.throws(()=>validateFreshHostOperation(op,args));
  assert.throws(()=>validateFreshHostOperation('update',{...args,preservationProfile:'battle-bridge-runtime-data-v1'}));
  assert.throws(()=>validateFreshHostOperation('sync',{...args,preservationProfile:'caller-selected',preservationApproval:'operator-approved'}));
});
test('MCP adapter invokes only a fixed fresh Node child without shell or caller paths',()=>{
  const calls=[];const value={ok:true,hostOperationAdapter:schema,hostOperationProcessSourceHead:head,operation:'sync'};
  const result=runFreshCanonicalHostOperation('sync',args,{spawnSyncFn:(exe,argv,options)=>{calls.push({exe,argv,options});return{status:0,stdout:JSON.stringify(value)}}});
  assert.equal(result.ok,true);assert.equal(calls[0].exe,process.execPath);assert.equal(calls[0].options.shell,false);assert.equal(calls[0].options.windowsHide,true);
  assert.match(calls[0].argv[0],/stephanos-codex-dispatch-host-operation-v1.mjs$/);assert.equal(calls[0].argv[1],'sync');
  assert.deepEqual(JSON.parse(Buffer.from(calls[0].argv[2],'base64url')),args);
  assert.equal(calls[0].options.env.NODE_OPTIONS,undefined);
  assert.equal(calls[0].options.env.NODE_PATH,undefined);
  assert.equal(calls[0].options.env.GIT_DIR,undefined);
  assert.equal(calls[0].options.env.GIT_WORK_TREE,undefined);
  assert.equal(calls[0].options.env.GIT_NO_REPLACE_OBJECTS,'1');
});
test('child exit, malformed output, stale identity and operation substitution cannot claim successful source adoption',()=>{
  const value={ok:true,hostOperationAdapter:schema,hostOperationProcessSourceHead:head,operation:'sync'};
  for(const response of [{status:1,stdout:JSON.stringify(value)},{status:0,stdout:'unknown'},
    {status:0,stdout:JSON.stringify({...value,operation:'update'})},{status:0,stdout:JSON.stringify({...value,hostOperationProcessSourceHead:'main'})},
    {error:Error('timeout'),status:null,stdout:''}]) assert.equal(runFreshCanonicalHostOperation('sync',args,{spawnSyncFn:()=>response}).ok,false);
  const held={...value,ok:false,blocker:'MAILBOX_ROTATION_SYNC_PREDECESSOR_PENDING'};
  assert.equal(runFreshCanonicalHostOperation('sync',args,{spawnSyncFn:()=>({status:1,stdout:JSON.stringify(held)})}).blocker,held.blocker);
});
test('fresh child proves unchanged source around import before invoking the existing host implementation',async()=>{
  const observed=[];
  const result=await executeFreshCanonicalHostOperation('sync',args,{platform:'win32',repoRoot,readHead:()=>head,
    loadHostOps:async()=>({syncCodexDispatchBridge: input=>{observed.push(input);return{ok:true,afterHead:next}}})});
  assert.equal(result.hostOperationProcessSourceHead,head);assert.equal(result.afterHead,next);assert.deepEqual(observed,[args]);
});
test('a source change during import, a foreign checkout or non-Windows host blocks before the implementation can run',async()=>{
  let calls=0,reads=0;
  const options={platform:'win32',repoRoot,readHead:()=>++reads===1?head:next,loadHostOps:async()=>({syncCodexDispatchBridge:()=>{calls++;return{ok:true}}})};
  await assert.rejects(executeFreshCanonicalHostOperation('sync',args,options),/SOURCE_CHANGED_DURING_IMPORT/);assert.equal(calls,0);
  await assert.rejects(executeFreshCanonicalHostOperation('sync',args,{...options,platform:'linux'}),/CANONICAL_WINDOWS/);
  await assert.rejects(executeFreshCanonicalHostOperation('sync',args,{...options,repoRoot:resolve(repoRoot,'other')}),/CANONICAL_WINDOWS/);
});
test('each operation loads the existing host implementation anew rather than reusing a cached MCP authority module',async()=>{
  let loads=0;
  for(const processHead of [head,next]) {
    const result=await executeFreshCanonicalHostOperation('update',args,{platform:'win32',repoRoot,readHead:()=>processHead,
      loadUpdate:async()=>{loads++;return{updateStephanosFromChat:()=>({ok:true})}}});
    assert.equal(result.hostOperationProcessSourceHead,processHead);
  }
  assert.equal(loads,2);
  const source=readFileSync(new URL('./stephanos-codex-dispatch-mcp.mjs',import.meta.url),'utf8');
  assert.match(source,/syncCodexDispatchBridge: args => runFreshCanonicalHostOperation\('sync',args\)/);
  assert.match(source,/updateStephanosFromChat: args => runFreshCanonicalHostOperation\('update',args\)/);
  assert.match(source,/mcpProcessServerSourceSha256: processAttachmentIdentity.serverSourceSha256/);
});
