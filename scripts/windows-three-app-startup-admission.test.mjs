import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executePostSyncRefreshPlan, buildPostSyncRefreshProjection } from '../shared/agents/postSyncRuntimeRefreshCoordinator.mjs';
import { runBattleBridgeIgnitionSyncPreflight } from './battle-bridge-ignition-sync-preflight.mjs';
import { main } from './run-battle-bridge-ignition.mjs';

const A='a'.repeat(40),B='b'.repeat(40);
const source=readFileSync(new URL('../windows/Launch-Stephanos-Local.ps1',import.meta.url),'utf8');
const helper=readFileSync(new URL('../windows/Invoke-Stephanos-Ignite-With-Approval.ps1',import.meta.url),'utf8');
const marker='BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_RESULT=';
const quote=value=>"'"+value.replaceAll("'","''")+"'";
function definition(name) {
  const match=source.match(new RegExp(`^function ${name}(?:\\([^\\n]*\\))? \\{[\\s\\S]*?^}\\r?$`,'m'));
  assert(match,`actual ${name}`);return match[0];
}
const readerFunctions=['Read-IgnitionHelperLogObservedExtent','Read-IgnitionHelperLogSnapshot',
  'ConvertTo-ThreeAppDesktopStartupAdmission','Get-LauncherChildBlocker','Get-CurrentIgnitionStartupObservation'];
function powershell(body,{log='',head=B,stale=false,exitCode=0,exited=true}={}) {
  const root=mkdtempSync(join(tmpdir(),'windows-startup-view-'));
  try {
    const stdout=join(root,'current.stdout.log'),stderr=join(root,'current.stderr.log'),script=join(root,'fixture.ps1');
    writeFileSync(stdout,log);writeFileSync(stderr,'');
    if(stale)utimesSync(stdout,new Date('2020-01-01'),new Date('2020-01-01'));
    writeFileSync(script,'\ufeff'+`
$ErrorActionPreference='Stop'
$script:ignitionRunStartedAtUtc=[datetime]::UtcNow.AddSeconds(-1)
$script:supervisorRecordFreshnessSkewSeconds=2
$script:ignitionHelperLogFiles=@(${quote(stdout)},${quote(stderr)})
$script:ignitionHelperProcess=[pscustomobject]@{HasExited=$${exited};ExitCode=${exitCode===null?'$null':exitCode}}
$script:ignitionHelperProcess | Add-Member ScriptMethod WaitForExit {}
$script:ignitionHelperProcess | Add-Member ScriptMethod Refresh {}
function Initialize-IgnitionProofWorkspace {}
function Get-RepositoryHeadForSupervisorProof { return ${quote(head)} }
${readerFunctions.map(definition).join('\n')}
${body}
`);
    const result=spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],
      {encoding:'utf8',windowsHide:true,shell:false,timeout:15000});
    assert.equal(result.status,0,result.stderr||result.stdout||result.error?.message);
    return result.stdout.trim()?JSON.parse(result.stdout.trim()):null;
  } finally {rmSync(root,{recursive:true,force:true});}
}
async function genuineDecision() {
  const execution=await executePostSyncRefreshPlan({beforeHead:A,afterHead:B,
    changedPaths:['plugins/sovereign-commander/plugin.json','scripts/spatial-window-host.mjs'],
    adapters:{refreshSovereignCommander:async()=>({ok:true,exactHeadProofOk:true,sourceHead:B,blocker:''})}});
  const terminal={...buildPostSyncRefreshProjection(execution,{beforeHead:A,afterHead:B}),phase:'blocked'};
  return runBattleBridgeIgnitionSyncPreflight({platform:'win32',repoRoot:'C:/fixture/canonical',canonicalRepoRoot:'C:/fixture/canonical',
    startupScope:'THREE_APP_DESKTOP_STARTUP',syncAndRefreshFn:async()=>({ok:false,sourceHead:B,syncClassification:'SYNC_NO_CHANGE',
      blocker:terminal.blocker,finalVerdict:'SYNC_AND_REFRESH_BLOCKED',refreshes:[{result:terminal}]})});
}

