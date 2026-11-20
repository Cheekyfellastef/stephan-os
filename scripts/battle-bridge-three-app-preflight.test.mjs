import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runBattleBridgePostSyncRefresh } from './battle-bridge-post-sync-refresh.mjs';
import { runBattleBridgeIgnitionSyncPreflight } from './battle-bridge-ignition-sync-preflight.mjs';
import { inspectPostSyncRefreshCompletion, collectPostSyncRefreshDebt } from './battle-bridge-github-sync-policy.mjs';
import { IGNITION_SETTLED_REFRESH_SCHEMA_V1, projectIgnitionSettledRefreshEvidenceV1 } from '../shared/agents/postSyncRuntimeRefreshCoordinator.mjs';

const A='a'.repeat(40), B='b'.repeat(40), C='c'.repeat(40);
const scope='THREE_APP_DESKTOP_STARTUP';
const plugin='plugins/sovereign-commander/plugin.json', spatial='scripts/spatial-window-host.mjs';
const pass=()=>({ok:true,exactHeadProofOk:true,sourceHead:B,blocker:''});
const denied=()=>({ok:false,exactHeadProofOk:false,sourceHead:B,blocker:'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN'});

async function actualFrame(t,changedPaths,{adapters={},head=B}={}) {
  const root=await mkdtemp(join(tmpdir(),'three-app-preflight-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const paths={repoRoot:join(root,'repo'),workspaceRoot:join(root,'workspace')};
  await mkdir(paths.repoRoot);
  const result=await runBattleBridgePostSyncRefresh({paths,expectedPaths:paths,beforeHead:A,afterHead:B,
    adapter:{inspectHeads:pass,isAncestor:()=>({ok:true,ancestor:true}),changedPaths:()=>({ok:true,paths:changedPaths}),
      refreshSovereignCommander:pass,confirmNaturalReload:pass,restartApprovedTarget:pass,
      refreshStephanosUi:pass,reconcileControlPlane:pass,...adapters}});
  const statusPath=join(paths.workspaceRoot,'status/post-sync-runtime-refresh-current.json');
  const bytes=await readFile(statusPath,'utf8');
  const frame={ok:result.ok,sourceHead:head,syncClassification:'SYNC_NO_CHANGE',blocker:result.blocker,
    finalVerdict:result.ok?'SYNC_AND_REFRESH_PASS':'SYNC_AND_REFRESH_BLOCKED',refreshes:[{result}]};
  const invoke=extra=>runBattleBridgeIgnitionSyncPreflight({platform:'win32',repoRoot:paths.repoRoot,
    canonicalRepoRoot:paths.repoRoot,syncAndRefreshFn:async()=>frame,startupScope:scope,...extra});
  return {frame,result,paths,bytes,statusPath,invoke};
}

test('ordinary preflight admits the fixed optional native pair while actual producer and global debt stay held',async t=>{
  for(const paths of [[plugin],[spatial],[plugin,spatial]]) {
    const fx=await actualFrame(t,paths);
    const admitted=await fx.invoke();
    assert.equal(admitted.ok,true);
    assert.equal(admitted.startupScope,scope);
    assert.equal(admitted.startupAdmission.admitted,true);
    assert.equal(admitted.startupAdmission.globalRefreshState,'HELD');
    assert.equal(admitted.startupAdmission.nativeCommissioningState,'HELD_UNPROVEN');
    assert.deepEqual(admitted.startupAdmission.mandatoryRemaining,[]);
    assert.deepEqual(admitted.refreshObligations.remaining,admitted.startupAdmission.globalRemaining);
    assert.equal(inspectPostSyncRefreshCompletion(fx.result).ok,false);
    assert(collectPostSyncRefreshDebt({refreshRecord:JSON.parse(fx.bytes)}).spans.length>0);
    assert.equal(await readFile(fx.statusPath,'utf8'),fx.bytes,'preflight does not discharge or rewrite global debt');
    if(paths.length===2)assert.equal((await fx.invoke({startupScope:''})).ok,false,'legacy global decision remains unchanged');
  }
});

test('ordinary preflight never inherits legacy Commander degradation or hides other mandatory effects',async t=>{
  const rows=[
    {paths:[plugin,'scripts/windows/run-vr-resource-governor.ps1']},
    {paths:[plugin,'scripts/control-tower-build-consumer-v1.mjs']},
    {paths:[plugin,'scripts/qwen35-canary.mjs'],adapters:{refreshSovereignCommander:denied}},
    {paths:[plugin,'openclaw/config.json']},
    {paths:[plugin,'scripts/unclassified-three-app-neighbor.mjs']},
    {paths:[plugin,'../escape.mjs']},
    {paths:['scripts/sovereign-commander-http.mjs'],adapters:{refreshSovereignCommander:denied}},
  ];
  for(const row of rows) {
    const fx=await actualFrame(t,row.paths,row);
    const decision=await fx.invoke();
    assert.equal(decision.ok,false,JSON.stringify(row.paths));
    assert.equal(decision.startupScope,scope);
    assert.equal(decision.commanderDegraded,undefined);
    assert(decision.startupAdmission===null||decision.startupAdmission.admitted===false);
  }
  const fx=await actualFrame(t,['scripts/sovereign-commander-http.mjs'],{adapters:{refreshSovereignCommander:denied}});
  assert.equal((await fx.invoke({startupScope:''})).commanderDegraded,true,'the original global API remains compatible');
});

test('ordinary preflight requires coherent current terminal proof, not empty outer success or a caller scope list',async t=>{
  const fx=await actualFrame(t,[plugin,spatial]);
  for(const mutate of [r=>{r.sourceHead=C;},r=>{r.syncClassification='SYNC_FETCH_FAILED';},
    r=>{r.ok=true;r.finalVerdict='SYNC_AND_REFRESH_PASS';},r=>{r.refreshes[0].result.phase='checkpoint';},
    r=>{r.refreshes[0].result.publication={ok:false};},r=>{r.blocker='DIFFERENT_BLOCKER';}]) {
    const frame=structuredClone(fx.frame);mutate(frame);
    const decision=await fx.invoke({syncAndRefreshFn:async()=>frame});
    assert.equal(decision.ok,false);
    assert(decision.startupAdmission===null||decision.startupAdmission.admitted===false);
  }
  assert.equal((await fx.invoke({syncAndRefreshFn:async()=>({ok:true,sourceHead:B,syncClassification:'SYNC_NO_CHANGE',
    finalVerdict:'SYNC_AND_REFRESH_PASS',refreshes:[]})})).ok,false);
  assert.equal((await fx.invoke({startupScope:['desktop-plugin-host']})).ok,false);
});

test('ordinary complete/no-change path requires the existing strict published settled witness',async t=>{
  const fx=await actualFrame(t,['scripts/stephanos-native-capacity-publisher.mjs']);
  assert.equal(fx.result.ok,true);
  const sync={schemaVersion:'shared-agent-workspace-record.v1',kind:'stephanos.shared_workspace.status',
    statusId:'battle-bridge-github-sync-current',classification:'SYNC_NO_CHANGE',localHeadBefore:B,
    remoteHeadObserved:B,pendingRefresh:null};
  const witness={schemaVersion:IGNITION_SETTLED_REFRESH_SCHEMA_V1,sourceHead:B,syncStatusRecord:sync,
    refreshCompletionRecord:JSON.parse(fx.bytes),ancestry:[{beforeHead:A,afterHead:B,ancestor:true},{beforeHead:B,afterHead:A,ancestor:false}]};
  const frame={...fx.frame,refreshes:[],settledRefreshEvidence:witness};
  assert(projectIgnitionSettledRefreshEvidenceV1(witness,B),JSON.stringify(collectPostSyncRefreshDebt({syncRecord:sync,refreshRecord:JSON.parse(fx.bytes)})));
  const decision=await fx.invoke({syncAndRefreshFn:async()=>frame});
  assert.equal(decision.ok,true);
  assert.equal(decision.startupAdmission.globalRefreshState,'COMPLETE');
  assert.deepEqual(decision.startupAdmission.globalRemaining,[]);
  for(const change of [v=>{v.settledRefreshEvidence.refreshCompletionRecord.afterHead=C;},
    v=>{v.settledRefreshEvidence.syncStatusRecord.pendingRefresh={};},
    v=>{v.settledRefreshEvidence.ancestry=[];}]) {
    const broken=structuredClone(frame);change(broken);
    assert.equal((await fx.invoke({syncAndRefreshFn:async()=>broken})).ok,false);
  }
});

test('actual existing CLI hook selects the fixed ordinary scope with a genuine terminal producer frame', {skip:process.platform!=='win32'},async t=>{
  const fx=await actualFrame(t,[plugin,spatial]);
  const scripts=join(fx.paths.repoRoot,'scripts');await mkdir(scripts);
  const ownerPath=join(scripts,'fixture-owner.mjs');
  await writeFile(ownerPath,`export const resolveCanonicalSyncAndRefreshPaths=()=>(${JSON.stringify(fx.paths)});\n`
    +`export const runBattleBridgeSyncAndRefresh=async()=>(${JSON.stringify(fx.frame)});\n`);
  const original=await readFile(new URL('./battle-bridge-ignition-sync-preflight.mjs',import.meta.url),'utf8');
  const cli=original.replace("'../shared/agents/postSyncRuntimeRefreshCoordinator.mjs'",
    JSON.stringify(new URL('../shared/agents/postSyncRuntimeRefreshCoordinator.mjs',import.meta.url).href))
    .replace("'./battle-bridge-github-sync-and-refresh.mjs'",JSON.stringify(pathToFileURL(ownerPath).href));
  const entry=join(scripts,'battle-bridge-ignition-sync-preflight.mjs');await writeFile(entry,cli);
  const result=spawnSync(process.execPath,[entry],{cwd:fx.paths.repoRoot,encoding:'utf8',shell:false,windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  const lines=result.stdout.trim().split(/\r?\n/);assert.equal(lines.length,1);
  const marker='BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_RESULT=';assert(lines[0].startsWith(marker));
  const observed=JSON.parse(lines[0].slice(marker.length));
  assert.equal(observed.startupScope,scope);assert.equal(observed.ok,true);
  assert.equal(observed.startupAdmission.nativeCommissioningState,'HELD_UNPROVEN');
  assert.equal(await readFile(fx.statusPath,'utf8'),fx.bytes);
});
