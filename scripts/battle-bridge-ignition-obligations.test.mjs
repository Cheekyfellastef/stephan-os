import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveBattleBridgeGitExecution, battleBridgeCanonicalRepositoryArgs } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import {
  executePostSyncRefreshPlan, buildPostSyncRefreshProjection,
  classifyPostSyncRefresh,
  projectPostSyncRemainingIgnitionObligationsV1, projectIgnitionSettledRefreshEvidenceV1,
  projectIgnitionInertEvidenceV1, projectIgnitionPreflightResultV1,
} from '../shared/agents/postSyncRuntimeRefreshCoordinator.mjs';
import { collectPostSyncRefreshDebt } from './battle-bridge-github-sync-policy.mjs';
import { runBattleBridgeIgnitionSyncPreflight } from './battle-bridge-ignition-sync-preflight.mjs';
import { runBattleBridgeSyncAndRefresh, createFixedSyncAndRefreshAdapter } from './battle-bridge-github-sync-and-refresh.mjs';
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40);
const plugin='plugins/sovereign-commander/plugin.json';
const governor='scripts/windows/run-vr-resource-governor.ps1';
const spatial='scripts/spatial-window-host.mjs';
const relay='scripts/control-tower-build-consumer-v1.mjs';
const commander='scripts/sovereign-commander-http.mjs';
const natural='scripts/qwen35-canary.mjs';
const custody='SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN';
const pass=()=>({ok:true,exactHeadProofOk:true,sourceHead:B,blocker:''});
const governorProof=()=>({schemaVersion:'stephanos.post-sync-governor-proof.v1',watchdogSucceeded:true,
  normalOperatorObserved:true,healthy:true,inventoryComplete:true,processCount:1,identityVerified:true,
  progressVerified:true,currentSourceVerified:true,sourceHead:B,sourceHeadMatchesLive:true,sourceSha256:'a'.repeat(64),blocker:''});
const relayProof=()=>({schemaVersion:'stephanos.post-sync-sovereign-relay-proof.v1',watchdogSucceeded:true,
  healthy:true,sourceHead:B,sourceHeadMatchesLive:true,processCount:1,heartbeatAgeSeconds:1,blocker:''});
function adapters(mode='plugin') {
  return {refreshUi:async()=>pass(),proveVrAtlas:async()=>pass(),restartBackend:async()=>pass(),
    restartMissionWorker:async()=>pass(),restartGitHubMailbox:async()=>pass(),confirmNaturalReload:async()=>pass(),
    refreshSovereignCommander:async()=>mode==='custody'
      ? {ok:false,exactHeadProofOk:false,sourceHead:B,blocker:custody}
      : {...pass(),governorProof:governorProof(),sovereignRelayProof:relayProof()}};
}
const wrapper=refresh=>({ok:false,blocker:refresh.blocker,sourceHead:B,syncClassification:'SYNC_NO_CHANGE',
  refreshes:[{beforeHead:A,afterHead:B,result:refresh}],finalVerdict:'SYNC_AND_REFRESH_BLOCKED'});
const preflight=result=>runBattleBridgeIgnitionSyncPreflight({platform:'win32',repoRoot:'C:/fixture/canonical',
  canonicalRepoRoot:'C:/fixture/canonical',syncAndRefreshFn:async()=>result});
async function compose(paths,mode='plugin') {
  const execution=await executePostSyncRefreshPlan({beforeHead:A,afterHead:B,changedPaths:paths,adapters:adapters(mode)});
  const refresh=buildPostSyncRefreshProjection(execution,{beforeHead:A,afterHead:B});
  return {execution,refresh,result:await preflight(wrapper(refresh))};
}

test('real producer-to-preflight cross-product waives only the declared sole optional obligation',async()=>{
  let cases=0;
  for(const mode of ['plugin','custody'])for(const gov of [false,true])for(const rel of [false,true])
    for(const spa of [false,true])for(const nat of [false,true])for(const unknown of ['none','unknown','unsafe']){
      const paths=[mode==='plugin'?plugin:commander,...(gov?[governor]:[]),...(rel?[relay]:[]),
        ...(spa?[spatial]:[]),...(nat?[natural]:[]),...(unknown==='unknown'?['scripts/unreviewed-obligation.mjs']:[]),
        ...(unknown==='unsafe'?['../escape.mjs']:[])];
      const {refresh,result}=await compose(paths,mode);
      const expected=unknown==='none'&&!spa&&(mode==='plugin'||(!gov&&!rel&&!nat));
      assert.equal(result.ok,expected,JSON.stringify({mode,gov,rel,spa,nat,unknown,refreshBlocker:refresh.blocker}));
      cases++;
    }
  assert.equal(cases,96);
});

