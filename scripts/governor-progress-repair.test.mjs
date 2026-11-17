import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
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
$script:governorMutationOwner=[pscustomobject]@{acquired=$true;abandoned=$false}
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
  for (const source of [governor, caretaker]) {
    assert.equal(source.split(productionPrefix).length, 2);
  }
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
    assert.equal(body(governor), body(caretaker));
  }
  assert.match(governor, /Global\\Stephanos\.VrResourceGovernor\.V1\.' \+ \$userSid\.Value/);
  assert.match(governor, /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(governor, /GetAccessControl\(\)/);
  assert.match(governor, /AbandonedMutexException/);
  const lifecycle = caretaker.slice(caretaker.indexOf('function Invoke-VrResourceGovernorLifecycle {'),
    caretaker.indexOf('function Get-SovereignCommanderHealth {'));
  assert.doesNotMatch(lifecycle, /Wait-VrResourceGovernorProgress/,
    'caretaker must release ownership before asking the new watcher to advance');
});

test('real concurrent owner makes every one-shot, Watch and caretaker busy without clearing its hold', { skip: !windows }, async t => {
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
