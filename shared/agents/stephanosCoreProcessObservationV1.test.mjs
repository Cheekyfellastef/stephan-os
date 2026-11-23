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

test('missing-image fallback is fixed, birth-bound, bounded and never widens opaque command classification', async () => {
  const source = await readFile(helperPath, 'utf8');
  assert.doesNotMatch(source, /^\.\s*\(Join-Path \$PSScriptRoot 'read-sovereign-maintenance-owner-v2\.ps1'\)$/m);
  assert.match(source, /ReadAllBytes\(\$ownerNativePath\)/);
  assert.match(source, /\[ScriptBlock\]::Create\(\$canonicalSource\)/);
  assert.match(source, /d3c82d73d6d1354864e006179a4e3840294fc738b84c731305d3154a027bf956/);
  const guard = source.indexOf('CORE_PROCESS_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN');
  assert.ok(guard > 0 && guard < source.indexOf('ReadAllBytes($ownerNativePath)'));
  assert.match(source, /Get-StephanosCanonicalNodeIdentityV1 -ProcessRow \$row/);
  assert.match(source, /\$attempted -lt 64/);
  assert.match(source, /\$native\.ok -eq \$true -and \$native\.diagnosticCode -ceq ''/);
  assert.match(source, /\$expectedCoreCommand/);
  assert.match(source, /CORE_PROCESS_COMMAND_LINE_MISMATCH/);
  assert.doesNotMatch(source, /\b(?:Start-Process|Stop-Process|Start-ScheduledTask|Restart-Computer)\b/);
});