test('transitive evidence snapshot is bounded inert own data and never invokes caller behavior',()=>{
  const nested={row:{value:'ok'},rows:[{flag:true}]};
  Object.defineProperty(nested.row,'hiddenRequired',{value:true,enumerable:false});
  const snapshot=projectIgnitionInertEvidenceV1(nested);
  assert.equal(Object.getPrototypeOf(snapshot),null);
  assert.equal(Object.getPrototypeOf(snapshot.row),null);
  assert.equal(Object.keys(snapshot.row).includes('hiddenRequired'),true);
  assert(Object.isFrozen(snapshot)&&Object.isFrozen(snapshot.row)&&Object.isFrozen(snapshot.rows)&&Object.isFrozen(snapshot.rows[0]));
  assert.notEqual(snapshot.rows,nested.rows);
  let accesses=0;
  const poison=new Proxy({},{getPrototypeOf(){accesses++;throw Error('proxy');},ownKeys(){accesses++;throw Error('proxy');},get(){accesses++;throw Error('proxy');}});
  const accessor={};Object.defineProperty(accessor,'value',{get(){accesses++;return true;}});
  const cycle={};cycle.self=cycle;
  const sparse=[];sparse.length=1;
  const extra=[];Object.defineProperty(extra,'hiddenRequired',{value:true});
  const symbol={};symbol[Symbol('authority')]=true;
  let deep={};for(let index=0;index<18;index++)deep={child:deep};
  for(const input of [poison,{nested:poison},accessor,{nested:accessor},cycle,sparse,extra,symbol,
    {nested:Object.create({inherited:true})},{number:NaN},{number:Infinity},{value:undefined},{value:()=>true},
    {value:1n},{value:'x'.repeat(128*1024+1)},Array(257).fill(false),deep])assert.equal(projectIgnitionInertEvidenceV1(input),null);
  assert.equal(accesses,0);
});

async function scopedRecords(){
  const execution=await executePostSyncRefreshPlan({beforeHead:A,afterHead:B,changedPaths:[governor,relay],adapters:adapters()});
  return {sync:(await canonicalRecords()).sync,refresh:{...buildPostSyncRefreshProjection(execution,{beforeHead:A,afterHead:B}),
    schemaVersion:'shared-agent-workspace-record.v1',kind:'stephanos.shared_workspace.status',statusId:'post-sync-runtime-refresh-current',phase:'complete'}};
}
const at=(root,keys)=>keys.reduce((row,key)=>row[key],root);
const replaceAt=(root,keys,value)=>{const parent=at(root,keys.slice(0,-1));parent[keys.at(-1)]=value;};

test('every nested settled witness array is normalized before canonical consumers and output',async()=>{
  const witness=(await auxiliary(await scopedRecords())).result.settledRefreshEvidence;
  assert(witness);
  for(const keys of [['ancestry'],['refreshCompletionRecord','targetIds'],['refreshCompletionRecord','resultTargets']]){
    let accesses=0;
    const input=structuredClone(witness),array=at(input,keys),prototype=Object.create(Array.prototype);
    for(const method of ['map','some','find','every','includes','slice','at','constructor',Symbol.iterator])
      Object.defineProperty(prototype,method,{get(){accesses++;return Array.prototype[method];}});
    Object.setPrototypeOf(array,prototype);
    const projected=projectIgnitionSettledRefreshEvidenceV1(input,B);
    assert(projected,keys.join('.'));
    assert.equal(accesses,0,keys.join('.'));
    assert.notEqual(at(projected,keys),array);
    assert(Object.isFrozen(at(projected,keys)));
  }
});

test('nested witness rows proofs and arrays reject accessors and proxies without side effects',async()=>{
  const witness=(await auxiliary(await scopedRecords())).result.settledRefreshEvidence;
  const paths=[[],['syncStatusRecord'],['refreshCompletionRecord'],['ancestry'],['ancestry',0],
    ['refreshCompletionRecord','targetIds'],['refreshCompletionRecord','resultTargets'],
    ['refreshCompletionRecord','resultTargets',0],['refreshCompletionRecord','resultTargets',0,'governorProof'],
    ['refreshCompletionRecord','resultTargets',0,'sovereignRelayProof']];
  let accesses=0;
  for(const keys of paths){
    const input=structuredClone(witness),value=at(input,keys);
    const proxy=new Proxy(value,{get(){accesses++;throw Error('proxy');},ownKeys(){accesses++;throw Error('proxy');},getPrototypeOf(){accesses++;throw Error('proxy');}});
    if(keys.length)replaceAt(input,keys,proxy);
    assert.equal(projectIgnitionSettledRefreshEvidenceV1(keys.length?input:proxy,B),null,keys.join('.'));
    const own=structuredClone(witness),row=at(own,keys);
    Object.defineProperty(row,Array.isArray(row)?'0':'hiddenRequired',{get(){accesses++;return true;},enumerable:false,configurable:true});
    assert.equal(projectIgnitionSettledRefreshEvidenceV1(own,B),null,keys.join('.'));
  }
  assert.equal(accesses,0);
});

