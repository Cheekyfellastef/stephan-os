import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSpatialPreparationReceiptV1 } from '../shared/agents/sovereignSpatialWorkspaceV1.mjs';
import { verifySpatialWindowInstallation } from '../scripts/spatial-window-host.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const windowsOnly = { skip: !windows && 'Requires real Windows PowerShell/process/file APIs; not runtime acceptance.' };
const expectedHead = 'a'.repeat(40);
const buildId = 'b'.repeat(64);
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const scripts = [
  'prepare-spatial-workspace.ps1', 'spatial-window-install-lock.ps1',
  'build-spatial-window.ps1', 'install-spatial-window.ps1',
  'start-spatial-window-host.ps1', 'install-stephanos-spatial-workspace-shortcut.ps1',
];
const scriptPath = name => join(root, 'scripts', 'windows', name);
const ps = () => join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const installationPath = directory => join(directory, '.stephanos', 'local-state-checkpoints', 'spatial-window');

function run(script, directory, timeout = 25000) {
  const path = join(directory, 'harness-' + Math.random().toString(16).slice(2) + '.ps1');
  writeFileSync(path, "$ErrorActionPreference = 'Stop'\n" + script, 'utf8');
  const result = spawnSync(ps(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path], {
    encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 65536,
  });
  assert.equal(result.error, undefined, 'PowerShell harness must finish within its bound');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

function fixture(body) {
  const directory = mkdtempSync(join(tmpdir(), 'spatial-prepare-'));
  try { return body(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

function coordinatorHarness(directory, overrides = '') {
  const nativeFixture = join(directory, 'native-list-fixture.ps1');
  const hostFixture = join(directory, 'host-fixture.ps1');
  const installation = installationPath(directory);
  mkdirSync(installation, { recursive: true });
  // A consistent old record is deliberately present: the coordinator must
  // request a fresh build, never accept this as executable authority.
  writeFileSync(join(installation, 'SpatialWindow.exe'), 'untrusted-old-native');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const sources = ['src/windows/Stephanos.SpatialWindow/SpatialWindow.cpp', 'scripts/spatial-window-host.mjs', 'shared/vr/spatialDesktopSurfaceContractV1.mjs'].map(path => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), path);
    return { path, sha256: hash(path) };
  });
  const prior = { schema: 'stephanos.spatial-window-build.v1', sources, nativeSha256: hash('untrusted-old-native') };
  prior.buildId = hash([...sources.map(value => value.sha256), prior.nativeSha256].join(':'));
  writeFileSync(join(installation, 'build.json'), JSON.stringify(prior));
  assert.equal(verifySpatialWindowInstallation(directory).buildId, prior.buildId,
    'The old hash-only verifier accepts this forged record; it must never confer execution authority.');
  const freshNativeSha = createHash('sha256').update('fresh-native').digest('hex');
  const freshReceiptSha = createHash('sha256').update('fresh-receipt').digest('hex');
  writeFileSync(hostFixture, 'Start-Sleep -Seconds 30', 'utf8');
  writeFileSync(nativeFixture, [
    'if ($env:PATH -cne [Environment]::SystemDirectory -or [Environment]::CurrentDirectory -ne [Environment]::SystemDirectory) { exit 24 }',
    "$line = [Console]::In.ReadLine()",
    "if ($line -cne '{\"op\":\"list\"}') { exit 23 }",
    "[Console]::Out.WriteLine('{\"status\":\"windows\",\"windows\":[]}')",
    'exit 0',
  ].join('\n'), 'utf8');
  return [
    '. ' + quote(scriptPath('prepare-spatial-workspace.ps1')),
    '$script:fixtureRoot = ' + quote(directory),
    '$script:fixtureInstallation = ' + quote(installation),
    '$script:fixturePowerShell = ' + quote(ps()),
    '$script:fixtureNative = ' + quote(nativeFixture),
    '$script:fixtureHost = ' + quote(hostFixture),
    '$script:realProcessInfo = (Get-Command New-SpatialPreparationProcessInfo).ScriptBlock',
    '$script:witnessReads = 0; $script:freshBuilds = 0; $script:selectedNative = ""',
    'function Get-SpatialPreparationContext { return [pscustomobject]@{Root=$script:fixtureRoot;Node=$script:fixturePowerShell;Git=$script:fixturePowerShell;Sid="fixture";Session=1;HostScript="fixture";Installation=$script:fixtureInstallation} }',
    'function Open-SpatialPreparationSourceHandles { param($Context) return @() }',
    'function Assert-SpatialPreparationSource { param($Context,$Head) }',
    'function Enter-SpatialWindowInstallLock { param($RepositoryRoot) return (New-Object Object) }',
    'function Exit-SpatialWindowInstallLock { param($Mutex) }',
    'function Invoke-SpatialPreparationFreshInstallation { param($Context) $script:freshBuilds++; [IO.File]::WriteAllText((Join-Path $Context.Installation "SpatialWindow.exe"),"fresh-native"); [IO.File]::WriteAllText((Join-Path $Context.Installation "build.json"),"fresh-receipt"); $fresh=[pscustomobject]@{BuildId="' + buildId + '";NativeSha256="' + freshNativeSha + '";ReceiptSha256="' + freshReceiptSha + '"}; return (Open-SpatialWindowPinnedInstallation -Directory $Context.Installation -FreshBuild $fresh) }',
    'function Get-SpatialWindowListeners { return @() }',
    'function Get-SpatialPreparationHostWitness { param($Context,$BuildId,$ExpectedProcess,[switch]$ProbeOnly) $script:witnessReads++; if (-not $ProbeOnly -or -not $ExpectedProcess) { throw "unexpected existing host" }; return [pscustomobject]@{ProcessId=$ExpectedProcess.Id;CreationDate=$ExpectedProcess.StartTime} }',
    'function Test-SpatialPreparationShortcut { param($Context) return $true }',
    'function Test-SpatialPreparationUi { param($Context,$Head) return $true }',
    'function Assert-SpatialPreparationBuildTools { param($Context) }',
    'function New-SpatialPreparationProcessInfo { param($Executable,$Arguments,$RepositoryRoot,[switch]$StandardInput) $target=$script:fixtureHost; if ($StandardInput) { $script:selectedNative=$Executable; $target=$script:fixtureNative }; return (& $script:realProcessInfo -Executable $script:fixturePowerShell -Arguments @("-NoProfile","-NonInteractive","-File",$target) -RepositoryRoot $RepositoryRoot -StandardInput:$StandardInput) }',
    overrides,
    '$receipt = Invoke-SpatialWorkspacePreparation -Head "' + expectedHead + '"',
    '[ordered]@{receipt=$receipt;witnessReads=$script:witnessReads;freshBuilds=$script:freshBuilds;selectedNative=$script:selectedNative} | ConvertTo-Json -Compress -Depth 6',
  ].join('\n');
}

test('Windows parser accepts every preparation/installer/shortcut script', windowsOnly, () => fixture(directory => {
  const parsed = run([
    '$paths = @(' + scripts.map(name => quote(scriptPath(name))).join(',') + ')',
    '$failures = @()',
    'foreach ($path in $paths) { $tokens=$null; $errors=$null; [void][Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors); if ($errors.Count) { $failures += [IO.Path]::GetFileName($path) } }',
    '[ordered]@{failures=@($failures)} | ConvertTo-Json -Compress',
  ].join('\n'), directory);
  assert.deepEqual(parsed.failures, []);
}));

test('Windows coordinator replaces untrusted prior metadata with fresh pinned identity before a list-only child', windowsOnly, () => fixture(directory => {
  const output = run(coordinatorHarness(directory), directory);
  const receipt = projectSpatialPreparationReceiptV1(output.receipt, expectedHead);
  assert.ok(receipt);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.nativeProbePassed, true);
  assert.equal(receipt.createdProbeStopped, true);
  assert.equal(receipt.hostRunningAfter, false);
  assert.equal(receipt.existingHostPreserved, false);
  assert.equal(receipt.mutationAttempted, true);
  assert.equal(output.freshBuilds, 1);
  assert.equal(output.selectedNative, join(installationPath(directory), 'SpatialWindow.exe'));
  assert.equal(readFileSync(output.selectedNative, 'utf8'), 'fresh-native');
  assert.ok(output.witnessReads >= 1);
  assert.equal(receipt.interactiveAcceptance, false);
  assert.equal(receipt.voiceAcceptance, false);
  assert.equal(receipt.headsetAcceptance, false);
}));