test('Windows Core actual observer reconciles only visible exact command and matching native identity',
  { skip: process.platform !== 'win32' }, async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createHash } = await import('node:crypto');
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'stephanos-core-observer-fixture-'));
    const fixturePath = join(fixtureRoot, 'stephanos-core-process-observation.ps1');
    const source = await readFile(helperPath, 'utf8');
    const principal = '$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())';
    assert.equal(source.split(principal).length, 2);
    // This controlled token seam exercises inventory policy on elevated CI too.
    // Actual limited-token/native capability proof is a separate test.
    const limitedPrincipal = '$principal = [pscustomobject]@{}; $principal | Add-Member -MemberType ScriptMethod -Name IsInRole -Value { param($role) $false }';
    const ownerSource = await readFile(new URL('../../scripts/windows/read-sovereign-maintenance-owner-v2.ps1', import.meta.url), 'utf8');
    assert.equal(ownerSource.split(principal).length, 3);
    const fixtureOwner = ownerSource.replaceAll(principal, limitedPrincipal).replace(/\r\n/g, '\n');
    const fixtureDigest = createHash('sha256').update(fixtureOwner).digest('hex');
    const pin = source.match(/\$sourceDigest -cne '([a-f0-9]{64})'/)?.[0];
    assert.ok(pin, 'actual loader must retain an exact content binding');
    await writeFile(fixturePath, source.replace(principal, limitedPrincipal)
      .replace(pin, `$sourceDigest -cne '${fixtureDigest}'`));
    await writeFile(join(fixtureRoot, 'read-sovereign-maintenance-owner-v2.ps1'), fixtureOwner);
    try {
    const script = `
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -TypeDefinition @'
namespace Stephanos { public static class ReadOnlyCanonicalNodeIdentityV1 {
 public static string Code=""; public static int Calls;
 public static string Observe(uint pid,long ticks) { Calls++; if(pid==0 || ticks<=0) throw new System.Exception(); return Code; }
} }
'@
. '${fixturePath.replace(/'/g, "''")}'
$core='C:\\repo\\scripts\\stephanos-core-daemon.mjs'
$command='"C:\\Program Files\\nodejs\\node.exe" "'+$core+'"'
$born=[datetime]::UtcNow.AddMinutes(-1)
$missing=[pscustomobject]@{Name='node.exe';ProcessId=7;CommandLine=$command;CreationDate=$born;ExecutablePath=$null}
$hidden=[pscustomobject]@{Name='node.exe';ProcessId=8;CommandLine=$null;CreationDate=$born;ExecutablePath=$null}
$foreign=[pscustomobject]@{Name='node.exe';ProcessId=7;CommandLine=$command;CreationDate=$born;ExecutablePath='C:\\other\\node.exe'}
$unborn=[pscustomobject]@{Name='node.exe';ProcessId=7;CommandLine=$command;CreationDate=$null;ExecutablePath=$null}
$changedPid=[pscustomobject]@{Name='node.exe';ProcessId=0;CommandLine=$command;CreationDate=$born;ExecutablePath=$null}
$good=[pscustomobject]@{Name='node.exe';ProcessId=7;CommandLine=$command;CreationDate=$born;ExecutablePath='C:\\Program Files\\nodejs\\node.exe'}
$script:fixtureRows=@()
$script:throwQuery=$false
function Get-CimInstance { if($script:throwQuery){throw 'PRIVATE_CIM_FAILURE'}; return $script:fixtureRows }
$cases=@(
 @{rows=@($missing);native='';complete=$true;count=1;calls=1;resolved=1;diagnostic=''},
 @{rows=@($missing,$hidden);native='';complete=$false;count=$null;calls=1;resolved=1;diagnostic='CORE_PROCESS_COMMAND_LINE_UNAVAILABLE'},
 @{rows=@($hidden);native='';complete=$false;count=$null;calls=0;resolved=0;diagnostic='CORE_PROCESS_COMMAND_LINE_UNAVAILABLE'},
 @{rows=@($foreign);native='';complete=$false;count=$null;calls=0;resolved=0;diagnostic='CORE_PROCESS_IMAGE_MISMATCH'},
 @{rows=@($unborn);native='';complete=$false;count=$null;calls=0;resolved=0;diagnostic='CORE_PROCESS_BIRTH_UNAVAILABLE'},
 @{rows=@($changedPid);native='';complete=$false;count=$null;calls=0;resolved=0;diagnostic='CORE_PROCESS_IDENTITY_UNPROVEN'},
 @{rows=@($missing);native='OWNER_NATIVE_BIRTH_MISMATCH';complete=$false;count=$null;calls=1;resolved=0;diagnostic='CORE_PROCESS_NATIVE_BIRTH_MISMATCH'},
 @{rows=@($missing);native='OWNER_NATIVE_ACCESS_DENIED';complete=$false;count=$null;calls=1;resolved=0;diagnostic='CORE_PROCESS_NATIVE_ACCESS_DENIED'},
 @{rows=@($missing);native='OWNER_NATIVE_IMAGE_MISMATCH';complete=$false;count=$null;calls=1;resolved=0;diagnostic='CORE_PROCESS_NATIVE_IMAGE_MISMATCH'},
 @{rows=@($missing);native='OWNER_NATIVE_PROCESS_EXITED';complete=$false;count=$null;calls=1;resolved=0;diagnostic='CORE_PROCESS_NATIVE_PROCESS_EXITED'},
 @{rows=@($good,$good);native='';complete=$true;count=2;calls=0;resolved=0;diagnostic=''},
 @{rows=@($missing)*65;native='';complete=$false;count=$null;calls=64;resolved=64;diagnostic='CORE_PROCESS_NATIVE_OBSERVATION_BOUND_EXCEEDED'}
)
foreach($case in $cases) {
 $script:fixtureRows=$case.rows
 [Stephanos.ReadOnlyCanonicalNodeIdentityV1]::Code=$case.native
 [Stephanos.ReadOnlyCanonicalNodeIdentityV1]::Calls=0
 $actual=Get-StephanosCoreProcessObservation -CoreScript $core
 if($actual.complete -ne $case.complete -or $actual.processCount -ne $case.count -or $actual.nativeImageFallbackCount -ne $case.resolved -or
    $actual.diagnosticCode -cne $case.diagnostic -or [Stephanos.ReadOnlyCanonicalNodeIdentityV1]::Calls -ne $case.calls){throw ('CORE_NATIVE_CASE_FAILED:'+($actual|ConvertTo-Json -Compress))}
 if(-not $case.complete -and $actual.blocker -cne 'CORE_PROCESS_INVENTORY_UNPROVEN'){throw 'UNKNOWN_NOT_HELD'}
 if($case.complete -and $case.count -eq 1 -and $actual.processes[0].CreationDate -ne $born){throw 'ORIGINAL_BIRTH_REWRITTEN'}
}
foreach($invalidCommand in @(($command+'.old'), ($command+' --extra'), ('"C:\\Program Files\\nodejs\\node.exe" -e "'+$core+'"'), ('"C:\\Program Files\\nodejs\\node.exe" "'+$core+'.old"'))) {
 $script:fixtureRows=@([pscustomobject]@{Name='node.exe';ProcessId=7;CommandLine=$invalidCommand;CreationDate=$born;ExecutablePath=$null})
 [Stephanos.ReadOnlyCanonicalNodeIdentityV1]::Calls=0
 $actual=Get-StephanosCoreProcessObservation -CoreScript $core
 if($actual.complete -or $null -ne $actual.processCount -or [Stephanos.ReadOnlyCanonicalNodeIdentityV1]::Calls -ne 0 -or $actual.diagnosticCode -cne 'CORE_PROCESS_COMMAND_LINE_MISMATCH'){throw 'FOREIGN_COMMAND_FALLBACK'}
}
$script:throwQuery=$true
$failed=Get-StephanosCoreProcessObservation -CoreScript $core
if($failed.complete -or $null -ne $failed.processCount -or $failed.diagnosticCode -cne 'CORE_PROCESS_QUERY_FAILED'){throw 'QUERY_FAILURE_FALSE_ABSENCE'}
Write-Output 'CORE_NATIVE_IMAGE_FALLBACK_PASS'
`;
    const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { encoding: 'utf8', windowsHide: true, shell: false, timeout: 20_000, maxBuffer: 32_768 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /CORE_NATIVE_IMAGE_FALLBACK_PASS/);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
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

test('Windows Core fallback refuses elevated callers before helper access and rejects substituted helper bytes',
  { skip: process.platform !== 'win32' }, async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const source = await readFile(helperPath, 'utf8');
    const principal = '$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())';
    assert.equal(source.split(principal).length, 2, 'fixture changes only the real token observation seam');
    const originalOwner = await readFile(new URL('../../scripts/windows/read-sovereign-maintenance-owner-v2.ps1', import.meta.url), 'utf8');
    const root = await mkdtemp(join(tmpdir(), 'stephanos-core-fallback-denial-'));
    const quote = value => value.replace(/'/g, "''");
    try {
      for (const mode of ['elevated-no-helper', 'elevated-substituted-helper', 'limited-substituted-helper']) {
        const elevated = mode.startsWith('elevated');
        const fixturePath = join(root, `${mode}.ps1`);
        const sentinel = join(root, `${mode}.executed`);
        const fixturePrincipal = `$principal = [pscustomobject]@{}; $principal | Add-Member -MemberType ScriptMethod -Name IsInRole -Value { param($role) $${elevated} }`;
        await writeFile(fixturePath, source.replace(principal, fixturePrincipal));
        const ownerPath = join(root, 'read-sovereign-maintenance-owner-v2.ps1');
        await rm(ownerPath, { force: true });
        if (mode !== 'elevated-no-helper') {
          await writeFile(ownerPath, `[IO.File]::WriteAllText('${quote(sentinel)}','UNTRUSTED_HELPER_EXECUTED')\n${originalOwner}`);
        }
        const script = `
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. '${quote(fixturePath)}'
$core='C:\\repo\\scripts\\stephanos-core-daemon.mjs'
$script:nativeCalls=0
function Get-StephanosCanonicalNodeIdentityV1 { $script:nativeCalls++; throw 'NATIVE_CALL_FORBIDDEN' }
function Get-CimInstance {
 [pscustomobject]@{Name='node.exe';ProcessId=7;CommandLine=('"C:\\Program Files\\nodejs\\node.exe" "'+$core+'"');CreationDate=[datetime]::UtcNow.AddMinutes(-1);ExecutablePath=$null}
}
$actual=Get-StephanosCoreProcessObservation -CoreScript $core
if($actual.complete -or $null -ne $actual.processCount -or $actual.nativeImageFallbackCount -ne 0 -or $script:nativeCalls -ne 0){throw 'DENIAL_FALSE_ABSENCE_OR_NATIVE_CALL'}
if($actual.blocker -cne 'CORE_PROCESS_INVENTORY_UNPROVEN' -or $actual.diagnosticCode -cne '${elevated ? 'CORE_PROCESS_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN' : 'CORE_PROCESS_QUERY_FAILED'}'){throw ('DENIAL_DIAGNOSTIC:'+($actual|ConvertTo-Json -Compress))}
if([IO.File]::Exists('${quote(sentinel)}')){throw 'SUBSTITUTED_HELPER_EXECUTED'}
Write-Output 'CORE_FALLBACK_DENIAL_PASS'
`;
        const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
          { encoding: 'utf8', windowsHide: true, shell: false, timeout: 10_000, maxBuffer: 32_768 });
        assert.equal(result.status, 0, `${mode}: ${result.stderr || result.error?.message}`);
        assert.match(result.stdout, /CORE_FALLBACK_DENIAL_PASS/);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
