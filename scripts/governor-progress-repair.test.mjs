import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectVrGovernorExecutionPermissionsV1 } from '../shared/ai/ollamaLoadGovernor.mjs';

const governor = await readFile(new URL('./windows/run-vr-resource-governor.ps1', import.meta.url), 'utf8');
const caretaker = await readFile(new URL('./windows/run-sovereign-commander-hidden.ps1', import.meta.url), 'utf8');
const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const windows = process.platform === 'win32';
const loader = String.raw`$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$inputData=[Console]::In.ReadToEnd() | ConvertFrom-Json
foreach($source in $inputData.sources){
 $tokens=$null;$errors=$null
 $ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
 if($errors.Count){throw 'FIXTURE_SOURCE_PARSE_FAILED'}
 foreach($fn in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)){
  . ([ScriptBlock]::Create($fn.Extent.Text))
 }
}
$script:governorMutationOwner=[pscustomobject]@{acquired=$true;abandoned=$false}
. ([ScriptBlock]::Create($inputData.body))`;
function run(body, sources = [governor]) {
  if (sources.some(source => source.includes('function Invoke-VrResourceGovernorLifecycle {'))
      && !sources.some(source => source.includes('function New-GovernorMutationMutex {'))) sources = [governor, ...sources];
  const result = spawnSync(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(loader, 'utf16le').toString('base64')], {
    input: JSON.stringify({ sources, body }), encoding: 'utf8', shell: false,
    windowsHide: true, timeout: 20000, maxBuffer: 200000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

// Genuine native positives must run under the real normal operator. Elevated
// hosted runners instead prove the typed refusal; fixtures never fake a token.
const nativeContext = windows ? run(String.raw`
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  try{[pscustomobject]@{normal=($identity.ImpersonationLevel -eq [Security.Principal.TokenImpersonationLevel]::None -and -not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and [IntPtr]::Size -eq 8 -and [Environment]::Is64BitProcess)}|ConvertTo-Json -Compress}finally{$identity.Dispose()}
`) : {normal:false};
const normalNativeSkip = !windows ? 'Windows required' : nativeContext.normal ? false : 'GOVERNOR_NATIVE_CONTEXT_UNPROVEN: genuine normal-token fixture is not applicable';

function launch(body, sources) {
  const child = spawn(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(loader, 'utf16le').toString('base64')], { shell: false, windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', value => { stdout += value; });
  child.stderr.setEncoding('utf8').on('data', value => { stderr += value; });
  const done = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('fixture child timeout')); }, 20000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', status => { clearTimeout(timeout); resolve({ status, stdout, stderr }); });
  });
  child.stdin.end(JSON.stringify({ sources, body }));
  return { child, done };
}