test('Windows source validation refuses an adapter absent from the committed source set', windowsOnly, () => fixture(directory => {
  const output = run([
    '. ' + quote(scriptPath('prepare-spatial-workspace.ps1')),
    '$script:fixtureRoot = ' + quote(directory),
    '$script:trackedChecked=$false',
    'function Invoke-SpatialPreparationReadOnlyCommand { param($Executable,$Arguments,$RepositoryRoot) if ($Arguments -contains "ls-files") { $script:trackedChecked=$true; return [pscustomobject]@{ExitCode=1;Output=""} }; $value="' + expectedHead + '"; if ($Arguments -contains "--show-toplevel") { $value=$script:fixtureRoot.Replace("\\","/") }; if ($Arguments -contains "symbolic-ref") { $value="main" }; return [pscustomobject]@{ExitCode=0;Output=$value} }',
    '$context=[pscustomobject]@{Root=$script:fixtureRoot;Git="fixture"}',
    '$blocker=""; try { Assert-SpatialPreparationSource -Context $context -Head "' + expectedHead + '" } catch { $blocker=$_.Exception.Message }',
    '[ordered]@{blocker=$blocker;trackedChecked=$script:trackedChecked} | ConvertTo-Json -Compress',
  ].join('\n'), directory);
  assert.equal(output.blocker, 'SPATIAL_PREPARE_SOURCE_MISMATCH');
  assert.equal(output.trackedChecked, true);
}));