test('preflight consumes normalized optional-hold arrays and ignores irrelevant child execution payloads',async()=>{
  for(const mode of ['plugin','custody']){
    const base=(await compose([mode==='plugin'?plugin:commander],mode)).refresh;
    for(const field of ['targetIds','resultTargets']){
      const input=structuredClone(base),prototype=Object.create(Array.prototype);let accesses=0;
      for(const method of ['map','some','find','every','includes','slice','at',Symbol.iterator])
        Object.defineProperty(prototype,method,{get(){accesses++;return Array.prototype[method];}});
      Object.setPrototypeOf(input[field],prototype);
      const framed=wrapper(input);framed.refreshes[0].execution={stdout:'x'.repeat(512*1024)};
      assert.equal((await preflight(framed)).ok,true,mode+':'+field);
      assert.equal(accesses,0);
      assert(projectIgnitionPreflightResultV1(framed));
    }
    const input=wrapper(structuredClone(base));let accesses=0;
    Object.defineProperty(input.refreshes[0],'result',{get(){accesses++;return base;}});
    assert.equal((await preflight(input)).ok,false);assert.equal(accesses,0);
  }
});

test('wrapper re-derives settled debt from normalized records and never trusts reader summaries',async()=>{
  const records=await scopedRecords();let accesses=0;
  const proto=Object.create(Array.prototype);Object.defineProperty(proto,'map',{get(){accesses++;return Array.prototype.map;}});
  Object.setPrototypeOf(records.refresh.resultTargets,proto);
  assert.equal((await auxiliary(records)).output.ok,true);
  assert.equal(accesses,0);
  const input=structuredClone(records);
  Object.defineProperty(input.refresh.resultTargets[0].governorProof,'healthy',{get(){accesses++;return true;}});
  assert.equal((await auxiliary(input)).output.ok,false);
  assert.equal(accesses,0);
});

