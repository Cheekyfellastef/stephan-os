import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const helperPath = fileURLToPath(new URL('../../scripts/windows/stephanos-core-process-observation.ps1', import.meta.url));
const runner = await readFile(new URL('../../scripts/windows/run-sovereign-commander-hidden.ps1', import.meta.url), 'utf8');
const status = await readFile(new URL('../../scripts/windows/status-stephanos-core-daemon.ps1', import.meta.url), 'utf8');
const start = runner.indexOf('# Stephanos Core is persistent');
const end = runner.indexOf('# The Sovereign Relay accelerates', start);
assert.ok(start >= 0 && end > start);

test('both Core observers share the same incomplete-inventory boundary', () => {
  for (const source of [runner, status]) {
    assert.match(source, /stephanos-core-process-observation\.ps1/);
    assert.match(source, /Get-StephanosCoreProcessObservation/);
    assert.match(source, /PROCESS_INVENTORY_UNPROVEN/);
  }
  assert.doesNotMatch(runner, /coreDaemonProcessCount = \[int\]/);
  assert.doesNotMatch(status, /processCount = \[int\]/);
});

test('Windows Core inventory and actual lifecycle hold unknown ownership without starting a process',
  { skip: process.platform !== 'win32' }, () => {
    const script = `
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. '${helperPath.replace(/'/g, "''")}'
$core = 'C:\\repo\\scripts\\stephanos-core-daemon.mjs'
$good = [pscustomobject]@{Name='node.exe';ProcessId=7;ExecutablePath='C:\\Program Files\\nodejs\\node.exe';CommandLine='node C:\\repo\\scripts\\stephanos-core-daemon.mjs'}
$hidden = [pscustomobject]@{Name='node.exe';ProcessId=8;CommandLine=$null}
$other = [pscustomobject]@{Name='node.exe';ProcessId=9;CommandLine='node C:\\repo\\other.mjs'}
$slash = [pscustomobject]@{Name='node.exe';ProcessId=7;ExecutablePath='C:\\Program Files\\nodejs\\node.exe';CommandLine='node C:/repo/scripts/stephanos-core-daemon.mjs'}
$alternate = [pscustomobject]@{Name='node.exe';ProcessId=7;ExecutablePath='C:\\alternate\\node.exe';CommandLine=$good.CommandLine}
$missingExecutable = [pscustomobject]@{Name='node.exe';ProcessId=7;CommandLine=$good.CommandLine}
$wrongLeaf = [pscustomobject]@{Name='node.exe';ProcessId=7;ExecutablePath='C:\\Program Files\\nodejs\\node.exe.old';CommandLine=$good.CommandLine}
$cases = @(
  @{rows=@($alternate);complete=$false;count=$null},
  @{rows=@($missingExecutable);complete=$false;count=$null},
  @{rows=@($wrongLeaf);complete=$false;count=$null},
  @{rows=@($good,$alternate);complete=$false;count=$null},
  @{rows=@($good);complete=$true;count=1},
  @{rows=@($other);complete=$true;count=0},
  @{rows=@($hidden);complete=$false;count=$null},
  @{rows=@($good,$hidden);complete=$false;count=$null},
  @{rows=@($good,$good);complete=$true;count=2},
  @{rows=@($slash);complete=$true;count=1}
)
foreach ($case in $cases) {
  $actual = ConvertTo-StephanosCoreProcessObservation -ProcessRows $case.rows -ObservationSucceeded $true -CoreScript $core
  if ($actual.complete -ne $case.complete -or $actual.processCount -ne $case.count) { throw 'INVENTORY_CASE_FAILED' }
}
function Get-CimInstance { throw 'ACCESS_DENIED_FIXTURE' }
$denied = Get-StephanosCoreProcessObservation -CoreScript $core
if ($denied.complete -or $null -ne $denied.processCount) { throw 'DENIAL_MUST_STAY_UNKNOWN' }

# Execute the actual fixed Core lifecycle branch, with all Windows I/O mocked.
$SkipCoreDaemonLifecycle = $false
$coreDaemonScript = $core
$canonicalNode = 'fixed-node'
$coreDaemonBlocker = ''
$coreDaemonStartRequested = $false
$coreDaemonRestartRequested = $false
$starts = 0
function Test-Path { return $true }
function Start-Process { $script:starts++; throw 'NO_PROCESS_START_ALLOWED' }
function Get-StephanosCoreDaemonProcesses {
  $script:coreProcessObservation = ConvertTo-StephanosCoreProcessObservation -ProcessRows @($hidden) -ObservationSucceeded $true -CoreScript $core
  return @($script:coreProcessObservation.processes)
}
function Get-StephanosCoreDaemonHealth {
  [pscustomobject]@{healthy=$false;heartbeatAgeSeconds=1;heartbeatFresh=$true;busyGraceActive=$false;flywheelCycleAgeSeconds=$null;readiness='READY';sourceHead=('a'*40)}
}
${runner.slice(start, end)}
if ($starts -ne 0 -or $coreDaemonStartRequested) { throw 'INCOMPLETE_INVENTORY_STARTED_CORE' }
if ($coreDaemonBlocker -ne 'SOVEREIGN_COMMANDER_CORE_DAEMON_PROCESS_INVENTORY_UNPROVEN') { throw 'MISSING_CUSTODY_HOLD' }
if ($null -ne $coreDaemonProcessCount -or $coreDaemonProcessInventoryComplete) { throw 'FALSE_ZERO_OWNER' }
Write-Output 'CORE_CUSTODY_FIXTURES_PASS'
`;
    const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
    ], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /CORE_CUSTODY_FIXTURES_PASS/);
  });
