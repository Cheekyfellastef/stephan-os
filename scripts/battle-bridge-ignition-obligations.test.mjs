import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  executePostSyncRefreshPlan, buildPostSyncRefreshProjection,
  classifyPostSyncRefresh,
  projectPostSyncRemainingIgnitionObligationsV1, projectIgnitionSettledRefreshEvidenceV1,
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
  return {...collectPostSyncRefreshDebt({syncRecord:records.sync,refreshRecord:records.refresh}),
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
