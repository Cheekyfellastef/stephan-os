import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readMaintenanceOwnerObservationV2, readMaintenanceNativeOwnerV2,
  MAINTENANCE_OWNER_DIAGNOSTIC_CODES_V1, maintenanceNativeOwnerDiagnosticCodeV2 } from './sovereign-maintenance-owner-observation-v2.mjs';
const ownerScript = fileURLToPath(new URL('./windows/read-sovereign-maintenance-owner-v2.ps1', import.meta.url));
const principalConstruction = '[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())';
function ownerTokenFixture(t, principalType) {
  const source = readFileSync(ownerScript, 'utf8');
  assert.equal(source.split(principalConstruction).length, 2, 'one actual token boundary must be exercised');
  const root = mkdtempSync(join(tmpdir(), 'owner-token-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'owner.ps1');
  writeFileSync(path, source.replace(principalConstruction, `[${principalType}]::new()`));
  return path.replace(/'/g, "''");
}
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const native = () => ({ schemaVersion: 'stephanos.maintenance-owner-native-observation.v2',
  pid: 10, createdAtUtc: new Date(Date.now() - 60_000).toISOString(),
  commandSha256: 'a'.repeat(64), imageSha256: 'b'.repeat(64), observedAtUtc: new Date().toISOString() });
const held = () => ({ ok: true, service: 'stephanos-sovereign-commander', continuousRepairGuardian: {
  timeoutCustodyHeld: true, running: false, maintenanceInFlight: false, scheduled: false, currentCycleId: '',
  lastBlocker: 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN',
  persistentCustody: { held: true, blocker: 'MAINTENANCE_CUSTODY_RESERVED' },
  lastCycleId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', lastStartedAtUtc: new Date(Date.now() - 30_000).toISOString() } });
test('owner observation binds stable native birth and exact held attempt without executing an action', async () => {
  const n = native(), h = held(); const r = await readMaintenanceOwnerObservationV2({
    nativeReader: () => ({ ...n, observedAtUtc: new Date().toISOString() }),
    fetchFn: async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:18791/health'); assert.equal(options.redirect, 'error');
      assert.equal(options.method, undefined); return Response.json(h);
    } });
  assert.equal(r.observation.pid, n.pid); assert.equal(r.observation.lastCycleId, h.continuousRepairGuardian.lastCycleId);
  assert.equal(r.digest, createHash('sha256').update(JSON.stringify(r.observation)).digest('hex'));
});
test('restarted quiescent owner may bind the same persisted hold without volatile cycle metadata', async () => {
  const n = native(), h = held();
  h.continuousRepairGuardian.lastCycleId = '';
  h.continuousRepairGuardian.lastStartedAtUtc = '';
  const r = await readMaintenanceOwnerObservationV2({
    nativeReader: () => ({ ...n, observedAtUtc: new Date().toISOString() }),
    fetchFn: async () => Response.json(h),
  });
  assert.equal(r.observation.lastCycleId, '');
  assert.equal(r.observation.lastStartedAtUtc, '');
  assert.equal(r.observation.timeoutCustodyHeld, true);
  assert.equal(r.observation.running, false);
  assert.equal(r.observation.scheduled, false);
});

test('owner drift, stale observations, active work and malformed health all refuse', async () => {
  for (const scenario of ['pid', 'birth', 'stale', 'running', 'scheduled', 'wrong-service', 'cycle', 'unheld',
    'persistent-missing', 'persistent-false', 'partial-restart-cycle']) {
    const n = native(), h = held(); let calls = 0;
    if (scenario === 'running') h.continuousRepairGuardian.running = true;
    if (scenario === 'scheduled') h.continuousRepairGuardian.scheduled = true;
    if (scenario === 'wrong-service') h.service = 'other';
    if (scenario === 'cycle') h.continuousRepairGuardian.lastCycleId = 'unknown';
    if (scenario === 'unheld') h.continuousRepairGuardian.timeoutCustodyHeld = false;
    if (scenario === 'persistent-missing') delete h.continuousRepairGuardian.persistentCustody;
    if (scenario === 'persistent-false') h.continuousRepairGuardian.persistentCustody.held = false;
    if (scenario === 'partial-restart-cycle') {
      h.continuousRepairGuardian.lastCycleId = '';
      h.continuousRepairGuardian.lastStartedAtUtc = new Date(Date.now() - 30_000).toISOString();
    }
    await assert.rejects(readMaintenanceOwnerObservationV2({
      nativeReader: () => { calls++; return { ...n,
        ...(scenario === 'pid' && calls > 1 ? { pid: 11 } : {}),
        ...(scenario === 'birth' && calls > 1 ? { createdAtUtc: new Date(Date.now() - 1000).toISOString() } : {}),
        ...(scenario === 'stale' ? { observedAtUtc: new Date(Date.now() - 20_000).toISOString() } : {}) }; },
      fetchFn: async () => Response.json(h) }), /OWNER_UNPROVEN/, scenario);
  }
});
test('health body limits and unsuccessful responses fail before accepting owner evidence', async () => {
  const n = native();
  await assert.rejects(readMaintenanceOwnerObservationV2({ nativeReader: () => n,
    fetchFn: async () => new Response('x'.repeat(65537)) }), /OWNER_UNPROVEN/);
  await assert.rejects(readMaintenanceOwnerObservationV2({ nativeReader: () => n,
    fetchFn: async () => new Response('{}', { status: 503 }) }), /OWNER_UNPROVEN/);
});

test('fixed native owner child preserves strict identity and exposes only closed negative diagnostics', () => {
  const n = native();
  const invoke = result => readMaintenanceNativeOwnerV2({ platform: 'win32', spawnSyncFn(executable, args, options) {
    assert.equal(executable, powershell);
    assert.deepEqual(args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', ownerScript]);
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    assert.equal(options.timeout, 10_000); assert.equal(options.maxBuffer, 4096);
    return result;
  } });
  assert.deepEqual(invoke({ status: 0, stdout: JSON.stringify(n) }), n);
  for (const diagnosticCode of MAINTENANCE_OWNER_DIAGNOSTIC_CODES_V1) {
    const failure = { schemaVersion: 'stephanos.maintenance-owner-native-diagnostic.v1',
      ok: false, observationOnly: true, diagnosticCode };
    assert.throws(() => invoke({ status: 2, stdout: JSON.stringify(failure), stderr: 'PRIVATE ERROR' }), error => {
      assert.equal(error.message, 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN');
      assert.equal(error.diagnosticCode, diagnosticCode);
      assert.doesNotMatch(JSON.stringify(error), /PRIVATE ERROR/); return true;
    });
    assert.equal(maintenanceNativeOwnerDiagnosticCodeV2(diagnosticCode), diagnosticCode);
  }
  for (const value of ['UNREVIEWED_CODE', '', {}, null, true, 5])
    assert.equal(maintenanceNativeOwnerDiagnosticCodeV2(value), 'OWNER_OBSERVER_INVALID_RECEIPT');
});

test('native observation failure cannot become identity through malformed or positive-looking envelopes', () => {
  const n = native();
  const fail = { schemaVersion: 'stephanos.maintenance-owner-native-diagnostic.v1',
    ok: false, observationOnly: true, diagnosticCode: 'OWNER_NATIVE_ACCESS_DENIED' };
  for (const result of [
    { status: 0, stdout: JSON.stringify(fail) },
    { status: 2, stdout: JSON.stringify(n) },
    { status: 1, stdout: JSON.stringify(fail) },
    { status: 2, stdout: JSON.stringify({ ...fail, ok: true }) },
    { status: 2, stdout: JSON.stringify({ ...fail, observationOnly: false }) },
    { status: 2, stdout: JSON.stringify({ ...fail, privatePath: 'PRIVATE' }) },
    { status: 2, stdout: JSON.stringify({ ...fail, diagnosticCode: 'PRIVATE' }) },
    { status: 0, stdout: JSON.stringify({ ...n, pid: 0 }) },
    { status: 0, stdout: JSON.stringify({ ...n, observedAtUtc: new Date(Date.now() - 60_000).toISOString() }) },
    { status: 0, stdout: JSON.stringify({ ...n, diagnosticCode: 'OWNER_NATIVE_ACCESS_DENIED' }) },
    { status: 2, stdout: 'null' }, { status: 2, stdout: '[]' },
    { status: 2, stdout: 'PRIVATE malformed' }, { status: 0, stdout: 'x'.repeat(4097) },
  ]) assert.throws(() => readMaintenanceNativeOwnerV2({ platform: 'win32', spawnSyncFn: () => result }), error => {
    assert.equal(error.message, 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN');
    assert.equal(error.diagnosticCode, 'OWNER_OBSERVER_INVALID_RECEIPT');
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE/); return true;
  });
  for (const [code, expected] of [['ETIMEDOUT', 'OWNER_OBSERVER_TIMEOUT'], ['EACCES', 'OWNER_OBSERVER_FAILED']])
    assert.throws(() => readMaintenanceNativeOwnerV2({ platform: 'win32',
      spawnSyncFn: () => ({ status: 0, stdout: JSON.stringify(n), error: { code, message: 'PRIVATE' } }) }), error => {
      assert.equal(error.diagnosticCode, expected); return true;
    });
  assert.throws(() => readMaintenanceNativeOwnerV2({ platform: 'win32', spawnSyncFn: () => { throw new Error('PRIVATE'); } }),
    error => error.diagnosticCode === 'OWNER_OBSERVER_FAILED' && !error.message.includes('PRIVATE'));
});

test('shared native identity adapter requests only limited read rights and retains the exact owner route', () => {
  const source = readFileSync(ownerScript, 'utf8');
  assert.match(source, /OpenProcess\(0x101000, false, pid\)/);
  assert.match(source, /GetProcessTimes\(process/);
  assert.match(source, /QueryFullProcessImageNameW\(process, 0/);
  assert.match(source, /\.Ticks \/ 10L != expectedCreatedUtcTicks \/ 10L/);
  assert.match(source, /finally \{ CloseHandle\(process\); \}/);
  assert.match(source, /if \(\$MyInvocation\.InvocationName -ne '\.'\)/);
  assert.match(source, /LocalPort = 18791 AND State = 2/);
  const guard = source.indexOf('OWNER_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN');
  assert.ok(guard > 0 && guard < source.lastIndexOf('Initialize-StephanosCanonicalNodeIdentityV1'));
  assert.doesNotMatch(source, /\b(?:AdjustTokenPrivileges|ReadProcessMemory|WriteProcessMemory|TerminateProcess|CreateProcess|SetTokenInformation)\b|0x1[Ff]0[Ff][Ff][Ff]/);
});

function runPowerShell(script) {
  return spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')],
  { encoding: 'utf8', windowsHide: true, shell: false, timeout: 20_000, maxBuffer: 32_768 });
}

test('Windows direct owner script remains one parameterless diagnostic and reports typed failure',
  { skip: process.platform !== 'win32' }, () => {
    const script = `
$ErrorActionPreference='Stop'
function Get-CimInstance { throw 'PRIVATE_PROVIDER_FAILURE' }
$raw=@(& '${ownerScript.replace(/'/g, "''")}')
if($LASTEXITCODE -ne 2){throw 'DIRECT_OWNER_EXIT_CHANGED'}
$result=($raw -join [Environment]::NewLine)|ConvertFrom-Json
if($result.schemaVersion -cne 'stephanos.maintenance-owner-native-diagnostic.v1' -or $result.ok -ne $false -or
 $result.observationOnly -ne $true -or $result.diagnosticCode -cne 'OWNER_CIM_LISTENER_QUERY_FAILED'){throw 'DIRECT_OWNER_RECEIPT_INVALID'}
Write-Output 'OWNER_DIRECT_DIAGNOSTIC_PASS'
exit 0
`;
    const result = runPowerShell(script);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /OWNER_DIRECT_DIAGNOSTIC_PASS/);
    assert.doesNotMatch(result.stdout, /PRIVATE_PROVIDER_FAILURE/);
  });

test('Windows owner actual fixed body preserves listener, visible command and native birth exclusions',
  { skip: process.platform !== 'win32' }, t => {
    const script = `
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$PSModuleAutoLoadingPreference='All'
$beforePreference=$PSModuleAutoLoadingPreference
$script:reads=0
function Get-CimInstance { $script:reads++; throw 'UNEXPECTED_OBSERVATION' }
class OwnerFixtureLimitedPrincipal { [bool] IsInRole([object]$role) { return $false } }
$loaded=@(. '${ownerTokenFixture(t, 'OwnerFixtureLimitedPrincipal')}')
if($loaded.Count -ne 0 -or $script:reads -ne 0 -or $PSModuleAutoLoadingPreference -ne $beforePreference){throw 'DOT_SOURCE_NOT_INERT'}
Add-Type -TypeDefinition @'
namespace Stephanos { public static class ReadOnlyCanonicalNodeIdentityV1 {
 public static string Code=""; public static int Calls;
 public static string Observe(uint pid,long ticks) { Calls++; if(pid!=10 || ticks<=0) throw new System.Exception(); return Code; }
} }
'@
function Get-StephanosCanonicalNodeImageHashV1 { return ('b'*64) }
$script:row=[pscustomobject]@{Name='node.exe';ProcessId=10;CreationDate=[datetime]::UtcNow.AddMinutes(-1);ExecutablePath=$null;
 CommandLine='"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os\\scripts\\sovereign-commander-http.mjs"'}
$script:connections=@([pscustomobject]@{OwningProcess=10;LocalAddress='127.0.0.1'})
$script:tailRow=[pscustomobject]@{Name='tailscaled.exe';ProcessId=20;CreationDate=[datetime]::UtcNow.AddMinutes(-2);
 ExecutablePath='C:\\Program Files\\Tailscale\\tailscaled.exe'}
$script:queryFailure=''
function Get-CimInstance {
 param($Namespace,$ClassName,$Filter)
 $script:reads++
 if($ClassName -eq 'MSFT_NetTCPConnection') {
   if($Namespace -cne 'root/StandardCimv2' -or $Filter -cne 'LocalPort = 18791 AND State = 2'){throw 'WRONG_LISTENER_QUERY'}
   if($script:queryFailure -eq 'listener'){throw 'PRIVATE_ERROR'}
   return $script:connections
 }
 if($ClassName -cne 'Win32_Process'){throw 'WRONG_PROCESS_QUERY'}
 if($script:queryFailure -eq 'process'){throw 'PRIVATE_ERROR'}
 if($Filter -ceq 'ProcessId=20'){return $script:tailRow}
 if($Filter -cne 'ProcessId=10'){throw 'WRONG_PROCESS_QUERY'}
 return $script:row
}
function Assert-Held([string]$expected) {
 try { $null=Get-SovereignMaintenanceNativeOwnerV2; throw 'FALSE_OWNER_ACCEPTANCE' }
 catch { if($_.Exception.Message -cne $expected){throw ('WRONG_OWNER_BLOCKER:'+ $_.Exception.Message)} }
}
$valid=Get-SovereignMaintenanceNativeOwnerV2
if($valid.pid -ne 10 -or $valid.imageSha256 -cne ('b'*64) -or [Stephanos.ReadOnlyCanonicalNodeIdentityV1]::Calls -ne 1){throw 'MISSING_BOUND_FALLBACK'}
if((($valid.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'commandSha256,createdAtUtc,imageSha256,observedAtUtc,pid,schemaVersion'){throw 'POSITIVE_SCHEMA_CHANGED'}
$before=[Stephanos.ReadOnlyCanonicalNodeIdentityV1]::Calls
$saved=$script:row.CommandLine; $script:row.CommandLine=$null; Assert-Held 'OWNER_COMMAND_LINE_UNAVAILABLE'; $script:row.CommandLine='node other.mjs'; Assert-Held 'OWNER_COMMAND_LINE_MISMATCH'; $script:row.CommandLine=$saved
if([Stephanos.ReadOnlyCanonicalNodeIdentityV1]::Calls -ne $before){throw 'OPAQUE_COMMAND_NATIVE_FALLBACK'}
$birth=$script:row.CreationDate; $script:row.CreationDate=$null; Assert-Held 'OWNER_PROCESS_BIRTH_UNAVAILABLE'; $script:row.CreationDate=$birth
$script:row.ExecutablePath='C:\\other\\node.exe'; Assert-Held 'OWNER_IMAGE_MISMATCH'; $script:row.ExecutablePath=$null
foreach($code in @('OWNER_NATIVE_ACCESS_DENIED','OWNER_NATIVE_OPEN_FAILED','OWNER_NATIVE_PROCESS_EXITED','OWNER_NATIVE_BIRTH_UNPROVEN','OWNER_NATIVE_BIRTH_MISMATCH','OWNER_NATIVE_IMAGE_UNPROVEN','OWNER_NATIVE_IMAGE_MISMATCH')) {
 [Stephanos.ReadOnlyCanonicalNodeIdentityV1]::Code=$code; Assert-Held $code
}
[Stephanos.ReadOnlyCanonicalNodeIdentityV1]::Code=''
$script:row.ProcessId=11; Assert-Held 'OWNER_PROCESS_UNPROVEN'; $script:row.ProcessId=10
$script:connections=@(); Assert-Held 'OWNER_LISTENER_UNPROVEN'
$script:connections=@([pscustomobject]@{OwningProcess=10;LocalAddress='0.0.0.0'}); Assert-Held 'OWNER_LISTENER_NOT_PRIVATE'
$script:connections=@([pscustomobject]@{OwningProcess=10;LocalAddress='127.0.0.1'},[pscustomobject]@{OwningProcess=11;LocalAddress='::1'}); Assert-Held 'OWNER_LISTENER_UNPROVEN'
# Genuine Tailscale Serve uses distinct tailnet-specific sockets, not 127.0.0.1.
$script:connections=@(
 [pscustomobject]@{OwningProcess=10;LocalAddress='127.0.0.1'},
 [pscustomobject]@{OwningProcess=20;LocalAddress='100.116.99.92'},
 [pscustomobject]@{OwningProcess=20;LocalAddress='fd7a:115c:a1e0::f01:63ab'}
)
$tailValid=Get-SovereignMaintenanceNativeOwnerV2
if($tailValid.pid -ne 10 -or $tailValid.imageSha256 -cne ('b'*64)){throw 'TAILSCALE_LOOPBACK_OWNER_NOT_BOUND'}
$script:tailRow.Name='imposter.exe'; Assert-Held 'OWNER_LISTENER_UNPROVEN'; $script:tailRow.Name='tailscaled.exe'
$script:tailRow.ExecutablePath='C:\\Users\\Public\\tailscaled.exe'; Assert-Held 'OWNER_LISTENER_UNPROVEN'
$script:tailRow.ExecutablePath='C:\\Program Files\\Tailscale\\tailscaled.exe'
$script:tailRow.CreationDate=$null; Assert-Held 'OWNER_LISTENER_UNPROVEN'
$script:tailRow.CreationDate=[datetime]::UtcNow.AddMinutes(-2)
$script:connections=@(
 [pscustomobject]@{OwningProcess=10;LocalAddress='127.0.0.1'},
 [pscustomobject]@{OwningProcess=20;LocalAddress='192.168.1.17'}
); Assert-Held 'OWNER_LISTENER_NOT_PRIVATE'
$script:connections=@(
 [pscustomobject]@{OwningProcess=10;LocalAddress='127.0.0.1'},
 [pscustomobject]@{OwningProcess=20;LocalAddress='0.0.0.0'}
); Assert-Held 'OWNER_LISTENER_NOT_PRIVATE'
$script:connections=@(
 [pscustomobject]@{OwningProcess=10;LocalAddress='127.0.0.1'},
 [pscustomobject]@{OwningProcess=20;LocalAddress='fd7a:115c:a1e1::1'}
); Assert-Held 'OWNER_LISTENER_NOT_PRIVATE'
$script:connections=@([pscustomobject]@{OwningProcess=10;LocalAddress='127.0.0.1'})
$script:queryFailure='listener'; Assert-Held 'OWNER_CIM_LISTENER_QUERY_FAILED'
$script:queryFailure='process'; Assert-Held 'OWNER_CIM_PROCESS_QUERY_FAILED'
Write-Output 'OWNER_FALLBACK_BOUNDARY_PASS'
`;
    const result = runPowerShell(script);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /OWNER_FALLBACK_BOUNDARY_PASS/);
  });

test('Windows owner native fallback rejects an administrator-enabled token before initialization',
  { skip: process.platform !== 'win32' }, t => {
    const result = runPowerShell(`
$ErrorActionPreference='Stop'
class OwnerFixtureElevatedPrincipal { [bool] IsInRole([object]$role) { return $true } }
. '${ownerTokenFixture(t, 'OwnerFixtureElevatedPrincipal')}'
$script:initialized=0
function Initialize-StephanosCanonicalNodeIdentityV1 { $script:initialized++; throw 'NATIVE_INITIALIZATION_FORBIDDEN' }
$row=[pscustomobject]@{Name='node.exe';ProcessId=7;CommandLine='visible';CreationDate=[datetime]::UtcNow.AddMinutes(-1)}
$held=Get-StephanosCanonicalNodeIdentityV1 -ProcessRow $row
if($held.ok -or $held.diagnosticCode -cne 'OWNER_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN' -or $script:initialized -ne 0){throw 'ELEVATED_FALLBACK_ADMITTED'}
Write-Output 'OWNER_ELEVATED_FALLBACK_REFUSED'
`);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /OWNER_ELEVATED_FALLBACK_REFUSED/);
  });

test('Windows native limited-query adapter rejects a real foreign image and a changed birth',
  { skip: process.platform !== 'win32' }, () => {
    const script = `
$ErrorActionPreference='Stop'
. '${ownerScript.replace(/'/g, "''")}'
Initialize-StephanosCanonicalNodeIdentityV1
$birth=(Get-Process -Id $PID).StartTime.ToUniversalTime()
$image=[Stephanos.ReadOnlyCanonicalNodeIdentityV1]::Observe([uint32]$PID,[long]$birth.Ticks)
if($image -cne 'OWNER_NATIVE_IMAGE_MISMATCH'){throw ('WRONG_REAL_IMAGE_RESULT:'+ $image)}
$wrongBirth=$birth.AddSeconds(-1).Ticks
$reuse=[Stephanos.ReadOnlyCanonicalNodeIdentityV1]::Observe([uint32]$PID,[long]$wrongBirth)
if($reuse -cne 'OWNER_NATIVE_BIRTH_MISMATCH'){throw 'PID_REUSE_NOT_HELD'}
Write-Output 'OWNER_NATIVE_QUERY_RIGHTS_PASS'
`;
    const result = runPowerShell(script);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /OWNER_NATIVE_QUERY_RIGHTS_PASS/);
  });

test('genuine limited Windows token can bind its existing canonical Node parent without a CIM image',
  { skip: process.platform !== 'win32' }, t => {
    if (process.execPath.replaceAll('/', '\\').toLowerCase() !== 'c:\\program files\\nodejs\\node.exe') {
      t.skip('This fixture requires the existing canonical Node installation; it never installs or substitutes one.');
      return;
    }
    const script = `
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
 Write-Output 'LIMITED_TOKEN_FIXTURE_UNAVAILABLE'
 exit 0
}
. '${ownerScript.replace(/'/g, "''")}'
$original=Get-CimInstance Win32_Process -Filter 'ProcessId=${process.pid}' -ErrorAction Stop
$row=[pscustomobject]@{Name=$original.Name;ProcessId=$original.ProcessId;CommandLine=$original.CommandLine;
 CreationDate=$original.CreationDate;ExecutablePath=$null}
$result=Get-StephanosCanonicalNodeIdentityV1 -ProcessRow $row
if($result.ok -ne $true -or $result.diagnosticCode -cne ''){throw ('LIMITED_TOKEN_NATIVE_IDENTITY_HELD:'+ $result.diagnosticCode)}
Write-Output 'LIMITED_TOKEN_NATIVE_IDENTITY_PASS'
`;
    const result = runPowerShell(script);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    if (result.stdout.includes('LIMITED_TOKEN_FIXTURE_UNAVAILABLE')) {
      t.skip('The current fixture token is administrator-enabled; it does not prove the ordinary operator route.');
      return;
    }
    assert.match(result.stdout, /LIMITED_TOKEN_NATIVE_IDENTITY_PASS/);
  });