test('Windows coordinator refuses any occupied host before a build or native launch', windowsOnly, () => fixture(directory => {
  const output = run(coordinatorHarness(directory,
    'function Get-SpatialWindowListeners { return [pscustomobject]@{LocalAddress="127.0.0.1";LocalPort=4180;OwningProcess=1234} }'), directory);
  const receipt = projectSpatialPreparationReceiptV1(output.receipt, expectedHead);
  assert.ok(receipt);
  assert.equal(receipt.blocker, 'SPATIAL_PREPARE_PORT_OCCUPIED');
  assert.equal(receipt.mutationAttempted, false);
  assert.equal(receipt.createdProbeStopped, true);
  assert.equal(output.witnessReads, 0);
  assert.equal(output.freshBuilds, 0);
  assert.equal(output.selectedNative, '');
}));

test('Windows coordinator retains uncertainty when a source-probe child could not be stopped', windowsOnly, () => fixture(directory => {
  const output = run(coordinatorHarness(directory,
    'function Assert-SpatialPreparationSource { param($Context,$Head) throw "SPATIAL_PREPARE_PROBE_STOP_UNPROVEN" }'), directory);
  const receipt = projectSpatialPreparationReceiptV1(output.receipt, expectedHead);
  assert.ok(receipt);
  assert.equal(receipt.blocker, 'SPATIAL_PREPARE_PROBE_STOP_UNPROVEN');
  assert.equal(receipt.createdProbeStopped, false);
  assert.equal(receipt.ok, false);
}));

test('Windows coordinator refuses a planted installation DLL before compiling or executing', windowsOnly, () => fixture(directory => {
  const output = run(coordinatorHarness(directory,
    '[IO.File]::WriteAllText((Join-Path $script:fixtureInstallation "d3d11.dll"),"untrusted-dll")'), directory);
  const receipt = projectSpatialPreparationReceiptV1(output.receipt, expectedHead);
  assert.ok(receipt);
  assert.equal(receipt.blocker, 'SPATIAL_PREPARE_INSTALLATION_INVALID');
  assert.equal(receipt.mutationAttempted, false);
  assert.equal(output.freshBuilds, 0);
  assert.equal(output.selectedNative, '');
  assert.equal(readFileSync(join(installationPath(directory), 'd3d11.dll'), 'utf8'), 'untrusted-dll');
}));