test('HEAD and ancestry reuse one fixed Git environment repository and bounded parent allowance',()=>{
  const old=process.env.GIT_DIR;process.env.GIT_DIR='C:/adversarial/other/.git';
  try{
    const calls=[];const adapter=createFixedSyncAndRefreshAdapter({spawnSyncFn:(exe,args,options)=>{calls.push({exe,args,options});return {status:0,stdout:args.includes('rev-parse')?B+'\n':''};}});
    assert.equal(adapter.observeCurrentHead('C:/fixture/canonical',{timeoutMs:23}).ok,true);
    process.env.GIT_DIR='C:/changed/after-capture/.git';
    assert.equal(adapter.isAncestor(A,B,'C:/fixture/canonical',{timeoutMs:17}).ancestor,true);
    assert.equal(calls.length,2);
    assert.equal(calls[0].exe,calls[1].exe);assert(path.isAbsolute(calls[1].exe));
    assert.equal(calls[0].options.env,calls[1].options.env);
    assert.equal(Object.hasOwn(calls[1].options.env,'GIT_DIR'),false);
    assert.equal(calls[1].options.env.GIT_NO_REPLACE_OBJECTS,'1');
    assert.deepEqual(calls[0].args.slice(0,-3),calls[1].args.slice(0,-4));
    assert.equal(calls[0].options.timeout,23);assert.equal(calls[1].options.timeout,17);
    assert.equal(adapter.isAncestor(A,B,'C:/fixture/foreign',{timeoutMs:17}).ok,false);
    assert.equal(adapter.observeCurrentHead('C:/fixture/foreign',{timeoutMs:23}).ok,false);
    assert.equal(adapter.isAncestor(A,B,'C:/fixture/canonical',{timeoutMs:0}).ok,false);
    assert.equal(calls.length,2);
    for(const result of [{status:0,signal:'SIGTERM'},{status:0,error:{code:'ETIMEDOUT'}},{status:2}]){
      const rejected=createFixedSyncAndRefreshAdapter({spawnSyncFn:()=>result});
      assert.equal(rejected.isAncestor(A,B,'C:/fixture/canonical',{timeoutMs:17}).ok,false);
    }
  }finally{if(old===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=old;}
});

test('malformed nested pending and fresh child authority stays a typed hold without getter execution',async()=>{
  let accesses=0;
  const proxy=new Proxy({},{get(){accesses++;throw Error('proxy');},ownKeys(){accesses++;throw Error('proxy');},getPrototypeOf(){accesses++;throw Error('proxy');}});
  const sparse=[];sparse.length=1;
  for(const pending of [{ok:true,spans:proxy},{ok:true,spans:sparse}]){
    const paths={repoRoot:'C:/fixture/canonical',workspaceRoot:'C:/fixture/workspace'};
    const result=await runBattleBridgeSyncAndRefresh({paths,expectedPaths:paths,platform:'linux',pendingReader:async()=>pending,
      adapter:{runSync:()=>({ok:true,result:{ok:true,evaluation:{classification:'SYNC_NO_CHANGE'},facts:{localHead:B,remoteHead:B}}}),
        runRefresh(){assert.fail('invalid debt cannot execute refresh');}}});
    assert.equal(result.ok,false);assert.equal(result.blocker,'PENDING_POST_SYNC_EVIDENCE_INVALID');
  }
  for(const field of ['sourceHead','syncClassification','blocker','finalVerdict']){
    const input={ok:true,sourceHead:B,syncClassification:'SYNC_NO_CHANGE',finalVerdict:'SYNC_AND_REFRESH_PASS',[field]:{value:B}};
    assert.equal((await preflight(input)).ok,false);
  }
  const malformedPath=new Proxy([],{get(){accesses++;throw Error('proxy');},ownKeys(){accesses++;throw Error('proxy');}});
  assert.equal(projectIgnitionInertEvidenceV1({value:true},malformedPath),null);
  for(const malformed of [{ok:'false'},{ok:true,blocker:{}},{ok:true,execution:{status:'0',errorCode:''}},{ok:true,execution:{status:0,errorCode:{}}}]){
    const paths={repoRoot:'C:/fixture/canonical',workspaceRoot:'C:/fixture/workspace'};
    const result=await runBattleBridgeSyncAndRefresh({paths,expectedPaths:paths,platform:'linux',pendingReader:async()=>null,
      adapter:{runSync:()=>({...malformed,result:{ok:true,evaluation:{classification:'SYNC_NO_CHANGE'},facts:{localHead:B,remoteHead:B}}})}});
    assert.equal(result.ok,false);assert.equal(result.blocker,'SYNC_AND_REFRESH_OWNER_EVIDENCE_INVALID');
  }
  for(const pendingRefresh of [{},{schemaVersion:'stephanos.post-sync-refresh-debt.v1',state:'PENDING',spans:[{}],requiredTargetIds:[]}]){
    const paths={repoRoot:'C:/fixture/canonical',workspaceRoot:'C:/fixture/workspace'};
    const result=await runBattleBridgeSyncAndRefresh({paths,expectedPaths:paths,platform:'linux',pendingReader:async()=>null,
      adapter:{runSync:()=>({ok:true,result:{ok:true,evaluation:{classification:'SYNC_NO_CHANGE'},facts:{localHead:B,remoteHead:B,pendingRefresh}}})}});
    assert.equal(result.ok,false);assert.equal(result.blocker,'PENDING_POST_SYNC_DEBT_INVALID');
  }
  assert.equal(accesses,0);
});

test('fresh child completion reaches canonical inspectors only as a normalized graph',async()=>{
  const records=await scopedRecords(),refresh={...records.refresh,ok:true};let accesses=0,syncCalls=0;
  const prototype=Object.create(Array.prototype);Object.defineProperty(prototype,'map',{get(){accesses++;return Array.prototype.map;}});
  Object.setPrototypeOf(refresh.resultTargets,prototype);
  const paths={repoRoot:'C:/fixture/canonical',workspaceRoot:'C:/fixture/workspace'};
  const result=await runBattleBridgeSyncAndRefresh({paths,expectedPaths:paths,platform:'linux',pendingReader:async()=>null,
    capacityObservationHeartbeat:async()=>({ok:true,capacityObservationOnly:true}),goalDiscoveryHeartbeat:async()=>({ok:true}),
    adapter:{runSync:()=>({ok:true,result:++syncCalls===1?{ok:true,sourceUpdated:true,evaluation:{classification:'BLOCKED_POST_SYNC_REFRESH_REQUIRED'},facts:{localHeadBefore:A,localHeadAfter:B,remoteHead:B}}:
      {ok:true,evaluation:{classification:'SYNC_NO_CHANGE'},facts:{localHead:B,remoteHead:B}}}),
      runRefresh:()=>({ok:true,result:refresh}),isAncestor:(before,after)=>({ok:true,ancestor:before<=after})}});
  assert.equal(result.ok,true);assert.equal(accesses,0);
  assert.notEqual(result.refreshes[0].result.resultTargets,refresh.resultTargets);
});

test('ancestry retains its cumulative five-second allowance without resetting the parent deadline',()=>{
  const original=Date.now;let now=10000,calls=0;
  Date.now=()=>now;
  try{
    const adapter=createFixedSyncAndRefreshAdapter({spawnSyncFn:(_exe,_args,options)=>{calls++;assert(options.timeout<=1000);now+=1001;return {status:0,stdout:''};}});
    for(let index=0;index<5;index++)assert.equal(adapter.isAncestor(A,B,'C:/fixture/canonical',{timeoutMs:1000}).ok,true);
    assert.equal(adapter.isAncestor(A,B,'C:/fixture/canonical',{timeoutMs:1000}).ok,false);assert.equal(calls,5);
  }finally{Date.now=original;}
});

test('closed sync frame preserves exact busy-refusal semantics and excludes unused large diagnostics',async()=>{
  const busy=()=>({ok:false,evaluation:{classification:'BLOCKED_INSTALL_OR_PERMISSION_REQUIRED',exactNextAction:'SYNC_ALREADY_RUNNING',
    performsGitMutation:false,performsShellExecution:false},lock:{ok:false,reason:'SYNC_ALREADY_RUNNING'},publication:null});
  for(const [label,mutate,retry] of [['exact',()=>{},true],['nonnull publication',v=>{v.publication={receipt:'exists'};},false],
    ['false publication',v=>{v.publication=false;},false],['missing publication',v=>{delete v.publication;},false],
    ['unknown key',v=>{v.extra={stdout:'x'.repeat(512*1024)};},false],['mutation',v=>{v.evaluation.performsGitMutation=true;},false],
    ['wrong mutation type',v=>{v.evaluation.performsShellExecution='false';},false]]){
    let calls=0,clock=0;const paths={repoRoot:'C:/fixture/canonical',workspaceRoot:'C:/fixture/workspace'},refusal=busy();mutate(refusal);
    const result=await runBattleBridgeSyncAndRefresh({paths,expectedPaths:paths,platform:'linux',pendingReader:async()=>null,
      nowMs:()=>clock,sleepFn:async milliseconds=>{clock+=milliseconds;},
      capacityObservationHeartbeat:async()=>({ok:true,capacityObservationOnly:true}),goalDiscoveryHeartbeat:async()=>({ok:true}),
      adapter:{runSync:()=>({ok:true,result:++calls===1?refusal:{ok:true,evaluation:{classification:'SYNC_NO_CHANGE'},facts:{localHead:B,remoteHead:B}}})}});
    assert.equal(calls,retry?2:1,label);assert.equal(result.ok,retry,label);
  }
  const paths={repoRoot:'C:/fixture/canonical',workspaceRoot:'C:/fixture/workspace'};
  const result=await runBattleBridgeSyncAndRefresh({paths,expectedPaths:paths,platform:'linux',pendingReader:async()=>null,
    capacityObservationHeartbeat:async()=>({ok:true,capacityObservationOnly:true}),goalDiscoveryHeartbeat:async()=>({ok:true}),
    adapter:{runSync:()=>({ok:true,result:{ok:true,evaluation:{classification:'SYNC_NO_CHANGE'},facts:{localHead:B,remoteHead:B},
      fetchResult:{stdout:'x'.repeat(512*1024)},heartbeat:{unrelated:'x'.repeat(512*1024)}},execution:{stdout:'x'.repeat(512*1024),status:0,errorCode:''}})}});
  assert.equal(result.ok,true);
});

test('actual fixed Git ignores PATH and inherited alternate repository/config during HEAD and ancestry proof',()=>{
  const git=resolveBattleBridgeGitExecution({platform:process.platform,environment:process.env});
  const root=mkdtempSync(path.join(tmpdir(),'stephanos-inert-git-')),repo=path.join(root,'canonical'),decoy=path.join(root,'decoy'),shadow=path.join(root,'shadow');
  for(const directory of [repo,decoy,shadow])mkdirSync(directory);
  const command=(directory,args)=>{const result=spawnSync(git.executable,[...git.fixedConfigArgs,...battleBridgeCanonicalRepositoryArgs(directory),...args],
    {cwd:directory,env:git.environment,encoding:'utf8',shell:false,windowsHide:true,timeout:10000});assert.equal(result.status,0,result.stderr);assert(!result.error&&!result.signal);return result.stdout.trim();};
  for(const directory of [repo,decoy]){command(directory,['init']);writeFileSync(path.join(directory,'source.txt'),directory===repo?'first\n':'decoy\n');command(directory,['add','source.txt']);command(directory,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','first']);}
  const first=command(repo,['rev-parse','--verify','HEAD']);writeFileSync(path.join(repo,'source.txt'),'second\n');command(repo,['add','source.txt']);command(repo,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','second']);
  const second=command(repo,['rev-parse','--verify','HEAD']),marker=path.join(root,'shadow-executed');
  writeFileSync(path.join(shadow,'git.cmd'),'@echo shadow>'+marker+'\r\n@exit /b 23\r\n');
  const keys=['PATH','GIT_DIR','GIT_WORK_TREE','GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0'],saved=new Map(keys.map(key=>[key,process.env[key]]));
  try{
    process.env.PATH=shadow;process.env.GIT_DIR=path.join(decoy,'.git');process.env.GIT_WORK_TREE=decoy;
    process.env.GIT_CONFIG_COUNT='1';process.env.GIT_CONFIG_KEY_0='core.worktree';process.env.GIT_CONFIG_VALUE_0=decoy;
    const adapter=createFixedSyncAndRefreshAdapter();
    assert.deepEqual(adapter.observeCurrentHead(repo,{timeoutMs:1000}),{ok:true,head:second});
    assert.deepEqual(adapter.isAncestor(first,second,repo,{timeoutMs:1000}),{ok:true,ancestor:true});
    assert.equal(existsSync(marker),false);
  }finally{for(const [key,value]of saved)if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

test('complete retained 818-path corpus cannot become a plugin-only degraded startup',async()=>{
  const corpus=JSON.parse(readFileSync(new URL('../tests/fixtures/post-sync-native-build-retained-delta-v1.json',import.meta.url),'utf8'));
  assert.equal(corpus.paths.length,818);
  const {refresh,result}=await compose(corpus.paths);
  assert.equal(refresh.spatialAdoptionRequired,true);
  assert.equal(refresh.pluginHostActivationRequired,true);
  assert.equal(refresh.governorRefreshRequired,true);
  assert.equal(refresh.sovereignRelayRefreshRequired,true);
  assert.equal(result.ok,false);
});

test('missing malformed contradictory or stale authority cannot be waived even when a plugin blocker looks optional',async()=>{
  const base=(await compose([plugin])).refresh;
  assert.equal((await preflight(wrapper(base))).ok,true);
  const mutations=[
    value=>{delete value.governorRefreshRequired;},value=>{delete value.spatialAdoptionRequired;},
    value=>{delete value.sovereignRelayRefreshRequired;},value=>{delete value.unknownPathCount;},
    value=>{value.governorRefreshRequired='false';},value=>{value.unknownPathCount=1;},
    value=>{value.unsafePathCount=1;},value=>{value.openClawPathCount=1;},
    value=>{value.spatialAdoptionPathCount=1;value.spatialAdoptionRequired=false;},
    value=>{value.afterHead=A;},value=>{value.beforeHead=value.afterHead;},
    value=>{value.futureActivationRequired=true;},value=>{value.futurePathCount=1;},
    value=>{value.ok=true;},value=>{value.schemaVersion='shared-agent-workspace-record.v1';value.statusId='foreign-owner';},
    value=>{value.targetIds.push('new-unqualified-owner');},
    value=>{value.resultTargets[0].sourceHead=A;},value=>{value.resultTargets=[];},
    value=>{value.resultTargets[0].governorProof={...governorProof(),sourceHead:A};},
    value=>{value.resultTargets[0].sovereignRelayProof={...relayProof(),processCount:2};},
    value=>{value.resultTargets[0].governorProof=null;},
  ];
  for(const mutate of mutations){const input=structuredClone(base);mutate(input);assert.equal((await preflight(wrapper(input))).ok,false,mutate.toString());}
  let accessed=false;
  for(const field of ['governorProof','sovereignRelayProof']){
    const input=structuredClone(base);
    const proof=field==='governorProof'?governorProof():relayProof();
    Object.defineProperty(proof,'healthy',{get(){accessed=true;return true;},enumerable:true});
    input.resultTargets[0][field]=proof;
    assert.equal(projectPostSyncRemainingIgnitionObligationsV1(input,B),null);
  }
  assert.equal(accessed,false);
});

test('the complete six-path repair rollout keeps every existing activation owner',()=>{
  const paths=['shared/agents/postSyncRuntimeRefreshCoordinator.mjs','scripts/battle-bridge-ignition-sync-preflight.mjs',
    'scripts/battle-bridge-github-sync-and-refresh.mjs','scripts/battle-bridge-ignition-sync-preflight.test.mjs',
    'scripts/battle-bridge-ignition-obligations.test.mjs','docs/architecture/ignition-source-activation-routing.md'];
  const plan=classifyPostSyncRefresh(paths);
  assert.equal(plan.unknownPathCount,0);
  assert.equal(plan.classification,'REFRESH_READY');
  assert.deepEqual(plan.targetIds,['github-command-mailbox','natural-reload']);
});

async function canonicalRecords(){
  const execution=await executePostSyncRefreshPlan({beforeHead:A,afterHead:B,changedPaths:['docs/verified-source.md']});
  const refresh={...buildPostSyncRefreshProjection(execution,{beforeHead:A,afterHead:B}),
    schemaVersion:'shared-agent-workspace-record.v1',kind:'stephanos.shared_workspace.status',
    statusId:'post-sync-runtime-refresh-current',phase:'complete'};
  const sync={schemaVersion:'shared-agent-workspace-record.v1',kind:'stephanos.shared_workspace.status',
    statusId:'battle-bridge-github-sync-current',classification:'SYNC_NO_CHANGE',localHeadBefore:B,
    remoteHeadObserved:B,pendingRefresh:null};
  return {sync,refresh};
}
function observed(records){
  return {...collectPostSyncRefreshDebt({syncRecord:projectIgnitionInertEvidenceV1(records.sync),refreshRecord:projectIgnitionInertEvidenceV1(records.refresh)}),
    syncStatusRecord:records.sync,completionRecord:records.refresh};
}
async function auxiliary(records,options={}){
  let headReads=0,pendingReads=0;
  const record=records?.sync;
  const paths={repoRoot:'C:/fixture/canonical',workspaceRoot:'C:/fixture/workspace'};
  const result=await runBattleBridgeSyncAndRefresh({paths,expectedPaths:paths,platform:'win32',
    pendingReader:async()=>{pendingReads++;return records?observed(options.rereadRecords&&pendingReads>1?options.rereadRecords:records):null;},
    capacityObservationHeartbeat:async()=>({ok:true,capacityObservationOnly:true}),goalDiscoveryHeartbeat:async()=>({ok:true}),
    controlPlaneReconciler:()=>({ok:false,blocker:'CONTROL_PLANE_FIXED_INSTALLER_FAILED'}),
    adapter:{runSync:()=>({ok:true,result:{ok:true,evaluation:{classification:'SYNC_NO_CHANGE'},
      facts:{localHead:B,remoteHead:B,pendingRefresh:null},...(options.omitPublication?{}:{receipt:{statusRecord:record}})}}),
      isAncestor:(before,after)=>({ok:true,ancestor:before<=after}),
      ...(options.omitHeadObserver?{}:{observeCurrentHead:(_root,{timeoutMs})=>{
        assert(timeoutMs>0&&timeoutMs<=180000);headReads++;return {ok:true,head:options.headRace&&headReads>1?C:B};
      }})}});
  return {result,output:await preflight(result),headReads,pendingReads};
}

test('actual wrapper mints a current-head canonical settled witness before auxiliary-only degradation',async()=>{
  const records=await canonicalRecords();
  const {result,output,headReads,pendingReads}=await auxiliary(records);
  assert.equal(result.ok,false);
  assert.equal(result.finalVerdict,'SYNC_AND_REFRESH_CONTROL_PLANE_REPAIR_BLOCKED');
  assert(result.settledRefreshEvidence);
  assert.equal(headReads,2);
  assert.equal(pendingReads,2);
  assert.equal(output.ok,true);
  assert.equal(output.classification,'IGNITION_SYNC_PREFLIGHT_PASS_CONTROL_PLANE_DEGRADED');
  assert(projectIgnitionSettledRefreshEvidenceV1(result.settledRefreshEvidence,B));
  assert.equal(Object.hasOwn(result.settledRefreshEvidence,'nativeQualified'),false);
});

test('no history missing publication concurrent head advance and reappearing debt stay held',async()=>{
  assert.equal((await auxiliary(null)).output.ok,false);
  const records=await canonicalRecords();
  for(const options of [{omitPublication:true},{omitHeadObserver:true},{headRace:true}]){
    const {result,output}=await auxiliary(records,options);
    assert.equal(result.settledRefreshEvidence,null);
    assert.equal(output.ok,false);
    assert.equal(output.degradationBlocker,'IGNITION_SETTLED_REFRESH_WITNESS_UNPROVEN');
  }
  const held=(await compose([governor],'custody')).refresh;
  const reappeared={sync:records.sync,refresh:{...held,schemaVersion:'shared-agent-workspace-record.v1',
    kind:'stephanos.shared_workspace.status',statusId:'post-sync-runtime-refresh-current',phase:'blocked'}};
  assert.equal((await auxiliary(records,{rereadRecords:reappeared})).output.ok,false);
});

test('canonical settled witness rejects wrong owners stale records malformed ancestry and hidden required debt',async()=>{
  const witness=(await auxiliary(await canonicalRecords())).result.settledRefreshEvidence;
  const mutations=[
    value=>{delete value.syncStatusRecord;},value=>{delete value.refreshCompletionRecord;},
    value=>{value.syncStatusRecord.statusId='another-writer';},value=>{value.syncStatusRecord.remoteHeadObserved=A;},
    value=>{value.syncStatusRecord.pendingRefresh={};},value=>{value.refreshCompletionRecord.afterHead=A;},
    value=>{value.refreshCompletionRecord.statusId='another-refresh';},value=>{delete value.refreshCompletionRecord.governorRefreshRequired;},
    value=>{value.refreshCompletionRecord.spatialAdoptionRequired=true;},value=>{value.ancestry=[];},
    value=>{value.ancestry.push(value.ancestry[0]);},value=>{value.ancestry[0].ancestor='true';},
    value=>{value.ancestry[0].ancestor=!value.ancestry[0].ancestor;},
  ];
  for(const mutate of mutations){const input=structuredClone(witness);mutate(input);assert.equal(projectIgnitionSettledRefreshEvidenceV1(input,B),null,mutate.toString());}
});

test('fixed existing source-head observer rejects unsuccessful extra and multiline output within the parent budget',()=>{
  for(const result of [{status:0,stdout:B+'\n'}, {status:0,stdout:B+'\n'+B+'\n'},
    {status:0,stdout:' '+B}, {status:1,stdout:B}, {status:0,stdout:B,error:new Error('fixture')},
    {status:0,stdout:B,signal:'SIGTERM'}]){
    const calls=[];
    const adapter=createFixedSyncAndRefreshAdapter({spawnSyncFn:(exe,args,options)=>{calls.push({exe,args,options});return result;}});
    const observed=adapter.observeCurrentHead('C:/fixture/canonical',{timeoutMs:25});
    assert.equal(observed.ok,result.status===0&&!result.error&&!result.signal&&result.stdout===B+'\n');
    assert.equal(calls[0].options.shell,false);
    assert.equal(calls[0].options.timeout,25);
    assert.equal(calls[0].options.maxBuffer,256);
    assert.deepEqual(calls[0].args.slice(-3),['rev-parse','--verify','HEAD']);
  }
});

test('own-data projection refuses inherited authority and array descriptors without invoking prototype getters',async()=>{
  const base=(await compose([plugin])).refresh;
  const witness=(await auxiliary(await canonicalRecords())).result.settledRefreshEvidence;
  assert(projectPostSyncRemainingIgnitionObligationsV1(base,B));
  assert(projectIgnitionSettledRefreshEvidenceV1(witness,B));
  function withPrototype(key,descriptor,run){
    const original=Object.getOwnPropertyDescriptor(Object.prototype,key);
    try{Object.defineProperty(Object.prototype,key,{configurable:true,...descriptor});return run();}
    finally{if(original)Object.defineProperty(Object.prototype,key,original);else delete Object.prototype[key];}
  }
  for(const [key,value] of [['governorRefreshRequired',false],['unknownPathCount',0]]){
    const input=structuredClone(base);delete input[key];
    const observed=withPrototype(key,{value},()=>projectPostSyncRemainingIgnitionObligationsV1(input,B));
    assert.equal(observed,null,key+' must be own data, never inherited');
  }
  let accesses=0;
  const missing=structuredClone(base);delete missing.spatialAdoptionRequired;
  const required=withPrototype('spatialAdoptionRequired',{get(){accesses++;return false;}},
    ()=>projectPostSyncRemainingIgnitionObligationsV1(missing,B));
  assert.equal(required,null);
  assert.equal(accesses,0);
  const nested=structuredClone(witness);delete nested.syncStatusRecord.statusId;
  const owner=withPrototype('statusId',{get(){accesses++;return 'battle-bridge-github-sync-current';}},
    ()=>projectIgnitionSettledRefreshEvidenceV1(nested,B));
  assert.equal(owner,null);
  assert.equal(accesses,0);
  const sparse=structuredClone(base);
  sparse.targetIds=Array(1);
  Object.defineProperty(sparse.targetIds,'extra',{value:'unapproved',enumerable:false});
  const array=withPrototype('0',{get(){accesses++;return {value:'sovereign-commander'};}},
    ()=>projectPostSyncRemainingIgnitionObligationsV1(sparse,B));
  assert.equal(array,null);
  assert.equal(accesses,0);
  const hidden=structuredClone(base);
  Object.defineProperty(hidden,'futureActivationRequired',{value:true,enumerable:false});
  assert.equal(projectPostSyncRemainingIgnitionObligationsV1(hidden,B),null,
    'Copying own data must normalize enumerability so hidden unknown authority stays visible');
});

test('snapshot exact resource bounds and copied graph isolation remain stable',()=>{
  const exactBytes='é'.repeat(65536);
  assert.equal(projectIgnitionInertEvidenceV1(exactBytes),exactBytes);
  assert.equal(projectIgnitionInertEvidenceV1(exactBytes+'a'),null);
  assert.equal(projectIgnitionInertEvidenceV1(Array(256).fill(false)).length,256);
  assert.equal(projectIgnitionInertEvidenceV1(Array(257).fill(false)),null);
  const keys=Object.fromEntries(Array.from({length:128},(_,index)=>['key'+index,false]));
  assert.equal(Object.keys(projectIgnitionInertEvidenceV1(keys)).length,128);
  keys.extra=false;assert.equal(projectIgnitionInertEvidenceV1(keys),null);
  let depth={};for(let index=0;index<16;index++)depth={child:depth};
  assert(projectIgnitionInertEvidenceV1(depth));assert.equal(projectIgnitionInertEvidenceV1({child:depth}),null);
  const nodes=Array.from({length:16},(_,index)=>Array(index===15?239:256).fill(false));
  assert(projectIgnitionInertEvidenceV1(nodes));
  nodes[15].push(false);assert.equal(projectIgnitionInertEvidenceV1(nodes),null);
  const original={row:{value:'before'},rows:[{flag:true}]},snapshot=projectIgnitionInertEvidenceV1(original);
  original.row.value='after';original.rows[0].flag=false;original.rows.push({flag:false});
  assert.equal(snapshot.row.value,'before');assert.equal(snapshot.rows.length,1);assert.equal(snapshot.rows[0].flag,true);
  assert(Object.isFrozen(snapshot)&&Object.isFrozen(snapshot.row)&&Object.isFrozen(snapshot.rows)&&Object.isFrozen(snapshot.rows[0]));
});
