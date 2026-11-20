import test from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import {
  classifyUpdateDirt,
  compareUpdateDirt,
  evaluateRuntimeProofAttempt,
  updateStephanosFromChat as updateStephanosFromChatActual,
} from './stephanosChatUpdate.mjs';
import { runStephanChatUpdateCli } from '../../scripts/stephanos-chat-update.mjs';
import { buildPostSyncRefreshProjection, classifyPostSyncRefresh, executePostSyncRefreshPlan } from './postSyncRuntimeRefreshCoordinator.mjs';
import { runBattleBridgeIgnitionSyncPreflight } from '../../scripts/battle-bridge-ignition-sync-preflight.mjs';
import { readCanonicalPostSyncRefreshEvidenceV1, readPendingPostSyncRefresh, runBattleBridgeSyncAndRefresh }
  from '../../scripts/battle-bridge-github-sync-and-refresh.mjs';
import { runBattleBridgePostSyncRefresh } from '../../scripts/battle-bridge-post-sync-refresh.mjs';
import { createSharedWorkspaceStatusRecord } from './sharedAgentWorkspaceStore.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function updateStephanosFromChat(options) {
  return updateStephanosFromChatActual({ ...options,
    adoptionEvidenceReader: options.adoptionEvidenceReader || options.spawnSyncFn?.adoptionEvidenceReader });
}

