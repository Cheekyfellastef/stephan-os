import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, utimesSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { executePostSyncRefreshPlan, buildPostSyncRefreshProjection, projectPostSyncRemainingIgnitionObligationsV1 }
  from '../shared/agents/postSyncRuntimeRefreshCoordinator.mjs';
import { adjudicateBattleBridgeIgnitionSyncPreflightResultV1 } from './battle-bridge-ignition-sync-preflight.mjs';

const A='a'.repeat(40), B='b'.repeat(40), C='c'.repeat(40);
const plugin='plugins/sovereign-commander/plugin.json';
const spatial='scripts/spatial-window-host.mjs';
const governor='scripts/windows/run-vr-resource-governor.ps1';
const relay='scripts/control-tower-build-consumer-v1.mjs';
const custody='SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN';
const pluginHold='SOVEREIGN_DESKTOP_PLUGIN_HOST_ACTIVATION_UNPROVEN';
const pass=()=>({ok:true,exactHeadProofOk:true,sourceHead:B,blocker:''});
const wrapper=refresh=>({ok:false,blocker:refresh.blocker,sourceHead:B,syncClassification:'SYNC_NO_CHANGE',
  refreshes:[{result:refresh}],finalVerdict:'SYNC_AND_REFRESH_BLOCKED'});
async function compose(paths, overrides={}) {
  const execution=await executePostSyncRefreshPlan({beforeHead:A,afterHead:B,changedPaths:paths,
    adapters:{refreshSovereignCommander:async()=>pass(),confirmNaturalReload:async()=>pass(),...overrides}});
  const refresh=buildPostSyncRefreshProjection(execution,{beforeHead:A,afterHead:B});
  return {refresh,frame:wrapper(refresh),decision:adjudicateBattleBridgeIgnitionSyncPreflightResultV1(wrapper(refresh))};
}

test('current canonical composition reports the complete residual without changing sole-plugin degradation',async()=>{
  const optional=await compose([plugin]);
  assert.equal(optional.decision.ok,true);
  assert.equal(optional.decision.classification,'IGNITION_SYNC_PREFLIGHT_PASS_PLUGIN_HOST_DEGRADED');
  assert.equal(optional.decision.pluginHostDegraded,true);
  assert.equal(optional.decision.refreshBlocker,pluginHold);
  assert.deepEqual(optional.decision.refreshObligations,projectPostSyncRemainingIgnitionObligationsV1(optional.refresh,B));
  const mixed=await compose([plugin,spatial]);
  assert.equal(mixed.decision.ok,false);
  assert.equal(mixed.decision.blocker,'IGNITION_MANDATORY_REFRESH_OBLIGATIONS_UNPROVEN');
  assert.equal(mixed.decision.refreshBlocker,pluginHold);
  assert.deepEqual(mixed.decision.refreshObligations.remaining,['spatial-resident','desktop-plugin-host']);
  assert.equal(mixed.decision.refreshObligations.sourceHead,B);
});

test('real producer failures retain Governor relay target unknown and unsafe residual scopes',async()=>{
  const cases=[
    {paths:[plugin,governor],required:['governor','desktop-plugin-host','target:sovereign-commander']},
    {paths:[plugin,relay],required:['sovereign-relay','desktop-plugin-host','target:sovereign-commander']},
    {paths:[plugin,'scripts/qwen35-canary.mjs'],overrides:{refreshSovereignCommander:async()=>({...pass(),ok:false,exactHeadProofOk:false,blocker:custody})},required:['target:natural-reload','target:sovereign-commander','desktop-plugin-host']},
    {paths:[plugin,'scripts/unreviewed-reporting-neighbor.mjs'],required:['unclassified-path','desktop-plugin-host']},
    {paths:[plugin,'../escape.mjs'],required:['unsafe-path','desktop-plugin-host']},
    {paths:[plugin,'openclaw/config.json'],required:['openclaw-approval','desktop-plugin-host']},
  ];
  for(const row of cases){
    const {refresh,decision}=await compose(row.paths,row.overrides);
    assert.equal(decision.ok,false);
    assert.deepEqual(decision.refreshObligations,projectPostSyncRemainingIgnitionObligationsV1(refresh,B));
    for(const required of row.required)assert(decision.refreshObligations.remaining.includes(required),required);
  }
});