async function waitForFixture(path) {
  const started = Date.now();
  while (Date.now() - started < 12000) {
    try { await readFile(path); return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('fixture barrier timeout');
}

function isolatedMutexSources() {
  const productionPrefix = 'Global\\Stephanos.VrResourceGovernor.V1.';
  const fixturePrefix = 'Global\\Stephanos.GovernorFixture.' + randomUUID() + '.';
  assert.equal(governor.split(productionPrefix).length, 2);
  assert.equal(caretaker.split(productionPrefix).length, 1);
  // The only substitution isolates the kernel name. Both actual adapters,
  // SID/DACL validation, acquisition and action/lifecycle paths remain real.
  return [governor.replace(productionPrefix, fixturePrefix), caretaker.replace(productionPrefix, fixturePrefix)];
}

function fixtureStatePaths(root) {
  return String.raw`
    $env:USERPROFILE='${root.replaceAll("'", "''")}'
    $stateRoot=Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace\vr'
    $statePath=Join-Path $stateRoot 'vr-resource-governor-current.json'
    $overridePath=Join-Path $stateRoot 'gaming-resource-override.json'
    $preparePath=Join-Path $stateRoot 'gaming-resource-prepare.json'
    $script:governorNativeProbeOwnedHold=$false
    $script:governorMutationOwner=$null
  `;
}

const fixtureBarrierWait = path => String.raw`
  $clock=[Diagnostics.Stopwatch]::StartNew()
  while(-not (Test-Path -LiteralPath '${path.replaceAll("'", "''")}')) {
    if($clock.Elapsed.TotalSeconds -gt 12){throw 'fixture barrier timeout'}
    Start-Sleep -Milliseconds 10
  }
`;

const fakeChild = String.raw`
$script:governorNativeClock=[Diagnostics.Stopwatch]::StartNew()
function Set-GovernorNativeCustodyHold { param([bool]$Held=$true) $script:held=$Held }
function Resolve-OllamaExecutable { return 'C:\fixture\ollama.exe' }
function Get-Command { [CmdletBinding()]param($Name,$CommandType) [pscustomobject]@{Source='C:\fixture\nvidia-smi.exe'} }
$fake=[pscustomobject]@{
 StartInfo=[pscustomobject]@{FileName='';Arguments='';UseShellExecute=$true;CreateNoWindow=$false;RedirectStandardOutput=$false;RedirectStandardError=$false}
 HasExited=$true;ExitCode=0;Killed=$false;Disposed=$false;CleanupFails=$false
 StandardOutput=[IO.StreamReader]::new([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($outputText)))
 StandardError=[IO.StreamReader]::new([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($errorText)))
}
$fake | Add-Member ScriptMethod Start { return $true }
$fake | Add-Member ScriptMethod WaitForExit { param($milliseconds) if($milliseconds -eq 10){Start-Sleep -Milliseconds 1};return $this.HasExited }
$fake | Add-Member ScriptMethod Kill { $this.Killed=$true;if(-not $this.CleanupFails){$this.HasExited=$true} }
$fake | Add-Member ScriptMethod Dispose { $this.Disposed=$true;$this.StandardOutput.Dispose();$this.StandardError.Dispose() }
function New-Object {
 [CmdletBinding()]param([string]$TypeName,[object[]]$ArgumentList)
 if($TypeName -eq 'System.Diagnostics.Process'){return $fake}
 Microsoft.PowerShell.Utility\New-Object @PSBoundParameters
}
`;

const cpuFixture = root => fixtureStatePaths(root) + String.raw`
    $script:governorMutationOwner=[pscustomobject]@{acquired=$true;abandoned=$false}
    $telemetryPath=Join-Path $stateRoot 'events.jsonl';$lightweightModel='llama3.2:3b'
    $script:governorDependencyHealthy=$true
    function Append-TelemetryEvent {param($Payload)}
    $signal=[pscustomobject]@{active=$false;flatGameActive=$false;airLinkActive=$false;realAirLinkActive=$false;virtualAirLinkTestActive=$false}
    $effective=[pscustomobject]@{active=$false;phase='NORMAL';overrideMode='AUTO';lease=[pscustomobject]@{active=$false}}
    function Publish-CpuFixture {
      $script:governorCpuProbeCycleId=''
      $script:governorNativeClock=[Diagnostics.Stopwatch]::StartNew()
      $script:governorDependencyHealthy=$true
      $null=Write-GovernorState -Phase NORMAL -OverrideMode AUTO -CooldownUntilUtc '' -ZeroLocalModelInvariant $true -HeavyModelsAfter @()
    }
    Publish-CpuFixture
`;

test('CPU continuation comes only from unchanged complete publication and closes every denial edge', {skip:normalNativeSkip}, async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'governor-cpu-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const rows=run(cpuFixture(root)+String.raw`
    $rows=@()
    foreach($mode in @('valid','changed-bytes','duplicate-json','foreign-owner','held','unknown','gaming','prepare','override','stale','future','expired-cycle','signal-unknown','active-signal')){
      Publish-CpuFixture
      $state=Read-GovernorState
      if($mode -ceq 'held'){$state.nativeProbeCustodyHeld=$true}
      if($mode -ceq 'unknown'){$state.dependencyObservationKnown=$false}
      if($mode -ceq 'gaming'){$state.flatGameActive=$true}
      if($mode -ceq 'stale'){$state.updatedAtUtc=[DateTime]::UtcNow.AddSeconds(-11).ToString('o')}
      if($mode -ceq 'future'){$state.updatedAtUtc=[DateTime]::UtcNow.AddSeconds(10).ToString('o')}
      if($mode -in @('held','unknown','gaming','stale','future')){
        # Adversarial producer model: permit its exact bytes past the digest
        # boundary to exercise the independent typed policy checks as well.
        $json=$state|ConvertTo-Json -Depth 8
        [IO.File]::WriteAllText($statePath,$json,[Text.UTF8Encoding]::new($false))
        $script:governorCpuPriorStateSha256=Get-GovernorBytesDigestV1 ([Text.Encoding]::UTF8.GetBytes($json))
      }
      if($mode -ceq 'changed-bytes'){[IO.File]::AppendAllText($statePath,' ')}
      if($mode -ceq 'duplicate-json'){[IO.File]::WriteAllText($statePath,([IO.File]::ReadAllText($statePath).Insert(1,'"active":true,')))}
      if($mode -ceq 'foreign-owner'){$script:governorCpuPriorStateSha256=''}
      if($mode -ceq 'prepare'){[IO.File]::WriteAllText($preparePath,'{}')}
      if($mode -ceq 'override'){$null=Write-OverrideMode -Mode FORCE_OFF}
      if($mode -ceq 'expired-cycle'){$script:governorNativeClock=[pscustomobject]@{Elapsed=[pscustomobject]@{TotalMilliseconds=5001}}}
      if($mode -ceq 'signal-unknown'){$signal.active='false'}
      if($mode -ceq 'active-signal'){$signal.active=$true}
      Start-GovernorCpuProbeContinuity -Signal $signal -Effective $effective
      $after=Read-GovernorState
      $grant=$null;if($after.PSObject.Properties['cpuProbeContinuity']){$grant=$after.cpuProbeContinuity}
      $rows+=,[pscustomobject]@{mode=$mode;granted=($null -ne $grant -and $grant.allowed -eq $true);grant=$grant}
      Revoke-GovernorCpuProbeContinuity
      $signal.active=$false
      if(Test-Path -LiteralPath $preparePath){[IO.File]::Delete($preparePath)}
      if(Test-Path -LiteralPath $overridePath){[IO.File]::Delete($overridePath)}
      # These adversarial fixtures launched no native child.
      if($mode -ceq 'held'){[IO.File]::Delete($statePath)}
    }
    ConvertTo-Json -InputObject $rows -Depth 8 -Compress
  `);
  for(const row of rows)assert.equal(row.granted,row.mode==='valid',row.mode);
  const grant=rows[0].grant;
  assert.equal(typeof grant.ownerCreationFileTime,'string');
  assert.ok(Date.parse(grant.expiresAtUtc)-Date.parse(grant.observedAtUtc)<=5000);
});

test('CPU grant revocation never skips retained-child cleanup even if its state write fails', {skip:!windows},()=>{
  const result=run(String.raw`$outputText='';$errorText=''
    ${fakeChild}
    $fake.HasExited=$false
    function Revoke-GovernorCpuProbeContinuity {throw 'FIXTURE_REVOCATION_IO_FAILURE'}
    $reason='';try{$null=Invoke-GovernorNativeProbe -Operation GpuSnapshot}catch{$reason=$_.Exception.Message}
    [pscustomobject]@{reason=$reason;killed=$fake.Killed;disposed=$fake.Disposed;exitWitness=$script:governorNativeProbeExitProven;known=$script:governorDependencyHealthy}|ConvertTo-Json -Compress
  `);
  assert.deepEqual(result,{reason:'GOVERNOR_CPU_PROBE_REVOCATION_UNPROVEN',killed:true,disposed:true,exitWitness:true,known:false});
});

test('reconciliation exceptions revoke the owned CPU grant before releasing mutation ownership', {skip:normalNativeSkip},async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'governor-cpu-revoke-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const result=run(cpuFixture(root)+String.raw`
    function Get-GpuSnapshot {throw 'FIXTURE_DEPENDENCY_FAILURE'}
    $reason='';try{$null=Invoke-Reconcile -Signal $signal -Effective $effective}catch{$reason=$_.Exception.Message}
    $state=Read-GovernorState
    [pscustomobject]@{reason=$reason;allowed=$state.cpuProbeContinuity.allowed;cycle=$script:governorCpuProbeCycleId}|ConvertTo-Json -Compress
  `);
  assert.deepEqual(result,{reason:'FIXTURE_DEPENDENCY_FAILURE',allowed:false,cycle:''});
});

test('actual Windows producer and native consumer bind one live owner and deny it after exit', {skip:normalNativeSkip},async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'governor-cpu-native-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const ready=join(root,'ready');const release=join(root,'release');
  const producer=launch(cpuFixture(root)+String.raw`
    Start-GovernorCpuProbeContinuity -Signal $signal -Effective $effective
    # No native child is launched in this isolated state/identity fixture.
    Set-GovernorNativeCustodyHold -Held $true -Operation GpuSnapshot -CommandSha256 ('a'*64)
    [IO.File]::WriteAllText('${ready.replaceAll("'","''")}','ready')
    ${fixtureBarrierWait(release)}
    [pscustomobject]@{released=$true}|ConvertTo-Json -Compress
  `,[governor]);
  const nativeDirectory=fileURLToPath(new URL('./windows/starfield-native-build/',import.meta.url));
  const observe=()=>spawnSync('python',[join(nativeDirectory,'governor_owner_fixture.py'),root],
    {encoding:'utf8',shell:false,windowsHide:true,timeout:10000});
  try{
    await waitForFixture(ready);
    const alive=observe();assert.equal(alive.status,0,alive.stderr);
    assert.deepEqual(JSON.parse(alive.stdout),{admitted:true,ownerLive:true});
  }finally{await writeFile(release,'release');}
  const terminal=await producer.done;assert.equal(terminal.status,0,terminal.stderr);
  const dead=observe();assert.equal(dead.status,0,dead.stderr);
  assert.deepEqual(JSON.parse(dead.stdout),{admitted:false,ownerLive:false});
});

test('native metadata admits only an actual non-administrator primary token and otherwise proves its typed refusal', {skip:!windows},()=>{
  const result=run(String.raw`
    $allowed=$false;$reason=''
    try{$null=Get-GovernorNativeMetadataApiV1;$allowed=$true}catch{$reason=$_.Exception.Message}
    [pscustomobject]@{allowed=$allowed;reason=$reason;initialized=($null -ne ('Stephanos.GovernorNativeMetadataV1' -as [type]))}|ConvertTo-Json -Compress
  `);
  assert.equal(result.allowed,nativeContext.normal);
  assert.equal(result.initialized,nativeContext.normal);
  assert.equal(result.reason,nativeContext.normal?'':'GOVERNOR_NATIVE_CONTEXT_UNPROVEN');
});

test('real normal-user direct metadata observes native boot and bounded process snapshot without a child or state write', { skip: normalNativeSkip }, () => {
  const result = run(String.raw`
    $script:governorRecoveryLastElapsed=0.0
    $clock=[Diagnostics.Stopwatch]::StartNew()
    $epoch=Get-GovernorNativeEpochV1
    $api=Get-GovernorNativeMetadataApiV1
    $command=Read-GovernorNativeCommandV1 ($api::GetCurrentProcess())
    $rows=@(Get-GovernorProbeCandidatesV1 $clock)
    [pscustomobject]@{bootKnown=($epoch.bootIdentifier -match '^[a-f0-9]{32}$');machineKnown=($epoch.machineHash -match '^[a-f0-9]{64}$');ownerCurrent=($epoch.ownerProcessId -eq $PID);birthKnown=($epoch.ownerCreationFileTime -gt 0);ownCommandObserved=($command -match 'powershell\.exe' -and $command -match '-EncodedCommand');closedCount=$rows.Count;elapsed=$clock.ElapsedMilliseconds;nativeChildStarted=$false;stateWritten=$false}|ConvertTo-Json -Compress
  `);
  assert.equal(result.bootKnown, true);
  assert.equal(result.machineKnown, true);
  assert.equal(result.ownerCurrent, true);
  assert.equal(result.birthKnown, true);
  assert.equal(result.ownCommandObserved, true);
  assert.ok(result.closedCount >= 0 && result.closedCount <= 64);
  assert.ok(result.elapsed <= 5000);
  assert.equal(result.nativeChildStarted, false);
  assert.equal(result.stateWritten, false);
});

test('definition-only import preserves an existing owner and executes neither ObserveAdmission nor Watch', { skip: !windows }, () => {
  const result=run(String.raw`
    $saved=$script:governorMutationOwner;$statePath='fixture-sentinel';$script:governorDependencyHealthy=$false
    function Get-CimInstance {throw 'IMPORT_OBSERVED_NATIVE_DATA'}
    function Start-Process {throw 'IMPORT_STARTED_PROCESS'}
    function Get-GovernorNativeMetadataApiV1 {throw 'IMPORT_INITIALIZED_NATIVE'}
    . ([scriptblock]::Create($inputData.sources[0])) -Action ObserveAdmission
    [pscustomobject]@{ownerPreserved=[object]::ReferenceEquals($saved,$script:governorMutationOwner);pathPreserved=($statePath -ceq 'fixture-sentinel');dependencyPreserved=($script:governorDependencyHealthy -eq $false);nativeTypeLoaded=($null -ne ('Stephanos.GovernorNativeMetadataV1' -as [type]));returned=$true}|ConvertTo-Json -Compress
  `);
  assert.deepEqual(result,{ownerPreserved:true,pathPreserved:true,dependencyPreserved:true,nativeTypeLoaded:false,returned:true});
});

test('epoch/state binding exhausting the cycle prevents native Start and proves only no-launch cleanup', {skip:!windows},()=>{
  const result=run(String.raw`$outputText='';$errorText=''
    ${fakeChild}
    $script:governorNativeClock=[pscustomobject]@{Elapsed=[pscustomobject]@{TotalMilliseconds=0.0}}
    $script:started=0
    $fake|Add-Member ScriptMethod Start {$script:started++;return $true} -Force
    function Set-GovernorNativeCustodyHold {param([bool]$Held=$true) $script:held=$Held;if($Held){$script:governorNativeClock.Elapsed.TotalMilliseconds=5001.0}}
    $result=Invoke-GovernorNativeProbe -Operation GpuSnapshot
    [pscustomobject]@{reason=$result.reason;started=$script:started;held=$script:held;exitWitness=$script:governorNativeProbeExitProven}|ConvertTo-Json -Compress
  `);
  assert.deepEqual(result,{reason:'CYCLE_DEADLINE',started:0,held:false,exitWitness:true});
});

test('a Start returning after its allowance enters retained-child cleanup without renewing the probe budget', {skip:!windows},()=>{
  const result=run(String.raw`$outputText='';$errorText=''
    ${fakeChild}
    $script:governorNativeClock=[pscustomobject]@{Elapsed=[pscustomobject]@{TotalMilliseconds=0.0}}
    $fake.HasExited=$false
    $fake|Add-Member ScriptMethod Start {$script:governorNativeClock.Elapsed.TotalMilliseconds=5001.0;return $true} -Force
    $result=Invoke-GovernorNativeProbe -Operation GpuSnapshot
    [pscustomobject]@{ok=$result.ok;reason=$result.reason;killed=$fake.Killed;disposed=$fake.Disposed;held=$script:held;exitWitness=$script:governorNativeProbeExitProven}|ConvertTo-Json -Compress
  `);
  assert.deepEqual(result,{ok:false,reason:'PROBE_TIMEOUT',killed:true,disposed:true,held:false,exitWitness:true});
});

test('prospective attempts bind the actual owner and epoch before launch and cannot clear without their exact retained-exit witness', {skip:normalNativeSkip},async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'governor-attempt-binding-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const result=run(fixtureStatePaths(root)+String.raw`
    $actualEpoch=Get-GovernorNativeEpochV1
    $script:fixtureEpoch=$actualEpoch
    function Get-GovernorNativeEpochV1 {if($script:fixtureEpoch -ceq 'THROW'){throw 'NATIVE_EPOCH_UNOBSERVED'};return $script:fixtureEpoch}
    $script:governorMutationOwner=[pscustomobject]@{acquired=$true;abandoned=$false}
    $rows=@()
    foreach($mode in @('unobserved','typed-owner-invalid','no-exit','changed-attempt','changed-epoch','retained-exit')){
      $script:governorNativeProbeOwnedHold=$false;$script:governorNativeAttemptDigest='';$script:governorNativeProbeExitProven=$false
      if(Test-Path -LiteralPath $statePath){[IO.File]::Delete($statePath)}
      $script:fixtureEpoch=$actualEpoch
      if($mode -ceq 'unobserved'){$script:fixtureEpoch='THROW'}
      if($mode -ceq 'typed-owner-invalid'){$script:fixtureEpoch=$actualEpoch|ConvertTo-Json|ConvertFrom-Json;$script:fixtureEpoch.ownerProcessId=[string]$PID}
      $bound=$false;try{Set-GovernorNativeCustodyHold -Held $true -Operation OllamaInventory -CommandSha256 ('a'*64);$bound=$true}catch{}
      $before=Read-GovernorState
      if($mode -ceq 'changed-attempt'){$before.nativeProbeAttempt.commandSha256='b'*64;[IO.File]::WriteAllText($statePath,($before|ConvertTo-Json -Depth 8))}
      if($mode -ceq 'changed-epoch'){$script:fixtureEpoch=$actualEpoch|ConvertTo-Json|ConvertFrom-Json;$script:fixtureEpoch.bootIdentifier='f'*32}
      if($mode -in @('changed-attempt','changed-epoch','retained-exit')){$script:governorNativeProbeExitProven=$true}
      $cleared=$false;try{Set-GovernorNativeCustodyHold -Held $false;$cleared=$true}catch{}
      $after=Read-GovernorState
      $rows+=,[pscustomobject]@{mode=$mode;bound=$bound;phase=$before.nativeProbeAttempt.phase;boot=$before.nativeProbeAttempt.bootIdentifier;ownerMatches=($before.nativeProbeAttempt.ownerProcessId -eq $PID);cleared=$cleared;held=$after.nativeProbeCustodyHeld;local=$after.localModelAllowed;heavy=$after.heavyModelAllowed;known=$after.dependencyObservationKnown}
    }
    ConvertTo-Json -InputObject $rows -Compress
  `);
  assert.equal(result.length,6);
  for(const row of result){
    const observed=!['unobserved','typed-owner-invalid'].includes(row.mode);
    assert.equal(row.bound,observed,row.mode);
    assert.equal(row.phase,observed?'BOUND':'PREPARING',row.mode);
    if(!observed)assert.equal(row.boot,'UNOBSERVED');
    assert.equal(row.ownerMatches,true,row.mode);
    assert.equal(row.cleared,row.mode==='retained-exit',row.mode);
    assert.equal(row.held,row.mode!=='retained-exit',row.mode);
    for(const field of ['local','heavy','known'])assert.equal(row[field],false,row.mode+':'+field);
  }
});

test('native command decoder rejects status, length, pointer and UTF16 adversaries inside the owned 64KiB buffer', {skip:!windows},()=>{
  const result=run(String.raw`
    class CommandMetadataFixture {
      static [string]$Mode
      static [int] NtQueryInformationProcess([IntPtr]$h,[int]$kind,[IntPtr]$buffer,[uint32]$size,[ref]$actual){
        if($kind -ne 60 -or $size -ne 65536){throw 'UNEXPECTED_QUERY'}
        $text=[Text.Encoding]::Unicode.GetBytes('C:\fixture\ollama.exe serve')
        $actual.Value=[uint32](16+$text.Length)
        [Runtime.InteropServices.Marshal]::WriteInt16($buffer,[int16]$text.Length)
        [Runtime.InteropServices.Marshal]::WriteInt16($buffer,2,[int16]$text.Length)
        [Runtime.InteropServices.Marshal]::WriteIntPtr($buffer,8,[IntPtr]::Add($buffer,16))
        [Runtime.InteropServices.Marshal]::Copy($text,0,[IntPtr]::Add($buffer,16),$text.Length)
        switch([CommandMetadataFixture]::Mode){
          'status'{return -1}
          'short'{$actual.Value=[uint32]15}
          'overflow'{$actual.Value=[uint32]65537}
          'odd'{[Runtime.InteropServices.Marshal]::WriteInt16($buffer,1)}
          'max-short'{[Runtime.InteropServices.Marshal]::WriteInt16($buffer,2,2)}
          'header-pointer'{[Runtime.InteropServices.Marshal]::WriteIntPtr($buffer,8,$buffer)}
          'end-pointer'{[Runtime.InteropServices.Marshal]::WriteIntPtr($buffer,8,[IntPtr]::Add($buffer,[int]$actual.Value))}
          'reserved'{[Runtime.InteropServices.Marshal]::WriteInt32($buffer,4,1)}
          'nul'{[Runtime.InteropServices.Marshal]::WriteInt16($buffer,16,0)}
          'surrogate'{[Runtime.InteropServices.Marshal]::WriteInt16($buffer,16,-10240)}
        }
        return 0
      }
    }
    function Get-GovernorNativeMetadataApiV1 {return [CommandMetadataFixture]}
    $rows=@()
    foreach($mode in @('valid','status','short','overflow','odd','max-short','header-pointer','end-pointer','reserved','nul','surrogate')){
      [CommandMetadataFixture]::Mode=$mode;$accepted=$false
      try{$command=Read-GovernorNativeCommandV1 ([IntPtr]1);$accepted=$command -ceq 'C:\fixture\ollama.exe serve'}catch{}
      $rows+=,[pscustomobject]@{mode=$mode;accepted=$accepted}
    }
    ConvertTo-Json -InputObject $rows -Compress
  `);
  assert.equal(result.length,11);
  for(const row of result)assert.equal(row.accepted,row.mode==='valid',row.mode);
});

test('recovery clocks reject backward, nonfinite, malformed and exhausted observations', {skip:!windows},()=>{
  const result=run(String.raw`
    $rows=@()
    foreach($value in @(-1.0,[double]::NaN,[double]::PositiveInfinity,5001.0,'1')){
      $script:governorRecoveryLastElapsed=0.0;$allowed=$true
      try{Assert-GovernorRecoveryDeadlineV1 ([pscustomobject]@{Elapsed=[pscustomobject]@{TotalMilliseconds=$value}})}catch{$allowed=$false}
      $rows+=,$allowed
    }
    $script:governorRecoveryLastElapsed=2.0;$allowed=$true
    try{Assert-GovernorRecoveryDeadlineV1 ([pscustomobject]@{Elapsed=[pscustomobject]@{TotalMilliseconds=1.0}})}catch{$allowed=$false}
    $rows+=,$allowed
    ConvertTo-Json -InputObject $rows -Compress
  `);
  assert.deepEqual(result,Array(6).fill(false));
});

test('closed native census refuses malformed layout, names, duplicate identity and candidate overflow', {skip:!windows},()=>{
  const result=run(String.raw`
    class CensusMetadataFixture {
      static [string]$Mode
      static [int]$Rows
      static [IntPtr] CreateToolhelp32Snapshot([uint32]$flags,[uint32]$id){if($flags -ne 2 -or $id -ne 0){throw 'UNEXPECTED_SNAPSHOT'};return [IntPtr]1}
      static [bool] CloseHandle([IntPtr]$h){return [CensusMetadataFixture]::Mode -cne 'cleanup-failed'}
      static [void] Fill([IntPtr]$b){
        [CensusMetadataFixture]::Rows++
        for($i=0;$i -lt 568;$i+=8){[Runtime.InteropServices.Marshal]::WriteInt64($b,$i,0)}
        [Runtime.InteropServices.Marshal]::WriteInt32($b,568)
        $self=[Diagnostics.Process]::GetCurrentProcess().Id
        $id=$self;$name='powershell.exe'
        if([CensusMetadataFixture]::Rows -gt 1){$id=200000+[CensusMetadataFixture]::Rows;$name='ollama.exe'}
        switch([CensusMetadataFixture]::Mode){
          'bad-size'{[Runtime.InteropServices.Marshal]::WriteInt32($b,556)}
          'empty-name'{$name=''}
          'path-name'{$name='C:\ollama.exe'}
          'wrong-self'{$name='other.exe'}
          'duplicate'{$id=$self}
        }
        [Runtime.InteropServices.Marshal]::WriteInt32($b,8,$id)
        $encoded=[Text.Encoding]::Unicode.GetBytes($name)
        [Runtime.InteropServices.Marshal]::Copy($encoded,0,[IntPtr]::Add($b,44),$encoded.Length)
      }
      static [bool] Process32FirstW([IntPtr]$h,[IntPtr]$b){[CensusMetadataFixture]::Fill($b);return $true}
      static [bool] Process32NextW([IntPtr]$h,[IntPtr]$b){
        if([CensusMetadataFixture]::Mode -in @('duplicate','candidate-overflow')){[CensusMetadataFixture]::Fill($b);return $true}
        throw 'FIXTURE_CENSUS_INCOMPLETE'
      }
    }
    function Get-GovernorNativeMetadataApiV1 {return [CensusMetadataFixture]}
    $rows=@()
    foreach($mode in @('bad-size','empty-name','path-name','wrong-self','duplicate','candidate-overflow','incomplete','cleanup-failed')){
      [CensusMetadataFixture]::Mode=$mode;[CensusMetadataFixture]::Rows=0;$script:governorRecoveryLastElapsed=0.0;$accepted=$true
      try{$null=Get-GovernorProbeCandidatesV1 ([Diagnostics.Stopwatch]::StartNew())}catch{$accepted=$false}
      $rows+=,[pscustomobject]@{mode=$mode;accepted=$accepted;rows=[CensusMetadataFixture]::Rows}
    }
    ConvertTo-Json -InputObject $rows -Compress
  `);
  assert.equal(result.length,8);
  for(const row of result){assert.equal(row.accepted,false,row.mode);assert.ok(row.rows>0&&row.rows<=66,row.mode);}
  assert.equal(result.find(row=>row.mode==='candidate-overflow').rows,66,'reject the 65th candidate, never truncate to 64');
  assert.equal(result.find(row=>row.mode==='duplicate').rows,2);
});

test('only exact canonical serve identity can leave the native probe domain; foreign, active or changed identity stays held', {skip:!windows},()=>{
  const result=run(String.raw`
    class ServeMetadataFixture {
      static [string]$Mode
      static [string]$Path
      static [uint32] GetProcessId([IntPtr]$h){if([ServeMetadataFixture]::Mode -ceq 'wrong-pid'){return 43};return 42}
      static [uint32] WaitForSingleObject([IntPtr]$h,[uint32]$ms){if($ms -ne 0){throw 'UNBOUNDED_WAIT'};if([ServeMetadataFixture]::Mode -ceq 'exited'){return 0};return 258}
      static [bool] GetProcessTimes([IntPtr]$h,[ref]$born,[ref]$exited,[ref]$kernel,[ref]$user){$born.Value=[long]100;$exited.Value=[long]0;return $true}
      static [bool] QueryFullProcessImageNameW([IntPtr]$h,[uint32]$flags,[Text.StringBuilder]$image,[ref]$length){
        $candidatePath=[ServeMetadataFixture]::Path
        if([ServeMetadataFixture]::Mode -ceq 'foreign-image'){$candidatePath='C:\fixture\ollama.exe'}
        [void]$image.Append($candidatePath);$length.Value=[uint32]$candidatePath.Length;return $true
      }
    }
    [ServeMetadataFixture]::Path=Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
    function Get-GovernorNativeMetadataApiV1 {return [ServeMetadataFixture]}
    function Read-GovernorNativeCommandV1 {param([IntPtr]$Handle)
      if([ServeMetadataFixture]::Mode -ceq 'opaque'){throw 'GOVERNOR_RECOVERY_COMMAND_UNPROVEN'}
      $command='"'+[ServeMetadataFixture]::Path+'" serve'
      if([ServeMetadataFixture]::Mode -ceq 'ps'){$command='"'+[ServeMetadataFixture]::Path+'" ps'}
      if([ServeMetadataFixture]::Mode -ceq 'extra-argument'){$command+=' --fixture'}
      if([ServeMetadataFixture]::Mode -ceq 'case-change'){$command=$command.Replace(' serve',' Serve')}
      return $command
    }
    $rows=@()
    foreach($mode in @('valid','wrong-pid','exited','foreign-image','opaque','ps','extra-argument','case-change','changed-birth','changed-command')){
      [ServeMetadataFixture]::Mode=$mode
      $pin=[pscustomobject]@{handle=[IntPtr]1;processId=[uint32]42;birth=[long]0;image='';command=''}
      if($mode -ceq 'changed-birth'){$pin.birth=[long]99}
      if($mode -ceq 'changed-command'){$pin.command='different original command'}
      $allowed=$true;try{Assert-GovernorServePinV1 $pin}catch{$allowed=$false}
      $rows+=,[pscustomobject]@{mode=$mode;allowed=$allowed}
    }
    ConvertTo-Json -InputObject $rows -Compress
  `);
  assert.equal(result.length,10);
  for(const row of result)assert.equal(row.allowed,row.mode==='valid',row.mode);
});

test('legacy recovery archives the original under the real mutex and retires only custody after complete exclusion', {skip:normalNativeSkip},async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'governor-legacy-recovery-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const stateRoot=join(root,'Documents','Stephanos-openclaw-workspace','vr');
  await mkdir(stateRoot,{recursive:true});
  const original=JSON.stringify({schemaVersion:'stephanos.vr-resource-governor.v1',governorVersion:3,
    phase:'NORMAL',active:false,nativeProbeCustodyHeld:true,localModelAllowed:false,heavyModelAllowed:false,dependencyObservationKnown:false});
  await writeFile(join(stateRoot,'vr-resource-governor-current.json'),original);
  const result=run(fixtureStatePaths(root)+String.raw`
    $script:censuses=0
    function Get-GovernorProbeCandidatesV1 {param($Clock) Assert-GovernorRecoveryDeadlineV1 $Clock;$script:censuses++;return @()}
    $script:governorMutationOwner=Enter-GovernorMutationOwner
    try{
      $recovered=Invoke-GovernorHeldProbeRecoveryV1
      $state=Read-GovernorState
      $files=@(Get-ChildItem -LiteralPath (Join-Path $stateRoot 'governor-custody-recovery') -File)
      $archive=[IO.File]::ReadAllText($files[0].FullName)|ConvertFrom-Json
      [pscustomobject]@{recovered=$recovered;censuses=$script:censuses;held=$state.nativeProbeCustodyHeld;local=$state.localModelAllowed;heavy=$state.heavyModelAllowed;known=$state.dependencyObservationKnown;healthy=$state.evictionHealthy;archived=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($archive.originalBytesBase64));outcome=$archive.historicalOutcome;receipt=$state.nativeProbeRecoveryReceiptSha256;retirementClaim=$archive.restrictionRetired}|ConvertTo-Json -Compress
    }finally{Exit-GovernorMutationOwner -Owner $script:governorMutationOwner}
  `,[isolatedMutexSources()[0]]);
  assert.equal(result.recovered,true);
  assert.equal(result.censuses,3);
  assert.equal(result.archived,original);
  assert.equal(result.outcome,'UNKNOWN');
  for(const field of ['held','local','heavy','known','healthy','retirementClaim'])assert.equal(result[field],false,field);
  assert.match(result.receipt,/^[a-f0-9]{64}$/);
});

test('legacy current-domain uncertainty, races and malformed attempts never retire the original hold', {skip:normalNativeSkip},async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'governor-recovery-refusal-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const stateRoot=join(root,'Documents','Stephanos-openclaw-workspace','vr');await mkdir(stateRoot,{recursive:true});
  const result=run(fixtureStatePaths(root)+String.raw`
    Ensure-StateRoot
    # Only this adversarial fixture omits ancestor opens, so a sandbox account
    # lacking parent-profile traverse permission still reaches each state race.
    # The positive normal-operator case above retains the actual ancestor pins.
    function Open-GovernorRecoveryParentPinsV1 {param([string]$Directory) return @()}
    $results=@()
    foreach($mode in @('active-probe','opaque-census','second-census-changed','final-census-changed','changed-state','bad-attempt')){
      $state=[ordered]@{schemaVersion='stephanos.vr-resource-governor.v1';governorVersion=3;phase='NORMAL';active=$false;nativeProbeCustodyHeld=$true;localModelAllowed=$false;heavyModelAllowed=$false;dependencyObservationKnown=$false}
      if($mode -ceq 'bad-attempt'){$state.nativeProbeAttempt=[pscustomobject]@{schemaVersion='future-or-malformed';ownerProcessId='123'}}
      $original=$state|ConvertTo-Json -Depth 8 -Compress
      [IO.File]::WriteAllText($statePath,$original,[Text.UTF8Encoding]::new($false));$script:censuses=0
      function Get-GovernorProbeCandidatesV1 {param($Clock)
        $script:censuses++
        if($mode -ceq 'opaque-census'){throw 'GOVERNOR_RECOVERY_CENSUS_UNPROVEN'}
        if($mode -ceq 'active-probe' -or ($mode -ceq 'second-census-changed' -and $script:censuses -eq 2) -or ($mode -ceq 'final-census-changed' -and $script:censuses -eq 3)){return @([pscustomobject]@{processId=[uint32]42;name='nvidia-smi.exe'})}
        if($mode -ceq 'changed-state' -and $script:censuses -eq 1){$stream.Position=0;$changed=[Text.Encoding]::UTF8.GetBytes([Text.Encoding]::UTF8.GetString($original).Replace('NORMAL','GAMING'));$stream.Write($changed,0,$changed.Length);$stream.Flush($true)}
        return @()
      }
      $script:governorMutationOwner=Enter-GovernorMutationOwner
      try{$recovered=Invoke-GovernorHeldProbeRecoveryV1}finally{Exit-GovernorMutationOwner -Owner $script:governorMutationOwner}
      $held=Read-GovernorState
      $results+=,[pscustomobject]@{mode=$mode;recovered=$recovered;held=$held.nativeProbeCustodyHeld;local=$held.localModelAllowed;heavy=$held.heavyModelAllowed;censuses=$script:censuses}
    }
    ConvertTo-Json -InputObject $results -Compress
  `,[isolatedMutexSources()[0]]);
  assert.equal(result.length,6);
  const expectedCensuses={'active-probe':1,'opaque-census':1,'second-census-changed':2,'final-census-changed':3,'changed-state':2,'bad-attempt':0};
  for(const row of result){assert.equal(row.recovered,false,row.mode);assert.equal(row.held,true,row.mode);assert.equal(row.local,false,row.mode);assert.equal(row.heavy,false,row.mode);assert.equal(row.censuses,expectedCensuses[row.mode],row.mode);}
});

test('native probes are a closed finite surface with concurrent bounded stream reads', () => {
  assert.match(governor, /ValidateSet\('GpuSnapshot','OllamaInventory','OllamaStop'\)/);
  assert.match(governor, /StandardOutput\.ReadAsync/);
  assert.match(governor, /StandardError\.ReadAsync/);
  assert.match(governor, /governorNativeClock\.Elapsed\.TotalMilliseconds/);
  assert.doesNotMatch(governor, /ReadToEndAsync|WaitForExit\(\)|& \$(?:OllamaExecutable|command\.Source)/);
});

test('governor and caretaker use the same fixed SID-bound protected kernel owner', () => {
  for (const name of ['New-GovernorMutationMutex', 'Enter-GovernorMutationOwner',
    'Exit-GovernorMutationOwner', 'Assert-GovernorMutationOwner']) {
    const body = source => {
      const start = source.indexOf('function ' + name + ' {');
      assert.ok(start >= 0);
      const end = source.indexOf('\n}', start) + 2;
      return source.slice(start, end).replaceAll('\r\n', '\n');
    };
    assert.ok(body(governor));
    assert.equal(caretaker.includes('function ' + name + ' {'), false, 'the canonical owner is imported rather than duplicated');
  }
  assert.match(caretaker, /\. \$vrGovernorScript/);
  assert.match(governor, /Global\\Stephanos\.VrResourceGovernor\.V1\.' \+ \$userSid\.Value/);
  assert.match(governor, /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(governor, /GetAccessControl\(\)/);
  assert.match(governor, /AbandonedMutexException/);
  const lifecycle = caretaker.slice(caretaker.indexOf('function Invoke-VrResourceGovernorLifecycle {'),
    caretaker.indexOf('function Get-SovereignCommanderHealth {'));
  assert.doesNotMatch(lifecycle, /Wait-VrResourceGovernorProgress/,
    'caretaker must release ownership before asking the new watcher to advance');
});

test('real concurrent owner makes every one-shot, Watch and caretaker busy without clearing its hold', { skip: normalNativeSkip }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'governor-mutex-busy-'));
  const stateRoot = join(root, 'Documents', 'Stephanos-openclaw-workspace', 'vr');
  await mkdir(stateRoot, { recursive: true });
  await writeFile(join(stateRoot, 'vr-resource-governor-current.json'), JSON.stringify({
    phase: 'NORMAL', active: false, profile: null, nativeProbeCustodyHeld: false,
  }));
  const sources = isolatedMutexSources();
  const ready = join(root, 'ready'), release = join(root, 'release');
  const owner = launch(fixtureStatePaths(root) + String.raw`
    $script:governorMutationOwner=Enter-GovernorMutationOwner
    try {
      Assert-GovernorMutationOwner
      Set-GovernorNativeCustodyHold -Held $true
      [IO.File]::WriteAllText('${ready.replaceAll("'", "''")}','ready')
      ${fixtureBarrierWait(release)}
      # Fixture-only exit witness: real retained-child cleanup is exercised by
      # the separate subprocess/cleanup tests, not this mutex contention case.
      $script:governorNativeProbeExitProven=$true
      Set-GovernorNativeCustodyHold -Held $false
      '{"released":true}'
    } finally {Exit-GovernorMutationOwner -Owner $script:governorMutationOwner}
  `, sources);
  t.after(async () => { await writeFile(release, 'release'); await owner.done; await rm(root, { recursive: true, force: true }); });
  await waitForFixture(ready);
  const heldBytes = await readFile(join(stateRoot, 'vr-resource-governor-current.json'), 'utf8');
  const r = run(fixtureStatePaths(root) + String.raw`
    $script:mutations=0
    function Write-OverrideMode {param($Mode) $script:mutations++;throw 'unexpected mode write'}
    function Clear-PrepareLease {$script:mutations++;throw 'unexpected lease clear'}
    function Write-PrepareLease {param($RequestedProcessName,$RequestedProfileName) $script:mutations++;throw 'unexpected lease write'}
    function Invoke-CurrentReconcile {$script:mutations++;throw 'unexpected reconcile'}
    function Get-VrResourceGovernorProcesses {$script:mutations++;throw 'unexpected census before busy refusal'}
    function Start-Process {$script:mutations++;throw 'unexpected start'}
    function Stop-VerifiedVrResourceGovernor {$script:mutations++;throw 'unexpected kill'}
    $reasons=@()
    foreach($Action in @('SetAuto','ForceOn','ForceOff','PrepareGaming','CancelPrepare','Status','Reconcile')) {
      $result=Invoke-GovernorOneShot
      $reasons+=,$result.state.blocker
      if($result.exitCode -ne 4){throw 'unexpected busy exit'}
    }
    $watch1=Invoke-GovernorWatchTick;$watch2=Invoke-GovernorWatchTick
    $caretaker=Invoke-VrResourceGovernorLifecycle -ExpectedAbsent $true -ProgressProven $false
    $held=[IO.File]::ReadAllText($statePath)|ConvertFrom-Json
    [pscustomobject]@{reasons=$reasons;watch1=$watch1;watch2=$watch2;caretaker=$caretaker.blocker;mutations=$script:mutations;held=$held.nativeProbeCustodyHeld}|ConvertTo-Json -Compress
  `, sources);
  assert.deepEqual(r.reasons, Array(7).fill('GOVERNOR_MUTATION_BUSY'));
  assert.equal(r.watch1, 'GOVERNOR_MUTATION_BUSY');
  assert.equal(r.watch2, 'GOVERNOR_MUTATION_BUSY');
  assert.equal(r.caretaker, 'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_BUSY');
  assert.equal(r.mutations, 0);
  assert.equal(r.held, true);
  assert.equal(await readFile(join(stateRoot, 'vr-resource-governor-current.json'), 'utf8'), heldBytes);
  await writeFile(release, 'release');
  const completed = await owner.done;
  assert.equal(completed.status, 0, completed.stderr);
  assert.deepEqual(JSON.parse(completed.stdout), { released: true });
  const resumed = run(fixtureStatePaths(root) + String.raw`
    $script:immediate=0;$script:lastGuardAt=[DateTime]::MinValue
    function Invoke-ImmediateVrModelEviction {Assert-GovernorMutationOwner;$script:immediate++;return $false}
    function Read-GovernorState {[pscustomobject]@{nativeProbeCustodyHeld=$false;phase='NORMAL';active=$false;reason='idle';overrideMode='AUTO';gameProcessName='';updatedAtUtc=[DateTime]::UtcNow.ToString('o')}}
    function Get-GamingSignal {[pscustomobject]@{gameProcessName=''}}
    function Resolve-EffectiveState {param($Signal,$PriorState) [pscustomobject]@{phase='NORMAL';active=$false;reason='idle';overrideMode='AUTO';profile=[pscustomobject]@{parkAllModels=$false}}}
    [pscustomobject]@{tick=(Invoke-GovernorWatchTick);immediate=$script:immediate}|ConvertTo-Json -Compress
  `, sources);
  assert.deepEqual(resumed, { tick: 'GOVERNOR_WATCH_TICK_COMPLETE', immediate: 1 });
});

test('one-shot Status fallback, mode mutation and exceptions release the actual kernel owner', { skip: !windows }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'governor-mutex-finally-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'Documents', 'Stephanos-openclaw-workspace', 'vr'), { recursive: true });
  const r = run(fixtureStatePaths(root) + String.raw`
    $script:fallbacks=0
    function Invoke-CurrentReconcile {Assert-GovernorMutationOwner;$script:fallbacks++;return [pscustomobject]@{evictionHealthy=$true}}
    $Action='Status';$status=Invoke-GovernorOneShot
    $normal=Enter-GovernorMutationOwner
    $normalReleased=$normal.acquired -and -not $normal.abandoned
    Exit-GovernorMutationOwner -Owner $normal
    $Action='SetAuto';$mode=Invoke-GovernorOneShot
    $override=[IO.File]::ReadAllText($overridePath)|ConvertFrom-Json
    function Invoke-CurrentReconcile {Assert-GovernorMutationOwner;throw 'fixture reconciliation failed'}
    $Action='Status'
    try {Invoke-GovernorOneShot|Out-Null;throw 'fixture expected exception'}catch{$reason=$_.Exception.Message}
    $after=Enter-GovernorMutationOwner
    $exceptionReleased=$after.acquired -and -not $after.abandoned
    Exit-GovernorMutationOwner -Owner $after
    [pscustomobject]@{status=$status.exitCode;fallbacks=$script:fallbacks;normalReleased=$normalReleased;mode=$override.mode;exception=$reason;exceptionReleased=$exceptionReleased}|ConvertTo-Json -Compress
  `, isolatedMutexSources());
  assert.deepEqual(r, { status: 0, fallbacks: 2, normalReleased: true, mode: 'AUTO',
    exception: 'fixture reconciliation failed', exceptionReleased: true });
});

test('actual abandoned kernel ownership retains restrictive custody and never starts a replacement', { skip: !windows }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'governor-mutex-abandoned-'));
  const stateRoot = join(root, 'Documents', 'Stephanos-openclaw-workspace', 'vr');
  await mkdir(stateRoot, { recursive: true });
  await writeFile(join(stateRoot, 'vr-resource-governor-current.json'), JSON.stringify({
    phase: 'NORMAL', active: false, nativeProbeCustodyHeld: false,
    localModelAllowed: true, heavyModelAllowed: true,
  }));
  const sources = isolatedMutexSources();
  const ready = join(root, 'ready'), opened = join(root, 'opened');
  const release = join(root, 'release'), exited = join(root, 'exited');
  const owner = launch(fixtureStatePaths(root) + String.raw`
    $script:governorMutationOwner=Enter-GovernorMutationOwner
    Assert-GovernorMutationOwner
    [IO.File]::WriteAllText('${ready.replaceAll("'", "''")}','ready')
    ${fixtureBarrierWait(release)}
    # Exit this fixture process without ReleaseMutex to exercise the actual
    # Windows abandonment result while another process retains an open handle.
    [Environment]::Exit(0)
  `, sources);
  let contender;
  t.after(async () => {
    await writeFile(release, 'release'); await writeFile(exited, 'exited');
    await Promise.allSettled([owner.done, contender?.done]);
    await rm(root, { recursive: true, force: true });
  });
  await waitForFixture(ready);
  contender = launch(fixtureStatePaths(root) + String.raw`
    $keeper=New-GovernorMutationMutex
    try {
      [IO.File]::WriteAllText('${opened.replaceAll("'", "''")}','opened')
      ${fixtureBarrierWait(exited)}
      $script:starts=0
      function Start-Process {$script:starts++;throw 'unexpected replacement'}
      $lifecycle=Invoke-VrResourceGovernorLifecycle -ExpectedAbsent $true -ProgressProven $false
      $held=[IO.File]::ReadAllText($statePath)|ConvertFrom-Json
      $Action='ForceOff'
      try {Invoke-GovernorOneShot|Out-Null;throw 'fixture expected inherited hold'}catch{$inherited=$_.Exception.Message}
      [pscustomobject]@{blocker=$lifecycle.blocker;starts=$script:starts;held=$held.nativeProbeCustodyHeld;heavy=$held.heavyModelAllowed;local=$held.localModelAllowed;healthy=$held.evictionHealthy;known=$held.dependencyObservationKnown;inherited=$inherited;overrideCreated=(Test-Path -LiteralPath $overridePath)}|ConvertTo-Json -Compress
    } finally {$keeper.Dispose()}
  `, sources);
  await waitForFixture(opened);
  await writeFile(release, 'release');
  const ownerResult = await owner.done;
  assert.equal(ownerResult.status, 0, ownerResult.stderr);
  await writeFile(exited, 'exited');
  const result = await contender.done;
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    blocker: 'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_CHILD_CUSTODY_UNPROVEN', starts: 0,
    held: true, heavy: false, local: false, healthy: false, known: false,
    inherited: 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN', overrideCreated: false,
  });
});

test('caretaker rechecks progress after mutex acquisition and releases ownership after start failure', { skip: !windows }, () => {
  const r = run(String.raw`
    $script:governorMutationOwner=$null
    $born=[DateTime]::UtcNow.AddMinutes(-2)
    $process=[pscustomobject]@{ProcessId=4242;CreationDate=$born}
    function Get-VrResourceGovernorProcesses {$script:vrGovernorInventoryComplete=$true;return @($process)}
    function Get-VrResourceGovernorProgress {param($Process) return [pscustomobject]@{fresh=$true;updatedAtUtc=[DateTime]::UtcNow.ToString('o');custodyHeld=$false}}
    function Test-VrResourceGovernorProcessCurrent {param($Process) return $true}
    $script:mutations=0
    function Stop-VerifiedVrResourceGovernor {param($Process) $script:mutations++;throw 'unexpected recycle'}
    function Start-Process {$script:mutations++;throw 'fixture start failed'}
    $rechecked=Invoke-VrResourceGovernorLifecycle -ExpectedProcess $process -ProgressProven $false -ExpectedProgress ([DateTime]::UtcNow.AddSeconds(-5).ToString('o'))
    function Get-VrResourceGovernorProcesses {$script:vrGovernorInventoryComplete=$true;return @()}
    $env:USERPROFILE='C:\fixture-nonexistent-governor-mutex-test'
    function Get-VrResourceGovernorProgress {param($Process) return [pscustomobject]@{fresh=$false;updatedAtUtc='';custodyHeld=$false}}
    $vrGovernorScript='C:\fixture\governor.ps1';$powershellExecutable='C:\fixture\powershell.exe';$repoRoot='C:\fixture'
    $failed=Invoke-VrResourceGovernorLifecycle -ExpectedAbsent $true -ProgressProven $false
    $after=Enter-GovernorMutationOwner
    $released=$after.acquired -and -not $after.abandoned
    Exit-GovernorMutationOwner -Owner $after
    [pscustomobject]@{rechecked=$rechecked.blocker;recycled=$rechecked.restartRequested;failed=$failed.blocker;mutations=$script:mutations;released=$released}|ConvertTo-Json -Compress
  `, isolatedMutexSources());
  assert.deepEqual(r, { rechecked: '', recycled: false,
    failed: 'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_START_FAILED', mutations: 1, released: true });
});

test('actual native helper drains both streams and preserves fixed arguments', { skip: !windows }, () => {
  const r = run(`$outputText="NAME ID SIZE PROCESSOR UNTIL\n";$errorText='diagnostic'\n${fakeChild}
    $r=Invoke-GovernorNativeProbe -Operation OllamaInventory
    [pscustomobject]@{ok=$r.ok;output=$r.output;arguments=$fake.StartInfo.Arguments;shell=$fake.StartInfo.UseShellExecute;killed=$fake.Killed;disposed=$fake.Disposed}|ConvertTo-Json -Compress`);
  assert.equal(r.ok, true);
  assert.equal(r.output, 'NAME ID SIZE PROCESSOR UNTIL\n');
  assert.equal(r.arguments, 'ps');
  assert.equal(r.shell, false);
  assert.equal(r.killed, false);
  assert.equal(r.disposed, true);
});

test('actual native helper refuses nonzero and oversized output instead of inventing inventory', { skip: !windows }, () => {
  for (const [output, exit, reason] of [['bad', 2, 'NONZERO_EXIT'], ['x'.repeat(40000), 0, 'OUTPUT_LIMIT']]) {
    const r = run(`$outputText='${output}';$errorText=''\n${fakeChild}
      $fake.ExitCode=${exit};$r=Invoke-GovernorNativeProbe -Operation OllamaInventory
      [pscustomobject]@{ok=$r.ok;output=$r.output;reason=$r.reason;disposed=$fake.Disposed}|ConvertTo-Json -Compress`);
    assert.equal(r.ok, false);
    assert.equal(r.output, '');
    assert.equal(r.reason, reason);
    assert.equal(r.disposed, true);
  }
});

test('actual native timeout observes retained direct-child exit and never uses a caller PID', { skip: !windows }, () => {
  const r = run(`$outputText='';$errorText=''\n${fakeChild}
    $fake.HasExited=$false;$r=Invoke-GovernorNativeProbe -Operation OllamaInventory
    [pscustomobject]@{ok=$r.ok;reason=$r.reason;killed=$fake.Killed;exited=$fake.HasExited}|ConvertTo-Json -Compress`);
  assert.deepEqual(r, { ok: false, reason: 'PROBE_TIMEOUT', killed: true, exited: true });
});

test('failed child cleanup retains its restrictive hold and terminal custody classification', { skip: !windows }, () => {
  const r = run(`$outputText='';$errorText=''\n${fakeChild}
    $fake.HasExited=$false;$fake.CleanupFails=$true;$script:held=$false
    function Set-GovernorNativeCustodyHold {$script:held=$true}
    try { Invoke-GovernorNativeProbe -Operation OllamaInventory | Out-Null;throw 'fixture expected hold' }
    catch {[pscustomobject]@{reason=$_.Exception.Message;held=$script:held}|ConvertTo-Json -Compress}`);
  assert.equal(r.reason, 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN');
  assert.equal(r.held, true);
});

test('exit-query and cleanup API exceptions preserve the terminal custody hold', { skip: !windows }, () => {
  for (const mutate of [
    `$fake.PSObject.Properties.Remove('HasExited');$fake|Add-Member ScriptProperty HasExited {throw 'unreadable exit'}`,
    `$fake.HasExited=$false;$fake|Add-Member ScriptMethod WaitForExit {param($ms) throw 'wait failed'} -Force`,
  ]) {
    const r = run(`$outputText='';$errorText=''\n${fakeChild}\n${mutate}
      try {Invoke-GovernorNativeProbe -Operation OllamaInventory|Out-Null;throw 'fixture expected hold'}
      catch {[pscustomobject]@{reason=$_.Exception.Message;held=$script:held}|ConvertTo-Json -Compress}`);
    assert.equal(r.reason, 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN');
    assert.equal(r.held, true);
  }
});

test('actual inventory distinguishes known empty from failed and malformed observations', { skip: !windows }, () => {
  for (const [ok, output, known] of [[true, 'NAME ID SIZE PROCESSOR UNTIL', true],
    [false, '', false], [true, '', false], [true, 'garbage', false],
    [true, 'NAME ID SIZE PROCESSOR UNTIL\ninvalid-row', false]]) {
    const r = run(`$script:governorDependencyHealthy=$true
      function Invoke-GovernorNativeProbe { [pscustomobject]@{ok=$${ok};output='${output.replaceAll("'", "''")}'} }
      $models=@(Get-LoadedOllamaModels -OllamaExecutable 'C:\fixture\ollama.exe')
      [pscustomobject]@{known=$script:governorDependencyHealthy;count=$models.Count}|ConvertTo-Json -Compress`);
    assert.equal(r.known, known);
    assert.equal(r.count, 0);
  }
});

test('actual caretaker progress requires exact publisher birth, fresh time and real advancement, including GAMING', { skip: !windows }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'governor-progress-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'Documents', 'Stephanos-openclaw-workspace', 'vr'), { recursive: true });
  const setup = String.raw`
    $env:USERPROFILE='${root.replaceAll("'", "''")}'
    $powershellExecutable='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    $vrGovernorScript='C:\fixture\run-vr-resource-governor.ps1'
    $vrGovernorScriptPattern=[regex]::Escape($vrGovernorScript)
    $born=[DateTime]::UtcNow.AddMinutes(-2)
    $process=[pscustomobject]@{ProcessId=4242;ExecutablePath=$powershellExecutable;CreationDate=$born;CommandLine=('"'+$powershellExecutable+'" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$vrGovernorScript+'" -Action Watch')}
    $state=[pscustomobject]@{schemaVersion='stephanos.vr-resource-governor.v1';governorVersion=3;phase='GAMING';active=$true;nativeProbeCustodyHeld=$false;publisherProcessId=4242;publisherStartedAtUtc=$born.ToString('o');updatedAtUtc=[DateTime]::UtcNow.ToString('o')}
    $file=Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace\vr\vr-resource-governor-current.json'
    function Publish-Fixture {[IO.File]::WriteAllText($file,($state|ConvertTo-Json -Compress))}
    Publish-Fixture
  `;
  const r = run(setup + String.raw`
    $fresh=Get-VrResourceGovernorProgress -Process $process
    $state.publisherProcessId=9999;Publish-Fixture;$foreign=Get-VrResourceGovernorProgress -Process $process
    $state.publisherProcessId=4242;$state.updatedAtUtc=[DateTime]::UtcNow.AddMinutes(-1).ToString('o');Publish-Fixture;$stale=Get-VrResourceGovernorProgress -Process $process
    $state.updatedAtUtc=[DateTime]::UtcNow.AddMinutes(1).ToString('o');Publish-Fixture;$future=Get-VrResourceGovernorProgress -Process $process
    $state.updatedAtUtc=[DateTime]::UtcNow.ToString('o');$state.nativeProbeCustodyHeld=$true;Publish-Fixture;$held=Get-VrResourceGovernorProgress -Process $process
    $state.nativeProbeCustodyHeld=$false;Publish-Fixture;$baseline=$state.updatedAtUtc
    function Get-VrResourceGovernorProcesses {$script:vrGovernorInventoryComplete=$true;return @($process)}
    $script:advance=$false
    function Start-Sleep {param($Milliseconds) if($script:advance){$state.updatedAtUtc=[DateTime]::UtcNow.ToString('o');Publish-Fixture}}
    $stalled=Wait-VrResourceGovernorProgress -Process $process -After $baseline
    $script:advance=$true;$advancing=Wait-VrResourceGovernorProgress -Process $process -After $baseline
    [pscustomobject]@{fresh=$fresh.fresh;foreign=$foreign.fresh;stale=$stale.fresh;future=$future.fresh;custody=$held.custodyHeld;stalled=$stalled;advancing=$advancing}|ConvertTo-Json -Compress`, [caretaker]);
  assert.deepEqual(r, { fresh: true, foreign: false, stale: false, future: false, custody: true, stalled: false, advancing: true });
});

test('actual restrictive hold persists even with no prior state and UNKNOWN never grants model permission', { skip: normalNativeSkip }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'governor-hold-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const r = run(String.raw`
    $stateRoot='${root.replaceAll("'", "''")}';$statePath=Join-Path $stateRoot 'state.json';$telemetryPath=Join-Path $stateRoot 'events.jsonl'
    $script:governorNativeProbeOwnedHold=$false
    Set-GovernorNativeCustodyHold
    $held=[IO.File]::ReadAllText($statePath)|ConvertFrom-Json
    # This fixture supplies explicit prior direct-child exclusion before testing
    # the separate UNKNOWN-permission writer; ordinary reconcile cannot do this.
    $script:governorNativeProbeExitProven=$true
    Set-GovernorNativeCustodyHold -Held $false
    $script:governorDependencyHealthy=$false;$lightweightModel='llama3.2:3b'
    function Append-TelemetryEvent {param($Payload)}
    $state=Write-GovernorState -Phase NORMAL -Active $false -ParkAllModels $false -ShouldParkHeavy $false -HeavyModelsAfter @() -ZeroLocalModelInvariant $true
    [pscustomobject]@{hold=$held.nativeProbeCustodyHeld;holdActive=$held.active;holdPhase=$held.phase;heavy=$state.heavyModelAllowed;local=$state.localModelAllowed;healthy=$state.evictionHealthy;zero=$state.zeroLocalModelInvariant;mode=$state.ollamaLoadMode}|ConvertTo-Json -Compress`);
  assert.deepEqual(r, { hold: true, holdActive: true, holdPhase: 'UNKNOWN', heavy: false,
    local: false, healthy: false, zero: false, mode: 'unknown' });
});

test('actual FORCE_OFF producer state preserves heavy provider selection while excluding background CPU', { skip: !windows }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'governor-force-off-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = run(String.raw`
    $stateRoot='${root.replaceAll("'", "''")}';$statePath=Join-Path $stateRoot 'state.json';$telemetryPath=Join-Path $stateRoot 'events.jsonl'
    $lightweightModel='llama3.2:3b'
    function Read-OverrideMode {return 'FORCE_OFF'}
    function Read-PrepareLease {return [pscustomobject]@{active=$false;processName='';profileName='';expiresAtUtc=''}}
    function Resolve-GamingProfile {param($Signal,$RequestedProcessName,$RequestedProfileName) return [pscustomobject]@{name='flat-game';processName='Starfield';parkAllModels=$false;lightweightOnly=$true;minFreeVramMiB=4096;cooldownSeconds=90}}
    function Get-GpuSnapshot {return [pscustomobject]@{available=$true;memoryFreeMiB=16384;memoryUsedMiB=0;memoryTotalMiB=16384;utilizationGpu=0}}
    function Resolve-OllamaExecutable {return 'C:\fixture\ollama.exe'}
    function Get-LoadedOllamaModels {param($OllamaExecutable) return @()}
    function Append-TelemetryEvent {param($Payload)}
    $signal=[pscustomobject]@{active=$true;flatGameActive=$true;airLinkActive=$false;realAirLinkActive=$false;virtualAirLinkTestActive=$false;gameProcessId=4242;gameProcessName='Starfield';gameExecutablePath='C:\fixture\Starfield.exe';parentProcessId=0;parentProcessName='';parentExecutablePath='';reason='flat-game-process-active'}
    $effective=Resolve-EffectiveState -Signal $signal -PriorState $null
    Invoke-Reconcile -Signal $signal -Effective $effective -PriorState $null|ConvertTo-Json -Compress -Depth 8
  `);
  assert.equal(state.phase, 'NORMAL');
  assert.equal(state.active, false);
  assert.equal(state.flatGameActive, true);
  assert.equal(state.overrideMode, 'FORCE_OFF');
  assert.equal(state.localModelAllowed, true);
  assert.equal(state.heavyModelAllowed, true);
  assert.equal(state.evictionHealthy, true);
  const permission = projectVrGovernorExecutionPermissionsV1(state);
  assert.equal(permission.localModelAllowed, true);
  assert.equal(permission.heavyModelAllowed, true);
  assert.equal(permission.localCpuAllowed, false);

  const fs = (await import('node:fs')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const { runOllamaProvider } = await import('../stephanos-server/services/llm/providers/ollamaProvider.js');
  const originalRead = fs.readFileSync, originalFetch = globalThis.fetch;
  let observedState = state;
  t.mock.method(fs, 'readFileSync', (path, ...args) => String(path).endsWith('vr-resource-governor-current.json')
    ? JSON.stringify(observedState) : originalRead(path, ...args));
  syncBuiltinESMExports();
  const posted = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/tags')) return { ok: true, status: 200,
      json: async () => ({ models: [{ name: 'qwen3.5:27b' }, { name: 'llama3.2:3b' }] }) };
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);posted.push(body.model);
    return { ok: true, status: 200, json: async () => ({ model: body.model, message: { content: 'operator model preserved' } }) };
  };
  try {
    const request = { model: 'qwen3.5:27b', messages: [{ role: 'user', content: 'Investigate architecture and root cause.' }] };
    const config = { baseURL: 'http://127.0.0.1:11434', ollamaLoadMode: 'performance', forceHeavyModel: true };
    const result = await runOllamaProvider(request, config);
    assert.equal(result.ok, true);
    assert.equal(result.model, 'qwen3.5:27b');
    assert.deepEqual(posted, ['qwen3.5:27b']);
    for (const denial of [{ nativeProbeCustodyHeld: true }, { dependencyObservationKnown: false }]) {
      observedState = { ...state, ...denial };
      assert.equal((await runOllamaProvider(request, config)).ok, false);
      assert.deepEqual(posted, ['qwen3.5:27b'], 'FORCE_OFF cannot override unresolved resource evidence');
    }
  } finally {
    globalThis.fetch = originalFetch;
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('inherited custody hold survives missing GPU and real VR without a probe or publication', { skip: !windows }, () => {
  const r = run(String.raw`
    $held=[pscustomobject]@{nativeProbeCustodyHeld=$true;phase='GAMING';active=$true}
    function Read-GovernorState {return $held}
    $script:probes=0;$script:writes=0
    function Get-GpuSnapshot {$script:probes++;return [pscustomobject]@{available=$false}}
    function Invoke-GovernorNativeProbe {$script:probes++;throw 'unexpected probe'}
    function Ensure-StateRoot {$script:writes++;throw 'unexpected publication'}
    $signal=[pscustomobject]@{realAirLinkActive=$true}
    $effective=[pscustomobject]@{active=$true;profile=[pscustomobject]@{parkAllModels=$true}}
    try {Invoke-Reconcile -Signal $signal -Effective $effective -PriorState $held|Out-Null;throw 'fixture expected hold'}catch{$reconcile=$_.Exception.Message}
    try {Write-GovernorState -Phase NORMAL|Out-Null;throw 'fixture expected hold'}catch{$publication=$_.Exception.Message}
    [pscustomobject]@{reconcile=$reconcile;publication=$publication;probes=$script:probes;writes=$script:writes;held=$held.nativeProbeCustodyHeld}|ConvertTo-Json -Compress`);
  assert.deepEqual(r, { reconcile: 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN',
    publication: 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN', probes: 0, writes: 0, held: true });
});

test('existing malformed state cannot become absent-state permission in either owner', { skip: !windows }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'governor-malformed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'Documents', 'Stephanos-openclaw-workspace', 'vr'), { recursive: true });
  const r = run(String.raw`
    $env:USERPROFILE='${root.replaceAll("'", "''")}'
    $stateRoot=Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace\vr'
    $statePath=Join-Path $stateRoot 'vr-resource-governor-current.json'
    $script:governorNativeProbeOwnedHold=$false
    $missing=Get-VrResourceGovernorProgress -Process $null
    $results=@()
    foreach($content in @('{"nativeProbeCustodyHeld":tr','null','[]','42')) {
      [IO.File]::WriteAllText($statePath,$content)
      try {Set-GovernorNativeCustodyHold;throw 'fixture expected hold'}catch{$prelaunch=$_.Exception.Message}
      try {Invoke-Reconcile|Out-Null;throw 'fixture expected hold'}catch{$reconcile=$_.Exception.Message}
      try {Write-GovernorState -Phase NORMAL|Out-Null;throw 'fixture expected hold'}catch{$publication=$_.Exception.Message}
      $progress=Get-VrResourceGovernorProgress -Process $null
      $results+=,[pscustomobject]@{content=$content;prelaunch=$prelaunch;reconcile=$reconcile;publication=$publication;held=$progress.custodyHeld;readable=$progress.readable;unchanged=([IO.File]::ReadAllText($statePath) -ceq $content)}
    }
    [pscustomobject]@{missingHeld=$missing.custodyHeld;results=$results}|ConvertTo-Json -Compress -Depth 5`, [governor, caretaker]);
  assert.equal(r.missingHeld, false);
  for (const observation of r.results) {
    assert.deepEqual(observation, { content: observation.content, prelaunch: 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN',
      reconcile: 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN', publication: 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN',
      held: true, readable: false, unchanged: true });
  }
});

test('caretaker preserves a restrictive hold when a child appears between census and parent exit', { skip: normalNativeSkip }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'governor-child-race-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'Documents', 'Stephanos-openclaw-workspace', 'vr'), { recursive: true });
  const r = run(fixtureStatePaths(root) + String.raw`
    $powershellExecutable='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    $script:governorMutationOwner=[pscustomobject]@{acquired=$true;abandoned=$false}
    $born=[DateTime]::UtcNow.AddMinutes(-2);$process=[pscustomobject]@{ProcessId=4242;CreationDate=$born}
    function Get-VrResourceGovernorProcesses {$script:vrGovernorInventoryComplete=$true;return @($process)}
    $retained=[pscustomobject]@{Handle=1;StartTime=$born;Path=$powershellExecutable;Killed=$false}
    $retained|Add-Member ScriptMethod Kill {$this.Killed=$true}
    $retained|Add-Member ScriptMethod WaitForExit {param($ms) return $true}
    $retained|Add-Member ScriptMethod Dispose {}
    function Get-Process {[CmdletBinding()]param($Id) return $retained}
    $script:childQueries=0
    function Get-CimInstance {[CmdletBinding()]param($ClassName,$Filter) $script:childQueries++;if($script:childQueries -gt 1){[pscustomobject]@{Name='ollama.exe'}}}
    try {Stop-VerifiedVrResourceGovernor -Process $process;throw 'fixture expected hold'}
    catch {$reason=$_.Exception.Message}
    $file=Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace\vr\vr-resource-governor-current.json'
    $state=[IO.File]::ReadAllText($file)|ConvertFrom-Json
    [pscustomobject]@{reason=$reason;killed=$retained.Killed;held=$state.nativeProbeCustodyHeld;heavy=$state.heavyModelAllowed;local=$state.localModelAllowed}|ConvertTo-Json -Compress`, [caretaker]);
  assert.deepEqual(r, { reason: 'GOVERNOR_CHILD_CUSTODY_UNPROVEN', killed: true, held: true, heavy: false, local: false });
});