const BEFORE = '0'.repeat(40);
function canonicalSyncReceipt(head, values = {}) {
  return { ok: true, status: 'DONE', verdict: 'PASS', branch: 'main', beforeHead: BEFORE, afterHead: head,
    approvedTargetHead: head, sourceConverged: true, verificationPassed: true, tests: { ok: true },
    updated: true, restartRequired: false, ...values };
}
function canonicalRefresh(head, beforeHead = BEFORE) {
  const plan = classifyPostSyncRefresh(['docs/chat-update-adoption-fixture.md']);
  return { ...buildPostSyncRefreshProjection({ ok: true, classification: 'NO_RUNTIME_REFRESH_REQUIRED', plan, results: [],
    exactHeadProofOk: true, finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_PASS' }, { beforeHead, afterHead: head }),
    ok: true, phase: 'complete', sourceHead: head };
}
function canonicalPreflight(head) {
  return { schemaVersion: 'stephanos.battle-bridge-ignition-sync-preflight.v1', ok: true, skipped: false,
    classification: 'IGNITION_SYNC_PREFLIGHT_PASS', sourceHead: head, syncClassification: 'SYNC_NO_CHANGE',
    syncBlockerReason: '', refreshCount: 0, pendingRefreshObserved: false, sourceForwardedBeforeRefresh: false,
    refreshDebtCoalesced: false, controlPlaneRepairObserved: false, blocker: '', finalVerdict: 'IGNITION_SYNC_PREFLIGHT_PASS' };
}

function health(fullHead, servedCommit = fullHead.slice(0, 8), {
  backendOk = true,
  openClawOk = true,
} = {}) {
  return {
    ok: backendOk && openClawOk,
    status: backendOk && openClawOk ? 'DONE' : 'FAILED',
    verdict: backendOk && openClawOk ? 'PASS' : 'FAIL',
    fullHead,
    health: [
      {
        url: 'http://127.0.0.1:4173/__stephanos/health',
        ok: true,
        status: 200,
        body: JSON.stringify({ ok: true, gitCommit: servedCommit, runtimeMarker: `live::${servedCommit}`, intendedMode: 'launcher-root' }),
        error: '',
      },
      {
        url: 'http://127.0.0.1:8787/api/health',
        ok: backendOk,
        status: backendOk ? 200 : 503,
        body: '',
        error: backendOk ? '' : 'backend restarting',
      },
      {
        url: 'http://127.0.0.1:18789/health',
        ok: openClawOk,
        status: openClawOk ? 200 : 503,
        body: '',
        error: openClawOk ? '' : 'gateway restarting',
      },
    ],
  };
}

function scriptedSpawn({ head = 'a'.repeat(40), before = '', after = before, ignitionStatus = 0,
  stageReply = null, headReply = null, ancestor = true } = {}) {
  let statusReads = 0;
  const calls = [];
  const workspaceRoot=mkdtempSync(path.join(tmpdir(),'chat-update-canonical-fixture-'));
  mkdirSync(path.join(workspaceRoot,'status'));
  function storeRefresh(value) {
    const record={...value,...createSharedWorkspaceStatusRecord({statusId:'post-sync-runtime-refresh-current',
      participantId:'mission-orchestrator',timestampUtc:new Date().toISOString(),status:value.classification}),phase:value.phase};
    writeFileSync(path.join(workspaceRoot,'status','post-sync-runtime-refresh-current.json'),JSON.stringify(record));
  }
  storeRefresh(canonicalRefresh(head));
  const spawn = (command, args) => {
    calls.push({ command, args: [...args] });
    if (/git(?:\.exe)?$/i.test(command) && args.includes('rev-parse')) {
      return { status: 0, stdout: (headReply ? headReply(calls) : head) + '\n', stderr: '', signal: null };
    }
    if (/git(?:\.exe)?$/i.test(command) && args.includes('--is-ancestor')) {
      const [before, after] = args.slice(-2);
      return { status: ancestor && before <= after ? 0 : 1, stdout: '', stderr: '', signal: null };
    }
    if (command === 'git' && args[0] === 'status') {
      const stdout = statusReads === 0 ? before : after;
      statusReads += 1;
      return { status: 0, stdout, stderr: '', signal: null };
    }
    if (command === process.execPath && basename(args[0]) === 'run-battle-bridge-ignition.mjs') {
      return { status: ignitionStatus, stdout: 'bounded ignition proof', stderr: '', signal: null };
    }
    if (command === process.execPath && ['battle-bridge-post-sync-refresh.mjs','battle-bridge-ignition-sync-preflight.mjs'].includes(basename(args[0]))) {
      const script = basename(args[0]), custom = stageReply?.(script, args);
      if (custom) {
        if(script==='battle-bridge-post-sync-refresh.mjs'){
          try{const line=custom.stdout.split(/\r?\n/).find(row=>row.startsWith('POST_SYNC_REFRESH_RESULT='));
            const value=JSON.parse(line.slice('POST_SYNC_REFRESH_RESULT='.length));if(value.phase)storeRefresh(value);}catch{}
        }
        return custom;
      }
      const refresh = script === 'battle-bridge-post-sync-refresh.mjs';
      return { status: 0, stdout: (refresh ? 'POST_SYNC_REFRESH_RESULT=' : 'BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_RESULT=')
        + JSON.stringify(refresh ? canonicalRefresh(head) : canonicalPreflight(head)) + '\n', stderr: '', signal: null };
    }
    throw new Error(`Unexpected command ${command} ${args.join(' ')}`);
  };
  spawn.calls = calls;
  spawn.adoptionEvidenceReader=()=>readCanonicalPostSyncRefreshEvidenceV1({workspaceRoot});
  spawn.workspaceRoot=workspaceRoot;
  return spawn;
}

const noSleep = async () => {};

test('chat update requires explicit operator approval before sync or runtime control', async () => {
  let syncCalled = false;
  const result = await updateStephanosFromChat({
    operatorApproval: '',
    syncFn: () => { syncCalled = true; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPERATOR_APPROVAL_REQUIRED');
  assert.equal(syncCalled, false);
  assert.equal(result.nextOperatorAction.includes('explicitly approve'), true);
});

test('chat update stops safely when fast-forward sync is blocked', async () => {
  let diagnosticsCalled = false;
  const result = await updateStephanosFromChat({
    operatorApproval: 'operator-approved',
    syncFn: () => ({ ok: false, status: 'BLOCKED', blocker: 'LOCAL_BRANCH_NOT_FAST_FORWARD_SAFE' }),
    diagnosticsFn: () => { diagnosticsCalled = true; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'LOCAL_BRANCH_NOT_FAST_FORWARD_SAFE');
  assert.equal(result.runtimeRefreshAttempted, false);
  assert.equal(result.operatorPowerShellRequired, false);
  assert.equal(diagnosticsCalled, false);
});

test('chat update preserves exact installed source truth when post-sync verification blocks runtime refresh', async () => {
  const head = '10ce35ad3d9542694f02e6727954b965d3de4f6b';
  let diagnosticsCalled = false;
  const result = await updateStephanosFromChat({
    expectedHead: head,
    operatorApproval: 'operator-approved',
    syncFn: () => ({
      ok: false,
      status: 'FAILED',
      blocker: 'POST_SYNC_VERIFICATION_FAILED',
      branch: 'main',
      afterHead: head,
      tests: { ok: false, status: 1 },
    }),
    diagnosticsFn: () => { diagnosticsCalled = true; },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'POST_SYNC_VERIFICATION_FAILED');
  assert.equal(result.sourceInstalled, true);
  assert.equal(result.sourceHead, head);
  assert.equal(result.branch, 'main');
  assert.equal(result.expectedHeadMatch, true);
  assert.equal(result.runtimeRefreshAttempted, false);
  assert.equal(diagnosticsCalled, false);
});

test('chat update fast-forwards, runs the canonical ignition entry, and proves exact-head runtime without manual PowerShell', async () => {
  const head = '443e3bcb6f6da050961b881160f7d5a4ca463fee';
  const diagnostics = [health(head), health(head)];
  const spawnSyncFn = scriptedSpawn({
    head,
    before: ' D apps/stephanos/dist/assets/old-build.js\n M apps/stephanos/dist/index.html\n M stephanos-server/data/memory/durable-memory.json\n',
    after: ' D apps/stephanos/dist/assets/old-build.js\n M apps/stephanos/dist/index.html\n M stephanos-server/data/memory/durable-memory.json\n',
  });
  const result = await updateStephanosFromChat({
    repoRoot: 'C:\\repo',
    expectedHead: head,
    operatorApproval: 'operator-approved',
    platform: 'win32',
    spawnSyncFn,
    syncFn: () => canonicalSyncReceipt(head),
    diagnosticsFn: async () => diagnostics.shift(),
    runtimeProofAttempts: 1,
    sleepFn: noSleep,
  });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.finalVerdict, 'SOURCE_AND_RUNTIME_EXACT_HEAD');
  assert.equal(result.servedUiProof.exactHead, true);
  assert.equal(result.sourceHeadUnchangedDuringRefresh, true);
  assert.equal(result.sourceInstalled, true);
  assert.equal(result.runtimeProofPassed, true);
  assert.equal(result.runtimeProof.attemptCount, 1);
  assert.equal(result.dirtDelta.sourceMutationDetected, false);
  assert.deepEqual(result.dirtBefore.source, []);
  assert.deepEqual(result.dirtBefore.runtime, [
    'apps/stephanos/dist/assets/old-build.js',
    'apps/stephanos/dist/index.html',
    'stephanos-server/data/memory/durable-memory.json',
  ]);
  assert.equal(result.dirtBefore.entries[0].status, ' D');
  assert.equal(result.operatorPowerShellRequired, false);
  assert.equal(result.codexChildUsed, false);
  assert.equal(result.readinessScope,'SOURCE_AND_SERVED_SERVICES');
  assert.equal(result.desktopIgnitionReadiness,'UNPROVEN');
  assert.equal(result.processControlPerformed, true);
  const ignitionCall = spawnSyncFn.calls.find((call) => call.command === process.execPath && basename(call.args[0]) === 'run-battle-bridge-ignition.mjs');
  assert.ok(ignitionCall);
  assert.equal(basename(ignitionCall.args[0]), 'run-battle-bridge-ignition.mjs');
  assert.equal(spawnSyncFn.calls.some((call) => /powershell/i.test(call.command)), false);
});

async function adoptionFixture({ head='b'.repeat(40),receipt={},spawn={},adoptionEvidenceReader }={}) {
  const spawnSyncFn=scriptedSpawn({head,...spawn});
  const result=await updateStephanosFromChat({repoRoot:'C:\\repo',expectedHead:head,operatorApproval:'operator-approved',platform:'win32',
    spawnSyncFn,adoptionEvidenceReader,syncFn:()=>canonicalSyncReceipt(head,receipt),diagnosticsFn:async()=>health(head),runtimeProofAttempts:1,sleepFn:noSleep});
  return {result,calls:spawnSyncFn.calls};
}
const supervisorCount=calls=>calls.filter(row=>basename(row.args[0]||'')==='run-battle-bridge-ignition.mjs').length;
const nodeScripts=calls=>calls.filter(row=>row.command===process.execPath).map(row=>basename(row.args[0]));
const refreshReply=(value,status=value.ok?0:2)=>({status,stdout:'POST_SYNC_REFRESH_RESULT='+JSON.stringify(value)+'\n',stderr:'',signal:null});
const preflightReply=(value,status=value.ok?0:2)=>({status,stdout:'BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_RESULT='+JSON.stringify(value)+'\n',stderr:'',signal:null});

test('chat update delegates the exact installed transition and retained no-change debt before its supervisor',async()=>{
  const changed=await adoptionFixture();
  assert.equal(changed.result.ok,true);
  assert.deepEqual(nodeScripts(changed.calls),['battle-bridge-post-sync-refresh.mjs','battle-bridge-ignition-sync-preflight.mjs','run-battle-bridge-ignition.mjs']);
  const call=changed.calls.find(row=>basename(row.args[0]||'')==='battle-bridge-post-sync-refresh.mjs');
  assert.deepEqual(call.args.slice(1),['--before',BEFORE,'--after','b'.repeat(40)]);
  const unchanged=await adoptionFixture({receipt:{beforeHead:'b'.repeat(40),updated:false}});
  assert.equal(unchanged.result.ok,true);
  assert.deepEqual(nodeScripts(unchanged.calls),['battle-bridge-ignition-sync-preflight.mjs','run-battle-bridge-ignition.mjs']);
  assert.equal(unchanged.result.desktopIgnitionReadiness,'UNPROVEN');
});

test('actual canonical producer classifications cannot skip Governor Relay Spatial unsafe or unknown adoption',async()=>{
  const head='b'.repeat(40),pass=async()=>({ok:true,sourceHead:head,exactHeadProofOk:true,blocker:''});
  const cases=[['advisory',['docs/chat-only-source.md'],true],['governor',['scripts/windows/run-vr-resource-governor.ps1'],false],
    ['relay',['scripts/control-tower-build-consumer-v1.mjs'],false],['spatial',['scripts/spatial-window-host.mjs'],false],
    ['unsafe',['../escape.mjs'],false],['unknown',['scripts/new-unclassified-adoption.mjs'],false],
    ['plugin',['plugins/sovereign-commander/plugin.json'],false]];
  for(const [label,paths,expected]of cases){
    const execution=await executePostSyncRefreshPlan({beforeHead:BEFORE,afterHead:head,changedPaths:paths,
      adapters:{refreshUi:pass,proveVrAtlas:pass,restartBackend:pass,restartMissionWorker:pass,restartGitHubMailbox:pass,
        refreshSovereignCommander:pass,confirmNaturalReload:pass}});
    const producer={...buildPostSyncRefreshProjection(execution,{beforeHead:BEFORE,afterHead:head}),ok:execution.ok,
      phase:execution.ok?'complete':'blocked',sourceHead:head};
    const {result,calls}=await adoptionFixture({spawn:{stageReply:script=>script==='battle-bridge-post-sync-refresh.mjs'?refreshReply(producer):null}});
    assert.equal(result.ok,expected,label);assert.equal(result.sourceInstalled,true,label);
    assert.equal(supervisorCount(calls),expected?1:0,label);
    if(!expected)assert.equal(result.finalVerdict,'SOURCE_INSTALLED_ADOPTION_HELD',label);
  }
});

test('retained mandatory Governor debt on a no-change update passes through the real canonical preflight',async()=>{
  const head='b'.repeat(40);
  const execution=await executePostSyncRefreshPlan({beforeHead:BEFORE,afterHead:head,changedPaths:['scripts/windows/run-vr-resource-governor.ps1'],
    adapters:{refreshSovereignCommander:async()=>({ok:true,exactHeadProofOk:true,sourceHead:head,blocker:''})}});
  const refresh=buildPostSyncRefreshProjection(execution,{beforeHead:BEFORE,afterHead:head});
  const proof=await runBattleBridgeIgnitionSyncPreflight({platform:'win32',repoRoot:'C:/fixture',canonicalRepoRoot:'C:/fixture',
    syncAndRefreshFn:async()=>({ok:false,blocker:refresh.blocker,sourceHead:head,syncClassification:'SYNC_NO_CHANGE',
      refreshes:[{result:refresh}],finalVerdict:'SYNC_AND_REFRESH_BLOCKED'})});
  assert.equal(proof.ok,false);
  const {result,calls}=await adoptionFixture({receipt:{beforeHead:head,updated:false},
    spawn:{stageReply:script=>script==='battle-bridge-ignition-sync-preflight.mjs'?preflightReply(proof):null}});
  assert.equal(result.ok,false);assert.equal(result.sourceInstalled,true);assert.equal(supervisorCount(calls),0);
  assert.deepEqual(nodeScripts(calls),['battle-bridge-ignition-sync-preflight.mjs']);
});

test('genuine covering canonical scoped proof remains admissible through the exact-transition consumer',async()=>{
  const head='b'.repeat(40);
  const governorProof={schemaVersion:'stephanos.post-sync-governor-proof.v1',watchdogSucceeded:true,normalOperatorObserved:true,
    healthy:true,inventoryComplete:true,processCount:1,identityVerified:true,progressVerified:true,currentSourceVerified:true,
    sourceHead:head,sourceHeadMatchesLive:true,sourceSha256:'a'.repeat(64),blocker:''};
  const sovereignRelayProof={schemaVersion:'stephanos.post-sync-sovereign-relay-proof.v1',watchdogSucceeded:true,healthy:true,
    sourceHead:head,sourceHeadMatchesLive:true,processCount:1,heartbeatAgeSeconds:1,blocker:''};
  const execution=await executePostSyncRefreshPlan({beforeHead:BEFORE,afterHead:head,
    changedPaths:['scripts/windows/run-vr-resource-governor.ps1','scripts/control-tower-build-consumer-v1.mjs'],
    adapters:{refreshSovereignCommander:async()=>({ok:true,exactHeadProofOk:true,sourceHead:head,blocker:'',governorProof,sovereignRelayProof})}});
  assert.equal(execution.ok,true);
  const producer={...buildPostSyncRefreshProjection(execution,{beforeHead:BEFORE,afterHead:head}),ok:true,phase:'complete',sourceHead:head};
  const {result,calls}=await adoptionFixture({spawn:{stageReply:script=>script==='battle-bridge-post-sync-refresh.mjs'?refreshReply(producer):null}});
  assert.equal(result.ok,true);assert.equal(supervisorCount(calls),1);
});

async function actualCanonicalAdoptionFixture(changedPaths,{custody=false,auxiliaryFailure=false,startupScope=''}={}) {
  const directory=mkdtempSync(path.join(tmpdir(),'chat-update-existing-owner-'));
  const paths={repoRoot:path.join(directory,'repo'),workspaceRoot:path.join(directory,'workspace')};
  mkdirSync(paths.repoRoot);mkdirSync(paths.workspaceRoot);
  const head='b'.repeat(40),pass=()=>({ok:true,exactHeadProofOk:true,sourceHead:head,blocker:''});
  const producer=await runBattleBridgePostSyncRefresh({beforeHead:BEFORE,afterHead:head,paths,expectedPaths:paths,
    adapter:{inspectHeads:()=>({...pass(),branch:'main'}),changedPaths:()=>({ok:true,paths:changedPaths}),
      isAncestor:(before,after)=>({ok:true,ancestor:before<=after}),refreshUi:pass,proveVrAtlas:pass,restartApprovedTarget:pass,
      restartGitHubMailbox:pass,refreshSovereignCommander:()=>custody?{ok:false,exactHeadProofOk:false,sourceHead:head,
        blocker:'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN'}:pass(),
      confirmNaturalReload:pass,reconcileControlPlane:pass}});
  const syncRecord={...createSharedWorkspaceStatusRecord({statusId:'battle-bridge-github-sync-current',participantId:'mission-orchestrator',
    timestampUtc:new Date().toISOString(),status:'SYNC_NO_CHANGE'}),classification:'SYNC_NO_CHANGE',localHeadBefore:head,remoteHeadObserved:head,pendingRefresh:null};
  writeFileSync(path.join(paths.workspaceRoot,'status','battle-bridge-github-sync-current.json'),JSON.stringify(syncRecord));
  const proof=await runBattleBridgeIgnitionSyncPreflight({startupScope,platform:'win32',repoRoot:paths.repoRoot,canonicalRepoRoot:paths.repoRoot,
    syncAndRefreshFn:()=>runBattleBridgeSyncAndRefresh({paths,expectedPaths:paths,platform:'win32',
      pendingReader:readPendingPostSyncRefresh,capacityObservationHeartbeat:async()=>({ok:true,capacityObservationOnly:true}),
      goalDiscoveryHeartbeat:async()=>({ok:true}),controlPlaneReconciler:()=>auxiliaryFailure?{ok:false,blocker:'CONTROL_PLANE_FIXED_INSTALLER_FAILED'}:{ok:true},
      adapter:{runSync:()=>({ok:true,result:{ok:true,evaluation:{classification:'SYNC_NO_CHANGE'},facts:{localHead:head,remoteHead:head},receipt:{statusRecord:syncRecord}}}),
        runRefresh:()=>({ok:true,result:producer}),isAncestor:(before,after)=>({ok:true,ancestor:before<=after}),
        observeCurrentHead:()=>({ok:true,head})}})});
  return {paths,producer,proof,reader:()=>readCanonicalPostSyncRefreshEvidenceV1(paths)};
}

test('changed optional-only transitions use real canonical writer reader and preflight policy with no stricter updater waiver',async()=>{
  for(const [paths,custody,auxiliaryFailure,classification]of [
    [['plugins/sovereign-commander/plugin.json'],false,false,'IGNITION_SYNC_PREFLIGHT_PASS_PLUGIN_HOST_DEGRADED'],
    [['scripts/sovereign-commander-http.mjs'],true,false,'IGNITION_SYNC_PREFLIGHT_PASS_COMMANDER_CUSTODY_DEGRADED'],
    [['docs/actual-auxiliary-hold.md'],false,true,'IGNITION_SYNC_PREFLIGHT_PASS_CONTROL_PLANE_DEGRADED'],
  ]){
    const actual=await actualCanonicalAdoptionFixture(paths,{custody,auxiliaryFailure});
    assert.equal(actual.producer.ok,auxiliaryFailure);assert.equal(actual.proof.ok,true);
    assert.equal(actual.proof.classification,classification);
    const record=JSON.parse(readFileSync(path.join(actual.paths.workspaceRoot,'status','post-sync-runtime-refresh-current.json'),'utf8'));
    assert.equal(record.phase,auxiliaryFailure?'complete':'blocked');assert.equal(record.afterHead,'b'.repeat(40));
    const {result,calls}=await adoptionFixture({adoptionEvidenceReader:actual.reader,spawn:{stageReply:script=>
      script==='battle-bridge-post-sync-refresh.mjs'?refreshReply(actual.producer):preflightReply(actual.proof)}});
    assert.equal(result.ok,true,classification);assert.equal(supervisorCount(calls),1);assert.equal(result.desktopIgnitionReadiness,'UNPROVEN');
    assert.equal((await actual.reader()).spans.length,auxiliaryFailure?0:1);
  }
});

test('three-app scoped startup cross-checks exact canonical optional debt without granting native commissioning',async()=>{
  for(const path of ['plugins/sovereign-commander/plugin.json','scripts/spatial-window-host.mjs']){
    const actual=await actualCanonicalAdoptionFixture([path],{startupScope:'THREE_APP_DESKTOP_STARTUP'});
    assert.equal(actual.proof.ok,true,path);
    assert.equal(actual.proof.classification,'IGNITION_SYNC_PREFLIGHT_PASS_THREE_APP_STARTUP',path);
    assert.equal(actual.proof.startupAdmission.mandatoryRemaining.length,0,path);
    const {result,calls}=await adoptionFixture({adoptionEvidenceReader:actual.reader,spawn:{stageReply:script=>
      script==='battle-bridge-post-sync-refresh.mjs'?refreshReply(actual.producer):preflightReply(actual.proof)}});
    assert.equal(result.ok,true,path);assert.equal(supervisorCount(calls),1,path);
    assert.equal(result.desktopIgnitionReadiness,'UNPROVEN',path);
  }
});

test('three-app scoped preflight cannot forge source, residual debt, scope or admission',async()=>{
  const actual=await actualCanonicalAdoptionFixture(['plugins/sovereign-commander/plugin.json'],
    {startupScope:'THREE_APP_DESKTOP_STARTUP'});
  assert.equal(actual.proof.ok,true);
  const changes=[
    proof=>{proof.startupScope='ALL_SERVICES';},
    proof=>{proof.startupAdmission.mandatoryRemaining=['governor'];},
    proof=>{proof.startupAdmission.globalRefreshState='COMPLETE';},
    proof=>{proof.refreshObligations.remaining=[];},
    proof=>{proof.refreshBlocker='';},
    proof=>{proof.extraAuthority=true;},
  ];
  for(const change of changes){
    const forged=JSON.parse(JSON.stringify(actual.proof));change(forged);
    const {result,calls}=await adoptionFixture({adoptionEvidenceReader:actual.reader,spawn:{stageReply:script=>
      script==='battle-bridge-post-sync-refresh.mjs'?refreshReply(actual.producer):preflightReply(forged)}});
    assert.equal(result.ok,false,change.toString());assert.equal(supervisorCount(calls),0,change.toString());
  }
});

test('a degraded DTO cannot replace actual requested-span retention or waive actual canonical mandatory debt',async()=>{
  const optional=await actualCanonicalAdoptionFixture(['plugins/sovereign-commander/plugin.json']);
  assert.equal(optional.proof.ok,true);
  for(const paths of [['scripts/windows/run-vr-resource-governor.ps1'],['scripts/control-tower-build-consumer-v1.mjs'],
    ['scripts/spatial-window-host.mjs'],['scripts/new-unknown-native-owner.mjs'],['../escape.mjs']]){
    const mandatory=await actualCanonicalAdoptionFixture(paths);
    assert.equal(mandatory.proof.ok,false);
    const {result,calls}=await adoptionFixture({adoptionEvidenceReader:mandatory.reader,spawn:{stageReply:script=>
      script==='battle-bridge-post-sync-refresh.mjs'?refreshReply(mandatory.producer):preflightReply(optional.proof)}});
    assert.equal(result.ok,false,paths[0]);assert.equal(supervisorCount(calls),0,paths[0]);
  }
  for(const failure of ['missing-before','missing-after','foreign-owner','wrong-head','reader-failed']){
    const actual=await actualCanonicalAdoptionFixture(['plugins/sovereign-commander/plugin.json']);let reads=0;
    const reader=async()=>{reads++;const file=path.join(actual.paths.workspaceRoot,'status','post-sync-runtime-refresh-current.json');
      if(failure==='reader-failed')throw Error('unavailable');
      if((failure==='missing-before'&&reads===1)||(failure==='missing-after'&&reads===2))unlinkSync(file);
      if(reads===2&&['foreign-owner','wrong-head'].includes(failure)){
        const record=JSON.parse(readFileSync(file,'utf8'));
        if(failure==='foreign-owner')record.statusId='unrelated-owner';else record.afterHead='c'.repeat(40);
        writeFileSync(file,JSON.stringify(record));
      }
      return actual.reader();};
    const {result,calls}=await adoptionFixture({adoptionEvidenceReader:reader,spawn:{stageReply:script=>
      script==='battle-bridge-post-sync-refresh.mjs'?refreshReply(actual.producer):preflightReply(actual.proof)}});
    assert.equal(result.ok,false,failure);assert.equal(supervisorCount(calls),0,failure);assert.equal(result.sourceInstalled,true);
  }
});

test('malformed success envelopes and unpaid scoped proofs never authorize the service supervisor',async()=>{
  const mutations=[value=>{value.phase='plan';},value=>{value.sourceHead='c'.repeat(40);},value=>{value.schemaVersion='foreign';},
    value=>{value.beforeHead=value.afterHead;},value=>{value.unknownPathCount=1;},value=>{value.unsafePathCount=1;},
    value=>{value.governorRefreshRequired=true;},value=>{value.sovereignRelayRefreshRequired=true;},
    value=>{value.futureActivationRequired=true;},value=>{value.changedPathCount='1';},value=>{delete value.governorRefreshRequired;}];
  for(const mutate of mutations){const value=canonicalRefresh('b'.repeat(40));mutate(value);
    const {result,calls}=await adoptionFixture({spawn:{stageReply:script=>script==='battle-bridge-post-sync-refresh.mjs'?refreshReply(value,0):null}});
    assert.equal(result.ok,false,mutate.toString());assert.equal(supervisorCount(calls),0,mutate.toString());
  }
  for(const malformed of [
    {status:0,stdout:'POST_SYNC_REFRESH_RESULT={',stderr:''},
    {status:0,stdout:'POST_SYNC_REFRESH_RESULT={}\nPOST_SYNC_REFRESH_RESULT={}\n',stderr:''},
    {status:2,stdout:refreshReply(canonicalRefresh('b'.repeat(40))).stdout,stderr:''},
    {status:0,stdout:refreshReply(canonicalRefresh('b'.repeat(40))).stdout,error:{code:'ETIMEDOUT'}},
    {status:0,stdout:refreshReply(canonicalRefresh('b'.repeat(40))).stdout,signal:'SIGTERM'}]){
    const {result,calls}=await adoptionFixture({spawn:{stageReply:script=>script==='battle-bridge-post-sync-refresh.mjs'?malformed:null}});
    assert.equal(result.ok,false);assert.equal(supervisorCount(calls),0);
  }
  for(const mutate of [value=>{value.skipped=true;},value=>{value.sourceHead='c'.repeat(40);},value=>{value.futureRequired=true;},
    value=>{value.refreshCount='0';},value=>{delete value.pendingRefreshObserved;}]){
    const value=canonicalPreflight('b'.repeat(40));mutate(value);
    const {result,calls}=await adoptionFixture({spawn:{stageReply:script=>script==='battle-bridge-ignition-sync-preflight.mjs'?preflightReply(value,0):null}});
    assert.equal(result.ok,false);assert.equal(supervisorCount(calls),0);
  }
});

test('every current-head race and unproven ancestry preserves installed source with zero supervisor effects',async()=>{
  for(let pivot=1;pivot<=9;pivot++){
    let reads=0;
    const {result,calls}=await adoptionFixture({spawn:{headReply:()=>++reads===pivot?'c'.repeat(40):'b'.repeat(40)}});
    assert.equal(result.ok,false,'HEAD barrier '+pivot);assert.equal(result.sourceInstalled,true);assert.equal(supervisorCount(calls),0);
    assert.match(result.blocker,/SOURCE_ADVANCED/);
  }
  const {result,calls}=await adoptionFixture({spawn:{ancestor:false}});
  assert.equal(result.ok,false);assert.equal(result.sourceInstalled,true);assert.equal(supervisorCount(calls),0);
  assert.match(result.blocker,/PENDING_POST_SYNC_/);
});

test('chat update retries transient runtime health failure and passes when exact-head proof settles', async () => {
  const head = 'dddddddddddddddddddddddddddddddddddddddd';
  const diagnostics = [
    health(head),
    health(head, head.slice(0, 8), { backendOk: false }),
    health(head),
  ];
  const sleeps = [];
  const result = await updateStephanosFromChat({
    repoRoot: 'C:\\repo',
    expectedHead: head,
    operatorApproval: 'operator-approved',
    spawnSyncFn: scriptedSpawn({ head }),
    syncFn: () => canonicalSyncReceipt(head),
    diagnosticsFn: async () => diagnostics.shift(),
    runtimeProofAttempts: 3,
    runtimeProofDelayMs: 25,
    sleepFn: async (delayMs) => { sleeps.push(delayMs); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.runtimeProof.attemptCount, 2);
  assert.deepEqual(sleeps, [25]);
  assert.equal(result.runtimeProof.attempts[0].failedPredicates.includes('POST_DIAGNOSTICS_OK'), true);
  assert.equal(result.runtimeProof.attempts[0].endpointEvidence.find((entry) => entry.url.includes('8787')).status, 503);
  assert.deepEqual(result.runtimeProof.failedPredicates, []);
});

test('chat update reports source-installed runtime-proof-pending after bounded retries instead of a hard Git failure', async () => {
  const head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const diagnostics = [
    health(head),
    health(head, 'bbbbbbbb'),
    health(head, 'bbbbbbbb'),
  ];
  const result = await updateStephanosFromChat({
    repoRoot: 'C:\\repo',
    expectedHead: head,
    operatorApproval: 'operator-approved',
    spawnSyncFn: scriptedSpawn({ head }),
    syncFn: () => canonicalSyncReceipt(head),
    diagnosticsFn: async () => diagnostics.shift(),
    runtimeProofAttempts: 2,
    runtimeProofDelayMs: 0,
    sleepFn: noSleep,
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'PENDING');
  assert.equal(result.verdict, 'SOURCE_UPDATED_RUNTIME_PROOF_PENDING');
  assert.equal(result.finalVerdict, 'SOURCE_UPDATED_RUNTIME_PROOF_PENDING');
  assert.equal(result.blocker, '');
  assert.equal(result.sourceInstalled, true);
  assert.equal(result.sourceHead, head);
  assert.equal(result.expectedHeadMatch, true);
  assert.equal(result.runtimeProofPending, true);
  assert.equal(result.runtimeProof.exhausted, true);
  assert.equal(result.runtimeProof.attemptCount, 2);
  assert.equal(result.runtimeProof.failedPredicates.includes('SERVED_UI_EXACT_HEAD'), true);
  assert.equal(result.servedUiProof.endpoint.includes('4173'), true);
  assert.equal(result.nextOperatorAction.includes('Re-run bounded read-only exact-head runtime proof'), true);
});

test('chat update hard-fails when diagnostics prove source head changed during refresh', async () => {
  const head = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const changedHead = 'ffffffffffffffffffffffffffffffffffffffff';
  const diagnostics = [health(head), health(changedHead)];
  const result = await updateStephanosFromChat({
    repoRoot: 'C:\\repo',
    expectedHead: head,
    operatorApproval: 'operator-approved',
    spawnSyncFn: scriptedSpawn({ head }),
    syncFn: () => canonicalSyncReceipt(head),
    diagnosticsFn: async () => diagnostics.shift(),
    runtimeProofAttempts: 1,
    sleepFn: noSleep,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOURCE_HEAD_CHANGED_DURING_REFRESH');
  assert.equal(result.runtimeProofPending, false);
  assert.equal(result.runtimeProof.failedPredicates.includes('SOURCE_MATCHES_SYNC'), true);
});

test('chat update blocks when the fetched head differs from the operator-approved exact head', async () => {
  const approvedHead = '1111111111111111111111111111111111111111';
  const observedHead = '2222222222222222222222222222222222222222';
  let diagnosticsCalled = false;
  const result = await updateStephanosFromChat({
    expectedHead: approvedHead,
    operatorApproval: 'operator-approved',
    syncFn: () => ({ ok: true, afterHead: observedHead, updated: true }),
    diagnosticsFn: () => { diagnosticsCalled = true; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SYNC_AFTER_HEAD_MISMATCH');
  assert.equal(result.sourceInstalled, true);
  assert.equal(result.expectedHeadMatch, false);
  assert.equal(diagnosticsCalled, false);
});

test('chat update blocks newly changed source dirt while allowing runtime dirt changes to be reported separately', async () => {
  const head = 'cccccccccccccccccccccccccccccccccccccccc';
  const diagnostics = [health(head), health(head)];
  const result = await updateStephanosFromChat({
    repoRoot: 'C:\\repo',
    expectedHead: head,
    operatorApproval: 'operator-approved',
    spawnSyncFn: scriptedSpawn({ head, before: '', after: ' M scripts/unsafe.mjs\n M apps/stephanos/dist/index.html\n' }),
    syncFn: () => canonicalSyncReceipt(head),
    diagnosticsFn: async () => diagnostics.shift(),
    runtimeProofAttempts: 1,
    sleepFn: noSleep,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.blocker, 'SOURCE_DIRT_CHANGED_DURING_UPDATE');
  assert.equal(result.dirtDelta.sourceMutationDetected, true);
});

test('runtime proof evaluation names exact predicates and endpoint evidence', () => {
  const head = '3333333333333333333333333333333333333333';
  const result = evaluateRuntimeProofAttempt(health(head, head.slice(0, 8), { openClawOk: false }), {
    preSourceHead: head,
    expectedSourceHead: head,
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.failedPredicates, ['POST_DIAGNOSTICS_OK']);
  assert.equal(result.endpointEvidence.find((entry) => entry.url.includes('18789')).error, 'gateway restarting');
});

test('runtime and source dirt classification remains deterministic', () => {
  const dreamRuntime = [
    '?? memory/.dreams/events.jsonl',
    '?? memory/.dreams/session-ingestion.json',
    '?? memory/dreaming/deep/2026-07-16.md',
    '?? memory/dreaming/light/2026-07-16.md',
    '?? memory/dreaming/rem/2026-07-16.md',
  ].join('\n');
  const before = classifyUpdateDirt(` M apps/stephanos/dist/index.html\n M scripts/source.mjs\n${dreamRuntime}\n`);
  const after = classifyUpdateDirt(` M apps/stephanos/dist/index.html\n M scripts/source.mjs\n${dreamRuntime}\n?? data/activity/events.json\n`);
  const delta = compareUpdateDirt(before, after);
  assert.equal(delta.sourceMutationDetected, false);
  assert.equal(delta.runtimeMutationDetected, true);
  assert.deepEqual(
    before.runtime.filter((path) => path.startsWith('memory/')),
    [
      'memory/.dreams/events.jsonl',
      'memory/.dreams/session-ingestion.json',
      'memory/dreaming/deep/2026-07-16.md',
      'memory/dreaming/light/2026-07-16.md',
      'memory/dreaming/rem/2026-07-16.md',
    ],
  );
  assert.deepEqual(classifyUpdateDirt('?? memory/source-contract.md\n').source, ['memory/source-contract.md']);
});

test('Codex Remote CLI maps update intent to the guarded update operation and does not require PowerShell', async () => {
  let received = null;
  const result = await runStephanChatUpdateCli(['update', '--operator-approved'], {
    updateFn: async (args) => { received = args; return { ok: true, status: 'DONE', verdict: 'PASS' }; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(received, { operatorApproval: 'operator-approved', expectedBranch: 'main' });
});