test('reported residual is re-derived from the same inert frame and unproven evidence is never an empty settled set',async()=>{
  const {frame}=await compose([plugin,spatial]);
  const forged={...frame,refreshObligations:{schemaVersion:'stephanos.ignition-refresh-obligations.v1',sourceHead:B,remaining:[]}};
  assert.deepEqual(adjudicateBattleBridgeIgnitionSyncPreflightResultV1(forged).refreshObligations.remaining,['spatial-resident','desktop-plugin-host']);
  for(const mutate of [r=>{r.afterHead=C;},r=>{delete r.governorRefreshRequired;},r=>{r.futureActivationRequired=true;}]){
    const candidate=structuredClone(frame);mutate(candidate.refreshes[0].result);
    const decision=adjudicateBattleBridgeIgnitionSyncPreflightResultV1(candidate);
    assert.equal(decision.ok,false);
    assert.equal(decision.refreshObligations,null);
  }
});

const launcher=readFileSync(new URL('../windows/Launch-Stephanos-Local.ps1',import.meta.url),'utf8');
const definition=name=>{const match=launcher.match(new RegExp(`^function ${name}(?:\\([^\\n]*\\))? \\{[\\s\\S]*?^}\\r?$`,'m'));assert(match);return match[0];};
const quote=value=>"'"+value.replaceAll("'","''")+"'";
function observePacket(value,{head=B,stale=false,extraLog='',terminal=false}={}){
  const parent=realpathSync(tmpdir()),directory=mkdtempSync(join(parent,'ignition-residual-reporting-'));
  try{
    const started=new Date().toISOString(),stdout=join(directory,'current.stdout.log'),stderr=join(directory,'current.stderr.log');
    writeFileSync(stdout,'BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_RESULT='+JSON.stringify(value)+'\n'+extraLog);
    writeFileSync(stderr,'');
    if(stale)utimesSync(stdout,new Date('2020-01-01T00:00:00Z'),new Date('2020-01-01T00:00:00Z'));
    const fixture=join(directory,'fixture.ps1');
    const consume=terminal?`
$Unattended=[switch]$true
$repoRoot='C:\\fixture'; $launcherShellUrl='fixture'; $launcherRuntimeUrl='fixture'; $launcherRuntimeStatusUrl='fixture'
$ignitionStatusPath='status'; $ignitionSupportSnapshotPath='snapshot'; $ignitionSplashPath='splash'; $ignitionTranscriptPath='transcript'; $ignitionBrowserSurfaceReceiptPath='browser'
function Get-IgnitionStageSnapshot { param($CurrentStageId); return @() }
function Write-IgnitionJson { param($Path,$Value,$Depth); if($Path -eq 'status'){$script:published=$Value}else{$script:support=$Value} }
function Write-IgnitionTranscript { param($Event) }
function Update-IgnitionSplashScreen { param($Status) }
${['Convert-SupervisorRecordToIgnitionStatus','Get-IgnitionOptionalBrowserOutcome','Resolve-IgnitionStatusProjection','Publish-IgnitionStatusProjection','Publish-IgnitionTerminalOutcome','Write-IgnitionSupportSnapshot'].map(definition).join('\n')}
$child=Get-LauncherChildBlocker
$outcome=Resolve-IgnitionStatusProjection -LaunchMode 'launcher-root' -Phase 'blocked' -Message $child.message -Extra @{blocker=$child.reason;childIgnitionBlocker=$child} -SupervisorRecord $null -ExpectedHead '' -RequestedBrowserSurfaces @() -BrowserReceipts @() -AutoOpenEnabled $false -RunStartedAtUtc $script:ignitionRunStartedAtUtc
Publish-IgnitionTerminalOutcome -Outcome $outcome
ConvertTo-Json -InputObject @{child=$child;status=$script:published;support=$script:support} -Depth 20 -Compress
`:'ConvertTo-Json -InputObject (Get-LauncherChildBlocker) -Depth 10 -Compress';
    writeFileSync(fixture,'\ufeff'+`$ErrorActionPreference='Stop'\n$ignitionProofRoot=${quote(directory)}\n$script:ignitionRunStartedAtUtc=[datetime]${quote(started)}\n$script:supervisorRecordFreshnessSkewSeconds=2\n$script:ignitionHelperLogFiles=@(${quote(stdout)},${quote(stderr)})\nfunction Initialize-IgnitionProofWorkspace {}\nfunction Get-RepositoryHeadForSupervisorProof { return ${quote(head)} }\n${['Read-IgnitionHelperLogObservedExtent','Read-IgnitionHelperLogSnapshot','ConvertTo-ThreeAppDesktopStartupAdmission','Get-LauncherChildBlocker'].map(definition).join('\n')}\n${consume}\n`);
    const run=spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fixture],{encoding:'utf8',windowsHide:true,shell:false,timeout:10000});
    assert.equal(run.status,0,run.stderr||run.stdout||run.error?.message);
    return run.stdout.trim()?JSON.parse(run.stdout.trim()):null;
  }finally{
    assert.equal(dirname(directory).toLowerCase(),parent.toLowerCase());
    assert(basename(directory).startsWith('ignition-residual-reporting-'));
    rmSync(directory,{recursive:true,force:true});
  }
}