for (const blocker of ['SPATIAL_PREPARE_COMPILER_MISSING', 'SPATIAL_PREPARE_SDK_MISSING']) {
  test('Windows prerequisite hold remains non-mutating: ' + blocker, windowsOnly, () => fixture(directory => {
    const output = run(coordinatorHarness(directory, [
      'function Get-SpatialWindowListeners { return @() }',
      'function Assert-SpatialPreparationBuildTools { param($Context) throw "' + blocker + '" }',
    ].join('\n')), directory);
    const receipt = projectSpatialPreparationReceiptV1(output.receipt, expectedHead);
    assert.ok(receipt);
    assert.equal(receipt.blocker, blocker);
    assert.equal(receipt.mutationAttempted, false);
    assert.equal(receipt.createdProbeStopped, true);
  }));
}

test('Windows failed native response is private and its created child is stopped', windowsOnly, () => fixture(directory => {
  const harness = coordinatorHarness(directory, [
    '[IO.File]::WriteAllText($script:fixtureNative, "[Console]::Out.WriteLine(' + "'private window text'" + ')" + [char]10 + "Start-Sleep -Seconds 30")',
  ].join('\n'));
  const output = run(harness, directory);
  const receipt = projectSpatialPreparationReceiptV1(output.receipt, expectedHead);
  assert.ok(receipt);
  assert.equal(receipt.blocker, 'SPATIAL_PREPARE_NATIVE_PROBE_FAILED');
  assert.equal(receipt.nativeProbePassed, false);
  assert.equal(receipt.createdProbeStopped, true);
  assert.equal(receipt.existingHostPreserved, false);
  assert.equal(JSON.stringify(receipt).includes('private window text'), false);
}));

function installerHarness(directory, { lateListener = false, missingReceipt = false } = {}) {
  const fixtureScripts = join(directory, 'scripts', 'windows');
  const installation = join(directory, '.stephanos', 'local-state-checkpoints', 'spatial-window');
  mkdirSync(fixtureScripts, { recursive: true });
  mkdirSync(installation, { recursive: true });
  for (const name of ['install-spatial-window.ps1', 'spatial-window-install-lock.ps1']) {
    copyFileSync(scriptPath(name), join(fixtureScripts, name));
  }
  writeFileSync(join(installation, 'SpatialWindow.exe'), 'prior-native');
  writeFileSync(join(installation, 'build.json'), 'prior-receipt');
  writeFileSync(join(fixtureScripts, 'build-spatial-window.ps1'), [
    'param([string]$OutputDirectory,[switch]$PassThru)',
    '$global:spatialFixtureBuilds++',
    'New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null',
    '[IO.File]::WriteAllText((Join-Path $OutputDirectory "SpatialWindow.exe"),"new-native")',
    missingReceipt ? '' : '[IO.File]::WriteAllText((Join-Path $OutputDirectory "build.json"),"new-receipt")',
  ].join('\n'));
  return {
    installation,
    script: [
      '$global:spatialFixturePortChecks = 0; $global:spatialFixtureStops = 0; $global:spatialFixtureBuilds = 0',
      'function Get-Command { [CmdletBinding()] param($Name) if ($Name -ne "node.exe") { throw "unexpected command" }; return [pscustomobject]@{Source=' + quote(ps()) + '} }',
      'function Get-NetTCPConnection { [CmdletBinding()] param($State) $global:spatialFixturePortChecks++; ' + (lateListener ? 'if ($global:spatialFixturePortChecks -gt 1) { return [pscustomobject]@{LocalPort=4180;LocalAddress="127.0.0.1";OwningProcess=9999} }' : 'return @()') + ' }',
      'function Stop-Process { [CmdletBinding()] param($Id) $global:spatialFixtureStops++; throw "unexpected stop" }',
      '$failure = ""; $failureType = ""',
      'try { & ' + quote(join(fixtureScripts, 'install-spatial-window.ps1')) + ' -RequirePortUnused *> $null } catch { $failure = $_.Exception.Message; $failureType=$_.Exception.GetBaseException().GetType().FullName }',
      '[ordered]@{failure=$failure;failureType=$failureType;builds=$global:spatialFixtureBuilds;stops=$global:spatialFixtureStops;staging=@(Get-ChildItem -LiteralPath ' + quote(dirname(installation)) + ' -Directory | Where-Object Name -like "spatial-window-build-*").Count} | ConvertTo-Json -Compress',
    ].join('\n'),
  };
}

