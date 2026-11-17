import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
. ([ScriptBlock]::Create($inputData.body))`;
function run(body, sources = [governor]) {
  const result = spawnSync(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(loader, 'utf16le').toString('base64')], {
    input: JSON.stringify({ sources, body }), encoding: 'utf8', shell: false,
    windowsHide: true, timeout: 20000, maxBuffer: 200000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
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

test('native probes are a closed finite surface with concurrent bounded stream reads', () => {
  assert.match(governor, /ValidateSet\('GpuSnapshot','OllamaInventory','OllamaStop'\)/);
  assert.match(governor, /StandardOutput\.ReadAsync/);
  assert.match(governor, /StandardError\.ReadAsync/);
  assert.match(governor, /governorNativeClock\.Elapsed\.TotalMilliseconds/);
  assert.doesNotMatch(governor, /ReadToEndAsync|WaitForExit\(\)|& \$(?:OllamaExecutable|command\.Source)/);
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

test('actual restrictive hold persists even with no prior state and UNKNOWN never grants model permission', { skip: !windows }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'governor-hold-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const r = run(String.raw`
    $stateRoot='${root.replaceAll("'", "''")}';$statePath=Join-Path $stateRoot 'state.json';$telemetryPath=Join-Path $stateRoot 'events.jsonl'
    $script:governorNativeProbeOwnedHold=$false
    Set-GovernorNativeCustodyHold
    $held=[IO.File]::ReadAllText($statePath)|ConvertFrom-Json
    # This fixture supplies explicit prior direct-child exclusion before testing
    # the separate UNKNOWN-permission writer; ordinary reconcile cannot do this.
    Set-GovernorNativeCustodyHold -Held $false
    $script:governorDependencyHealthy=$false;$lightweightModel='llama3.2:3b'
    function Append-TelemetryEvent {param($Payload)}
    $state=Write-GovernorState -Phase NORMAL -Active $false -ParkAllModels $false -ShouldParkHeavy $false -HeavyModelsAfter @() -ZeroLocalModelInvariant $true
    [pscustomobject]@{hold=$held.nativeProbeCustodyHeld;holdActive=$held.active;holdPhase=$held.phase;heavy=$state.heavyModelAllowed;local=$state.localModelAllowed;healthy=$state.evictionHealthy;zero=$state.zeroLocalModelInvariant;mode=$state.ollamaLoadMode}|ConvertTo-Json -Compress`);
  assert.deepEqual(r, { hold: true, holdActive: true, holdPhase: 'UNKNOWN', heavy: false,
    local: false, healthy: false, zero: false, mode: 'unknown' });
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

test('caretaker preserves a restrictive hold when a child appears between census and parent exit', { skip: !windows }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'governor-child-race-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'Documents', 'Stephanos-openclaw-workspace', 'vr'), { recursive: true });
  const r = run(String.raw`
    $env:USERPROFILE='${root.replaceAll("'", "''")}';$powershellExecutable='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
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