test('same current-helper success survives more than256 later lines and retains native held truth', {skip:process.platform!=='win32'},async()=>{
  const decision=await genuineDecision();assert.equal(decision.ok,true);
  const observed=powershell('ConvertTo-Json -InputObject (Get-CurrentIgnitionStartupObservation) -Depth 15 -Compress',
    {log:marker+JSON.stringify(decision)+'\n'+'ordinary main progress\n'.repeat(400)});
  assert.equal(observed.packetType,'ignition-startup-admission');
  assert.deepEqual(observed.startupAdmission,decision.startupAdmission);
  assert.equal(observed.sourceCohortState,'CURRENT');
  assert.equal(observed.startupAdmission.globalRefreshState,'HELD');
  assert.equal(observed.startupAdmission.nativeCommissioningState,'HELD_UNPROVEN');
  const bom=powershell('ConvertTo-Json -InputObject (Get-CurrentIgnitionStartupObservation) -Depth 15 -Compress',
    {log:'\ufeff'+marker+JSON.stringify(decision)+'\n'});
  assert.deepEqual(bom.startupAdmission,decision.startupAdmission);
});

test('current log snapshot refuses short or growing extent and oversized or stale transport', {skip:process.platform!=='win32'},async()=>{
  const result=powershell(`
Add-Type -TypeDefinition 'using System;using System.IO;public class IgnitionExtentFixture:MemoryStream{public bool Grow;public bool Short;public IgnitionExtentFixture(){Write(new byte[]{65,66,67},0,3);Position=0;} public override int Read(byte[] b,int o,int c){if(Short)return 0;int n=base.Read(b,o,c);if(Grow){Position=Length;WriteByte(68);}return n;}}'
$valid=[IO.MemoryStream]::new([byte[]](65,66,67))
$short=[IgnitionExtentFixture]::new();$short.Short=$true
$grow=[IgnitionExtentFixture]::new();$grow.Grow=$true
ConvertTo-Json -InputObject @{valid=(Read-IgnitionHelperLogObservedExtent $valid 3);short=(Read-IgnitionHelperLogObservedExtent $short 3);grow=(Read-IgnitionHelperLogObservedExtent $grow 3)} -Compress
`);
  assert.equal(result.valid,'ABC');assert.equal(result.short,null);assert.equal(result.grow,null);
  const decision=await genuineDecision(),log=marker+JSON.stringify(decision)+'\n';
  for(const options of [{log:log+'x'.repeat(2097152)},{log,stale:true},{log,head:A},{log,exitCode:2},
    {log,exitCode:null},{log,exited:false},{log:''}]) {
    assert.equal(powershell('ConvertTo-Json -InputObject (Get-CurrentIgnitionStartupObservation) -Depth 15 -Compress',options),null);
  }
});

test('latest marker and exact fixed projection win; older success cannot survive a replacement or contradictory native claim', {skip:process.platform!=='win32'},async()=>{
  const decision=await genuineDecision(),first=marker+JSON.stringify(decision)+'\n';
  for(const latest of [marker+'{',marker+JSON.stringify({...decision,ok:false,classification:'IGNITION_SYNC_PREFLIGHT_BLOCKED',
    finalVerdict:'IGNITION_SYNC_PREFLIGHT_BLOCKED',blocker:'LATEST_ATTEMPT_HELD'}),
    marker+JSON.stringify({...decision,sourceHead:A}),
    marker+JSON.stringify({...decision,startupAdmission:{...decision.startupAdmission,nativeCommissioningState:'READY'}}),
    marker+JSON.stringify({...decision,startupAdmission:{...decision.startupAdmission,mandatoryRemaining:['governor']}})]) {
    assert.equal(powershell('ConvertTo-Json -InputObject (Get-CurrentIgnitionStartupObservation) -Depth 15 -Compress',{log:first+latest}),null);
  }
});

