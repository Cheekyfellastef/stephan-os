import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('./windows/retarget-stephanos-local-shortcut.ps1', import.meta.url));
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const escapePs = value => "'" + value.replaceAll("'", "''") + "'";
const nativeEngine = { skip: process.platform === 'win32' ? false : 'Requires the fixed Windows PowerShell engine.' };
const ORDINARY_ARGUMENTS = '-Mode launcher-root -BootMode cockpit -Unattended';
const SCENARIOS = ['preview', 'apply', 'invalid-head', 'invalid-hash', 'system-user', 'administrator', 'session-zero',
  'profile-mismatch', 'foreign-desktop', 'noncanonical-adapter', 'missing-link', 'wrong-preimage',
  'oversize-input', 'capture-short', 'capture-grow', 'capture-truncate', 'reparse-input', 'attributes-denied', 'backup-conflict',
  'source-failed', 'source-wrong-head', 'source-dirty', 'source-error', 'source-race', 'context-race',
  'preimage-race', 'save-failed', 'save-ignored', 'wrong-target', 'wrong-args', 'wrong-directory',
  'metadata-changed', 'readback-race', 'post-source-race'];

let capturedFunctionRows;
function functionCases(t) { return capturedFunctionRows ||= runFunctionCases(t); }
async function runFunctionCases(t) {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-shortcut-function-tests-'));
  const actual = await realpath(root);
  assert.equal(dirname(actual), await realpath(tmpdir()));
  assert.ok(basename(actual).startsWith('stephanos-shortcut-function-tests-'));
  t.after(() => rm(actual, { recursive: true, force: true }));
  const script = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Set-StrictMode -Version Latest
$sourcePath = SOURCE_PATH
$base = TEST_ROOT
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($sourcePath,[ref]$tokens,[ref]$errors)
if (@($errors).Count) { throw ('Adapter parse failure: ' + ($errors.Message -join '; ')) }
$parameters=@($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
if (($parameters -join ',') -cne 'ExpectedHead,ExpectedShortcutSha256,Apply') { throw 'Unexpected operation parameters.' }
foreach($definition in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)) {
  Invoke-Expression $definition.Extent.Text
}

$script:Case=''; $script:Observation=$null; $script:LinkPath=''; $script:LinkMetadata=$null
$script:SourceCalls=0; $script:SaveCalls=0; $script:ShellCalls=0; $script:ObservationCalls=0; $script:ReadStreamsDisposed=0
function Get-StephanosRetargetOperatorObservation {
  $script:ObservationCalls++
  $observation=$script:Observation.PSObject.Copy()
  if($script:Case -eq 'context-race' -and $script:ObservationCalls -ge 2) { $observation.Desktop=[IO.Path]::Combine($observation.Profile,'SecondDesktop') }
  return $observation
}
function Get-StephanosRetargetSourceProof($Context) {
  $script:SourceCalls++
  if($script:Case -eq 'source-error') { throw 'private-fixture-secret-path' }
  if($script:Case -eq 'preimage-race' -and $script:SourceCalls -eq 2) { [IO.File]::WriteAllText($script:LinkPath,'concurrent-before-save') }
  return [pscustomobject]@{
    ok=($script:Case -ne 'source-failed')
    head=$(if($script:Case -eq 'source-wrong-head' -or ($script:Case -eq 'source-race' -and $script:SourceCalls -eq 2) -or
      ($script:Case -eq 'post-source-race' -and $script:SourceCalls -eq 3)){'a'*40}else{'b'*40})
    publicationState=$(if($script:Case -eq 'source-dirty'){'local-uncommitted'}else{'healthy-synced'})
  }
}
function Get-StephanosRetargetPathAttributes([string]$Path) {
  if($Path -ceq $script:LinkPath -and $script:Case -eq 'reparse-input'){return [IO.FileAttributes]::ReparsePoint}
  if($Path -ceq $script:LinkPath -and $script:Case -eq 'attributes-denied'){throw [UnauthorizedAccessException]::new('private-fixture-attribute-secret')}
  return [IO.File]::GetAttributes($Path)
}
function Open-StephanosRetargetBinaryRead([string]$Path) {
  if($script:Case -like 'capture-*' -and $Path -ceq $script:LinkPath) {
    $stream=[pscustomobject]@{Length=$script:Original.Length; Calls=0}
    $stream | Add-Member ScriptMethod Read {
      param([byte[]]$buffer,[int]$offset,[int]$count)
      if($this.Calls -gt 0){return 0}
      $this.Calls++
      $size=$script:Original.Length
      if($script:Case -eq 'capture-short' -or $script:Case -eq 'capture-truncate'){$size--}
      [Array]::Copy($script:Original,0,$buffer,$offset,$size)
      if($script:Case -eq 'capture-grow'){$this.Length++}
      if($script:Case -eq 'capture-truncate'){$this.Length--}
      return $size
    }
    $stream | Add-Member ScriptMethod Dispose {$script:ReadStreamsDisposed++}
    return $stream
  }
  return [IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
}
function New-StephanosRetargetShell {
  $shell=[pscustomobject]@{}
  $shell | Add-Member ScriptMethod CreateShortcut {
    param([string]$Path)
    if($Path -cne $script:LinkPath){throw 'Unexpected shortcut path.'}
    $script:ShellCalls++
    if($script:Case -eq 'readback-race' -and $script:ShellCalls -eq 3){[IO.File]::WriteAllText($script:LinkPath,'concurrent-readback')}
    $link=$script:LinkMetadata.PSObject.Copy()
    $link | Add-Member ScriptMethod Save {
      $script:SaveCalls++
      if($script:Case -eq 'save-failed'){throw 'private-fixture-save-secret'}
      if($script:Case -eq 'save-ignored'){return}
      $script:LinkMetadata=[pscustomobject]@{TargetPath=$this.TargetPath;Arguments=$this.Arguments;WorkingDirectory=$this.WorkingDirectory
        Description=$this.Description;IconLocation=$this.IconLocation;Hotkey=$this.Hotkey;WindowStyle=$this.WindowStyle}
      if($script:Case -eq 'wrong-target'){$script:LinkMetadata.TargetPath='C:\Windows\System32\cmd.exe'}
      if($script:Case -eq 'wrong-args'){$script:LinkMetadata.Arguments='http://unreviewed.invalid/'}
      if($script:Case -eq 'wrong-directory'){$script:LinkMetadata.WorkingDirectory=$script:Observation.Profile}
      if($script:Case -eq 'metadata-changed'){$script:LinkMetadata.Description='changed'}
      [IO.File]::WriteAllText($script:LinkPath,('saved '+$script:LinkMetadata.TargetPath+'|'+$script:LinkMetadata.Arguments+'|'+$script:LinkMetadata.WorkingDirectory))
    }
    return $link
  }
  return $shell
}
$results=@()
foreach($case in SCENARIO_LIST) {
  $script:Case=$case; $script:SourceCalls=0; $script:SaveCalls=0; $script:ShellCalls=0; $script:ObservationCalls=0; $script:ReadStreamsDisposed=0
  $profile=[IO.Path]::Combine($base,$case); $desktop=[IO.Path]::Combine($profile,'Desktop'); $local=[IO.Path]::Combine($profile,'AppData\Local')
  $repo=[IO.Path]::Combine($profile,'Documents\GitHub\stephan-os')
  foreach($directory in @($desktop,$local,([IO.Path]::Combine($repo,'windows')),([IO.Path]::Combine($profile,'SecondDesktop')))) {[void][IO.Directory]::CreateDirectory($directory)}
  [IO.File]::WriteAllText([IO.Path]::Combine($repo,'windows\Launch-Stephanos-Local.cmd'),'canonical-target-fixture')
  $script:LinkPath=[IO.Path]::Combine($desktop,'Stephanos Local.lnk')
  $script:Original=[Text.Encoding]::UTF8.GetBytes('original-link-preimage')
  [IO.File]::WriteAllBytes($script:LinkPath,$script:Original)
  $wrapper=[IO.Path]::Combine($profile,'Open-Stephanos-OneClick.ps1');[IO.File]::WriteAllText($wrapper,'front-only-wrapper-untouched')
  $other=[IO.Path]::Combine($desktop,'Other.lnk');[IO.File]::WriteAllText($other,'other-link-untouched')
  $script:LinkMetadata=[pscustomobject]@{TargetPath='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe';Arguments='-File old-wrapper.ps1'
    WorkingDirectory=$profile;Description='original';IconLocation='original.ico';Hotkey='';WindowStyle=1}
  $script:Observation=[pscustomobject]@{Sid='S-1-5-21-1-2-3-1002';Interactive=$true;SessionId=1;Administrator=$false
    Profile=$profile;EnvironmentProfile=$profile;RegisteredProfile=$profile;Desktop=$desktop;LocalAppData=$local}
  $script:StephanosRetargetSourcePath=[IO.Path]::Combine($repo,'scripts\windows\retarget-stephanos-local-shortcut.ps1')
  $expectedHash=Get-StephanosRetargetDigest $script:Original; $expectedHead='b'*40
  $backupRoot=[IO.Path]::Combine($local,'Stephanos\shortcut-retarget')
  $expectedBackup=[IO.Path]::Combine($backupRoot,'Stephanos Local.preimage-'+$expectedHash+'.lnk')
  switch($case) {
    'invalid-head' {$expectedHead='B'*40}
    'invalid-hash' {$expectedHash='x'*64}
    'system-user' {$script:Observation.Sid='S-1-5-18'}
    'administrator' {$script:Observation.Administrator=$true}
    'session-zero' {$script:Observation.SessionId=0}
    'profile-mismatch' {$script:Observation.RegisteredProfile=[IO.Path]::Combine($profile,'wrong')}
    'foreign-desktop' {$script:Observation.Desktop=$base}
    'noncanonical-adapter' {$script:StephanosRetargetSourcePath=[IO.Path]::Combine($profile,'other.ps1')}
    'missing-link' {[IO.File]::Delete($script:LinkPath)}
    'wrong-preimage' {$expectedHash='0'*64}
    'oversize-input' {[IO.File]::WriteAllBytes($script:LinkPath,[byte[]]::new(65537))}
    'backup-conflict' {[void][IO.Directory]::CreateDirectory($backupRoot);[IO.File]::WriteAllText($expectedBackup,'existing-conflicting-backup')}
  }
  $outcome=Invoke-StephanosLocalShortcutRetarget $expectedHead $expectedHash ($case -ne 'preview')
  $backupHash=if([IO.File]::Exists($expectedBackup)){Get-StephanosRetargetDigest ([IO.File]::ReadAllBytes($expectedBackup))}else{''}
  $results += [pscustomobject]@{name=$case;outcome=$outcome;exitCode=(Get-StephanosRetargetExitCode $outcome)
    sourceCalls=$script:SourceCalls;saveCalls=$script:SaveCalls;shellCalls=$script:ShellCalls;streamsDisposed=$script:ReadStreamsDisposed
    backupExists=[IO.File]::Exists($expectedBackup);backupHash=$backupHash;backupDirectoryExists=[IO.Directory]::Exists($backupRoot)
    wrapper=[IO.File]::ReadAllText($wrapper);otherLink=[IO.File]::ReadAllText($other)
    linkHash=$(if([IO.File]::Exists($script:LinkPath)){Get-StephanosRetargetDigest ([IO.File]::ReadAllBytes($script:LinkPath))}else{''})}
}
ConvertTo-Json -InputObject $results -Depth 9 -Compress
`.replace('SOURCE_PATH', escapePs(SOURCE)).replace('TEST_ROOT', escapePs(actual))
    .replace('SCENARIO_LIST', '@(' + SCENARIOS.map(escapePs).join(',') + ')');
  const proof = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', shell: false, windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(proof.status, 0, proof.stderr || proof.stdout);
  assert.equal(proof.stderr, '');
  assert.equal(proof.stdout.includes('private-fixture'), false);
  const rows = JSON.parse(proof.stdout);
  assert.equal(rows.length, SCENARIOS.length);
  return new Map(rows.map(row => [row.name, row]));
}

test('actual PowerShell retarget functions preserve readonly preview and exact one-link apply', nativeEngine, async t => {
  const rows = await functionCases(t);
  const preview = rows.get('preview');
  assert.equal(preview.outcome.status, 'PREVIEW');
  assert.equal(preview.outcome.ok, true);
  assert.equal(preview.outcome.sourceQualified, false);
  assert.equal(preview.outcome.applyAdmission, false);
  assert.equal(preview.outcome.arguments, ORDINARY_ARGUMENTS);
  assert.equal(preview.sourceCalls, 0);
  assert.equal(preview.saveCalls, 0);
  assert.equal(preview.backupDirectoryExists, false);
  assert.equal(preview.linkHash, preview.outcome.preimageSha256);
  const applied = rows.get('apply');
  assert.equal(applied.outcome.status, 'RETARGETED', applied.outcome.blocker);
  assert.equal(applied.outcome.retargeted, true);
  assert.equal(applied.outcome.sourceQualified, true);
  assert.equal(applied.saveCalls, 1);
  assert.equal(applied.sourceCalls, 3);
  assert.equal(applied.backupHash, applied.outcome.expectedShortcutSha256);
  assert.equal(applied.linkHash, applied.outcome.afterSha256);
  assert.notEqual(applied.linkHash, applied.outcome.expectedShortcutSha256);
  assert.equal(applied.outcome.arguments, ORDINARY_ARGUMENTS);
  assert.match(applied.outcome.targetPath, /windows\\Launch-Stephanos-Local\.cmd$/);
  assert.equal(applied.exitCode, 0);
  for (const row of rows.values()) {
    assert.equal(row.wrapper, 'front-only-wrapper-untouched', row.name);
    assert.equal(row.otherLink, 'other-link-untouched', row.name);
    assert.equal(row.outcome.launcherExecuted, false);
    assert.equal(row.outcome.tasksChanged, false);
    assert.equal(row.outcome.atomicityClaimed, false);
    assert.equal(row.outcome.executionQualificationClaimed, false);
    if (['preview', 'apply'].includes(row.name)) continue;
    assert.equal(row.outcome.ok, false, row.name);
    assert.equal(row.outcome.status, 'BLOCKED', row.name);
    assert.equal(row.outcome.retargeted, false, row.name);
    assert.equal(row.outcome.applyAdmission, false, row.name);
    assert.equal(row.outcome.sourceQualified, false, row.name);
    assert.equal(row.exitCode, 2, row.name);
    assert.match(row.outcome.blocker, /^STEPHANOS_LOCAL_SHORTCUT_[A-Z_]+$/, row.name);
    const afterSave = ['save-failed', 'save-ignored', 'wrong-target', 'wrong-args', 'wrong-directory',
      'metadata-changed', 'readback-race', 'post-source-race'].includes(row.name);
    assert.equal(row.saveCalls, afterSave ? 1 : 0, row.name);
    assert.equal(row.outcome.mutationAttempted, afterSave, row.name);
    if (afterSave) assert.equal(row.backupHash, row.outcome.expectedShortcutSha256, row.name);
    if (row.name.startsWith('capture-')) assert.equal(row.streamsDisposed, 1, row.name);
  }
});

test('the actual CLI parameter block rejects caller-selected paths without entering any adapter body', nativeEngine, () => {
  // Test the unchanged declared binding with a sentinel body; never override
  // host script execution policy or enter real operator/Desktop context.
  const script = `$ErrorActionPreference='Stop'; $tokens=$null; $errors=$null; `
    + `$ast=[Management.Automation.Language.Parser]::ParseFile(${escapePs(SOURCE)},[ref]$tokens,[ref]$errors); `
    + `$entry=[scriptblock]::Create($ast.ParamBlock.Extent.Text+[Environment]::NewLine+"throw 'ADAPTER_BODY_MUST_NOT_RUN'"); `
    + `& $entry -ExpectedHead '${'b'.repeat(40)}' -ExpectedShortcutSha256 '${'0'.repeat(64)}' -ShortcutPath 'unadmitted.lnk'`;
  const proof = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
  { encoding: 'utf8', shell: false, windowsHide: true, timeout: 10_000 });
  assert.notEqual(proof.status, 0);
  assert.match(proof.stderr, /ShortcutPath/);
  assert.equal(proof.stderr.includes('ADAPTER_BODY_MUST_NOT_RUN'), false);
  assert.equal(proof.stdout.includes('RETARGETED'), false);
});

test('source remains one fixed probe and one fixed shortcut target without alternate launch authority', async () => {
  const source = await readFile(SOURCE, 'utf8');
  assert.match(source, /C:\\Program Files\\nodejs\\node\.exe/);
  assert.match(source, /--source-truth-json/);
  assert.match(source, /WaitForExit\(30000\)/);
  assert.match(source, /UseShellExecute = \$false/);
  assert.match(source, /EnvironmentVariables\.Clear\(\)/);
  assert.equal(/Start-ScheduledTask|Register-ScheduledTask|Start-Service|Stop-Service|Launch-Stephanos-Local\.cmd\s+http/i.test(source), false);
});

test('actual installed fixed arguments defer actual optional preparation branches and retain mandatory holds', nativeEngine, async t => {
  const saved = (await functionCases(t)).get('apply').outcome.arguments;
  assert.equal(saved, ORDINARY_ARGUMENTS);
  const launcher = fileURLToPath(new URL('../windows/Launch-Stephanos-Local.ps1', import.meta.url));
  const script = String.raw`
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Set-StrictMode -Version Latest
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile(LAUNCHER_PATH,[ref]$tokens,[ref]$errors)
if(@($errors).Count){throw 'Launcher source parse failed.'}
$names=@('Invoke-SovereignCommanderRetainedCustodyPreparation','Invoke-SovereignFixedRuntimeCommissioning',
  'Resolve-IgnitionStatusProjection','Test-BattleBridgeSupervisorFinalContract','Assert-UnattendedVitePortVacant')
foreach($name in $names){
 $node=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true)
 if($null -eq $node){throw ('Missing actual function '+$name)}
 Invoke-Expression $node.Extent.Text
}
$binding=[scriptblock]::Create($ast.ParamBlock.Extent.Text+[Environment]::NewLine+'[pscustomobject]@{Mode=$Mode;BootMode=$BootMode;Unattended=[bool]$Unattended}')
$bound=& $binding FIXED_ARGUMENTS
$script:Mode=$bound.Mode;$script:Unattended=[Management.Automation.SwitchParameter]::new($bound.Unattended)
$script:Logs=[Collections.Generic.List[string]]::new();$script:Forbidden=[Collections.Generic.List[string]]::new()
function Write-LiveLog([string]$Message){$script:Logs.Add($Message)}
function Test-Path {$script:Forbidden.Add('filesystem/native preparation');throw 'OPTIONAL_PREPARATION_MUST_DEFER'}
function Add-Type {$script:Forbidden.Add('UI assembly');throw 'UI_MUST_NOT_LOAD'}
function Read-Host {$script:Forbidden.Add('dialog');throw 'DIALOG_MUST_NOT_OPEN'}
function Start-Process {$script:Forbidden.Add('process start');throw 'PROCESS_MUST_NOT_START'}
function Stop-Process {$script:Forbidden.Add('process stop');throw 'PROCESS_MUST_NOT_STOP'}
function Restart-Computer {$script:Forbidden.Add('restart');throw 'RESTART_MUST_NOT_RUN'}
function Write-IgnitionStatus {$script:Forbidden.Add('preparation publication');throw 'PREPARATION_MUST_NOT_PUBLISH'}
function Write-IgnitionSupportSnapshot {$script:Forbidden.Add('preparation snapshot');throw 'PREPARATION_MUST_NOT_PUBLISH'}
$repoRoot='C:\test-only-preparation-owner'
$custody=Invoke-SovereignCommanderRetainedCustodyPreparation
$fixedRuntime=Invoke-SovereignFixedRuntimeCommissioning
$fixedForbidden=@($script:Forbidden)
# The predecessor's empty argument contract binds interactive defaults and
# enters the real preparation body. Intercept its first dependency, no UI.
$old=& $binding
$script:Mode=$old.Mode;$script:Unattended=[Management.Automation.SwitchParameter]::new($old.Unattended)
$predecessorEntered=$false
try{[void](Invoke-SovereignCommanderRetainedCustodyPreparation)}catch{$predecessorEntered=$_.Exception.Message -eq 'OPTIONAL_PREPARATION_MUST_DEFER'}
$script:Mode=$bound.Mode;$script:Unattended=[Management.Automation.SwitchParameter]::new($bound.Unattended)
function Convert-SupervisorRecordToIgnitionStatus {return $null}
function Get-IgnitionOptionalBrowserOutcome {return @()}
function Get-IgnitionStageSnapshot {return @()}
$visiblePowerShellRequired=$false
$ignitionSplashPath='fixture-splash';$ignitionStatusPath='fixture-status';$ignitionProofRoot=$env:TEMP
$ignitionTranscriptPath='fixture-transcript';$ignitionSupportSnapshotPath='fixture-snapshot'
$ignitionBrowserSurfaceReceiptPath='fixture-browser';$battleBridgeSupervisorCurrentPath='fixture-supervisor'
$arguments=@{LaunchMode=$bound.Mode;Phase='checking-dependencies';Message='Fixture';Extra=@{};SupervisorRecord=$null
 ExpectedHead=('b'*40);LatestOpenClawStartup=$null;RequestedBrowserSurfaces=@();BrowserReceipts=@();AutoOpenEnabled=$true
 RunStartedAtUtc=[datetime]::UtcNow;CurrentBrowserObservation=$null;StartupObservation=$null}
$pending=Resolve-IgnitionStatusProjection @arguments
$arguments.Phase='ready'
$serviceHold=Resolve-IgnitionStatusProjection @arguments
$arguments.SupervisorRecord=[pscustomobject]@{currentPhase='ready';trafficLight='green'
 sourceTruthVerdict=[pscustomobject]@{state='ready';expectedHead=('b'*40)}
 services=[pscustomobject]@{backend8787=[pscustomobject]@{ready=$true};stephanosUi4173=[pscustomobject]@{ready=$true
 servedRuntimeProof=[pscustomobject]@{ready=$true;currentHead=('b'*40)}}}}
function Test-IgnitionBrowserReceiptSet {return $false}
$browserHold=Resolve-IgnitionStatusProjection @arguments
function Test-IgnitionBrowserReceiptSet {return $true}
$sourceHold=Resolve-IgnitionStatusProjection @arguments
function Get-CimInstance {return [pscustomobject]@{LocalPort=5173}}
$processHold=''
try{Assert-UnattendedVitePortVacant}catch{$processHold=$_.Exception.Message}
ConvertTo-Json -Depth 9 -Compress -InputObject ([ordered]@{bound=$bound;custody=$custody;fixedRuntime=$fixedRuntime
 logs=@($script:Logs);fixedForbidden=$fixedForbidden;predecessorEntered=$predecessorEntered;pending=$pending
 serviceHold=$serviceHold;browserHold=$browserHold;sourceHold=$sourceHold;processHold=$processHold})
`.replace('LAUNCHER_PATH', escapePs(launcher)).replace('FIXED_ARGUMENTS', saved);
  const proof = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 });
  assert.equal(proof.status, 0, proof.stderr || proof.stdout);
  const result = JSON.parse(proof.stdout);
  assert.deepEqual(result.bound, { Mode: 'launcher-root', BootMode: 'cockpit', Unattended: true });
  assert.equal(result.custody, false);
  assert.equal(result.fixedRuntime, false);
  assert.deepEqual(result.fixedForbidden, []);
  assert.equal(result.predecessorEntered, true, 'empty arguments entered the actual retained preparation dependency');
  assert.equal(result.pending.optionalPreparations.fixedRuntimeCommissioning.preparation, 'DEFERRED');
  assert.equal(result.pending.optionalPreparations.fixedRuntimeCommissioning.observedState, 'UNKNOWN');
  assert.equal(result.pending.optionalPreparations.fixedRuntimeCommissioning.qualificationProven, false);
  assert.equal(result.pending.optionalPreparations.retainedCustodyPreparation.preparation, 'DEFERRED');
  assert.equal(result.pending.optionalPreparations.retainedCustodyPreparation.custodyReleased, false);
  assert.equal(result.pending.nativeCommissioningState, 'UNPROVEN');
  assert.equal(result.serviceHold.blocker, 'desktop-ignition-service-proof-unproven');
  assert.equal(result.browserHold.blocker, 'desktop-ignition-browser-proof-unproven');
  assert.equal(result.sourceHold.blocker, 'desktop-ignition-startup-admission-unproven');
  assert.equal(result.processHold, 'UNATTENDED_VITE_PORT_OCCUPIED');
  for (const value of [result.pending, result.serviceHold, result.browserHold, result.sourceHold]) {
    assert.equal(value.enterStephanosEnabled, false);
    assert.equal(value.nativeCommissioningState, 'UNPROVEN');
  }
});

test('actual CMD control flow forwards fixed ordinary arguments and defers its failure pause', nativeEngine, async t => {
  const saved = (await functionCases(t)).get('apply').outcome.arguments;
  assert.equal(saved, ORDINARY_ARGUMENTS);
  const root = await mkdtemp(join(tmpdir(), 'stephanos-cmd-ordinary-contract-'));
  const actual = await realpath(root);
  assert.equal(dirname(actual), await realpath(tmpdir()));
  assert.ok(basename(actual).startsWith('stephanos-cmd-ordinary-contract-'));
  t.after(() => rm(actual, { recursive: true, force: true }));
  const capture = join(actual, 'child-arguments.txt'), pause = join(actual, 'pause-called.txt');
  const child = join(actual, 'fixed-powershell-spy.cmd'), pauseSpy = join(actual, 'fixed-pause-spy.cmd');
  await writeFile(child, `@echo off\r\necho %*>"${capture}"\r\nexit /b 1\r\n`);
  await writeFile(pauseSpy, `@echo off\r\necho pause>"${pause}"\r\nexit /b 0\r\n`);
  const source = await readFile(new URL('../windows/Launch-Stephanos-Local.cmd', import.meta.url), 'utf8');
  assert.equal((source.match(/^\s*powershell\.exe /gm) || []).length, 2);
  assert.equal((source.match(/pause >nul/g) || []).length, 1);
  // Keep the actual branches, argument scan, shift, forwarding and exit logic.
  // Only the external child and pause effect are redirected to inert spies.
  const fixture = source.replace(/^(\s*)powershell\.exe /gm, `$1call "${child}" `)
    .replace('pause >nul', `call "${pauseSpy}"`);
  await writeFile(join(actual, 'Launch-Stephanos-Local.cmd'), fixture);
  const invoke = args => spawnSync('C:\\Windows\\System32\\cmd.exe', ['/d', '/c', 'Launch-Stephanos-Local.cmd', ...args],
    { cwd: actual, encoding: 'utf8', shell: false, windowsHide: true, timeout: 5_000 });
  const ordinary = invoke(saved.split(' '));
  assert.equal(ordinary.status, 1, ordinary.stderr || ordinary.stdout);
  assert.match(await readFile(capture, 'utf8'), /-Mode launcher-root -BootMode cockpit -Unattended/);
  await assert.rejects(readFile(pause), { code: 'ENOENT' });
  const interactiveControl = invoke([]);
  assert.equal(interactiveControl.status, 1, interactiveControl.stderr || interactiveControl.stdout);
  assert.equal((await readFile(pause, 'utf8')).trim(), 'pause', 'the intercepted pause observes the actual interactive branch');
});