test('Windows installer refuses a listener appearing during compilation and keeps prior installation', windowsOnly, () => fixture(directory => {
  const prepared = installerHarness(directory, { lateListener: true });
  const output = run(prepared.script, directory);
  assert.equal(output.failure, 'SPATIAL_PREPARE_PORT_OCCUPIED');
  assert.equal(output.builds, 1);
  assert.equal(output.stops, 0);
  assert.equal(output.staging, 0);
  assert.equal(readFileSync(join(prepared.installation, 'SpatialWindow.exe'), 'utf8'), 'prior-native');
  assert.equal(readFileSync(join(prepared.installation, 'build.json'), 'utf8'), 'prior-receipt');
}));

test('Windows installer restores both prior files when the second promotion fails', windowsOnly, () => fixture(directory => {
  const prepared = installerHarness(directory, { missingReceipt: true });
  const output = run(prepared.script, directory);
  assert.notEqual(output.failure, '');
  assert.equal(output.builds, 1);
  assert.equal(output.failureType, 'System.IO.FileNotFoundException');
  assert.equal(output.stops, 0);
  assert.equal(output.staging, 0);
  assert.equal(readFileSync(join(prepared.installation, 'SpatialWindow.exe'), 'utf8'), 'prior-native');
  assert.equal(readFileSync(join(prepared.installation, 'build.json'), 'utf8'), 'prior-receipt');
}));

test('Windows mutex supports same-thread nesting and excludes another process', windowsOnly, () => fixture(directory => {
  const child = join(directory, 'contender.ps1');
  writeFileSync(child, [
    '. ' + quote(scriptPath('spatial-window-install-lock.ps1')),
    'try { $lease=Enter-SpatialWindowInstallLock -RepositoryRoot ' + quote(directory) + '; Exit-SpatialWindowInstallLock -Mutex $lease; [Console]::Out.WriteLine("unexpected acquired") }',
    'catch { [Console]::Out.WriteLine($_.Exception.Message) }',
  ].join('\n'));
  const output = run([
    '. ' + quote(scriptPath('spatial-window-install-lock.ps1')),
    '$first=Enter-SpatialWindowInstallLock -RepositoryRoot ' + quote(directory),
    '$second=Enter-SpatialWindowInstallLock -RepositoryRoot ' + quote(directory),
    'Exit-SpatialWindowInstallLock -Mutex $second',
    '$blocked=(& ' + quote(ps()) + ' -NoProfile -NonInteractive -File ' + quote(child) + ')',
    'Exit-SpatialWindowInstallLock -Mutex $first',
    '$third=Enter-SpatialWindowInstallLock -RepositoryRoot ' + quote(directory),
    'Exit-SpatialWindowInstallLock -Mutex $third',
    '[ordered]@{blocked=$blocked} | ConvertTo-Json -Compress',
  ].join('\n'), directory);
  assert.equal(output.blocked, 'SPATIAL_PREPARE_LOCK_BUSY');
}));

test('Windows trusted program directory survives a minimal child environment', windowsOnly, () => fixture(directory => {
  const output = run([
    "$original=[Environment]::GetFolderPath('ProgramFilesX86')",
    "[Environment]::SetEnvironmentVariable('ProgramFiles(x86)',$null,'Process')",
    "[Environment]::SetEnvironmentVariable('ProgramFiles',$null,'Process')",
    "$resolved=[Environment]::GetFolderPath('ProgramFilesX86')",
    '[ordered]@{same=($original -eq $resolved);present=(-not [string]::IsNullOrWhiteSpace($resolved))} | ConvertTo-Json -Compress',
  ].join('\n'), directory);
  assert.equal(output.same, true);
  assert.equal(output.present, true);
}));