test('actual supervisor wait requires both service proof and a finished current scoped helper, preserving null-code and active-retry timing', {skip:process.platform!=='win32'},async()=>{
  const decision=await genuineDecision(),log=marker+JSON.stringify(decision)+'\n';
  const body=`
function Get-BattleBridgeSupervisorCurrentRecord {return [pscustomobject]@{blockerId=''}}
function Test-BattleBridgeSupervisorFinalContract {param($SupervisorRecord,$ExpectedHead);return $true}
function Write-IgnitionStatus {param($Phase,$Message,$Extra)}
function Write-LiveLog {param($Message)}
function Start-Sleep {throw 'WAITING_WITHOUT_ADMISSION'}
${definition('Wait-ForBattleBridgeSupervisorReady')}
try {$ready=Wait-ForBattleBridgeSupervisorReady;ConvertTo-Json -InputObject 'READY' -Compress}
catch {ConvertTo-Json -InputObject $_.Exception.Message -Compress}
`;
  assert.equal(powershell(body,{log}),'READY');
  for(const options of [{log,exitCode:null},{log,exited:false},{log:''},{log,stale:true},{log,head:A}])
    assert.equal(powershell(body,options),'WAITING_WITHOUT_ADMISSION');
  assert.match(powershell(body,{log,exitCode:2}),/helper failed before a green supervisor contract/);
});

test('actual Windows status, transcript and support snapshot carry the same admitted scope while service and browser gates remain required', {skip:process.platform!=='win32'},async()=>{
  const decision=await genuineDecision();
  const functions=['Convert-SupervisorRecordToIgnitionStatus','Get-IgnitionOptionalBrowserOutcome','Resolve-IgnitionStatusProjection',
    'Publish-IgnitionStatusProjection','Publish-IgnitionTerminalOutcome','Write-IgnitionSupportSnapshot'].map(definition).join('\n');
  const result=powershell(`
$repoRoot='fixture';$launcherShellUrl='fixture';$launcherRuntimeUrl='fixture';$launcherRuntimeStatusUrl='fixture'
$Unattended=[switch]$true
$ignitionProofRoot='fixture';$ignitionStatusPath='status';$ignitionSupportSnapshotPath='support';$ignitionTranscriptPath='transcript'
$script:service=$true;$script:browser=$true
function Test-BattleBridgeSupervisorFinalContract {param($SupervisorRecord,$ExpectedHead);return $script:service}
function Test-IgnitionBrowserReceiptSet {param($Surfaces,$Receipts,$RunStartedAtUtc,$CurrentObservation);return $script:browser}
function Get-IgnitionStageSnapshot {param($CurrentStageId);return @()}
function Write-IgnitionJson {param($Path,$Value,$Depth);if($Path -ceq 'status'){$script:status=$Value}else{$script:support=$Value}}
function Write-IgnitionTranscript {param($Event);$script:transcript=$Event}
function Update-IgnitionSplashScreen {param($Status)}
${functions}
$startup=Get-CurrentIgnitionStartupObservation
$outcome=Resolve-IgnitionStatusProjection -LaunchMode 'launcher-root' -Phase 'ready' -Message 'ready' -Extra @{} -ExpectedHead '${B}' -AutoOpenEnabled $true -RunStartedAtUtc $script:ignitionRunStartedAtUtc -StartupObservation $startup
Publish-IgnitionTerminalOutcome -Outcome $outcome
$script:service=$false
$serviceHeld=Resolve-IgnitionStatusProjection -LaunchMode 'launcher-root' -Phase 'ready' -Message 'ready' -Extra @{} -ExpectedHead '${B}' -AutoOpenEnabled $true -StartupObservation $startup
$script:service=$true;$script:browser=$false
$browserHeld=Resolve-IgnitionStatusProjection -LaunchMode 'launcher-root' -Phase 'ready' -Message 'ready' -Extra @{} -ExpectedHead '${B}' -AutoOpenEnabled $true -StartupObservation $startup
$script:browser=$true
$entryHeld=Resolve-IgnitionStatusProjection -LaunchMode 'launcher-root' -Phase 'ready' -Message 'ready' -Extra @{} -ExpectedHead '${B}' -AutoOpenEnabled $true -StartupObservation $null
ConvertTo-Json -InputObject @{status=$script:status;support=$script:support;transcript=$script:transcript;serviceHeld=$serviceHeld;browserHeld=$browserHeld;entryHeld=$entryHeld} -Depth 25 -Compress
`,{log:marker+JSON.stringify(decision)+'\n'});
  assert.equal(result.status.phase,'ready');assert.equal(result.status.enterStephanosEnabled,true);
  assert.deepEqual(result.status.startupAdmission,decision.startupAdmission);
  assert.deepEqual(result.support.ignitionOutcome.startupAdmission,decision.startupAdmission);
  assert.deepEqual(result.transcript.startupAdmission,decision.startupAdmission);
  assert.equal(result.status.globalRefreshState,'HELD');assert.equal(result.status.nativeCommissioningState,'HELD_UNPROVEN');
  assert.equal(result.status.optionalPreparations.fixedRuntimeCommissioning.preparation,'DEFERRED');
  assert.equal(result.status.optionalPreparations.fixedRuntimeCommissioning.qualificationProven,false);
  assert.equal(result.status.optionalPreparations.retainedCustodyPreparation.custodyReleased,false);
  assert.equal(result.serviceHeld.blocker,'desktop-ignition-service-proof-unproven');
  assert.equal(result.browserHeld.blocker,'desktop-ignition-browser-proof-unproven');
  assert.equal(result.entryHeld.blocker,'desktop-ignition-startup-admission-unproven');
});

