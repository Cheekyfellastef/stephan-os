import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const native = ['SovereignCoreJobCustodyV1.cs','SovereignFixedRuntimeJobV1.cs','SovereignFixedRuntimeIdentityV1.cs','SovereignFixedRuntimeAuthorityV1.cs','SovereignFixedRuntimeHostV1.cs','SovereignFixedRuntimeSourceV1.cs'];
const literal = value => "'" + value.replaceAll("'", "''") + "'";
test('fixed runtime identity keeps each native unit within the original 32KiB bound', () => { for (const name of native) assert.ok(readFileSync(new URL('./windows/'+name, import.meta.url)).length <= 32768, name); });
test('native identity requires a genuine later boot and denies absent protected installation', { skip: process.platform !== 'win32', timeout: 30000 }, () => {
const files = native.map(name => literal(fileURLToPath(new URL('./windows/'+name, import.meta.url))));
const fixedExecutables=[
  'C:\\Program Files\\nodejs\\node.exe','C:\\Program Files\\Git\\cmd\\git.exe',
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
].filter(existsSync).map(Path => ({Path,Digest:createHash('sha256').update(readFileSync(Path)).digest('hex'),Links:statSync(Path).nlink}));
assert.ok(fixedExecutables.some(row => row.Path.endsWith('powershell.exe')));
assert.ok(fixedExecutables.some(row => row.Path.endsWith('git.exe')));
const code = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$source=(@(__FILES__) | ForEach-Object { [IO.File]::ReadAllText($_) }) -join [Environment]::NewLine
Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Web.Extensions','System.Core','System.Management' -ErrorAction Stop
$flags=[Reflection.BindingFlags]'NonPublic,Static'
$type=[Stephanos.Sovereign.CoreJobCustodyV1]
$pending=[Stephanos.Sovereign.FixedRuntimePendingV1]::new()
$pending.CompilerCompletedAtUtc='2026-01-01T00:00:00.000Z'
$pending.InstalledAtUtc='2026-01-01T00:00:01.000Z'
$check=$type.GetMethod('RuntimePendingBootOrderV1',$flags)
$old=[DateTime]::Parse('2026-01-01T00:00:00Z').ToUniversalTime()
$boot=[DateTime]::Parse('2026-01-01T00:00:02Z').ToUniversalTime()
$now=[DateTime]::Parse('2026-01-01T00:00:03Z').ToUniversalTime()
if(-not $check.Invoke($null,@($pending,$boot,$now))) { throw 'LATER_BOOT_REFUSED' }
if($check.Invoke($null,@($pending,$old,$now))) { throw 'OLD_BOOT_ACCEPTED' }
if($check.Invoke($null,@($pending,$boot,$old))) { throw 'FUTURE_BOOT_ACCEPTED' }
$pending.InstalledAtUtc=$pending.CompilerCompletedAtUtc
if($check.Invoke($null,@($pending,$boot,$now))) { throw 'SAME_COMPILE_INSTALL_ACCEPTED' }
try { $nativeBoot=$type.GetMethod('RuntimeWindowsBootV1',$flags).Invoke($null,@()) }
catch {
  $chain=$_.Exception; $details=@();
  while($null -ne $chain) { $details+=($chain.GetType().FullName+':'+$chain.Message);$chain=$chain.InnerException }
  throw ('NATIVE_BOOT_OBSERVATION_FAILED:'+($details -join '|'))
}
if($nativeBoot -ge [DateTime]::UtcNow) { throw 'NATIVE_BOOT_NOT_PAST' }
$machine=$type.GetMethod('RuntimeMachineHashV1',$flags).Invoke($null,@())
foreach($ancestor in @('C:\','C:\Program Files')) { [void]$type.GetMethod('RuntimeFixedAncestorAclV1',$flags).Invoke($null,@($ancestor)) }
if($machine -cnotmatch '^[a-f0-9]{64}$') { throw 'NATIVE_MACHINE_INVALID' }
try { $type.GetMethod('OpenFixedRuntimeIdentityV1',$flags).Invoke($null,@()); throw 'UNINSTALLED_RUNTIME_ACCEPTED' }
catch { if($_.Exception.InnerException.Message -cne 'RUNTIME_EMBEDDED_MANIFEST_UNPROVEN') { throw } }
$fixture=[IO.Path]::GetFullPath([IO.Path]::Combine([IO.Path]::GetTempPath(),'fixed-runtime-identity-'+[Guid]::NewGuid().ToString('N')))
[IO.Directory]::CreateDirectory($fixture)|Out-Null
$owned=[IO.Path]::Combine($fixture,'source.txt')
[IO.File]::WriteAllText($owned,'owned-fixture-source')
$pins=[Activator]::CreateInstance($type.Assembly.GetType('Stephanos.Sovereign.FixedRuntimeIdentityPinsV1'),$true)
try {
  [void]$type.GetMethod('RuntimePinParentsV1',$flags).Invoke($null,@($owned,$pins))
  $bytes=$type.GetMethod('RuntimeReadPinnedV1',$flags).Invoke($null,@($owned,4096,$pins))
  if([Text.Encoding]::UTF8.GetString($bytes) -cne 'owned-fixture-source') { throw 'PIN_BYTES_CHANGED' }
  $writeDenied=$false
  try { $writer=[IO.File]::Open($owned,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite);$writer.Dispose() }
  catch { $writeDenied=$true }
  if(-not $writeDenied) { throw 'PIN_WRITER_ACCEPTED' }
  $renameDenied=$false
  try { [IO.File]::Move($owned,[IO.Path]::Combine($fixture,'renamed.txt')) }
  catch { $renameDenied=$true }
  if(-not $renameDenied) { throw 'PIN_RENAME_ACCEPTED' }
  $acl=[IO.File]::GetAccessControl($owned)
  $everyone=[Security.Principal.SecurityIdentifier]::new('S-1-1-0')
  $rule=[Security.AccessControl.FileSystemAccessRule]::new($everyone,[Security.AccessControl.FileSystemRights]::Write,[Security.AccessControl.AccessControlType]::Allow)
  $acl.AddAccessRule($rule)
  [IO.File]::SetAccessControl($owned,$acl)
  try { $type.GetMethod('RuntimeProtectedAclV1',$flags).Invoke($null,@($owned,$false));throw 'UNSAFE_ACL_ACCEPTED' }
  catch {
    if($_.Exception.InnerException.Message -cnotmatch '^RUNTIME_PROTECTED_(OWNER|WRITE_AUTHORITY)_UNPROVEN$') { throw }
  }
} finally {
  ([IDisposable]$pins).Dispose()
  $expected=[IO.Path]::GetFullPath([IO.Path]::Combine([IO.Path]::GetTempPath(),'fixed-runtime-identity-'))
  if(-not $fixture.StartsWith($expected,[StringComparison]::OrdinalIgnoreCase)) { throw 'FIXTURE_DELETE_SCOPE' }
  [IO.Directory]::Delete($fixture,$true)
}
# Synthetic, non-production authenticated records exercise the existing two
# domains. No real token, journal registration or journal mutation is used.
$key='fixed-runtime-auth-fixture-key-not-production'
$scope='a'*64
function Fixture-Mac([string]$message) {
  $hmac=[Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($key))
  try { return ([BitConverter]::ToString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($message)))).Replace('-','').ToLowerInvariant() }
  finally { $hmac.Dispose() }
}
$record=[ordered]@{
  schemaVersion='stephanos.sovereign-maintenance-custody.v1';phase='ACTIVE'
  reservationId='fixture-request-1234';ownerId='fixture-owner';ownerPid=1234;operation='repair-goal-builder-flow'
  startedAtUtc='2026-01-01T00:00:03.000Z'
  bootWitness=[ordered]@{schemaVersion='stephanos.windows-boot-witness.v1';machineHash=('b'*64)
    bootStartedAtUtc='2026-01-01T00:00:02.000Z';observedAtUtc='2026-01-01T00:00:03.000Z'}
}
$recordJson=$record|ConvertTo-Json -Depth 8 -Compress
$recordMac=Fixture-Mac ('stephanos-maintenance-custody-v1'+[char]0+'record'+[char]0+$recordJson)
$state='{"record":'+$recordJson+',"mac":"'+$recordMac+'"}'+[char]10
function Fixture-Anchor([string]$stateText) {
  $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($stateText))
  $transition='11111111-2222-3333-4444-555555555555'
  $mac=Fixture-Mac ('stephanos-maintenance-os-anchor-v3'+[char]0+'retained-v2-production'+[char]0+$scope+[char]0+'42'+[char]0+'41'+[char]0+$transition+[char]0+$encoded)
  return ([ordered]@{scope=$scope;journalId='retained-v2-production';recordId=42;previousRecordId=41
    transitionId=$transition;stateBase64=$encoded;mac=$mac}|ConvertTo-Json -Compress)
}
$anchor=[string](Fixture-Anchor $state)
$decode=$type.GetMethod('DecodeRuntimeCustodyV1',$flags)
$decoded=$decode.Invoke($null,@([string]$anchor,[long]42,[string]$key,[string]$scope))
$instance=[Reflection.BindingFlags]'NonPublic,Instance'
if($decoded.GetType().GetField('OwnerPid',$instance).GetValue($decoded) -ne 1234) { throw 'AUTH_OWNER_CHANGED' }
if($decoded.GetType().GetField('ReservationId',$instance).GetValue($decoded) -cne 'fixture-request-1234') { throw 'AUTH_REQUEST_CHANGED' }
foreach($negative in @(
  @($anchor,[long]43,$key,$scope),
  @($anchor,[long]42,('wrong-fixture-key-'*3),$scope),
  @($anchor,[long]42,$key,('c'*64)),
  @((Fixture-Anchor $state.Replace($recordMac,('0'*64))),[long]42,$key,$scope),
  @($anchor.Replace('retained-v2-production','other-journal'),[long]42,$key,$scope)
)) {
  $denied=$false
  try { $decode.Invoke($null,@([string]$negative[0],[long]$negative[1],[string]$negative[2],[string]$negative[3]))|Out-Null }
  catch {
    if($_.Exception.InnerException.Message -cnotmatch '^RUNTIME_(CUSTODY|NATIVE)_') { throw }
    $denied=$true
  }
  if(-not $denied) { throw 'FORGED_AUTHORITY_ACCEPTED' }
}
$parse=$type.GetMethod('ParseFixedRuntimeRequestV1',$flags)
$empty=[Security.Cryptography.SHA256]::Create()
try { $emptyHash=([BitConverter]::ToString($empty.ComputeHash([byte[]]::new(0)))).Replace('-','').ToLowerInvariant() }
finally { $empty.Dispose() }
$frame=[ordered]@{SchemaVersion='stephanos.fixed-runtime-request.v1';RequestId='fixture-request-1234'
  Profile='MAINTENANCE_GOAL_BUILDER_V1';RuntimeSourceHead=('a'*40);OwnerPid=1234
  TaskFrameBase64='';TaskBindingSha256=$emptyHash}
$raw=[string]($frame|ConvertTo-Json -Compress)
$parsed=$parse.Invoke($null,@($raw))
if($parsed.OwnerPid -ne 1234 -or $parsed.Profile -cne 'MAINTENANCE_GOAL_BUILDER_V1') { throw 'FRAME_VALID_PARSE_FAILED' }
foreach($bad in @(
  $raw.Replace('"OwnerPid":1234','"OwnerPid":"1234"'),
  $raw.Replace('"OwnerPid":1234','"OwnerPid":1234,"OwnerPid":1235'),
  $raw.Replace('"OwnerPid":1234','"Executable":"cmd.exe","OwnerPid":1234'),
  $raw.Replace('MAINTENANCE_GOAL_BUILDER_V1','ARBITRARY_COMMAND'),
  $raw.Replace($emptyHash,('0'*64))
)) {
  $refused=$false
  try { $parse.Invoke($null,@([string]$bad))|Out-Null }
  catch { if($_.Exception.InnerException.Message -cnotmatch '^RUNTIME_') { throw };$refused=$true }
  if(-not $refused) { throw 'CALLER_AUTHORITY_FRAME_ACCEPTED' }
}
$parent=$type.GetMethod('RuntimeActualParentV1',$flags).Invoke($null,@())
if($parent -ne __NODE_PID__) { throw 'ACTUAL_NATIVE_PARENT_CHANGED' }
$current=[Diagnostics.Process]::GetCurrentProcess()
$wrongBirth=$current.StartTime.ToUniversalTime().ToFileTimeUtc()+1
try { $type.GetMethod('RuntimeOwnerHandleV1',$flags).Invoke($null,@($current.Id,[long]$wrongBirth))|Out-Null;throw 'WRONG_BIRTH_ACCEPTED' }
catch { if($_.Exception.InnerException.Message -cne 'OWNER_BIRTH_UNPROVEN') { throw } }
$fixed=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__FIXED_EXECUTABLES__'))|ConvertFrom-Json
$exePins=[Activator]::CreateInstance($type.Assembly.GetType('Stephanos.Sovereign.FixedRuntimeIdentityPinsV1'),$true)
try {
  foreach($exe in $fixed) {
    $type.GetMethod('RuntimePinFixedExecutableV1',$flags).Invoke($null,@([string]$exe.Path,[string]$exe.Digest,[int]$exe.Links,$exePins))|Out-Null
  }
} finally { ([IDisposable]$exePins).Dispose() }
$hardRoot=[IO.Path]::GetFullPath([IO.Path]::Combine([IO.Path]::GetTempPath(),'fixed-runtime-hardlink-'+[Guid]::NewGuid().ToString('N')))
[IO.Directory]::CreateDirectory($hardRoot)|Out-Null
$hard=[IO.Path]::Combine($hardRoot,'source.txt')
$alias=[IO.Path]::Combine($hardRoot,'source-alias.txt')
[IO.File]::WriteAllText($hard,'fixture-source-alias')
New-Item -ItemType HardLink -Path $alias -Target $hard -ErrorAction Stop|Out-Null
$hardPins=[Activator]::CreateInstance($type.Assembly.GetType('Stephanos.Sovereign.FixedRuntimeIdentityPinsV1'),$true)
try {
  try { $type.GetMethod('RuntimeReadPinnedV1',$flags).Invoke($null,@($hard,4096,$hardPins))|Out-Null;throw 'SOURCE_HARDLINK_ACCEPTED' }
  catch { if($_.Exception.InnerException.Message -cne 'RUNTIME_SOURCE_PIN_IDENTITY_UNPROVEN') { throw } }
  try { $type.GetMethod('RuntimePinFixedExecutableV1',$flags).Invoke($null,@($hard,('0'*64),2,$hardPins))|Out-Null;throw 'CALLER_EXECUTABLE_PATH_ACCEPTED' }
  catch { if($_.Exception.InnerException.Message -cne 'RUNTIME_FIXED_EXECUTABLE_IDENTITY_UNPROVEN') { throw } }
} finally {
  ([IDisposable]$hardPins).Dispose()
  $expected=[IO.Path]::GetFullPath([IO.Path]::Combine([IO.Path]::GetTempPath(),'fixed-runtime-hardlink-'))
  if(-not $hardRoot.StartsWith($expected,[StringComparison]::OrdinalIgnoreCase)) { throw 'HARDLINK_FIXTURE_DELETE_SCOPE' }
  [IO.Directory]::Delete($hardRoot,$true)
}
[Console]::WriteLine('{"ok":true,"laterBootRequired":true,"uninstalledRefused":true,"runtimeActivated":false}')
`.replace('__FILES__', files.join(',')).replace('__NODE_PID__', String(process.pid))
    .replace('__FIXED_EXECUTABLES__', Buffer.from(JSON.stringify(fixedExecutables)).toString('base64'));
const directory=mkdtempSync(join(tmpdir(),'stph-runtime-identity-driver-'));
const driver=join(directory,'driver.ps1');
writeFileSync(driver,code,{encoding:'utf8',flag:'wx'});
const digest=createHash('sha256').update(Buffer.from(code)).digest('hex');
const bootstrap="$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$bytes=[IO.File]::ReadAllBytes("+literal(driver)+");"
  +"$sha=[Security.Cryptography.SHA256]::Create();try{$digest=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()};"
  +"if($digest -cne '"+digest+"'){throw 'IDENTITY_FIXTURE_SOURCE_CHANGED'};& ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($bytes)))";
assert.ok(bootstrap.length<4096);
let out;
try {
  out=execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(bootstrap,'utf16le').toString('base64')],
    {encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:25000,maxBuffer:128*1024});
} catch(error) { throw new Error(String(error.stderr||error.message).slice(0,12000)); }
finally { unlinkSync(driver); rmdirSync(directory); }
assert.deepEqual(JSON.parse(out.trim()), {ok:true,laterBootRequired:true,uninstalledRefused:true,runtimeActivated:false});
});