test('actual Windows refusal consumer retains current source and full mandatory residual', {skip:process.platform!=='win32'},async()=>{
  const {decision}=await compose([plugin,spatial]);
  const observed=observePacket(decision);
  assert.equal(observed.sourceHead,B);
  assert.equal(observed.currentSourceHead,B);
  assert.equal(observed.sourceCohortState,'CURRENT');
  assert.equal(observed.refreshBlocker,pluginHold);
  assert.deepEqual(observed.refreshObligations.remaining,['spatial-resident','desktop-plugin-host']);
  assert.match(observed.message,/spatial-resident/);
  assert.match(observed.message,/desktop-plugin-host/);
  assert.match(observed.message,new RegExp(B));
});

test('wrong source cohort and stale retained log cannot masquerade as a current optional-host failure',{skip:process.platform!=='win32'},async()=>{
  const {decision}=await compose([plugin,spatial]);
  const historical=observePacket(decision,{head:C});
  assert.equal(historical.sourceCohortState,'STALE');
  assert.equal(historical.reason,'IGNITION_PREFLIGHT_SOURCE_COHORT_STALE');
  assert.equal(historical.sourceHead,B);
  assert.equal(historical.currentSourceHead,C);
  assert.equal(observePacket(decision,{stale:true}),null);
  const latestSuccess='BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_RESULT='+JSON.stringify({schemaVersion:decision.schemaVersion,ok:true,classification:'IGNITION_SYNC_PREFLIGHT_PASS',finalVerdict:'IGNITION_SYNC_PREFLIGHT_PASS',blocker:''})+'\n';
  assert.equal(observePacket(decision,{extraLog:latestSuccess}),null);
});

test('actual terminal status and support publication preserve residual/cohort metadata and keep readiness blocked',{skip:process.platform!=='win32'},async()=>{
  const {decision}=await compose([plugin,spatial]);
  for(const head of [B,C]){
    const observed=observePacket(decision,{head,terminal:true});
    assert.equal(observed.status.phase,'blocked');
    assert.equal(observed.status.trafficLight,'red');
    assert.equal(observed.status.enterStephanosEnabled,false);
    assert.equal(observed.support.verdict,'blocked');
    assert.deepEqual(observed.status.childIgnitionBlocker,observed.child);
    assert.deepEqual(observed.support.ignitionOutcome.childIgnitionBlocker,observed.child);
    assert.equal(observed.child.sourceCohortState,head===B?'CURRENT':'STALE');
    assert.deepEqual(observed.child.refreshObligations.remaining,['spatial-resident','desktop-plugin-host']);
  }
});

test('Windows reporting rejects malformed residual summaries and never invents a proven current cohort',{skip:process.platform!=='win32'},async()=>{
  const {decision}=await compose([plugin,spatial]);
  for(const mutate of [v=>{v.refreshObligations.sourceHead=C;},v=>{v.refreshObligations.remaining='spatial-resident';},
    v=>{v.refreshObligations.remaining=['C:\\private\\secret'];},v=>{v.refreshObligations.remaining=['spatial-resident','spatial-resident'];},
    v=>{v.refreshObligations.extraRequired=true;}]){
    const input=structuredClone(decision);mutate(input);
    const observed=observePacket(input);
    assert.equal(observed.refreshObligations,null);
    assert.match(observed.message,/obligations are unproven/);
    assert.doesNotMatch(JSON.stringify(observed),/private|secret/);
  }
  const unproved=observePacket(decision,{head:''});
  assert.equal(unproved.sourceCohortState,'UNPROVEN');
  assert.match(unproved.message,/cohort is unproven/);
  const invalid=observePacket({...decision,sourceHead:'C:\\private\\secret'});
  assert.equal(invalid.sourceHead,'');
  assert.equal(invalid.sourceCohortState,'UNPROVEN');
  assert.equal(invalid.refreshObligations,null);
  assert.doesNotMatch(JSON.stringify(invalid),/private|secret/);
});