test('actual aggregate includes startup-read time and rechecks retained windows and source after the read', {skip:process.platform!=='win32'},async()=>{
  const decision=await genuineDecision();
  for(const row of [{elapsed:10,exited:false},{elapsed:16001,exited:false},{elapsed:10,exited:true},
    {elapsed:16001,exited:true},{elapsed:10,exited:false,advance:true}]) {
    const observed=powershell(`
$Mode='launcher-root';$browserSurfaces=@([pscustomobject]@{Id='launcher'});$autoOpenEnabled=$true
$ignitionProofRoot='fixture';$script:currentHead='${B}';$script:ignitionAdmittedSourceHead='${B}'
$script:clock=[pscustomobject]@{ElapsedMilliseconds=10};$script:clock|Add-Member ScriptMethod Stop {}
$script:capability=[pscustomobject]@{HasExited=$false};$script:capability|Add-Member ScriptMethod Dispose {}
function New-IgnitionBrowserObservationClock {return $script:clock}
function Get-BattleBridgeSupervisorCurrentRecord {return [pscustomobject]@{generatedAt='fixed-current-supervisor'}}
function Get-RepositoryHeadForSupervisorProof {return $script:currentHead}
function Get-LatestOpenClawStartupStatus {return $null}
function Get-IgnitionRequiredBrowserSurfaces {param($Surfaces);return $Surfaces}
function Get-IgnitionStageSnapshot {param($CurrentStageId);return @()}
function Test-BattleBridgeSupervisorFinalContract {param($SupervisorRecord,$ExpectedHead);return $ExpectedHead -ceq '${B}'}
function Test-IgnitionBrowserReceiptSet {param($Surfaces,$Receipts,$RunStartedAtUtc,$CurrentObservation);return @($CurrentObservation.surfaces).Count -eq 1 -and $CurrentObservation.elapsedMilliseconds -le 15000}
function Get-IgnitionBrowserObservationSet {param($Surfaces,$ObservationClock,$StartedAtUtc);return [pscustomobject]@{observation=[pscustomobject]@{surfaces=@('retained-verified-required-window');admittedSourceHead='';supervisorGeneratedAtBefore='';supervisorGeneratedAtAfter='';completedAtUtc='';elapsedMilliseconds=0};capabilities=@($script:capability)}}
function Get-CurrentIgnitionStartupObservation {
  $script:clock.ElapsedMilliseconds=${row.elapsed};$script:capability.HasExited=$${row.exited}
  ${row.advance?"$script:currentHead='"+A+"'":''}
  return ('${JSON.stringify({packetType:'ignition-startup-admission',sourceCohortState:'CURRENT',sourceHead:B,currentSourceHead:B,startupAdmission:decision.startupAdmission})}' | ConvertFrom-Json)
}
${['Convert-SupervisorRecordToIgnitionStatus','Get-IgnitionOptionalBrowserOutcome','Resolve-IgnitionStatusProjection','Get-IgnitionStatusProjection'].map(definition).join('\n')}
ConvertTo-Json -InputObject (Get-IgnitionStatusProjection -Phase 'ready' -Message 'ready') -Depth 20 -Compress
`);
    const healthy=row.elapsed<=15000&&!row.exited&&!row.advance;
    assert.equal(observed.phase,healthy?'ready':'blocked',JSON.stringify(row));
    assert.equal(observed.currentBrowserObservation.elapsedMilliseconds,row.elapsed);
    assert.equal(observed.currentBrowserObservation.surfaces.length,row.elapsed>15000||row.exited?0:1);
    if(row.advance)assert.equal(observed.blocker,'desktop-ignition-service-proof-unproven');
    else if(!healthy)assert.equal(observed.blocker,'desktop-ignition-browser-proof-unproven');
  }
});

function sourceTruth(head){return {branch:'main',detachedHead:false,hasUpstream:true,upstreamBranch:'origin/main',
  workingTreeDirty:false,aheadCount:0,behindCount:0,headPublished:true,blockedForRemoteTruth:false,
  publicationState:'healthy-synced',head,originHead:head};}
test('actual ordinary approval commands pin parent A before prehook B and real main fences every service effect', {skip:process.platform!=='win32'},async()=>{
  const commandBlock=helper.slice(helper.indexOf('$requestedHead = Get-IgniteRepositoryHead'),helper.indexOf('$openClawStartGatewayApprovalEnvFlag ='));
  assert(commandBlock);
  const commandsFor=parent=>powershell(`
$repoRoot='fixture'
function Get-IgniteRepositoryHead {return '${parent}'}
${commandBlock}
ConvertTo-Json -InputObject @($normalIgniteCommand,$approvedIgniteCommand,$approvedOpenClawRestartCommand) -Compress
`);
  const workspace=mkdtempSync(join(tmpdir(),'ordinary-parent-head-'));
  try {
    for(const parent of [A,B]) {
      const commands=commandsFor(parent);
      for(const command of commands) {
        assert.match(command,new RegExp('--expected-main '+parent+'$'));
        const args=command.slice(command.indexOf(' -- ')+4).split(' ');
        // The actual preflight can converge at B; it does not rewrite the
        // approval helper's A captured before npm ran the prehook.
        const preflight=await genuineDecision();
        assert.equal(preflight.ok,true);assert.equal(preflight.startupAdmission.sourceHead,B);
        const effects=[];
        const result=await main({argv:['--shared-workspace',workspace,...args],platform:'win32',
          sourceTruthFn:()=>sourceTruth(B),currentHeadFn:()=>B,
          ollamaPreflightFn:async()=>{effects.push('ollama');return {state:'ready'};},
          backendPreflightFn:async()=>{effects.push('backend');return {ok:true};},uiPreflightFn:async()=>{effects.push('ui');},
          supervisorFn:async()=>{effects.push('supervisor');return {ok:true};}});
        assert.equal(result,parent===B?0:2);assert.equal(effects.length,parent===B?4:0);
        if(parent===A) {
          const record=JSON.parse(readFileSync(join(workspace,'status/battle-bridge-ignition-supervisor-current.json'),'utf8'));
          assert.equal(record.blockerId,'ignition-parent-head-mismatch');
        }
      }
    }
  } finally {rmSync(workspace,{recursive:true,force:true});}
});
